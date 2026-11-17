/**
 * 分批遍历让扫描可以响应取消，目录联接在展开和递归两处都受检查。
 * 文件是否可以清理由安全闸决定，此处只负责只读枚举；读不到的目录（多半需要管理员）交给 onDenied 记下。
 * @module jingsao/src/host/clean/junk/traversal
 */
import { lstatSync, type Dirent, type Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { denied, noLinks, type CleanPlaces, type DenyOptions } from '../safety.ts';

/** 遍历选项。 */
export interface TraversalOptions {
  signal?: AbortSignal;
  /** 安全闸放行范围（系统规则带 systemRoots）。 */
  deny?: DenyOptions;
  /** 读目录时没有权限（EPERM / EACCES）：记下这个目录。 */
  onDenied?: (path: string) => void;
  /** 通配符展开时跳过的目录名（不分大小写）。 */
  skipDirs?: readonly string[];
  /** 文件列出来了但读不到属性（多半是权限或刚被删）。 */
  onStatError?: (path: string) => void;
}

/** 是不是「没有权限」类的错误。 */
function accessError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

/**
 * 通配符仅展开一层，避免规则获得隐含的全盘遍历能力。
 * 基础目录做一次完整的逐级链接复核；往下展开时用目录列表里的类型（重解析点标成链接）跳过链接，
 * 固定名字的一级用一次 lstat 确认是普通目录。
 */
export async function* expandRoots(
  base: string,
  pattern: string,
  places: CleanPlaces,
  options: TraversalOptions = {},
): AsyncGenerator<string> {
  const { signal, deny } = options;
  const skip = new Set((options.skipDirs ?? []).map((name) => name.toLowerCase()));
  try {
    if (denied(base, places, deny)) return;
    noLinks(base);
    if (!lstatSync(base).isDirectory()) return;
  } catch {
    return;
  }
  let roots = [base];
  for (const segment of pattern.split('/')) {
    const next: string[] = [];
    for (const root of roots) {
      if (signal?.aborted) return;
      if (segment === '*') {
        let entries: Dirent[];
        try {
          entries = await readdir(root, { withFileTypes: true });
        } catch (error) {
          if (accessError(error)) options.onDenied?.(root);
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.isSymbolicLink() || skip.has(entry.name.toLowerCase())) continue;
          const target = join(root, entry.name);
          if (!denied(target, places, deny)) next.push(target);
        }
      } else {
        const target = join(root, segment);
        try {
          if (denied(target, places, deny)) continue;
          const stat = await lstat(target);
          if (stat.isDirectory() && !stat.isSymbolicLink()) next.push(target);
        } catch {
          /* 未安装的软件没有对应目录。 */
        }
      }
    }
    roots = next;
  }
  for (const root of roots) yield root;
}

/** 一次并发读多少个文件的 lstat（走 libuv 线程池，不卡宿主主线程）。 */
const STAT_BATCH = 64;
/** 一次同时列几个目录。 */
const DIR_BATCH = 8;

/**
 * 只报告目录也拒绝链接，避免系统统计绕到其他盘或形成循环。
 *
 * 根目录先做一次完整的逐级链接复核（noLinks）；往下走时，子项的类型直接取目录列表里的类型：
 * Windows 上符号链接、目录联接等所有重解析点在列表里都标成链接，一律跳过、不进入，
 * 所以从已复核的根往下走到的每一级都不是链接，不必再对每个文件逐级 lstat + realpath。
 * 每个文件只读一次 lstat，拿到大小、时间和硬链接数。动手时仍由 inspectCandidate 完整复核。
 */
export async function* walkFiles(
  root: string,
  places: CleanPlaces,
  options: TraversalOptions & { reportOnly?: boolean } = {},
): AsyncGenerator<{ path: string; stat: Stats }> {
  const { signal, deny, reportOnly = false } = options;
  try {
    if (!reportOnly && denied(root, places, deny)) return;
    noLinks(root);
    const rootStat = lstatSync(root);
    if (rootStat.isFile()) {
      if (reportOnly || rootStat.nlink === 1) yield { path: root, stat: rootStat };
      return;
    }
    if (!rootStat.isDirectory()) return;
  } catch {
    return;
  }
  const stack = [root];
  while (stack.length) {
    if (signal?.aborted) return;
    // 一次同时读几个目录：系统调用在线程池里并发，深而碎的缓存目录（uv、网页缓存）快很多
    const dirs = stack.splice(Math.max(0, stack.length - DIR_BATCH));
    const listed = await Promise.all(
      dirs.map((dir) =>
        readdir(dir, { withFileTypes: true }).then(
          (entries) => ({ dir, entries }),
          (error: unknown) => {
            if (accessError(error)) options.onDenied?.(dir);
            return { dir, entries: [] as Dirent[] };
          },
        ),
      ),
    );
    const files: string[] = [];
    for (const { dir, entries } of listed) {
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const path = join(dir, entry.name);
        if (!reportOnly && denied(path, places, deny)) continue;
        if (entry.isDirectory()) stack.push(path);
        else if (entry.isFile()) files.push(path);
      }
    }
    for (let index = 0; index < files.length; index += STAT_BATCH) {
      if (signal?.aborted) return;
      const batch = files.slice(index, index + STAT_BATCH);
      const stats = await Promise.all(batch.map((path) => lstat(path).catch(() => null)));
      for (let k = 0; k < batch.length; k++) {
        const stat = stats[k];
        if (!stat) options.onStatError?.(batch[k]!);
        else if (stat.isFile() && (reportOnly || stat.nlink === 1)) yield { path: batch[k]!, stat };
      }
    }
  }
}
