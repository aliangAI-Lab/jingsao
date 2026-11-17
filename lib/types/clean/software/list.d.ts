import type { CleanProgress, SoftwareEntry } from '../types.ts';
import { type CleanPlaces } from '../safety.ts';
import type { InstalledApp, SoftwareProbe } from './probe.ts';
/** 小于这个大小的软件不值得搬。 */
export declare const SOFTWARE_MIN_SIZE: number;
/** 单个软件统计大小的默认时限（毫秒）。 */
export declare const SIZE_TIMEOUT_MS = 5000;
/** 列表选项。 */
export interface ListSoftwareOptions {
    signal?: AbortSignal;
    onProgress?: (p: CleanProgress) => void;
    /** 单个软件统计大小的时限；默认 5 秒。 */
    sizeTimeoutMs?: number;
}
/** 命中的关键词类别；没命中返回 null。 */
export declare function riskyKind(name: string, publisher: string | undefined, dir: string): string | null;
/** 安装目录 → 稳定的软件 id（同一目录每次扫描都一样）。 */
export declare function softwareId(dir: string): string;
/** 同一安装目录的注册表项合并后的结果。 */
export interface SoftwareCandidate {
    id: string;
    name: string;
    publisher?: string;
    installDir: string;
    /** 所有同目录的项都是系统组件。 */
    systemComponent: boolean;
}
/** 注册表项按安装目录去重，只留系统盘上的；同目录优先用非系统组件那一条的名字。 */
export declare function mergeInstalled(apps: InstalledApp[], places: CleanPlaces): SoftwareCandidate[];
/** 判定所需的系统现状。 */
export interface SoftwareContext {
    running: string[];
    services: string[];
}
/** 评估选项。 */
export interface EvaluateOptions {
    signal?: AbortSignal;
    /** 统计大小的截止时间；不给就统计完整。 */
    deadline?: number;
}
/** 正在运行、位于 dir 下的进程名（去重）。 */
export declare function runningIn(dir: string, running: string[]): string[];
/**
 * 评估一个软件：大小、能不能搬、正在运行的进程。目录不存在或不是目录返回 null。
 */
export declare function evaluateSoftware(candidate: SoftwareCandidate, places: CleanPlaces, context: SoftwareContext, options?: EvaluateOptions): Promise<SoftwareEntry | null>;
/** 读取系统现状；进程或服务读不出来时按空处理（真正搬的时候会再查一次）。 */
export declare function readContext(probe: SoftwareProbe, strict?: boolean): Promise<SoftwareContext>;
/**
 * 列出系统盘上的已安装软件，能搬的在前、按大小降序。
 */
export declare function listSoftware(places: CleanPlaces, probe: SoftwareProbe, options?: ListSoftwareOptions): Promise<SoftwareEntry[]>;
