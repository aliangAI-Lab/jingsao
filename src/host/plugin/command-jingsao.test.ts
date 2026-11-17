/** 斜杠命令参数、路由与中文结果测试。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJingsaoCommand } from './command-jingsao.ts';
import type { HttpRouteHandler } from './http-route.ts';

test('/jingsao 的三种合法参数返回中文成功文案', async () => {
  for (const arg of ['', '出来', '收起']) {
    const calls: string[] = [];
    const handle: HttpRouteHandler = async (url, method) => {
      calls.push(method + ' ' + url);
      return { kind: 'json', status: 200, obj: { ok: true } };
    };
    assert.deepEqual(await runJingsaoCommand(arg, handle), {
      kind: 'success',
      text: arg === '收起' ? '鲸鱼娘收起来了，输入 /jingsao 就能叫她回来。' : '鲸鱼娘回来啦！',
    });
    assert.deepEqual(calls, ['POST /jingsao-7341/' + (arg === '收起' ? 'pet-hide' : 'pet-restore')]);
  }
});

test('非法参数与业务失败返回错误文案', async () => {
  const handle: HttpRouteHandler = async () => ({ kind: 'json', status: 200, obj: { ok: false } });
  assert.deepEqual(await runJingsaoCommand('错误', handle), { kind: 'error', text: '用法：/jingsao [出来|收起]' });
  assert.deepEqual(await runJingsaoCommand('', handle), { kind: 'error', text: '操作失败，请重试。' });
  assert.equal(
    (
      await runJingsaoCommand('', async () => {
        throw new Error('失败');
      })
    ).kind,
    'error',
  );
});
