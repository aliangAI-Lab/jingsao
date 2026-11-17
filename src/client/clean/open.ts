/**
 * 「打开清理面板」的页面内信号：右键菜单、宿主 /state 的 clean 段（AI 工具 / POST /clean/open）都只发这个事件，
 * 由鲸鱼娘旁边的清理浮层（./layer）统一响应。这样宠物卡片不需要拿到 ctx，也不和浮层实现耦合。
 * clean 段带 `target`：`desktop` 归桌面 Helper 弹小窗，网页不理；`web` 或缺省（老宿主）才开浮层。
 * @module jingsao/src/client/clean/open
 */

/** 页面内事件名。 */
export const OPEN_CLEAN_EVENT = 'jingsao:open-clean';

/** 宿主写入的打开请求超过这个时长就不再响应（页面晚开时不要突然弹出旧请求）。 */
const STALE_MS = 15_000;

/** 页面内直接请求打开清理面板。 */
export function openCleanPanel(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_CLEAN_EVENT));
}

/** 上次响应过的宿主请求时间戳：同一次请求只打开一次。 */
let lastTs = 0;

/** 宿主 /state 的 clean 段 → 打开面板（data 形如 { open: ts, target: 'web' | 'desktop' }）。 */
export function requestCleanPanel(data: unknown): void {
  if ((data as { target?: string } | null)?.target === 'desktop') return;
  const ts = Number((data as { open?: unknown } | null)?.open ?? 0);
  if (!Number.isFinite(ts) || ts <= lastTs || Date.now() - ts > STALE_MS) return;
  lastTs = ts;
  openCleanPanel();
}
