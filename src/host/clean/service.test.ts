/**
 * 清理服务集成测试：在 F 盘临时目录里造一个「假 C 盘」，走一遍扫描 → 直接删除（审计日志）、
 * 微信QQ 直接删除、大文件搬家与搬回、回收站与传递优化（系统命令，测试里模拟）、更新进行中跳过、
 * 拒绝提权只清普通规则、取消、上个版本暂存区遗留数据的两种处理、忙碌互斥、列表过期拒绝，
 * 以及宠物反应事件的顺序。全程不弹 UAC、不碰真实 C 盘。
 * @module jingsao/src/host/clean/service.test
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { ElevationDenied } from './delete/elevated.ts';
import { readCleanLog } from './delete/log.ts';
import { locations, type CleanPlaces } from './safety.ts';
import { CleanService, type CleanEvent, type CleanServiceOptions } from './service.ts';
import type { SoftwareProbe } from './software/index.ts';
import type { CleanRunOutcome } from './types.ts';

const base = process.env.JINGSAO_TMP ?? 'F:\\dev\\_cache\\tmp';
mkdirSync(base, { recursive: true });
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const OLD = Date.now() - 40 * 86_400_000;

/** 造一个 40 天前的文件。 */
function put(path: string, bytes: number, fill = 1): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes, fill));
  utimesSync(path, new Date(OLD), new Date(OLD));
  return path;
}

const probe: SoftwareProbe = {
  listInstalled: async () => [],
  runningExecutables: async () => [],
  serviceImagePaths: async () => [],
} as unknown as SoftwareProbe;

