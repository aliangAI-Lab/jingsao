/**
 * 大文件搬家的执行与记录：把用户挑中的大文件搬到别的盘，原位置不留东西，记录可还原。
 *
 * 不负责扫描（归 ./scan）、目标检查规则（归 ./destination）。
 * 每个文件：复核身份 → 流式复制 → 流式比对哈希 → 再复核源文件没变 → 先落盘记录 → 删源文件。
 * 任何一步失败都删掉不完整的目标、源文件原样不动，记一条 failed。
 * 还原反过来：原位置有同名文件就不覆盖、记失败。同一时刻只允许一个操作；只读模式拒绝一切写。
 * @module jingsao/src/host/clean/bigfiles/store
 */
import { lstat, mkdir, unlink, utimes } from 'node:fs/promises';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import type { CleanProgress, MoveRecord } from '../types.ts';
import { denied, diskSpace, errorText, inspectCandidate, noLinks, within, type CleanPlaces } from '../safety.ts';
import { copyWithHash, hashFile, pathExists, removeEmptyParents, uniquePath } from './copy.ts';
import { checkDestination, DEST_RESERVE_BYTES, MOVE_DIR_NAME } from './destination.ts';
import { RecordFile } from './records.ts';
import type { BigFileCandidate } from './scan.ts';

/** 大文件在目标下的子目录名。 */
export const BIG_FILE_DIR_NAME = '大文件';

/** 构造入参。 */
export interface MoveStoreOptions {
  places: CleanPlaces;
  /** 记录 JSON 的绝对路径（父目录不存在时自动创建）。 */
  file: string;
  /** 时间源；测试注入固定时钟。 */
  now?: () => number;
}

/** 搬家 / 还原的运行选项。 */
export interface MoveRunOptions {
  signal?: AbortSignal;
  onProgress?: (p: CleanProgress) => void;
}

/** 源文件在目标里的相对路径：用户目录里的保留相对结构，其余放进「其他位置」。 */
function relativeTarget(path: string, places: CleanPlaces): string {
  if (within(places.home, path)) return relative(places.home, path);
  const base = within(places.drive, path) ? places.drive : parse(path).root;
  return join('其他位置', relative(base, path));
}

/** 从目标路径里找回「…\鲸扫搬家\大文件」这一级，用于还原后清理空目录；找不到返回 null。 */
function moveBaseOf(target: string): string | null {
  const parts = resolve(target).split(sep);
  for (let i = parts.length - 2; i >= 1; i -= 1) {
    if (parts[i] === MOVE_DIR_NAME && parts[i + 1] === BIG_FILE_DIR_NAME) return parts.slice(0, i + 2).join(sep);
  }
  return null;
}

export class MoveStore {
  declare private readonly places: CleanPlaces;
  declare private readonly records: RecordFile;
  declare private readonly now: () => number;
  /** 正在搬或正在还原。 */
  declare private busy: boolean;
  /** 同一毫秒内多条记录的序号。 */
  declare private seq: number;

  constructor(options: MoveStoreOptions) {
    this.places = options.places;
    this.records = new RecordFile(options.file);
    this.now = options.now ?? (() => Date.now());
    this.busy = false;
    this.seq = 0;
  }

  /** 全部搬家记录（新的在前）。 */
  history(): MoveRecord[] {
    return this.records.list();
  }

  /**
   * 把选中的大文件搬到 destRoot\鲸扫搬家\大文件\ 下（保留相对用户目录的结构）。
   * 目标不可用、正忙、只读模式时直接抛错（什么都没动）；单个文件失败记 failed 并继续下一个；
   * 取消后不再处理剩下的文件。
   *
   * @returns 本次处理过的每个文件的记录。
   */
  async moveFiles(
    candidates: BigFileCandidate[],
    destRoot: string,
    options: MoveRunOptions = {},
  ): Promise<MoveRecord[]> {
    return this.exclusive(async () => {
      if (candidates.length === 0) return [];
      const totalBytes = candidates.reduce((sum, item) => sum + item.identity.size, 0);
      const reason = checkDestination(destRoot, this.places, totalBytes);
      if (reason) throw new Error(reason);
      const base = join(resolve(destRoot), MOVE_DIR_NAME, BIG_FILE_DIR_NAME);
      const progress = { files: 0, bytes: 0 };
      const report = (phase: CleanProgress['phase'], current?: string): void =>
        options.onProgress?.({
          feature: 'bigfiles',
          phase,
          current,
          files: progress.files,
          bytes: progress.bytes,
          totalFiles: candidates.length,
          totalBytes,
        });
      const results: MoveRecord[] = [];
      for (const candidate of candidates) {
        if (options.signal?.aborted) break;
        report('working', candidate.path);
        results.push(await this.moveOne(candidate, base, options.signal, (delta) => (progress.bytes += delta)));
        progress.files += 1;
      }
      report(options.signal?.aborted ? 'cancelled' : 'done');
      return results;
    });
  }

