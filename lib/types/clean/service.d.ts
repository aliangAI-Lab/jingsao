import { type ElevatedCleaner } from './delete/elevated.ts';
import { type SystemAction, type SystemOps } from './delete/system-ops.ts';
import { type CleanPlaces, type DiskSpace } from './safety.ts';
import { type SoftwareProbe } from './software/index.ts';
import type { CleanFeature, CleanProgress, CleanRunOutcome, CleanScanResult, LegacyStagingSummary, MoveRecord, SoftwareEntry } from './types.ts';
/** 全部功能；页面工具条顺序也按它。 */
export declare const CLEAN_FEATURES: readonly CleanFeature[];
/** 给宠物反应用的事件。 */
export type CleanEvent = {
    kind: 'scan-start';
    feature: CleanFeature;
} | {
    kind: 'scan-done';
    feature: CleanFeature;
    bytes: number;
}
/** bytes = 本次预计处理的字节（垃圾清理 = 勾选总量；搬家 = 搬走总量），宠物按它分档。 */
 | {
    kind: 'work-start';
    feature: CleanFeature;
    action: CleanJobAction;
    bytes: number;
} | {
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
} | {
    kind: 'error';
    feature: CleanFeature;
    action: CleanJobAction;
    message: string;
} | {
    kind: 'cancelled';
    feature: CleanFeature;
    action: CleanJobAction;
};
/** 任务种类。 */
export type CleanJobAction = 'scan' | 'clean' | 'legacy-purge' | 'legacy-restore' | 'move' | 'move-restore' | 'software-move' | 'software-restore';
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
    disk: DiskSpace & {
        root: string;
    };
    job: CleanJob | null;
    /** 每个功能最近一次扫描的摘要（完整列表另取 result）。 */
    scans: Partial<Record<CleanFeature, {
        scanId: string;
        finishedAt: number;
        totalBytes: number;
    }>>;
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
    log?: {
        warn(message: string): void;
    };
    now?: () => number;
}
/** 失败时抛给路由的业务错误：code 原样进响应，message 给人看。 */
export declare class CleanError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
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
export declare class CleanService {
    readonly places: CleanPlaces;
    private readonly moves;
    private readonly software;
    private readonly probe;
    private readonly systemOps;
    private readonly elevatedCleaner;
    private readonly unlink;
    private readonly logFile;
    private readonly onEvent;
    private readonly log;
    private readonly now;
    private job;
    private abort;
    private readonly results;
    private readonly candidates;
    /** 垃圾清理：需要管理员、扫描时读不到的根目录。 */
    private adminDirs;
    /** 垃圾清理：分类 id → 规则。 */
    private junkRules;
    /** 重复文件的分组（组 id → 组内 item id），用于「每组至少留一份」的复核。 */
    private dupGroups;
    private softwareList;
    /** 上个版本暂存区的遗留数据（启动时检测一次，处理后重算）。 */
    private legacy;
    constructor(options: CleanServiceOptions);
    /** 页面轮询的状态快照。 */
    status(): CleanStatus;
    /** 某功能最近一次扫描的完整结果。 */
    result(feature: CleanFeature): CleanScanResult | null;
    /** 软件搬家的软件列表（最近一次扫描）。 */
    softwareEntries(): SoftwareEntry[];
    /** 除系统盘外、当前存在的本地盘：搬家目标候选。 */
    drives(): DriveInfo[];
    /** 取消当前任务（扫描与删除在文件之间生效；已经删掉的不会回来）。 */
    cancel(): void;
    /** 开始扫描；已有任务在跑时拒绝。立即返回任务，进度看 status()。 */
    startScan(feature: CleanFeature, options?: CleanScanOptions): CleanJob;
    /**
     * 立即清理（垃圾 / 微信QQ / 重复文件）：直接删除，不进回收站、不进暂存区。
     * categories 按整类选取（页面只列每类最大的若干项，整类勾选要靠它把未列出的也带上）；ids 按单项选取。
     * 宿主接受任务（返回 job）后页面就可以关窗，任务在宿主后台跑完。
     */
    clean(feature: CleanFeature, ids: readonly string[], categories?: readonly string[]): CleanJob;
    /** 上个版本暂存区的遗留数据：彻底删除（purge）或原样放回（restore）。处理完不再提示。 */
    settleLegacy(mode: 'purge' | 'restore'): CleanJob;
    /** 「用系统方式清理」：打开系统自带的清理入口，由用户在系统界面里确认（不是宿主任务）。 */
    systemAction(action: SystemAction): Promise<void>;
    /** 大文件搬家：把选中的大文件搬到 destRoot。 */
    moveBigFiles(ids: readonly string[], destRoot: string): CleanJob;
    /** 把搬走的大文件搬回原位。 */
    restoreBigFiles(recordIds: readonly string[]): CleanJob;
    /** 软件搬家：整个安装目录搬走，原位置留目录联接。 */
    moveSoftware(entryId: string, destRoot: string): CleanJob;
    /** 把搬走的软件搬回原位。 */
    restoreSoftware(recordId: string): CleanJob;
    /** 在资源管理器里定位一项（只认最近一次扫描结果里的 id）。 */
    reveal(feature: CleanFeature, id: string): void;
    /** 遗留数据检测：读不出来只记日志，不影响清理。 */
    private detectLegacy;
    /** 重复文件扫描：默认根加上页面勾的其他盘。 */
    private scanDup;
    /** 页面的选择 → 本进程保存的候选、特殊规则、需管理员的目录；有任何一项不认识就整体拒绝（列表过期）。 */
    private plan;
    /** 真正动手：先整批提权（一次 UAC），再删普通文件，最后回收站。返回汇总与按分类的计数。 */
    private execute;
    /** 审计日志：按规则写一行；写失败只记告警，不影响清理结果。 */
    private writeLog;
    /** id → 本进程保存的候选；有任何一个找不到就整体拒绝（列表过期）。 */
    private pick;
    /**
     * 动过的项从结果里拿掉，避免页面再次提交同一批 id：单项按 id 去掉，整类选中的分类整类去掉
     * （跳过的文件也一起从列表里消失，重新扫描会再出现）。
     */
    private forget;
    /** 串行执行一个任务：占住 job，进度写进 job，结束时记 outcome / error 并发宠物事件。 */
    private run;
    /** 宠物反应：出错只记日志。 */
    private emit;
}
/** 清理结果 → 宠物气泡与面板的补充说明。 */
export declare function cleanNotes(outcome: CleanRunOutcome): string[];
