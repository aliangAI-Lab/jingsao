/**
 * C 盘清理的宿主侧中枢：把五个功能的引擎串成「扫描 → 列表 → 动手」的异步任务，
 * 并把任务的起止事件交给宠物反应（鲸鱼娘吸入、打嗝、推容量条，冒气泡）。
 *
 * 只负责调度与状态，不做任何文件判断：哪些能动、怎么动都在各功能子模块与 ./safety 里。
 * 垃圾清理、微信QQ、重复文件点「立即清理」后直接删除（不进回收站、不进暂存区），删前逐个复核身份；
 * 需要管理员权限的系统规则整批交给一个提权子进程（一次清理只弹一次 UAC），拒绝提权就只清普通规则。
 * 大文件搬家、软件搬家保持原样（有记录、能搬回）。上个版本暂存区的遗留数据启动时检测一次，交给用户二选一。
 * 同一时刻只跑一个任务（扫描或改动），避免两个任务同时动同一批文件；页面靠轮询 status() 看进度。
 * 页面传回来的只有扫描结果里的 id，路径永远从本进程保存的候选里取，不信任页面给的路径。
 * 任务在宿主后台跑，不依赖页面在线：页面关掉（清理小窗点完就关）任务照常跑完。
 * @module jingsao/src/host/clean/service
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { checkDestination, MoveStore, scanBigFiles, type BigFileCandidate } from './bigfiles/index.ts';
import { scanChatApps } from './chat/index.ts';
import { appendCleanLog, type CleanLogEntry } from './delete/log.ts';
import {
  ElevationDenied,
  realElevatedCleaner,
  simulatedElevatedCleaner,
  type ElevatedCleaner,
  type ElevatedManifest,
} from './delete/elevated.ts';
import { legacySummary, settleLegacy, type LegacyOutcome } from './delete/legacy.ts';
import { removeCandidates } from './delete/remove.ts';
import { realSystemOps, testSystemOps, type SystemAction, type SystemOps } from './delete/system-ops.ts';
import type { AdminDir, DeleteCandidate, DeleteTally } from './delete/types.ts';
import { checkDuplicateSelection, scanDuplicates } from './duplicates/index.ts';
import type { JunkRule } from './junk/rules.ts';
import { scanJunk } from './junk/scan.ts';
import { diskSpace, errorText, locations, type CleanPlaces, type DenyOptions, type DiskSpace } from './safety.ts';
import {
  listSoftware,
  realElevatedRunner,
  realSoftwareProbe,
  SoftwareMover,
  type SoftwareProbe,
} from './software/index.ts';
import { testSoftwareProbe } from './software/test-probe.ts';
import type {
  CleanFeature,
  CleanProgress,
  CleanRunOutcome,
  CleanScanResult,
  LegacyStagingSummary,
  MoveRecord,
  SoftwareEntry,
} from './types.ts';

/** 直接删除的三个功能。 */
const DELETE_FEATURES: readonly CleanFeature[] = ['junk', 'chat', 'duplicates'];

/** 全部功能；页面工具条顺序也按它。 */
export const CLEAN_FEATURES: readonly CleanFeature[] = ['junk', 'chat', 'duplicates', 'bigfiles', 'software'];

/** 给宠物反应用的事件。 */
export type CleanEvent =
  | { kind: 'scan-start'; feature: CleanFeature }
  | { kind: 'scan-done'; feature: CleanFeature; bytes: number }
  /** bytes = 本次预计处理的字节（垃圾清理 = 勾选总量；搬家 = 搬走总量），宠物按它分档。 */
  | { kind: 'work-start'; feature: CleanFeature; action: CleanJobAction; bytes: number }
  | {
      kind: 'work-done';
      feature: CleanFeature;
      action: CleanJobAction;
      bytes: number;
      /** 实际释放的字节（宠物按它重新分档）。 */
      freedBytes?: number;
      /** 被占用等原因跳过的文件数。 */
      skipped?: number;
      /** 额外要说的话（例如「系统相关的 3 项需要管理员权限，这次没清」）。 */
      notes?: string[];
    }
  | { kind: 'error'; feature: CleanFeature; action: CleanJobAction; message: string }
  | { kind: 'cancelled'; feature: CleanFeature; action: CleanJobAction };

/** 任务种类。 */
export type CleanJobAction =
  'scan' | 'clean' | 'legacy-purge' | 'legacy-restore' | 'move' | 'move-restore' | 'software-move' | 'software-restore';

