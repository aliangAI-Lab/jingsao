import type { PetDisplay } from './types.ts';
/** 收起的目标端；both 表示两端一起收起。 */
export type HideSurface = 'web' | 'desktop' | 'both';
/** 移除目标端的显示位，保留另一端。 */
export declare function hiddenDisplay(display: PetDisplay, surface: HideSurface): PetDisplay;
/** 恢复原显示位置；缺少有效记录时回到网页。 */
export declare function restoredDisplay(record?: PetDisplay): PetDisplay;
