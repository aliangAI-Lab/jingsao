/**
 * 目录树的遍历、复制与校验（软件搬家用）。
 *
 * 不负责决定搬哪个目录、何时回滚（归 ./mover）。遍历不跟随链接：树里出现任何链接或联接都单独列出，
 * 由调用方拒绝搬（复制链接语义复杂，搬错了可能把别处的数据一并删掉）。
 * 复制逐个文件走流（不把大文件读进内存）、保留修改时间；校验比对文件清单与每个文件的大小，
 * 并抽样比对哈希（哈希在复制时顺带算好，抽样只需重读目标）。
 * @module jingsao/src/host/clean/software/tree
 */
import { lstat, mkdir, readdir, utimes } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { copyWithHash, hashFile, type CopyOptions } from '../bigfiles/copy.ts';

/** 树里的一个文件。 */
export interface TreeFile {
  /** 相对树根的路径。 */
  rel: string;
  size: number;
  mtimeMs: number;
}

/** 一次遍历的结果。 */
export interface TreeScan {
  files: TreeFile[];
  /** 子目录（相对路径，父目录在前）及其修改时间。 */
  dirs: Array<{ rel: string; mtimeMs: number }>;
  /** 树里的链接或联接（相对路径）。 */
  links: string[];
  bytes: number;
  /** false = 到了截止时间提前停下，bytes 只是下限。 */
  complete: boolean;
}

/** 遍历选项。 */
export interface TreeScanOptions {
  signal?: AbortSignal;
  /** 截止时间（epoch 毫秒）；到点就停，complete = false。 */
  deadline?: number;
  /** false = 只算大小，不收集文件清单（列表统计用，省内存）。 */
  collect?: boolean;
  /** true = 读不了的目录跳过并把 complete 记为 false（列表统计用）；默认直接抛错。 */
  tolerant?: boolean;
}

/** 只读遍历目录树，不跟随链接。 */
export async function scanTree(root: string, options: TreeScanOptions = {}): Promise<TreeScan> {
  const collect = options.collect ?? true;
  const result: TreeScan = { files: [], dirs: [], links: [], bytes: 0, complete: true };
  const stack = [root];
  let count = 0;
  while (stack.length > 0) {
    options.signal?.throwIfAborted();
    if (options.deadline !== undefined && Date.now() > options.deadline) {
      result.complete = false;
      break;
    }
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (!options.tolerant) throw error;
      result.complete = false;
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isSymbolicLink()) {
        result.links.push(rel);
        continue;
      }
      const stat = await lstat(full).catch((error: unknown) => {
        if (!options.tolerant) throw error;
        result.complete = false;
        return null;
      });
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        result.links.push(rel);
      } else if (stat.isDirectory()) {
        if (collect) result.dirs.push({ rel, mtimeMs: stat.mtimeMs });
        stack.push(full);
      } else if (stat.isFile()) {
        result.bytes += stat.size;
        if (collect) result.files.push({ rel, size: stat.size, mtimeMs: stat.mtimeMs });
      }
      count += 1;
      if (count % 500 === 0) await yieldLoop();
    }
  }
  result.dirs.sort((a, b) => a.rel.split(sep).length - b.rel.split(sep).length || a.rel.localeCompare(b.rel));
  return result;
}

/** 复制单个文件的函数（可注入，测试用来模拟复制中途出错）。 */
export type CopyFileFn = (src: string, dest: string, options: CopyOptions) => Promise<string>;

/**
 * 按遍历结果把 src 树复制进已存在的空目录 dest，保留文件与目录的修改时间。
 *
 * @returns 每个文件（相对路径）的源 sha256。
 */
export async function copyTree(
  src: string,
  dest: string,
  scan: TreeScan,
  options: CopyOptions & { copyFile?: CopyFileFn } = {},
): Promise<Map<string, string>> {
  const copyFile = options.copyFile ?? copyWithHash;
  for (const dir of scan.dirs) await mkdir(join(dest, dir.rel));
  const hashes = new Map<string, string>();
  for (const file of scan.files) {
    options.signal?.throwIfAborted();
    const target = join(dest, file.rel);
    hashes.set(
      file.rel,
      await copyFile(join(src, file.rel), target, { signal: options.signal, onBytes: options.onBytes }),
    );
    await utimes(target, Date.now() / 1000, file.mtimeMs / 1000);
  }
  // 目录时间最后设（写文件会改目录时间），由深到浅；设不上不算失败。
  for (const dir of [...scan.dirs].reverse()) {
    await utimes(join(dest, dir.rel), Date.now() / 1000, dir.mtimeMs / 1000).catch(() => undefined);
  }
  return hashes;
}

/** 抽样比对哈希的文件数上限。 */
const HASH_SAMPLES = 24;

/**
 * 校验复制结果：文件清单一致、每个文件大小一致，并抽样比对哈希（最大的几个 + 均匀分布的几个）。
 * 不一致时抛出可读原因。
 */
export async function verifyTree(
  dest: string,
  scan: TreeScan,
  hashes: Map<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  const copied = await scanTree(dest, { signal });
  if (copied.links.length > 0) throw new Error('复制结果里出现了链接');
  if (copied.files.length !== scan.files.length) throw new Error('复制后文件数对不上');
  const sizes = new Map(copied.files.map((file) => [file.rel.toLowerCase(), file.size]));
  for (const file of scan.files) {
    if (sizes.get(file.rel.toLowerCase()) !== file.size) throw new Error(`复制后文件大小对不上：${file.rel}`);
  }
  const bySize = [...scan.files].sort((a, b) => b.size - a.size);
  const samples = new Set(bySize.slice(0, HASH_SAMPLES / 2));
  const step = Math.max(1, Math.floor(scan.files.length / (HASH_SAMPLES / 2)));
  for (let i = 0; i < scan.files.length && samples.size < HASH_SAMPLES; i += step) samples.add(scan.files[i]!);
  for (const file of samples) {
    const expected = hashes.get(file.rel);
    if (expected && (await hashFile(join(dest, file.rel), signal)) !== expected)
      throw new Error(`复制后内容对不上：${file.rel}`);
  }
}
