/**
 * 软件搬家的执行与记录：把整个安装目录搬到别的盘，原位置建目录联接（junction），记录可还原。
 *
 * 流程参考 FreeMove / C-Migrate：再查一次是否在运行 → 检查目标 → 复制整个目录树 → 校验 →
 * 原目录改名为 .jingsao-bak → 原路径建联接 → 校验联接 → 删备份。任何一步失败按相反顺序回滚。
 * 原目录父级写不进去（Program Files）时不直接失败，而是生成同样流程的 PowerShell 脚本交给提权执行器。
 * 还原先把文件复制到原位置旁的临时目录，校验后再删联接、换名，中途失败软件仍可用。
 * 不负责列出软件与判定（归 ./list）；记录文件格式与大文件搬家共用（../bigfiles/records）。
 * @module jingsao/src/host/clean/software/mover
 */
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { CleanProgress, MoveRecord, SoftwareEntry } from '../types.ts';
import { denied, diskSpace, errorText, noLinks, type CleanPlaces } from '../safety.ts';
import { copyWithHash, pathExists, removeEmptyParents, uniquePath } from '../bigfiles/copy.ts';
import { checkDestination, DEST_RESERVE_BYTES, MOVE_DIR_NAME } from '../bigfiles/destination.ts';
import { RecordFile } from '../bigfiles/records.ts';
import { evaluateSoftware, mergeInstalled, readContext, runningIn } from './list.ts';
import type { SoftwareProbe } from './probe.ts';
import { buildMoveScript, buildRestoreScript, readElevatedResult, scriptBytes, type ElevatedRunner } from './script.ts';
import { copyTree, scanTree, verifyTree, type CopyFileFn, type TreeScan } from './tree.ts';

/** 软件在目标下的子目录名。 */
export const SOFTWARE_DIR_NAME = '软件';
/** 原目录改名后的后缀。 */
export const BACKUP_SUFFIX = '.jingsao-bak';
/** 还原时临时目录的后缀。 */
export const RESTORE_SUFFIX = '.jingsao-restore';

/** 可替换的底层动作（测试用来模拟中途出错或强制走提权路径）。 */
export interface MoverOps {
  copyFile: CopyFileFn;
  /** 在 path 建指向 target 的目录联接。 */
  link: (target: string, path: string) => Promise<void>;
  /** 改动 dir 是否需要管理员权限。 */
  needsElevation: (dir: string) => Promise<boolean>;
}

/** 构造入参。 */
export interface SoftwareMoverOptions {
  places: CleanPlaces;
  /** 记录 JSON 的绝对路径。 */
  file: string;
  probe: SoftwareProbe;
  now?: () => number;
  /** 提权执行器；不给时需要提权的搬家直接记失败。 */
  elevate?: ElevatedRunner;
  /** 替换底层动作（测试用）。 */
  ops?: Partial<MoverOps>;
  /** 提权脚本与结果文件放哪；默认记录文件旁的 elevated 目录。 */
  workDir?: string;
}

/** 搬家 / 还原的运行选项。 */
export interface SoftwareRunOptions {
  signal?: AbortSignal;
  onProgress?: (p: CleanProgress) => void;
}

/** 默认：在父目录试建再删一个临时文件，EPERM / EACCES 就需要提权。 */
async function probeNeedsElevation(dir: string): Promise<boolean> {
  const probe = join(dirname(dir), `.jingsao-write-test-${randomUUID().slice(0, 8)}`);
  try {
    await writeFile(probe, '', { flag: 'wx' });
    await unlink(probe);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code === 'EACCES';
  }
}

const DEFAULT_OPS: MoverOps = {
  copyFile: copyWithHash,
  link: (target, path) => symlink(target, path, 'junction'),
  needsElevation: probeNeedsElevation,
};

/** 软件名 → 可用作目录名的文字。 */
function safeName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\s\S]/g, (char) => (char.charCodeAt(0) < 32 ? '_' : char))
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80);
  return cleaned || '未命名软件';
}