/** 当前或最近一次任务。 */
export interface CleanJob {
  id: string;
  feature: CleanFeature;
  action: CleanJobAction;
  startedAt: number;
  finishedAt?: number;
  /** 预计处理的字节（清理 = 勾选总量，搬家 = 搬走总量）；扫描没有。 */
  estimateBytes?: number;
  progress: CleanProgress;
  /** 完成后的摘要：清理结果 / 搬家记录 / 遗留处理结果等，原样给页面。 */
  outcome?: unknown;
  error?: string;
}

/** 可选的搬家目标盘。 */
export interface DriveInfo {
  root: string;
  total: number | null;
  free: number | null;
}

/** 页面轮询的完整状态。 */
export interface CleanStatus {
  disk: DiskSpace & { root: string };
  job: CleanJob | null;
  /** 每个功能最近一次扫描的摘要（完整列表另取 result）。 */
  scans: Partial<Record<CleanFeature, { scanId: string; finishedAt: number; totalBytes: number }>>;
  /** 上个版本暂存区里还留着的东西；没有为 null（面板不提示）。 */
  legacy: LegacyStagingSummary | null;
  /** 搬家记录（大文件 + 软件），新的在前。 */
  moves: MoveRecord[];
  drives: DriveInfo[];
  readOnly: boolean;
}

/** 构造参数。 */
export interface CleanServiceOptions {
  /** 插件用户数据目录：审计日志、搬家记录都落在这里。 */
  dataDir: string;
  /** 位置表；缺省按当前进程环境变量推导（测试注入 JINGSAO_TEST_ROOT）。 */
  places?: CleanPlaces;
  /** 软件信息来源；测试注入假的。 */
  softwareProbe?: SoftwareProbe;
  /** 回收站、传递优化、更新检查等系统能力；测试模式缺省用只在测试根里模拟的那份。 */
  systemOps?: SystemOps;
  /** 提权清理执行器；测试模式缺省用同进程模拟（不弹 UAC）。 */
  elevatedCleaner?: ElevatedCleaner;
  /** 真正删文件的那一步（测试注入，用来模拟被占用）。 */
  unlink?: (path: string) => void;
  /** 宠物反应出口；失败只记日志，不影响任务。 */
  onEvent?: (event: CleanEvent) => void;
  log?: { warn(message: string): void };
  now?: () => number;
}

/** 失败时抛给路由的业务错误：code 原样进响应，message 给人看。 */
export class CleanError extends Error {
  declare readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** 扫描参数（页面可选传）。 */
export interface CleanScanOptions {
  /** 大文件 / 重复文件的大小下限（字节）。 */
  minSize?: number;
  /** 微信QQ专清：只要这么多天以前的文件。 */
  olderThanDays?: number;
  /** 重复文件：额外扫描的其他盘根（如 'D:\\'）。 */
  extraRoots?: string[];
}

type AnyCandidate = DeleteCandidate | BigFileCandidate;

/** 一次清理要做的全部事情（服务内部用）。 */
interface CleanPlan {
  files: DeleteCandidate[];
  adminDirs: AdminDir[];
  /** 选中的特殊规则（回收站、传递优化缓存）：分类 id → 规则。 */
  specials: JunkRule[];
  /** 整类选中的分类 id。 */
  categories: string[];
  estimate: number;
}

export class CleanService {
  declare readonly places: CleanPlaces;
  declare private readonly moves: MoveStore;
  declare private readonly software: SoftwareMover;
  declare private readonly probe: SoftwareProbe;
  declare private readonly systemOps: SystemOps;
  declare private readonly elevatedCleaner: ElevatedCleaner;
  declare private readonly unlink: ((path: string) => void) | undefined;
  declare private readonly logFile: string;
  declare private readonly onEvent: (event: CleanEvent) => void;
  declare private readonly log: { warn(message: string): void } | undefined;
  declare private readonly now: () => number;
  declare private job: CleanJob | null;
  declare private abort: AbortController | null;
  declare private readonly results: Map<CleanFeature, CleanScanResult>;
  declare private readonly candidates: Map<CleanFeature, Map<string, AnyCandidate>>;
  /** 垃圾清理：需要管理员、扫描时读不到的根目录。 */
  declare private adminDirs: AdminDir[];
  /** 垃圾清理：分类 id → 规则。 */
  declare private junkRules: Map<string, JunkRule>;
  /** 重复文件的分组（组 id → 组内 item id），用于「每组至少留一份」的复核。 */
  declare private dupGroups: Map<string, string[]>;
  declare private softwareList: SoftwareEntry[];
  /** 上个版本暂存区的遗留数据（启动时检测一次，处理后重算）。 */
  declare private legacy: LegacyStagingSummary | null;

