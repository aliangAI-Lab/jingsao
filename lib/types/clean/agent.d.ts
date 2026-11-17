import type { CleanScanResult } from './types.ts';
import type { CleanService } from './service.ts';
/** 宿主上下文的最小形状（Cordis ctx）。 */
interface AgentCtx {
    inject(names: string[], callback: (sub: AgentCtx & Record<string, unknown>) => void): void;
    logger?: {
        info?(message: string): void;
    };
}
/** 扫描结果 → 给 AI 看的精简摘要（不含文件内容，只有分类、大小、说明和最大的几个路径）。 */
export declare function summarize(result: CleanScanResult | null): unknown;
/**
 * 注册 AI 工具与技能。
 *
 * @param ctx - 插件上下文（独立模式的伪 ctx 没有 inject，直接跳过）。
 * @param clean - 清理服务（只用它的只读扫描与结果）。
 * @param openPanel - 打开清理面板：返回给 AI 看的结果（开在网页浮层 / 桌面小窗，或为什么没打开），原样转成工具输出。
 */
export declare function registerCleanAgent(ctx: AgentCtx, clean: CleanService, openPanel: () => {
    ok: boolean;
    message: string;
}): void;
export {};
