/**
 * 清理与搬家共用的安全闸：位置表、永久保护名单、链接检查、候选文件复核、磁盘容量。
 *
 * 这里的判断独立于可编辑的规则数据：规则写错也越不过黑名单。任何会改动文件的模块，
 * 在动手前都必须对目标再调一次 {@link denied} 与 {@link noLinks}，不能只信扫描时的结论。
 * 系统目录（Windows / ProgramData / Program Files）默认整棵受保护，只有规则显式登记的根目录
 * （{@link DenyOptions.systemRoots}）才放行；即便放行，{@link FORBIDDEN_SYSTEM} 里「明确不做」的位置也永远拦下。
 * 测试模式（环境变量 JINGSAO_TEST_ROOT）把所有位置（含系统目录）换到一个非 C 盘的子目录里，
 * 配错时直接抛错，绝不会把改动落到真实系统盘。
 * @module jingsao/src/host/clean/safety
 */
import { type Stats } from 'node:fs';
/** 上个版本在非系统盘根下建的暂存目录名；任何层级出现都受保护（只剩遗留数据处理会读它）。 */
export declare const STAGING_DIR_NAME = ".jingsao-staging";
/** 一天的毫秒数；规则里的 ageDays 按它换算。 */
export declare const DAY_MS = 86400000;
/** 一小时的毫秒数；规则里的 minAgeHours 按它换算。 */
export declare const HOUR_MS = 3600000;
/** 运行期的各个位置；测试模式下全部落在测试根目录里。 */
export interface CleanPlaces {
    /** 测试根目录；null = 真实系统。 */
    test: string | null;
    /** 用户目录。 */
    home: string;
    /** %LOCALAPPDATA%。 */
    local: string;
    /** %APPDATA%。 */
    roaming: string;
    /** 「文档」目录（微信 / QQ 的默认数据位置）。 */
    documents: string;
    /** 被清理的盘根（真实系统为 C:\）。 */
    drive: string;
    /** %SystemRoot%（C:\Windows）。 */
    windows: string;
    /** %ProgramData%（C:\ProgramData）。 */
    programdata: string;
    /** %SystemDrive% 的根（C:\）。 */
    systemdrive: string;
    /** %ProgramFiles(x86)%（C:\Program Files (x86)）。 */
    programfilesx86: string;
    /** 上个版本的暂存区位置：现在只用于检测和处理遗留数据，清理不再往里放东西。 */
    legacyStaging: string;
    /** true = 只读模式：任何改动都拒绝。 */
    readOnly: boolean;
}
/** 环境变量 → 位置表；测试根目录落在 C 盘或是盘根时抛错。 */
export declare function locations(env?: NodeJS.ProcessEnv): CleanPlaces;
/** target 是否在 root 之内（含 root 本身）；大小写按 Windows 不敏感比较。 */
export declare function within(root: string, target: string): boolean;
/** 选项：哪些「用户数据」区域对本次调用是允许的。 */
export interface DenyOptions {
    /**
     * 允许进入用户自己的文件夹（文档/桌面/下载/图片/视频…）与聊天软件数据目录。
     * 只有微信QQ专清、重复文件、大文件搬家这类「用户明确选了文件」的功能才打开。
     */
    allowUserData?: boolean;
    /** 允许 drive 以外的盘（重复文件扫全盘、搬家目标盘）。 */
    allowOtherDrives?: boolean;
    /** 允许 Program Files 下的目录（只给软件搬家用）。 */
    allowProgramFiles?: boolean;
    /**
     * 规则显式登记的系统根目录（例如 C:\Windows\Temp）：目标落在其中之一时，
     * 「系统目录 / 软件安装目录整棵保护」对它放行。永久保护与「明确不做」的位置不受影响。
     */
    systemRoots?: readonly string[];
}
/**
 * 「明确不做」的系统位置：即使被手工塞进规则（或登记成 systemRoots）也一律拦下。
 * 理由写在 README「明确不做」一节：
 * - Windows\IME：系统受保护文件，删了可能影响系统更新和系统文件检查；
 * - Windows Defender 的扫描历史、保护历史、定义备份、隔离文件：安全软件自己管理，有防篡改保护，隔离文件删了无法还原；
 * - Windows\Installer（含 $PatchCache$）与 ProgramData\Package Cache：删了以后卸载或修复 Office、VC 运行库会要安装包；
 * - Windows\Prefetch：删了反而让开机和启动程序变慢，几乎不省空间；
 * - Windows\Fonts（字体缓存要停系统服务）、System32、SysWOW64、WinSxS、servicing、assembly：系统本体。
 * 路径相对于对应的系统目录（windows / programdata / systemdrive），比较时不分大小写。
 */
