/** 网页清理浮层贴着鲸鱼娘放：右侧 / 左侧 / 两边都放不下 / 视口比面板小 / 不知道她在哪。 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEAN_PANEL_SIZE, placeBeside } from './place.ts';

const VIEW = { x: 0, y: 0, width: 1440, height: 900 };

describe('placeBeside —— 网页浮层位置', () => {
  test('右侧放得下：贴在右边，底边对齐', () => {
    assert.deepEqual(placeBeside({ x: 100, y: 600, width: 240, height: 135 }, VIEW), {
      x: 348,
      y: 95,
      ...CLEAN_PANEL_SIZE,
    });
  });

  test('鲸鱼娘在右下角：放左侧，并夹回视口底边', () => {
    const r = placeBeside({ x: 1180, y: 780, width: 240, height: 135 }, VIEW);
    assert.equal(r.x, 1180 - 8 - 440);
    assert.equal(r.y + r.height, 900);
  });

  test('两边都放不下：贴空得多的那一侧的视口边，整个面板可见', () => {
    const view = { x: 0, y: 0, width: 800, height: 700 };
    const r = placeBeside({ x: 120, y: 200, width: 500, height: 280 }, view);
    assert.equal(r.x, 800 - 440);
    assert.ok(r.y >= 0 && r.y + r.height <= 700);
  });

  test('视口比面板还小：缩到视口大小，从左上角开始', () => {
    const r = placeBeside({ x: 10, y: 10, width: 100, height: 56 }, { x: 0, y: 0, width: 400, height: 500 });
    assert.deepEqual(r, { x: 0, y: 0, width: 400, height: 500 });
  });

  test('不知道她在哪：放在视口正中', () => {
    assert.deepEqual(placeBeside(null, VIEW), { x: 500, y: 130, ...CLEAN_PANEL_SIZE });
  });
});
