/**
 * 清理面板贴着鲸鱼娘放在哪：网页浮层用它算视口内的位置。
 *
 * 规则与桌面小窗（runtime/electron-helper/main/clean-window.js 的 cleanWindowBounds）一致：
 * 右侧放得下就放右侧，否则放左侧；两边都放不下时放空间大的一侧并贴住可见区域的边；
 * 竖直方向与鲸鱼娘底边对齐，再夹回可见区域。面板比可见区域还大时先缩到可见区域。
 * 纯函数，不碰 DOM。
 * @module jingsao/src/client/clean/place
 */

/** 矩形（左上角 + 宽高）。 */
export interface PlaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 面板默认尺寸（CSS 像素）。 */
export const CLEAN_PANEL_SIZE = { width: 440, height: 640 } as const;

/** 面板与鲸鱼娘之间留的缝。 */
export const CLEAN_PANEL_GAP = 8;

/**
 * 算面板位置。
 *
 * @param anchor - 鲸鱼娘的包围盒；null = 不知道她在哪，放在可见区域正中。
 * @param area - 可见区域（网页是视口，桌面是当前屏幕工作区）。
 * @param size - 面板想要的尺寸。
 * @param gap - 与鲸鱼娘之间的缝。
 */
export function placeBeside(
  anchor: PlaceRect | null,
  area: PlaceRect,
  size: { width: number; height: number } = CLEAN_PANEL_SIZE,
  gap = CLEAN_PANEL_GAP,
): PlaceRect {
  const width = Math.max(0, Math.min(size.width, area.width));
  const height = Math.max(0, Math.min(size.height, area.height));
  const minX = area.x;
  const maxX = area.x + area.width - width;
  const minY = area.y;
  const maxY = area.y + area.height - height;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));
  if (anchor === null) {
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
    };
  }
  const right = anchor.x + anchor.width + gap;
  const left = anchor.x - gap - width;
  let x: number;
  if (right <= maxX) x = right;
  else if (left >= minX) x = left;
  else {
    // 两边都放不下：哪边空得多就贴哪边的屏幕边（会压住一部分鲸鱼娘，但整个面板都看得见）
    const roomRight = area.x + area.width - (anchor.x + anchor.width);
    const roomLeft = anchor.x - area.x;
    x = roomRight >= roomLeft ? maxX : minX;
  }
  return {
    x: Math.round(clamp(x, minX, maxX)),
    y: Math.round(clamp(anchor.y + anchor.height - height, minY, maxY)),
    width,
    height,
  };
}
