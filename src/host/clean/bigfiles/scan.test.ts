/**
 * 大文件扫描的单元测试 —— 钉住三件事：
 *   ① 只在用户自己的文件夹里找：AppData、隐藏目录、聊天数据、开发环境目录、链接一律不进；
 *   ② 程序文件不碰：安装包只认下载 / 桌面 / 文档里的，dll 在哪都不列；硬链接与小文件不列；
 *   ③ 分类与排序：按类型分组、组内按大小降序、默认不勾选、可取消。
 *
 * 所有文件都造在 F:\dev\_cache\tmp 下的测试根里（JINGSAO_TEST_ROOT 语义），不碰真实 C 盘。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { locations, type CleanPlaces } from '../safety.ts';
import { scanBigFiles } from './scan.ts';
import { classifyFile, defaultUserRoots, formatBytes } from './walk.ts';

const TMP = 'F:\\dev\\_cache\\tmp';
const MIN = 4096;
let root = '';
let places: CleanPlaces;

/** 在用户目录下造一个指定大小的文件。 */
function make(rel: string, size: number, base = places.home): string {
  const file = join(base, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.alloc(size, rel.length));
  return file;
}

before(() => {
  mkdirSync(TMP, { recursive: true });
  root = mkdtempSync(join(TMP, 'jingsao-bigscan-'));
  places = locations({ JINGSAO_TEST_ROOT: root });
  make('Downloads\\setup.exe', 9000);
  make('Downloads\\movie.mp4', 20000);
  make('Downloads\\sub\\data.zip', 12000);
  make('Downloads\\small.mp4', 100);
  make('Downloads\\lib.dll', 50000);
  make('Videos\\trip.mkv', 30000);
  make('Documents\\report.pdf', 8000);
  make('Projects\\blob.bin', 7000);
  make('Projects\\tool\\app.exe', 60000);
  make('Projects\\node_modules\\pkg\\big.bin', 60000);
  make('Documents\\WeChat Files\\wxid\\video.mp4', 60000);
  make('AppData\\Local\\Temp\\cache.bin', 60000);
  make('.cache\\model.bin', 60000);
  make('Music\\.hidden\\song.mp3', 60000);
  make('Music\\song.flac', 5000);
  const original = make('Pictures\\photo.psd', 9000);
  linkSync(original, join(places.home, 'Pictures', 'photo-link.psd'));
  const outside = make('outside\\big.mp4', 60000, root);
  symlinkSync(dirname(outside), join(places.home, 'Linked'), 'junction');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanBigFiles —— 找哪里、不碰什么', () => {
  test('默认根是用户目录下的个人文件夹，不含 AppData、隐藏目录与联接', async () => {
    const roots = (await defaultUserRoots(places)).map((path) => path.slice(places.home.length + 1));
    assert.deepEqual(roots, ['Documents', 'Downloads', 'Music', 'Pictures', 'Projects', 'Videos']);
  });

  test('分类、排序、默认不勾选；程序文件、硬链接、小文件、跳过目录都不列', async () => {
    const { result, candidates } = await scanBigFiles(places, { minSize: MIN });
    const byId = Object.fromEntries(
      result.categories.map((category) => [
        category.id,
        category.items.map((item) => item.path.slice(places.home.length + 1)),
      ]),
    );
    assert.deepEqual(byId, {
      installers: ['Downloads\\setup.exe'],
      archives: ['Downloads\\sub\\data.zip'],
      videos: ['Videos\\trip.mkv', 'Downloads\\movie.mp4'],
      audio: ['Music\\song.flac'],
      documents: ['Documents\\report.pdf'],
      others: ['Projects\\blob.bin'],
    });
    for (const category of result.categories) {
      assert.equal(category.tier, 'cost');
      assert.ok(category.items.every((item) => item.selected === false));
      assert.equal(category.count, category.items.length);
    }
    assert.equal(result.totalBytes, 9000 + 12000 + 30000 + 20000 + 5000 + 8000 + 7000);
    assert.equal(candidates.size, 7);
    const video = [...candidates.values()].find((item) => item.path.endsWith('trip.mkv'))!;
    assert.equal(video.categoryId, 'videos');
    assert.equal(video.identity.size, 30000);
  });

  test('roots 只扫给定目录；进度会报告', async () => {
    const seen: string[] = [];
    const { result } = await scanBigFiles(places, {
      minSize: MIN,
      roots: [join(places.home, 'Videos')],
      onProgress: (p) => seen.push(p.phase),
    });
    assert.deepEqual(
      result.categories.map((category) => category.id),
      ['videos'],
    );
    assert.ok(seen.includes('scanning'));
    assert.equal(seen[seen.length - 1], 'done');
  });

  test('取消后抛错并报告 cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const phases: string[] = [];
    await assert.rejects(
      scanBigFiles(places, { minSize: MIN, signal: controller.signal, onProgress: (p) => phases.push(p.phase) }),
    );
    assert.equal(phases[phases.length - 1], 'cancelled');
  });
});

describe('walk 工具', () => {
  test('安装包只认下载 / 桌面 / 文档', () => {
    assert.equal(classifyFile(join(places.home, 'Desktop', 'a.msi'), places), 'installer');
    assert.equal(classifyFile(join(places.home, 'Projects', 'a.msi'), places), null);
    assert.equal(classifyFile(join(places.home, 'Downloads', 'a.DLL'), places), null);
    assert.equal(classifyFile(join(places.home, 'Downloads', 'a.ISO'), places), 'archive');
  });

  test('formatBytes', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
  });
});
