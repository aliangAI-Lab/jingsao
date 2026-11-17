/**
 * 桌面清理小窗：位置计算（右侧 / 左侧 / 两边都放不下 / 多屏 / 缩放）、只开一个、再点拉到前面，
 * 以及右键「清理C盘」改为请主进程开小窗、不再经宿主去开网页侧栏。
 * 不启动 Electron：BrowserWindow 用替身。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isSleepAllowedAction } from '../shared/menu/tree.ts';

const require = createRequire(import.meta.url);

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const { cleanWindowBounds, cleanWindowScale, createCleanWindow, petBodyRect } =
  require('../../runtime/electron-helper/main/clean-window.js') as {
    cleanWindowBounds(pet: Rect, area: Rect, scale?: number): Rect;
    cleanWindowScale(dpi: { primaryScale: number; forcedScale: number }): number;
    petBodyRect(win: Rect, margin?: { l: number; t: number; r: number }): Rect;
    createCleanWindow(deps: Record<string, unknown>): {
      open(anchor: Rect, cueTs?: number): FakeWindow | null;
      current(): FakeWindow | null;
    };
  };

/** 1920×1040 工作区（任务栏 40）。 */
const AREA: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

describe('cleanWindowBounds —— 小窗放在鲸鱼娘哪一边', () => {
  test('右侧放得下：贴在右边，底边与鲸鱼娘对齐', () => {
    const pet = { x: 200, y: 700, width: 300, height: 170 };
    assert.deepEqual(cleanWindowBounds(pet, AREA), { x: 508, y: 230, width: 440, height: 640 });
  });

  test('右侧放不下：放左侧', () => {
    const pet = { x: 1500, y: 860, width: 400, height: 180 };
    const r = cleanWindowBounds(pet, AREA);
    assert.equal(r.x, 1500 - 8 - 440);
    assert.equal(r.y + r.height, 1040, '底边对齐后再夹回工作区');
  });

  test('两边都放不下：放空得多的一侧并贴屏幕边，整个窗口留在工作区内', () => {
    const area = { x: 0, y: 0, width: 900, height: 700 };
    const nearLeft = cleanWindowBounds({ x: 100, y: 100, width: 500, height: 280 }, area);
    assert.deepEqual(nearLeft, { x: 460, y: 0, width: 440, height: 640 });
    const nearRight = cleanWindowBounds({ x: 330, y: 100, width: 500, height: 280 }, area);
    assert.equal(nearRight.x, 0);
    for (const r of [nearLeft, nearRight]) {
      assert.ok(r.x >= area.x && r.x + r.width <= area.x + area.width);
      assert.ok(r.y >= area.y && r.y + r.height <= area.y + area.height);
    }
  });

  test('鲸鱼娘贴着屏幕顶：窗口夹回工作区上沿', () => {
    const r = cleanWindowBounds({ x: 100, y: 0, width: 300, height: 170 }, AREA);
    assert.equal(r.y, 0);
  });

  test('多屏：副屏在主屏右侧（负坐标同理），只在她所在那块屏的工作区里摆', () => {
    const second = { x: 1920, y: -200, width: 1280, height: 984 };
    const r = cleanWindowBounds({ x: 2900, y: 500, width: 250, height: 140 }, second);
    assert.equal(r.x, 2900 - 8 - 440, '右侧超出副屏 → 放左侧');
    assert.ok(r.x >= second.x && r.x + r.width <= second.x + second.width);
    const left = { x: -1600, y: 0, width: 1600, height: 900 };
    const l = cleanWindowBounds({ x: -1500, y: 600, width: 250, height: 140 }, left);
    assert.equal(l.x, -1500 + 250 + 8);
    assert.ok(l.y >= 0 && l.y + l.height <= 900);
  });

  test('缩放 150%：窗口与缝一起放大；比工作区还高时缩到工作区', () => {
    const r = cleanWindowBounds(
      { x: 100, y: 1000, width: 450, height: 253 },
      { x: 0, y: 0, width: 2880, height: 1560 },
      1.5,
    );
    assert.deepEqual([r.width, r.height], [660, 960]);
    assert.equal(r.x, 100 + 450 + 12);
    const tiny = cleanWindowBounds(
      { x: 0, y: 0, width: 100, height: 56 },
      { x: 0, y: 0, width: 1366, height: 728 },
      1.5,
    );
    assert.equal(tiny.height, 728);
    assert.equal(tiny.y, 0);
  });
});

