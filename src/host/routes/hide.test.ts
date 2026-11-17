/** 使用真实配置与路由队列验证收起、恢复和退出桌面的完整持久化链。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllConfig, saveUserConfig } from '../config.ts';
import { flattenConfigPets } from '../../shared/config.ts';
import { createHttpRoute } from '../plugin/http-route.ts';
import { readHideRecords, hideRecordsPath } from '../hide-records.ts';
import type { PetRouteDeps } from './types.ts';

/** 每个用例持有独立配置目录，重启仅记录事件。 */
function harness() {
  const userRoot = mkdtempSync(join(tmpdir(), 'jingsao-hide-route-'));
  const userConfigPath = join(userRoot, 'main-config.jsonc');
  const petConfigDir = join(userRoot, 'pet');
  mkdirSync(petConfigDir);
  const configPaths = {
    defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
    userFile: userConfigPath,
    petDir: petConfigDir,
  };
  const base = (readAllConfig(configPaths).main.pets as Record<string, unknown>[])[0];
  const pets = ['web', 'desktop', 'both', 'none'].map((display) => ({ ...base, id: display, display }));
  const save = (extra = {}) => writeFileSync(userConfigPath, JSON.stringify({ pets, ...extra }));
  save();
  const events: string[] = [];
  const say: unknown[] = [];
  const deps = {
    configPaths,
    userRoot,
    userConfigPath,
    petConfigDir,
    state: {
      writeSection: () => events.push('config'),
      writePet: (_id: string, _key: string, body: unknown) => say.push(body),
    },
    lock: { release: () => {} },
    log: { warn: () => {} },
    requestRestart: async () => {
      events.push('restart');
    },
    suspendDesktopTray: () => events.push('suspend'),
  } as unknown as PetRouteDeps;
  const { handlePetRoute } = createHttpRoute(deps);
  const call = (route: string, body?: unknown, method = 'POST') =>
    handlePetRoute('/jingsao-7341/' + route, method, body === undefined ? undefined : JSON.stringify(body));
  const displays = () =>
    Object.fromEntries(
      (readAllConfig(configPaths).main.pets as Record<string, unknown>[]).map((pet) => [pet.id, pet.display]),
    );
  return {
    userRoot,
    configPaths,
    save,
    call,
    displays,
    say,
    events,
    dispose: () => rmSync(userRoot, { recursive: true, force: true }),
  };
}

test('批量收起先告别后写配置，重新读取记录仍可恢复原显示位置', async () => {
  const run = harness();
  try {
    const pending = run.call('pet-hide');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(run.say.length, 3);
    assert.deepEqual(run.displays(), { web: 'web', desktop: 'desktop', both: 'both', none: 'none' });
    assert.deepEqual(await pending, { kind: 'json', status: 200, obj: { ok: true }, headers: undefined });
    assert.deepEqual(run.displays(), { web: 'none', desktop: 'none', both: 'none', none: 'none' });
    assert.deepEqual(await readHideRecords(hideRecordsPath(run.userRoot)), {
      web: 'web',
      desktop: 'desktop',
      both: 'both',
    });
    await run.call('pet-restore');
    assert.deepEqual(run.displays(), { web: 'web', desktop: 'desktop', both: 'both', none: 'web' });
    assert.deepEqual(await readHideRecords(hideRecordsPath(run.userRoot)), {});
  } finally {
    run.dispose();
  }
});

test('两端连续收起保留首次 both，恢复与其他配置请求按队列执行', async () => {
  const run = harness();
  try {
    await run.call('pet-hide', { id: 'both', surface: 'web' });
    assert.equal(run.displays().both, 'desktop');
    const hide = run.call('pet-hide', { id: 'both', surface: 'desktop' });
    const restore = run.call('pet-restore', { id: 'both' });
    await Promise.all([hide, restore]);
    assert.equal(run.displays().both, 'both');
  } finally {
    run.dispose();
  }
});

test('托盘退出移除桌面位，在重启前清除常驻资格', async () => {
  const run = harness();
  try {
    await run.call('desktop-exit');
    assert.deepEqual(run.displays(), { web: 'web', desktop: 'none', both: 'web', none: 'none' });
    assert.deepEqual(run.events.slice(-2), ['suspend', 'restart']);
    await run.call('pet-restore');
    assert.equal(run.displays().desktop, 'desktop');
    assert.equal(run.displays().both, 'both');
  } finally {
    run.dispose();
  }
});

test('老配置与非法 hideTexts 回退默认，合法数组传给渲染列表', () => {
  const run = harness();
  try {
    const defaults = readAllConfig(run.configPaths).main.hideTexts;
    assert.ok(Array.isArray(defaults) && defaults.length > 0);
    for (const hideTexts of [[], [''], ['  '], [3], '告别']) {
      run.save({ hideTexts });
      assert.deepEqual(readAllConfig(run.configPaths).main.hideTexts, defaults);
    }
    run.save({ hideTexts: ['回头见'] });
    assert.deepEqual(readAllConfig(run.configPaths).main.hideTexts, ['回头见']);
    const merged = readAllConfig(run.configPaths);
    assert.deepEqual(flattenConfigPets(merged)[0].hideTexts, ['回头见']);
    assert.equal(saveUserConfig({ ...merged.main, hideTexts: [] }), null);
    assert.deepEqual(saveUserConfig({ ...merged.main, hideTexts: ['再见'] })?.hideTexts, ['再见']);
  } finally {
    run.dispose();
  }
});

test('非法请求与未知宠物保持配置原样', async () => {
  const run = harness();
  try {
    const before = run.displays();
    for (const body of [null, { id: '' }, { id: '不存在' }, { surface: '错' }]) {
      const result = await run.call('pet-hide', body);
      assert.ok(result.kind === 'json');
      assert.equal(result.status, 200);
      assert.equal(result.kind === 'json' && (result.obj as { ok: boolean }).ok, false);
    }
    const invalidMethod = await run.call('pet-hide', undefined, 'GET');
    assert.ok(invalidMethod.kind === 'json');
    assert.equal(invalidMethod.status, 405);
    assert.deepEqual(run.displays(), before);
  } finally {
    run.dispose();
  }
});

test('记录写入失败时保留当前显示，损坏记录恢复到网页', async () => {
  const run = harness();
  try {
    const path = hideRecordsPath(run.userRoot);
    mkdirSync(path + '.tmp');
    const before = run.displays();
    const failed = await run.call('pet-hide');
    assert.ok(failed.kind === 'json');
    assert.equal((failed.obj as { ok: boolean }).ok, false);
    assert.deepEqual(run.displays(), before);
    assert.equal(run.say.length, 0);
    rmSync(path + '.tmp', { recursive: true });
    writeFileSync(path, '{损坏');
    await run.call('pet-restore');
    assert.equal(run.displays().none, 'web');
  } finally {
    run.dispose();
  }
});