/** 两个路径是否同一位置（大小写不敏感）。 */
function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/** 只删目录联接本身：先确认是链接，绝不递归。 */
async function removeJunction(path: string): Promise<void> {
  const stat = lstatSync(path);
  if (!stat.isSymbolicLink()) throw new Error('原位置不是联接，拒绝删除');
  await rmdir(path);
}

/** 原位置是指向 target 的联接，且能列出内容。 */
async function checkJunction(path: string, target: string): Promise<void> {
  if (!lstatSync(path).isSymbolicLink()) throw new Error('联接没有建成');
  if (!samePath(realpathSync.native(path), target)) throw new Error('联接指向的位置不对');
  const [seen, actual] = await Promise.all([readdir(path), readdir(target)]);
  if (seen.length !== actual.length) throw new Error('联接里看到的文件对不上');
}

/** 从目标路径里找回「…\鲸扫搬家\软件」这一级；找不到返回 null。 */
function moveBaseOf(target: string): string | null {
  const parts = resolve(target).split(sep);
  for (let i = parts.length - 2; i >= 1; i -= 1) {
    if (parts[i] === MOVE_DIR_NAME && parts[i + 1] === SOFTWARE_DIR_NAME) return parts.slice(0, i + 2).join(sep);
  }
  return null;
}

export class SoftwareMover {
  declare private readonly places: CleanPlaces;
  declare private readonly records: RecordFile;
  declare private readonly probe: SoftwareProbe;
  declare private readonly now: () => number;
  declare private readonly elevate: ElevatedRunner | undefined;
  declare private readonly ops: MoverOps;
  declare private readonly workDir: string;
  declare private busy: boolean;
  declare private seq: number;

  constructor(options: SoftwareMoverOptions) {
    this.places = options.places;
    this.records = new RecordFile(options.file);
    this.probe = options.probe;
    this.now = options.now ?? (() => Date.now());
    this.elevate = options.elevate;
    this.ops = { ...DEFAULT_OPS, ...options.ops };
    this.workDir = options.workDir ?? join(dirname(options.file), 'elevated');
    this.busy = false;
    this.seq = 0;
  }

  /** 全部软件搬家记录（新的在前）。 */
  history(): MoveRecord[] {
    return this.records.list();
  }

  /**
   * 搬一个软件。不能搬（找不到、被拦、正在运行、目标不可用、正忙、只读）时直接抛错，什么都没动；
   * 执行中失败时已回滚，返回 failed 记录。
   */
  async move(entryId: string, destRoot: string, options: SoftwareRunOptions = {}): Promise<MoveRecord> {
    return this.exclusive(async () => {
      const entry = await this.findEntry(entryId, options.signal);
      if (!entry) throw new Error('找不到这个软件，请重新扫描');
      if (entry.running?.length) throw new Error(`请先关闭正在运行的程序：${entry.running.join('、')}`);
      if (entry.blocked) throw new Error(entry.blocked);
      const reason = checkDestination(destRoot, this.places, entry.size);
      if (reason) throw new Error(reason);
      const source = entry.installDir;
      const backup = source + BACKUP_SUFFIX;
      if (pathExists(backup)) throw new Error(`上次搬家留下的备份还在：${backup}，请先处理`);
      const target = uniquePath(
        join(resolve(destRoot), MOVE_DIR_NAME, SOFTWARE_DIR_NAME, safeName(entry.name), basename(source)),
      );
      const at = this.now();
      const record: MoveRecord = {
        id: this.newId(at),
        feature: 'software',
        name: entry.name,
        from: source,
        to: target,
        size: entry.size,
        movedAt: at,
        mode: 'linked',
        state: 'moved',
      };
      if (await this.ops.needsElevation(source)) return this.moveElevated(record, backup);
      return this.moveDirect(record, backup, options);
    });
  }