test('petBodyRect：按渲染端上报的余量反推本体；没有余量时退回整窗', () => {
  const win = { x: 100, y: 50, width: 924, height: 700 };
  assert.deepEqual(petBodyRect(win, { l: 231, t: 300, r: 231 }), { x: 331, y: 350, width: 462, height: 260 });
  assert.deepEqual(petBodyRect(win, undefined), win);
});

test('cleanWindowScale：与宠物窗口同一套 DPI 线性化换算，不乘宠物自己的大小倍数', () => {
  assert.equal(cleanWindowScale({ primaryScale: 1.5, forcedScale: 1 }), 1.5);
  assert.equal(cleanWindowScale({ primaryScale: 0, forcedScale: 0 }), 1);
});

/** 替身窗口：记录被调了什么。 */
interface FakeWindow {
  options: Record<string, unknown>;
  loaded?: string;
  calls: string[];
  destroyed: boolean;
  handlers: Record<string, () => void>;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  isVisible(): boolean;
  visible: boolean;
  focus(): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  destroy(): void;
  on(name: string, fn: () => void): void;
  loadURL(url: string): Promise<void>;
  webContents: Record<string, unknown>;
}

/**
 * @param swallowFirstShow - 模拟 Windows：进程以 SW_HIDE 启动时，第一次普通 ShowWindow 被换成隐藏。
 */
function fakeElectron(swallowFirstShow = false) {
  const created: FakeWindow[] = [];
  let showsLeftToSwallow = swallowFirstShow ? 1 : 0;
  function BrowserWindow(this: unknown, options: Record<string, unknown>): FakeWindow {
    const win: FakeWindow = {
      options,
      calls: [],
      destroyed: false,
      visible: false,
      handlers: {},
      isDestroyed: () => win.destroyed,
      isMinimized: () => false,
      restore: () => win.calls.push('restore'),
      show: () => {
        win.calls.push('show');
        if (showsLeftToSwallow > 0) showsLeftToSwallow -= 1;
        else win.visible = true;
      },
      isVisible: () => win.visible,
      focus: () => win.calls.push('focus'),
      setAlwaysOnTop: (flag, level) => win.calls.push('top:' + String(flag) + ':' + String(level)),
      destroy: () => {
        win.destroyed = true;
      },
      on: (name, fn) => {
        win.handlers[name] = fn;
      },
      loadURL: async (url) => {
        win.loaded = url;
      },
      webContents: {
        on: (name: string, fn: () => void) => {
          win.handlers['wc:' + name] = fn;
        },
        setZoomFactor: (z: number) => win.calls.push('zoom:' + z),
        setWindowOpenHandler: () => {},
      },
    };
    created.push(win);
    return win;
  }
  const screen = { getDisplayMatching: () => ({ workArea: AREA }) };
  return { created, BrowserWindow, screen };
}

/** 与宠物窗口同一置顶级别（topmost-watchdog.js 的 topmostLevel）。 */
const TOP = 'top:true:' + (process.platform === 'darwin' ? 'floating' : 'screen-saver');

