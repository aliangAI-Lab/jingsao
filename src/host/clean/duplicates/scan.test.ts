/**
 * 重复文件扫描的单元测试 —— 钉住四件事：
 *   ① 三步算法不误判：同大小不同尾部、头尾相同中间不同的都不算重复；小文件的部分哈希即全量；
 *   ② 范围：AppData、程序库文件、共享硬链接不列；
 *   ③ 组的形状：建议保留修改时间最早（一样早取路径最短）、其余默认勾选、按浪费空间降序、maxGroups 截断；
 *   ④ 选择检查：整组全选或选了未知 id 时拒绝；取消时抛错。
 *
 * 文件都造在 F:\dev\_cache\tmp 下的测试根里，不碰真实 C 盘。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { locations, type CleanPlaces } from '../safety.ts';
import { checkDuplicateSelection, scanDuplicates } from './index.ts';
import { PARTIAL_BYTES } from './scan.ts';

const TMP = 'F:\\dev\\_cache\\tmp';
let root = '';
let places: CleanPlaces;

/** 可复现的伪随机内容。 */
function content(seed: number, size: number): Buffer {
  const out = Buffer.alloc(size);
  let x = seed * 2654435761;
  for (let i = 0; i < size; i += 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function make(rel: string, body: Buffer, mtimeSec?: number): string {
  const file = join(places.home, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (mtimeSec !== undefined) utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

before(() => {
  mkdirSync(TMP, { recursive: true });
  root = mkdtempSync(join(TMP, 'jingsao-dup-'));
  places = locations({ JINGSAO_TEST_ROOT: root });
  const video = content(1, 200_000);
  make('Downloads\\clip.mp4', video, 2_000_000);
  make('Videos\\clip-old.mp4', video, 1_000_000);
  make('Desktop\\deep\\folder\\clip.mp4', video, 3_000_000);

  const small = content(2, 20_000);
  make('Pictures\\a.png', small, 1_000_000);
  make('Pictures\\b.png', small, 1_000_000);
  make('Pictures\\sub\\aa.png', small, 1_000_000);

  // 同大小、同头、尾部不同。
  const tailA = content(3, 100_000);
  const tailB = Buffer.from(tailA);
  tailB[tailB.length - 1] ^= 0xff;
  make('Documents\\r1.pdf', tailA);
  make('Documents\\r2.pdf', tailB);
  // 同大小、头尾相同、中间不同。
  const midA = content(4, 100_000);
  const midB = Buffer.from(midA);
  midB[PARTIAL_BYTES * 3] ^= 0xff;
  make('Documents\\m1.pdf', midA);
  make('Documents\\m2.pdf', midB);

  const hard = make('Music\\song.flac', content(5, 50_000));
  linkSync(hard, join(places.home, 'Music', 'song-link.flac'));
  make('AppData\\Local\\x\\clip.mp4', video);
  make('Downloads\\lib1.dll', content(6, 50_000));
  make('Documents\\lib2.dll', content(6, 50_000));
  make('Downloads\\tiny1.txt', Buffer.from('same'));
  make('Downloads\\tiny2.txt', Buffer.from('same'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanDuplicates', () => {
  test('只认真正的重复，组的形状正确', async () => {
    const phases: string[] = [];
    const { result, candidates, groups } = await scanDuplicates(places, {
      minSize: 1000,
      onProgress: (p) => phases.push(p.phase),
    });
    assert.equal(result.feature, 'duplicates');
    assert.equal(result.categories.length, 2);
    const [videos, images] = result.categories;
    const rel = (path: string): string => path.slice(places.home.length + 1);

    assert.equal(videos!.group, '视频');
    assert.equal(videos!.label, 'clip-old.mp4');
    assert.equal(videos!.tier, 'cost');
    assert.equal(videos!.count, 3);
    assert.equal(videos!.bytes, 600_000);
    assert.match(videos!.explanation, /^3 份完全相同，占用 586 KB/);
    assert.deepEqual(
      videos!.items.map((item) => [rel(item.path), item.selected, item.note]),
      [
        ['Videos\\clip-old.mp4', false, '建议保留'],
        ['Desktop\\deep\\folder\\clip.mp4', true, undefined],
        ['Downloads\\clip.mp4', true, undefined],
      ],
    );

    assert.equal(images!.group, '图片');
    assert.equal(images!.items[0]!.path.endsWith('Pictures\\a.png'), true, '一样早时取路径最短');
    assert.equal(result.totalBytes, 400_000 + 40_000);

    assert.equal(candidates.size, 6);
    assert.deepEqual(
      groups.get(videos!.id),
      videos!.items.map((item) => item.id),
    );
    const first = candidates.get(videos!.items[0]!.id)!;
    assert.equal(first.categoryId, videos!.id);
    assert.equal(first.identity.size, 200_000);
    assert.equal(phases[phases.length - 1], 'done');
  });

  test('maxGroups 只留浪费最多的组', async () => {
    const { result } = await scanDuplicates(places, { minSize: 1000, maxGroups: 1 });
    assert.deepEqual(
      result.categories.map((category) => category.group),
      ['视频'],
    );
  });

  test('取消时抛错并报告 cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const phases: string[] = [];
    await assert.rejects(
      scanDuplicates(places, { minSize: 1000, signal: controller.signal, onProgress: (p) => phases.push(p.phase) }),
    );
    assert.equal(phases[phases.length - 1], 'cancelled');
  });
});

describe('checkDuplicateSelection', () => {
  const groups = new Map([
    ['g1', ['a', 'b', 'c']],
    ['g2', ['d', 'e']],
  ]);

  test('每组留一份就放行', () => {
    assert.equal(checkDuplicateSelection(groups, ['b', 'c', 'e']), null);
    assert.equal(checkDuplicateSelection(groups, []), null);
  });

  test('整组全选或未知 id 拒绝', () => {
    assert.match(checkDuplicateSelection(groups, ['d', 'e', 'b'])!, /至少要留一份/);
    assert.match(checkDuplicateSelection(groups, ['zzz'])!, /不在这次扫描结果里/);
  });
});
