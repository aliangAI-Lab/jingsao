import { type ConfigPaths } from './config.ts';
import type { HttpRouteHandler } from './plugin/http-route.ts';
/** 记录上次见过的安装时刻的文件。 */
export declare const installStampPath: (userRoot: string) => string;
/** 插件包目录的创建时刻（毫秒，取整成字符串）；拿不到创建时刻的文件系统退回 ctime。 */
export declare function installStampOf(packageRoot: string): string;
/** 重装检查的结果（只用于日志与测试）。 */
export type ReinstallRestoreResult = 'same-install' | 'nothing-hidden' | 'restored' | 'failed';
/** 依赖：都由 index.ts 装配好传进来，测试注入假的。 */
export interface ReinstallRestoreDeps {
    userRoot: string;
    packageRoot: string;
    configPaths: ConfigPaths;
    /** HTTP 路由同一份处理函数（叫回走 POST /pet-restore）。 */
    handle: HttpRouteHandler;
    log: {
        info?: (message: string) => void;
        warn?: (message: string) => void;
    };
}
/**
 * 是新安装就把全部收起的鲸鱼娘叫回桌面（见模块说明）。
 */
export declare function restoreAfterReinstall(deps: ReinstallRestoreDeps): Promise<ReinstallRestoreResult>;
