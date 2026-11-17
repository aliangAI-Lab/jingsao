import type { CleanFeature, CleanProgress, CleanScanResult, LegacyStagingSummary, MoveRecord, SoftwareEntry } from '../../host/clean/types.ts';
export type { CleanCategory, CleanFeature, CleanItem, CleanRunOutcome, CleanScanResult, LegacyStagingSummary, MoveRecord, SoftwareEntry, } from '../../host/clean/types.ts';
/** 宿主任务（与 host CleanJob 同形，页面只读）。 */
export interface CleanJobView {
    id: string;
    feature: CleanFeature;
    action: string;
    startedAt: number;
    finishedAt?: number;
    /** 预计处理的字节（清理 = 勾选总量，搬家 = 搬走总量）。 */
    estimateBytes?: number;
    progress: CleanProgress;
    outcome?: unknown;
    error?: string;
}
/** 搬家目标盘。 */
export interface DriveView {
    root: string;
    total: number | null;
    free: number | null;
}
/** GET /clean/status。 */
export interface CleanStatusView {
    disk: {
        root: string;
        total: number | null;
        free: number | null;
    };
    job: CleanJobView | null;
    scans: Partial<Record<CleanFeature, {
        scanId: string;
        finishedAt: number;
        totalBytes: number;
    }>>;
    /** 上个版本暂存区里还留着的东西；没有为 null。 */
    legacy: LegacyStagingSummary | null;
    moves: MoveRecord[];
    drives: DriveView[];
    readOnly: boolean;
}
/** 调用结果。 */
export type Reply<T> = ({
    ok: true;
} & T) | {
    ok: false;
    message: string;
};
/** 状态快照。 */
export declare const fetchStatus: () => Promise<Reply<CleanStatusView>>;
/** 某功能的完整扫描结果。 */
export declare const fetchResult: (feature: CleanFeature) => Promise<Reply<{
    result: CleanScanResult | null;
}>>;
/** 软件列表。 */
export declare const fetchSoftware: () => Promise<Reply<{
    software: SoftwareEntry[];
}>>;
/** 开始扫描。 */
export declare const startScan: (feature: CleanFeature, options?: {
    minSize?: number;
    olderThanDays?: number;
    extraRoots?: string[];
}) => Promise<Reply<{
    job: CleanJobView;
}>>;
/** 取消当前任务。 */
export declare const cancelJob: () => Promise<Reply<object>>;
/** 立即清理：直接删除（不进回收站、不进暂存区）。 */
export declare const runClean: (feature: CleanFeature, ids: string[], categories: string[]) => Promise<Reply<{
    job: CleanJobView;
}>>;
/** 上个版本暂存区的遗留数据：彻底删除 / 原样放回。 */
export declare const settleLegacy: (mode: "purge" | "restore") => Promise<Reply<{
    job: CleanJobView;
}>>;
/** 只报告的系统大块头：用系统方式清理（打开系统自带的入口）。 */
export declare const systemAction: (action: "winsxs" | "windows-old") => Promise<Reply<object>>;
/** 大文件搬家。 */
export declare const moveFiles: (ids: string[], dest: string) => Promise<Reply<{
    job: CleanJobView;
}>>;
/** 大文件搬回。 */
export declare const restoreFiles: (ids: string[]) => Promise<Reply<{
    job: CleanJobView;
}>>;
/** 软件搬家 / 搬回。 */
export declare const softwareAction: (action: "move" | "restore", id: string, dest?: string) => Promise<Reply<{
    job: CleanJobView;
}>>;
/** 在资源管理器里定位。 */
export declare const reveal: (feature: CleanFeature, id: string) => Promise<Reply<object>>;
/** 字节 → 给人看的大小。 */
export declare function formatBytes(bytes: number | null | undefined): string;