  /**
   * 还原一个软件：原位置的联接换回真实目录，删掉搬过去的目录。
   * 记录不能还原、原位置不是当初的联接、程序在运行、空间不够时直接抛错；执行中失败已回滚，返回带 error 的记录（仍是 moved）。
   */
  async restore(recordId: string, options: SoftwareRunOptions = {}): Promise<MoveRecord> {
    return this.exclusive(async () => {
      const record = this.records.get(recordId);
      if (!record || record.feature !== 'software' || record.state !== 'moved' || record.mode !== 'linked') {
        throw new Error('这条记录不能还原');
      }
      const reason = denied(record.from, this.places, { allowUserData: true, allowProgramFiles: true });
      if (reason) throw new Error(reason);
      const linkStat = await lstat(record.from).catch(() => null);
      if (!linkStat?.isSymbolicLink() || !samePath(realpathSync.native(record.from), record.to)) {
        throw new Error('原位置已经不是当初建的联接，没法自动还原');
      }
      const movedStat = await lstat(record.to).catch(() => null);
      if (!movedStat?.isDirectory() || movedStat.isSymbolicLink()) throw new Error('搬过去的目录不见了');
      const running = await this.probe.runningExecutables().catch(() => {
        throw new Error('没法确认软件有没有在运行，请稍后再试');
      });
      const names = [...runningIn(record.from, running), ...runningIn(record.to, running)];
      if (names.length > 0) throw new Error(`请先关闭正在运行的程序：${[...new Set(names)].join('、')}`);
      const tree = await scanTree(record.to, { signal: options.signal });
      if (tree.links.length > 0) throw new Error('搬过去的目录里出现了链接，没法自动还原');
      const { free } = diskSpace(dirname(record.from));
      if (free !== null && free < tree.bytes + DEST_RESERVE_BYTES) throw new Error('C 盘空间不够，放不回去');
      const temp = record.from + RESTORE_SUFFIX;
      if (pathExists(temp)) throw new Error(`上次还原留下的临时目录还在：${temp}，请先处理`);
      if (await this.ops.needsElevation(record.from)) return this.restoreElevated(record, temp);
      return this.restoreDirect(record, temp, tree, options);
    });
  }

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
    return `sw-mv-${at.toString(36)}-${this.seq.toString(36)}`;
  }

  /** 按 id 重新找到并完整评估一个软件（含实时的运行状态与完整大小）。 */
  private async findEntry(entryId: string, signal?: AbortSignal): Promise<SoftwareEntry | null> {
    const candidate = mergeInstalled(await this.probe.listInstalled(), this.places).find((item) => item.id === entryId);
    if (!candidate) return null;
    const context = await readContext(this.probe, true).catch(() => {
      throw new Error('没法确认软件有没有在运行，请稍后再试');
    });
    return evaluateSoftware(candidate, this.places, context, { signal });
  }

  /** 普通权限下搬家。 */
  private async moveDirect(record: MoveRecord, backup: string, options: SoftwareRunOptions): Promise<MoveRecord> {
    const source = record.from;
    const target = record.to;
    let created = false;
    let renamed = false;
    try {
      const tree = await scanTree(source, { signal: options.signal });
      if (tree.links.length > 0) throw new Error('目录里有链接或联接，暂不支持搬');
      record.size = tree.bytes;
      await mkdir(dirname(target), { recursive: true });
      noLinks(dirname(target));
      await mkdir(target);
      created = true;
      let bytes = 0;
      const report = (): void =>
        options.onProgress?.({
          feature: 'software',
          phase: 'working',
          current: source,
          files: 0,
          bytes,
          totalFiles: tree.files.length,
          totalBytes: tree.bytes,
        });
      report();
      const hashes = await copyTree(source, target, tree, {
        signal: options.signal,
        copyFile: this.ops.copyFile,
        onBytes: (delta) => {
          bytes += delta;
          report();
        },
      });
      await verifyTree(target, tree, hashes, options.signal);
      options.signal?.throwIfAborted();
      await rename(source, backup);
      renamed = true;
      await this.ops.link(target, source);
      await checkJunction(source, target);
      await this.records.put(record);
      try {
        await rm(backup, { recursive: true, force: true });
      } catch (error) {
        record.error = `软件已经搬好，但原目录的备份没删干净：${backup}（${errorText(error)}）`;
        await this.records.put(record);
      }
      options.onProgress?.({ feature: 'software', phase: 'done', files: tree.files.length, bytes: tree.bytes });
      return { ...record };
    } catch (error) {
      const problems: string[] = [];
      if (pathExists(source) && lstatSync(source).isSymbolicLink()) {
        await removeJunction(source).catch((e: unknown) => problems.push(`联接删不掉：${errorText(e)}`));
      }
      if (renamed) await rename(backup, source).catch((e: unknown) => problems.push(`备份改不回原名：${errorText(e)}`));
      if (created)
        await rm(target, { recursive: true, force: true }).catch((e: unknown) =>
          problems.push(`新位置的副本删不掉：${errorText(e)}`),
        );
      const stop = moveBaseOf(target);
      if (stop && !pathExists(target)) await removeEmptyParents(dirname(target), stop);
      const message = options.signal?.aborted ? '已取消' : errorText(error);
      const failed: MoveRecord = {
        ...record,
        state: 'failed',
        error: problems.length > 0 ? `${message}；而且没能完全复原：${problems.join('；')}` : message,
      };
      await this.records.put(failed);
      options.onProgress?.({
        feature: 'software',
        phase: options.signal?.aborted ? 'cancelled' : 'error',
        files: 0,
        bytes: 0,
        error: failed.error,
      });
      return failed;
    }
  }

  /** 普通权限下还原。 */
  private async restoreDirect(
    record: MoveRecord,
    temp: string,
    tree: TreeScan,
    options: SoftwareRunOptions,
  ): Promise<MoveRecord> {
    let created = false;
    let unlinked = false;
    let swapped = false;
    try {
      await mkdir(temp);
      created = true;
      let bytes = 0;
      const hashes = await copyTree(record.to, temp, tree, {
        signal: options.signal,
        copyFile: this.ops.copyFile,
        onBytes: (delta) => {
          bytes += delta;
          options.onProgress?.({
            feature: 'software',
            phase: 'working',
            current: record.from,
            files: 0,
            bytes,
            totalBytes: tree.bytes,
          });
        },
      });
      await verifyTree(temp, tree, hashes, options.signal);
      options.signal?.throwIfAborted();
      await removeJunction(record.from);
      unlinked = true;
      await rename(temp, record.from);
      swapped = true;
      const stat = lstatSync(record.from);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('放回原位后检查没通过');
      return await this.finishRestore(record);
    } catch (error) {
      const problems: string[] = [];
      if (unlinked && !swapped)
        await this.ops
          .link(record.to, record.from)
          .catch((e: unknown) => problems.push(`联接建不回去：${errorText(e)}`));
      if (created && !swapped)
        await rm(temp, { recursive: true, force: true }).catch((e: unknown) =>
          problems.push(`临时目录删不掉：${errorText(e)}`),
        );
      const message = `还原失败：${options.signal?.aborted ? '已取消' : errorText(error)}`;
      const failed: MoveRecord = {
        ...record,
        error: problems.length > 0 ? `${message}；而且没能完全复原：${problems.join('；')}` : message,
      };
      await this.records.put(failed);
      return failed;
    }
  }

  /** 原位置已经是真实目录：记 restored，再删搬过去的目录（删不掉只留提示）。 */
  private async finishRestore(record: MoveRecord): Promise<MoveRecord> {
    const restored: MoveRecord = { ...record, state: 'restored' };
    delete restored.error;
    try {
      const stat = lstatSync(record.to);
      if (stat.isSymbolicLink()) throw new Error('新位置变成了链接，没有删除');
      await rm(record.to, { recursive: true, force: true });
      const stop = moveBaseOf(record.to);
      if (stop) await removeEmptyParents(dirname(record.to), stop);
    } catch (error) {
      restored.error = `软件已经放回原位，但新位置的副本没删干净：${errorText(error)}`;
    }
    await this.records.put(restored);
    return restored;
  }

  /** 准备提权脚本的文件路径。 */
  private async elevatedFiles(record: MoveRecord, action: string): Promise<{ scriptFile: string; resultFile: string }> {
    await mkdir(this.workDir, { recursive: true });
    const stem = join(this.workDir, `${action}-${record.id}-${randomUUID().slice(0, 8)}`);
    return { scriptFile: `${stem}.ps1`, resultFile: `${stem}.result.json` };
  }

  /** 需要管理员权限时搬家：生成脚本 → 提权运行 → 读结果 → 复核联接。 */
  private async moveElevated(record: MoveRecord, backup: string): Promise<MoveRecord> {
    const fail = async (message: string): Promise<MoveRecord> => {
      const stop = moveBaseOf(record.to);
      if (stop && !pathExists(record.to)) await removeEmptyParents(dirname(record.to), stop);
      const failed: MoveRecord = { ...record, state: 'failed', error: message };
      await this.records.put(failed);
      return failed;
    };
    if (!this.elevate) return fail('这个软件装在需要管理员权限的位置，当前没有提权通道');
    const tree = await scanTree(record.from, { tolerant: true });
    if (tree.links.length > 0) return fail('目录里有链接或联接，暂不支持搬');
    record.size = tree.bytes;
    await mkdir(dirname(record.to), { recursive: true });
    const { scriptFile, resultFile } = await this.elevatedFiles(record, 'move');
    try {
      await writeFile(scriptFile, scriptBytes(buildMoveScript(record.from, record.to, backup, resultFile)));
      try {
        await this.elevate({ action: 'move', scriptFile, resultFile, source: record.from, target: record.to });
      } catch (error) {
        return fail(`没有获得管理员权限：${errorText(error)}`);
      }
      const result = await readElevatedResult(resultFile);
      if (!result) return fail('管理员脚本没有返回结果，请检查原目录是否完好');
      if (!result.ok) return fail(result.error ?? `管理员脚本在「${result.step ?? '未知'}」这一步失败`);
      try {
        await checkJunction(record.from, record.to);
      } catch (error) {
        return fail(`管理员脚本报告成功，但检查联接没通过：${errorText(error)}，请手动检查原目录`);
      }
      const moved: MoveRecord = { ...record };
      if (result.warning) moved.error = result.warning;
      await this.records.put(moved);
      return moved;
    } finally {
      await unlink(scriptFile).catch(() => undefined);
      await unlink(resultFile).catch(() => undefined);
    }
  }

  /** 需要管理员权限时还原。 */
  private async restoreElevated(record: MoveRecord, temp: string): Promise<MoveRecord> {
    const fail = async (message: string): Promise<MoveRecord> => {
      const failed: MoveRecord = { ...record, error: `还原失败：${message}` };
      await this.records.put(failed);
      return failed;
    };
    if (!this.elevate) return fail('原位置需要管理员权限，当前没有提权通道');
    const { scriptFile, resultFile } = await this.elevatedFiles(record, 'restore');
    try {
      await writeFile(scriptFile, scriptBytes(buildRestoreScript(record.from, record.to, temp, resultFile)));
      try {
        await this.elevate({ action: 'restore', scriptFile, resultFile, source: record.from, target: record.to });
      } catch (error) {
        return fail(`没有获得管理员权限：${errorText(error)}`);
      }
      const result = await readElevatedResult(resultFile);
      if (!result) return fail('管理员脚本没有返回结果，请检查原位置是否完好');
      if (!result.ok) return fail(result.error ?? `管理员脚本在「${result.step ?? '未知'}」这一步失败`);
      const stat = await lstat(record.from).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink())
        return fail('管理员脚本报告成功，但原位置不是普通目录，请手动检查');
      const restored: MoveRecord = { ...record, state: 'restored' };
      delete restored.error;
      if (result.warning) restored.error = result.warning;
      else {
        const stop = moveBaseOf(record.to);
        if (stop) await removeEmptyParents(dirname(record.to), stop);
      }
      await this.records.put(restored);
      return restored;
    } finally {
      await unlink(scriptFile).catch(() => undefined);
      await unlink(resultFile).catch(() => undefined);
    }
  }
}
