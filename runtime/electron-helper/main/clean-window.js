'use strict';
/**
 * 清理小窗：桌面右键「清理C盘」时，从鲸鱼娘旁边弹出的无边框小窗（约 440×640，跟随屏幕缩放）。
 *
 * 加载宿主的独立页 `<base>/jingsao-7341/clean/page`，访问宿主的方式与宠物窗口完全相同：
 * bridge 模式走 jingsao-bridge:// 自定义协议（main.js 注册、main/bridge.js 转发）；非 bridge 模式
 * HTTP 直连本机服务，独立应用的令牌由 src/app/desktop-auth.ts 在默认 session 上统一注入——本模块
 * 不碰令牌、不挂任何请求拦截。
 *
 * 只开一个：已开着就拉到前面，不新开。窗口不跟着宠物走；关掉窗口不影响宿主里正在跑的清理任务，
 * 重新打开会接着显示进度。位置计算是纯函数，规则与网页浮层（src/client/clean/place.ts）一致。
 * @module jingsao/runtime/electron-helper/main/clean-window
 */
const path = require('node:path');
const { resolvePetScale } = require('../dpi-linearization.js');
const { topmostLevel } = require('../topmost-watchdog.js');

/** 小窗的 CSS 尺寸（再乘屏幕缩放成物理像素）。 */
const CLEAN_WINDOW_WIDTH = 440;
const CLEAN_WINDOW_HEIGHT = 640;
/** 与鲸鱼娘之间留的缝（CSS 像素）。 */
const CLEAN_WINDOW_GAP = 8;
/** 小窗标题（与独立页的标题栏一致）。 */
const CLEAN_WINDOW_TITLE = '鲸鱼娘的 C 盘清理';
/** 宠物画布宽高比（640×360）：由窗口余量反推本体包围盒时用。 */
const PET_ASPECT = 360 / 640;

/**
 * 算小窗位置：右侧放得下就放右侧，否则放左侧；两边都放不下时放空间大的一侧并贴住屏幕边；
 * 竖直方向与鲸鱼娘底边对齐，再夹回工作区。窗口比工作区还大时先缩到工作区。
 *
 * @param pet - 鲸鱼娘本体的包围盒（屏幕坐标）。
 * @param area - 她所在那块屏幕的工作区（屏幕坐标）。
 * @param scale - 屏幕缩放（物理像素 / CSS 像素）。
 * @returns 小窗矩形（屏幕坐标，整数）。
 */
function cleanWindowBounds(pet, area, scale = 1) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const width = Math.max(1, Math.min(Math.round(CLEAN_WINDOW_WIDTH * s), area.width));
  const height = Math.max(1, Math.min(Math.round(CLEAN_WINDOW_HEIGHT * s), area.height));
  const gap = Math.round(CLEAN_WINDOW_GAP * s);
  const minX = area.x;
  const maxX = area.x + area.width - width;
  const minY = area.y;
  const maxY = area.y + area.height - height;
  const right = pet.x + pet.width + gap;
  const left = pet.x - gap - width;
  let x;
  if (right <= maxX) x = right;
  else if (left >= minX) x = left;
  else {
    const roomRight = area.x + area.width - (pet.x + pet.width);
    const roomLeft = pet.x - area.x;
    x = roomRight >= roomLeft ? maxX : minX;
  }
  return {
    x: Math.round(Math.max(minX, Math.min(x, maxX))),
    y: Math.round(Math.max(minY, Math.min(pet.y + pet.height - height, maxY))),
    width,
    height,
  };
}

/**
 * 由宠物窗口反推鲸鱼娘本体的包围盒：窗口四周有给气泡留的透明余量（渲染端经 pet:set-bounds 上报）。
 * 没有余量记录（窗口刚建、还没上报）时退回整窗。
 *
 * @param win - 宠物窗口的 bounds。
 * @param margin - `{ l, t, r }` 窗口原点到本体的左/上距离与右侧余量；可缺省。
 */
function petBodyRect(win, margin) {
  if (!margin || ![margin.l, margin.t, margin.r].every(Number.isFinite)) return win;
  const width = Math.max(1, win.width - margin.l - margin.r);
  return { x: win.x + margin.l, y: win.y + margin.t, width, height: Math.round(width * PET_ASPECT) };
}

