import { type CleanProgress, type CleanScanResult } from '../types.ts';
import type { CleanPlaces, FileIdentity } from '../safety.ts';
/** 默认大小下限：100 MB。 */
export declare const BIG_FILE_MIN_SIZE: number;
/** 扫描选项。 */
export interface BigFileScanOptions {
    /** 大小下限（字节），默认 100 MB。 */
    minSize?: number;
    /** 扫描根；缺省用用户主目录下的个人文件夹。 */
    roots?: string[];
    signal?: AbortSignal;
    onProgress?: (p: CleanProgress) => void;
}
/** 一个可搬的大文件：搬家时只认 id，按这里的路径和身份复核。 */
export interface BigFileCandidate {
    id: string;
    path: string;
    identity: FileIdentity;
    categoryId: string;
}
/**
 * 扫描大文件。
 *
 * @returns result 给页面；candidates 留在宿主侧，搬家时按 id 取（只含列出来的项）。
 */
export declare function scanBigFiles(places: CleanPlaces, options?: BigFileScanOptions): Promise<{
    result: CleanScanResult;
    candidates: Map<string, BigFileCandidate>;
}>;
