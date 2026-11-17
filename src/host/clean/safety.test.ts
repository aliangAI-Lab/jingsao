/**
 * 链接复核：同批复用已复核目录后，文件本身仍每次完整复核；目录被换成联接时，缓存过期后能发现。
 * @module jingsao/src/host/clean/safety.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { noLinks } from './safety.ts';

function tempDir(): string {
  return fs.mkdtempSync(join(process.env.TEMP ?? os.tmpdir(), 'jingsao-links-'));
}

test('noLinks 复用已复核的祖先目录，但文件本身是链接时照样拒绝', () => {
  const root = tempDir();
  try {
    const dir = join(root, 'cache', 'a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'one.bin'), 'x');
    const verified = new Set<string>();
    noLinks(join(dir, 'one.bin'), { verified });
    assert.ok(verified.has(dir.toLowerCase()), '祖先目录记进缓存');
    assert.ok(!verified.has(join(dir, 'one.bin').toLowerCase()), '文件本身不进缓存');

    const outside = join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, 'two.bin'), 'y');
    fs.symlinkSync(outside, join(dir, 'link'), 'junction');
    assert.throws(() => noLinks(join(dir, 'link', 'two.bin'), { verified }), /符号链接或目录联接/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('目录被换成联接：清空缓存后重新复核能发现', () => {
  const root = tempDir();
  try {
    const dir = join(root, 'cache');
    fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'one.bin'), 'x');
    const verified = new Set<string>();
    noLinks(join(dir, 'one.bin'), { verified });

    const outside = join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, 'one.bin'), 'z');
    fs.rmSync(dir, { recursive: true });
    fs.symlinkSync(outside, dir, 'junction');

    verified.clear();
    assert.throws(() => noLinks(join(dir, 'one.bin'), { verified }), /符号链接或目录联接/);
    assert.throws(() => noLinks(join(dir, 'one.bin')), /符号链接或目录联接/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
