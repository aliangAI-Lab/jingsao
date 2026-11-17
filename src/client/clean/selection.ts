/**
 * 清理面板的纯逻辑：默认勾选、分组汇总与半选、「立即清理」前要不要就地确认、动作被接受后关窗。
 *
 * 不碰 DOM、不发请求（请求由调用方传入），可直接单测。面板（./panel）只负责把这些结果画出来。
 * @module jingsao/src/client/clean/selection
 */
import type { CleanCategory, CleanFeature, CleanScanResult } from './api.ts';

/** 垃圾清理的分组（与宿主规则的 group 一致），面板按这个顺序排；只报告的放最后一组。 */
export const JUNK_GROUPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'app', label: '应用程序' },
  { id: 'system', label: '系统相关' },
  { id: 'cache', label: '缓存文件' },
  { id: 'temp', label: '临时文件' },
  { id: 'dev', label: '开发工具缓存' },
  { id: 'recycle', label: '回收站' },
  { id: 'report', label: '需要系统来清' },
];

/** 按整类勾选的功能（其余按单个文件勾）。 */
export const CATEGORY_PICK: readonly CleanFeature[] = ['junk', 'chat'];

/** 勾选状态的键：整类 c:<分类 id>，单项 i:<文件 id>。 */
export type PickMap = Record<string, boolean>;

/** 这一类默认勾不勾：宿主给了 defaultChecked 就听它的，否则 risky 不勾；只报告的永远不勾。 */
export function defaultOn(category: CleanCategory): boolean {
  if (category.reportOnly) return false;
  return category.defaultChecked ?? category.tier !== 'risky';
}

/** 扫描结果 → 默认勾选。 */
export function defaultPicks(feature: CleanFeature, result: CleanScanResult | null): PickMap {
  const next: PickMap = {};
  for (const c of result?.categories ?? []) {
    if (c.reportOnly) continue;
    if (CATEGORY_PICK.includes(feature)) next['c:' + c.id] = defaultOn(c);
    else for (const item of c.items) next['i:' + item.id] = item.selected ?? defaultOn(c);
  }
  return next;
}

/** 一组的汇总。 */
export interface JunkGroupView {
  id: string;
  label: string;
  categories: CleanCategory[];
  bytes: number;
  /** 整组勾选框：all 全选、none 全不选、some 半选；只报告的组为 null（没有勾选框）。 */
  check: 'all' | 'none' | 'some' | null;
}

/** 垃圾清理按组汇总；大小为 0 的组整组隐藏（有「需管理员」读不到的项不算 0）。 */
export function junkGroups(result: CleanScanResult | null, picked: PickMap): JunkGroupView[] {
  const out: JunkGroupView[] = [];
  for (const group of JUNK_GROUPS) {
    const categories = (result?.categories ?? []).filter((c) =>
      group.id === 'report' ? c.reportOnly : !c.reportOnly && (c.group ?? 'cache') === group.id,
    );
    const bytes = categories.reduce((sum, c) => sum + c.bytes, 0);
    if (!categories.length || (bytes === 0 && !categories.some((c) => c.unreadable))) continue;
    let check: JunkGroupView['check'] = null;
    if (group.id !== 'report') {
      const on = categories.filter((c) => picked['c:' + c.id] === true).length;
      check = on === 0 ? 'none' : on === categories.length ? 'all' : 'some';
    }
    out.push({ id: group.id, label: group.label, categories, bytes, check });
  }
  return out;
}

/** 当前勾选：单项 id、整类 id、合计字节，以及勾选里需要确认的项（名称）。 */
export interface Selection {
  ids: string[];
  categories: string[];
  bytes: number;
  /** 需要就地确认的项：默认不勾、用户自己勾上的（重复文件每一项都算）。 */
  confirm: string[];
}

/** 由扫描结果与勾选算出这次要提交什么。 */
export function selectionOf(feature: CleanFeature, result: CleanScanResult | null, picked: PickMap): Selection {
  const sel: Selection = { ids: [], categories: [], bytes: 0, confirm: [] };
  for (const c of result?.categories ?? []) {
    if (c.reportOnly) continue;
    if (CATEGORY_PICK.includes(feature)) {
      if (picked['c:' + c.id] !== true) continue;
      // 什么都没有的分类不提交（读不到、需要管理员的除外：提权后才知道有多少）
      if (!c.bytes && !c.unreadable) continue;
      sel.categories.push(c.id);
      sel.bytes += c.bytes;
      if (!defaultOn(c)) sel.confirm.push(c.label);
      continue;
    }
    let any = false;
    for (const item of c.items) {
      if (picked['i:' + item.id] !== true) continue;
      sel.ids.push(item.id);
      sel.bytes += item.size;
      any = true;
    }
    // 重复文件：删的是用户自己的文件，任何勾选都要确认；大文件搬家按风险档位判断
    if (any && (feature === 'duplicates' || !defaultOn(c))) sel.confirm.push(c.label);
  }
  return sel;
}

/** 就地确认那一句：「你勾了 3 项需要确认的内容：XX、XX…，删除后无法恢复」。 */
export function confirmText(labels: readonly string[], verb = '删除后无法恢复'): string {
  const shown = labels.slice(0, 3).join('、') + (labels.length > 3 ? '…' : '');
  return `你勾了 ${labels.length} 项需要确认的内容：${shown}，${verb}`;
}

/**
 * 点「立即清理 / 搬家」：勾选里有需要确认的项 → 'confirm'（摘要卡就地展开确认）；否则直接 'start'。
 * confirmed = 用户已在就地确认里点了「确认清理」。
 */
export function decideAction(selection: Pick<Selection, 'confirm'>, confirmed: boolean): 'confirm' | 'start' {
  return selection.confirm.length > 0 && !confirmed ? 'confirm' : 'start';
}

/** 宿主的应答（与 ./api 的 Reply 同形）。 */
export type ActionReply = { ok: true } | { ok: false; message: string };

/**
 * 发起一个任务：宿主接受（ok）后立刻关掉清理小窗 / 浮层，任务在宿主后台跑；被拒绝时不关，把原因交回给面板显示。
 * @returns 失败原因；成功返回 null。
 */
export async function launchThenClose(
  request: Promise<ActionReply>,
  onClose: (() => void) | undefined,
): Promise<string | null> {
  const reply = await request;
  if (!reply.ok) return reply.message;
  onClose?.();
  return null;
}
