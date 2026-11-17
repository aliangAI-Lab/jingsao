import type { RouteResult } from '../http.ts';
/** 小窗标题（窗口标题栏与 <title> 共用）。 */
export declare const CLEAN_PAGE_TITLE = "\u9CB8\u9C7C\u5A18\u7684 C \u76D8\u6E05\u7406";
/** 页面挂载点 id 与关闭按钮 id：page-mount 按这两个 id 取节点，改名两边一起改。 */
export declare const CLEAN_PAGE_ROOT_ID = "clean-root";
export declare const CLEAN_PAGE_CLOSE_ID = "clean-close";
/** HTML 壳：主题变量、面板样式、自绘标题栏、挂载点与脚本引用。 */
export declare function cleanPageHtml(): string;
/**
 * 独立页资源：`page` → HTML 壳；`page.js` → 打包好的面板脚本；其余返回 undefined 交回清理路由。
 *
 * @param action - `/clean/` 之后的那一段。
 * @param root - 包根（测试注入临时目录，验证「有产物 / 缺产物」两种情况）。
 */
export declare function cleanPageResource(action: string, root?: string): RouteResult | undefined;
