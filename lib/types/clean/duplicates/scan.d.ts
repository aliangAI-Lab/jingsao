import { type CleanProgress, type CleanScanResult } from '../types.ts';
import type { CleanPlaces } from '../safety.ts';
import type { DeleteCandidate } from '../delete/types.ts';
/** 默认大小下限：1 MB。 */
export declare const DUPLICATE_MIN_SIZE: number;
/** 默认最多给页面的组数。 */
export declare const DUPLICATE_MAX_GROUPS = 300;
/** 部分哈希读头尾各多少字节。 */
export declare const PARTIAL_BYTES: number;
/** 扫描选项。 */
export interface DuplicateScanOptions {
    /** 扫描根；缺省用用户主目录下的个人文件夹。在系统盘以外的根会自动放开「其他盘」。 */
    roots?: string[];
    /** 大小下限（字节），默认 1 MB。 */
    minSize?: number;
    signal?: AbortSignal;
    onProgress?: (p: CleanProgress) => void;
    /** 最多给页面的组数（按浪费的空间降序），默认 300。 */
    maxGroups?: number;
}
/** 一个重复文件候选：直接沿用删除流程的 DeleteCandidate。 */
export type DupCandidate = DeleteCandidate;
/** 部分哈希：头尾各 PARTIAL_BYTES；文件不大于两段之和时就是全量内容的哈希。 */
export declare function partialHash(path: string, size: number): Promise<string>;
/**
 * 扫描重复文件。
 *
 * @returns result 给页面；candidates 留在宿主侧按 id 取；groups 是组 id → 组内全部（列出的）item id，
 *   用 {@link checkDuplicateSelection} 保证每组至少留一份。
 */
export declare function scanDuplicates(places: CleanPlaces, options?: DuplicateScanOptions): Promise<{
    result: CleanScanResult;
    candidates: Map<string, DupCandidate>;
    groups: Map<string, string[]>;
}>;
/**
 * 检查一次删除选择：选了本次扫描以外的 id，或有任何一组被全选，就返回原因；可以删返回 null。
 */
export declare function checkDuplicateSelection(groups: Map<string, string[]>, selectedIds: string[]): string | null;
