/** 说话气泡的文本视图、第三方图片节点与语音状态样式。 */
export type WhisperState =
  | { ok: true; text: string; ts: number }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** 碎碎念气泡行数据：一句话（role: 'label' 单行，复用余额气泡的通用行渲染）。 */
export type WhisperBubbleRow = { role: 'label'; text: string };

/** 碎碎念文本 → 气泡行（两端共用同一份行数据）。 */
export function whisperBubbleView(state: WhisperState): WhisperBubbleRow[] {
  if (state.ok) return [{ role: 'label', text: state.text }];
  const msg =
    state.reason === 'provider-missing'
      ? '当前对话未配置模型，碎碎念不可用'
      : '碎碎念生成失败' + (state.message ? '：' + state.message : '');
  return [{ role: 'label', text: msg }];
}

export const BUBBLE_IMG_CLASS = 'pet-bub-img';
/** 带图气泡 class：取消 min-width，让气泡贴合图片宽度（否则图旁留大片空白）。 */
export const IMAGE_BUBBLE_CLASS = 'has-img';

export const IMAGE_BUBBLE_CSS = [
  '.pet-bub-img{--m:var(--f,calc(var(--jingsao-size,var(--pet-size,462px))*0.0455));display:block;' +
    'width:calc(var(--m)*7.4725);max-width:100%;height:auto;border-radius:calc(var(--m)*0.5714);' +
    'margin:0 auto calc(var(--m)*0.3736);object-fit:cover;pointer-events:none;user-select:none}',
  '.pet-bubble.has-img,.jingsao-bubble.has-img{min-width:0}',
  // 语音状态角标：两端共用；绝对定位在气泡右下角，不参与文字排版、不撑高气泡。
  '.jingsao-voice-badge{position:absolute;right:calc(var(--f,21px)*0.25);bottom:calc(var(--f,21px)*0.15);' +
    'width:calc(var(--f,21px)*0.66);height:calc(var(--f,21px)*0.66);display:flex;align-items:center;' +
    'justify-content:center;font-size:calc(var(--f,21px)*0.5);line-height:1;opacity:.65;pointer-events:none}',
  // 加载态：只有上半圈有颜色的细环，靠旋转表达「在转」。
  '.jingsao-voice-badge.is-loading::before{content:"";width:calc(var(--f,21px)*0.5);height:calc(var(--f,21px)*0.5);' +
    'border:1.5px solid rgba(43,43,43,.22);border-top-color:rgba(43,43,43,.7);border-radius:50%;' +
    'animation:jingsao-voice-spin .8s linear infinite}',
  '@keyframes jingsao-voice-spin{to{transform:rotate(360deg)}}',
  // 失败态：静音喇叭，压一点透明度——读得出「这句没念出来」，但不抢文字。
  '.jingsao-voice-badge.is-failed{opacity:.5}',
].join('');

/** 只注入一次（页面已有同一标记则跳过）。 */
let imageCssInjected = false;
export function injectImageBubbleCss(): void {
  if (imageCssInjected || typeof document === 'undefined') return;
  imageCssInjected = true;
  if (document.querySelector('style[data-plugin-css="jingsao/image-bubble"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'jingsao';
  tag.dataset.pluginCss = 'jingsao/image-bubble';
  tag.textContent = IMAGE_BUBBLE_CSS;
  document.head.appendChild(tag);
}

export function createBubbleImageFromUrl(url?: string): HTMLImageElement | null {
  const href = String(url ?? '').trim();
  if (!href) return null;
  injectImageBubbleCss();
  const img = document.createElement('img');
  img.className = BUBBLE_IMG_CLASS;
  img.src = href;
  img.alt = '';
  return img;
}
