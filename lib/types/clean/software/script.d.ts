/** 交给提权执行器的一次请求（软件搬家与垃圾清理的系统规则共用）。 */
export interface ElevatedRequest {
    action: 'move' | 'restore' | 'clean';
    /** 要运行的 .ps1（UTF-8 带 BOM）。 */
    scriptFile: string;
    /** 脚本写结果的 JSON 文件。 */
    resultFile: string;
    /** move：原目录；restore：原位置（现在是联接）；clean：待删清单文件。 */
    source: string;
    /** move：新目录；restore：搬过去的目录；clean：空串。 */
    target: string;
}
/** 提权执行器：以管理员身份运行脚本并等它结束（可注入；测试里用假的）。 */
export type ElevatedRunner = (request: ElevatedRequest) => Promise<void>;
/** 脚本写回的结果。 */
export interface ElevatedResult {
    ok: boolean;
    /** 停在哪一步。 */
    step?: string;
    error?: string | null;
    /** 成功但有尾巴（例如备份没删干净）。 */
    warning?: string | null;
}
/**
 * 搬家脚本：robocopy 复制 → 校验文件数与总大小 → 原目录改名为 .jingsao-bak → 建目录联接 → 校验 → 删备份。
 * 任何一步失败按相反顺序回滚（删联接、备份改回原名、删目标里的副本）。
 */
export declare function buildMoveScript(source: string, target: string, backup: string, resultFile: string): string;
/**
 * 还原脚本：确认原位置是联接 → robocopy 把搬过去的目录复制到原位置旁的临时目录 → 校验 →
 * 删联接（只删联接本身）→ 临时目录改成原名 → 删搬过去的目录。失败时把联接建回去、删临时目录。
 */
export declare function buildRestoreScript(link: string, moved: string, temp: string, resultFile: string): string;
/** 脚本文件内容：UTF-8 带 BOM（Windows PowerShell 5.1 才能正确读中文路径）。 */
export declare function scriptBytes(script: string): Buffer;
/** 读脚本写回的结果；没有文件或格式不对返回 null。 */
export declare function readElevatedResult(file: string): Promise<ElevatedResult | null>;
/** 以普通权限运行一个 .ps1 并等它结束（测试与非提权场景用）。 */
export declare function runScriptFile(scriptFile: string): Promise<void>;
/**
 * 真实提权执行器：Start-Process powershell -Verb RunAs -Wait，弹一次管理员确认（UAC）。
 * 用户拒绝时 Start-Process 报错，这里转成「没有获得管理员权限」。未验证（需要真人点 UAC）。
 */
export declare function realElevatedRunner(): ElevatedRunner;
