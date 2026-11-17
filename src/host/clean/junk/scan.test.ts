/**
 * 扫描测试在独立非系统盘目录中模拟用户目录和系统目录。
 * 测试只检查候选与统计，真实系统文件不参与任何扫描。
 * @module jingsao/src/host/clean/junk/scan.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { DAY_MS, locations } from '../safety.ts';
import { MAX_ITEMS_PER_CATEGORY, type CleanProgress } from '../types.ts';
import { scanJunk } from './scan.ts';
import { loadJunkRules, type JunkRule } from './rules.ts';

function setup() {
  const parent = 'F:/dev/_cache/tmp';
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(join(parent, 'junk-scan-'));
  const places = locations({ JINGSAO_TEST_ROOT: root });
  const create = (path: string, content = '内容', old = true) => {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
    if (old) fs.utimesSync(path, new Date(Date.now() - DAY_MS * 5), new Date(Date.now() - DAY_MS * 5));
    return path;
  };
  return { root, places, create };
}

test('规则归类、年龄、保护范围、目录联接和硬链接生效，扫描零写入', async () => {
  const { root, places, create } = setup();
  const temp = join(places.local, 'Temp');
  const allowed = create(join(temp, 'old'));
  create(join(temp, 'new'), '新文件', false);
  for (const name of [
    '.env',
    '.env.local',
    '.ssh/key',
    '.git/config',
    'pagefile.sys',
    'Documents/a',
    '.jingsao-staging/a',
  ])
    create(join(temp, name));
  const outside = create(join(root, 'outside', 'kept'));
  fs.symlinkSync(dirname(outside), join(temp, 'junction'), 'junction');
  const shared = create(join(temp, 'shared'));
  fs.linkSync(shared, join(root, 'shared'));
  const scan = await scanJunk(places);
  assert.deepEqual(
    [...scan.candidates.values()].map((item) => item.path),
    [allowed],
  );
  assert.equal(scan.result.feature, 'junk');
  assert.equal(scan.result.totalBytes, Buffer.byteLength('内容'));
  assert.equal(scan.result.categories[0]?.id, 'temp');
  assert.ok(fs.existsSync(allowed));
  assert.ok(!fs.existsSync(places.legacyStaging));
  create(join(places.legacyStaging, 'retained'));
  const broad: JunkRule = { ...loadJunkRules()[0]!, id: 'broad', base: 'home', paths: ['AppData'] };
  const again = await scanJunk(places, { rules: [broad] });
  assert.ok(![...again.candidates.values()].some((item) => item.path.startsWith(places.legacyStaging)));
});

test('文件名模式、单层通配符和重叠规则去重', async () => {
  const { places, create } = setup();
  create(join(places.local, 'Microsoft/Windows/Explorer/thumbcache_01.db'), '123');
  create(join(places.local, 'Microsoft/Windows/Explorer/iconcache_01.db'), '12345');
  create(join(places.local, 'Microsoft/Windows/Explorer/keep.db'));
  create(join(places.roaming, 'Code/Cache/data'));
  create(join(places.roaming, 'Code/Cookies'));
  const scan = await scanJunk(places);
  assert.equal(scan.result.categories.find((category) => category.id === 'thumbnails')?.bytes, 8);
  assert.equal(scan.result.categories.find((category) => category.id === 'editor')?.count, 1);
  assert.equal(
    scan.result.categories.find((category) => category.id === 'electron'),
    undefined,
  );
  assert.equal(scan.candidates.size, 3);
});

test('系统大块头只报告且统计全量，系统目录联接不会跟进', async () => {
  const { places, root, create } = setup();
  for (const path of ['Windows/WinSxS/a', 'Windows.old/a', 'hiberfil.sys', 'pagefile.sys'])
    create(join(places.drive, path), '1234');
  const outside = create(join(root, 'other/a'), '禁止跟进');
  fs.symlinkSync(dirname(outside), join(places.drive, 'Windows.old/link'), 'junction');
  const { result, candidates } = await scanJunk(places, { rules: [] });
  assert.deepEqual(
    result.categories.map((category) => category.id),
    ['system-winsxs', 'system-old', 'system-hibernate', 'system-pagefile'],
  );
  assert.ok(
    result.categories.every(
      (category) => category.reportOnly && category.group === 'report' && category.bytes === 4 && category.count === 1,
    ),
  );
  assert.equal(result.categories[0]!.systemAction, 'winsxs');
  assert.equal(result.categories[1]!.systemAction, 'windows-old');
  assert.equal(result.totalBytes, 0);
  assert.equal(candidates.size, 0);
});

test('展示项按大小截断，全量候选和统计保留', async () => {
  const { places, create } = setup();
  for (let index = 0; index < MAX_ITEMS_PER_CATEGORY + 3; index++)
    create(join(places.local, 'Temp', String(index)), 'a'.repeat(index + 1));
  const { result, candidates } = await scanJunk(places);
  const category = result.categories[0]!;
  assert.equal(category.count, MAX_ITEMS_PER_CATEGORY + 3);
  assert.equal(candidates.size, category.count);
  assert.equal(category.items.length, MAX_ITEMS_PER_CATEGORY);
  assert.equal(category.items[0]!.size, MAX_ITEMS_PER_CATEGORY + 3);
  assert.equal(category.bytes, (category.count * (category.count + 1)) / 2);
  assert.ok(category.items.every((item, index) => index === 0 || item.size <= category.items[index - 1]!.size));
});

test('预取消和遍历途中取消都发出 cancelled，事件循环获得执行机会', async () => {
  const { places, create } = setup();
  for (let index = 0; index < 150; index++) create(join(places.local, 'Temp', String(index)));
  const pre = AbortSignal.abort();
  const phases: CleanProgress['phase'][] = [];
  assert.equal(
    (await scanJunk(places, { signal: pre, onProgress: (progress) => phases.push(progress.phase) })).candidates.size,
    0,
  );
  assert.equal(phases[phases.length - 1], 'cancelled');
  const controller = new AbortController();
  let yielded = false;
  const scan = scanJunk(places, {
    signal: controller.signal,
    onProgress: (progress) => {
      phases.push(progress.phase);
      if (progress.files >= 64)
        setImmediate(() => {
          yielded = true;
          controller.abort();
        });
    },
  });
  const result = await scan;
  assert.ok(yielded);
  assert.ok(result.candidates.size < 150);
  assert.equal(phases[phases.length - 1], 'cancelled');
});