export declare const FORBIDDEN_SYSTEM: ReadonlyArray<{
    base: 'windows' | 'programdata' | 'systemdrive';
    path: string;
}>;
/** 目标是否落在「明确不做」的位置。 */
export declare function forbiddenSystem(target: string, places: CleanPlaces): boolean;
/**
 * 一条路径为什么不能动；返回 null 表示允许。
 * 顺序：明确不做 → 旧暂存区 → 系统目录（规则登记的根放行）→ 永久保护 → 系统文件 → 用户数据（视选项）→ 测试根 / 盘符范围。
 */
export declare function denied(target: string, places: CleanPlaces, options?: DenyOptions): string | null;
/** noLinks 选项。 */
export interface NoLinksOptions {
    /** 路径（或它的某一级祖先）不存在时不报错，直接返回。 */
    allowMissing?: boolean;
    /**
     * 同一批动手里已经复核过的祖先目录（小写路径）。命中的那一级不再重复 lstat + realpath；
     * 新复核通过的目录会加进来。只在一次清理批次内复用（remove 里最多信 1 秒），不跨批次保存；文件本身每次都完整复核。
     */
    verified?: Set<string>;
}
/**
 * 逐级 lstat 每个祖先：遇到符号链接、目录联接或实际路径跳转就抛错。
 * 防的是「扫描时是普通目录，动手时被换成指向别处的链接」。
 */
export declare function noLinks(target: string, options?: NoLinksOptions): void;
/** 文件身份：扫描时记下，动手前比对，变了就不动。 */
export interface FileIdentity {
    size: number;
    mtimeMs: number;
    ino: number;
    dev: number;
}
/** 复核选项。 */
export interface InspectOptions extends DenyOptions {
    /** 只处理这么多天以前修改的文件。 */
    ageDays?: number;
    /** 只处理这么多小时以前修改的文件（系统临时目录一律 24）。 */
    minAgeHours?: number;
    /** 扫描时记下的身份；给了就必须一致。 */
    previous?: FileIdentity;
    /** 文件必须位于这个根目录之内（不含根本身）。 */
    root?: string;
    /** 同一批动手里已复核过的祖先目录，见 NoLinksOptions.verified。 */
    verified?: Set<string>;
}
/**
 * 动手前对单个文件的完整复核：黑名单、根目录、链接、普通文件、单一硬链接、年龄、身份。
 * 通过则返回当前身份；任何一项不符都抛出可读原因。
 */
export declare function inspectCandidate(file: string, places: CleanPlaces, options?: InspectOptions): FileIdentity;
/**
 * 扫描用的轻量复核：调用方已经从一个复核过的根目录逐级往下走、每级都确认不是链接，
 * 并且手里有这个文件刚读到的 lstat。这里只做黑名单、根目录、普通文件、硬链接、年龄检查，
 * 不再逐级 lstat + realpath。动手时仍走 inspectCandidate 的完整复核。
 */
export declare function inspectScanned(file: string, stat: Stats, places: CleanPlaces, options?: InspectOptions): FileIdentity;
/** 盘容量（字节）；读不到时为 null。 */
export interface DiskSpace {
    total: number | null;
    free: number | null;
}
/** 读某个盘（或目录所在盘）的总容量与可用空间。 */
export declare function diskSpace(path: string): DiskSpace;
/** 文件操作错误码 → 给普通人看的原因。 */
export declare function errorText(error: unknown): string;