  constructor(options: CleanServiceOptions) {
    this.places = options.places ?? locations();
    this.probe =
      options.softwareProbe ?? (this.places.test ? testSoftwareProbe(this.places.test) : realSoftwareProbe());
    this.now = options.now ?? (() => Date.now());
    this.log = options.log;
    this.onEvent = options.onEvent ?? (() => {});
    this.unlink = options.unlink;
    // 测试模式下一切写入都必须落在测试根里；.jingsao-data 在永久保护名单里，清理不会扫到它。
    const dataHome = this.places.test ? join(this.places.test, '.jingsao-data') : options.dataDir;
    const dataRoot = join(dataHome, 'clean');
    this.logFile = join(dataHome, 'clean-log.jsonl');
    this.systemOps =
      options.systemOps ?? (this.places.test ? testSystemOps(this.places) : realSystemOps(this.places.systemdrive));
    this.elevatedCleaner =
      options.elevatedCleaner ??
      (this.places.test
        ? simulatedElevatedCleaner(this.places)
        : realElevatedCleaner({ workDir: join(dataRoot, 'elevated'), runner: realElevatedRunner() }));
    this.moves = new MoveStore({ places: this.places, file: join(dataRoot, 'moves.json'), now: this.now });
    this.software = new SoftwareMover({
      places: this.places,
      file: join(dataRoot, 'software-moves.json'),
      probe: this.probe,
      now: this.now,
      // Program Files 下的软件普通权限写不了：走一次管理员确认（UAC）；测试模式不弹窗
      ...(this.places.test ? {} : { elevate: realElevatedRunner() }),
    });
    this.job = null;
    this.abort = null;
    this.results = new Map();
    this.candidates = new Map();
    this.adminDirs = [];
    this.junkRules = new Map();
    this.dupGroups = new Map();
    this.softwareList = [];
    this.legacy = this.detectLegacy();
  }

  /** 页面轮询的状态快照。 */
  status(): CleanStatus {
    const scans: CleanStatus['scans'] = {};
    for (const [feature, result] of this.results) {
      scans[feature] = { scanId: result.scanId, finishedAt: result.finishedAt, totalBytes: result.totalBytes };
    }
    const moves = [...this.moves.history(), ...this.software.history()].sort((a, b) => b.movedAt - a.movedAt);
    return {
      disk: { root: this.places.drive, ...diskSpace(this.places.drive) },
      job: this.job,
      scans,
      legacy: this.legacy,
      moves,
      drives: this.drives(),
      readOnly: this.places.readOnly,
    };
  }

  /** 某功能最近一次扫描的完整结果。 */
  result(feature: CleanFeature): CleanScanResult | null {
    return this.results.get(feature) ?? null;
  }

  /** 软件搬家的软件列表（最近一次扫描）。 */
  softwareEntries(): SoftwareEntry[] {
    return this.softwareList;
  }

  /** 除系统盘外、当前存在的本地盘：搬家目标候选。 */
  drives(): DriveInfo[] {
    if (this.places.test) return [{ root: join(this.places.test, 'D'), ...diskSpace(this.places.test) }];
    const out: DriveInfo[] = [];
    const system = parse(this.places.drive).root.toUpperCase();
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = letter + ':\\';
      if (root === system || !existsSync(root)) continue;
      const space = diskSpace(root);
      if (space.total === null) continue;
      out.push({ root, ...space });
    }
    return out;
  }

  /** 取消当前任务（扫描与删除在文件之间生效；已经删掉的不会回来）。 */
  cancel(): void {
    this.abort?.abort();
  }

