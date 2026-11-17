/**
 * 软件搬家的列表：哪些已安装软件在系统盘上、各占多少、能不能搬、为什么不能搬。
 *
 * 只读；不负责搬（归 ./mover）。判定写成给普通人看的中文原因。宁可多拦：
 * 系统组件、驱动、运行库、杀毒软件、浏览器内核、有 Windows 服务的、已经是联接的、系统目录里的一律不让搬；
 * 不到 50MB 的不值得搬。大小用只读遍历统计，可取消，单个软件有统计时限（超时给下限）。
 * @module jingsao/src/host/clean/software/list
 */
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { CleanProgress, SoftwareEntry } from '../types.ts';
import { denied, noLinks, within, type CleanPlaces } from '../safety.ts';
import type { InstalledApp, SoftwareProbe } from './probe.ts';
import { scanTree } from './tree.ts';

/** 小于这个大小的软件不值得搬。 */
export const SOFTWARE_MIN_SIZE = 50 * 1024 * 1024;

/** 单个软件统计大小的默认时限（毫秒）。 */
export const SIZE_TIMEOUT_MS = 5_000;

/** 列表选项。 */
export interface ListSoftwareOptions {
  signal?: AbortSignal;
  onProgress?: (p: CleanProgress) => void;
  /** 单个软件统计大小的时限；默认 5 秒。 */
  sizeTimeoutMs?: number;
}

/** 关键词表：命中即视为驱动 / 运行库 / 系统组件 / 安全软件，不让搬。匹配软件名 + 发布者 + 目录（小写）。 */
const RISKY_PATTERNS: Array<{ pattern: RegExp; kind: string }> = [
  { pattern: /nvidia|geforce|physx/, kind: '显卡驱动' },
  { pattern: /\bintel(\(r\))?(\s|$|®)|intel corporation/, kind: '硬件驱动' },
  { pattern: /\bamd\b|advanced micro devices|radeon/, kind: '硬件驱动' },
  {
    pattern:
      /realtek|synaptics|elan |conexant|dolby|\bdts\b|waves maxxaudio|\basus\b|armoury|lenovo vantage|dell supportassist|hp support/,
    kind: '硬件驱动或厂商工具',
  },
  { pattern: /driver|驱动|chipset|芯片组|firmware|固件/, kind: '驱动' },
  {
    pattern:
      /visual c\+\+|vc_?redist|redistributable|runtime|运行库|运行时|directx|\.net (framework|runtime|desktop|sdk|core)|microsoft \.net|asp\.net/,
    kind: '运行库',
  },
  {
    pattern:
      /windows (sdk|kits|software development kit|subsystem|driver kit|app certification)|windows kits|wsl\b|hyper-v|update health|windows pc health|microsoft update/,
    kind: 'Windows 组件',
  },
  { pattern: /microsoft edge|edgewebview|webview2|edgeupdate/, kind: '浏览器内核' },
  { pattern: /microsoft office|clicktorun|microsoft 365|onedrive|teams machine-wide/, kind: '系统集成的微软软件' },
  {
    pattern:
      /defender|antivirus|anti-virus|杀毒|安全卫士|电脑管家|火绒|huorong|360(safe|sd|安全| total)|kaspersky|mcafee|norton|symantec|avast|\bavg\b|\beset\b|bitdefender|trend micro|sophos|malwarebytes|qqpcmgr|金山毒霸|anticheat|anti-cheat|easyanticheat|battleye|\bace\b|sguard/,
    kind: '安全或反作弊软件',
  },
  { pattern: /vmware|virtualbox|vpn|wireguard|openvpn|tap-windows|npcap|winpcap/, kind: '带驱动的网络或虚拟化软件' },
];

/** 命中的关键词类别；没命中返回 null。 */
export function riskyKind(name: string, publisher: string | undefined, dir: string): string | null {
  const text = `${name} | ${publisher ?? ''} | ${basename(dir)}`.toLowerCase();
  return RISKY_PATTERNS.find((item) => item.pattern.test(text))?.kind ?? null;
}

