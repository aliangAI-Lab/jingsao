/**
 * animations.events.cleanSwallow（清理的「吸入 → 打嗝 → 推容量条」）的配置校验与素材登记：
 * 内置配置通过校验、缺段整段判错、每个名字在 assets/webm 下都有对应素材；老回退动画保留。
 * @module jingsao/src/host/config/clean-swallow.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanSwallowNames, isEventAnim } from '../../shared/pickers.ts';
import { readJsonc } from './jsonc.ts';
import { cleanSwallowValid, topFieldValid } from './validate.ts';

const ROOT = new URL('../../../', import.meta.url);
const builtin = readJsonc(fileURLToPath(new URL('assets/config.jsonc', ROOT))) as unknown as {
  animations: { events: Record<string, unknown> };
};

test('内置配置的 cleanSwallow 通过校验，整个 animations 段也仍然合法', () => {
  assert.ok(cleanSwallowValid(builtin.animations.events.cleanSwallow));
  assert.ok(topFieldValid('animations', builtin.animations));
});

test('缺段、空数组、分档不全都判为整段非法', () => {
  const good = builtin.animations.events.cleanSwallow as Record<string, unknown>;
  for (const bad of [
    { ...good, start: [] },
    { ...good, burp: undefined },
    { ...good, loop: { small: ['a'], medium: ['b'] } },
    { ...good, push: ['a'] },
    ['清理-吸入-开始'],
  ]) {
    assert.equal(cleanSwallowValid(bad), false, JSON.stringify(bad));
    assert.equal(
      topFieldValid('animations', {
        ...builtin.animations,
        events: { ...builtin.animations.events, cleanSwallow: bad },
      }),
      false,
    );
  }
  // 不写 cleanSwallow 的老配置照样合法（清理时退回老动画）
  const rest = { ...builtin.animations.events };
  delete rest.cleanSwallow;
  assert.ok(topFieldValid('animations', { ...builtin.animations, events: rest }));
});

test('8 段新动画与 3 段老回退动画都登记了，并且 assets/webm 下都有素材', () => {
  const names = cleanSwallowNames(builtin.animations.events.cleanSwallow);
  assert.deepEqual(names, [
    '清理-吸入-开始',
    '清理-吸入-循环-小',
    '清理-吸入-循环-中',
    '清理-吸入-循环-大',
    '清理-打嗝',
    '清理-推容量条-小',
    '清理-推容量条-中',
    '清理-推容量条-大',
  ]);
  const legacy = builtin.animations.events.clean as string[];
  for (const name of ['清理-打扫中', '清理-推容量条', '清理-搬家']) assert.ok(legacy.includes(name), name);
  for (const name of [...names, ...legacy]) {
    assert.ok(existsSync(fileURLToPath(new URL(`assets/webm/${name}.webm`, ROOT))), '缺素材：' + name);
  }
  // 播完判定把它们当事件动画（播完回待机 / 恢复工作状态，不进随机链）
  assert.ok(isEventAnim(builtin.animations.events as never, '清理-吸入-循环-大'));
});
