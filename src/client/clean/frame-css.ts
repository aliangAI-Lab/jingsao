/**
 * 清理面板「外框」的样式：网页浮层与桌面小窗共用的标题栏和窗体，以及桌面小窗独有的深浅两套配色。
 *
 * 面板本体的样式在 ./css（沿用 DSH 设计变量）。外框只补两件事：
 * 1. 窗体自己的底色和字色——在 DSH 网页里跟着 DSH 的变量走，变量缺失时退回系统色 Canvas/CanvasText，
 *    绝不写死白底（深色主题下白底配浅色字就看不清）；
 * 2. 380–460px 宽度下不挤、不横向滚动：长路径与标签一律截断或换行。
 * 纯字符串常量，不引任何模块：宿主半侧拼 /clean/page 的 HTML 壳时也直接用它。
 * @module jingsao/src/client/clean/frame-css
 */

/** 浮层与小窗共用的外框样式（只作用在 .js-clean-frame 之内，不碰宿主页面的根样式）。 */
export const CLEAN_FRAME_CSS = `
.js-clean-frame{--js-clean-bg:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,Canvas));
  display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;min-width:0;
  background:var(--js-clean-bg);color:var(--dsw-alias-label-primary,CanvasText);
  font-family:var(--dsw-font-family,system-ui,-apple-system,"Segoe UI","Microsoft YaHei UI",sans-serif);font-size:14px}
.js-clean-frame .js-clean{flex:1;min-height:0;min-width:0;overflow-x:hidden;height:auto}
.js-clean-frame .js-clean-fixed{flex-shrink:0}
.js-clean-frame .js-clean-row{min-width:0}
.js-clean-frame .js-clean-explain,.js-clean-frame .js-clean-hint,.js-clean-frame .js-clean-notice{overflow-wrap:anywhere}
.js-clean-frame .js-clean-select{max-width:100%;min-width:0}
.js-clean-frame .js-clean-select option{color:var(--dsw-alias-label-primary,CanvasText);background:var(--js-clean-bg)}
.js-clean-frame .js-clean-tag{max-width:96px;overflow:hidden;text-overflow:ellipsis}
.js-clean-frame .js-clean-foot{background:var(--js-clean-bg)}
.js-clean-titlebar{display:flex;align-items:center;gap:6px;padding:8px 8px 8px 14px;flex-shrink:0;
  border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));user-select:none;cursor:move;touch-action:none;
  -webkit-app-region:drag}
.js-clean-titlebar-text{flex:1;min-width:0;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.js-clean-titlebar button{-webkit-app-region:no-drag;flex-shrink:0;border:0;border-radius:6px;padding:4px 8px;
  background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.js-clean-titlebar button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.js-clean-titlebar .js-clean-close{font-size:14px;padding:4px 9px}
.js-clean-body{display:flex;flex:1;min-height:0;min-width:0}
`;

/**
 * 桌面小窗（独立页）的配色：页面不在 DSH 里，没有 DSH 的设计变量，自带深浅两套，跟随系统的
 * prefers-color-scheme。变量名与 DSH 同名，面板样式（./css）不用改一个字。
 */
export const CLEAN_PAGE_THEME_CSS = `
:root{color-scheme:light;
  --dsw-alias-label-primary:#1f2329;--dsw-alias-label-secondary:#596579;--dsw-alias-label-tertiary:#67758a;
  --dsw-alias-border-l2:#dce3ec;--dsw-alias-border-l3:#bbc8d9;
  --dsw-alias-bg-module-platform:#f7faff;--dsw-alias-bg-multi-select:#e8f0ff;
  --dsw-alias-interactive-bg-hover:rgba(38,49,72,.07);
  --dsw-alias-state-business-primary:#3b82f6;--dsw-alias-state-error-primary:#d92d20}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
  --dsw-alias-label-primary:#edf3fc;--dsw-alias-label-secondary:#bac8dc;--dsw-alias-label-tertiary:#a0b1c7;
  --dsw-alias-border-l2:#39485e;--dsw-alias-border-l3:#536780;
  --dsw-alias-bg-module-platform:#182333;--dsw-alias-bg-multi-select:#263b58;
  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.08);
  --dsw-alias-state-business-primary:#4f8cff;--dsw-alias-state-error-primary:#ff6b5b}}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--dsw-alias-bg-module-platform)}
body>.js-clean-frame{width:100%;height:100%}
`;
