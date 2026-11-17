/**
 * 上个版本暂存区的遗留数据：这一版清理改为直接删除、去掉了暂存区，但老用户的数据目录里可能还躺着
 * 上次「放进暂存区」却没有彻底释放的文件。启动时检测一次，面板顶部提示，用户二选一：
 * - 彻底删除（purge）：删掉暂存的文件与批次目录；
 * - 原样放回（restore）：按旧日志把文件挪回原路径；原路径已有同名文件时放在旁边，名字加「（鲸扫放回）」，绝不覆盖。
 * 两种处理完暂存目录都会清空，之后不再提示。
 *
 * 只读旧版日志（journal.jsonl）里自己需要的字段：原路径、暂存路径、身份、状态。
 * 暂存路径必须落在旧暂存区（或其它盘根下的 .jingsao-staging）的本批次目录里，否则不碰；
 * 不跟随联接；测试模式下一切都在测试根里。
 * @module jingsao/src/host/clean/delete/legacy
 */
import fs from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { noLinks, STAGING_DIR_NAME, within, type CleanPlaces } from '../safety.ts';

/** 旧版批次目录名（UUID）。 */
const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 旧版里还没处理完的状态（文件仍在暂存区）。 */
const PENDING = new Set(['intent', 'staged', 'restore-intent', 'purge-intent']);

/** 一个还在暂存区里的文件。 */
export interface LegacyEntry {
  batchId: string;
  /** 原路径。 */
  path: string;
  /** 现在所在的暂存路径。 */
  stagedPath: string;
  size: number;
}

/** 遗留数据摘要（面板顶部提示用）。 */
export interface LegacySummary {
  files: number;
  bytes: number;
}

/** 处理结果。 */
export interface LegacyOutcome {
  files: number;
  bytes: number;
  /** 没能处理的文件数（被占用、没权限……），留在原处。 */
  failed: number;
  /** 放回时原路径已有同名文件、改名放在旁边的个数。 */
  renamed: number;
}

/** 暂存路径是否落在本批次的暂存目录里（旧暂存区，或某个盘根下的 .jingsao-staging）。 */
function stagedInside(places: CleanPlaces, batchId: string, stagedPath: string): boolean {
  if (within(join(places.legacyStaging, batchId), stagedPath)) return true;
  const segments = resolve(stagedPath).split(sep);
  const index = segments.findIndex((part) => part.toLowerCase() === STAGING_DIR_NAME);
  return index > 0 && segments[index + 1] === batchId && (!places.test || within(places.test, stagedPath));
}

/** 读一个批次的日志：同一 entryId 以最后一行为准。坏行跳过（这里只为找回文件，不做严格校验）。 */
function readBatch(places: CleanPlaces, batchId: string): LegacyEntry[] {
  const file = join(places.legacyStaging, batchId, 'journal.jsonl');
  let text: string;
  try {
    noLinks(file);
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const latest = new Map<string, { path: string; stagedPath: string; size: number; status: string }>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        entry?: {
          entryId?: unknown;
          path?: unknown;
          stagedPath?: unknown;
          status?: unknown;
          identity?: { size?: unknown };
        };
      };
      const entry = event.entry;
      if (!entry || typeof entry.entryId !== 'string' || typeof entry.path !== 'string') continue;
      if (typeof entry.stagedPath !== 'string' || typeof entry.status !== 'string') continue;
      latest.set(entry.entryId, {
        path: entry.path,
        stagedPath: entry.stagedPath,
        size: Number(entry.identity?.size) || 0,
        status: entry.status,
      });
    } catch {
      /* 断电留下的半行 */
    }
  }
  const out: LegacyEntry[] = [];
  for (const entry of latest.values()) {
    if (!PENDING.has(entry.status) || !stagedInside(places, batchId, entry.stagedPath)) continue;
    try {
      noLinks(entry.stagedPath);
      if (!fs.lstatSync(entry.stagedPath).isFile()) continue;
    } catch {
      continue;
    }
    out.push({ batchId, path: entry.path, stagedPath: entry.stagedPath, size: entry.size });
  }
  return out;
}

/** 旧暂存区里的批次编号。 */
function batchIds(places: CleanPlaces): string[] {
  try {
    noLinks(places.legacyStaging);
    return fs.readdirSync(places.legacyStaging).filter((name) => BATCH_ID.test(name));
  } catch {
    return [];
  }
}

