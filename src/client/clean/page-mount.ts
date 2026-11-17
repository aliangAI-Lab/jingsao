/**
 * 桌面清理小窗（独立页 /clean/page）的浏览器入口：把右侧栏、网页浮层用的同一份清理面板挂到页面上。
 *
 * 页面不在 DSH 里，没有宿主注入的 React，所以 react / react-dom 由本入口自己打进 lib/clean-page.js
 * （照抄独立模式对话面板 chat-mount 的写法）。HTML 壳由宿主 src/host/routes/clean-page.ts 提供，
 * 挂载点与关闭按钮的 id 与那边一致。关掉小窗只是关窗口：清理任务在宿主里跑，重新打开会接着显示进度。
 * @module jingsao/src/client/clean/page-mount
 */
import { createElement, useEffect, useRef, useState, type FC } from 'react';
import { createRoot } from 'react-dom/client';
import { makeCleanPanel, type CleanPanelRuntime } from './panel.ts';

/** 与 src/host/routes/clean-page.ts 的 CLEAN_PAGE_ROOT_ID / CLEAN_PAGE_CLOSE_ID 一致。 */
const ROOT_ID = 'clean-root';
const CLOSE_ID = 'clean-close';

/** 本包自带的 React 能力：h 用 createElement（面板自己把子节点收进 props.children，两种 h 都能用）。 */
const runtime: CleanPanelRuntime = {
  h: createElement as CleanPanelRuntime['h'],
  useState: useState as CleanPanelRuntime['useState'],
  useEffect,
  useRef: useRef as CleanPanelRuntime['useRef'],
};

const host = document.getElementById(ROOT_ID);
if (host !== null) {
  const Panel = makeCleanPanel(runtime) as unknown as FC<{ onClose?: () => void }>;
  // 清理 / 搬家被宿主接受后面板调 onClose：小窗立刻关掉，任务在宿主后台跑
  createRoot(host).render(createElement(Panel, { onClose: () => window.close() }));
}
// 无边框窗口没有系统关闭按钮：标题栏的 ✕ 直接关掉本窗口（Electron 允许页面关闭自己的顶层窗口）。
document.getElementById(CLOSE_ID)?.addEventListener('click', () => window.close());
