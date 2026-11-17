/**
 * 清理动画的指令序列：分档、开始（吸入-开始 → 吸入-循环-档，循环到下一条指令）、成功（打嗝 → 推容量条-按实际释放量重新分档，
 * 推完冒结果气泡）、部分跳过、失败与取消（叹气冒汗 + 看详情提示）、老配置退回老动画、睡着 / 被占用 / 收起不播。
 * @module jingsao/src/host/clean/pet-fx.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCleanFx, formatBytes, sizeTier, swallowNames, BURP_MS, MIN_SWALLOW_MS, PUSH_MS } from './pet-fx.ts';
import type { CleanEvent } from './service.ts';

const GB = 1024 ** 3;

const SWALLOW = {
  start: ['清理-吸入-开始'],
  loop: { small: ['清理-吸入-循环-小'], medium: ['清理-吸入-循环-中'], large: ['清理-吸入-循环-大'] },
  burp: ['清理-打嗝'],
  push: { small: ['清理-推容量条-小'], medium: ['清理-推容量条-中'], large: ['清理-推容量条-大'] },
};
const LEGACY = ['清理-扫描中', '清理-打扫中', '清理-搬家', '清理-推容量条', '清理-大功告成'];
const WORK = ['工作状态-忙碌点按', '工作状态-雀跃庆祝', '工作状态-垂头叹气冒汗'];

/** 一只宠物的假宿主：记录写进状态的每一条指令。 */
function harness(
  options: { swallow?: boolean; display?: string; sleeping?: boolean; locked?: boolean; fast?: boolean } = {},
) {
  // 假时钟：默认每条事件之间隔 10 秒（吸入早就演够了）；fast 时时钟不走，模拟清得飞快
  let clock = 0;
  const writes: Array<{ petId: string; key: string; data: Record<string, unknown> }> = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const animations = {
    idle: ['待机'],
    events: { clean: LEGACY, workStatus: WORK, ...(options.swallow === false ? {} : { cleanSwallow: SWALLOW }) },
  };
  const fx = createCleanFx({
    readConfig: () => ({ main: { pets: [{ id: 'p1' }], animations } }),
    effectivePetList: () => [{ id: 'p1', display: options.display ?? 'both' }],
    writePet: (petId, key, data) => writes.push({ petId, key, data }),
    createPlayback: (_petId, name) => 'pb-' + name,
    locked: () => options.locked === true,
    sleeping: () => options.sleeping === true,
    schedule: (fn, ms) => timers.push({ fn, ms }),
    random: () => 0,
    now: () => clock,
  });
  const raw = fx;
  const step = (event: CleanEvent): void => {
    raw(event);
    if (!options.fast) clock += 10_000;
  };
  const anims = () => writes.filter((w) => w.key === 'anim').map((w) => w.data);
  const says = () => writes.filter((w) => w.key === 'say').map((w) => w.data.text);
  return { fx: step, writes, timers, anims, says, tick: (ms: number) => (clock += ms) };
}

const start = (bytes: number): CleanEvent => ({ kind: 'work-start', feature: 'junk', action: 'clean', bytes });

test('分档：< 1 GB 小，1–10 GB 中，≥ 10 GB 大', () => {
  assert.equal(sizeTier(0), 'small');
  assert.equal(sizeTier(GB - 1), 'small');
  assert.equal(sizeTier(GB), 'medium');
  assert.equal(sizeTier(10 * GB - 1), 'medium');
  assert.equal(sizeTier(10 * GB), 'large');
  assert.equal(formatBytes(46.2 * GB), '46.2 GB');
});

test('开始：吸入-开始 接 吸入-循环-<按预计量分档>，循环到下一条指令', () => {
  const run = harness();
  run.fx(start(5 * GB));
  assert.deepEqual(run.anims(), [
    { name: '清理-吸入-开始', next: '清理-吸入-循环-中', loop: true, playbackId: 'pb-清理-吸入-开始' },
  ]);
});

test('成功：打嗝 → 推容量条（按实际释放量重新分档），「嗝～」气泡，推完冒真实数字', () => {
  const run = harness();
  run.fx(start(5 * GB));
  run.fx({ kind: 'work-done', feature: 'junk', action: 'clean', bytes: 46.2 * GB, freedBytes: 46.2 * GB, skipped: 0 });
  assert.deepEqual(run.anims()[1], { name: '清理-打嗝', next: '清理-推容量条-大', playbackId: 'pb-清理-打嗝' });
  assert.equal(run.says()[run.says().length - 1], '嗝～');
  assert.equal(run.timers.length, 1);
  assert.equal(run.timers[0]!.ms, BURP_MS + PUSH_MS);
  run.timers[0]!.fn();
  assert.equal(run.says()[run.says().length - 1], '吃掉了 46.2 GB，C 盘喘口气了～');
});

