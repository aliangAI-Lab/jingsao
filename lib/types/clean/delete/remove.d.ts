import { type CleanPlaces, type DenyOptions } from '../safety.ts';
import type { CleanFeature, CleanProgress } from '../types.ts';
import type { DeleteCandidate, DeleteTally, SkipReason } from './types.ts';
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
export declare function skipReason(error: unknown): SkipReason;
/**
 * 逐个复核并删除。取消只在文件之间生效：已经删掉的不会回来，剩下的原样保留。
 * @param items - 本进程保存的候选（路径来自扫描，不来自页面）。
 * @param places - 位置表（测试模式下所有位置都在测试根里）。
 */
export declare function removeCandidates(items: readonly DeleteCandidate[], places: CleanPlaces, options: RemoveOptions): Promise<RemoveOutcome>;
