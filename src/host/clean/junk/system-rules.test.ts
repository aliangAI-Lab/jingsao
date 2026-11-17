/**
 * 新规则（系统临时文件、更新缓存、崩溃转储、驱动解压目录……）在假目录上的扫描与删除：
 * 年龄（minAgeHours / ageDays）、标记文件、跳过目录、身份复核不一致跳过、联接不跟随、被占用跳过，
 * 以及「明确不做」的位置即使被手工塞进规则也会被安全闸拦下。全部在 F 盘测试根里，不碰真实系统。
 * @module jingsao/src/host/clean/junk/system-rules.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { denied, HOUR_MS, locations, type CleanPlaces } from '../safety.ts';
import { removeCandidates } from '../delete/remove.ts';
import { simulatedElevatedCleaner } from '../delete/elevated.ts';
import { testSystemOps } from '../delete/system-ops.ts';
import { scanJunk } from './scan.ts';
import { loadJunkRules, type JunkRule } from './rules.ts';

const PARENT = 'F:/dev/_cache/tmp';

function setup() {
  fs.mkdirSync(PARENT, { recursive: true });
  const root = fs.mkdtempSync(join(PARENT, 'junk-sys-'));
  const places = locations({ JINGSAO_TEST_ROOT: root });
  /** 造一个 hours 小时前修改的文件。 */
  const put = (path: string, hours = 120, content = '1234'): string => {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
    const at = new Date(Date.now() - hours * HOUR_MS);
    fs.utimesSync(path, at, at);
    return path;
  };
  return { root, places, put };
}

/** 把一次扫描的候选分成普通与需管理员两批删掉（管理员那批走模拟提权）。 */
async function cleanAll(places: CleanPlaces, scan: Awaited<ReturnType<typeof scanJunk>>) {
  const all = [...scan.candidates.values()];
  const elevated = await simulatedElevatedCleaner(places)({
    files: all.filter((c) => c.needsAdmin),
    dirs: scan.adminDirs,
    commands: [],
  });
  const normal = await removeCandidates(
    all.filter((c) => !c.needsAdmin),
    places,
    { feature: 'junk' },
  );
  return { elevated, normal };
}

