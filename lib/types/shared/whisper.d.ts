/** 说话气泡的文本视图、第三方图片节点与语音状态样式。 */
export type WhisperState = {
    ok: true;
    text: string;
    ts: number;
} | {
    ok: false;
    reason: 'provider-missing' | 'generate-error';
    message?: string;
};
/** 碎碎念气泡行数据：一句话（role: 'label' 单行，复用余额气泡的通用行渲染）。 */
export type WhisperBubbleRow = {
    role: 'label';
    text: string;
};
/** 碎碎念文本 → 气泡行（两端共用同一份行数据）。 */
export declare function whisperBubbleView(state: WhisperState): WhisperBubbleRow[];
export declare const BUBBLE_IMG_CLASS = "pet-bub-img";
/** 带图气泡 class：取消 min-width，让气泡贴合图片宽度（否则图旁留大片空白）。 */
export declare const IMAGE_BUBBLE_CLASS = "has-img";
export declare const IMAGE_BUBBLE_CSS: string;
export declare function injectImageBubbleCss(): void;
export declare function createBubbleImageFromUrl(url?: string): HTMLImageElement | null;
