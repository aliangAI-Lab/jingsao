import type { CleanProgress, MoveRecord } from '../types.ts';
import { type CleanPlaces } from '../safety.ts';
import type { BigFileCandidate } from './scan.ts';
/** 大文件在目标下的子目录名。 */
export declare const BIG_FILE_DIR_NAME = "\u5927\u6587\u4EF6";
/** 构造入参。 */
export interface MoveStoreOptions {
    places: CleanPlaces;
    /** 记录 JSON 的绝对路径（父目录不存在时自动创建）。 */
    file: string;
    /** 时间源；测试注入固定时钟。 */
    now?: () => number;
}
/** 搬家 / 还原的运行选项。 */
export interface MoveRunOptions {
    signal?: AbortSignal;
    onProgress?: (p: CleanProgress) => void;
}
export declare class MoveStore {
    private readonly places;
    private readonly records;
    private readonly now;
    /** 正在搬或正在还原。 */
    private busy;
    /** 同一毫秒内多条记录的序号。 */
    private seq;
    constructor(options: MoveStoreOptions);
    /** 全部搬家记录（新的在前）。 */
    history(): MoveRecord[];
    /**
     * 把选中的大文件搬到 destRoot\鲸扫搬家\大文件\ 下（保留相对用户目录的结构）。
     * 目标不可用、正忙、只读模式时直接抛错（什么都没动）；单个文件失败记 failed 并继续下一个；
     * 取消后不再处理剩下的文件。
     *
     * @returns 本次处理过的每个文件的记录。
     */
    moveFiles(candidates: BigFileCandidate[], destRoot: string, options?: MoveRunOptions): Promise<MoveRecord[]>;
    /**
     * 按记录把文件搬回原位。只处理 bigfiles 且状态为 moved 的记录，其余 id 跳过。
     * 失败的记录保持 moved（文件还在新位置）并带上 error。
     *
     * @returns 处理过的记录的最新状态。
     */
    restore(recordIds: string[], options?: MoveRunOptions): Promise<MoveRecord[]>;
    /** 互斥执行：只读模式与正忙时拒绝。 */
    private exclusive;
    private newId;
    /** 搬一个文件；失败不抛，返回 failed 记录。 */
    private moveOne;
    /** 还原一个文件；失败不抛，返回带 error 的记录（状态仍是 moved）。 */
    private restoreOne;
}
