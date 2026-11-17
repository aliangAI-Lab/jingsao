/**
 * 用户文件夹的只读遍历：大文件搬家与重复文件共用的「去哪找、哪些文件能碰」。
 *
 * 只负责列出候选文件与它们的身份，不负责分类汇总（归 ./scan 与 ../duplicates/scan）、
 * 不做任何写操作。规则来自拆解小番茄的教训：它把程序目录里的 exe 当安装包搬走、弄坏了软件，
 * 所以这里只进用户自己的文件夹，绕开 AppData、隐藏目录、聊天软件数据、开发环境目录，
 * 程序与库文件一律不列；安装包只认下载 / 桌面 / 文档里的。
 * 遍历不跟随任何链接或联接，分批让出事件循环，可随时取消。
 * @module jingsao/src/host/clean/bigfiles/walk
 */
import { lstat, readdir } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { denied, noLinks, within, STAGING_DIR_NAME, type CleanPlaces, type FileIdentity } from '../safety.ts';

/** 文件类型（分类与重复文件分组共用）。 */
export type FileType = 'installer' | 'archive' | 'video' | 'audio' | 'image' | 'document' | 'other';

/** 类型 → 给普通人看的名字。 */
export const FILE_TYPE_LABEL: Record<FileType, string> = {
  installer: '安装包',
  archive: '压缩包',
  video: '视频',
  audio: '音频',
  image: '图片',
  document: '办公文档',
  other: '其他',
};

const INSTALLER_EXT = new Set(['.exe', '.msi', '.msix', '.appx', '.msixbundle', '.appxbundle']);
const ARCHIVE_EXT = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.iso', '.img']);
const VIDEO_EXT = new Set([
  '.mp4',
  '.mkv',
  '.mov',
  '.avi',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.ts',
  '.mts',
  '.m2ts',
  '.rmvb',
]);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma', '.ape', '.opus']);
const IMAGE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.heic',
  '.tif',
  '.tiff',
  '.psd',
  '.raw',
  '.cr2',
  '.nef',
  '.arw',
  '.dng',
]);
const DOCUMENT_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.wps', '.et', '.dps']);

/** 程序与库文件：在哪都不列（搬走或删掉会弄坏软件）。安装包扩展名另算。 */
const PROGRAM_EXT = new Set([
  '.dll',
  '.sys',
  '.drv',
  '.ocx',
  '.cpl',
  '.node',
  '.com',
  '.scr',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.lnk',
  '.pyd',
  '.so',
  '.jar',
]);

/** 安装包只认这三个用户文件夹（用户主目录下的一级目录名，小写）。 */
const INSTALLER_HOMES = ['downloads', 'desktop', 'documents'];

/**
 * 遍历时整棵跳过的目录名（小写，任何层级）：系统 / 程序数据、聊天软件数据（归微信QQ专清）、
 * 开发环境与包管理目录（里面的大文件是程序的一部分）。
 */
const SKIP_DIR_NAMES = new Set([
  'appdata',
  'application data',
  'local settings',
  'node_modules',
  '$recycle.bin',
  'wechat files',
  'xwechat_files',
  'tencent files',
  'wxwork',
  'nt_qq',
  'anaconda3',
  'miniconda3',
  'miniforge3',
  'mambaforge',
  'scoop',
  'go',
  'site-packages',
  'venv',
  STAGING_DIR_NAME,
]);

/** 目录名是否整棵跳过：隐藏（. 开头）、跳过名单、OneDrive 同步目录（读文件会触发下载）、本插件的备份。 */
export function skipDirName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('.') ||
    SKIP_DIR_NAMES.has(lower) ||
    lower.startsWith('onedrive') ||
    lower.endsWith('.jingsao-bak') ||
    lower.endsWith('.jingsao-restore')
  );
}

/**
 * 判定文件类型；返回 null = 程序或库文件（不碰）。
 * 安装包扩展名只在下载 / 桌面 / 文档里算安装包，别处一律当程序文件。
 */
