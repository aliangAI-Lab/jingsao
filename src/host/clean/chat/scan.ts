/**
 * 微信QQ专清的只读扫描：按 ./apps 给出的位置遍历文件，按「软件 × 文件种类」汇总成分类。
 *
 * 只读，不写任何文件；遇到符号链接、目录联接、多重硬链接一律跳过（微信 4.x 自己会用硬链接去重，
 * 动其中一份会影响另一份）。每个文件都过 denied（放行用户数据，但永久保护名单照旧生效），
 * 数据库类扩展名再兜一道。可按「多少天以前」筛选。
 * @module jingsao/src/host/clean/chat/scan
 */
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { denied, type CleanPlaces } from '../safety.ts';
import type { DeleteCandidate } from '../delete/types.ts';
import {
  MAX_ITEMS_PER_CATEGORY,
  type CleanCategory,
  type CleanItem,
  type CleanProgress,
  type CleanScanResult,
} from '../types.ts';
import { CHAT_KINDS, findChatAccounts, type ChatAccount, type ChatKind, type ChatSpot } from './apps.ts';

/** 数据库与索引文件：即使落在清单目录里也绝不碰。 */
const DATABASE_FILE = /\.(db|db-wal|db-shm|db-journal|sqlite|sqlite3|mmkv|ldb|log\.lock)$/i;

/** 每处理这么多个条目让出一次事件循环。 */
const YIELD_EVERY = 256;

/** 扫描参数。 */
export interface ChatScanOptions {
  signal?: AbortSignal;
  onProgress?: (p: CleanProgress) => void;
  /** 只要这么多天以前修改的文件；缺省 / 0 = 不限。 */
  olderThanDays?: number;
  /** 测试注入：替代自动发现的账号。 */
  accounts?: ChatAccount[];
  now?: () => number;
}

/** 分类累加器。 */
interface Bucket {
  category: CleanCategory;
  items: CleanItem[];
}

/** 让出事件循环。 */
const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** 稳定 id：同一路径每次扫描得到同一个 id，页面勾选在重新扫描后也对得上。 */
const idOf = (path: string): string => createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 20);

/** 扫描本机聊天软件的可清理文件。 */
export async function scanChatApps(
  places: CleanPlaces,
  options: ChatScanOptions = {},
): Promise<{ result: CleanScanResult; candidates: Map<string, DeleteCandidate> }> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const cutoff = options.olderThanDays ? startedAt - options.olderThanDays * 86_400_000 : Infinity;
  const accounts = options.accounts ?? findChatAccounts(places);
  const buckets = new Map<string, Bucket>();
  const candidates = new Map<string, DeleteCandidate>();
  const seen = new Set<string>();
  const progress: CleanProgress = { feature: 'chat', phase: 'scanning', files: 0, bytes: 0 };
  let ticks = 0;

  const report = (current?: string): void => {
    options.onProgress?.({ ...progress, ...(current ? { current } : {}) });
  };

  /** 一个文件落进分类。 */
  const add = (
    account: ChatAccount,
    kind: ChatKind,
    path: string,
    size: number,
    mtimeMs: number,
    ino: number,
    dev: number,
  ): void => {
    const key = path.toLowerCase();
    if (seen.has(key)) return; // 同一文件可能同时被两条位置覆盖（旧版微信 MsgAttach）
    seen.add(key);
    const categoryId = `${account.appId}-${kind}`;
    let bucket = buckets.get(categoryId);
    if (!bucket) {
      const info = CHAT_KINDS[kind];
      bucket = {
        category: {
          id: categoryId,
          label: info.label,
          tier: info.tier,
          explanation: info.explanation,
          bytes: 0,
          count: 0,
          items: [],
          group: account.app,
          // 「收发的文件」是用户自己的文件：默认不勾，勾了要就地确认
          defaultChecked: info.tier !== 'risky',
        },
        items: [],
      };
      buckets.set(categoryId, bucket);
    }
    const id = idOf(path);
    bucket.category.bytes += size;
    bucket.category.count += 1;
    bucket.items.push({ id, path, size, mtimeMs });
    candidates.set(id, { id, path, identity: { size, mtimeMs, ino, dev }, categoryId });
    progress.files += 1;
    progress.bytes += size;
  };

  /** 递归遍历一个目录（不跟随链接）。 */
  const walk = async (account: ChatAccount, kind: ChatKind, dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // 读不到（权限 / 正在被占用）就跳过，不报错
    }
    for (const entry of entries) {
      if (options.signal?.aborted) throw new Error('已取消');
      if (++ticks % YIELD_EVERY === 0) {
        report(dir);
        await pause();
      }
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(account, kind, path);
        continue;
      }
      if (!entry.isFile() || DATABASE_FILE.test(entry.name)) continue;
      if (denied(path, places, { allowUserData: true, allowOtherDrives: true })) continue;
      let stat;
      try {
        stat = await lstat(path);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0) continue;
      if (stat.mtimeMs > cutoff) continue;
      add(account, kind, path, stat.size, stat.mtimeMs, stat.ino, stat.dev);
    }
  };

  /** 一处位置：整棵，或只要各子目录下的某个同名目录。 */
  const visit = async (account: ChatAccount, spot: ChatSpot): Promise<void> => {
    if (denied(spot.dir, places, { allowUserData: true, allowOtherDrives: true })) return;
    if (!spot.childDir) return walk(account, spot.kind, spot.dir);
    let children;
    try {
      children = await readdir(spot.dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (child.isDirectory() && !child.isSymbolicLink()) {
        await walk(account, spot.kind, join(spot.dir, child.name, spot.childDir));
      }
    }
  };

  for (const account of accounts) {
    for (const spot of account.spots) {
      report(spot.dir);
      await visit(account, spot);
    }
  }

  // 分类顺序：按软件出现顺序，同一软件内按种类表顺序；每类只列最大的若干个。
  const kindOrder = Object.keys(CHAT_KINDS);
  const appOrder = [...new Set(accounts.map((a) => a.app))];
  const rank = (c: CleanCategory): number =>
    appOrder.indexOf(c.group ?? '') * 100 + kindOrder.indexOf(c.id.split('-').pop() ?? '');
  const categories = [...buckets.values()]
    .map((b) => {
      b.items.sort((a, z) => z.size - a.size);
      b.category.items = b.items.slice(0, MAX_ITEMS_PER_CATEGORY);
      return b.category;
    })
    .sort((a, z) => rank(a) - rank(z));
  const result: CleanScanResult = {
    feature: 'chat',
    scanId: `chat-${startedAt.toString(36)}`,
    startedAt,
    finishedAt: now(),
    categories,
    totalBytes: categories.reduce((sum, c) => sum + c.bytes, 0),
  };
  options.onProgress?.({ ...progress, phase: 'done' });
  return { result, candidates };
}
