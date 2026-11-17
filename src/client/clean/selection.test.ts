/**
 * 清理面板的纯逻辑：默认勾选、分组汇总与半选、需确认项就地确认 / 全默认项直接开始、动作被宿主接受后关窗。
 * @module jingsao/src/client/clean/selection.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmText, decideAction, defaultPicks, junkGroups, launchThenClose, selectionOf } from './selection.ts';
import type { CleanCategory, CleanScanResult } from './api.ts';

const cat = (id: string, patch: Partial<CleanCategory>): CleanCategory => ({
  id,
  label: id,
  tier: 'safe',
  explanation: '',
  bytes: 100,
  count: 1,
  items: [{ id: id + '-1', path: 'x', size: 100, mtimeMs: 0 }],
  ...patch,
});

const junk: CleanScanResult = {
  feature: 'junk',
  scanId: 's',
  startedAt: 0,
  finishedAt: 0,
  totalBytes: 0,
  categories: [
    cat('temp', { group: 'temp', defaultChecked: true }),
    cat('crash-dumps', { group: 'temp', defaultChecked: false, label: '系统崩溃转储' }),
    cat('npm', { group: 'dev', defaultChecked: false, label: '网页开发下载缓存' }),
    cat('pip', { group: 'dev', defaultChecked: false, label: '程序开发下载缓存' }),
    cat('win-temp', { group: 'temp', defaultChecked: true, needsAdmin: true, bytes: 0, unreadable: true }),
    cat('empty-app', { group: 'app', defaultChecked: true, bytes: 0 }),
    cat('system-winsxs', { reportOnly: true, group: 'report', bytes: 9 }),
  ],
};

test('默认勾选按 defaultChecked；只报告的不勾', () => {
  const picks = defaultPicks('junk', junk);
  assert.equal(picks['c:temp'], true);
  assert.equal(picks['c:crash-dumps'], false);
  assert.equal(picks['c:npm'], false);
  assert.equal(picks['c:system-winsxs'], undefined);
});

test('分组：固定顺序、整组半选、大小为 0 的组整组隐藏（读不到的「需管理员」不算 0）、只报告的在最后且没有勾选框', () => {
  const groups = junkGroups(junk, defaultPicks('junk', junk));
  assert.deepEqual(
    groups.map((g) => [g.id, g.bytes, g.check]),
    [
      ['temp', 200, 'some'],
      ['dev', 200, 'none'],
      ['report', 9, null],
    ],
  );
  const all = junkGroups(junk, { 'c:temp': true, 'c:crash-dumps': true, 'c:win-temp': true });
  assert.equal(all[0]!.check, 'all');
});

test('只勾了默认项：直接开始；勾了需确认的：就地确认，列出名字', () => {
  const plain = selectionOf('junk', junk, defaultPicks('junk', junk));
  assert.deepEqual(plain.categories, ['temp', 'win-temp']);
  assert.equal(decideAction(plain, false), 'start');
  const risky = selectionOf('junk', junk, { 'c:temp': true, 'c:crash-dumps': true, 'c:npm': true, 'c:pip': true });
  assert.deepEqual(risky.confirm, ['系统崩溃转储', '网页开发下载缓存', '程序开发下载缓存']);
  assert.equal(decideAction(risky, false), 'confirm');
  assert.equal(decideAction(risky, true), 'start');
  assert.equal(
    confirmText(risky.confirm),
    '你勾了 3 项需要确认的内容：系统崩溃转储、网页开发下载缓存、程序开发下载缓存，删除后无法恢复',
  );
  assert.match(confirmText(['a', 'b', 'c', 'd']), /^你勾了 4 项需要确认的内容：a、b、c…，删除后无法恢复$/);
});

test('重复文件：任何勾选都要确认；微信「收发的文件」默认不勾、勾了要确认', () => {
  const dup: CleanScanResult = { ...junk, feature: 'duplicates', categories: [cat('g1', { label: '一组照片' })] };
  const sel = selectionOf('duplicates', dup, { 'i:g1-1': true });
  assert.deepEqual(sel.ids, ['g1-1']);
  assert.deepEqual(sel.confirm, ['一组照片']);
  const chat: CleanScanResult = {
    ...junk,
    feature: 'chat',
    categories: [cat('wx-file', { tier: 'risky', defaultChecked: false, label: '收发的文件' }), cat('wx-image', {})],
  };
  assert.equal(defaultPicks('chat', chat)['c:wx-file'], false);
  assert.deepEqual(selectionOf('chat', chat, { 'c:wx-file': true, 'c:wx-image': true }).confirm, ['收发的文件']);
});

test('动作被宿主接受后关窗；被拒绝时不关、把原因交回', async () => {
  let closed = 0;
  assert.equal(await launchThenClose(Promise.resolve({ ok: true }), () => closed++), null);
  assert.equal(closed, 1);
  assert.equal(
    await launchThenClose(Promise.resolve({ ok: false, message: '鲸鱼娘正在忙' }), () => closed++),
    '鲸鱼娘正在忙',
  );
  assert.equal(closed, 1);
  // 右侧栏没有关窗入口：照常返回
  assert.equal(await launchThenClose(Promise.resolve({ ok: true }), undefined), null);
});
