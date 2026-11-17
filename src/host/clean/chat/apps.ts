/**
 * 微信QQ专清的「去哪找」：按软件定位数据根目录与账号目录，再给出每个账号下各类文件的相对路径。
 *
 * 只认缓存、图片、视频、收发文件、表情、日志这几类目录；聊天记录数据库（db_storage、nt_db、Msg、Data）、
 * 收藏、备份、企业微信微盘一律不在清单里，扫描器也就永远走不进去。
 * 路径依据：拆解本机已装的小番茄C盘清理里写死的目录（旧版微信 FileStorage、QQNT nt_data、企业微信 Cache），
 * 新版微信 4.x 的 xwechat_files 结构以本机实际目录为准（小番茄不认识这个版本）。
 * @module jingsao/src/host/clean/chat/apps
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CleanPlaces } from '../safety.ts';
import type { CleanTier } from '../types.ts';

/** 文件种类：决定档位、文案与默认勾选。 */
export type ChatKind = 'cache' | 'image' | 'video' | 'emoji' | 'file';

/** 每种文件的展示信息。 */
export const CHAT_KINDS: Record<ChatKind, { label: string; tier: CleanTier; explanation: string }> = {
  cache: {
    label: '缓存和临时文件',
    tier: 'safe',
    explanation: '软件自己的缓存、日志和临时文件，删了会自动重建，不影响聊天记录。',
  },
  image: {
    label: '聊天图片',
    tier: 'cost',
    explanation: '聊天里收发过的图片原图和缩略图。清掉后旧聊天里的图片要重新下载，太久的可能已经过期下不回来。',
  },
  video: {
    label: '聊天视频',
    tier: 'cost',
    explanation: '聊天里收发过的视频。清掉后旧视频要重新下载，太久的可能已经过期。',
  },
  emoji: {
    label: '表情包和头像缓存',
    tier: 'cost',
    explanation: '下载过的表情和头像图片，用到时会重新下载。',
  },
  file: {
    label: '收发的文件',
    tier: 'risky',
    explanation: '别人发给你或你发出去的文档、压缩包等。清掉后聊天里就点不开了，重要的请先另存。默认不勾。',
  },
};

/** 一个账号目录下的一类文件位置。 */
export interface ChatSpot {
  /** 绝对路径（目录）。 */
  dir: string;
  kind: ChatKind;
  /** 只要这一层下面子目录里叫这个名字的目录（例如旧版微信 MsgAttach/<会话>/Image）；缺省 = dir 整棵。 */
  childDir?: string;
}

/** 一个软件的一个账号。 */
export interface ChatAccount {
  /** 软件展示名，例如「微信」。 */
  app: string;
  /** 软件 id（分类 id 前缀）。 */
  appId: string;
  /** 账号目录绝对路径。 */
  root: string;
  spots: ChatSpot[];
}

/** 列子目录名；读不到返回空。 */
function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 目录存在且是目录。 */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 读一个小配置文件的文本（去掉首尾空白与 BOM）；读不到返回空串。 */
function readSmall(file: string): string {
  try {
    return readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim();
  } catch {
    return '';
  }
}

/** 按「账号目录 + 相对路径 → 种类」的表展开，只留存在的目录。 */
function spotsOf(root: string, table: Array<[string, ChatKind, string?]>): ChatSpot[] {
  const out: ChatSpot[] = [];
  for (const [rel, kind, childDir] of table) {
    const dir = join(root, ...rel.split('/'));
    if (isDir(dir)) out.push({ dir, kind, ...(childDir ? { childDir } : {}) });
  }
  return out;
}

/** 新版微信 4.x：数据根写在 %APPDATA%\Tencent\xwechat\config\*.ini（内容是父目录），缺省在文档下。 */
function wechat4Roots(places: CleanPlaces): string[] {
  const roots = new Set<string>([join(places.documents, 'xwechat_files')]);
  const configDir = join(places.roaming, 'Tencent', 'xwechat', 'config');
  for (const name of subdirsAndFiles(configDir)) {
    if (!name.toLowerCase().endsWith('.ini')) continue;
    const text = readSmall(join(configDir, name));
    if (text && !text.includes('\n') && isDir(text)) roots.add(join(text, 'xwechat_files'));
  }
  return [...roots].map((r) => resolve(r)).filter(isDir);
}

