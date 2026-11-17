/**
 * 宿主驱动的分段播放（清理的「吸入-开始 → 吸入-循环」「打嗝 → 推容量条」）：readAnim 解析 next / loop，
 * 状态机按播完推进；循环段被顶掉后重新点名，直到下一条指令清掉它。两端渲染器共用这份口径。
 * @module jingsao/src/shared/anim-chain.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAnimChain, readAnim, startAnimChain } from './state.ts';

test('readAnim：next / loop 只认 name 形态，脏值按没写处理', () => {
  assert.deepEqual(readAnim({ counter: 1, data: { name: 'a', next: 'b', loop: true } }), {
    name: 'a',
    url: undefined,
    playbackId: undefined,
    facing: undefined,
    next: 'b',
    loop: true,
  });
  const url = readAnim({ counter: 1, data: { url: 'https://x/y.webm', next: 'b', loop: true } });
  assert.equal(url?.next, undefined);
  assert.equal(url?.loop, undefined);
  const dirty = readAnim({ counter: 1, data: { name: 'a', next: '', loop: 'yes' } });
  assert.equal(dirty?.next, undefined);
  assert.equal(dirty?.loop, undefined);
});

test('开始 → 循环：第一段播完接循环段；循环段被顶掉（又收到 ended）就重新点名，一直到下一条指令', () => {
  const chain = startAnimChain({ name: '吸入-开始', next: '吸入-循环-中', loop: true });
  assert.deepEqual(advanceAnimChain(chain), { name: '吸入-循环-中', loop: true });
  // 点击回应顶掉了循环段，它播完时：接回循环
  assert.deepEqual(advanceAnimChain(chain), { name: '吸入-循环-中', loop: true });
  assert.deepEqual(advanceAnimChain(chain), { name: '吸入-循环-中', loop: true });
  // 下一条指令到来：调用方用新的指令（或 null）替换掉它
  assert.equal(advanceAnimChain(startAnimChain({ name: '工作状态-垂头叹气冒汗' })), null);
});

test('打嗝 → 推容量条：两段各播一次，然后交回正常动画链', () => {
  const chain = startAnimChain({ name: '打嗝', next: '推容量条-大' });
  assert.deepEqual(advanceAnimChain(chain), { name: '推容量条-大', loop: false });
  assert.equal(chain?.phase, null);
  assert.equal(advanceAnimChain(chain), null);
});

test('只有 loop 没有 next：这一段本身循环；普通点播不建状态', () => {
  const chain = startAnimChain({ name: '清理-打扫中', loop: true });
  assert.deepEqual(advanceAnimChain(chain), { name: '清理-打扫中', loop: true });
  assert.equal(startAnimChain({ name: '待机' }), null);
  assert.equal(startAnimChain({ url: 'https://x/y.webm' }), null);
});
