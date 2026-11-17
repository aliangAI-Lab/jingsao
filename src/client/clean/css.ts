/**
 * 清理面板样式：按约 440×640 的小窗排版（380–460px 宽不横向滚动），沿用 DSH 的设计变量（与对话面板同一套），
 * 变量缺失时给出中性兜底色；深浅两套配色由外框（./frame-css）与 DSH 变量提供。
 * 结构：.js-clean-fixed（顶栏、摘要卡、工具条，不滚动）+ .js-clean-scroll（中间可滚动区）。
 * 只用 js-clean- 前缀，避免与宿主和其它插件的类名冲突。
 * @module jingsao/src/client/clean/css
 */

/** 面板 CSS 文本。 */
export const CLEAN_CSS = `
.js-clean{display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;box-sizing:border-box;overflow:hidden;
  color:var(--dsw-alias-label-primary,#1f2329);font-size:var(--dsw-font-s-14,14px)}
.js-clean *{box-sizing:border-box}
.js-clean-fixed{display:flex;flex-direction:column;gap:10px;padding:12px 14px 10px;flex-shrink:0;min-width:0;
  border-bottom:1px solid var(--dsw-alias-border-l2,#e5e6eb)}
.js-clean-scroll{flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;padding:10px 14px 20px}
.js-clean-top{display:flex;flex-direction:column;gap:5px;min-width:0}
.js-clean-bar{position:relative;height:10px;border-radius:999px;background:var(--dsw-alias-border-l2,#e5e6eb);overflow:hidden}
.js-clean-bar.is-thin{height:6px}
.js-clean-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#3b82f6,#4f8cff);transition:width .6s ease}
.js-clean-bar.is-red .js-clean-bar-fill{background:linear-gradient(90deg,#f04438,#ff6b5b)}
.js-clean-bar.is-indeterminate .js-clean-bar-fill{width:35%;animation:js-clean-slide 1.2s ease-in-out infinite}
@keyframes js-clean-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
.js-clean-bar-text,.js-clean-hint,.js-clean-explain,.js-clean-more,.js-clean-path{color:var(--dsw-alias-label-secondary,#646a73);font-size:var(--dsw-font-xxs-12,12px)}
.js-clean-explain,.js-clean-hint{overflow-wrap:anywhere}
.js-clean-path{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.js-clean-summary{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:var(--dsw-radius-md,10px);
  background:var(--dsw-alias-bg-multi-select,rgba(59,130,246,.08));min-width:0}
.js-clean-summary-row{display:flex;align-items:center;gap:10px;min-width:0}
.js-clean-summary-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;align-items:flex-start}
.js-clean-big{font-size:20px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.js-clean-result{font-size:12px;white-space:pre-line;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,#646a73)}
.js-clean-result.is-error{color:var(--dsw-alias-state-error-primary,#d92d20)}
.js-clean-confirm{display:flex;flex-direction:column;gap:8px;min-width:0}
.js-clean-confirm-text{font-size:13px;font-weight:600;overflow-wrap:anywhere;color:var(--dsw-alias-state-error-primary,#d92d20)}
.js-clean-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.js-clean-btn{border:1px solid var(--dsw-alias-border-l3,#d0d3d6);background:transparent;color:inherit;border-radius:var(--dsw-radius-md,8px);padding:6px 12px;cursor:pointer;font:inherit;white-space:nowrap}
.js-clean-btn:disabled{opacity:.45;cursor:not-allowed}
.js-clean-btn.is-primary{background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent;color:#fff}
.js-clean-btn.is-danger{background:var(--dsw-alias-state-error-primary,#f04438);border-color:transparent;color:#fff}
.js-clean-btn.is-small{padding:3px 10px;font-size:12px}
.js-clean-btn.is-main{padding:10px 18px;font-size:15px;font-weight:600;flex-shrink:0}
.js-clean-link{border:0;background:transparent;color:var(--dsw-alias-state-business-primary,#3b82f6);cursor:pointer;font:inherit;font-size:12px;padding:0}
.js-clean-link:disabled{opacity:.45;cursor:not-allowed}
.js-clean-tools{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.js-clean-tool{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;padding:6px 2px;border:1px solid transparent;
  border-radius:var(--dsw-radius-md,8px);background:transparent;color:inherit;cursor:pointer;font:inherit}
.js-clean-tool:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.js-clean-tool.is-active{border-color:var(--dsw-alias-state-business-primary,#3b82f6);background:var(--dsw-alias-bg-multi-select,rgba(59,130,246,.12))}
.js-clean-tool-label{font-size:12px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.js-clean-ico{width:18px;height:18px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
.js-clean-banner{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);
  background:var(--dsw-alias-bg-multi-select,rgba(59,130,246,.08));font-size:13px;min-width:0}
.js-clean-banner.is-legacy{background:rgba(217,119,6,.12)}
.js-clean-banner-text{flex:1;min-width:0;overflow-wrap:anywhere}
.js-clean-banner .js-clean-confirm{flex-basis:100%}
.js-clean-progress{display:flex;flex-direction:column;gap:6px;min-width:0}
.js-clean-progress .js-clean-btn{align-self:flex-start}
.js-clean-notice{padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-multi-select,rgba(59,130,246,.08));font-size:13px;overflow-wrap:anywhere}
.js-clean-notice.is-error{background:rgba(240,68,56,.1);color:var(--dsw-alias-state-error-primary,#d92d20)}
.js-clean-empty{padding:28px 8px;text-align:center;color:var(--dsw-alias-label-tertiary,#8f959e)}
.js-clean-groups,.js-clean-list{display:flex;flex-direction:column;gap:8px;min-width:0}
.js-clean-group{border:1px solid var(--dsw-alias-border-l2,#e5e6eb);border-radius:var(--dsw-radius-md,8px);min-width:0}
.js-clean-group.is-report{border-style:dashed}
.js-clean-group-head,.js-clean-line-head{display:flex;align-items:center;gap:8px;min-width:0}
.js-clean-group-head{padding:8px 10px}
.js-clean-group-name{flex:1;min-width:0;display:flex;align-items:center;gap:6px;border:0;background:transparent;padding:0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.js-clean-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.js-clean-caret{color:var(--dsw-alias-label-tertiary,#8f959e);font-size:12px;flex-shrink:0}
.js-clean-size{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;flex-shrink:0}
.js-clean-size.is-admin{font-weight:400;font-size:12px;color:var(--dsw-alias-label-secondary,#646a73)}
.js-clean-lines{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2,#e5e6eb)}
.js-clean-line{display:flex;flex-direction:column;gap:4px;padding:7px 10px 7px 30px;min-width:0}
.js-clean-line+.js-clean-line{border-top:1px solid var(--dsw-alias-border-l2,#eef0f3)}
.js-clean-line .js-clean-size{font-weight:400;font-size:13px}
.js-clean-warn{flex-shrink:0;width:16px;height:16px;border-radius:50%;border:0;padding:0;font:inherit;font-size:11px;font-weight:700;line-height:16px;
  text-align:center;cursor:pointer;background:rgba(217,119,6,.18);color:#b45309}
.js-clean-warn-text{font-size:12px;color:#b45309;overflow-wrap:anywhere}
.js-clean-admin{display:inline-flex;flex-shrink:0;color:var(--dsw-alias-label-secondary,#646a73)}
.js-clean-admin .js-clean-ico{width:14px;height:14px}
.js-clean-report{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.js-clean-tool-head{display:flex;flex-direction:column;gap:6px;align-items:flex-start;margin-bottom:10px;min-width:0}
.js-clean-toolview{display:flex;flex-direction:column;gap:8px;min-width:0}
.js-clean-subtitle{margin-top:4px;font-weight:600;font-size:13px}
.js-clean-select{border:1px solid var(--dsw-alias-border-l3,#d0d3d6);border-radius:var(--dsw-radius-sm,6px);padding:4px 8px;background:transparent;color:inherit;font:inherit;font-size:12px;max-width:100%;min-width:0}
.js-clean-select option{color:#1f2329}
.js-clean-drives{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px}
.js-clean-check{display:inline-flex;align-items:center;gap:3px}
.js-clean-cat{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#e5e6eb);border-radius:var(--dsw-radius-md,8px);min-width:0}
.js-clean-cat.is-report{opacity:.8;border-style:dashed}
.js-clean-items{display:flex;flex-direction:column;gap:2px;margin-top:4px;max-height:240px;overflow-y:auto;overflow-x:hidden}
.js-clean-item{display:flex;align-items:center;gap:6px;font-size:12px;min-width:0}
.js-clean-item-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.js-clean-item .js-clean-size{font-weight:400}
.js-clean-tag{font-size:11px;padding:0 6px;border-radius:999px;background:rgba(22,163,74,.12);color:#16a34a;white-space:nowrap;max-width:96px;overflow:hidden;text-overflow:ellipsis}
.js-clean-foot{position:sticky;bottom:-20px;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;padding:10px 0;background:var(--js-clean-bg,var(--dsw-alias-bg-module-platform,#fff))}
.js-clean-section{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#e5e6eb)}
.js-clean-batch{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-multi-select,rgba(59,130,246,.06));min-width:0}
.js-clean-batch-text{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.js-clean input[type='checkbox']{flex-shrink:0;margin:0}
`;
