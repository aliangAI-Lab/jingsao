import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDesktopAuth, type DesktopSession } from './desktop-auth.ts';

test('only the local main renderer receives the capability, scoped to the API origin', () => {
  let listener: Parameters<DesktopSession['webRequest']['onBeforeSendHeaders']>[0] | undefined;
  const rendererPath = resolve('runtime/electron-helper/index.html');
  const renderer = pathToFileURL(rendererPath).href;
  installDesktopAuth(
    {
      webRequest: {
        onBeforeSendHeaders(fn) {
          listener = fn;
        },
      },
    },
    'http://127.0.0.1:3080',
    rendererPath,
    'private-token',
  );
  assert.ok(listener);
  const send = (url: string, frame?: { url: string; parent: unknown } | null) => {
    let result: Record<string, string> = {};
    listener!(
      { url, frame, requestHeaders: { 'content-type': 'application/json', 'x-jingsao-token': 'stale-token' } },
      (response) => {
        result = response.requestHeaders;
      },
    );
    return result;
  };
  const endpoint = 'http://127.0.0.1:3080/jingsao-7341/chat';
  const ownFrame = { url: renderer + '?petIndex=0', parent: null };
  assert.equal(send(endpoint, ownFrame)['X-Jingsao-Token'], 'private-token');
  for (const frame of [
    undefined,
    null,
    { url: 'about:srcdoc', parent: {} },
    { url: renderer, parent: {} },
    { url: 'https://example.invalid/', parent: null },
    { url: renderer + '.other', parent: null },
  ]) {
    const headers = send(endpoint, frame);
    assert.equal(
      Object.keys(headers).some((name) => name.toLowerCase() === 'x-jingsao-token'),
      false,
    );
    assert.equal(headers['content-type'], 'application/json');
  }
  for (const url of [
    'http://127.0.0.1:3081/jingsao-7341/chat',
    'http://localhost:3080/jingsao-7341/chat',
    'https://example.invalid/jingsao-7341/chat',
    'http://127.0.0.1:3080/standalone-ai/settings',
    'invalid-url',
  ]) {
    assert.equal(send(url, ownFrame)['X-Jingsao-Token'], undefined);
  }
});

test('清理小窗与宠物窗口同一枚令牌：导航到 /clean/page 与这一页发出的插件请求带令牌，别的页面不带', () => {
  let listener: Parameters<DesktopSession['webRequest']['onBeforeSendHeaders']>[0] | undefined;
  installDesktopAuth(
    {
      webRequest: {
        onBeforeSendHeaders(fn) {
          listener = fn;
        },
      },
    },
    'http://127.0.0.1:3080',
    resolve('runtime/electron-helper/index.html'),
    'private-token',
  );
  const send = (url: string, frame: { url: string; parent: unknown } | null | undefined, resourceType?: string) => {
    let result: Record<string, string> = {};
    listener!({ url, frame, resourceType, requestHeaders: {} }, (response) => {
      result = response.requestHeaders;
    });
    return result['X-Jingsao-Token'];
  };
  const page = 'http://127.0.0.1:3080/jingsao-7341/clean/page';
  // 新窗口首次导航：frame 还是空页（url 为空串），按导航目标认
  assert.equal(send(page, { url: '', parent: null }, 'mainFrame'), 'private-token');
  assert.equal(send(page, undefined, 'mainFrame'), 'private-token');
  // 这一页里的脚本与接口请求
  const ownPage = { url: page, parent: null };
  assert.equal(send('http://127.0.0.1:3080/jingsao-7341/clean/page.js', ownPage, 'script'), 'private-token');
  assert.equal(send('http://127.0.0.1:3080/jingsao-7341/clean/stage', ownPage, 'xhr'), 'private-token');
  // 别的导航、别的页面、子框架、别的 origin 一律不带
  assert.equal(send('http://127.0.0.1:3080/jingsao-7341/config', { url: '', parent: null }, 'mainFrame'), undefined);
  assert.equal(
    send('http://127.0.0.1:3080/jingsao-7341/clean/stage', { url: page + '/x', parent: null }, 'xhr'),
    undefined,
  );
  assert.equal(send('http://127.0.0.1:3080/jingsao-7341/clean/stage', { url: page, parent: {} }, 'xhr'), undefined);
  assert.equal(
    send(
      'http://127.0.0.1:3080/jingsao-7341/clean/stage',
      { url: 'http://127.0.0.1:3081/jingsao-7341/clean/page', parent: null },
      'xhr',
    ),
    undefined,
  );
  assert.equal(send('http://127.0.0.1:3081/jingsao-7341/clean/page', undefined, 'mainFrame'), undefined);
});
