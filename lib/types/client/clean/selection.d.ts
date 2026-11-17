/**
 * 清理面板的纯逻辑：默认勾选、分组汇总与半选、「立即清理」前要不要就地确认、动作被接受后关窗。
 *
 * 不碰 DOM、不发请求（请求由调用方传入），可直接单测。面板（./panel）只负责把这些结果画出来。
 * @module jingsao/src/client/clean/selection
 */
import type { CleanCategory, CleanFeature, CleanScanResult } from './api.ts';
/** 垃圾清理的分组（与宿主规则的 group 一致），面板按这个顺序排；只报告的放最后一组。 */
export declare const JUNK_GROUPS: ReadonlyArray<{
    id: string;
    label: string;
}>;
/** 按整类勾选的功能（其余按单个文件勾）。 */
export declare const CATEGORY_PICK: readonly CleanFeature[];
/** 勾选状态的键：整类 c:<分类 id>，单项 i:<文件 id>。 */
export type PickMap = Record<string, boolean>;
/** 这一类默认勾不勾：宿主给了 defaultChecked 就听它的，否则 risky 不勾；只报告的永远不勾。 */
export declare function defaultOn(category: CleanCategory): boolean;
/** 扫描结果 → 默认勾选。 */
export declare function defaultPicks(feature: CleanFeature, result: CleanScanResult | null): PickMap;
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
export declare function junkGroups(result: CleanScanResult | null, picked: PickMap): JunkGroupView[];
/** 当前勾选：单项 id、整类 id、合计字节，以及勾选里需要确认的项（名称）。 */
export interface Selection {
    ids: string[];
    categories: string[];
    bytes: number;
    /** 需要就地确认的项：默认不勾、用户自己勾上的（重复文件每一项都算）。 */
    confirm: string[];
}
/** 由扫描结果与勾选算出这次要提交什么。 */
export declare function selectionOf(feature: CleanFeature, result: CleanScanResult | null, picked: PickMap): Selection;
/** 就地确认那一句：「你勾了 3 项需要确认的内容：XX、XX…，删除后无法恢复」。 */
export declare function confirmText(labels: readonly string[], verb?: string): string;
/**
 * 点「立即清理 / 搬家」：勾选里有需要确认的项 → 'confirm'（摘要卡就地展开确认）；否则直接 'start'。
 * confirmed = 用户已在就地确认里点了「确认清理」。
 */
export declare function decideAction(selection: Pick<Selection, 'confirm'>, confirmed: boolean): 'confirm' | 'start';
/** 宿主的应答（与 ./api 的 Reply 同形）。 */
export type ActionReply = {
    ok: true;
} | {
    ok: false;
    message: string;
};
/**
 * 发起一个任务：宿主接受（ok）后立刻关掉清理小窗 / 浮层，任务在宿主后台跑；被拒绝时不关，把原因交回给面板显示。
 * @returns 失败原因；成功返回 null。
 */
export declare function launchThenClose(request: Promise<ActionReply>, onClose: (() => void) | undefined): Promise<string | null>;