test('每条新规则在假目录上都能扫到并删掉；标记、跳过目录、年龄各自生效', async () => {
  const { places, put } = setup();
  const w = places.windows;
  const pd = places.programdata;
  const yes = [
    put(join(w, 'Temp', 'a.tmp'), 30),
    put(join(w, 'ServiceProfiles/LocalService/AppData/Local/Temp/a')),
    put(join(w, 'ServiceProfiles/NetworkService/AppData/Local/Temp/b')),
    put(join(w, 'SoftwareDistribution/Download/x/y.cab')),
    put(join(pd, 'Microsoft/Windows/WER/ReportArchive/r/Report.wer')),
    put(join(pd, 'Microsoft/Windows/WER/ReportQueue/q/Report.wer')),
    put(join(w, 'Minidump/1.dmp')),
    put(join(w, 'MEMORY.DMP')),
    put(join(w, 'LiveKernelReports/k.dmp')),
    put(join(pd, 'Microsoft/Windows/RetailDemo/OfflineContent/v.mp4')),
    put(join(w, 'Panther/setupact.log')),
    put(join(w, 'Logs/CBS/CBS.log'), 40 * 24),
    put(join(w, 'Logs/CBS/old.cab'), 40 * 24),
    put(join(places.systemdrive, 'NVIDIA/DisplayDriver/1/setup.exe')),
    put(join(places.systemdrive, 'NVIDIA/DisplayDriver/1/data.bin')),
    put(join(pd, 'NVIDIA Corporation/Downloader/abc/pkg.exe')),
    put(join(pd, 'Intel/Package Cache/{guid}/a.msi')),
    put(join(places.local, 'Microsoft/Terminal Server Client/Cache/bcache.bmc')),
    put(join(places.local, 'Packages/App_1/AC/INetCache/x')),
    put(join(places.local, 'Packages/App_1/AC/Temp/y')),
    put(join(places.programfilesx86, 'Google/Update/Download/{x}/inst.exe')),
    put(join(places.roaming, 'Tencent/QQ/Temp/a')),
    put(join(places.roaming, 'Tencent/QQTempSys/b')),
    put(join(places.roaming, 'Tencent/Users/123/WinTemp/c')),
    put(join(places.roaming, 'duowan/yy/log/a.log')),
    put(join(places.roaming, 'duowan/yy/temp/b')),
    put(join(places.roaming, 'duowan/yy/cache/c')),
  ];
  const no = [
    put(join(w, 'Temp', 'fresh.tmp'), 1), // 不到 24 小时
    put(join(w, 'Panther/unattend.xml')), // 只删 *.log
    put(join(w, 'Logs/CBS/recent.log'), 5 * 24), // CBS 只删 30 天前的
    put(join(places.systemdrive, 'AMD/notes.txt')), // 没有 setup.exe / *.inf，不算驱动解压目录
    put(join(pd, 'NVIDIA Corporation/Downloader/latest/pkg.exe')), // 最新一版保留
    put(join(places.local, 'Packages/App_1/AC/INetCache/new'), 2), // 商店缓存也要 24 小时前
    put(join(places.roaming, 'Tencent/QQ/Users/123/Msg3.0.db')), // 聊天记录不在规则里
  ];
  const scan = await scanJunk(places, { systemOps: testSystemOps(places) });
  const ids = new Set(scan.result.categories.map((c) => c.id));
  for (const id of [
    'win-temp',
    'svc-temp',
    'wu-download',
    'wer-system',
    'crash-dumps',
    'retail-demo',
    'setup-logs',
    'driver-extract',
    'nv-downloader',
    'intel-pkg',
    'rdp-cache',
    'store-app-cache',
    'google-update',
    'qq-temp',
    'yy-temp',
  ]) {
    assert.ok(ids.has(id), `应该扫到 ${id}`);
  }
  const paths = new Set([...scan.candidates.values()].map((c) => c.path));
  for (const path of yes) assert.ok(paths.has(path), '应该是候选：' + path);
  for (const path of no) assert.ok(!paths.has(path), '不该是候选：' + path);
  // 系统规则带管理员标记与登记的根；用户级规则不带
  const byPath = new Map([...scan.candidates.values()].map((c) => [c.path, c]));
  assert.equal(byPath.get(yes[0]!)?.needsAdmin, true);
  assert.equal(byPath.get(yes[0]!)?.systemRoot, join(w, 'Temp'));
  assert.equal(byPath.get(join(w, 'MEMORY.DMP'))?.systemRoot, join(w, 'MEMORY.DMP'));
  assert.equal(byPath.get(yes[17]!)?.needsAdmin, undefined);
  const category = scan.result.categories.find((c) => c.id === 'crash-dumps')!;
  assert.equal(category.defaultChecked, false);
  assert.equal(category.warn, '排查蓝屏时要用，没遇到蓝屏可以删');
  assert.equal(category.group, 'temp');

  const { elevated, normal } = await cleanAll(places, scan);
  assert.equal(normal.skipped, 0);
  assert.ok(Object.values(elevated.rules).every((tally) => tally.skipped === 0));
  for (const path of yes) assert.ok(!fs.existsSync(path), '应该已删：' + path);
  for (const path of no) assert.ok(fs.existsSync(path), '不该删：' + path);
  // 只删文件，不删目录
  assert.ok(fs.existsSync(join(w, 'Panther')));
});

test('扫描后文件有变化 → 删除时跳过（普通规则与提权规则都一样）', async () => {
  const { places, put } = setup();
  const user = put(join(places.local, 'Temp', 'a'), 72);
  const system = put(join(places.windows, 'Temp', 'b'), 72);
  const scan = await scanJunk(places, { rules: loadJunkRules().filter((r) => ['temp', 'win-temp'].includes(r.id)) });
  assert.equal(scan.candidates.size, 2);
  fs.writeFileSync(user, '扫描后改过');
  fs.writeFileSync(system, '扫描后改过');
  const { elevated, normal } = await cleanAll(places, scan);
  assert.equal(normal.skipped, 1);
  assert.equal(normal.reasons.changed, 1);
  assert.equal(elevated.rules['win-temp']?.skipped, 1);
  assert.ok(fs.existsSync(user) && fs.existsSync(system));
});