/** 一个独立的假 C 盘 + 服务。 */
function harness(extra: Partial<CleanServiceOptions> = {}) {
  const root = mkdtempSync(join(base, 'svc-'));
  roots.push(root);
  const places = locations({ JINGSAO_TEST_ROOT: root });
  const events: CleanEvent[] = [];
  const service = new CleanService({
    dataDir: join(root, 'data'),
    places,
    softwareProbe: probe,
    onEvent: (e) => events.push(e),
    ...extra,
  });
  /** 等当前任务结束，返回它。 */
  const settle = async (): Promise<NonNullable<ReturnType<CleanService['status']>['job']>> => {
    for (let i = 0; i < 400; i++) {
      const job = service.status().job;
      if (job && job.finishedAt !== undefined) return job;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('任务没有结束');
  };
  return { root, places, events, service, settle };
}

/** 扫一遍垃圾，返回结果。 */
async function scanJunk(run: ReturnType<typeof harness>) {
  run.service.startScan('junk');
  const job = await run.settle();
  assert.equal(job.error, undefined, job.error ?? '');
  const result = run.service.result('junk');
  assert.ok(result);
  return result;
}

test('垃圾清理：扫描 → 整类直接删除（不进暂存区）→ 写审计日志；个人文件和没勾的不动', async () => {
  const run = harness();
  const shader = put(join(run.places.local, 'NVIDIA', 'DXCache', 'a.nvph'), 4096);
  const temp = put(join(run.places.local, 'Temp', 'x.tmp'), 2048);
  const keep = put(join(run.places.home, 'Desktop', 'important.docx'), 1000);
  run.service.startScan('junk');
  assert.throws(() => run.service.startScan('junk'), /正在忙/);
  const scanned = await run.settle();
  assert.equal(scanned.error, undefined);
  const result = run.service.result('junk')!;
  const gpu = result.categories.find((c) => c.items.some((i) => i.path === shader));
  assert.ok(gpu, '显卡缓存应该被扫到');
  assert.equal(gpu.group, 'cache');
  assert.ok(!result.categories.some((c) => c.items.some((i) => i.path === keep)));

  const job = run.service.clean('junk', [], [gpu.id]);
  assert.equal(job.estimateBytes, 4096);
  const done = await run.settle();
  assert.equal(done.error, undefined, done.error ?? '');
  const outcome = done.outcome as CleanRunOutcome;
  assert.equal(outcome.bytes, 4096);
  assert.equal(outcome.skipped, 0);
  assert.ok(!existsSync(shader), '直接删掉了');
  assert.ok(!existsSync(join(run.places.local, 'Jingsao', 'Staging')), '没有暂存区');
  assert.ok(existsSync(keep));
  assert.ok(existsSync(temp), '没勾的分类不能动');
  assert.equal(run.service.status().legacy, null);
  // 已清的分类从结果里拿掉，再提交同一类视为过期
  assert.ok(!run.service.result('junk')!.categories.some((c) => c.id === gpu.id));
  assert.throws(() => run.service.clean('junk', [], [gpu.id]), /过期/);
  const log = readCleanLog(join(run.root, '.jingsao-data', 'clean-log.jsonl'));
  assert.deepEqual(
    log.map((entry) => [entry.feature, entry.ruleId, entry.files, entry.bytes, entry.skipped]),
    [['junk', 'gpu', 1, 4096, 0]],
  );
  // 宠物反应：开始带预计字节，结束带实际释放
  const start = run.events.find((e) => e.kind === 'work-start');
  assert.deepEqual(start, { kind: 'work-start', feature: 'junk', action: 'clean', bytes: 4096 });
  const end = run.events.find((e) => e.kind === 'work-done');
  assert.ok(end && end.kind === 'work-done' && end.freedBytes === 4096 && end.skipped === 0);
});

test('提交扫描结果以外的 id 会被拒绝（列表过期）', async () => {
  const run = harness();
  put(join(run.places.local, 'Temp', 'x.tmp'), 10);
  await scanJunk(run);
  assert.throws(() => run.service.clean('junk', ['not-a-real-id']), /过期|扫描/);
  assert.throws(() => run.service.clean('bigfiles', []), /不能直接清理/);
});

test('微信QQ：整类直接删除；「收发的文件」默认不勾', async () => {
  const run = harness();
  const qqPic = put(join(run.places.documents, 'Tencent Files', '123456789', 'nt_qq', 'nt_data', 'Pic', 'p.jpg'), 3000);
  run.service.startScan('chat');
  await run.settle();
  const cat = run.service.result('chat')?.categories.find((c) => c.id === 'qq-image');
  assert.ok(cat);
  assert.equal(cat.defaultChecked, true);
  run.service.clean('chat', [], [cat.id]);
  const done = await run.settle();
  assert.equal(done.error, undefined, done.error ?? '');
  assert.ok(!existsSync(qqPic));
});

test('大文件搬家：搬到另一个「盘」再搬回来，内容一致；开始事件带搬走总量', async () => {
  const run = harness();
  const big = put(join(run.places.home, 'Downloads', 'huge.zip'), 3 * 1024 * 1024, 7);
  run.service.startScan('bigfiles', { minSize: 1024 * 1024 });
  await run.settle();
  const item = run.service
    .result('bigfiles')
    ?.categories.flatMap((c) => c.items)
    .find((i) => i.path === big);
  assert.ok(item, '大文件应该被扫到');
  const dest = run.service.status().drives[0]!.root;
  mkdirSync(dest, { recursive: true });
  run.service.moveBigFiles([item.id], dest);
  const moved = await run.settle();
  assert.equal(moved.error, undefined, moved.error ?? '');
  assert.ok(!existsSync(big));
  const start = run.events.find((e) => e.kind === 'work-start');
  assert.ok(start && start.kind === 'work-start' && start.action === 'move' && start.bytes === 3 * 1024 * 1024);
  const record = run.service.status().moves.find((m) => m.from === big);
  assert.ok(record && record.state === 'moved');
  run.service.restoreBigFiles([record.id]);
  const back = await run.settle();
  assert.equal(back.error, undefined, back.error ?? '');
  assert.ok(existsSync(big));
  assert.equal(readFileSync(big)[100], 7);
});

test('回收站与传递优化缓存：用系统命令清（测试里模拟），大小按扫描时统计计入', async () => {
  const run = harness();
  put(join(run.places.drive, '$Recycle.Bin', 'S-1', '$R1.txt'), 500);
  const cache = join(
    run.places.windows,
    'ServiceProfiles/NetworkService/AppData/Local/Microsoft/Windows/DeliveryOptimization/Cache',
  );
  put(join(cache, 'abc', 'part'), 700);
  const result = await scanJunk(run);
  const bin = result.categories.find((c) => c.id === 'recycle-bin');
  const delivery = result.categories.find((c) => c.id === 'delivery-opt');
  assert.equal(bin?.bytes, 500);
  assert.equal(bin?.special, 'recycle-bin');
  assert.equal(delivery?.bytes, 700);
  assert.equal(delivery?.needsAdmin, true);
  run.service.clean('junk', [], ['recycle-bin', 'delivery-opt']);
  const done = await run.settle();
  assert.equal(done.error, undefined, done.error ?? '');
  assert.equal((done.outcome as CleanRunOutcome).bytes, 1200);
  assert.ok(!existsSync(join(run.places.drive, '$Recycle.Bin', 'S-1')));
  assert.ok(!existsSync(join(cache, 'abc')));
});

test('Windows 更新正在进行：更新下载缓存整条跳过并说明，其它照清', async () => {
  const run = harness();
  const update = put(join(run.places.windows, 'SoftwareDistribution', 'Download', 'x.cab'), 100);
  const temp = put(join(run.places.windows, 'Temp', 'y.tmp'), 100);
  writeFileSync(join(run.root, '.wu-busy'), '');
  await scanJunk(run);
  run.service.clean('junk', [], ['wu-download', 'win-temp']);
  const done = await run.settle();
  const outcome = done.outcome as CleanRunOutcome;
  assert.deepEqual(outcome.updateBusy, ['Windows 更新下载缓存']);
  assert.ok(existsSync(update));
  assert.ok(!existsSync(temp));
  const end = run.events.find((e) => e.kind === 'work-done');
  assert.ok(end && end.kind === 'work-done' && end.notes?.some((n) => n.includes('系统正在更新')));
});

test('拒绝提权：普通权限的规则照常清，系统规则跳过并说明「需要管理员权限，这次没清」', async () => {
  const calls: unknown[] = [];
  const run = harness({
    elevatedCleaner: async (manifest) => {
      calls.push(manifest);
      throw new ElevationDenied();
    },
  });
  const system = put(join(run.places.windows, 'Temp', 'a.tmp'), 100);
  const wer = put(join(run.places.programdata, 'Microsoft/Windows/WER/ReportArchive/r/Report.wer'), 100);
  const user = put(join(run.places.local, 'Temp', 'b.tmp'), 100);
  await scanJunk(run);
  run.service.clean('junk', [], ['win-temp', 'wer-system', 'temp']);
  const done = await run.settle();
  assert.equal(done.error, undefined, done.error ?? '');
  const outcome = done.outcome as CleanRunOutcome;
  assert.equal(calls.length, 1, '一次清理只提权一次');
  assert.equal(outcome.adminSkipped, 2);
  assert.ok(existsSync(system) && existsSync(wer));
  assert.ok(!existsSync(user));
  const end = run.events.find((e) => e.kind === 'work-done');
  assert.ok(end && end.kind === 'work-done' && end.notes?.includes('系统相关的 2 项需要管理员权限，这次没清'));
});

test('取消：停在文件之间，发出 cancelled 事件；已删的不回来，剩下的保留', async () => {
  let deleted = 0;
  const run = harness({
    unlink: (path) => {
      deleted++;
      // 删到第 40 个时用户点了取消
      if (deleted === 40) run.service.cancel();
      unlinkSync(path);
    },
  });
  for (let i = 0; i < 200; i++) put(join(run.places.local, 'Temp', `f${i}.tmp`), 10);
  await scanJunk(run);
  run.service.clean('junk', [], ['temp']);
  const done = await run.settle();
  assert.equal(done.progress.phase, 'cancelled');
  assert.ok((done.outcome as CleanRunOutcome).cancelled);
  assert.ok(deleted < 200);
  assert.ok(run.events.some((e) => e.kind === 'cancelled' && e.action === 'clean'));
  assert.ok(!run.events.some((e) => e.kind === 'work-done'));
});

/** 造一份上个版本的暂存区：一个批次、两个还在暂存的文件。 */
function legacyStaging(places: CleanPlaces): { original: string[]; staged: string[] } {
  const batch = '11111111-2222-4333-8444-555555555555';
  const original = [join(places.local, 'Temp', 'old1.tmp'), join(places.home, 'Desktop', 'dup.jpg')];
  const staged = original.map((_, i) => join(places.legacyStaging, batch, `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${i}`));
  const lines = [
    JSON.stringify({
      version: 1,
      batch: { id: batch, feature: 'junk', createdAt: 1, files: 0, bytes: 0, failed: [], state: 'staged' },
    }),
  ];
  staged.forEach((path, i) => {
    put(path, 100 + i);
    lines.push(
      JSON.stringify({
        entry: {
          entryId: `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${i}`,
          path: original[i],
          stagedPath: path,
          status: 'staged',
          identity: { size: 100 + i, mtimeMs: OLD, ino: 0, dev: 0 },
        },
      }),
    );
  });
  writeFileSync(join(places.legacyStaging, batch, 'journal.jsonl'), lines.join('\n') + '\n');
  return { original, staged };
}

test('上个版本暂存区：启动时检测到就提示；彻底删除后不再提示', async () => {
  const root = mkdtempSync(join(base, 'svc-legacy-'));
  roots.push(root);
  const places = locations({ JINGSAO_TEST_ROOT: root });
  const { original, staged } = legacyStaging(places);
  const service = new CleanService({ dataDir: join(root, 'data'), places, softwareProbe: probe });
  assert.deepEqual(service.status().legacy, { files: 2, bytes: 201 });
  service.settleLegacy('purge');
  for (let i = 0; i < 200 && service.status().job?.finishedAt === undefined; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(service.status().legacy, null);
  assert.ok(staged.every((path) => !existsSync(path)));
  assert.ok(original.every((path) => !existsSync(path)));
  assert.ok(!existsSync(places.legacyStaging), '暂存目录整个清掉');
  assert.throws(() => service.settleLegacy('purge'), /没有上个版本暂存的文件/);
});

test('上个版本暂存区：原样放回；原位置已有同名文件时放在旁边，不覆盖', async () => {
  const root = mkdtempSync(join(base, 'svc-legacy-'));
  roots.push(root);
  const places = locations({ JINGSAO_TEST_ROOT: root });
  const { original } = legacyStaging(places);
  put(original[1]!, 5, 9); // 原位置已经有一个新的同名文件
  const service = new CleanService({ dataDir: join(root, 'data'), places, softwareProbe: probe });
  service.settleLegacy('restore');
  for (let i = 0; i < 200 && service.status().job?.finishedAt === undefined; i++)
    await new Promise((r) => setTimeout(r, 20));
  const outcome = service.status().job?.outcome as { files: number; renamed: number; failed: number };
  assert.deepEqual([outcome.files, outcome.renamed, outcome.failed], [2, 1, 0]);
  assert.equal(readFileSync(original[0]!).length, 100);
  assert.equal(readFileSync(original[1]!).length, 5, '新文件原样保留');
  assert.equal(readFileSync(join(places.home, 'Desktop', 'dup（鲸扫放回）.jpg')).length, 101);
  assert.equal(service.status().legacy, null);
  assert.ok(!existsSync(places.legacyStaging));
});
