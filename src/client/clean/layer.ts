/**
 * 网页端的清理浮层：右键「清理C盘」或宿主的打开请求到来时，在鲸鱼娘旁边弹出一个约 440×640 的浮动面板。
 *
 * 浮层组件注册进 DSH 的 shell.overlay 插槽（与宠物同槽，见 ./register），不自己往 body 上挂；
 * 里面直接渲染右侧栏同一份清理面板（./panel），用的是 DSH 注入的 React，不需要 iframe。
 * 标题栏可拖动，右上角关闭，Esc 关闭；「在侧栏打开」关掉浮层改开右侧栏标签（看详情的地方保留）。
 * 关浮层只是卸载视图：清理任务在宿主里跑，重新打开会接着显示进度。
 * @module jingsao/src/client/clean/layer
 */
import { OPEN_CLEAN_EVENT } from './open.ts';
import { makeCleanPanel, type CleanPanelRuntime } from './panel.ts';
import { CLEAN_PANEL_SIZE, placeBeside, type PlaceRect } from './place.ts';

/** 浮层标题。 */
const TITLE = '鲸鱼娘的 C 盘清理';

/** 视口矩形。 */
function viewport(): PlaceRect {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

/** 元素的包围盒；元素已不在页面上时返回 null。 */
function rectOf(el: Element | null | undefined): PlaceRect | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** 把位置夹回视口（拖动与窗口缩放共用）。 */
function clampToView(pos: PlaceRect): PlaceRect {
  const view = viewport();
  const width = Math.min(CLEAN_PANEL_SIZE.width, view.width);
  const height = Math.min(CLEAN_PANEL_SIZE.height, view.height);
  return {
    x: Math.max(0, Math.min(pos.x, view.width - width)),
    y: Math.max(0, Math.min(pos.y, view.height - height)),
    width,
    height,
  };
}

/**
 * 造浮层组件。
 *
 * @param rt - DSH 注入的 React 原语（与右侧栏面板同一套）。
 * @param openSidebar - 「在侧栏打开」：打开右侧栏的清理标签。
 */
export function makeCleanLayer(rt: CleanPanelRuntime, openSidebar: () => void): () => unknown {
  const { useState, useEffect, useRef } = rt;
  // 与面板同口径：子节点收进 props.children，注入的是 jsx 还是 createElement 都能用
  const h = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown =>
    rt.h(type, {
      ...(props ?? {}),
      ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }),
    });
  const Panel = makeCleanPanel(rt);

  return function CleanLayer(): unknown {
    const [pos, setPos] = useState<PlaceRect | null>(null);
    /** 最近一次被右键的那只宠物：菜单项点下去时浮层就贴着她弹出。 */
    const anchorEl = useRef<Element | null>(null);
    const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

    useEffect(() => {
      const remember = (event: MouseEvent): void => {
        const pet = event.target instanceof Element ? event.target.closest('.jingsao-root') : null;
        if (pet) anchorEl.current = pet;
      };
      const open = (): void => {
        // 已经开着就不挪位置（用户可能刚拖过）；没开过就贴着最近右键的那只，找不到就用页面上第一只
        setPos(
          (prev) =>
            prev ??
            placeBeside(rectOf(anchorEl.current) ?? rectOf(document.querySelector('.jingsao-root')), viewport()),
        );
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') setPos(null);
      };
      const onResize = (): void => setPos((prev) => (prev ? clampToView(prev) : null));
      document.addEventListener('contextmenu', remember, true);
      window.addEventListener(OPEN_CLEAN_EVENT, open);
      window.addEventListener('keydown', onKey);
      window.addEventListener('resize', onResize);
      return () => {
        document.removeEventListener('contextmenu', remember, true);
        window.removeEventListener(OPEN_CLEAN_EVENT, open);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
      };
    }, []);

    if (pos === null) return null;
    const close = (): void => setPos(null);
    const titlebar = h(
      'header',
      {
        className: 'js-clean-titlebar',
        onPointerDown: (event: PointerEvent) => {
          if (event.button !== 0 || (event.target as Element).closest('button')) return;
          drag.current = { x: event.clientX, y: event.clientY, left: pos.x, top: pos.y };
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        },
        onPointerMove: (event: PointerEvent) => {
          const start = drag.current;
          if (start === null) return;
          setPos(
            clampToView({
              ...pos,
              x: start.left + event.clientX - start.x,
              y: start.top + event.clientY - start.y,
            }),
          );
        },
        onPointerUp: () => {
          drag.current = null;
        },
        onLostPointerCapture: () => {
          drag.current = null;
        },
      },
      h('span', { className: 'js-clean-titlebar-text' }, TITLE),
      h(
        'button',
        {
          type: 'button',
          title: '在右侧栏打开清理面板',
          onClick: () => {
            close();
            openSidebar();
          },
        },
        '在侧栏打开',
      ),
      h(
        'button',
        { type: 'button', className: 'js-clean-close', 'aria-label': '关闭', title: '关闭', onClick: close },
        '✕',
      ),
    );
    return h(
      'section',
      {
        className: 'js-clean-frame js-clean-layer',
        role: 'dialog',
        'aria-label': TITLE,
        style: {
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: pos.width,
          height: pos.height,
          zIndex: 2147483000,
          pointerEvents: 'auto',
          borderRadius: 12,
          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
          boxShadow: 'var(--dsw-elevation-prominent, 0 12px 40px rgba(0,0,0,.35))',
        },
      },
      titlebar,
      // 清理 / 搬家被宿主接受后面板调 onClose：浮层立刻关掉，任务在宿主后台跑
      h('div', { className: 'js-clean-body' }, h(Panel, { onClose: close })),
    );
  };
}
