/**
 * 重复文件扫描：在用户自己的文件夹里找内容完全相同的文件，每组建议保留一份。
 *
 * 只读，不负责删除（删除走 ../delete 的直接删除流程）。算法参考 Czkawka：先按大小分组，
 * 再比头尾各 16KB 的部分哈希，最后流式全量 sha256 确认；每一步都丢掉落单的，哈希只算真正可能重复的文件。
 * 遍历规则（去哪找、哪些不碰）与大文件搬家共用 ../bigfiles/walk：不进 AppData、聊天数据、隐藏目录，
 * 不列程序与库文件，不列共享硬链接（删一份省不出空间）。
 * @module jingsao/src/host/clean/duplicates/scan
 */
import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename, parse } from 'node:path';
import {
  MAX_ITEMS_PER_CATEGORY,
  type CleanCategory,
  type CleanItem,
  type CleanProgress,
  type CleanScanResult,
} from '../types.ts';
import type { CleanPlaces } from '../safety.ts';
import type { DeleteCandidate } from '../delete/types.ts';
import { hashFile } from '../bigfiles/copy.ts';
import { defaultUserRoots, formatBytes, walkUserFiles, type FileType, type WalkedFile } from '../bigfiles/walk.ts';

/** 默认大小下限：1 MB。 */
export const DUPLICATE_MIN_SIZE = 1024 * 1024;
/** 默认最多给页面的组数。 */
export const DUPLICATE_MAX_GROUPS = 300;
/** 部分哈希读头尾各多少字节。 */
export const PARTIAL_BYTES = 16 * 1024;
/** 同时哈希的文件数。 */
const HASH_CONCURRENCY = 4;

/** 扫描选项。 */
export interface DuplicateScanOptions {
  /** 扫描根；缺省用用户主目录下的个人文件夹。在系统盘以外的根会自动放开「其他盘」。 */
  roots?: string[];
  /** 大小下限（字节），默认 1 MB。 */
  minSize?: number;
  signal?: AbortSignal;
  onProgress?: (p: CleanProgress) => void;
  /** 最多给页面的组数（按浪费的空间降序），默认 300。 */
  maxGroups?: number;
}

/** 一个重复文件候选：直接沿用删除流程的 DeleteCandidate。 */
export type DupCandidate = DeleteCandidate;

/** 重复组的类型名（页面二级标题）。 */
const GROUP_LABEL: Record<FileType, string> = {
  installer: '安装包',
  archive: '压缩包',
  video: '视频',
  audio: '音频',
  image: '图片',
  document: '文档',
  other: '其他',
};

