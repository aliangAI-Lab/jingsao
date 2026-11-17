/**
 * 跨盘搬文件的底层动作：流式复制（边复制边算源哈希）、流式算哈希、避开重名、清理空目录。
 *
 * 不负责决定搬什么、记录怎么写（归 ./store 与 ../software/mover）。
 * 大文件绝不整个读进内存：一律走流，内存占用与文件大小无关。
 * 写目标一律用 wx（目标已存在就失败），所以这里永远不会覆盖任何已有文件。
 * @module jingsao/src/host/clean/bigfiles/copy
 */
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync } from 'node:fs';
import { open, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { within } from '../safety.ts';

/** 复制选项。 */
export interface CopyOptions {
  signal?: AbortSignal;
  /** 每写一块回调一次（字节数增量）。 */
  onBytes?: (delta: number) => void;
}

/**
 * 把 src 流式复制到 dest（dest 必须不存在），同时算出源数据的 sha256。
 * 失败时删掉自己建出来的不完整目标；dest 原本就存在时直接失败，不碰它。
 *
 * @returns 源数据的 sha256（十六进制）。
 */
export async function copyWithHash(src: string, dest: string, options: CopyOptions = {}): Promise<string> {
  const hash = createHash('sha256');
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      options.onBytes?.(chunk.length);
      callback(null, chunk);
    },
  });
  options.signal?.throwIfAborted();
  // 先单独以 wx 打开：成功了才算「目标是我建的」，失败清理时才敢删。
  const handle = await open(dest, 'wx');
  try {
    await pipeline(readable(src), tap as unknown as NodeJS.ReadWriteStream, handle.createWriteStream(), {
      signal: options.signal,
    });
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(dest).catch(() => undefined);
    throw error;
  }
  return hash.digest('hex');
}

/** 流式算一个文件的 sha256（十六进制）。 */
export async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(readable(path), sink, { signal });
  return hash.digest('hex');
}

/**
 * 文件读流。项目的 lib 是 ES2020，@types/node 的 ReadStream 异步迭代器类型与之对不上，
 * 这里按 NodeJS.ReadableStream 交给 pipeline（运行时就是同一个对象）。
 */
function readable(path: string): NodeJS.ReadableStream {
  return createReadStream(path) as unknown as NodeJS.ReadableStream;
}

/** 路径（含链接本身）是否存在。 */
export function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** 目标已存在时加「 (1)」「 (2)」……后缀，返回第一个不存在的路径。 */
export function uniquePath(path: string): string {
  if (!pathExists(path)) return path;
  const ext = extname(path);
  const stem = basename(path, ext);
  for (let n = 1; ; n += 1) {
    const candidate = join(dirname(path), `${stem} (${n})${ext}`);
    if (!pathExists(candidate)) return candidate;
  }
}

/** 从 start 往上逐级删空目录，直到 stop（不含 stop）；遇到非空目录就停。尽力而为，不抛错。 */
export async function removeEmptyParents(start: string, stop: string): Promise<void> {
  let current = resolve(start);
  while (within(stop, current) && resolve(stop).toLowerCase() !== current.toLowerCase()) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}