export function classifyFile(path: string, places: CleanPlaces): FileType | null {
  const ext = extname(path).toLowerCase();
  if (PROGRAM_EXT.has(ext)) return null;
  if (INSTALLER_EXT.has(ext)) {
    return INSTALLER_HOMES.some((name) => within(join(places.home, name), path)) ? 'installer' : null;
  }
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (DOCUMENT_EXT.has(ext)) return 'document';
  return 'other';
}

/** 默认扫描根：用户主目录下所有非隐藏、非链接、不在跳过名单里的一级目录（桌面、下载、文档……都在其中）。 */
export async function defaultUserRoots(places: CleanPlaces): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(places.home, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !skipDirName(entry.name))
    .map((entry) => join(places.home, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

/** 遍历到的一个候选文件。 */
export interface WalkedFile {
  path: string;
  type: FileType;
  identity: FileIdentity;
}

/** 遍历选项。 */
export interface WalkOptions {
  /** 只要不小于这个字节数的文件。 */
  minSize: number;
  signal?: AbortSignal;
  /** 允许 places.drive 以外的盘（重复文件扫别的盘时打开）。 */
  allowOtherDrives?: boolean;
  /** 每看完一个目录回调一次（进度用）。 */
  onDir?: (dir: string, seenFiles: number) => void;
}

/** 一次 lstat 并发多少个文件。 */
const STAT_BATCH = 64;
/** 每处理这么多目录项让出一次事件循环。 */
const YIELD_EVERY = 400;

/** 把扫描根规整成可用的目录：去重、去掉嵌套、过安全闸。 */
function usableRoots(roots: string[], places: CleanPlaces, options: WalkOptions): string[] {
  const unique: string[] = [];
  for (const root of roots) {
    if (denied(root, places, { allowUserData: true, allowOtherDrives: options.allowOtherDrives })) continue;
    if (parse(root).root === root) continue;
    try {
      noLinks(root);
    } catch {
      continue;
    }
    if (unique.some((kept) => within(kept, root))) continue;
    for (let i = unique.length - 1; i >= 0; i -= 1) if (within(root, unique[i]!)) unique.splice(i, 1);
    unique.push(root);
  }
  return unique;
}

/**
 * 只读遍历：对每个符合条件的普通文件（单一硬链接、不小于 minSize、不是程序文件、过安全闸）调用 visit。
 * 读不了的目录静默跳过；取消时抛出 signal 的原因。
 *
 * @returns 看过的文件总数（含不符合条件的）。
 */
export async function walkUserFiles(
  roots: string[],
  places: CleanPlaces,
  options: WalkOptions,
  visit: (file: WalkedFile) => void,
): Promise<number> {
  const { signal } = options;
  const stack = usableRoots(roots, places, options).reverse();
  let seen = 0;
  let sinceYield = 0;
  while (stack.length > 0) {
    signal?.throwIfAborted();
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const files: string[] = [];
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirName(entry.name)) subdirs.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
    for (let i = 0; i < files.length; i += STAT_BATCH) {
      signal?.throwIfAborted();
      const batch = files.slice(i, i + STAT_BATCH);
      const stats = await Promise.all(batch.map((file) => lstat(file).catch(() => null)));
      batch.forEach((file, index) => {
        const stat = stats[index];
        if (!stat || !stat.isFile() || stat.nlink !== 1 || stat.size < options.minSize) return;
        const type = classifyFile(file, places);
        if (!type) return;
        if (denied(file, places, { allowUserData: true, allowOtherDrives: options.allowOtherDrives })) return;
        visit({ path: file, type, identity: { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev } });
      });
    }
    seen += files.length;
    sinceYield += entries.length;
    // 子目录逆序入栈，保证按字母顺序深度优先，结果稳定。
    for (const sub of subdirs.sort((a, b) => b.localeCompare(a))) {
      if (!denied(sub, places, { allowUserData: true, allowOtherDrives: options.allowOtherDrives })) stack.push(sub);
    }
    options.onDir?.(dir, seen);
    if (sinceYield >= YIELD_EVERY) {
      sinceYield = 0;
      await yieldLoop();
    }
  }
  return seen;
}

/** 字节数 → 「1.5 GB」这样的可读文字。 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