  /** 开始扫描；已有任务在跑时拒绝。立即返回任务，进度看 status()。 */
  startScan(feature: CleanFeature, options: CleanScanOptions = {}): CleanJob {
    return this.run(feature, 'scan', async (signal, onProgress) => {
      this.emit({ kind: 'scan-start', feature });
      if (feature === 'software') {
        this.softwareList = await listSoftware(this.places, this.probe, { signal, onProgress });
        const bytes = this.softwareList.filter((e) => e.blocked === null).reduce((sum, e) => sum + e.size, 0);
        this.emit({ kind: 'scan-done', feature, bytes });
        return { count: this.softwareList.length, bytes };
      }
      const common = { signal, onProgress };
      let scanned: { result: CleanScanResult; candidates: Map<string, AnyCandidate> };
      if (feature === 'junk') {
        const junk = await scanJunk(this.places, { ...common, systemOps: this.systemOps });
        this.adminDirs = junk.adminDirs;
        this.junkRules = junk.rules;
        scanned = junk;
      } else if (feature === 'chat') {
        scanned = await scanChatApps(this.places, {
          ...common,
          ...(options.olderThanDays === undefined ? {} : { olderThanDays: options.olderThanDays }),
        });
      } else if (feature === 'duplicates') {
        scanned = await this.scanDup(options, common);
      } else {
        scanned = await scanBigFiles(this.places, {
          ...common,
          ...(options.minSize === undefined ? {} : { minSize: options.minSize }),
        });
      }
      this.results.set(feature, scanned.result);
      this.candidates.set(feature, scanned.candidates);
      this.emit({ kind: 'scan-done', feature, bytes: scanned.result.totalBytes });
      return { scanId: scanned.result.scanId, bytes: scanned.result.totalBytes };
    });
  }

  /**
   * 立即清理（垃圾 / 微信QQ / 重复文件）：直接删除，不进回收站、不进暂存区。
   * categories 按整类选取（页面只列每类最大的若干项，整类勾选要靠它把未列出的也带上）；ids 按单项选取。
   * 宿主接受任务（返回 job）后页面就可以关窗，任务在宿主后台跑完。
   */
  clean(feature: CleanFeature, ids: readonly string[], categories: readonly string[] = []): CleanJob {
    if (!DELETE_FEATURES.includes(feature)) throw new CleanError('bad-request', '这个功能不能直接清理');
    if (feature === 'duplicates' && categories.length) throw new CleanError('bad-request', '重复文件只能逐个勾选');
    const plan = this.plan(feature, ids, categories);
    if (feature === 'duplicates') {
      const reason = checkDuplicateSelection(
        this.dupGroups,
        plan.files.map((file) => file.id),
      );
      if (reason) throw new CleanError('bad-request', reason);
    }
    // 用户数据类功能（微信QQ、重复文件）是用户逐项勾过的，安全闸放行用户目录；垃圾清理不放行。
    const deny: DenyOptions =
      feature === 'junk' ? {} : { allowUserData: true, allowOtherDrives: feature === 'duplicates' };
    return this.run(
      feature,
      'clean',
      async (signal, onProgress) => {
        this.emit({ kind: 'work-start', feature, action: 'clean', bytes: plan.estimate });
        const { outcome, perCategory } = await this.execute(feature, plan, deny, signal, onProgress);
        this.forget(feature, plan);
        this.writeLog(feature, perCategory);
        if (outcome.cancelled) {
          this.emit({ kind: 'cancelled', feature, action: 'clean' });
        } else {
          const notes = cleanNotes(outcome);
          this.emit({
            kind: 'work-done',
            feature,
            action: 'clean',
            bytes: outcome.bytes,
            freedBytes: outcome.bytes,
            skipped: outcome.skipped,
            ...(notes.length ? { notes } : {}),
          });
        }
        return outcome;
      },
      plan.estimate,
    );
  }

  /** 上个版本暂存区的遗留数据：彻底删除（purge）或原样放回（restore）。处理完不再提示。 */
  settleLegacy(mode: 'purge' | 'restore'): CleanJob {
    if (!this.legacy) throw new CleanError('not-found', '没有上个版本暂存的文件');
    const action: CleanJobAction = mode === 'purge' ? 'legacy-purge' : 'legacy-restore';
    const estimate = this.legacy.bytes;
    return this.run(
      'junk',
      action,
      async (_signal, onProgress) => {
        if (mode === 'purge') this.emit({ kind: 'work-start', feature: 'junk', action, bytes: estimate });
        let outcome: LegacyOutcome;
        try {
          outcome = await settleLegacy(this.places, mode, (files, bytes, current) =>
            onProgress({ feature: 'junk', phase: 'working', files, bytes, totalBytes: estimate, current }),
          );
        } finally {
          this.legacy = this.detectLegacy();
        }
        this.emit({
          kind: 'work-done',
          feature: 'junk',
          action,
          bytes: outcome.bytes,
          ...(mode === 'purge' ? { freedBytes: outcome.bytes } : {}),
          skipped: outcome.failed,
        });
        return outcome;
      },
      estimate,
    );
  }

