import { type CleanPlaces } from '../safety.ts';
import { type ElevatedRunner } from '../software/script.ts';
import type { AdminDir, DeleteCandidate, DeleteTally } from './types.ts';
/** 提权子进程要做的一整批事。 */
export interface ElevatedManifest {
    /** 扫描时已经记下身份的文件。 */
    files: DeleteCandidate[];
    /** 扫描时读不到的根目录：在子进程里自己枚举。 */
    dirs: AdminDir[];
    /** 要跑的系统命令（目前只有传递优化缓存）。 */
    commands: Array<'delivery-opt'>;
}
/** 提权子进程的结果。 */
export interface ElevatedCleanResult {
    /** 分类 id → 计数。 */
    rules: Record<string, DeleteTally>;
    /** 系统命令 → 是否成功。 */
    commands: Record<string, {
        ok: boolean;
        error?: string | null;
    }>;
}
/** 提权清理执行器：拒绝提权时抛错（调用方据此跳过系统规则）。 */
export type ElevatedCleaner = (manifest: ElevatedManifest) => Promise<ElevatedCleanResult>;
/** 拒绝提权时抛的错误：调用方据此区分「用户没同意」与「脚本出错」。 */
export declare class ElevationDenied extends Error {
    constructor(message?: string);
}
/** 候选 → 清单行（制表符分隔；Windows 路径里不会出现制表符和换行）。 */
export declare function manifestLines(manifest: ElevatedManifest): string[];
/**
 * 提权清理脚本：逐行读清单，复核后删除，结果写回 JSON。
 * 任何一个文件出错只计入该规则的跳过数，不影响其它文件；整个脚本出错写 ok=false。
 */
export declare function buildCleanScript(manifestFile: string, resultFile: string): string;
/** 真实执行器的构造参数。 */
export interface RealElevatedCleanerOptions {
    /** 脚本、清单与结果文件放哪（插件数据目录下）。 */
    workDir: string;
    /** 提权执行器（软件搬家的同一个）；测试里换成普通权限运行。 */
    runner: ElevatedRunner;
}
/**
 * 真实提权清理：写清单与脚本 → 提权运行一次 → 读结果 → 删掉临时文件。
 * 执行器报错（用户点了「否」）时抛 {@link ElevationDenied}。
 */
export declare function realElevatedCleaner(options: RealElevatedCleanerOptions): ElevatedCleaner;
/**
 * 模拟提权：同进程按同样的约束删（测试与测试模式用），不弹 UAC。
 * 测试根以外的任何路径一律跳过。
 */
export declare function simulatedElevatedCleaner(places: CleanPlaces): ElevatedCleaner;
