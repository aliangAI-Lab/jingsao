/**
 * 桌面应用出站请求的访问凭证注入。
 *
 * 只负责给「本机渲染端发起、目标为插件路由」的请求附加令牌；不生成、不校验令牌（校验在宿主路由侧）。
 * 依赖 Electron 的 session 请求拦截与 file:// 渲染页。始终成立：令牌只进请求头，且只对顶层渲染端
 * 指向本机 origin 的插件路由生效，重定向目标不携带。
 * @module jingsao/src/app/desktop-auth
 */

import { pathToFileURL } from 'node:url';
import { ROUTE_SEGMENT } from '../shared/constants.ts';

/** 一次出站请求的最小形态：只声明注入凭证需要读的字段。 */
interface RequestDetails {
  url: string;
  requestHeaders: Record<string, string>;
  frame?: { url: string; parent: unknown } | null;
  /** Electron 的资源类型；顶层导航是 `mainFrame`。 */
  resourceType?: string;
}

/** 桌面清理小窗加载的独立页（runtime/electron-helper/main/clean-window.js 打开它）。 */
const CLEAN_PAGE_PATH = ROUTE_SEGMENT + '/clean/page';

/** 主进程默认 session 的最小形态（只用到请求头拦截）。 */
export interface DesktopSession {
  webRequest: {
    onBeforeSendHeaders(
      listener: (
        details: RequestDetails,
        callback: (response: { requestHeaders: Record<string, string> }) => void,
      ) => void,
    ): void;
  };
}

/** 解析地址；非法时返回 undefined。 */
function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/**
 * 为本机桌面渲染端访问插件路由的请求附加访问令牌。
 *
 * 目标必须是本机 origin 下的插件路由段，且请求方是下面两者之一，任一不满足都不加令牌：
 * - 宠物窗口：顶层 frame、地址是 Helper 的 file 渲染页；
 * - 清理小窗：顶层导航到 `/jingsao-7341/clean/page`，或由这一页（顶层 frame、同一 origin）发出的请求。
 *   小窗与宠物窗口同一个默认 session、同一枚令牌、同一个请求头，不另起一套鉴权。
 * 先删同名请求头再按需写入，避免调用方自带的伪令牌被带到别的目标。
 *
 * @param session - 主进程默认 session（出站请求拦截）。
 * @param origin - 本机服务 origin。
 * @param rendererPath - 桌面 Helper 渲染页绝对路径。
 * @param token - 访问令牌。
 */
export function installDesktopAuth(session: DesktopSession, origin: string, rendererPath: string, token: string): void {
  const renderer = pathToFileURL(rendererPath).href;
  const cleanPage = origin + CLEAN_PAGE_PATH;
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    // 重定向后的请求不得把凭证带去别的目标。
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'x-jingsao-token') delete headers[name];
    }
    try {
      const target = new URL(details.url);
      const toPlugin = target.origin === origin && target.pathname.startsWith(ROUTE_SEGMENT + '/');
      // 清理小窗的顶层导航：此时 frame 还是导航前的空页，只能按「导航目标就是这一页」认
      const opensCleanPage = details.resourceType === 'mainFrame' && target.pathname === CLEAN_PAGE_PATH;
      const frame = details.frame;
      // 新建窗口首次导航时 frame.url 是空串：解析失败当作「没有来源页」，不影响上面的导航判定
      const page = frame && frame.parent === null ? parseUrl(frame.url) : undefined;
      const pageHref = page?.href.split(/[?#]/, 1)[0];
      const fromPetWindow = page?.protocol === 'file:' && page.origin === 'null' && pageHref === renderer;
      const fromCleanPage = page?.origin === origin && pageHref === cleanPage;
      if (toPlugin && (opensCleanPage || fromPetWindow || fromCleanPage)) {
        headers['X-Jingsao-Token'] = token;
      }
    } catch {
      // frame 缺失/已销毁或地址非法时，一律不授予凭证。
    }
    callback({ requestHeaders: headers });
  });
}