  /** 「用系统方式清理」：打开系统自带的清理入口，由用户在系统界面里确认（不是宿主任务）。 */
  async systemAction(action: SystemAction): Promise<void> {
    if (this.places.readOnly) throw new CleanError('read-only', '当前是只读模式');
    await this.systemOps.launch(action);
  }

  /** 大文件搬家：把选中的大文件搬到 destRoot。 */
  moveBigFiles(ids: readonly string[], destRoot: string): CleanJob {
    const reason = checkDestination(destRoot, this.places);
    if (reason) throw new CleanError('bad-destination', reason);
    const picked = this.pick('bigfiles', ids) as BigFileCandidate[];
    const estimate = picked.reduce((sum, item) => sum + item.identity.size, 0);
    return this.run(
      'bigfiles',
      'move',
      async (signal, onProgress) => {
        this.emit({ kind: 'work-start', feature: 'bigfiles', action: 'move', bytes: estimate });
        const records = await this.moves.moveFiles(picked, destRoot, { signal, onProgress });
        this.forget('bigfiles', { files: [], adminDirs: [], specials: [], categories: [], estimate, ids: [...ids] });
        const bytes = records.filter((r) => r.state === 'moved').reduce((sum, r) => sum + r.size, 0);
        if (signal.aborted) this.emit({ kind: 'cancelled', feature: 'bigfiles', action: 'move' });
        else this.emit({ kind: 'work-done', feature: 'bigfiles', action: 'move', bytes, freedBytes: bytes });
        return records;
      },
      estimate,
    );
  }

  /** 把搬走的大文件搬回原位。 */
  restoreBigFiles(recordIds: readonly string[]): CleanJob {
    return this.run('bigfiles', 'move-restore', async (signal, onProgress) => {
      const records = await this.moves.restore([...recordIds], { signal, onProgress });
      const bytes = records.filter((r) => r.state === 'restored').reduce((sum, r) => sum + r.size, 0);
      this.emit({ kind: 'work-done', feature: 'bigfiles', action: 'move-restore', bytes });
      return records;
    });
  }

  /** 软件搬家：整个安装目录搬走，原位置留目录联接。 */
  moveSoftware(entryId: string, destRoot: string): CleanJob {
    const reason = checkDestination(destRoot, this.places);
    if (reason) throw new CleanError('bad-destination', reason);
    const entry = this.softwareList.find((e) => e.id === entryId);
    if (!entry) throw new CleanError('not-found', '列表已过期，请重新扫描软件');
    if (entry.blocked) throw new CleanError('blocked', entry.blocked);
    return this.run(
      'software',
      'software-move',
      async (signal, onProgress) => {
        this.emit({ kind: 'work-start', feature: 'software', action: 'software-move', bytes: entry.size });
        const record = await this.software.move(entryId, destRoot, { signal, onProgress });
        if (record.state !== 'moved') throw new Error(record.error ?? '搬家失败，已恢复原样');
        this.softwareList = this.softwareList.filter((e) => e.id !== entryId);
        this.emit({
          kind: 'work-done',
          feature: 'software',
          action: 'software-move',
          bytes: record.size,
          freedBytes: record.size,
        });
        return record;
      },
      entry.size,
    );
  }

  /** 把搬走的软件搬回原位。 */
  restoreSoftware(recordId: string): CleanJob {
    return this.run('software', 'software-restore', async (signal, onProgress) => {
      const record = await this.software.restore(recordId, { signal, onProgress });
      if (record.state !== 'restored') throw new Error(record.error ?? '还原失败');
      this.emit({ kind: 'work-done', feature: 'software', action: 'software-restore', bytes: record.size });
      return record;
    });
  }

  /** 在资源管理器里定位一项（只认最近一次扫描结果里的 id）。 */
  reveal(feature: CleanFeature, id: string): void {
    const found = this.candidates.get(feature)?.get(id);
    const path = found?.path ?? this.softwareList.find((e) => e.id === id)?.installDir;
    if (!path) throw new CleanError('not-found', '列表已过期，请重新扫描');
    if (this.places.test) return;
    spawn('explorer.exe', ['/select,', path], { detached: true, stdio: 'ignore' }).unref();
  }

  /** 遗留数据检测：读不出来只记日志，不影响清理。 */
  private detectLegacy(): LegacyStagingSummary | null {
    try {
      return legacySummary(this.places);
    } catch (error) {
      this.log?.warn(`[jingsao] 读取上个版本的暂存区失败：${errorText(error)}`);
      return null;
    }
  }

