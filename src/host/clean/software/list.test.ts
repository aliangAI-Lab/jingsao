/**
 * 软件列表与判定的单元测试 —— 钉住「宁可多拦」：
 *   ① 只列系统盘上、目录存在的软件；同目录去重；
 *   ② 拦截原因：系统组件、已是联接、系统目录、驱动 / 运行库关键词、有服务、不到 50MB；
 *   ③ 正在运行的进程名填进 running；能搬的排在前面、按大小降序。
 *
 * 用假探针；目录造在 F:\dev\_cache\tmp 下的测试根里（测试根即「系统盘」）。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { locations, type CleanPlaces } from '../safety.ts';
import { listSoftware } from './index.ts';
import { riskyKind, softwareId } from './list.ts';
import type { InstalledApp, SoftwareProbe } from './probe.ts';

const TMP = 'F:\\dev\\_cache\\tmp';
const BIG = 51 * 1024 * 1024;
let root = '';
let places: CleanPlaces;

/** 造一个软件目录：一个 exe 加一个指定大小的数据文件。 */
function makeApp(dir: string, size: number): string {
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'app.exe'), 'exe');
  writeFileSync(join(dir, 'data', 'blob.bin'), Buffer.alloc(size));
  return dir;
}

function fakeProbe(apps: InstalledApp[], running: string[], services: string[]): SoftwareProbe {
  return {
    listInstalled: async () => apps,
    runningExecutables: async () => running,
    serviceImagePaths: async () => services,
  };
}

before(() => {
  mkdirSync(TMP, { recursive: true });
  root = mkdtempSync(join(TMP, 'jingsao-swlist-'));
  places = locations({ JINGSAO_TEST_ROOT: root });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listSoftware', () => {
  test('列出、去重、拦截与排序', async () => {
    const pf = join(root, 'Program Files');
    const big = makeApp(join(pf, 'BigApp'), BIG);
    const notes = makeApp(join(places.local, 'Programs', 'Notes'), BIG + 1024);
    const tiny = makeApp(join(pf, 'Tiny'), 10);
    const nvidia = makeApp(join(pf, 'NVIDIA Corporation', 'Display'), 10);
    const svc = makeApp(join(pf, 'SvcApp'), BIG);
    const system = makeApp(join(pf, 'SysComp'), BIG);
    const data = makeApp(join(root, 'ProgramData', 'Foo'), 10);
    const elsewhere = makeApp(join(root, 'D', 'Moved'), 10);
    const moved = join(pf, 'Moved');
    symlinkSync(elsewhere, moved, 'junction');
    const apps: InstalledApp[] = [
      { key: 'a', name: 'BigApp', publisher: 'Big Inc', installDir: big },
      { key: 'a2', name: 'BigApp Helper', installDir: big + '\\', systemComponent: true },
      { key: 'b', name: 'Notes', installDir: notes },
      { key: 'c', name: 'Tiny', installDir: tiny },
      { key: 'd', name: 'NVIDIA Graphics Driver', publisher: 'NVIDIA Corporation', installDir: nvidia },
      { key: 'e', name: 'SvcApp', installDir: svc },
      { key: 'f', name: 'SysComp', installDir: system, systemComponent: true },
      { key: 'g', name: 'Foo', installDir: data },
      { key: 'h', name: 'Moved', installDir: moved },
      { key: 'i', name: 'Gone', installDir: join(pf, 'Gone') },
      { key: 'j', name: 'OtherDrive', installDir: 'F:\\SomewhereElse\\App' },
      { key: 'k', name: 'NoDir' },
      { key: 'l', name: 'ProgramFilesItself', installDir: pf },
    ];
    const phases: string[] = [];
    const list = await listSoftware(
      places,
      fakeProbe(apps, [join(big, 'app.exe'), 'C:\\other\\x.exe'], [join(svc, 'app.exe')]),
      {
        onProgress: (p) => phases.push(p.phase),
      },
    );
    const view = Object.fromEntries(list.map((entry) => [entry.name, entry.blocked]));
    assert.deepEqual(Object.keys(view), [
      'Notes',
      'BigApp',
      'SvcApp',
      'SysComp',
      'Foo',
      'NVIDIA Graphics Driver',
      'Tiny',
      'Moved',
    ]);
    assert.equal(view['Notes'], null);
    assert.equal(view['BigApp'], null);
    assert.match(view['SvcApp']!, /服务/);
    assert.match(view['SysComp']!, /系统组件/);
    assert.match(view['Tiny']!, /50MB/);
    assert.match(view['NVIDIA Graphics Driver']!, /显卡驱动/);
    assert.match(view['Foo']!, /系统目录/);
    assert.match(view['Moved']!, /已经搬过/);
    const bigEntry = list.find((entry) => entry.name === 'BigApp')!;
    assert.deepEqual(bigEntry.running, ['app.exe']);
    assert.equal(bigEntry.publisher, 'Big Inc');
    assert.equal(bigEntry.size, BIG + 3);
    assert.equal(bigEntry.id, softwareId(big));
    assert.equal(list.find((entry) => entry.name === 'Notes')!.running, undefined);
    assert.equal(phases[phases.length - 1], 'done');
  });

  test('取消后抛错', async () => {
    const controller = new AbortController();
    controller.abort();
    const apps = [{ key: 'a', name: 'X', installDir: makeApp(join(root, 'Program Files', 'X'), 10) }];
    await assert.rejects(listSoftware(places, fakeProbe(apps, [], []), { signal: controller.signal }));
  });
});

describe('riskyKind', () => {
  test('关键词命中与不误伤', () => {
    assert.equal(riskyKind('Microsoft Visual C++ 2015 Redistributable', 'Microsoft Corporation', 'x'), '运行库');
    assert.equal(riskyKind('Intel(R) Chipset Device Software', 'Intel Corporation', 'x'), '硬件驱动');
    assert.equal(riskyKind('Microsoft Edge WebView2 Runtime', 'Microsoft Corporation', 'x'), '运行库');
    assert.equal(riskyKind('火绒安全软件', '', 'Huorong'), '安全或反作弊软件');
    assert.equal(riskyKind('IntelliJ IDEA', 'JetBrains', 'IDEA'), null);
    assert.equal(riskyKind('Paint.NET', 'dotPDN', 'paint.net'), null);
    assert.equal(riskyKind('Preset Manager', 'Pegasus Soft', 'x'), null);
    assert.equal(riskyKind('WinRAR', 'win.rar GmbH', 'WinRAR'), null);
  });
});