/**
 * 小窗的屏幕缩放：与宠物窗口同一套 DPI 线性化换算（只取缩放，不乘宠物自己的大小倍数）。
 *
 * @param dpi - main/dpi.js 的能力（primaryScale / forcedScale）。
 */
function cleanWindowScale(dpi) {
  return resolvePetScale({ baseScale: '1', primaryScale: dpi.primaryScale, forcedScale: dpi.forcedScale });
}

/**
 * 造清理小窗控制器。
 *
 * @param deps.BrowserWindow - Electron BrowserWindow 构造器。
 * @param deps.screen - Electron screen（按宠物位置找屏幕工作区）。
 * @param deps.scale - 取当前屏幕缩放的函数。
 * @param deps.pageUrl - 独立页地址（bridge：jingsao-bridge://jingsao/jingsao-7341/clean/page；否则 HTTP）。
 * @param deps.helperDir - runtime/electron-helper 的绝对目录（窗口图标用包内 logo）。
 * @param deps.log - 打日志（默认 console.error）。
 */
function createCleanWindow({ BrowserWindow, screen, scale, pageUrl, helperDir, log = console.error }) {
  /** 当前小窗；同一时间只有一个。 */
  let current = null;
  /** 已处理过的宿主打开请求时刻：每只宠物窗口都会收到同一条 /state 信号，只认一次。 */
  let lastCueTs = 0;

  /** 已开着：拉到前面。 */
  function raise(win) {
    if (win.isMinimized()) win.restore();
    win.show();
    // 宿主以 windowsHide 拉起本进程（STARTF_USESHOWWINDOW + SW_HIDE）：Windows 会把进程里第一次普通
    // ShowWindow 换成「隐藏」。宠物窗口用 showInactive 不受影响，清理小窗是第一个走 show() 的，于是第一次
    // 右键「清理C盘」时窗口建好了却看不见，要点第二次才出来。被吞了就再显示一次。
    if (!win.isVisible()) win.show();
    // 一直浮在最上层：与宠物窗口同一置顶级别；显示之后再钉一次（SetWindowPos HWND_TOPMOST 会把它放到置顶带最前），
    // 保证不被宠物窗口盖住。不用 moveTop（HWND_TOP 不落置顶带，源码守卫禁止）。
    if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, topmostLevel(process.platform));
    win.focus();
    return win;
  }

  /**
   * 打开（或拉到前面）小窗。
   *
   * @param anchor - 鲸鱼娘本体的包围盒（屏幕坐标）。
   * @param cueTs - 来自宿主 /state 打开请求的时刻；右键菜单直接打开时不传。
   * @returns 小窗；同一条宿主请求重复到达时返回 null。
   */
  function open(anchor, cueTs) {
    if (cueTs !== undefined) {
      const ts = Number(cueTs);
      if (!Number.isFinite(ts) || ts <= lastCueTs) return null;
      lastCueTs = ts;
    }
    if (current && !current.isDestroyed()) return raise(current);
    const zoom = scale();
    const area = screen.getDisplayMatching(anchor).workArea;
    const win = new BrowserWindow({
      ...cleanWindowBounds(anchor, area, zoom),
      title: CLEAN_WINDOW_TITLE,
      icon: path.join(helperDir, '..', '..', 'assets', 'logo.png'),
      frame: false,
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      // 一直浮在最上层（与宠物窗口同一置顶级别，见 raise）
      alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    current = win;
    win.on('closed', () => {
      if (current === win) current = null;
    });
    // 页面级缩放与宠物窗口同源；show:false 的窗口 zoomFactor 不生效，须加载后设置，设完再显示
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.setZoomFactor(zoom);
      raise(win);
    });
    // 小窗只显示这一页：不开新窗口、不跳去别的地址
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (url !== pageUrl) event.preventDefault();
    });
    win.loadURL(pageUrl).catch((error) => {
      log('[jingsao-desktop-helper] 清理小窗加载失败:', String(error && error.message ? error.message : error));
      if (!win.isDestroyed()) win.destroy();
    });
    return win;
  }

  return {
    open,
    /** 当前小窗（测试与排障用）。 */
    current: () => (current && !current.isDestroyed() ? current : null),
  };
}

module.exports = {
  CLEAN_WINDOW_WIDTH,
  CLEAN_WINDOW_HEIGHT,
  cleanWindowBounds,
  cleanWindowScale,
  createCleanWindow,
  petBodyRect,
};
