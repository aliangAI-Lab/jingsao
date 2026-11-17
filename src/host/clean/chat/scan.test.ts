/**
 * 微信QQ专清扫描：在 F 盘临时目录里造出微信 4.x / 旧版微信 / QQNT / 企业微信的目录结构，
 * 验证分类、数据库永不入列、时间筛选、链接不跟随。
 * @module jingsao/src/host/clean/chat/scan.test
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { locations } from '../safety.ts';
import { scanChatApps } from './scan.ts';

const base = join(process.env.JINGSAO_TMP ?? 'F:\\dev\\_cache\\tmp');
mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, 'chat-'));
after(() => rmSync(root, { recursive: true, force: true }));

const places = locations({ JINGSAO_TEST_ROOT: root });
const DAY = 86_400_000;

/** 造一个文件；ageDays 天前修改。 */
function put(path: string, bytes = 10, ageDays = 0): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes, 1));
  const t = new Date(Date.now() - ageDays * DAY);
  utimesSync(path, t, t);
  return path;
}

// 新版微信：数据根写在 xwechat 配置 ini 里（内容 = 父目录）
const wx4Parent = join(places.home, 'custom');
put(join(places.roaming, 'Tencent', 'xwechat', 'config', 'abc.ini'));
writeFileSync(join(places.roaming, 'Tencent', 'xwechat', 'config', 'abc.ini'), wx4Parent);
const wx4 = join(wx4Parent, 'xwechat_files', 'wxid_test_1234');
const wxCache = put(join(wx4, 'cache', '2026-07', 'a.bin'), 100, 40);
const wxImg = put(join(wx4, 'msg', 'attach', 'chat1', 'Img', 'p.dat'), 200, 40);
const wxNewImg = put(join(wx4, 'msg', 'attach', 'chat1', 'Img', 'new.dat'), 200, 1);
const wxFile = put(join(wx4, 'msg', 'file', '2026-07', 'doc.pdf'), 300, 40);
const wxDb = put(join(wx4, 'db_storage', 'message', 'message_0.db'), 999, 40);
const wxDbInScope = put(join(wx4, 'cache', 'index.db'), 50, 40);

// 旧版微信 3.x（默认在文档下）
const w3 = join(places.documents, 'WeChat Files', 'wxid_old', 'FileStorage');
const w3Thumb = put(join(w3, 'MsgAttach', 'abcd', 'Thumb', '2026-01', 't.dat'), 20, 40);
const w3Msg = put(join(places.documents, 'WeChat Files', 'wxid_old', 'Msg', 'MicroMsg.db'), 999, 40);

// QQNT
const qq = join(places.documents, 'Tencent Files', '123456789', 'nt_qq');
const qqPic = put(join(qq, 'nt_data', 'Pic', '2026-07', 'Ori', 'x.jpg'), 400, 40);
const qqDb = put(join(qq, 'nt_db', 'nt_msg.db'), 999, 40);

// 企业微信：微盘不碰
const ww = join(places.documents, 'WXWork', '1688850000000000');
const wwVideo = put(join(ww, 'Cache', 'Video', '2026-07', 'v.mp4'), 500, 40);
const wwDrive = put(join(ww, 'WeDrive', 'team', 'secret.xlsx'), 999, 40);

// 目录联接：指向外面的目录，扫描不能跟进去
const outside = put(join(root, 'outside', 'big.bin'), 777, 40);
symlinkSync(dirname(outside), join(wx4, 'cache', 'link'), 'junction');

test('按软件与种类归类，数据库、微盘、联接后面的文件都不入列', async () => {
  const { result, candidates } = await scanChatApps(places);
  const paths = new Set([...candidates.values()].map((c) => c.path));
  for (const p of [wxCache, wxImg, wxNewImg, wxFile, w3Thumb, qqPic, wwVideo]) assert.ok(paths.has(p), p);
  for (const p of [wxDb, wxDbInScope, w3Msg, qqDb, wwDrive, outside]) assert.ok(!paths.has(p), p);
  const byId = new Map(result.categories.map((c) => [c.id, c]));
  assert.equal(byId.get('wechat-image')?.count, 3); // 新版两张 + 旧版缩略图
  assert.equal(byId.get('wechat-file')?.tier, 'risky');
  assert.equal(byId.get('qq-image')?.group, 'QQ');
  assert.equal(byId.get('wxwork-video')?.bytes, 500);
  assert.equal(result.totalBytes, 100 + 200 + 200 + 300 + 20 + 400 + 500);
});

test('时间筛选：只要 N 天以前的文件', async () => {
  const { candidates } = await scanChatApps(places, { olderThanDays: 7 });
  const paths = new Set([...candidates.values()].map((c) => c.path));
  assert.ok(paths.has(wxImg));
  assert.ok(!paths.has(wxNewImg));
});

test('取消信号会中断扫描', async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(scanChatApps(places, { signal: abort.signal }));
});