  /** 重复文件扫描：默认根加上页面勾的其他盘。 */
  private async scanDup(
    options: CleanScanOptions,
    common: { signal: AbortSignal; onProgress: (p: CleanProgress) => void },
  ): Promise<{ result: CleanScanResult; candidates: Map<string, AnyCandidate> }> {
    const extra = (options.extraRoots ?? []).filter((root) => this.drives().some((d) => d.root === root));
    const scanned = await scanDuplicates(this.places, {
      ...common,
      ...(options.minSize === undefined ? {} : { minSize: options.minSize }),
      ...(extra.length ? { roots: extra } : {}),
    });
    this.dupGroups = scanned.groups;
    return scanned;
  }

  /** 页面的选择 → 本进程保存的候选、特殊规则、需管理员的目录；有任何一项不认识就整体拒绝（列表过期）。 */
  private plan(
    feature: CleanFeature,
    ids: readonly string[],
    categories: readonly string[],
  ): CleanPlan & { ids: string[] } {
    const result = this.results.get(feature);
    const map = this.candidates.get(feature);
    if (!result || !map) throw new CleanError('not-scanned', '请先扫描');
    const wanted = new Set(categories);
    const specials: JunkRule[] = [];
    let estimate = 0;
    for (const id of wanted) {
      const category = result.categories.find((c) => c.id === id);
      if (!category) throw new CleanError('stale', '列表已过期，请重新扫描');
      if (category.reportOnly) throw new CleanError('bad-request', `「${category.label}」只报告，不能在这里清理`);
      const rule = feature === 'junk' ? this.junkRules.get(id) : undefined;
      if (rule?.special) {
        specials.push(rule);
        estimate += category.bytes;
      }
    }
    const allIds = [...ids, ...[...map.values()].filter((c) => wanted.has(c.categoryId)).map((c) => c.id)];
    const files: DeleteCandidate[] = [];
    for (const id of new Set(allIds)) {
      const found = map.get(id);
      if (!found) throw new CleanError('stale', '列表已过期，请重新扫描');
      files.push(found);
      estimate += found.identity.size;
    }
    const adminDirs = feature === 'junk' ? this.adminDirs.filter((dir) => wanted.has(dir.categoryId)) : [];
    if (!files.length && !specials.length && !adminDirs.length) throw new CleanError('bad-request', '还没有选择任何项');
    return { files, adminDirs, specials, categories: [...wanted], estimate, ids: [...new Set(allIds)] };
  }

