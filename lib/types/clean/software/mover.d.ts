import type { CleanProgress, MoveRecord } from '../types.ts';
import { type CleanPlaces } from '../safety.ts';
import type { SoftwareProbe } from './probe.ts';
import { type ElevatedRunner } from './script.ts';
import { type CopyFileFn } from './tree.ts';
/** 软件在目标下的子目录名。 */
export declare const SOFTWARE_DIR_NAME = "\u8F6F\u4EF6";
/** 原目录改名后的后缀。 */
export declare const BACKUP_SUFFIX = ".jingsao-bak";
/** 还原时临时目录的后缀。 */
export declare const RESTORE_SUFFIX = ".jingsao-restore";
/** 可替换的底层动作（测试用来模拟中途出错或强制走提权路径）。 */
export interface MoverOps {
    copyFile: CopyFileFn;
    /** 在 path 建指向 target 的目录联接。 */
    link: (target: string, path: string) => Promise<void>;
    /** 改动 dir 是否需要管理员权限。 */
    needsElevation: (dir: string) => Promise<boolean>;
}
/** 构造入参。 */
export interface SoftwareMoverOptions {
    places: CleanPlaces;
    /** 记录 JSON 的绝对路径。 */
    file: string;
    probe: SoftwareProbe;
    now?: () => number;
    /** 提权执行器；不给时需要提权的搬家直接记失败。 */
    elevate?: ElevatedRunner;
    /** 替换底层动作（测试用）。 */
    ops?: Partial<MoverOps>;
    /** 提权脚本与结果文件放哪；默认记录文件旁的 elevated 目录。 */
    workDir?: string;
}
/** 搬家 / 还原的运行选项。 */
export interface SoftwareRunOptions {
    signal?: AbortSignal;
    onProgress?: (p: CleanProgress) => void;
}
export declare class SoftwareMover {
    private readonly places;
    private readonly records;
    private readonly probe;
    private readonly now;
    private readonly elevate;
    private readonly ops;
    private readonly workDir;
    private busy;
    private seq;
    constructor(options: SoftwareMoverOptions);
    /** 全部软件搬家记录（新的在前）。 */
    history(): MoveRecord[];
    /**
     * 搬一个软件。不能搬（找不到、被拦、正在运行、目标不可用、正忙、只读）时直接抛错，什么都没动；
     * 执行中失败时已回滚，返回 failed 记录。
     */
    move(entryId: string, destRoot: string, options?: SoftwareRunOptions): Promise<MoveRecord>;
    /**
     * 还原一个软件：原位置的联接换回真实目录，删掉搬过去的目录。
     * 记录不能还原、原位置不是当初的联接、程序在运行、空间不够时直接抛错；执行中失败已回滚，返回带 error 的记录（仍是 moved）。
     */
    restore(recordId: string, options?: SoftwareRunOptions): Promise<MoveRecord>;
    private exclusive;
    private newId;
    /** 按 id 重新找到并完整评估一个软件（含实时的运行状态与完整大小）。 */
    private findEntry;
    /** 普通权限下搬家。 */
    private moveDirect;
    /** 普通权限下还原。 */
    private restoreDirect;
    /** 原位置已经是真实目录：记 restored，再删搬过去的目录（删不掉只留提示）。 */
    private finishRestore;
    /** 准备提权脚本的文件路径。 */
    private elevatedFiles;
    /** 需要管理员权限时搬家：生成脚本 → 提权运行 → 读结果 → 复核联接。 */
    private moveElevated;
    /** 需要管理员权限时还原。 */
    private restoreElevated;
}