/** 部分哈希：头尾各 PARTIAL_BYTES；文件不大于两段之和时就是全量内容的哈希。 */
export async function partialHash(path: string, size: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const hash = createHash('sha256');
    const read = async (position: number, length: number): Promise<void> => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      hash.update(buffer.subarray(0, bytesRead));
    };
    if (size <= PARTIAL_BYTES * 2) {
      await read(0, size);
    } else {
      await read(0, PARTIAL_BYTES);
      await read(size - PARTIAL_BYTES, PARTIAL_BYTES);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** 限并发地对每一项跑 fn；fn 抛错的项结果为 null（读不了的文件当作不重复）。取消时抛出。 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array<R | null>(items.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index]!);
      } catch {
        signal?.throwIfAborted();
        results[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 按 key 分组，只留不少于两个成员的组。 */
function groupBy<T>(items: T[], key: (item: T) => string | null): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return [...map.values()].filter((list) => list.length > 1);
}

/** 建议保留的那份：修改时间最早；一样早取路径最短；再一样取字典序靠前。 */
function keeperOf(files: WalkedFile[]): WalkedFile {
  return [...files].sort(
    (a, b) => a.identity.mtimeMs - b.identity.mtimeMs || a.path.length - b.path.length || a.path.localeCompare(b.path),
  )[0]!;
}

/**
 * 扫描重复文件。
 *
 * @returns result 给页面；candidates 留在宿主侧按 id 取；groups 是组 id → 组内全部（列出的）item id，
 *   用 {@link checkDuplicateSelection} 保证每组至少留一份。
 */
export async function scanDuplicates(
  places: CleanPlaces,
  options: DuplicateScanOptions = {},
): Promise<{ result: CleanScanResult; candidates: Map<string, DupCandidate>; groups: Map<string, string[]> }> {
  const startedAt = Date.now();
  const scanId = `duplicates-${startedAt.toString(36)}-${randomUUID().slice(0, 8)}`;
  const { signal } = options;
  const minSize = Math.max(1, options.minSize ?? DUPLICATE_MIN_SIZE);
  const report = (progress: Omit<CleanProgress, 'feature'>): void =>
    options.onProgress?.({ feature: 'duplicates', ...progress });
  try {
    const roots = options.roots ?? (await defaultUserRoots(places));
    const allowOtherDrives =
      !places.test && roots.some((root) => parse(root).root.toLowerCase() !== parse(places.drive).root.toLowerCase());
    const files: WalkedFile[] = [];
    await walkUserFiles(
      roots,
      places,
      {
        minSize,
        signal,
        allowOtherDrives,
        onDir: (dir, seen) => report({ phase: 'scanning', current: dir, files: seen, bytes: 0 }),
      },
      (file) => files.push(file),
    );

    // 第一步：按大小分组。
    const sameSize = groupBy(files, (file) => String(file.identity.size)).flat();
    // 第二步：部分哈希；第三步：全量哈希。两步共用一个进度（文件数与字节数）。
    const needFull = (file: WalkedFile): boolean => file.identity.size > PARTIAL_BYTES * 2;
    let hashedFiles = 0;
    let hashedBytes = 0;
    const totalFiles = sameSize.length * 2;
    const totalBytes = sameSize.reduce(
      (sum, file) => sum + Math.min(file.identity.size, PARTIAL_BYTES * 2) + (needFull(file) ? file.identity.size : 0),
      0,
    );
    const step = async <R>(file: WalkedFile, bytes: number, work: () => Promise<R>): Promise<R> => {
      try {
        return await work();
      } finally {
        hashedFiles += 1;
        hashedBytes += bytes;
        report({
          phase: 'scanning',
          current: file.path,
          files: hashedFiles,
          bytes: hashedBytes,
          totalFiles,
          totalBytes,
        });
      }
    };
    const partials = await mapPool(
      sameSize,
      HASH_CONCURRENCY,
      (file) =>
        step(file, Math.min(file.identity.size, PARTIAL_BYTES * 2), () => partialHash(file.path, file.identity.size)),
      signal,
    );
    const partialKey = new Map(sameSize.map((file, index) => [file, partials[index]]));
    const samePartial = groupBy(sameSize, (file) => {
      const value = partialKey.get(file);
      return value ? `${file.identity.size}:${value}` : null;
    }).flat();
    const fulls = await mapPool(
      samePartial,
      HASH_CONCURRENCY,
      (file) =>
        step(file, needFull(file) ? file.identity.size : 0, async () =>
          needFull(file) ? hashFile(file.path, signal) : partialKey.get(file)!,
        ),
      signal,
    );
    const fullKey = new Map(samePartial.map((file, index) => [file, fulls[index]]));
    const duplicates = groupBy(samePartial, (file) => {
      const value = fullKey.get(file);
      return value ? `${file.identity.size}:${value}` : null;
    });

    // 组装：按浪费的字节降序，最多 maxGroups 组。
    const ranked = duplicates
      .map((group) => ({ group, hash: fullKey.get(group[0]!)!, wasted: group[0]!.identity.size * (group.length - 1) }))
      .sort((a, b) => b.wasted - a.wasted || a.group[0]!.path.localeCompare(b.group[0]!.path))
      .slice(0, options.maxGroups ?? DUPLICATE_MAX_GROUPS);
    const candidates = new Map<string, DupCandidate>();
    const groups = new Map<string, string[]>();
    const categories: CleanCategory[] = [];
    let seq = 0;
    for (const { group, hash, wasted } of ranked) {
      const categoryId = `dup-${hash.slice(0, 16)}`;
      const keeper = keeperOf(group);
      const ordered = [keeper, ...group.filter((file) => file !== keeper).sort((a, b) => a.path.localeCompare(b.path))];
      const items: CleanItem[] = ordered.slice(0, MAX_ITEMS_PER_CATEGORY).map((file) => {
        seq += 1;
        const id = `${scanId}-${seq.toString(36)}`;
        candidates.set(id, { id, path: file.path, identity: file.identity, categoryId });
        const item: CleanItem = {
          id,
          path: file.path,
          size: file.identity.size,
          mtimeMs: file.identity.mtimeMs,
          selected: file !== keeper,
        };
        if (file === keeper) item.note = '建议保留';
        return item;
      });
      groups.set(
        categoryId,
        items.map((item) => item.id),
      );
      const total = group[0]!.identity.size * group.length;
      categories.push({
        id: categoryId,
        label: basename(keeper.path),
        tier: 'cost',
        explanation: `${group.length} 份完全相同，占用 ${formatBytes(total)}（留一份可省 ${formatBytes(wasted)}）`,
        bytes: total,
        count: group.length,
        items,
        group: GROUP_LABEL[keeper.type],
      });
    }
    const freeable = ranked.reduce((sum, item) => sum + item.wasted, 0);
    report({ phase: 'done', files: hashedFiles, bytes: hashedBytes, totalFiles, totalBytes });
    return {
      result: { feature: 'duplicates', scanId, startedAt, finishedAt: Date.now(), categories, totalBytes: freeable },
      candidates,
      groups,
    };
  } catch (error) {
    if (signal?.aborted) report({ phase: 'cancelled', files: 0, bytes: 0 });
    else report({ phase: 'error', files: 0, bytes: 0, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * 检查一次删除选择：选了本次扫描以外的 id，或有任何一组被全选，就返回原因；可以删返回 null。
 */
export function checkDuplicateSelection(groups: Map<string, string[]>, selectedIds: string[]): string | null {
  const selected = new Set(selectedIds);
  const known = new Set([...groups.values()].flat());
  if (selectedIds.some((id) => !known.has(id))) return '选中的文件不在这次扫描结果里，请重新扫描';
  for (const ids of groups.values()) {
    if (ids.length > 0 && ids.every((id) => selected.has(id))) return '有一组重复文件被全部选中了，每组至少要留一份';
  }
  return null;
}
