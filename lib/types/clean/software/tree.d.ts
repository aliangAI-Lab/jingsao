import { type CopyOptions } from '../bigfiles/copy.ts';
/** 树里的一个文件。 */
export interface TreeFile {
    /** 相对树根的路径。 */
    rel: string;
    size: number;
    mtimeMs: number;
}
/** 一次遍历的结果。 */
export interface TreeScan {
    files: TreeFile[];
    /** 子目录（相对路径，父目录在前）及其修改时间。 */
    dirs: Array<{
        rel: string;
        mtimeMs: number;
    }>;
    /** 树里的链接或联接（相对路径）。 */
    links: string[];
    bytes: number;
    /** false = 到了截止时间提前停下，bytes 只是下限。 */
    complete: boolean;
}
/** 遍历选项。 */
export interface TreeScanOptions {
    signal?: AbortSignal;
    /** 截止时间（epoch 毫秒）；到点就停，complete = false。 */
    deadline?: number;
    /** false = 只算大小，不收集文件清单（列表统计用，省内存）。 */
    collect?: boolean;
    /** true = 读不了的目录跳过并把 complete 记为 false（列表统计用）；默认直接抛错。 */
    tolerant?: boolean;
}
/** 只读遍历目录树，不跟随链接。 */
export declare function scanTree(root: string, options?: TreeScanOptions): Promise<TreeScan>;
/** 复制单个文件的函数（可注入，测试用来模拟复制中途出错）。 */
export type CopyFileFn = (src: string, dest: string, options: CopyOptions) => Promise<string>;
/**
 * 按遍历结果把 src 树复制进已存在的空目录 dest，保留文件与目录的修改时间。
 *
 * @returns 每个文件（相对路径）的源 sha256。
 */
export declare function copyTree(src: string, dest: string, scan: TreeScan, options?: CopyOptions & {
    copyFile?: CopyFileFn;
}): Promise<Map<string, string>>;
/**
 * 校验复制结果：文件清单一致、每个文件大小一致，并抽样比对哈希（最大的几个 + 均匀分布的几个）。
 * 不一致时抛出可读原因。
 */
export declare function verifyTree(dest: string, scan: TreeScan, hashes: Map<string, string>, signal?: AbortSignal): Promise<void>;
