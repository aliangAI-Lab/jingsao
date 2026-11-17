import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  decideBroadcast,
  decideBubbleClear,
  normalizeBroadcastAnim,
  normalizeBroadcastDuration,
  normalizeBroadcastText,
  normalizeBroadcastVoice,
} from './broadcast.ts';

/** 池里真实存在的两张图 */
/** 配置里写了、但磁盘上没有对应 png → readMemePool 会剔除，投喂时算"不在池内" */

let tempRoot = '';
let cfg: Record<string, Record<string, unknown>>;

const decide = (over: Partial<Parameters<typeof decideBroadcast>[0]> = {}) =>
  decideBroadcast({
    cfg,
    requested: 'main',
    text: '主人，该喝水了',
    url: undefined,
    duration: 10000,
    anim: true,
    ...over,
  });

before(() => {
  const root = mkdtempSync(join(tmpdir(), 'jingsao-broadcast-'));
  tempRoot = root;

  cfg = {
    main: {
      pets: [
        { id: 'main', name: '蓝毛小女仆' },
        { id: 'test1', name: '测试宠' },
      ],
    },
  };
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('normalizeBroadcastText —— 文本规范化（路由与决策层共用同一条规则）', () => {
  test('非字符串一律归零（不是抛错，也不是字符串化）', () => {
    for (const v of [undefined, null, 123, {}, [], true]) {
      assert.equal(normalizeBroadcastText(v), '', `${JSON.stringify(v)} 应归一成空串`);
    }
  });

  test('纯空白与前后空白：trim 后判定', () => {
    assert.equal(normalizeBroadcastText('   '), '');
    assert.equal(normalizeBroadcastText('\n\t '), '');
    assert.equal(normalizeBroadcastText('  说话  '), '说话');
  });
});

describe('decideBroadcast —— 不设长度限制', () => {
  test('超长文本照常通过（内容长度由调用方自己负责）', () => {
    // 投喂不设长度限制、也不限频：宿主只保证"非空就搬运"，不截断、不丢弃。
    const long = 'x'.repeat(100000);
    const d = decide({ text: long });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.text.length, 100000);
  });
});

describe('decideBroadcast —— 文本校验', () => {
  test('空 / 纯空白 / 缺字段 → bad-request', () => {
    for (const text of ['', '   ', undefined, null, 42]) {
      const d = decide({ text });
      assert.equal(d.ok, false);
      assert.equal(d.ok === false && d.reason, 'bad-request');
    }
  });

  test('文本 trim 后写入（前后空白不进气泡）', () => {
    const d = decide({ text: '  该喝水了  ' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.text, '该喝水了');
  });
});

describe('decideBroadcast —— 宠物选择', () => {
  test('指定存在的宠物 → 用它', () => {
    const d = decide({ requested: 'test1' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.petId, 'test1');
  });

  test('不指定 pet → pet-required（缺省链已删除：绝不退到"当前桌宠"/列表第一只）', () => {
    for (const empty of ['', '   ']) {
      const d = decide({ requested: empty });
      assert.equal(d.ok, false);
      assert.equal(d.ok === false && d.reason, 'pet-required');
    }
  });

  test('指定不存在的宠物 → unknown-pet（显式失败，不静默写进一个没人看的叶子）', () => {
    const d = decide({ requested: 'ghost' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-pet');
    assert.match(d.ok === false ? d.message : '', /ghost/);
  });

  test('宠物 id 含点号照常（不按点号切分 id）', () => {
    const dotted = { main: { ...cfg.main, pets: [{ id: 'a.b', name: '点号宠' }] } };
    const d = decide({ cfg: dotted, requested: 'a.b' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.petId, 'a.b');
  });
});

describe('normalizeBroadcastDuration —— 气泡时长（issue #122 第 5 条）', () => {
  test('缺省 / null → 10s（老调用方的行为一个字不变）', () => {
    assert.equal(normalizeBroadcastDuration(undefined), 10000);
    assert.equal(normalizeBroadcastDuration(null), 10000);
  });

  test('合法值原样透出；`0` 是合法值（字面意思：不显示）；不设上限', () => {
    assert.equal(normalizeBroadcastDuration(0), 0);
    assert.equal(normalizeBroadcastDuration(1), 1);
    assert.equal(normalizeBroadcastDuration(3000), 3000);
    assert.equal(normalizeBroadcastDuration(999999999), 999999999);
  });

  test('负数 / 非有限数 / 非数字 → null（路由据此回 bad-request）', () => {
    for (const v of [-1, -0.5, NaN, Infinity, -Infinity, '3000', {}, [], true]) {
      assert.equal(normalizeBroadcastDuration(v), null, `${JSON.stringify(v)} 应判非法`);
    }
  });
});

describe('normalizeBroadcastAnim —— 动画联动开关（只有严格 false 才关闭）', () => {
  test('只有严格 false 才关闭', () => {
    assert.equal(normalizeBroadcastAnim(false), false);
  });

  test('其余一律按"要联动"：缺省、true、字符串 "false"、0、null 都算开', () => {
    for (const v of [undefined, null, true, 'false', 0, 1, {}]) {
      assert.equal(normalizeBroadcastAnim(v), true, `${JSON.stringify(v)} 应按联动处理`);
    }
  });
});

describe('normalizeBroadcastVoice —— 播报开关（只有严格 true 才念）', () => {
  test('只有严格 true 才念', () => {
    assert.equal(normalizeBroadcastVoice(true), true);
  });

  test('缺省与其余值一律不念：undefined、null、false、字符串 "true"、1 都不出声', () => {
    for (const v of [undefined, null, false, 'true', 1, 0, {}]) {
      assert.equal(normalizeBroadcastVoice(v), false, `${JSON.stringify(v)} 不该出声`);
    }
  });
});

describe('decideBroadcast —— 新参数原样进入结论（写进叶子的是解析后的生效值）', () => {
  test('缺省解析成显式值：10s + 联动', () => {
    const d = decide();
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.duration, 10000);
    assert.equal(d.ok === true && d.anim, true);
  });

  test('调用方给的值原样带出（含 duration=0 与 anim=false）', () => {
    const d = decide({ duration: 0, anim: false });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.duration, 0);
    assert.equal(d.ok === true && d.anim, false);
  });

  test('失败分支不带这两个字段（调用方不会误以为生效了）', () => {
    const d = decide({ text: '', duration: 0, anim: false });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && 'duration' in d, false);
  });
});

describe('decideBubbleClear —— 清空气泡（只有"清哪只宠物"会失败）', () => {
  test('指定存在的宠物 → 通过', () => {
    const d = decideBubbleClear({ cfg, requested: 'test1' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.petId, 'test1');
  });

  test('pet 缺省 → pet-required（与 /broadcast 同一条口径）', () => {
    const d = decideBubbleClear({ cfg, requested: '' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'pet-required');
  });

  test('不存在的宠物 → unknown-pet（显式失败，不去写一个没人看的叶子）', () => {
    const d = decideBubbleClear({ cfg, requested: 'ghost' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-pet');
    assert.match(d.ok === false ? d.message : '', /ghost/);
  });

  test('没有"气泡不存在"这种失败：空状态下也是 ok（幂等）', () => {
    // 决策层看不到气泡当前显隐，本来就不该为它造一个失败分支
    assert.equal(decideBubbleClear({ cfg, requested: 'main' }).ok, true);
  });
});
