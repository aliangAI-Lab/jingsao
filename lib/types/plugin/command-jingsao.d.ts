import type { HostContext } from './context.ts';
import type { HttpRouteHandler } from './http-route.ts';
/** 执行命令并返回可直接显示的中文结果。 */
export declare function runJingsaoCommand(rawInput: string, handle: HttpRouteHandler): Promise<{
    kind: 'success' | 'error';
    text: string;
}>;
/** 命令注册随插件卸载清理。 */
export declare function registerJingsaoCommand(ctx: HostContext, handle: HttpRouteHandler): void;
