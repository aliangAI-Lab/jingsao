/** 重新安装后叫回鲸鱼娘：用真实配置与路由队列验证「新安装才叫回、只叫回全部收起的、叫回到桌面」。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllConfig } from './config.ts';
import { createHttpRoute } from './plugin/http-route.ts';
import { readHideRecords, hideRecordsPath, writeHideRecords } from './hide-records.ts';
import { installStampOf, installStampPath, restoreAfterReinstall } from './reinstall-restore.ts';
import type { PetRouteDeps } from './routes/types.ts';

/** 每个用例一份独立的用户目录 + 假的插件包目录；宠物按给定 display 落盘。 */
function harness(displays: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'jingsao-reinstall-'));
  const userRoot = join(root, 'user');
  const packageRoot = join(root, 'pkg');
  mkdirSync(join(userRoot, 'pet'), { recursive: true });
  mkdirSync(packageRoot);
  const configPaths = {
    defaultFile: fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url)),
    userFile: join(userRoot, 'main-config.jsonc'),
    petDir: join(userRoot, 'pet'),
  };
  const base = (readAllConfig(configPaths).main.pets as Record<string, unknown>[])[0];
  const save = (next: Record<string, string>) =>
    writeFileSync(
      configPaths.userFile,
      JSON.stringify({ pets: Object.entries(next).map(([id, display]) => ({ ...base, id, display })) }),
    );
  save(displays);
  const events: string[] = [];
  const deps = {
    configPaths,
    userRoot,
    userConfigPath: configPaths.userFile,
    petConfigDir: configPaths.petDir,
    state: { writeSection: () => {}, writePet: () => {} },
    lock: { release: () => {} },
    log: { warn: () => {} },
    requestRestart: async () => {
      events.push('restart');
    },
  } as unknown as PetRouteDeps;
  const { handlePetRoute } = createHttpRoute(deps);
  const run = () => restoreAfterReinstall({ userRoot, packageRoot, configPaths, handle: handlePetRoute, log: {} });
  const now = () =>
    Object.fromEntries(
      (readAllConfig(configPaths).main.pets as Record<string, unknown>[]).map((pet) => [pet.id, pet.display]),
    );
  return {
    userRoot,
    packageRoot,
    run,
    now,
    save,
    events,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('收起后卸载再装：全部收起的鲸鱼娘回到桌面（原来是 both 也只回桌面），收起记录清空', async () => {
  const h = harness({ main: 'none', webOnly: 'web' });
  try {
    await writeHideRecords(hideRecordsPath(h.userRoot), { main: 'both' });
    assert.equal(await h.run(), 'restored');
    assert.deepEqual(h.now(), { main: 'desktop', webOnly: 'web' }, '只动全部收起的，刻意选的「只在网页」不改');
    assert.deepEqual(await readHideRecords(hideRecordsPath(h.userRoot)), {});
    assert.ok(h.events.includes('restart'), '要重启桌面 Helper，鲸鱼娘才会立刻出现在桌面');
    assert.ok(existsSync(installStampPath(h.userRoot)));
  } finally {
    h.dispose();
  }
});

test('同一次安装里重启 DSH：用户自己收起的不被叫回', async () => {
  const h = harness({ main: 'desktop' });
  try {
    assert.equal(await h.run(), 'nothing-hidden');
    // 用户这次安装期间点了「收起鲸鱼娘」，然后重启 DSH
    h.save({ main: 'none' });
    assert.equal(await h.run(), 'same-install');
    assert.deepEqual(h.now(), { main: 'none' });
  } finally {
    h.dispose();
  }
});

test('全新安装（没有收起的宠物）：只记下安装时刻，不改配置、不重启', async () => {
  const h = harness({ main: 'desktop' });
  try {
    assert.equal(await h.run(), 'nothing-hidden');
    assert.deepEqual(h.now(), { main: 'desktop' });
    assert.deepEqual(h.events, []);
  } finally {
    h.dispose();
  }
});

test('安装时刻取插件包目录的创建时刻：同一目录两次读到同一个值', () => {
  const h = harness({ main: 'desktop' });
  try {
    assert.equal(installStampOf(h.packageRoot), installStampOf(h.packageRoot));
    assert.match(installStampOf(h.packageRoot), /^\d+$/);
  } finally {
    h.dispose();
  }
});