/** 列目录下全部条目名（文件与目录）。 */
function subdirsAndFiles(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** 旧版微信 3.x：数据根由 %APPDATA%\Tencent\WeChat\All Users\config\3ebffe94.ini 决定（MyDocument: = 文档）。 */
function wechat3Root(places: CleanPlaces): string | null {
  const text = readSmall(join(places.roaming, 'Tencent', 'WeChat', 'All Users', 'config', '3ebffe94.ini'));
  const parent = !text || text.startsWith('MyDocument:') ? places.documents : text;
  const root = join(parent, 'WeChat Files');
  return isDir(root) ? root : null;
}

/** 找出本机所有聊天软件账号与可清理位置。 */
export function findChatAccounts(places: CleanPlaces): ChatAccount[] {
  const out: ChatAccount[] = [];

  // 新版微信 4.x：<根>\<wxid_xxx>\{cache,temp,msg\attach,msg\video,msg\file,business\...}
  for (const root of wechat4Roots(places)) {
    for (const name of subdirs(root)) {
      const acc = join(root, name);
      if (!isDir(join(acc, 'msg')) && !isDir(join(acc, 'db_storage'))) continue;
      out.push({
        app: '微信',
        appId: 'wechat',
        root: acc,
        spots: spotsOf(acc, [
          ['cache', 'cache'],
          ['temp', 'cache'],
          ['business/sns', 'cache'],
          ['msg/attach', 'image'],
          ['msg/video', 'video'],
          ['business/emoticon', 'emoji'],
          ['msg/file', 'file'],
        ]),
      });
    }
  }

  // 旧版微信 3.x：<根>\<wxid>\FileStorage\...
  const w3 = wechat3Root(places);
  if (w3) {
    for (const name of subdirs(w3)) {
      const fs = join(w3, name, 'FileStorage');
      if (!isDir(fs)) continue;
      out.push({
        app: '微信',
        appId: 'wechat',
        root: join(w3, name),
        spots: spotsOf(fs, [
          ['Cache', 'cache'],
          ['Sns/Cache', 'cache'],
          ['Image', 'image'],
          ['MsgAttach', 'image', 'Image'],
          ['MsgAttach', 'image', 'Thumb'],
          ['Video', 'video'],
          ['MsgAttach', 'video', 'Video'],
          ['CustomEmotion', 'emoji'],
          ['File', 'file'],
          ['MsgAttach', 'file', 'File'],
        ]),
      });
    }
  }

  // QQ（QQNT）：文档\Tencent Files\<QQ号>\nt_qq\{nt_data\...,nt_temp}；旧版 QQ 的 Image / FileRecv / Video 一并认
  const tencent = join(places.documents, 'Tencent Files');
  for (const name of subdirs(tencent)) {
    if (!/^\d{5,}$/.test(name)) continue;
    const acc = join(tencent, name);
    const nt = join(acc, 'nt_qq');
    const spots = spotsOf(acc, [
      ['nt_qq/nt_temp', 'cache'],
      ['nt_qq/nt_data/log', 'cache'],
      ['nt_qq/nt_data/log-cache', 'cache'],
      ['nt_qq/nt_data/Pic', 'image'],
      ['nt_qq/nt_data/PhotoWall', 'image'],
      ['Image', 'image'],
      ['nt_qq/nt_data/Video', 'video'],
      ['Video', 'video'],
      ['nt_qq/nt_data/Emoji', 'emoji'],
      ['nt_qq/nt_data/avatar', 'emoji'],
      ['nt_qq/nt_data/File', 'file'],
      ['FileRecv', 'file'],
    ]);
    if (spots.length || isDir(nt)) out.push({ app: 'QQ', appId: 'qq', root: acc, spots });
  }

  // 企业微信：文档\WXWork\<账号>\{Cache\*,Emotion,Avator,WXWorkCefCache\*}，以及 WXWork\Global 的公共缓存。
  // WeDrive（微盘）、Data（数据库）、Backup（备份）不在表里。
  const wxwork = join(places.documents, 'WXWork');
  for (const name of subdirs(wxwork)) {
    const acc = join(wxwork, name);
    if (/^\d{6,}$/.test(name)) {
      out.push({
        app: '企业微信',
        appId: 'wxwork',
        root: acc,
        spots: spotsOf(acc, [
          ['WXWorkCefCache/Cache', 'cache'],
          ['WXWorkCefCache/Code Cache', 'cache'],
          ['WXWorkCefCache/GPUCache', 'cache'],
          ['WXWorkCefCache/DawnCache', 'cache'],
          ['Cache/Image', 'image'],
          ['Cache/Video', 'video'],
          ['Emotion', 'emoji'],
          ['Avator', 'emoji'],
          ['Cache/File', 'file'],
        ]),
      });
    } else if (name === 'Global') {
      out.push({
        app: '企业微信',
        appId: 'wxwork',
        root: acc,
        spots: spotsOf(acc, [
          ['CefCache', 'cache'],
          ['TempFile', 'cache'],
          ['CDN', 'cache'],
          ['Image', 'image'],
        ]),
      });
    }
  }

  return out.filter((a) => a.spots.length > 0 && existsSync(a.root));
}
