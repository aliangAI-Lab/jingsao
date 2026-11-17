/**
 * 软件搬家执行与记录的单元测试 —— 钉住五件事：
 *   ① 搬家：原路径变成指向新位置的联接、内容可读、备份已删、记录落盘可读回；
 *   ② 还原：原路径变回普通目录且内容一致、新位置删除、搬过去的真实文件不会因删联接被误删；
 *   ③ 拒绝：正在运行、被拦、目标不可用、只读、记录不能还原时直接抛错，什么都不动；
 *   ④ 回滚：复制中途出错、建联接出错，原目录原样、没有备份、没有残留副本；
 *   ⑤ 提权路径：生成的 PowerShell 脚本以普通权限对测试目录实际跑一遍（搬与还原），
 *      提权执行器失败 / 缺失时记失败、原目录不动。「以管理员身份运行」本身未验证。
 *
 * 用假探针；目录造在 F:\dev\_cache\tmp 下的测试根里，不碰真实 C 盘。
 */
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { locations, type CleanPlaces } from '../safety.ts';
import { copyWithHash } from '../bigfiles/copy.ts';
import { SoftwareMover, type ElevatedRunner, type InstalledApp, type MoverOps, type SoftwareProbe } from './index.ts';
import { softwareId } from './list.ts';
import { runScriptFile } from './script.ts';

const TMP = 'F:\\dev\\_cache\\tmp';
const BIG = 51 * 1024 * 1024;
let root = '';
let places: CleanPlaces;
let appDir = '';
let dest = '';
let running: string[] = [];
let clock = 1_000_000;

const probe: SoftwareProbe = {
  listInstalled: async (): Promise<InstalledApp[]> => [{ key: 'k', name: 'Notes App', installDir: appDir }],
  runningExecutables: async () => running,
  serviceImagePaths: async () => [],
};

/** 造软件目录：多层子目录、几个小文件、一个让它超过 50MB 的大文件。 */
function makeApp(dir: string): void {
  mkdirSync(join(dir, 'resources', 'locales'), { recursive: true });
  writeFileSync(join(dir, 'Notes.exe'), 'exe body');
  writeFileSync(join(dir, 'resources', 'app.asar'), Buffer.alloc(BIG, 7));
  writeFileSync(join(dir, 'resources', 'locales', 'zh-CN.pak'), '中文资源');
  mkdirSync(join(dir, 'empty-dir'));
}

/** 目录内容快照：相对路径 → 大小。 */
function snapshot(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}\\${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out[rel + '\\'] = 0;
        walk(join(current, entry.name), rel);
      } else out[rel] = lstatSync(join(current, entry.name)).size;
    }
  };
  walk(dir, '');
  return out;
}

function makeMover(
  extra: { ops?: Partial<MoverOps>; elevate?: ElevatedRunner; readOnly?: boolean } = {},
): SoftwareMover {
  return new SoftwareMover({
    places: { ...places, readOnly: extra.readOnly ?? false },
    file: join(root, 'data', 'software-moves.json'),
    probe,
    now: () => (clock += 1),
    ops: extra.ops,
    elevate: extra.elevate,
  });
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  root = mkdtempSync(join(TMP, 'jingsao-swmove-'));
  places = locations({ JINGSAO_TEST_ROOT: root });
  appDir = join(places.local, 'Programs', 'Notes');
  makeApp(appDir);
  dest = join(root, 'D', 'Apps');
  running = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SoftwareMover —— 搬家与还原（普通权限）', () => {
  test('搬家后原路径是联接、内容可读；还原后是普通目录、内容一致', async () => {
    const before = snapshot(appDir);
    const mover = makeMover();
    const record = await mover.move(softwareId(appDir), dest);
    assert.equal(record.state, 'moved', String(record.error));
    assert.equal(record.mode, 'linked');
    assert.equal(record.to, join(dest, '鲸扫搬家', '软件', 'Notes App', 'Notes'));
    assert.ok(lstatSync(appDir).isSymbolicLink());
    assert.equal(realpathSync.native(appDir).toLowerCase(), record.to.toLowerCase());
    assert.equal(readFileSync(join(appDir, 'resources', 'locales', 'zh-CN.pak'), 'utf8'), '中文资源');
    assert.deepEqual(snapshot(record.to), before);
    assert.equal(existsSync(appDir + '.jingsao-bak'), false);
    assert.equal(record.size, BIG + 8 + Buffer.byteLength('中文资源'));
    assert.deepEqual(makeMover().history()[0], record);

    const restored = await mover.restore(record.id);
    assert.equal(restored.state, 'restored', String(restored.error));
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
    assert.ok(lstatSync(appDir).isDirectory());
    assert.deepEqual(snapshot(appDir), before);
    assert.equal(existsSync(record.to), false);
    assert.equal(existsSync(join(dest, '鲸扫搬家', '软件', 'Notes App')), false);
    assert.equal(existsSync(appDir + '.jingsao-restore'), false);
    assert.equal(makeMover().history()[0]!.state, 'restored');
  });

  test('正在运行时拒绝，什么都不动', async () => {
    running = [join(appDir, 'Notes.exe')];
    await assert.rejects(makeMover().move(softwareId(appDir), dest), /请先关闭正在运行的程序：Notes\.exe/);
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
    assert.equal(existsSync(dest), false);
  });

  test('找不到、目标不可用、只读都直接抛错', async () => {
    await assert.rejects(makeMover().move('sw-nope', dest), /找不到/);
    await assert.rejects(makeMover().move(softwareId(appDir), join(places.home, 'X')), /用户文件夹/);
    await assert.rejects(makeMover({ readOnly: true }).move(softwareId(appDir), dest), /只读/);
    await assert.rejects(makeMover().restore('nope'), /不能还原/);
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
  });

  test('复制中途出错：回滚到原样，记 failed', async () => {
    const before = snapshot(appDir);
    let calls = 0;
    const mover = makeMover({
      ops: {
        copyFile: async (src, target, options) => {
          calls += 1;
          if (calls === 2) throw new Error('模拟复制失败');
          return copyWithHash(src, target, options);
        },
      },
    });
    const record = await mover.move(softwareId(appDir), dest);
    assert.equal(record.state, 'failed');
    assert.match(record.error!, /模拟复制失败/);
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
    assert.deepEqual(snapshot(appDir), before);
    assert.equal(existsSync(record.to), false);
    assert.equal(existsSync(join(dest, '鲸扫搬家', '软件', 'Notes App')), false);
    assert.equal(existsSync(appDir + '.jingsao-bak'), false);
    assert.equal(makeMover().history()[0]!.state, 'failed');
  });

  test('建联接出错：备份改回原名、删掉副本', async () => {
    const before = snapshot(appDir);
    const record = await makeMover({
      ops: {
        link: async () => {
          throw new Error('模拟建联接失败');
        },
      },
    }).move(softwareId(appDir), dest);
    assert.equal(record.state, 'failed');
    assert.match(record.error!, /模拟建联接失败/);
    assert.ok(lstatSync(appDir).isDirectory());
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
    assert.deepEqual(snapshot(appDir), before);
    assert.equal(existsSync(appDir + '.jingsao-bak'), false);
    assert.equal(existsSync(record.to), false);
  });

  test('还原中途出错：联接保持、新位置的文件一个不少', async () => {
    const mover = makeMover();
    const record = await mover.move(softwareId(appDir), dest);
    const moved = snapshot(record.to);
    let calls = 0;
    const failing = makeMover({
      ops: {
        copyFile: async (src, target, options) => {
          calls += 1;
          if (calls === 2) throw new Error('模拟还原复制失败');
          return copyWithHash(src, target, options);
        },
      },
    });
    const result = await failing.restore(record.id);
    assert.equal(result.state, 'moved');
    assert.match(result.error!, /模拟还原复制失败/);
    assert.ok(lstatSync(appDir).isSymbolicLink());
    assert.deepEqual(snapshot(record.to), moved);
    assert.equal(existsSync(appDir + '.jingsao-restore'), false);
  });

  test('还原时正在运行：拒绝', async () => {
    const mover = makeMover();
    const record = await mover.move(softwareId(appDir), dest);
    running = [join(record.to, 'Notes.exe')];
    await assert.rejects(mover.restore(record.id), /请先关闭/);
    assert.ok(lstatSync(appDir).isSymbolicLink());
  });
});

