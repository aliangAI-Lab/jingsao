/**
 * 「打开清理面板」的页面内信号：右键菜单、宿主 /state 的 clean 段（AI 工具 / POST /clean/open）都只发这个事件，
 * 由鲸鱼娘旁边的清理浮层（./layer）统一响应。这样宠物卡片不需要拿到 ctx，也不和浮层实现耦合。
 * clean 段带 `target`：`desktop` 归桌面 Helper 弹小窗，网页不理；`web` 或缺省（老宿主）才开浮层。
 * @module jingsao/src/client/clean/open
 */
/** 页面内事件名。 */
export declare const OPEN_CLEAN_EVENT = "jingsao:open-clean";
/** 页面内直接请求打开清理面板。 */
export declare function openCleanPanel(): void;
/** 宿主 /state 的 clean 段 → 打开面板（data 形如 { open: ts, target: 'web' | 'desktop' }）。 */
export declare function requestCleanPanel(data: unknown): void;
