/**
 * 垃圾扫描按规则生成展示分类与带身份的候选，重叠规则只计入首次命中的分类。
 *
 * 扫描全程只读：普通规则逐个文件记下身份（动手时复核）；系统规则（needsAdmin）读不到的根目录记成
 * adminDirs，交给提权子进程在里面按同样的约束枚举；回收站、传递优化缓存只统计大小，清理时调系统命令。
 * 最后附上只报告、不删的系统大块头（WinSxS、旧系统备份、休眠文件、虚拟内存），带「用系统方式清理」的入口。
 * 取消后返回已完成部分并发出取消进度。
 * @module jingsao/src/host/clean/junk/scan
 */
import fs, { type Stats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { DAY_MS, HOUR_MS, inspectCandidate, inspectScanned, type CleanPlaces, type DenyOptions } from '../safety.ts';
import {
  MAX_ITEMS_PER_CATEGORY,
  type CleanCategory,
  type CleanItem,
  type CleanProgress,
  type CleanScanResult,
} from '../types.ts';
import type { AdminDir, DeleteCandidate } from '../delete/types.ts';
import type { SystemOps } from '../delete/system-ops.ts';
import { loadJunkRules, pathSpecs, validateJunkRules, type JunkBase, type JunkRule } from './rules.ts';
import { expandRoots, walkFiles } from './traversal.ts';

/** 进度与取消通过调用方传入，宿主可以同时保持页面响应。 */
export interface JunkScanOptions {
  signal?: AbortSignal;
  onProgress?: (progress: CleanProgress) => void;
  rules?: JunkRule[];
  /** 回收站、传递优化缓存的大小来源；缺省时这两类只按目录估算（回收站为 0）。 */
  systemOps?: SystemOps;
}

/** 扫描产物。 */
export interface JunkScanOutput {
  result: CleanScanResult;
  /** 全量候选（页面只列每类最大的若干个）。 */
  candidates: Map<string, DeleteCandidate>;
  /** 需要管理员、扫描时读不到的根目录。 */
  adminDirs: AdminDir[];
  /** 分类 id → 规则（服务层据此决定提权、系统命令与更新检查）。 */
  rules: Map<string, JunkRule>;
}

/** 系统级基础目录：在这些目录下动手需要规则显式登记根目录（safety 的 systemRoots）。 */
const SYSTEM_BASES: ReadonlySet<JunkBase> = new Set(['windows', 'programdata', 'systemdrive', 'programfilesx86']);

/** 只报告、不删的系统大块头：id、名称、相对位置、说明、系统方式。 */
const SYSTEM_REPORTS: ReadonlyArray<{
  id: string;
  label: string;
  base: 'windows' | 'systemdrive';
  path: string;
  single?: boolean;
  /** 只算单一硬链接的文件（WinSxS 里绝大多数文件与系统目录共享硬链接，算进去会虚高）。 */
  exclusive?: boolean;
  explanation: string;
  action?: 'winsxs' | 'windows-old';
}> = [
  {
    id: 'winsxs',
    label: '系统组件存储（WinSxS）',
    base: 'windows',
    path: 'WinSxS',
    exclusive: true,
    explanation:
      '系统更新留下的旧版组件；不能手动删，用系统自带的组件清理（会弹管理员确认，跑几分钟）。大小只算不和系统共享的部分，是估计值。',
    action: 'winsxs',
  },
  {
    id: 'old',
    label: '旧系统备份（Windows.old）',
    base: 'systemdrive',
    path: 'Windows.old',
    explanation: '升级系统前的旧版本备份，删了就不能回退。在系统设置的「临时文件」里勾「以前的 Windows 安装」删除。',
    action: 'windows-old',
  },
  {
    id: 'hibernate',
    label: '休眠文件',
    base: 'systemdrive',
    path: 'hiberfil.sys',
    single: true,
    explanation: '关闭休眠可释放空间；以管理员身份运行 powercfg -h off，会关闭休眠功能。',
  },
  {
    id: 'pagefile',
    label: '虚拟内存文件',
    base: 'systemdrive',
    path: 'pagefile.sys',
    single: true,
    explanation: '虚拟内存可在系统设置里改到其他盘，修改后按系统提示重启。',
  },
];

function includeItem(category: CleanCategory, item: CleanItem): void {
  category.count++;
  category.bytes += item.size;
  const items = category.items;
  if (items.length === MAX_ITEMS_PER_CATEGORY && item.size <= items[items.length - 1]!.size) return;
  const index = items.findIndex((existing) => existing.size < item.size);
  items.splice(index === -1 ? items.length : index, 0, item);
  if (items.length > MAX_ITEMS_PER_CATEGORY) items.pop();
}

/** 文件名模式 → 正则（只认 *，不分大小写）。 */
export function fileMatcher(pattern: string): RegExp {
  return new RegExp(
    '^' +
      pattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
    'i',
  );
}

/**
 * 只报告目录的快速统计：不跟随联接（不删东西，只看大小）。复用 walkFiles 的并发遍历，
 * 大目录（WinSxS）不会长时间占住宿主主线程。
 * @returns 字节数、文件数与是否有读不到的子目录；目录不存在返回 null。
 */
async function measureTree(
  root: string,
  places: CleanPlaces,
  signal: AbortSignal | undefined,
  exclusive: boolean,
): Promise<{ bytes: number; count: number; unreadable: boolean } | null> {
  try {
    if (!fs.lstatSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  let bytes = 0;
  let count = 0;
  let unreadable = false;
  const flag = () => {
    unreadable = true;
  };
  for await (const { stat } of walkFiles(root, places, {
    reportOnly: true,
    ...(signal ? { signal } : {}),
    onDenied: flag,
    onStatError: flag,
  })) {
    if (exclusive && stat.nlink !== 1) continue;
    bytes += stat.size;
    count++;
  }
  return { bytes, count, unreadable };
}

/** 候选保留全量，页面列表截断只影响展示，分类清理仍能取得全部文件。 */
export async function scanJunk(places: CleanPlaces, options: JunkScanOptions = {}): Promise<JunkScanOutput> {
  const rules = options.rules ? validateJunkRules(options.rules) : loadJunkRules();
  const { signal } = options;
  const result: CleanScanResult = {
    feature: 'junk',
    scanId: randomUUID(),
    startedAt: Date.now(),
    finishedAt: 0,
    categories: [],
    totalBytes: 0,
  };
  const candidates = new Map<string, DeleteCandidate>();
  const adminDirs: AdminDir[] = [];
  const ruleMap = new Map<string, JunkRule>();
  const seen = new Set<string>();
  let files = 0;
  let bytes = 0;
  const progress = (phase: CleanProgress['phase'], current?: string) =>
    options.onProgress?.({ feature: 'junk', phase, files, bytes, current });
  progress('scanning');
  // 只报告的系统大块头（WinSxS 有几十万个文件）一开始就在后台统计，和规则扫描同时进行
  const measuring = new Map<string, Promise<{ bytes: number; count: number; unreadable: boolean } | null>>();
  for (const report of SYSTEM_REPORTS) {
    if (report.single) continue;
    const pending = measureTree(join(places[report.base], report.path), places, signal, report.exclusive === true);
    pending.catch(() => null);
    measuring.set(report.id, pending);
  }
  for (const rule of rules) {
    if (signal?.aborted) break;
    ruleMap.set(rule.id, rule);
    const category: CleanCategory = {
      id: rule.id,
      label: rule.label,
      tier: rule.tier,
      explanation: rule.explanation,
      bytes: 0,
      count: 0,
      items: [],
      group: rule.group,
      defaultChecked: rule.defaultChecked,
      needsAdmin: rule.needsAdmin,
      ...(rule.warn ? { warn: rule.warn } : {}),
      ...(rule.special ? { special: rule.special } : {}),
    };
    const base = places[rule.base];
    const system = SYSTEM_BASES.has(rule.base);
    const minAgeHours = rule.minAgeHours;

    if (rule.special === 'recycle-bin') {
      const size = options.systemOps ? await options.systemOps.recycleBinBytes() : 0;
      if (size === null) category.unreadable = true;
      else category.bytes = size;
    } else if (rule.special === 'delivery-opt') {
      const size = options.systemOps ? await options.systemOps.deliveryCacheBytes() : null;
      if (size !== null) {
        category.bytes = size;
      } else {
        // 系统接口读不到：按缓存目录估算（普通权限多半读不到，显示「需管理员」）
        for (const spec of pathSpecs(rule)) {
          const measured = await measureTree(join(base, spec.path), places, signal, false);
          if (measured) {
            category.bytes += measured.bytes;
            if (measured.unreadable) category.unreadable = true;
          }
        }
      }
    } else {
      for (const spec of pathSpecs(rule)) {
        const filePatterns = spec.files ?? rule.files;
        const patterns = filePatterns?.map(fileMatcher);
        const ageDays = spec.ageDays ?? rule.ageDays;
        const minAgeMs = Math.max((ageDays ?? 0) * DAY_MS, (minAgeHours ?? 0) * HOUR_MS);
        const add = (
          path: string,
          root: string,
          systemRoot: string | undefined,
          deny: DenyOptions,
          stat?: Stats,
        ): void => {
          if (seen.has(path.toLowerCase()) || (patterns && !patterns.some((pattern) => pattern.test(basename(path))))) {
            return;
          }
          let identity;
          try {
            const inspect = {
              ...deny,
              root,
              ...(ageDays ? { ageDays } : {}),
              ...(minAgeHours ? { minAgeHours } : {}),
            };
            // 遍历里拿到的文件已经逐级确认不是链接，只做轻量复核；单个文件规则走完整复核
            identity = stat ? inspectScanned(path, stat, places, inspect) : inspectCandidate(path, places, inspect);
          } catch {
            return;
          }
          const id = randomUUID();
          seen.add(path.toLowerCase());
          candidates.set(id, {
            id,
            path,
            identity,
            categoryId: rule.id,
            root,
            ...(systemRoot ? { systemRoot } : {}),
            ...(ageDays ? { ageDays } : {}),
            ...(minAgeHours ? { minAgeHours } : {}),
            ...(rule.needsAdmin ? { needsAdmin: true } : {}),
          });
          includeItem(category, {
            id,
            path,
            size: identity.size,
            mtimeMs: identity.mtimeMs,
            selected: rule.defaultChecked,
          });
          files++;
          bytes += identity.size;
          if (files % 64 === 0) progress('scanning', path);
        };

        if (spec.single) {
          // 单个文件（例如 Windows\MEMORY.DMP）：登记的系统根就是这个文件本身
          const file = join(base, spec.path);
          try {
            if (!fs.lstatSync(file).isFile()) continue;
          } catch {
            continue;
          }
          add(file, dirname(file), system ? file : undefined, system ? { systemRoots: [file] } : {});
          continue;
        }

        const expandDeny: DenyOptions = system ? { systemRoots: [base] } : {};
        const markers = rule.marker?.map(fileMatcher);
        for await (const root of expandRoots(base, spec.path, places, {
          signal,
          deny: expandDeny,
          ...(rule.skipDirs ? { skipDirs: rule.skipDirs } : {}),
          onDenied: () => {
            category.unreadable = true;
          },
        })) {
          const deny: DenyOptions = system ? { systemRoots: [root] } : {};
          // 标记规则（驱动解压目录）：先收集，整棵树里见到 setup.exe 或 *.inf 才算数
          const pending: Array<{ path: string; stat: Stats }> = [];
          let marked = !markers;
          for await (const { path, stat } of walkFiles(root, places, {
            signal,
            deny,
            onDenied: (dir) => {
              category.unreadable = true;
              // 系统规则读不到的目录：交给提权子进程自己枚举（标记规则要先看到标记，不能盲删）
              if (rule.needsAdmin && !markers) {
                adminDirs.push({
                  categoryId: rule.id,
                  root: dir,
                  ...(filePatterns ? { files: filePatterns } : {}),
                  minAgeMs,
                });
              }
            },
          })) {
            if (markers) {
              if (!marked && markers.some((marker) => marker.test(basename(path)))) marked = true;
              pending.push({ path, stat });
            } else {
              add(path, root, system ? root : undefined, deny, stat);
            }
          }
          if (markers && marked) {
            for (const item of pending) add(item.path, root, system ? root : undefined, deny, item.stat);
          }
        }
      }
    }
    if (category.bytes > 0 || category.count > 0 || category.unreadable) result.categories.push(category);
    result.totalBytes += category.bytes;
    progress('scanning', rule.label);
  }
  for (const report of SYSTEM_REPORTS) {
    if (signal?.aborted) break;
    const category: CleanCategory = {
      id: `system-${report.id}`,
      label: report.label,
      tier: 'risky',
      explanation: report.explanation,
      bytes: 0,
      count: 0,
      items: [],
      reportOnly: true,
      group: 'report',
      defaultChecked: false,
      ...(report.action ? { systemAction: report.action } : {}),
    };
    const target = join(places[report.base], report.path);
    if (report.single) {
      try {
        const stat = fs.lstatSync(target);
        if (stat.isFile()) {
          category.bytes = stat.size;
          category.count = 1;
        }
      } catch {
        /* 没有这个文件 */
      }
    } else {
      const measured = await (measuring.get(report.id) ?? Promise.resolve(null)).catch(() => null);
      if (measured) {
        category.bytes = measured.bytes;
        category.count = measured.count;
        if (measured.unreadable && !measured.bytes) category.unreadable = true;
      }
    }
    if (category.count || category.unreadable) result.categories.push(category);
    progress('scanning', report.label);
  }
  result.finishedAt = Date.now();
  progress(signal?.aborted ? 'cancelled' : 'done');
  return { result, candidates, adminDirs, rules: ruleMap };
}
