/**
 * 网页端清理面板的两个入口：鲸鱼娘旁边的浮层（右键「清理C盘」、宿主打开请求都开它），
 * 以及右侧栏的「C盘清理」标签（浮层标题栏「在侧栏打开」与侧栏指南页进这里，作为看详情的地方）。
 *
 * 浮层注册进 shell.overlay（与宠物同槽，不自己往 body 上挂）；侧栏服务缺失时只告警，浮层照常可用。
 * 两处渲染的是同一份面板（./panel），样式只注入一次。
 * @module jingsao/src/client/clean/register
 */
import { CLEAN_CSS } from './css.ts';
import { CLEAN_FRAME_CSS } from './frame-css.ts';
import { makeCleanLayer } from './layer.ts';
import { makeCleanPanel, type CleanPanelRuntime } from './panel.ts';
import type { PetChatTabHost } from '../chat/register.ts';

/** 标签 id 与类型（全局唯一，带插件名前缀）。 */
const TAB_ID = 'jingsao-clean';
const TAB_KIND = 'jingsao-clean';

/** 浮层在 shell.overlay 里的 id 与次序（宠物是 1000，浮层压在宠物之上）。 */
const LAYER_ID = 'jingsao-clean-layer';
const LAYER_ORDER = 1100;

/** 侧栏标签注册表的最小形状。 */
interface SidebarTabRegistry {
  register(definition: {
    readonly id: string;
    readonly kind: string;
    readonly priority: 'extension';
    readonly title: () => string;
    readonly guide: readonly { id: string; order: number; title: () => string; description?: () => string }[];
  }): () => void;
}

/** 打开清理标签。 */
export function openCleanTab(ctx: PetChatTabHost): void {
  const controller = ctx.get?.('sidebarRight') as { openTab?(kind: string): void } | undefined;
  controller?.openTab?.(TAB_KIND);
}

/** 注入样式、注册浮层与侧栏标签；返回清理函数。 */
export function registerCleanTab(ctx: PetChatTabHost, rt: CleanPanelRuntime): () => void {
  const style = document.createElement('style');
  style.dataset.jingsaoCss = 'clean-panel';
  style.textContent = CLEAN_CSS + CLEAN_FRAME_CSS;
  document.head.appendChild(style);

  // 浮层：打开信号（右键菜单 / 宿主 /state 的 clean 段）由它自己监听，见 ./layer
  const Layer = makeCleanLayer(rt, () => openCleanTab(ctx));
  ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register({ name: 'shell.overlay', id: LAYER_ID, order: LAYER_ORDER }, Layer);
  });

  const tabs = ctx.get?.('sidebarRightTabs') as SidebarTabRegistry | undefined;
  if (tabs === undefined || typeof tabs.register !== 'function') {
    console.warn('[jingsao] 右侧栏不可用：没有 sidebarRightTabs 服务，清理面板只在浮层里打开');
    return () => style.remove();
  }
  const Panel = makeCleanPanel(rt);
  const disposeType = tabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    priority: 'extension',
    title: () => 'C盘清理',
    guide: [
      {
        id: TAB_KIND,
        order: 390,
        title: () => 'C盘清理',
        description: () => '让鲸鱼娘帮你扫一遍 C 盘：清垃圾、清微信QQ、找重复、搬大文件和软件，删之前就地确认风险项',
      },
    ],
  });
  ctx.slots.inject('sidebar.right.pane.tab', function* () {
    yield ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, order: 90 }, () => rt.h(Panel, {}));
  });
  return () => {
    disposeType();
    style.remove();
  };
}
