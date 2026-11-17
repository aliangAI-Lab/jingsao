import { type CleanPlaces } from '../safety.ts';
import type { DeleteCandidate } from '../delete/types.ts';
import { type CleanProgress, type CleanScanResult } from '../types.ts';
import { type ChatAccount } from './apps.ts';
/** 扫描参数。 */
export interface ChatScanOptions {
    signal?: AbortSignal;
    onProgress?: (p: CleanProgress) => void;
    /** 只要这么多天以前修改的文件；缺省 / 0 = 不限。 */
    olderThanDays?: number;
    /** 测试注入：替代自动发现的账号。 */
    accounts?: ChatAccount[];
    now?: () => number;
}
/** 扫描本机聊天软件的可清理文件。 */
export declare function scanChatApps(places: CleanPlaces, options?: ChatScanOptions): Promise<{
    result: CleanScanResult;
    candidates: Map<string, DeleteCandidate>;
}>;
