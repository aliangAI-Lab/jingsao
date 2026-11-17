/**
 * 直接删除（普通权限的那部分）：逐个复核身份再删，被占用、无权限、扫描后有变化的文件跳过并计数，不算失败。
 *
 * 不进回收站、不进暂存区。复核由 safety.inspectCandidate 完成：路径仍在规则允许的根目录下、
 * 不是联接 / 符号链接、单一硬链接、大小与修改时间（以及文件编号）和扫描时一致、年龄满足规则。
 * 只删文件，不删目录。需要管理员权限的候选不在这里删，交给 ./elevated 的提权子进程整批处理。
 * @module jingsao/src/host/clean/delete/remove
 */
import fs from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { inspectCandidate, type CleanPlaces, type DenyOptions } from '../safety.ts';
import type { CleanFeature, CleanProgress } from '../types.ts';
import type { DeleteCandidate, DeleteTally, SkipReason } from './types.ts';

/** 动手时复核过的祖先目录可以信多久（毫秒）。 */
const VERIFIED_TTL_MS = 1000;

/** 删除选项。 */
export interface RemoveOptions {
  feature: CleanFeature;
  signal?: AbortSignal;
  onProgress?: (progress: CleanProgress) => void;
  /** 安全闸放行范围（微信QQ、重复文件放行用户目录；垃圾清理不放行）。 */
  deny?: DenyOptions;
  /** 真正删文件的那一步（测试注入，用来模拟被占用）；缺省 fs.unlinkSync。 */
  unlink?: (path: string) => void;
  /** 进度里已经处理过的文件数与字节（提权部分先跑时接着往上加）。 */
  startFiles?: number;
  startBytes?: number;
  /** 进度条总量（预计处理字节）。 */
  totalBytes?: number;
}

/** 删除结果：按分类计数，另给跳过原因的小计。 */
export interface RemoveOutcome {
  perCategory: Map<string, DeleteTally>;
  files: number;
  bytes: number;
  skipped: number;
  reasons: Record<SkipReason, number>;
  cancelled: boolean;
}

/** 错误 → 跳过原因。 */
export function skipReason(error: unknown): SkipReason {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') return 'gone';
  if (code === 'EBUSY' || code === 'EPERM') return 'busy';
  if (code === 'EACCES') return 'denied';
  return 'changed';
}

/** 只读属性的文件 unlink 会报 EPERM：去掉只读再试一次（反正马上要删）。 */
function unlinkReadOnly(path: string, unlink: (path: string) => void): void {
  try {
    unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    const stat = fs.lstatSync(path);
    if (stat.mode & 0o200) throw error;
    fs.chmodSync(path, 0o666);
    unlink(path);
  }
}

/** 按分类累加。 */
function tallyOf(map: Map<string, DeleteTally>, categoryId: string): DeleteTally {
  let tally = map.get(categoryId);
  if (!tally) {
    tally = { files: 0, bytes: 0, skipped: 0 };
    map.set(categoryId, tally);
  }
  return tally;
}

/**
 * 逐个复核并删除。取消只在文件之间生效：已经删掉的不会回来，剩下的原样保留。
 * @param items - 本进程保存的候选（路径来自扫描，不来自页面）。
 * @param places - 位置表（测试模式下所有位置都在测试根里）。
 */
export async function removeCandidates(
  items: readonly DeleteCandidate[],
  places: CleanPlaces,
  options: RemoveOptions,
): Promise<RemoveOutcome> {
  if (places.readOnly) throw new Error('当前为只读模式');
  const unlink = options.unlink ?? ((path: string) => fs.unlinkSync(path));
  const outcome: RemoveOutcome = {
    perCategory: new Map(),
    files: 0,
    bytes: 0,
    skipped: 0,
    reasons: { busy: 0, denied: 0, changed: 0, gone: 0 },
    cancelled: false,
  };
  let processed = options.startFiles ?? 0;
  let doneBytes = options.startBytes ?? 0;
  const report = (phase: CleanProgress['phase'], current?: string): void =>
    options.onProgress?.({
      feature: options.feature,
      phase,
      files: processed,
      bytes: doneBytes,
      ...(options.totalBytes ? { totalBytes: options.totalBytes } : {}),
      ...(current ? { current } : {}),
    });
  // 同一目录下成百上千个文件不必每个都把祖先目录逐级重查一遍；复核过的目录只信 1 秒，过期整体重查
  const verified = new Set<string>();
  let verifiedAt = Date.now();
  for (const item of items) {
    if (options.signal?.aborted) {
      outcome.cancelled = true;
      break;
    }
    if (Date.now() - verifiedAt > VERIFIED_TTL_MS) {
      verified.clear();
      verifiedAt = Date.now();
    }
    const tally = tallyOf(outcome.perCategory, item.categoryId);
    try {
      const identity = inspectCandidate(item.path, places, {
        verified,
        ...options.deny,
        ...(item.systemRoot ? { systemRoots: [item.systemRoot] } : {}),
        ...(item.root ? { root: item.root } : {}),
        ...(item.ageDays ? { ageDays: item.ageDays } : {}),
        ...(item.minAgeHours ? { minAgeHours: item.minAgeHours } : {}),
        previous: item.identity,
      });
      unlinkReadOnly(item.path, unlink);
      tally.files++;
      tally.bytes += identity.size;
      outcome.files++;
      outcome.bytes += identity.size;
    } catch (error) {
      tally.skipped++;
      outcome.skipped++;
      outcome.reasons[skipReason(error)]++;
    }
    processed++;
    doneBytes += item.identity.size;
    if (processed % 32 === 0) {
      report('working', item.path);
      await setImmediate();
    }
  }
  report(outcome.cancelled ? 'cancelled' : 'working');
  return outcome;
}
