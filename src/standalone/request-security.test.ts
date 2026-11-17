import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequestSecurity } from './request-security.ts';

function request(headers: Record<string, string> = {}, url = '/private', method = 'GET'): IncomingMessage {
  return {
    headers: { host: '127.0.0.1:3080', ...headers },
    socket: { localPort: 3080 },
    method,
    url,
  } as IncomingMessage;
}
function response() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = String(value);
    },
    end() {},
  };
}
test('capabilities are random, fragment-only, and process-bound', () => {
  const a = createRequestSecurity();
  const b = createRequestSecurity();
  assert.notEqual(a.token, b.token);
  const url = new URL(a.authenticatedUrl('http://127.0.0.1:3080/jingsao'));
  assert.equal(url.pathname, '/standalone-ai/');
  assert.equal(url.search, '');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), a.token);
  assert.throws(() => a.authenticatedUrl('https://evil.test/'));
});

test('encoded private routes still require a capability; invalid encodings fail explicitly', () => {
  const security = createRequestSecurity();
  for (const path of [
    '/jingsao-7341/%63hat?pet=main',
    '/jingsao-7341/ch%61t',
    '/jingsao-7341/chat%2Fhistory',
    '/jingsao-7341/%77hisper',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const res = response();
      assert.equal(security.authorize(request({}, path, method), res as unknown as ServerResponse), false);
      assert.equal(res.status, 403);
      assert.equal(
        security.authorize(
          request({ 'x-jingsao-token': security.token }, path, method),
          response() as unknown as ServerResponse,
        ),
        true,
      );
    }
  }
  for (const method of ['GET', 'POST']) {
    const res = response();
    assert.equal(
      security.authorize(
        request({ 'x-jingsao-token': security.token }, '/jingsao-7341/%ZZ', method),
        res as unknown as ServerResponse,
      ),
      false,
    );
    assert.equal(res.status, 400);
  }
  assert.equal(
    security.authorize(request({}, '/jingsao-7341/thumb/main/%E7%9C%8B.webm'), response() as unknown as ServerResponse),
    true,
  );
});

test('desktop file-origin exception always needs a capability and never relaxes Host checks', () => {
  const security = createRequestSecurity();
  const fileHeaders = { origin: 'null', 'sec-fetch-site': 'cross-site' };
  for (const path of ['/jingsao-7341/config', '/jingsao-7341/chat']) {
    assert.equal(security.authorize(request(fileHeaders, path), response() as unknown as ServerResponse, true), false);
    const headers = { ...fileHeaders, 'x-jingsao-token': security.token };
    assert.equal(security.authorize(request(headers, path), response() as unknown as ServerResponse, true), true);
    assert.equal(security.authorize(request(headers, path), response() as unknown as ServerResponse), false);
    assert.equal(
      security.authorize(
        request({ ...headers, host: 'evil.test:3080' }, path),
        response() as unknown as ServerResponse,
        true,
      ),
      false,
    );
    assert.equal(
      security.authorize(
        request({ ...headers, origin: 'https://evil.test' }, path),
        response() as unknown as ServerResponse,
        true,
      ),
      false,
    );
  }
});
test('all private reads and mutations need the header, never a query capability', () => {
  const security = createRequestSecurity();
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    for (const token of ['', 'wrong']) {
      const res = response();
      assert.equal(
        security.authorize(
          request({ 'x-jingsao-token': token }, '/private?token=' + security.token, method),
          res as unknown as ServerResponse,
        ),
        false,
      );
      assert.equal(res.status, 403);
    }
    assert.equal(
      security.authorize(
        request({ 'x-jingsao-token': security.token }, '/private', method),
        response() as unknown as ServerResponse,
      ),
      true,
    );
  }
});
test('DNS rebinding, null/foreign origins, wrong ports and cross-site fetches fail before auth', () => {
  const security = createRequestSecurity();
  const headersList: Array<Record<string, string>> = [
    { host: 'evil.test:3080' },
    { host: '127.0.0.1:9999' },
    { host: '' },
    { host: '127.0.0.1:3080.evil.test' },
    { origin: 'null' },
    { origin: 'http://evil.test' },
    { origin: 'http://localhost:3080' },
    { 'sec-fetch-site': 'cross-site' },
  ];
  for (const headers of headersList) {
    const res = response();
    assert.equal(
      security.authorize(request({ ...headers, 'x-jingsao-token': security.token }), res as unknown as ServerResponse),
      false,
      JSON.stringify(headers),
    );
  }
  assert.equal(
    security.authorize(
      request({ origin: 'http://127.0.0.1:3080', 'x-jingsao-token': security.token }),
      response() as unknown as ServerResponse,
    ),
    true,
  );
});
test('only minimal health, settings shell and known media GET are public; public routes still check origin/host', () => {
  const security = createRequestSecurity();
  for (const path of [
    '/',
    '/health',
    '/standalone-ai/',
    '/standalone-ai/settings.js',
    '/jingsao-7341/thumb/main/idle.webm',
    '/jingsao-7341/pic/example.png',
  ]) {
    assert.equal(security.authorize(request({}, path), response() as unknown as ServerResponse), true, path);
    assert.equal(
      security.authorize(request({ origin: 'null' }, path), response() as unknown as ServerResponse),
      false,
      path,
    );
    assert.equal(security.authorize(request({}, path, 'POST'), response() as unknown as ServerResponse), false, path);
  }
  for (const path of ['/standalone-ai/settings', '/jingsao-7341/whisper', '/jingsao-7341/chat', '/shutdown']) {
    assert.equal(security.authorize(request({}, path), response() as unknown as ServerResponse), false, path);
  }
  for (const path of ['/jingsao-7341/config', '/jingsao-7341/state']) {
    assert.equal(security.authorize(request({}, path), response() as unknown as ServerResponse), true, path);
    assert.equal(
      security.authorize(request({ origin: 'http://evil.test' }, path), response() as unknown as ServerResponse),
      false,
      path,
    );
  }
});

test('首次头部认证后换取会话 cookie，刷新时凭 cookie 继续，且不重复下发', () => {
  const security = createRequestSecurity();

  const first = response();
  assert.equal(
    security.authorize(request({ 'x-jingsao-token': security.token }), first as unknown as ServerResponse),
    true,
  );
  const cookie = first.headers['set-cookie'] ?? '';
  assert.match(cookie, /^jingsao_token=[^;]+; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.equal(cookie.includes(security.token), true);
  assert.equal(cookie.includes('Max-Age'), false, '会话 cookie 不该带 Max-Age');

  // 刷新：地址栏里的令牌已被清掉，只剩 cookie，且它可能夹在别的 cookie 中间。
  const refreshed = response();
  assert.equal(
    security.authorize(
      request({ cookie: `other=1; jingsao_token=${security.token}; tail=2` }),
      refreshed as unknown as ServerResponse,
    ),
    true,
  );
  assert.equal(refreshed.headers['set-cookie'], undefined, '已有 cookie 时不该再下发');
});

test('cookie 必须是本进程令牌：别的进程的值、错形状与空值一律拒绝', () => {
  const security = createRequestSecurity();
  const foreign = createRequestSecurity();
  for (const cookie of [`jingsao_token=${foreign.token}`, 'jingsao_token=short', 'jingsao_token=', 'jingsao_token']) {
    const res = response();
    assert.equal(security.authorize(request({ cookie }), res as unknown as ServerResponse), false, cookie);
    assert.equal(res.status, 403);
  }
});