describe('createCleanWindow —— 同一时间只开一个', () => {
  const pageUrl = 'jingsao-bridge://jingsao/jingsao-7341/clean/page';
  const pet = { x: 200, y: 700, width: 300, height: 170 };

  test('第一次打开：无边框、先不显示，加载独立页，加载完按缩放设 zoom 再显示', () => {
    const fake = fakeElectron();
    const ctl = createCleanWindow({ ...fake, scale: () => 1.25, pageUrl, helperDir: '/helper' });
    const win = ctl.open(pet);
    assert.ok(win);
    assert.equal(fake.created.length, 1);
    assert.equal(win.options.frame, false);
    assert.equal(win.options.show, false);
    assert.equal(win.options.width, 550);
    assert.equal(win.loaded, pageUrl);
    win.handlers['wc:did-finish-load']!();
    assert.equal(win.options.alwaysOnTop, true, '小窗一直浮在最上层');
    assert.deepEqual(win.calls, ['zoom:1.25', 'show', TOP, 'focus']);
  });

  test('第一次显示被 Windows 吞掉（宿主以隐藏方式拉起本进程）：立刻再显示一次，第一次点就能看见', () => {
    const fake = fakeElectron(true);
    const ctl = createCleanWindow({ ...fake, scale: () => 1, pageUrl, helperDir: '/helper' });
    const win = ctl.open(pet)!;
    win.handlers['wc:did-finish-load']!();
    assert.equal(win.visible, true, '第一次打开就必须可见，不能等用户再点一次');
    assert.deepEqual(win.calls, ['zoom:1', 'show', 'show', TOP, 'focus']);
  });

  test('再点一次：不新开，把已有窗口拉到前面', () => {
    const fake = fakeElectron();
    const ctl = createCleanWindow({ ...fake, scale: () => 1, pageUrl, helperDir: '/helper' });
    const first = ctl.open(pet);
    const again = ctl.open({ x: 900, y: 100, width: 300, height: 170 });
    assert.equal(again, first);
    assert.equal(fake.created.length, 1);
    // 拉到前面时也重新钉到与宠物窗口同一置顶级别，显示后再钉一次，放到置顶带最前（不被宠物窗口盖住）
    assert.deepEqual(first!.calls, ['show', TOP, 'focus']);
  });

  test('关掉以后再点：重新开一个', () => {
    const fake = fakeElectron();
    const ctl = createCleanWindow({ ...fake, scale: () => 1, pageUrl, helperDir: '/helper' });
    const first = ctl.open(pet)!;
    first.destroyed = true;
    first.handlers.closed!();
    assert.equal(ctl.current(), null);
    const second = ctl.open(pet);
    assert.notEqual(second, first);
    assert.equal(fake.created.length, 2);
  });

  test('宿主的同一条打开请求从多只宠物窗口重复到达：只认一次', () => {
    const fake = fakeElectron();
    const ctl = createCleanWindow({ ...fake, scale: () => 1, pageUrl, helperDir: '/helper' });
    assert.ok(ctl.open(pet, 1000));
    assert.equal(ctl.open(pet, 1000), null);
    assert.equal(ctl.open(pet, 999), null);
    assert.equal(fake.created.length, 1);
    assert.ok(ctl.open(pet, 1001), '新的一条请求：拉到前面');
    assert.equal(fake.created.length, 1);
  });

  test('只跳本页：导航到别处被拦下', () => {
    const fake = fakeElectron();
    const ctl = createCleanWindow({ ...fake, scale: () => 1, pageUrl, helperDir: '/helper' });
    const win = ctl.open(pet)!;
    let prevented = 0;
    const nav = win.handlers['wc:will-navigate'] as unknown as (e: { preventDefault(): void }, url: string) => void;
    nav({ preventDefault: () => (prevented += 1) }, 'https://example.invalid/');
    nav({ preventDefault: () => (prevented += 1) }, pageUrl);
    assert.equal(prevented, 1);
  });
});

test('桌面右键「清理C盘」：请主进程开小窗，不再 POST /clean/open 去开网页侧栏', () => {
  const opened: unknown[] = [];
  const requests: unknown[] = [];
  const prototype: Record<string, (...args: unknown[]) => unknown> = {};
  runInNewContext(readFileSync(new URL('../../runtime/electron-helper/sprite/menu.js', import.meta.url), 'utf8'), {
    PetSprite: { prototype },
    OPEN_TARGET: 'desktop',
    OPEN_SHORTCUT_HINT: '',
    BASE: '/jingsao-7341',
    window: { __jingsaoDebug: {}, petBridge: { openClean: (...args: unknown[]) => opened.push(args) } },
    console,
    S: {
      isSleepAllowedAction,
      postAction: async (url: string, body: unknown) => {
        requests.push({ url, body });
        return true;
      },
    },
  });
  const sprite = { ...prototype, sleeping: false, frozen: false, pet: { id: 'main' }, closeMenu() {} };
  prototype.onMenuAction.call(sprite, { label: '清理C盘', action: 'clean' });
  assert.deepEqual(opened, [[]]);
  assert.deepEqual(requests, []);
});