describe('SoftwareMover —— 提权路径', () => {
  const forceElevation = { needsElevation: async () => true };

  test('生成的脚本以普通权限实际跑一遍：搬家与还原都成功', { skip: process.platform !== 'win32' }, async () => {
    const before = snapshot(appDir);
    const requests: string[] = [];
    const runner: ElevatedRunner = async (request) => {
      requests.push(request.action);
      assert.ok(
        readFileSync(request.scriptFile)
          .subarray(0, 3)
          .equals(Buffer.from([0xef, 0xbb, 0xbf])),
      );
      await runScriptFile(request.scriptFile);
    };
    const mover = makeMover({ ops: forceElevation, elevate: runner });
    const record = await mover.move(softwareId(appDir), dest);
    assert.equal(record.state, 'moved', String(record.error));
    assert.ok(lstatSync(appDir).isSymbolicLink());
    assert.deepEqual(snapshot(record.to), before);
    assert.equal(existsSync(appDir + '.jingsao-bak'), false);

    const restored = await mover.restore(record.id);
    assert.equal(restored.state, 'restored', String(restored.error));
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
    assert.deepEqual(snapshot(appDir), before);
    assert.equal(existsSync(record.to), false);
    assert.deepEqual(requests, ['move', 'restore']);
    assert.deepEqual(readdirSync(join(root, 'data', 'elevated')), []);
  });

  test('脚本在改名一步失败时自己回滚（原目录里有文件被占用）', { skip: process.platform !== 'win32' }, async () => {
    const before = snapshot(appDir);
    const mover = makeMover({
      ops: forceElevation,
      elevate: async (request) => {
        // 用一个不带共享删除的句柄占住原目录里的文件，目录改名必然失败，脚本应走回滚分支。
        const handle = openSync(join(request.source, 'Notes.exe'), 'r');
        try {
          await runScriptFile(request.scriptFile);
        } finally {
          closeSync(handle);
        }
      },
    });
    const failed = await mover.move(softwareId(appDir), dest);
    assert.equal(failed.state, 'failed');
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
    assert.deepEqual(snapshot(appDir), before);
    assert.equal(existsSync(failed.to), false);
    assert.equal(existsSync(appDir + '.jingsao-bak'), false);
  });
  test('提权执行器失败或缺失：记失败，原目录不动', async () => {
    const before = snapshot(appDir);
    const denied = await makeMover({
      ops: forceElevation,
      elevate: async () => {
        throw new Error('用户取消了');
      },
    }).move(softwareId(appDir), dest);
    assert.equal(denied.state, 'failed');
    assert.match(denied.error!, /没有获得管理员权限/);
    const missing = await makeMover({ ops: forceElevation }).move(softwareId(appDir), dest);
    assert.equal(missing.state, 'failed');
    assert.match(missing.error!, /提权通道/);
    const silent = await makeMover({ ops: forceElevation, elevate: async () => undefined }).move(
      softwareId(appDir),
      dest,
    );
    assert.match(silent.error!, /没有返回结果/);
    assert.deepEqual(snapshot(appDir), before);
    assert.equal(lstatSync(appDir).isSymbolicLink(), false);
  });
});