/** 安装目录 → 稳定的软件 id（同一目录每次扫描都一样）。 */
export function softwareId(dir: string): string {
  return 'sw-' + createHash('sha1').update(resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
}

/** 太浅的目录（盘根、Program Files 本身、用户目录本身……）：不当成某个软件的目录。 */
function tooShallow(dir: string, places: CleanPlaces): boolean {
  const shallow = [
    places.drive,
    join(places.drive, 'Program Files'),
    join(places.drive, 'Program Files (x86)'),
    join(places.drive, 'Program Files', 'Common Files'),
    join(places.drive, 'Program Files (x86)', 'Common Files'),
    join(places.drive, 'Users'),
    join(places.drive, 'Windows'),
    join(places.drive, 'ProgramData'),
    places.home,
    places.local,
    places.roaming,
    join(places.local, 'Programs'),
  ].map((path) => resolve(path).toLowerCase());
  return shallow.includes(resolve(dir).toLowerCase()) || within(dir, places.home);
}

/** 是否在 Windows / ProgramData / WindowsApps 下。 */
function inSystemDir(dir: string, places: CleanPlaces): boolean {
  return (
    within(join(places.drive, 'Windows'), dir) ||
    within(join(places.drive, 'ProgramData'), dir) ||
    resolve(dir)
      .toLowerCase()
      .split(/[\\/]+/)
      .includes('windowsapps')
  );
}

/** 同一安装目录的注册表项合并后的结果。 */
export interface SoftwareCandidate {
  id: string;
  name: string;
  publisher?: string;
  installDir: string;
  /** 所有同目录的项都是系统组件。 */
  systemComponent: boolean;
}

/** 注册表项按安装目录去重，只留系统盘上的；同目录优先用非系统组件那一条的名字。 */
export function mergeInstalled(apps: InstalledApp[], places: CleanPlaces): SoftwareCandidate[] {
  const byDir = new Map<string, SoftwareCandidate>();
  for (const app of apps) {
    if (!app.installDir || !app.name) continue;
    const dir = resolve(app.installDir);
    if (!within(places.drive, dir) || tooShallow(dir, places)) continue;
    const key = dir.toLowerCase();
    const system = app.systemComponent === true;
    const existing = byDir.get(key);
    if (!existing) {
      byDir.set(key, {
        id: softwareId(dir),
        name: app.name,
        publisher: app.publisher,
        installDir: dir,
        systemComponent: system,
      });
    } else if (existing.systemComponent && !system) {
      byDir.set(key, { ...existing, name: app.name, publisher: app.publisher, systemComponent: false });
    }
  }
  return [...byDir.values()];
}

/** 判定所需的系统现状。 */
export interface SoftwareContext {
  running: string[];
  services: string[];
}

/** 评估选项。 */
export interface EvaluateOptions {
  signal?: AbortSignal;
  /** 统计大小的截止时间；不给就统计完整。 */
  deadline?: number;
}

/** 正在运行、位于 dir 下的进程名（去重）。 */
export function runningIn(dir: string, running: string[]): string[] {
  return [...new Set(running.filter((exe) => within(dir, exe)).map((exe) => basename(exe)))];
}

/**
 * 评估一个软件：大小、能不能搬、正在运行的进程。目录不存在或不是目录返回 null。
 */
export async function evaluateSoftware(
  candidate: SoftwareCandidate,
  places: CleanPlaces,
  context: SoftwareContext,
  options: EvaluateOptions = {},
): Promise<SoftwareEntry | null> {
  const dir = candidate.installDir;
  const stat = await lstat(dir).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isSymbolicLink())) return null;
  const entry: SoftwareEntry = { id: candidate.id, name: candidate.name, installDir: dir, size: 0, blocked: null };
  if (candidate.publisher) entry.publisher = candidate.publisher;
  const running = runningIn(dir, context.running);
  if (running.length > 0) entry.running = running;
  const block = (reason: string): void => {
    entry.blocked ??= reason;
  };
  if (candidate.systemComponent) block('这是系统组件，搬走可能影响 Windows');
  if (stat.isSymbolicLink()) {
    block('已经搬过了（这里已经是一个目录联接）');
    return entry;
  }
  try {
    noLinks(dir);
  } catch {
    block('所在路径里有联接，不能再搬');
  }
  if (inSystemDir(dir, places)) block('在系统目录里（Windows / ProgramData / WindowsApps），不能搬');
  const reason = denied(dir, places, { allowUserData: true, allowProgramFiles: true });
  if (reason) block(reason);
  const kind = riskyKind(candidate.name, candidate.publisher, dir);
  if (kind) block(`看起来是${kind}，搬走可能出问题`);
  if (context.services.some((exe) => within(dir, exe))) block('有 Windows 服务在用这个目录，搬走后服务可能起不来');
  const tree = await scanTree(dir, {
    signal: options.signal,
    deadline: options.deadline,
    collect: false,
    tolerant: true,
  });
  entry.size = tree.bytes;
  if (tree.links.length > 0) block('目录里有链接或联接，暂不支持搬');
  if (tree.complete && tree.bytes < SOFTWARE_MIN_SIZE) block('不到 50MB，搬了也省不出多少空间');
  return entry;
}

/** 读取系统现状；进程或服务读不出来时按空处理（真正搬的时候会再查一次）。 */
export async function readContext(probe: SoftwareProbe, strict = false): Promise<SoftwareContext> {
  const [running, services] = await Promise.all([
    strict ? probe.runningExecutables() : probe.runningExecutables().catch(() => []),
    strict ? probe.serviceImagePaths() : probe.serviceImagePaths().catch(() => []),
  ]);
  return { running, services };
}

/**
 * 列出系统盘上的已安装软件，能搬的在前、按大小降序。
 */
export async function listSoftware(
  places: CleanPlaces,
  probe: SoftwareProbe,
  options: ListSoftwareOptions = {},
): Promise<SoftwareEntry[]> {
  const report = (progress: Omit<CleanProgress, 'feature'>): void =>
    options.onProgress?.({ feature: 'software', ...progress });
  try {
    const [apps, context] = await Promise.all([probe.listInstalled(), readContext(probe)]);
    const candidates = mergeInstalled(apps, places);
    const entries: SoftwareEntry[] = [];
    let bytes = 0;
    for (const [index, candidate] of candidates.entries()) {
      options.signal?.throwIfAborted();
      report({ phase: 'scanning', current: candidate.name, files: index, bytes, totalFiles: candidates.length });
      const entry = await evaluateSoftware(candidate, places, context, {
        signal: options.signal,
        deadline: Date.now() + (options.sizeTimeoutMs ?? SIZE_TIMEOUT_MS),
      });
      if (!entry) continue;
      bytes += entry.size;
      entries.push(entry);
    }
    entries.sort(
      (a, b) =>
        Number(a.blocked !== null) - Number(b.blocked !== null) || b.size - a.size || a.name.localeCompare(b.name),
    );
    report({ phase: 'done', files: candidates.length, bytes, totalFiles: candidates.length });
    return entries;
  } catch (error) {
    if (options.signal?.aborted) report({ phase: 'cancelled', files: 0, bytes: 0 });
    else report({ phase: 'error', files: 0, bytes: 0, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
