/** 收起换算与恢复默认值的回归测试。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenDisplay, restoredDisplay } from './pet-hide.ts';
import type { PetDisplay } from './types.ts';

test('两端收起只移除目标显示位', () => {
  const cases: Array<[PetDisplay, PetDisplay, PetDisplay]> = [
    ['web', 'none', 'web'],
    ['desktop', 'desktop', 'none'],
    ['both', 'desktop', 'web'],
    ['none', 'none', 'none'],
  ];
  for (const [from, web, desktop] of cases) {
    assert.equal(hiddenDisplay(from, 'web'), web);
    assert.equal(hiddenDisplay(from, 'desktop'), desktop);
    assert.equal(hiddenDisplay(from, 'both'), 'none');
  }
});

test('恢复记录优先，缺记录或 none 回到网页', () => {
  for (const display of ['web', 'desktop', 'both'] as const) assert.equal(restoredDisplay(display), display);
  assert.equal(restoredDisplay(), 'web');
  assert.equal(restoredDisplay('none'), 'web');
});