  /** 真正动手：先整批提权（一次 UAC），再删普通文件，最后回收站。返回汇总与按分类的计数。 */
  private async execute(
    feature: CleanFeature,
    plan: CleanPlan,
    deny: DenyOptions,
    signal: AbortSignal,
    onProgress: (p: CleanProgress) => void,
  ): Promise<{ outcome: CleanRunOutcome; perCategory: Map<string, DeleteTally> }> {
    const outcome: CleanRunOutcome = {
      files: 0,
      bytes: 0,
      skipped: 0,
      adminSkipped: 0,
      updateBusy: [],
      commandErrors: [],
      cancelled: false,
    };
    const perCategory = new Map<string, DeleteTally>();
    const merge = (id: string, tally: DeleteTally): void => {
      const target = perCategory.get(id) ?? { files: 0, bytes: 0, skipped: 0 };
      target.files += tally.files;
      target.bytes += tally.bytes;
      target.skipped += tally.skipped;
      perCategory.set(id, target);
      outcome.files += tally.files;
      outcome.bytes += tally.bytes;
      outcome.skipped += tally.skipped;
    };
    const labelOf = (id: string): string =>
      this.results.get(feature)?.categories.find((c) => c.id === id)?.label ?? this.junkRules.get(id)?.label ?? id;
    const bytesOf = (id: string): number => this.results.get(feature)?.categories.find((c) => c.id === id)?.bytes ?? 0;

    let files = plan.files;
    let adminDirs = plan.adminDirs;
    let specials = plan.specials;
    // Windows 更新正在下载或安装：整条跳过「更新下载缓存」
    if (feature === 'junk') {
      const guarded = new Set(
        [...new Set([...files.map((f) => f.categoryId), ...adminDirs.map((d) => d.categoryId)])].filter(
          (id) => this.junkRules.get(id)?.guard === 'windows-update',
        ),
      );
      if (guarded.size && (await this.systemOps.windowsUpdateBusy())) {
        files = files.filter((f) => !guarded.has(f.categoryId));
        adminDirs = adminDirs.filter((d) => !guarded.has(d.categoryId));
        outcome.updateBusy.push(...[...guarded].map(labelOf));
      }
    }

    // 1) 需要管理员的部分：整批交给一个提权子进程，一次清理只弹一次 UAC
    const adminFiles = files.filter((f) => f.needsAdmin);
    const commands = specials.filter((rule) => rule.special === 'delivery-opt');
    if ((adminFiles.length || adminDirs.length || commands.length) && !signal.aborted) {
      const manifest: ElevatedManifest = {
        files: adminFiles,
        dirs: adminDirs,
        commands: commands.map(() => 'delivery-opt' as const),
      };
      onProgress({
        feature,
        phase: 'working',
        files: 0,
        bytes: 0,
        totalBytes: plan.estimate,
        current: '等管理员确认…',
      });
      try {
        const elevated = await this.elevatedCleaner(manifest);
        for (const [id, tally] of Object.entries(elevated.rules)) merge(id, tally);
        for (const rule of commands) {
          const result = elevated.commands[rule.special!];
          if (result?.ok) merge(rule.id, { files: 0, bytes: bytesOf(rule.id), skipped: 0 });
          else outcome.commandErrors.push(`${rule.label}没清掉：${result?.error ?? '系统命令没有返回结果'}`);
        }
      } catch (error) {
        const ruleIds = new Set([
          ...adminFiles.map((f) => f.categoryId),
          ...adminDirs.map((d) => d.categoryId),
          ...commands.map((rule) => rule.id),
        ]);
        if (error instanceof ElevationDenied) outcome.adminSkipped = ruleIds.size;
        else outcome.commandErrors.push(`系统相关的清理出错：${errorText(error)}`);
      }
    }
    specials = specials.filter((rule) => rule.special !== 'delivery-opt');

    // 2) 普通权限的部分：逐个复核再删
    const normal = files.filter((f) => !f.needsAdmin);
    if (normal.length) {
      const removed = await removeCandidates(normal, this.places, {
        feature,
        signal,
        onProgress,
        deny,
        totalBytes: plan.estimate,
        startBytes: outcome.bytes,
        ...(this.unlink ? { unlink: this.unlink } : {}),
      });
      for (const [id, tally] of removed.perCategory) merge(id, tally);
      if (removed.cancelled) outcome.cancelled = true;
    }

    // 3) 回收站：系统命令清空（大小按扫描时统计）
    for (const rule of specials) {
      if (signal.aborted) break;
      if (rule.special !== 'recycle-bin') continue;
      try {
        await this.systemOps.clearRecycleBin();
        merge(rule.id, { files: 0, bytes: bytesOf(rule.id), skipped: 0 });
      } catch (error) {
        outcome.commandErrors.push(`回收站没清空：${errorText(error)}`);
      }
    }
    if (signal.aborted) outcome.cancelled = true;
    return { outcome, perCategory };
  }

  /** 审计日志：按规则写一行；写失败只记告警，不影响清理结果。 */
  private writeLog(feature: CleanFeature, perCategory: Map<string, DeleteTally>): void {
    const time = this.now();
    const entries: CleanLogEntry[] = [...perCategory].map(([ruleId, tally]) => ({
      time,
      feature,
      ruleId: feature === 'duplicates' ? 'duplicates' : ruleId,
      files: tally.files,
      bytes: tally.bytes,
      skipped: tally.skipped,
    }));
    try {
      appendCleanLog(this.logFile, entries, this.places, time);
    } catch (error) {
      this.log?.warn(`[jingsao] 写清理日志失败：${errorText(error)}`);
    }
  }

  /** id → 本进程保存的候选；有任何一个找不到就整体拒绝（列表过期）。 */
  private pick(feature: CleanFeature, ids: readonly string[]): AnyCandidate[] {
    if (!ids.length) throw new CleanError('bad-request', '还没有选择任何项');
    const map = this.candidates.get(feature);
    if (!map) throw new CleanError('not-scanned', '请先扫描');
    const out: AnyCandidate[] = [];
    for (const id of new Set(ids)) {
      const found = map.get(id);
      if (!found) throw new CleanError('stale', '列表已过期，请重新扫描');
      out.push(found);
    }
    return out;
  }

