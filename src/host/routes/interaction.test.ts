/**
 * 会话交互路由（src/host/routes/interaction.ts）中 /whisper 的契约测试：
 * ?image= 透传给生成函数、?surface= 落成 voiceTo、缺省不带、失败 reason 原样透出。
 * 锁 / 投喂 / 清气泡三个分支各有自己的覆盖，这里只钉住 /whisper 这一条链路。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { handleInteractionRoutes } from './interaction.ts';
import type { GeneratedReply, PetRouteDeps, RouteInput } from './types.ts';

/** 造一份只满足 /whisper 分支的依赖：宠物定位恒命中，生成行为由调用方给。 */
function harness(whisper: (petId: string) => Promise<GeneratedReply>) {
  const calls: { petId: string; image?: string; voiceTo?: string }[] = [];
  const deps = {
    requirePet: () => ({ ok: true, petId: 'main', entry: 'main', conf: {}, pet: {} }),
    publishWhisper: (petId: string, voiceTo?: string) => {
      calls.push({ petId, voiceTo });
      return whisper(petId);
    },
  } as unknown as PetRouteDeps;
  const call = (query: string) =>
    handleInteractionRoutes(deps, {
      url: new URL('http://127.0.0.1/jingsao-7341/whisper' + query),
      rest: 'whisper',
      method: 'POST',
    } as RouteInput);
  return { calls, call };
}

describe('handleInteractionRoutes —— /whisper 的 voiceTo（谁点的谁念）', () => {
  test('surface=web / desktop 原样落到 voiceTo', async () => {
    const web = harness(async () => ({ ok: true, text: '好' }));
    await web.call('?pet=main&surface=web');
    assert.equal(web.calls[0]?.voiceTo, 'web');

    const desktop = harness(async () => ({ ok: true, text: '好' }));
    await desktop.call('?pet=main&surface=desktop');
    assert.equal(desktop.calls[0]?.voiceTo, 'desktop');
  });

  test('surface=both / any 不足以指定一端 → 不传，交给 display 推导', async () => {
    for (const want of ['both', 'any']) {
      const probe = harness(async () => ({ ok: true, text: '好' }));
      await probe.call('?pet=main&surface=' + want);
      assert.equal(probe.calls[0]?.voiceTo, undefined, `surface=${want} 不该指定成一端`);
    }
  });
});
