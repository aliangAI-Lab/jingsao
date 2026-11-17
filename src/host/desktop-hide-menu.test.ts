/** 用桌面脚本的真实菜单入口验证睡觉时仍能关闭桌面鲸鱼娘。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isSleepAllowedAction } from '../shared/menu/tree.ts';
import type { MenuNode, MenuLeaf } from '../shared/menu/types.ts';

test('睡着时菜单末尾仍是回到初始位置、分隔线与关闭项，点击只收起桌面', async () => {
  let tree: MenuNode[] = [];
  const requests: unknown[] = [];
  const prototype: Record<string, (...args: unknown[]) => unknown> = {};
  runInNewContext(readFileSync(new URL('../../runtime/electron-helper/sprite/menu.js', import.meta.url), 'utf8'), {
    PetSprite: { prototype },
    OPEN_TARGET: 'desktop',
    OPEN_SHORTCUT_HINT: '',
    BASE: '/jingsao-7341',
    window: { __jingsaoDebug: {} },
    console,
    S: {
      buildMenuTree: () => [],
      buildMoreBranch: () => null,
      displayMenuBranch: () => ({ label: '显示位置', children: [] }),
      isSleepAllowedAction,
      mountContextMenu: (options: { tree: MenuNode[] }) => {
        tree = options.tree;
        return { close() {} };
      },
      postAction: async (url: string, body: unknown) => {
        requests.push({ url, body });
        return true;
      },
    },
  });
  const sprite = {
    ...prototype,
    sleeping: true,
    frozen: false,
    menuOpen: false,
    dragState: {},
    animations: { sleep: ['睡觉'] },
    pet: { id: '鲸鱼娘' },
    stopThrow() {},
    stopMove() {},
    setInteractive() {},
    syncInputBusy() {},
    visibleClampRect: () => ({}),
    syncInputRegions() {},
    closeMenu() {},
  };
  prototype.onContextMenu.call(sprite, { preventDefault() {}, clientX: 0, clientY: 0 });
  assert.equal(tree[tree.length - 2].label, '回到初始位置');
  const hide = tree[tree.length - 1] as MenuLeaf;
  assert.equal(hide.label, '关闭桌面鲸鱼娘');
  assert.equal(hide.action, 'hide');
  assert.equal(hide.separatorBefore, true);
  prototype.onMenuAction.call(sprite, hide);
  await Promise.resolve();
  assert.equal(
    JSON.stringify(requests),
    JSON.stringify([{ url: '/jingsao-7341/pet-hide', body: { id: '鲸鱼娘', surface: 'desktop' } }]),
  );
});
