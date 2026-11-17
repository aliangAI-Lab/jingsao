import { type CleanPlaces } from '../safety.ts';
import type { CleanFeature } from '../types.ts';
/** 日志保留天数。 */
export declare const CLEAN_LOG_KEEP_DAYS = 30;
/** 日志里的一行。 */
export interface CleanLogEntry {
    /** 写入时刻（epoch 毫秒）。 */
    time: number;
    feature: CleanFeature;
    /** 规则 id（微信QQ = 分类 id，重复文件 = duplicates）。 */
    ruleId: string;
    files: number;
    bytes: number;
    skipped: number;
}
/** 读日志；文件不存在或坏行一律跳过。 */
export declare function readCleanLog(file: string): CleanLogEntry[];
/**
 * 追加一批记录并裁掉 30 天以前的旧行。
 * @param file - 日志文件（测试模式下必须在测试根里）。
 * @param entries - 本批记录。
 * @param places - 位置表（只用来判断测试根）。
 * @param now - 当前时刻。
 */
export declare function appendCleanLog(file: string, entries: readonly CleanLogEntry[], places: CleanPlaces, now: number): void;
