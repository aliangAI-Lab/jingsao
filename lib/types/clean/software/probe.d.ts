/** 注册表里的一个已安装软件（安装目录已推好；推不出时为 undefined）。 */
export interface InstalledApp {
    /** 注册表键全名。 */
    key: string;
    name: string;
    publisher?: string;
    installDir?: string;
    systemComponent?: boolean;
    uninstall?: string;
}
/** 可注入的系统探针。 */
export interface SoftwareProbe {
    listInstalled(): Promise<InstalledApp[]>;
    /** 正在运行进程的完整 exe 路径。 */
    runningExecutables(): Promise<string[]>;
    /** 所有 Windows 服务（含驱动）的可执行文件路径。 */
    serviceImagePaths(): Promise<string[]>;
}
/** 注册表卸载项的原始字段。 */
export interface UninstallRaw {
    key: string;
    name?: string | null;
    publisher?: string | null;
    installLocation?: string | null;
    displayIcon?: string | null;
    uninstall?: string | null;
    systemComponent?: number | string | null;
}
/**
 * 从命令行里取出 exe 路径：带引号取引号内，不带引号取到第一个 .exe 为止；
 * 处理 \??\ 前缀与 %VAR%。取不出绝对路径返回 null。
 */
export declare function exePathFromCommand(command: string | null | undefined): string | null;
/**
 * 从卸载项推安装目录：InstallLocation → DisplayIcon（只认 .exe）→ UninstallString（只认卸载程序）。
 * 推不出返回 undefined。
 */
export declare function installDirFromRegistry(raw: Pick<UninstallRaw, 'installLocation' | 'displayIcon' | 'uninstall'>): string | undefined;
/** 卸载项原始字段 → InstalledApp；没有名字的返回 null。 */
export declare function appFromRaw(raw: UninstallRaw): InstalledApp | null;
/** 解析 powershell ConvertTo-Json 的输出：空 → []，单个对象 → [对象]。 */
export declare function parseJsonList<T>(text: string): T[];
/** 运行一段 powershell 脚本（UTF-16LE base64 传入，输出强制 UTF-8），返回标准输出。 */
export declare function runPowerShell(script: string, timeoutMs?: number): Promise<string>;
/** 真实探针：powershell 读注册表卸载项、Win32_Process、Win32_Service / Win32_SystemDriver。 */
export declare function realSoftwareProbe(run?: (script: string) => Promise<string>): SoftwareProbe;
