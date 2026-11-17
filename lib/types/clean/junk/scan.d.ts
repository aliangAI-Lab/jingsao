import { type CleanPlaces } from '../safety.ts';
import { type CleanProgress, type CleanScanResult } from '../types.ts';
import type { AdminDir, DeleteCandidate } from '../delete/types.ts';
import type { SystemOps } from '../delete/system-ops.ts';
import { type JunkRule } from './rules.ts';
/** 进度与取消通过调用方传入，宿主可以同时保持页面响应。 */
export interface JunkScanOptions {
    signal?: AbortSignal;
    onProgress?: (progress: CleanProgress) => void;
    rules?: JunkRule[];
    /** 回收站、传递优化缓存的大小来源；缺省时这两类只按目录估算（回收站为 0）。 */
    systemOps?: SystemOps;
}
/** 扫描产物。 */
export interface JunkScanOutput {
    result: CleanScanResult;
    /** 全量候选（页面只列每类最大的若干个）。 */
    candidates: Map<string, DeleteCandidate>;
    /** 需要管理员、扫描时读不到的根目录。 */
    adminDirs: AdminDir[];
    /** 分类 id → 规则（服务层据此决定提权、系统命令与更新检查）。 */
    rules: Map<string, JunkRule>;
}
/** 文件名模式 → 正则（只认 *，不分大小写）。 */
export declare function fileMatcher(pattern: string): RegExp;
/** 候选保留全量，页面列表截断只影响展示，分类清理仍能取得全部文件。 */
export declare function scanJunk(places: CleanPlaces, options?: JunkScanOptions): Promise<JunkScanOutput>;