test('部分跳过：同成功，结果气泡补一句「有 12 个文件正在被使用，没删掉」', () => {
  const run = harness();
  run.fx(start(200));
  run.fx({
    kind: 'work-done',
    feature: 'junk',
    action: 'clean',
    bytes: 500 * 1024 ** 2,
    freedBytes: 500 * 1024 ** 2,
    skipped: 12,
    notes: ['有 12 个文件正在被使用，没删掉'],
  });
  assert.equal(run.anims()[1]!.next, '清理-推容量条-小');
  run.timers[0]!.fn();
  assert.equal(run.says()[run.says().length - 1], '吃掉了 500 MB，C 盘喘口气了～\n有 12 个文件正在被使用，没删掉');
});

test('失败：停循环，叹气冒汗，气泡说明原因并提示右键看详情', () => {
  const run = harness();
  run.fx(start(GB));
  run.fx({ kind: 'error', feature: 'junk', action: 'clean', message: '磁盘出错' });
  assert.deepEqual(run.anims()[1], { name: '工作状态-垂头叹气冒汗', playbackId: 'pb-工作状态-垂头叹气冒汗' });
  assert.match(String(run.says()[run.says().length - 1]), /磁盘出错.*右键 → 清理C盘 看详情/);
});

test('取消：吸入过的宠物停循环叹气；没吸入的不打扰', () => {
  const run = harness();
  run.fx(start(GB));
  run.fx({ kind: 'cancelled', feature: 'junk', action: 'clean' });
  assert.equal(run.anims()[1]!.name, '工作状态-垂头叹气冒汗');
  assert.match(String(run.says()[run.says().length - 1]), /右键 → 清理C盘 看详情/);
  const idle = harness();
  idle.fx({ kind: 'cancelled', feature: 'junk', action: 'clean' });
  assert.equal(idle.writes.length, 0);
});

test('老配置没有 cleanSwallow：循环退回 清理-打扫中 / 清理-搬家，成功退回 清理-推容量条', () => {
  const run = harness({ swallow: false });
  run.fx(start(GB));
  assert.deepEqual(run.anims()[0], { name: '清理-打扫中', loop: true, playbackId: 'pb-清理-打扫中' });
  run.fx({ kind: 'work-done', feature: 'junk', action: 'clean', bytes: GB, freedBytes: GB });
  assert.deepEqual(run.anims()[1], { name: '清理-推容量条', playbackId: 'pb-清理-推容量条' });
  assert.equal(run.timers[0]!.ms, PUSH_MS);
  const move = swallowNames({ events: { clean: LEGACY } }, 'move', 'small');
  assert.equal(move?.loop, '清理-搬家');
});

test('睡着、被第三方占用、收起（display=none）时不播也不说话', () => {
  for (const options of [{ sleeping: true }, { locked: true }, { display: 'none' }]) {
    const run = harness(options);
    run.fx(start(GB));
    run.fx({ kind: 'work-done', feature: 'junk', action: 'clean', bytes: GB, freedBytes: GB });
    assert.equal(run.writes.length, 0, JSON.stringify(options));
  }
});

test('恢复类结果（搬回、放回暂存）不播吸入，只冒一句', () => {
  const run = harness();
  run.fx({ kind: 'work-done', feature: 'bigfiles', action: 'move-restore', bytes: GB });
  assert.deepEqual(run.anims(), [{ name: '清理-大功告成', playbackId: 'pb-清理-大功告成' }]);
  assert.equal(run.says()[0], '已经原样放回去了～');
});

test('清得太快：吸入至少演满 3.5 秒才打嗝，期间开了新任务就不再收尾旧的', () => {
  const run = harness({ fast: true });
  run.fx(start(GB));
  run.tick(1000);
  run.fx({ kind: 'work-done', feature: 'junk', action: 'clean', bytes: GB, freedBytes: GB });
  assert.equal(run.anims().length, 1);
  assert.equal(run.timers.length, 1);
  assert.equal(run.timers[0]!.ms, MIN_SWALLOW_MS - 1000);
  run.timers[0]!.fn();
  assert.equal(run.anims()[1]!.name, '清理-打嗝');

  const again = harness({ fast: true });
  again.fx(start(GB));
  again.fx({ kind: 'work-done', feature: 'junk', action: 'clean', bytes: GB, freedBytes: GB });
  again.fx(start(GB));
  again.timers[0]!.fn();
  assert.equal(again.anims().filter((a) => a.name === '清理-打嗝').length, 0);
});
