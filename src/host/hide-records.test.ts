/** 收起记录的持久化、损坏回退与特殊 id 测试。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hideRecordsPath, readHideRecords, writeHideRecords } from './hide-records.ts';

test('记录文件往返与损坏回退', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jingsao-hide-'));
  try {
    const path = hideRecordsPath(dir);
    assert.deepEqual(await readHideRecords(path), {});
    const pets = JSON.parse('{"鲸鱼娘":"both","__proto__":"desktop"}');
    await writeHideRecords(path, pets);
    assert.deepEqual(await readHideRecords(path), pets);
    await writeFile(path, '{坏文件');
    assert.deepEqual(await readHideRecords(path), {});
    for (const value of [null, [], { stateVersion: 2, pets }, { stateVersion: 1, pets: { a: 'invalid', b: 'web' } }]) {
      await writeFile(path, JSON.stringify(value));
      assert.deepEqual(
        await readHideRecords(path),
        value && 'stateVersion' in value && value.stateVersion === 1 ? { b: 'web' } : {},
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
