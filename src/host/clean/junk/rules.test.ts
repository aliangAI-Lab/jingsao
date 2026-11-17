/**
 * 规则校验用内存副本覆盖错误输入，防止测试改写正式规则。
 * @module jingsao/src/host/clean/junk/rules.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJunkRules, validateJunkRules } from './rules.ts';

test('内置规则包含旧规则和扩充项，返回独立副本', () => {
  const rules = loadJunkRules();
  assert.ok(rules.length >= 30);
  assert.ok(rules.every((rule) => rule.basis && rule.explanation));
  rules[0]!.paths.push('污染');
  assert.ok(!loadJunkRules()[0]!.paths.includes('污染'));
});

test('绝对路径、穿越、Windows 特殊路径和重复 id 均拒绝', () => {
  const rule = loadJunkRules()[0]!;
  for (const path of [
    'C:/Windows',
    '/Windows',
    '//server/share',
    '../Temp',
    'Temp/../data',
    'Temp/.. /data',
    'C:Windows',
    'Temp\\..\\data',
    'Temp/**',
    'Temp//data',
    'Temp/./data',
  ]) {
    assert.throws(() => validateJunkRules([{ ...rule, paths: [path] }]), /路径/, path);
  }
  assert.throws(() => validateJunkRules([rule, rule]), /重复/);
});

test('字段类型、年龄和文件模式均校验', () => {
  const rule = loadJunkRules()[0]!;
  for (const patch of [
    { tier: 'green' },
    { base: 'drive' },
    { basis: '' },
    { ageDays: -1 },
    { ageDays: Infinity },
    { files: ['../secret'] },
    { paths: [] },
  ]) {
    assert.throws(() => validateJunkRules([{ ...rule, ...patch }]));
  }
});
