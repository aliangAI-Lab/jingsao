/** 复制选项。 */
export interface CopyOptions {
    signal?: AbortSignal;
    /** 每写一块回调一次（字节数增量）。 */
    onBytes?: (delta: number) => void;
}
/**
 * 把 src 流式复制到 dest（dest 必须不存在），同时算出源数据的 sha256。
 * 失败时删掉自己建出来的不完整目标；dest 原本就存在时直接失败，不碰它。
 *
 * @returns 源数据的 sha256（十六进制）。
 */
export declare function copyWithHash(src: string, dest: string, options?: CopyOptions): Promise<string>;
/** 流式算一个文件的 sha256（十六进制）。 */
export declare function hashFile(path: string, signal?: AbortSignal): Promise<string>;
/** 路径（含链接本身）是否存在。 */
export declare function pathExists(path: string): boolean;
/** 目标已存在时加「 (1)」「 (2)」……后缀，返回第一个不存在的路径。 */
export declare function uniquePath(path: string): string;
/** 从 start 往上逐级删空目录，直到 stop（不含 stop）；遇到非空目录就停。尽力而为，不抛错。 */
export declare function removeEmptyParents(start: string, stop: string): Promise<void>;
