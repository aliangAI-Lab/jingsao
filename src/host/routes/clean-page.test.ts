/** 桌面清理小窗的独立页：GET /clean/page（HTML 壳）与 GET /clean/page.js（有产物 / 缺产物 404 / 内容类型）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLEAN_PAGE_CLOSE_ID, CLEAN_PAGE_ROOT_ID, CLEAN_PAGE_TITLE, cleanPageResource } from './clean-page.ts';
import { createHttpRoute } from '../plugin/http-route.ts';
import { toBridgeResponse } from '../plugin/desktop/bridge-response.ts';
import type { PetRouteDeps } from './types.ts';

/** 带或不带 lib/clean-page.js 的临时包根。 */
function packageRoot(withScript: boolean): { root: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'jingsao-clean-page-'));
  if (withScript) {
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'clean-page.js'), 'console.log("clean-page");');
  }
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test('GET /clean/page：HTML 壳带主题、面板样式、标题栏、挂载点和相对脚本引用', () => {
  const page = cleanPageResource('page');
  assert.ok(page && page.kind === 'text');
  assert.equal(page.status, 200);
  assert.equal(page.contentType, 'text/html; charset=utf-8');
  const html = page.body;
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes(`<title>${CLEAN_PAGE_TITLE}</title>`));
  // 基准定到挂载根：bridge 协议、HTTP 直连与带前缀的反代都按同源解析
  assert.ok(html.includes('<base href="../../">'));
  assert.ok(html.includes('<script src="jingsao-7341/clean/page.js"></script>'));
  assert.ok(html.includes(`id="${CLEAN_PAGE_ROOT_ID}"`));
  assert.ok(html.includes(`id="${CLEAN_PAGE_CLOSE_ID}"`));
  assert.ok(html.includes('js-clean-titlebar'));
  // 深浅两套配色跟随系统；面板样式整份内联
  assert.ok(html.includes('prefers-color-scheme:dark'));
  assert.ok(html.includes('.js-clean-cat{'));
});

test('GET /clean/page.js：有产物 → 200 + JavaScript 内容类型，内容原样返回', () => {
  const pkg = packageRoot(true);
  try {
    const js = cleanPageResource('page.js', pkg.root);
    assert.ok(js && js.kind === 'text');
    assert.equal(js.status, 200);
    assert.equal(js.contentType, 'text/javascript; charset=utf-8');
    assert.equal(js.body, 'console.log("clean-page");');
  } finally {
    pkg.dispose();
  }
});

test('GET /clean/page.js：缺产物 → 404 文本，不回空脚本', () => {
  const pkg = packageRoot(false);
  try {
    const js = cleanPageResource('page.js', pkg.root);
    assert.ok(js && js.kind === 'text');
    assert.equal(js.status, 404);
    assert.equal(js.contentType, undefined, '错误文案走默认的 text/plain');
    assert.ok(js.body.length > 0);
  } finally {
    pkg.dispose();
  }
});

test('其它 action 不归独立页管', () => {
  assert.equal(cleanPageResource('status'), undefined);
  assert.equal(cleanPageResource('page.css'), undefined);
});

test('经插件路由：GET /jingsao-7341/clean/page 命中，POST 不接受', async () => {
  const { handlePetRoute } = createHttpRoute({ clean: {} } as unknown as PetRouteDeps);
  const page = await handlePetRoute('/jingsao-7341/clean/page', 'GET', undefined);
  assert.equal(page.kind, 'text');
  assert.equal(page.kind === 'text' ? page.contentType : '', 'text/html; charset=utf-8');
  const js = await handlePetRoute('/jingsao-7341/clean/page.js', 'GET', undefined);
  assert.equal(js.kind, 'text');
  // 产物是否已构建取决于本地有没有跑过 build：两种结果都必须是明确的 200 脚本或 404
  if (js.kind === 'text' && js.status === 200) assert.equal(js.contentType, 'text/javascript; charset=utf-8');
  else assert.equal(js.kind === 'text' ? js.status : 0, 404);
  const post = await handlePetRoute('/jingsao-7341/clean/page', 'POST', '{}');
  assert.notEqual(post.kind === 'text' ? post.contentType : undefined, 'text/html; charset=utf-8');
});

test('bridge 应答保留路由给的内容类型（桌面小窗经 jingsao-bridge 加载同一页）', () => {
  const page = cleanPageResource('page');
  assert.ok(page);
  const resp = toBridgeResponse(7, page);
  assert.equal(resp.status, 200);
  assert.equal(resp.contentType, 'text/html; charset=utf-8');
  const plain = toBridgeResponse(8, { kind: 'text', status: 404, body: 'x' });
  assert.match(String(plain.contentType), /^text\/plain/);
});