  /**
   * 按记录把文件搬回原位。只处理 bigfiles 且状态为 moved 的记录，其余 id 跳过。
   * 失败的记录保持 moved（文件还在新位置）并带上 error。
   *
   * @returns 处理过的记录的最新状态。
   */
  async restore(recordIds: string[], options: MoveRunOptions = {}): Promise<MoveRecord[]> {
    return this.exclusive(async () => {
      const records = recordIds
        .map((id) => this.records.get(id))
        .filter(
          (record): record is MoveRecord => !!record && record.feature === 'bigfiles' && record.state === 'moved',
        );
      const totalBytes = records.reduce((sum, record) => sum + record.size, 0);
      const progress = { files: 0, bytes: 0 };
      const results: MoveRecord[] = [];
      for (const record of records) {
        if (options.signal?.aborted) break;
        options.onProgress?.({
          feature: 'bigfiles',
          phase: 'working',
          current: record.to,
          ...progress,
          totalFiles: records.length,
          totalBytes,
        });
        results.push(await this.restoreOne(record, options.signal, (delta) => (progress.bytes += delta)));
        progress.files += 1;
      }
      options.onProgress?.({
        feature: 'bigfiles',
        phase: options.signal?.aborted ? 'cancelled' : 'done',
        ...progress,
        totalFiles: records.length,
        totalBytes,
      });
      return results;
    });
  }

  /** 互斥执行：只读模式与正忙时拒绝。 */
  private async exclusive<T>(task: () => Promise<T>): Promise<T> {
    if (this.places.readOnly) throw new Error('当前是只读模式，不会改动任何文件');
    if (this.busy) throw new Error('上一个搬家操作还没结束');
    this.busy = true;
    try {
      return await task();
    } finally {
      this.busy = false;
    }
  }

  private newId(at: number): string {
    this.seq += 1;
    return `mv-${at.toString(36)}-${this.seq.toString(36)}`;
  }

  /** 搬一个文件；失败不抛，返回 failed 记录。 */
  private async moveOne(
    candidate: BigFileCandidate,
    base: string,
    signal: AbortSignal | undefined,
    onBytes: (delta: number) => void,
  ): Promise<MoveRecord> {
    const at = this.now();
    const record: MoveRecord = {
      id: this.newId(at),
      feature: 'bigfiles',
      name: basename(candidate.path),
      from: candidate.path,
      to: '',
      size: candidate.identity.size,
      movedAt: at,
      mode: 'moved',
      state: 'moved',
    };
    let copied = false;
    try {
      inspectCandidate(candidate.path, this.places, { allowUserData: true, previous: candidate.identity });
      const target = uniquePath(join(base, relativeTarget(candidate.path, this.places)));
      record.to = target;
      await mkdir(dirname(target), { recursive: true });
      noLinks(dirname(target));
      const sourceHash = await copyWithHash(candidate.path, target, { signal, onBytes });
      copied = true;
      await utimes(target, Date.now() / 1000, candidate.identity.mtimeMs / 1000);
      if ((await hashFile(target, signal)) !== sourceHash) throw new Error('复制后校验不一致');
      // 复制期间源文件被改过（大小、时间、身份任一变化）就不删源。
      inspectCandidate(candidate.path, this.places, { allowUserData: true, previous: candidate.identity });
      // 先落盘记录再删源：中途断电最多留两份，不会出现「没记录的搬家」。
      await this.records.put(record);
      try {
        await unlink(candidate.path);
      } catch (error) {
        await unlink(target).catch(() => undefined);
        const failed: MoveRecord = { ...record, state: 'failed', error: `原文件删不掉：${errorText(error)}` };
        await this.records.put(failed);
        return failed;
      }
      return { ...record };
    } catch (error) {
      if (copied && record.to) await unlink(record.to).catch(() => undefined);
      const failed: MoveRecord = {
        ...record,
        state: 'failed',
        error: signal?.aborted ? '已取消' : errorText(error),
      };
      await this.records.put(failed);
      return failed;
    }
  }

  /** 还原一个文件；失败不抛，返回带 error 的记录（状态仍是 moved）。 */
  private async restoreOne(
    record: MoveRecord,
    signal: AbortSignal | undefined,
    onBytes: (delta: number) => void,
  ): Promise<MoveRecord> {
    let copied = false;
    try {
      const reason = denied(record.from, this.places, { allowUserData: true });
      if (reason) throw new Error(reason);
      if (pathExists(record.from)) throw new Error('原位置已有同名文件，没有覆盖');
      const before = await lstat(record.to).catch(() => null);
      if (!before || !before.isFile()) throw new Error('搬过去的文件不见了');
      noLinks(record.to);
      const { free } = diskSpace(this.places.drive);
      if (free !== null && free < before.size + DEST_RESERVE_BYTES) throw new Error('C 盘空间不够，放不回去');
      await mkdir(dirname(record.from), { recursive: true });
      noLinks(dirname(record.from));
      const sourceHash = await copyWithHash(record.to, record.from, { signal, onBytes });
      copied = true;
      await utimes(record.from, Date.now() / 1000, before.mtimeMs / 1000);
      if ((await hashFile(record.from, signal)) !== sourceHash) throw new Error('复制后校验不一致');
      const after = await lstat(record.to);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('文件在还原过程中被改动了');
      const restored: MoveRecord = { ...record, state: 'restored', size: before.size };
      delete restored.error;
      try {
        await unlink(record.to);
        const stop = moveBaseOf(record.to);
        if (stop) await removeEmptyParents(dirname(record.to), stop);
      } catch (error) {
        restored.error = `文件已放回原位，但新位置的副本没删掉：${errorText(error)}`;
      }
      await this.records.put(restored);
      return restored;
    } catch (error) {
      if (copied) await unlink(record.from).catch(() => undefined);
      const failed: MoveRecord = { ...record, error: `还原失败：${signal?.aborted ? '已取消' : errorText(error)}` };
      await this.records.put(failed);
      return failed;
    }
  }
}
