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
export declare const CLEAN_PANEL_SIZE: {
    readonly width: 440;
    readonly height: 640;
};
/** 面板与鲸鱼娘之间留的缝。 */
export declare const CLEAN_PANEL_GAP = 8;
/**
 * 算面板位置。
 *
 * @param anchor - 鲸鱼娘的包围盒；null = 不知道她在哪，放在可见区域正中。
 * @param area - 可见区域（网页是视口，桌面是当前屏幕工作区）。
 * @param size - 面板想要的尺寸。
 * @param gap - 与鲸鱼娘之间的缝。
 */
export declare function placeBeside(anchor: PlaceRect | null, area: PlaceRect, size?: {
    width: number;
    height: number;
}, gap?: number): PlaceRect;
