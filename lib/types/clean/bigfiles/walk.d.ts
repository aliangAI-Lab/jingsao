import { type CleanPlaces, type FileIdentity } from '../safety.ts';
/** 文件类型（分类与重复文件分组共用）。 */
export type FileType = 'installer' | 'archive' | 'video' | 'audio' | 'image' | 'document' | 'other';
/** 类型 → 给普通人看的名字。 */
export declare const FILE_TYPE_LABEL: Record<FileType, string>;
/** 目录名是否整棵跳过：隐藏（. 开头）、跳过名单、OneDrive 同步目录（读文件会触发下载）、本插件的备份。 */
export declare function skipDirName(name: string): boolean;
/**
 * 判定文件类型；返回 null = 程序或库文件（不碰）。
 * 安装包扩展名只在下载 / 桌面 / 文档里算安装包，别处一律当程序文件。
 */
export declare function classifyFile(path: string, places: CleanPlaces): FileType | null;
/** 默认扫描根：用户主目录下所有非隐藏、非链接、不在跳过名单里的一级目录（桌面、下载、文档……都在其中）。 */
export declare function defaultUserRoots(places: CleanPlaces): Promise<string[]>;
/** 遍历到的一个候选文件。 */
export interface WalkedFile {
    path: string;
    type: FileType;
    identity: FileIdentity;
}
/** 遍历选项。 */
export interface WalkOptions {
    /** 只要不小于这个字节数的文件。 */
    minSize: number;
    signal?: AbortSignal;
    /** 允许 places.drive 以外的盘（重复文件扫别的盘时打开）。 */
    allowOtherDrives?: boolean;
    /** 每看完一个目录回调一次（进度用）。 */
    onDir?: (dir: string, seenFiles: number) => void;
}
/**
 * 只读遍历：对每个符合条件的普通文件（单一硬链接、不小于 minSize、不是程序文件、过安全闸）调用 visit。
 * 读不了的目录静默跳过；取消时抛出 signal 的原因。
 *
 * @returns 看过的文件总数（含不符合条件的）。
 */
export declare function walkUserFiles(roots: string[], places: CleanPlaces, options: WalkOptions, visit: (file: WalkedFile) => void): Promise<number>;
/** 字节数 → 「1.5 GB」这样的可读文字。 */
export declare function formatBytes(bytes: number): string;
