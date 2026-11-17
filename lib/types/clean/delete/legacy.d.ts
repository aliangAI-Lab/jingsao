import { type CleanPlaces } from '../safety.ts';
/** 一个还在暂存区里的文件。 */
export interface LegacyEntry {
    batchId: string;
    /** 原路径。 */
    path: string;
    /** 现在所在的暂存路径。 */
    stagedPath: string;
    size: number;
}
/** 遗留数据摘要（面板顶部提示用）。 */
export interface LegacySummary {
    files: number;
    bytes: number;
}
/** 处理结果。 */
export interface LegacyOutcome {
    files: number;
    bytes: number;
    /** 没能处理的文件数（被占用、没权限……），留在原处。 */
    failed: number;
    /** 放回时原路径已有同名文件、改名放在旁边的个数。 */
    renamed: number;
}
/** 列出全部还在暂存区里的文件。 */
export declare function listLegacy(places: CleanPlaces): LegacyEntry[];
/** 摘要：没有遗留文件时返回 null（面板不提示）。 */
export declare function legacySummary(places: CleanPlaces): LegacySummary | null;
/**
 * 处理全部遗留文件。
 * @param places - 位置表（测试模式下一切都在测试根里）。
 * @param mode - purge = 彻底删除；restore = 原样放回。
 * @param onProgress - 进度回调（已处理文件数、字节、当前文件名）。
 */
export declare function settleLegacy(places: CleanPlaces, mode: 'purge' | 'restore', onProgress?: (files: number, bytes: number, current: string) => void): Promise<LegacyOutcome>;
