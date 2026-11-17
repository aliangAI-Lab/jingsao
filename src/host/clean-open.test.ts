/** 「打开清理面板」的去向：在用户看得见的那只鲸鱼娘旁边打开（网页可见 → 浮层；否则桌面有宠物 → 小窗；否则网页兜底；全部收起不弹）；/state 的 surface / visible 续租与 /clean/open 路由。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllConfig } from './config.ts';
import {
  CLEAN_SURFACE_LEASE_MS,
  CLEAN_VISIBLE_LEASE_MS,
  cleanSurfaceOf,
  cleanVisibleOf,
  describeCleanOpen,
  requestCleanOpen,
  touchCleanSurface,
} from './clean-open.ts';
import { PollStateStore } from './state.ts';
import { createHttpRoute } from './plugin/http-route.ts';
import type { PetRouteDeps } from './routes/types.ts';

/** 临时配置：给定每只宠物的 display。 */
function harness(displays: string[]) {
  const userRoot = mkdtempSync(join(tmpdir(), 'jingsao-clean-open-'));
  const petDir = join(userRoot, 'pet');
  mkdirSync(petDir);
  const configPaths = {
    defaultFile: fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url)),
    userFile: join(userRoot, 'main-config.jsonc'),
    petDir,
  };
  const base = (readAllConfig(configPaths).main.pets as Record<string, unknown>[])[0];
  const pets = displays.map((display, i) => ({ ...base, id: 'p' + i, display }));
  writeFileSync(configPaths.userFile, JSON.stringify({ pets }));
  const state = new PollStateStore();
  const deps = { state, configPaths } as unknown as PetRouteDeps;
  return { state, deps, dispose: () => rmSync(userRoot, { recursive: true, force: true }) };
}

const NOW = 1_800_000_000_000;

test('网页在线 → 开网页浮层，写一条 target=web 的打开信号', () => {
  const run = harness(['web', 'desktop']);
  try {
    touchCleanSurface(run.state, 'web', NOW - 1000);
    touchCleanSurface(run.state, 'desktop', NOW - 1000);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'web' });
    assert.deepEqual(run.state.read().sections.clean.data, { open: NOW, target: 'web' });
  } finally {
    run.dispose();
  }
});

test('只有桌面在线 → 请桌面 Helper 弹小窗（target=desktop）', () => {
  const run = harness(['desktop']);
  try {
    touchCleanSurface(run.state, 'desktop', NOW - 500);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'desktop' });
    assert.deepEqual(run.state.read().sections.clean.data, { open: NOW, target: 'desktop' });
  } finally {
    run.dispose();
  }
});

test('网页轮询过期后不再算在线，改走桌面', () => {
  const run = harness(['both']);
  try {
    touchCleanSurface(run.state, 'web', NOW - CLEAN_SURFACE_LEASE_MS);
    touchCleanSurface(run.state, 'desktop', NOW - 10);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'desktop' });
  } finally {
    run.dispose();
  }
});

test('全部收起且网页不在 → 什么都不弹，回 pet-hidden，不写信号', () => {
  const run = harness(['none', 'none']);
  try {
    touchCleanSurface(run.state, 'desktop', NOW - 10); // 托盘常驻的 Helper 也不弹
    const result = requestCleanOpen(run.deps, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'pet-hidden');
    assert.equal(run.state.read().sections.clean.counter, 0);
  } finally {
    run.dispose();
  }
});

test('全部收起但网页在线 → 仍开网页浮层（浮层顶上有「叫她回来」）', () => {
  const run = harness(['none']);
  try {
    touchCleanSurface(run.state, 'web', NOW - 10);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'web' });
  } finally {
    run.dispose();
  }
});

test('两端都不在线 → surface-offline，不写信号', () => {
  const run = harness(['desktop']);
  try {
    const result = requestCleanOpen(run.deps, NOW);
    assert.equal(result.ok === false ? result.reason : '', 'surface-offline');
    assert.equal(run.state.read().sections.clean.counter, 0);
  } finally {
    run.dispose();
  }
});

test('网页可见且网页上有宠物 → 开网页浮层（桌面也在线时网页优先）', () => {
  const run = harness(['both']);
  try {
    touchCleanSurface(run.state, 'web', NOW - 500, true);
    touchCleanSurface(run.state, 'desktop', NOW - 500);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'web' });
  } finally {
    run.dispose();
  }
});

test('网页最小化（visible=0）且桌面有宠物 → 开在桌面鲸鱼娘旁边', () => {
  const run = harness(['web', 'desktop']);
  try {
    touchCleanSurface(run.state, 'web', NOW - 500, false);
    touchCleanSurface(run.state, 'desktop', NOW - 500);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'desktop' });
    assert.deepEqual(run.state.read().sections.clean.data, { open: NOW, target: 'desktop' });
  } finally {
    run.dispose();
  }
});

