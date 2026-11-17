/** 注册鲸鱼娘收起与叫回命令，复用 HTTP 路由的串行配置写入。 */
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import type { HostContext } from './context.ts';
import type { HttpRouteHandler } from './http-route.ts';

/** 执行命令并返回可直接显示的中文结果。 */
export async function runJingsaoCommand(
  rawInput: string,
  handle: HttpRouteHandler,
): Promise<{ kind: 'success' | 'error'; text: string }> {
  const arg = rawInput.trim();
  if (arg !== '' && arg !== '出来' && arg !== '收起') return { kind: 'error', text: '用法：/jingsao [出来|收起]' };
  try {
    const result = await handle(ROUTE_SEGMENT + (arg === '收起' ? '/pet-hide' : '/pet-restore'), 'POST');
    if (result.kind === 'json' && (result.obj as { ok?: boolean }).ok === true) {
      return {
        kind: 'success',
        text: arg === '收起' ? '鲸鱼娘收起来了，输入 /jingsao 就能叫她回来。' : '鲸鱼娘回来啦！',
      };
    }
  } catch {
    /* 路由错误统一转换成命令结果。 */
  }
  return { kind: 'error', text: '操作失败，请重试。' };
}

/** 命令注册随插件卸载清理。 */
export function registerJingsaoCommand(ctx: HostContext, handle: HttpRouteHandler): void {
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'jingsao',
        description: '收起或叫回鲸鱼娘',
        input: { hint: '[出来|收起]' },
        handler: ({ rawInput }: { rawInput: string }) => runJingsaoCommand(rawInput, handle),
      }),
    'jingsao: /jingsao command',
  );
}
