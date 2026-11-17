import { type CleanPanelRuntime } from './panel.ts';
/**
 * 造浮层组件。
 *
 * @param rt - DSH 注入的 React 原语（与右侧栏面板同一套）。
 * @param openSidebar - 「在侧栏打开」：打开右侧栏的清理标签。
 */
export declare function makeCleanLayer(rt: CleanPanelRuntime, openSidebar: () => void): () => unknown;
