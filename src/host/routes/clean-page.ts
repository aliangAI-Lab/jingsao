/**
 * 清理面板的独立页：`GET /clean/page`（HTML 壳）与 `GET /clean/page.js`（lib/clean-page.js）。
 *
 * 桌面右键「清理C盘」弹出的小窗加载的就是这一页；面板代码与网页浮层、右侧栏是同一份
 * （src/client/clean/panel.ts），由 tsdown 的 clean-page 入口连同 React 一起打成 lib/clean-page.js。
 * 只读、无副作用。脚本缺产物时明确回 404，绝不回空脚本让小窗只剩一块空白。
 *
 * 页面里的请求打相对路径 `jingsao-7341/clean/...`：`<base href="../../">` 把基准定到挂载根，
 * 于是 HTTP 直连（独立应用）、jingsao-bridge 自定义协议（DSH 里的桌面 Helper）与带挂载前缀的反代
 * 三种情况都按同源解析，不需要页面知道自己是怎么被打开的。
 * @module jingsao/src/host/routes/clean-page
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLEAN_CSS } from '../../client/clean/css.ts';
import { CLEAN_FRAME_CSS, CLEAN_PAGE_THEME_CSS } from '../../client/clean/frame-css.ts';
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import { PACKAGE_ROOT } from '../paths.ts';
import type { RouteResult } from '../http.ts';

/** 小窗标题（窗口标题栏与 <title> 共用）。 */
export const CLEAN_PAGE_TITLE = '鲸鱼娘的 C 盘清理';

/** 页面挂载点 id 与关闭按钮 id：page-mount 按这两个 id 取节点，改名两边一起改。 */
export const CLEAN_PAGE_ROOT_ID = 'clean-root';
export const CLEAN_PAGE_CLOSE_ID = 'clean-close';

/** HTML 壳：主题变量、面板样式、自绘标题栏、挂载点与脚本引用。 */
export function cleanPageHtml(): string {
  // 路由段去掉开头的「/」才是相对路径：配合 <base href="../../"> 解析到 <挂载根>/jingsao-7341/clean/page.js
  const script = ROUTE_SEGMENT.slice(1) + '/clean/page.js';
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<base href="../../">' +
    `<title>${CLEAN_PAGE_TITLE}</title>` +
    `<style>${CLEAN_PAGE_THEME_CSS}${CLEAN_CSS}${CLEAN_FRAME_CSS}</style></head>` +
    '<body><div class="js-clean-frame">' +
    `<header class="js-clean-titlebar"><span class="js-clean-titlebar-text">${CLEAN_PAGE_TITLE}</span>` +
    `<button type="button" class="js-clean-close" id="${CLEAN_PAGE_CLOSE_ID}" aria-label="关闭" title="关闭">✕</button></header>` +
    `<main class="js-clean-body" id="${CLEAN_PAGE_ROOT_ID}"></main>` +
    `</div><script src="${script}"></script></body></html>`
  );
}

/**
 * 独立页资源：`page` → HTML 壳；`page.js` → 打包好的面板脚本；其余返回 undefined 交回清理路由。
 *
 * @param action - `/clean/` 之后的那一段。
 * @param root - 包根（测试注入临时目录，验证「有产物 / 缺产物」两种情况）。
 */
export function cleanPageResource(action: string, root = PACKAGE_ROOT): RouteResult | undefined {
  if (action === 'page') {
    return { kind: 'text', status: 200, body: cleanPageHtml(), contentType: 'text/html; charset=utf-8' };
  }
  if (action !== 'page.js') return undefined;
  let script: string;
  try {
    script = readFileSync(join(root, 'lib', 'clean-page.js'), 'utf8');
  } catch {
    return { kind: 'text', status: 404, body: '清理面板脚本缺失，请重新构建（npm run build）' };
  }
  return { kind: 'text', status: 200, body: script, contentType: 'text/javascript; charset=utf-8' };
}
