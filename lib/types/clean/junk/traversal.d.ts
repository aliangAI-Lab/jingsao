/**
 * 分批遍历让扫描可以响应取消，目录联接在展开和递归两处都受检查。
 * 文件是否可以清理由安全闸决定，此处只负责只读枚举；读不到的目录（多半需要管理员）交给 onDenied 记下。
 * @module jingsao/src/host/clean/junk/traversal
 */
import { type Stats } from 'node:fs';
import { type CleanPlaces, type DenyOptions } from '../safety.ts';
/** 遍历选项。 */
export interface TraversalOptions {
    signal?: AbortSignal;
    /** 安全闸放行范围（系统规则带 systemRoots）。 */
    deny?: DenyOptions;
    /** 读目录时没有权限（EPERM / EACCES）：记下这个目录。 */
    onDenied?: (path: string) => void;
    /** 通配符展开时跳过的目录名（不分大小写）。 */
    skipDirs?: readonly string[];
    /** 文件列出来了但读不到属性（多半是权限或刚被删）。 */
    onStatError?: (path: string) => void;
}
/**
 * 通配符仅展开一层，避免规则获得隐含的全盘遍历能力。
 * 基础目录做一次完整的逐级链接复核；往下展开时用目录列表里的类型（重解析点标成链接）跳过链接，
 * 固定名字的一级用一次 lstat 确认是普通目录。
 */
export declare function expandRoots(base: string, pattern: string, places: CleanPlaces, options?: TraversalOptions): AsyncGenerator<string>;
/**
 * 只报告目录也拒绝链接，避免系统统计绕到其他盘或形成循环。
 *
 * 根目录先做一次完整的逐级链接复核（noLinks）；往下走时，子项的类型直接取目录列表里的类型：
 * Windows 上符号链接、目录联接等所有重解析点在列表里都标成链接，一律跳过、不进入，
 * 所以从已复核的根往下走到的每一级都不是链接，不必再对每个文件逐级 lstat + realpath。
 * 每个文件只读一次 lstat，拿到大小、时间和硬链接数。动手时仍由 inspectCandidate 完整复核。
 */
export declare function walkFiles(root: string, places: CleanPlaces, options?: TraversalOptions & {
    reportOnly?: boolean;
}): AsyncGenerator<{
    path: string;
    stat: Stats;
}>;