/** 列出全部还在暂存区里的文件。 */
export function listLegacy(places: CleanPlaces): LegacyEntry[] {
  return batchIds(places).flatMap((id) => readBatch(places, id));
}

/** 摘要：没有遗留文件时返回 null（面板不提示）。 */
export function legacySummary(places: CleanPlaces): LegacySummary | null {
  const entries = listLegacy(places);
  if (!entries.length) {
    // 只剩空壳（日志、锁文件）：顺手清掉，免得以后每次启动都去读
    if (batchIds(places).length) cleanupShell(places);
    return null;
  }
  return { files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
}

/** 删掉暂存区的空壳：批次目录（日志、空目录）与其它盘上的本批次目录；还有文件的批次保留。 */
function cleanupShell(places: CleanPlaces): void {
  for (const id of batchIds(places)) {
    if (readBatch(places, id).length) continue;
    const dir = join(places.legacyStaging, id);
    try {
      noLinks(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 删不掉就留着，不影响功能 */
    }
  }
  try {
    fs.rmSync(join(places.legacyStaging, 'operation.lock'), { force: true });
    if (!fs.readdirSync(places.legacyStaging).length) fs.rmdirSync(places.legacyStaging);
  } catch {
    /* 同上 */
  }
}

/** 从文件往上删空目录，直到（不含）stop。 */
function removeEmptyUp(start: string, stop: string): void {
  let current = start;
  while (within(stop, current) && resolve(current) !== resolve(stop)) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

/** 原路径被占了：在旁边找一个不冲突的名字。 */
function freeName(path: string): string {
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let index = 1; index < 1000; index++) {
    const candidate = `${stem}（鲸扫放回${index === 1 ? '' : ' ' + index}）${ext}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('原位置同名文件太多');
}

/** 暂存路径所在的那个「批次目录」（旧暂存区或其它盘的 .jingsao-staging 下）。 */
function batchDirOf(places: CleanPlaces, entry: LegacyEntry): string {
  if (within(join(places.legacyStaging, entry.batchId), entry.stagedPath))
    return join(places.legacyStaging, entry.batchId);
  const segments = resolve(entry.stagedPath).split(sep);
  const index = segments.findIndex((part) => part.toLowerCase() === STAGING_DIR_NAME);
  return segments.slice(0, index + 2).join(sep);
}

/**
 * 处理全部遗留文件。
 * @param places - 位置表（测试模式下一切都在测试根里）。
 * @param mode - purge = 彻底删除；restore = 原样放回。
 * @param onProgress - 进度回调（已处理文件数、字节、当前文件名）。
 */
export async function settleLegacy(
  places: CleanPlaces,
  mode: 'purge' | 'restore',
  onProgress?: (files: number, bytes: number, current: string) => void,
): Promise<LegacyOutcome> {
  if (places.readOnly) throw new Error('当前为只读模式');
  const outcome: LegacyOutcome = { files: 0, bytes: 0, failed: 0, renamed: 0 };
  const entries = listLegacy(places);
  for (const entry of entries) {
    try {
      noLinks(entry.stagedPath);
      if (mode === 'purge') {
        fs.unlinkSync(entry.stagedPath);
      } else {
        if (places.test && !within(places.test, entry.path)) throw new Error('超出测试目录');
        // 原路径的上级目录可能已被删：按需重建；但不允许经过联接
        noLinks(dirname(entry.path), { allowMissing: true });
        fs.mkdirSync(dirname(entry.path), { recursive: true });
        noLinks(dirname(entry.path));
        let target = entry.path;
        if (fs.existsSync(target)) {
          target = freeName(target);
          outcome.renamed++;
        }
        // 旧版暂存与原路径同盘（暂存只改目录项），这里同样只是改名
        fs.renameSync(entry.stagedPath, target);
      }
      outcome.files++;
      outcome.bytes += entry.size;
      removeEmptyUp(dirname(entry.stagedPath), batchDirOf(places, entry));
    } catch {
      outcome.failed++;
    }
    onProgress?.(outcome.files, outcome.bytes, basename(entry.path));
    if ((outcome.files + outcome.failed) % 32 === 0) await setImmediate();
  }
  // 其它盘上的批次目录（重复文件可能跨盘）：只删空的
  for (const entry of entries) {
    const dir = batchDirOf(places, entry);
    if (!within(places.legacyStaging, dir)) {
      try {
        fs.rmdirSync(dir);
        fs.rmdirSync(dirname(dir));
      } catch {
        /* 还有东西或已删 */
      }
    }
  }
  cleanupShell(places);
  return outcome;
}
