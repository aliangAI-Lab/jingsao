import { type CleanPlaces } from '../safety.ts';
/** 搬家文件夹名：所有搬过去的东西都放在目标下的这个目录里。 */
export declare const MOVE_DIR_NAME = "\u9CB8\u626B\u642C\u5BB6";
/** 目标盘至少要多留的空间（字节）。 */
export declare const DEST_RESERVE_BYTES: number;
/** 从 path 往上找第一个存在的路径；都不存在返回 null。 */
export declare function existingAncestor(path: string): string | null;
/**
 * 目标位置为什么不能用；返回 null = 可以用。
 *
 * @param destRoot - 用户选的目标文件夹（可以还不存在，但所在盘必须存在）。
 * @param places - 位置表。
 * @param needBytes - 本次要搬的总字节数；给了就检查可用空间。
 * @returns 不能用的原因（给普通人看），或 null。
 */
export declare function checkDestination(destRoot: string, places: CleanPlaces, needBytes?: number): string | null;
