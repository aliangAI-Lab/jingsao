import type { MoveRecord } from '../types.ts';
/** 记录文件格式版本。 */
export declare const MOVE_RECORD_VERSION = 1;
/** 一份记录文件的内存副本与原子写。 */
export declare class RecordFile {
    private readonly file;
    private records;
    constructor(file: string);
    /** 同步读入；不存在返回空，坏文件改名为 .broken-<时间> 留底后返回空。 */
    private static load;
    /** 全部记录的副本（新的在前）。 */
    list(): MoveRecord[];
    /** 按 id 取一条（副本）。 */
    get(id: string): MoveRecord | null;
    /** 新增或按 id 替换一条，并原子落盘。 */
    put(record: MoveRecord): Promise<void>;
}
