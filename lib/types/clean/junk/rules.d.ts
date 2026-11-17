import type { CleanTier } from '../types.ts';
/** 规则的基础目录：用户级三个 + 系统级四个（都从环境变量推导，测试模式整体换进测试根）。 */
export type JunkBase = 'local' | 'roaming' | 'home' | 'windows' | 'programdata' | 'systemdrive' | 'programfilesx86';
/** 面板分组：应用程序 / 系统相关 / 缓存文件 / 临时文件 / 开发工具缓存 / 回收站。 */
export type JunkGroup = 'app' | 'system' | 'cache' | 'temp' | 'dev' | 'recycle';
/** 全部分组（面板按这个顺序排）。 */
export declare const JUNK_GROUPS: readonly JunkGroup[];
/** 不直接删文件、改用系统官方命令的特殊规则。 */
export type JunkSpecial = 'delivery-opt' | 'recycle-bin';
/** 动手前要先过的系统检查：windows-update = Windows 更新正在下载或安装时整条跳过。 */
export type JunkGuard = 'windows-update';
/** 单个位置的细化写法：同一条规则里不同位置的文件模式、年龄可以不同。 */
export interface JunkPathSpec {
    /** 相对 base 的路径（规则同 paths 的字符串写法）。 */
    path: string;
    /** 只认这些文件名模式（只支持 *）；缺省沿用规则级 files。 */
    files?: string[];
    /** 只删这么多天以前修改的；缺省沿用规则级 ageDays。 */
    ageDays?: number;
    /** true = path 指向单个文件（例如 Windows\MEMORY.DMP），不是目录。 */
    single?: boolean;
}
/** 将风险说明与目录范围放在一起，便于页面解释每一次选择。 */
export interface JunkRule {
    id: string;
    label: string;
    /** 风险档位：用于排序和颜色。 */
    tier: CleanTier;
    /** 面板分组。 */
    group: JunkGroup;
    /** 扫描后是否默认勾选；false = 用户自己勾的风险项，点清理前要就地确认。 */
    defaultChecked: boolean;
    /** 目标在 Windows / ProgramData / Program Files 下，需要管理员权限（整批一次提权）。 */
    needsAdmin: boolean;
    base: JunkBase;
    paths: Array<string | JunkPathSpec>;
    files?: string[];
    ageDays?: number;
    /** 只删修改时间早于 N 小时的文件（临时目录一律 24）。 */
    minAgeHours?: number;
    /** 勾选时在面板里显示的一句风险提示。 */
    warn?: string;
    /** 不删文件、调系统官方命令的规则；paths 只用来估算大小。 */
    special?: JunkSpecial;
    /** 动手前的系统检查。 */
    guard?: JunkGuard;
    /** 通配符展开时跳过的目录名（不分大小写），例如英伟达下载包里的 latest。 */
    skipDirs?: string[];
    /** 根目录里（含子目录）至少要有一个文件匹配这些模式才算数（驱动解压目录要有 setup.exe 或 *.inf）。 */
    marker?: string[];
    explanation: string;
    basis: string;
}
/** 调用方注入的规则也走同一校验，避免测试入口绕过目录边界。 */
export declare function validateJunkRules(value: unknown): JunkRule[];
/** 每次返回独立副本，避免调用者修改后影响后续扫描。 */
export declare function loadJunkRules(): JunkRule[];
/** 位置的统一写法（字符串展开成细化写法）。 */
export declare function pathSpecs(rule: JunkRule): JunkPathSpec[];
