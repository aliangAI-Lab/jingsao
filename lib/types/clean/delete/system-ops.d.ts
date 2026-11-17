import type { CleanPlaces } from '../safety.ts';
/** 「用系统方式清理」能做的事（只报告的分类上那个按钮）。 */
export type SystemAction = 'winsxs' | 'windows-old';
/** 系统能力的接口（可注入；测试用假的）。 */
export interface SystemOps {
    /** 系统盘回收站里的总字节；读不到返回 null。 */
    recycleBinBytes(): Promise<number | null>;
    /** 清空系统盘回收站（Clear-RecycleBin）。 */
    clearRecycleBin(): Promise<void>;
    /** 传递优化缓存的字节（Get-DeliveryOptimizationStatus 汇总）；读不到返回 null，调用方再按目录估算。 */
    deliveryCacheBytes(): Promise<number | null>;
    /** Windows 更新是否正在下载或安装（正在忙就跳过更新下载缓存）。 */
    windowsUpdateBusy(): Promise<boolean>;
    /** 打开系统自带的清理方式，由用户在系统界面里确认（UAC 或设置页）。 */
    launch(action: SystemAction): Promise<void>;
}
/**
 * 真实系统能力。
 * @param drive - 系统盘根（例如 C:\）；回收站只统计、只清这一个盘。
 */
export declare function realSystemOps(drive: string): SystemOps;
/** 测试用的系统能力：回收站 = 测试根下的 $Recycle.Bin 目录；更新忙 = 测试根下有 .wu-busy 文件。 */
export interface TestSystemOps extends SystemOps {
    /** 点过的系统方式（测试断言用）。 */
    launched: SystemAction[];
}
/** 测试模式的系统能力：只在测试根里模拟，不调任何系统命令。 */
export declare function testSystemOps(places: CleanPlaces): TestSystemOps;