test('网页最小化但桌面没有宠物 → 兜底开网页浮层（切回 DSH 时能看到）', () => {
  const run = harness(['web']);
  try {
    touchCleanSurface(run.state, 'web', NOW - 500, false);
    touchCleanSurface(run.state, 'desktop', NOW - 500); // 托盘常驻的 Helper 在线，但桌面上没有宠物
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'web' });
  } finally {
    run.dispose();
  }
});

test('「页面可见」的上报过期（约 3 秒没再上报）→ 当作看不见，改去桌面', () => {
  const run = harness(['both']);
  try {
    touchCleanSurface(run.state, 'web', NOW - CLEAN_VISIBLE_LEASE_MS, true);
    touchCleanSurface(run.state, 'desktop', NOW - 200);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'desktop' });
  } finally {
    run.dispose();
  }
});

test('visible 参数只认 0 / 1；老页面不带时按可见处理', () => {
  assert.equal(cleanVisibleOf('1'), true);
  assert.equal(cleanVisibleOf('0'), false);
  assert.equal(cleanVisibleOf(null), undefined);
  const run = harness(['web', 'desktop']);
  try {
    touchCleanSurface(run.state, 'web', NOW - 100);
    touchCleanSurface(run.state, 'desktop', NOW - 100);
    assert.deepEqual(requestCleanOpen(run.deps, NOW), { ok: true, target: 'web' });
  } finally {
    run.dispose();
  }
});

test('给 AI 的结果：成功补一句说明，失败原样带 message', () => {
  assert.match(describeCleanOpen({ ok: true, target: 'web' }).message, /网页/);
  assert.match(describeCleanOpen({ ok: true, target: 'desktop' }).message, /桌面/);
  const failed = describeCleanOpen({ ok: false, reason: 'pet-hidden', message: '收起来了' });
  assert.deepEqual(failed, { ok: false, reason: 'pet-hidden', message: '收起来了' });
});

test('surface 只认 web / desktop', () => {
  assert.equal(cleanSurfaceOf('web'), 'web');
  assert.equal(cleanSurfaceOf('desktop'), 'desktop');
  assert.equal(cleanSurfaceOf(null), null);
  assert.equal(cleanSurfaceOf('any'), null);
});

/** 走真实路由：/state 的 surface 续租 + POST /clean/open 的去向。 */
function routeHarness(displays: string[]) {
  const run = harness(displays);
  const { handlePetRoute } = createHttpRoute({
    ...(run.deps as unknown as Record<string, unknown>),
    clean: {},
  } as unknown as PetRouteDeps);
  return { ...run, call: (url: string, method = 'GET', body?: string) => handlePetRoute(url, method, body) };
}

test('路由：网页带 surface=web 轮询过 → POST /clean/open 开网页浮层', async () => {
  const run = routeHarness(['both']);
  try {
    const polled = await run.call('/jingsao-7341/state?surface=web');
    assert.equal(polled.kind === 'json' ? polled.status : 0, 200);
    const opened = await run.call('/jingsao-7341/clean/open', 'POST', '{}');
    assert.deepEqual(opened.kind === 'json' ? opened.obj : null, { ok: true, target: 'web' });
    assert.equal((run.state.read().sections.clean.data as { target: string }).target, 'web');
  } finally {
    run.dispose();
  }
});

test('路由：只有桌面带 surface=desktop 轮询过 → POST /clean/open 请桌面弹小窗', async () => {
  const run = routeHarness(['desktop']);
  try {
    await run.call('/jingsao-7341/state?surface=desktop');
    // 第三方不带 surface 的轮询不算任何一端在线
    await run.call('/jingsao-7341/state');
    const opened = await run.call('/jingsao-7341/clean/open', 'POST', '{}');
    assert.deepEqual(opened.kind === 'json' ? opened.obj : null, { ok: true, target: 'desktop' });
  } finally {
    run.dispose();
  }
});

test('路由：网页带 visible=0 轮询、桌面有宠物 → POST /clean/open 请桌面弹小窗', async () => {
  const run = routeHarness(['both']);
  try {
    await run.call('/jingsao-7341/state?surface=web&visible=0');
    await run.call('/jingsao-7341/state?surface=desktop');
    const opened = await run.call('/jingsao-7341/clean/open', 'POST', '{}');
    assert.deepEqual(opened.kind === 'json' ? opened.obj : null, { ok: true, target: 'desktop' });
  } finally {
    run.dispose();
  }
});

test('路由：全部收起且只有桌面 → POST /clean/open 回 pet-hidden', async () => {
  const run = routeHarness(['none']);
  try {
    await run.call('/jingsao-7341/state?surface=desktop');
    const opened = await run.call('/jingsao-7341/clean/open', 'POST', '{}');
    const obj = (opened.kind === 'json' ? opened.obj : {}) as { ok?: boolean; reason?: string };
    assert.equal(obj.ok, false);
    assert.equal(obj.reason, 'pet-hidden');
  } finally {
    run.dispose();
  }
});