test('规则根目录里的联接不跟随：联接指向的外部文件不扫不删', async () => {
  const { root, places, put } = setup();
  const outside = put(join(root, 'outside', 'keep.bin'));
  fs.mkdirSync(join(places.windows, 'Temp'), { recursive: true });
  fs.symlinkSync(dirname(outside), join(places.windows, 'Temp', 'link'), 'junction');
  // 规则根本身被换成联接也不进
  fs.mkdirSync(join(places.windows, 'SoftwareDistribution'), { recursive: true });
  fs.symlinkSync(dirname(outside), join(places.windows, 'SoftwareDistribution', 'Download'), 'junction');
  const scan = await scanJunk(places, {
    rules: loadJunkRules().filter((r) => ['win-temp', 'wu-download'].includes(r.id)),
  });
  assert.equal(scan.candidates.size, 0);
  await cleanAll(places, scan);
  assert.ok(fs.existsSync(outside));
});

test('被占用的文件跳过并计数，不算失败', async () => {
  const { places, put } = setup();
  const busy = put(join(places.local, 'Temp', 'busy'), 72);
  const free = put(join(places.local, 'Temp', 'free'), 72);
  const scan = await scanJunk(places, { rules: loadJunkRules().filter((r) => r.id === 'temp') });
  const outcome = await removeCandidates([...scan.candidates.values()], places, {
    feature: 'junk',
    unlink: (path) => {
      if (path === busy) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      fs.unlinkSync(path);
    },
  });
  assert.equal(outcome.files, 1);
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.reasons.busy, 1);
  assert.ok(fs.existsSync(busy) && !fs.existsSync(free));
});

test('「明确不做」的位置即使被手工塞进规则也会被安全闸拦下', async () => {
  const { places, put } = setup();
  const base = loadJunkRules().find((r) => r.id === 'win-temp')!;
  const sneaky: JunkRule[] = [
    { ...base, id: 'x-ime', base: 'windows', paths: ['IME'] },
    { ...base, id: 'x-installer', base: 'windows', paths: ['Installer/$PatchCache$', 'Installer'] },
    { ...base, id: 'x-prefetch', base: 'windows', paths: ['Prefetch'] },
    { ...base, id: 'x-defender', base: 'programdata', paths: ['Microsoft/Windows Defender/Scans/History'] },
    { ...base, id: 'x-pkgcache', base: 'programdata', paths: ['Package Cache'] },
    { ...base, id: 'x-fonts', base: 'windows', paths: ['Fonts'] },
  ];
  const files = [
    put(join(places.windows, 'IME/IMEKR/a.dll')),
    put(join(places.windows, 'Installer/$PatchCache$/Managed/a.msp')),
    put(join(places.windows, 'Installer/b.msi')),
    put(join(places.windows, 'Prefetch/APP.pf')),
    put(join(places.programdata, 'Microsoft/Windows Defender/Scans/History/Service/a')),
    put(join(places.programdata, 'Package Cache/{x}/vc_redist.exe')),
    put(join(places.windows, 'Fonts/a.ttf')),
  ];
  const scan = await scanJunk(places, { rules: sneaky });
  assert.equal(scan.candidates.size, 0);
  for (const file of files) {
    // 就算有人把这个位置登记成系统根，也一样拦下
    assert.match(String(denied(file, places, { systemRoots: [dirname(file)] })), /系统保护范围/);
  }
  // 普通的系统根：没登记拦下，登记了放行
  const temp = join(places.windows, 'Temp', 'x');
  assert.match(String(denied(temp, places)), /系统目录/);
  assert.equal(denied(temp, places, { systemRoots: [join(places.windows, 'Temp')] }), null);
});

test('三个新的系统位置可以被测试根整体替换；配到 C 盘直接抛错', () => {
  const places = locations({ JINGSAO_TEST_ROOT: 'F:\\dev\\_cache\\tmp\\fake-root' });
  assert.equal(places.windows, 'F:\\dev\\_cache\\tmp\\fake-root\\Windows');
  assert.equal(places.programdata, 'F:\\dev\\_cache\\tmp\\fake-root\\ProgramData');
  assert.equal(places.systemdrive, 'F:\\dev\\_cache\\tmp\\fake-root');
  assert.equal(places.programfilesx86, 'F:\\dev\\_cache\\tmp\\fake-root\\Program Files (x86)');
  assert.throws(() => locations({ JINGSAO_TEST_ROOT: 'C:\\Users\\x\\fake' }), /非 C 盘/);
  // 真实模式从环境变量推导，不写死
  const real = locations({ SystemRoot: 'D:\\Win', ProgramData: 'D:\\PD', SystemDrive: 'D:' });
  assert.equal(real.windows, 'D:\\Win');
  assert.equal(real.programdata, 'D:\\PD');
  assert.equal(real.systemdrive, 'D:\\');
});