  /**
   * 动过的项从结果里拿掉，避免页面再次提交同一批 id：单项按 id 去掉，整类选中的分类整类去掉
   * （跳过的文件也一起从列表里消失，重新扫描会再出现）。
   */
  private forget(feature: CleanFeature, plan: CleanPlan & { ids: string[] }): void {
    const map = this.candidates.get(feature);
    const result = this.results.get(feature);
    if (!map || !result) return;
    const gone = new Set(plan.ids);
    const cleared = new Set(plan.categories);
    for (const id of gone) map.delete(id);
    for (const [id, candidate] of map) if (cleared.has(candidate.categoryId)) map.delete(id);
    if (feature === 'junk') this.adminDirs = this.adminDirs.filter((dir) => !cleared.has(dir.categoryId));
    for (const category of result.categories) {
      category.items = category.items.filter((item) => !gone.has(item.id));
    }
    // 分类的 bytes / count 按剩余候选重算（列表只列了一部分，不能只数 items）
    const left = new Map<string, { bytes: number; count: number }>();
    for (const c of map.values()) {
      const agg = left.get(c.categoryId) ?? { bytes: 0, count: 0 };
      agg.bytes += c.identity.size;
      agg.count += 1;
      left.set(c.categoryId, agg);
    }
    result.categories = result.categories.filter((category) => {
      if (category.reportOnly) return true;
      if (cleared.has(category.id)) return false;
      // 特殊规则与读不到的分类没有逐个候选：没被选中就原样保留
      if (category.special || category.unreadable) return true;
      const agg = left.get(category.id) ?? { bytes: 0, count: 0 };
      category.bytes = agg.bytes;
      category.count = agg.count;
      return category.count > 0;
    });
    result.totalBytes = result.categories.filter((c) => !c.reportOnly).reduce((sum, c) => sum + c.bytes, 0);
  }

  /** 串行执行一个任务：占住 job，进度写进 job，结束时记 outcome / error 并发宠物事件。 */
  private run(
    feature: CleanFeature,
    action: CleanJobAction,
    body: (signal: AbortSignal, onProgress: (p: CleanProgress) => void) => Promise<unknown>,
    estimateBytes?: number,
  ): CleanJob {
    if (this.job && this.job.finishedAt === undefined) throw new CleanError('busy', '鲸鱼娘正在忙上一件事，等她做完');
    if (this.places.readOnly && action !== 'scan') throw new CleanError('read-only', '当前是只读模式');
    const abort = new AbortController();
    const job: CleanJob = {
      id: `${action}-${this.now().toString(36)}`,
      feature,
      action,
      startedAt: this.now(),
      ...(estimateBytes === undefined ? {} : { estimateBytes }),
      progress: {
        feature,
        phase: action === 'scan' ? 'scanning' : 'working',
        files: 0,
        bytes: 0,
        ...(estimateBytes ? { totalBytes: estimateBytes } : {}),
      },
    };
    this.job = job;
    this.abort = abort;
    const onProgress = (p: CleanProgress): void => {
      job.progress = { ...p, feature };
    };
    void body(abort.signal, onProgress).then(
      (outcome) => {
        job.outcome = outcome;
        job.progress = { ...job.progress, phase: abort.signal.aborted ? 'cancelled' : 'done' };
        job.finishedAt = this.now();
      },
      (error: unknown) => {
        const cancelled = abort.signal.aborted;
        job.error = cancelled ? '已取消' : errorText(error);
        job.progress = { ...job.progress, phase: cancelled ? 'cancelled' : 'error', error: job.error };
        job.finishedAt = this.now();
        if (cancelled) {
          if (action !== 'scan') this.emit({ kind: 'cancelled', feature, action });
        } else {
          this.emit({ kind: 'error', feature, action, message: job.error });
        }
      },
    );
    return job;
  }

  /** 宠物反应：出错只记日志。 */
  private emit(event: CleanEvent): void {
    try {
      this.onEvent(event);
    } catch (error) {
      this.log?.warn(`[jingsao] 清理事件处理失败：${errorText(error)}`);
    }
  }
}

/** 清理结果 → 宠物气泡与面板的补充说明。 */
export function cleanNotes(outcome: CleanRunOutcome): string[] {
  const notes: string[] = [];
  if (outcome.skipped > 0) notes.push(`有 ${outcome.skipped} 个文件正在被使用，没删掉`);
  if (outcome.adminSkipped > 0) notes.push(`系统相关的 ${outcome.adminSkipped} 项需要管理员权限，这次没清`);
  if (outcome.updateBusy.length) notes.push(`系统正在更新，稍后再清：${outcome.updateBusy.join('、')}`);
  notes.push(...outcome.commandErrors);
  return notes;
}
