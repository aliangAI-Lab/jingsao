/** 第三方图片气泡的节点与共享样式测试。 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { IMAGE_BUBBLE_CLASS, IMAGE_BUBBLE_CSS, BUBBLE_IMG_CLASS, createBubbleImageFromUrl } from './whisper.ts';

describe('外部图片气泡节点', () => {
  /** 最小 DOM 桩：共用函数只用到 document.createElement（Node 里没有 DOM） */
  function stubDocument(): { created: { tag: string; props: Record<string, string> }[]; restore: () => void } {
    const created: { tag: string; props: Record<string, string> }[] = [];
    const g = globalThis as { document?: unknown };
    const prev = g.document;
    g.document = {
      createElement(tag: string) {
        const rec = { tag, props: {} as Record<string, string> };
        created.push(rec);
        return {
          dataset: {} as Record<string, string>,
          textContent: '',
          set className(v: string) {
            rec.props.className = v;
          },
          set src(v: string) {
            rec.props.src = v;
          },
          set alt(v: string) {
            rec.props.alt = v;
          },
        };
      },
      querySelector: () => null, // 视为未注入过样式 → 走注入分支
      head: { appendChild: () => {} },
    };
    return {
      created,
      restore: () => {
        g.document = prev;
      },
    };
  }

  test('createBubbleImageFromUrl —— url 形态直接用那个完整地址', () => {
    const doc = stubDocument();
    try {
      createBubbleImageFromUrl('https://cdn.example.com/拒绝换壁纸.png');
      assert.equal(doc.created.filter((c) => c.tag === 'img').length, 1);
      const img = doc.created.find((c) => c.tag === 'img');
      // 与名称形态共用同一份样式 class（气泡靠它取消 min-width）
      assert.equal(img?.props.className, BUBBLE_IMG_CLASS);
      assert.equal(img?.props.src, 'https://cdn.example.com/拒绝换壁纸.png');
    } finally {
      doc.restore();
    }
  });

  test('createBubbleImageFromUrl —— 地址缺失/空白 → null（调用方据此走纯文本路径）', () => {
    for (const v of [undefined, '', '   ']) {
      assert.equal(createBubbleImageFromUrl(v), null);
    }
  });

  test('两端选择器/变量都写在 shared 里（避免浏览器与桌面各写一份走样）', () => {
    assert.ok(IMAGE_BUBBLE_CSS.includes('.' + BUBBLE_IMG_CLASS));
    assert.ok(IMAGE_BUBBLE_CSS.includes('.' + IMAGE_BUBBLE_CLASS));
    // 尺寸同时兼容两端变量名：浏览器 --jingsao-size、桌面 --pet-size
    assert.ok(IMAGE_BUBBLE_CSS.includes('--jingsao-size'));
    assert.ok(IMAGE_BUBBLE_CSS.includes('--pet-size'));
  });
});
