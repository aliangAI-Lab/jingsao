/**
 * 清理与搬家共用的安全闸：位置表、永久保护名单、链接检查、候选文件复核、磁盘容量。
 *
 * 这里的判断独立于可编辑的规则数据：规则写错也越不过黑名单。任何会改动文件的模块，
 * 在动手前都必须对目标再调一次 {@link denied} 与 {@link noLinks}，不能只信扫描时的结论。
 * 系统目录（Windows / ProgramData / Program Files）默认整棵受保护，只有规则显式登记的根目录
 * （{@link DenyOptions.systemRoots}）才放行；即便放行，{@link FORBIDDEN_SYSTEM} 里「明确不做」的位置也永远拦下。
 * 测试模式（环境变量 JINGSAO_TEST_ROOT）把所有位置（含系统目录）换到一个非 C 盘的子目录里，
 * 配错时直接抛错，绝不会把改动落到真实系统盘。
 * @module jingsao/src/host/clean/safety
 */
import { lstatSync, realpathSync, statfsSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

/** 上个版本在非系统盘根下建的暂存目录名；任何层级出现都受保护（只剩遗留数据处理会读它）。 */
export const STAGING_DIR_NAME = '.jingsao-staging';

/** 一天的毫秒数；规则里的 ageDays 按它换算。 */
export const DAY_MS = 86_400_000;

/** 一小时的毫秒数；规则里的 minAgeHours 按它换算。 */
export const HOUR_MS = 3_600_000;

/** 运行期的各个位置；测试模式下全部落在测试根目录里。 */
export interface CleanPlaces {
  /** 测试根目录；null = 真实系统。 */
  test: string | null;
  /** 用户目录。 */
  home: string;
  /** %LOCALAPPDATA%。 */
  local: string;
  /** %APPDATA%。 */
  roaming: string;
  /** 「文档」目录（微信 / QQ 的默认数据位置）。 */
  documents: string;
  /** 被清理的盘根（真实系统为 C:\）。 */
  drive: string;
  /** %SystemRoot%（C:\Windows）。 */
  windows: string;
  /** %ProgramData%（C:\ProgramData）。 */
  programdata: string;
  /** %SystemDrive% 的根（C:\）。 */
  systemdrive: string;
  /** %ProgramFiles(x86)%（C:\Program Files (x86)）。 */
  programfilesx86: string;
  /** 上个版本的暂存区位置：现在只用于检测和处理遗留数据，清理不再往里放东西。 */
  legacyStaging: string;
  /** true = 只读模式：任何改动都拒绝。 */
  readOnly: boolean;
}

/** 环境变量 → 位置表；测试根目录落在 C 盘或是盘根时抛错。 */
export function locations(env: NodeJS.ProcessEnv = process.env): CleanPlaces {
  const test = env.JINGSAO_TEST_ROOT ? resolve(env.JINGSAO_TEST_ROOT) : null;
  if (test && (parse(test).root.toLowerCase() === 'c:\\' || test === parse(test).root)) {
    throw new Error('测试目录必须位于非 C 盘的子目录');
  }
  const home = test ? join(test, 'Users', 'tester') : homedir();
  const local = test ? join(home, 'AppData', 'Local') : (env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'));
  const roaming = test ? join(home, 'AppData', 'Roaming') : (env.APPDATA ?? join(home, 'AppData', 'Roaming'));
  const documents = join(home, 'Documents');
  const drive = test ?? 'C:\\';
  // 系统目录一律从环境变量推导，不写死；测试模式整体落进测试根，与真实系统同构（盘根下第一级同名）
  const systemdrive = test ?? (env.SystemDrive ? resolve(env.SystemDrive + '\\') : 'C:\\');
  const windows = test ? join(test, 'Windows') : resolve(env.SystemRoot ?? env.windir ?? join(systemdrive, 'Windows'));
  const programdata = test ? join(test, 'ProgramData') : resolve(env.ProgramData ?? join(systemdrive, 'ProgramData'));
  const programfilesx86 = test
    ? join(test, 'Program Files (x86)')
    : resolve(env['ProgramFiles(x86)'] ?? join(systemdrive, 'Program Files (x86)'));
  const legacyStaging = join(local, 'Jingsao', 'Staging');
  return {
    test,
    home,
    local,
    roaming,
    documents,
    drive,
    windows,
    programdata,
    systemdrive,
    programfilesx86,
    legacyStaging,
    readOnly: env.JINGSAO_READ_ONLY === '1',
  };
}
/** target 是否在 root 之内（含 root 本身）；大小写按 Windows 不敏感比较。 */
export function within(root: string, target: string): boolean {
  const rel = relative(resolve(root).toLowerCase(), resolve(target).toLowerCase());
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

/** 盘根下的系统目录（只比较盘根下第一级，命中即保护整棵子树）。 */
const RESERVED_TOP = new Set([
  'windows',
  'programdata',
  'system volume information',
  '$recycle.bin',
  'recovery',
  'boot',
]);

/** 软件安装目录（盘根下第一级）；只有软件搬家打开 allowProgramFiles 时才放行。 */
const PROGRAM_TOP = new Set(['program files', 'program files (x86)']);

/** 任何层级出现都保护的目录名（密钥、仓库、宿主与本插件自己的数据）。 */
const RESERVED_SEGMENTS = new Set(['.ssh', '.gnupg', '.git', '.dsh', '.jingsao-data', STAGING_DIR_NAME]);

/** 系统文件与虚拟磁盘：任何功能都不碰（休眠/虚拟内存只给设置建议）。 */
const SYSTEM_FILE = /^(pagefile|hiberfil|swapfile)\.sys$|\.(vhdx?|vmdk|vdi)$/i;

/** 选项：哪些「用户数据」区域对本次调用是允许的。 */
export interface DenyOptions {
  /**
   * 允许进入用户自己的文件夹（文档/桌面/下载/图片/视频…）与聊天软件数据目录。
   * 只有微信QQ专清、重复文件、大文件搬家这类「用户明确选了文件」的功能才打开。
   */
  allowUserData?: boolean;
  /** 允许 drive 以外的盘（重复文件扫全盘、搬家目标盘）。 */
  allowOtherDrives?: boolean;
  /** 允许 Program Files 下的目录（只给软件搬家用）。 */
  allowProgramFiles?: boolean;
  /**
   * 规则显式登记的系统根目录（例如 C:\Windows\Temp）：目标落在其中之一时，
   * 「系统目录 / 软件安装目录整棵保护」对它放行。永久保护与「明确不做」的位置不受影响。
   */
  systemRoots?: readonly string[];
}

/**
 * 「明确不做」的系统位置：即使被手工塞进规则（或登记成 systemRoots）也一律拦下。
 * 理由写在 README「明确不做」一节：
 * - Windows\IME：系统受保护文件，删了可能影响系统更新和系统文件检查；
 * - Windows Defender 的扫描历史、保护历史、定义备份、隔离文件：安全软件自己管理，有防篡改保护，隔离文件删了无法还原；
 * - Windows\Installer（含 $PatchCache$）与 ProgramData\Package Cache：删了以后卸载或修复 Office、VC 运行库会要安装包；
 * - Windows\Prefetch：删了反而让开机和启动程序变慢，几乎不省空间；
 * - Windows\Fonts（字体缓存要停系统服务）、System32、SysWOW64、WinSxS、servicing、assembly：系统本体。
 * 路径相对于对应的系统目录（windows / programdata / systemdrive），比较时不分大小写。
 */
export const FORBIDDEN_SYSTEM: ReadonlyArray<{ base: 'windows' | 'programdata' | 'systemdrive'; path: string }> = [
  { base: 'windows', path: 'IME' },
  { base: 'windows', path: 'Installer' },
  { base: 'windows', path: 'Prefetch' },
  { base: 'windows', path: 'Fonts' },
  { base: 'windows', path: 'System32' },
  { base: 'windows', path: 'SysWOW64' },
  { base: 'windows', path: 'WinSxS' },
  { base: 'windows', path: 'servicing' },
  { base: 'windows', path: 'assembly' },
  { base: 'windows', path: 'SystemApps' },
  { base: 'windows', path: 'ServiceProfiles/LocalService/AppData/Local/FontCache' },
  { base: 'programdata', path: 'Package Cache' },
  { base: 'programdata', path: 'Microsoft/Windows Defender' },
  { base: 'programdata', path: 'Microsoft/Windows Defender Advanced Threat Protection' },
  { base: 'systemdrive', path: 'Program Files/Windows Defender' },
];

/** 任何层级出现都不碰的系统目录名（Defender 数据、补丁缓存）。 */
const FORBIDDEN_SEGMENTS = new Set(['windows defender', '$patchcache$']);

/** 目标是否落在「明确不做」的位置。 */
export function forbiddenSystem(target: string, places: CleanPlaces): boolean {
  const segments = resolve(target)
    .toLowerCase()
    .split(/[\\/]+/);
  if (segments.some((part) => FORBIDDEN_SEGMENTS.has(part))) return true;
  return FORBIDDEN_SYSTEM.some((entry) => within(join(places[entry.base], entry.path), target));
}

/** 用户数据目录名：垃圾清理（规则驱动）一律不进。 */
const USER_DATA_SEGMENTS = new Set([
  'documents',
  'pictures',
  'videos',
  'music',
  'desktop',
  'downloads',
  '文档',
  '图片',
  '视频',
  '音乐',
  '桌面',
  '下载',
  'wechat files',
  'xwechat_files',
  'tencent files',
  'wxwork',
  'nt_qq',
]);

/**
 * 一条路径为什么不能动；返回 null 表示允许。
 * 顺序：明确不做 → 旧暂存区 → 系统目录（规则登记的根放行）→ 永久保护 → 系统文件 → 用户数据（视选项）→ 测试根 / 盘符范围。
 */
export function denied(target: string, places: CleanPlaces, options: DenyOptions = {}): string | null {
  const resolved = resolve(target);
  const segments = resolved.toLowerCase().split(/[\\/]+/);
  // 盘根下第一级：测试模式以测试根为「盘根」，与真实系统同构。
  const base = places.test && within(places.test, resolved) ? places.test : parse(resolved).root;
  const top =
    relative(base, resolved)
      .toLowerCase()
      .split(/[\\/]+/)[0] ?? '';
  if (forbiddenSystem(resolved, places)) return '系统保护范围，鲸扫不碰';
  if (within(places.legacyStaging, resolved)) return '上个版本的暂存区受到保护';
  const registered = (options.systemRoots ?? []).some((root) => within(root, resolved));
  if (RESERVED_TOP.has(top) && !registered) return '系统目录受到保护';
  if (PROGRAM_TOP.has(top) && !options.allowProgramFiles && !registered) return '软件安装目录只在软件搬家里处理';
  if (segments.some((part) => RESERVED_SEGMENTS.has(part) || part === '.env' || part.startsWith('.env.'))) {
    return '属于永久保护范围';
  }
  if (segments.some((part) => SYSTEM_FILE.test(part))) return '系统文件或虚拟磁盘受到保护';
  if (!options.allowUserData && segments.some((part) => USER_DATA_SEGMENTS.has(part)))
    return '个人文件和聊天记录不在垃圾清理范围';
  if (places.test && !within(places.test, resolved)) return '超出测试目录';
  if (!places.test && !options.allowOtherDrives && parse(resolved).root.toLowerCase() !== places.drive.toLowerCase()) {
    return '只整理 C 盘';
  }
  return null;
}

/** noLinks 选项。 */
export interface NoLinksOptions {
  /** 路径（或它的某一级祖先）不存在时不报错，直接返回。 */
  allowMissing?: boolean;
  /**
   * 同一批动手里已经复核过的祖先目录（小写路径）。命中的那一级不再重复 lstat + realpath；
   * 新复核通过的目录会加进来。只在一次清理批次内复用（remove 里最多信 1 秒），不跨批次保存；文件本身每次都完整复核。
   */
  verified?: Set<string>;
}

/**
 * 逐级 lstat 每个祖先：遇到符号链接、目录联接或实际路径跳转就抛错。
 * 防的是「扫描时是普通目录，动手时被换成指向别处的链接」。
 */
export function noLinks(target: string, options: NoLinksOptions = {}): void {
  const absolute = resolve(target);
  const root = parse(absolute).root;
  let current = root;
  const { verified } = options;
  for (const segment of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, segment);
    const key = verified ? current.toLowerCase() : '';
    if (verified && current !== absolute && verified.has(key)) continue;
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (options.allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('符号链接或目录联接受到保护');
    if (realpathSync.native(current).toLowerCase() !== current.toLowerCase()) throw new Error('实际路径发生跳转');
    if (verified && current !== absolute && stat.isDirectory()) verified.add(key);
  }
}

/** 文件身份：扫描时记下，动手前比对，变了就不动。 */
export interface FileIdentity {
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
}

/** 复核选项。 */
export interface InspectOptions extends DenyOptions {
  /** 只处理这么多天以前修改的文件。 */
  ageDays?: number;
  /** 只处理这么多小时以前修改的文件（系统临时目录一律 24）。 */
  minAgeHours?: number;
  /** 扫描时记下的身份；给了就必须一致。 */
  previous?: FileIdentity;
  /** 文件必须位于这个根目录之内（不含根本身）。 */
  root?: string;
  /** 同一批动手里已复核过的祖先目录，见 NoLinksOptions.verified。 */
  verified?: Set<string>;
}

/**
 * 动手前对单个文件的完整复核：黑名单、根目录、链接、普通文件、单一硬链接、年龄、身份。
 * 通过则返回当前身份；任何一项不符都抛出可读原因。
 */
export function inspectCandidate(file: string, places: CleanPlaces, options: InspectOptions = {}): FileIdentity {
  const reason = denied(file, places, options);
  if (reason) throw new Error(reason);
  if (options.root && (!within(options.root, file) || resolve(options.root) === resolve(file))) {
    throw new Error('超出允许的目录');
  }
  noLinks(file, options.verified ? { verified: options.verified } : {});
  return checkIdentity(lstatSync(file), options);
}

/**
 * 扫描用的轻量复核：调用方已经从一个复核过的根目录逐级往下走、每级都确认不是链接，
 * 并且手里有这个文件刚读到的 lstat。这里只做黑名单、根目录、普通文件、硬链接、年龄检查，
 * 不再逐级 lstat + realpath。动手时仍走 inspectCandidate 的完整复核。
 */
export function inspectScanned(
  file: string,
  stat: Stats,
  places: CleanPlaces,
  options: InspectOptions = {},
): FileIdentity {
  const reason = denied(file, places, options);
  if (reason) throw new Error(reason);
  if (options.root && (!within(options.root, file) || resolve(options.root) === resolve(file))) {
    throw new Error('超出允许的目录');
  }
  return checkIdentity(stat, options);
}

function checkIdentity(stat: Stats, options: InspectOptions): FileIdentity {
  if (stat.isSymbolicLink()) throw new Error('符号链接或目录联接受到保护');
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('只处理普通文件，共享硬链接保留');
  if (options.ageDays && Date.now() - stat.mtimeMs < options.ageDays * DAY_MS) {
    throw new Error(`最近 ${options.ageDays} 天内改过的文件先不动`);
  }
  if (options.minAgeHours && Date.now() - stat.mtimeMs < options.minAgeHours * HOUR_MS) {
    throw new Error(`最近 ${options.minAgeHours} 小时内改过的文件先不动`);
  }
  const { previous } = options;
  if (
    previous &&
    (stat.size !== previous.size ||
      stat.mtimeMs !== previous.mtimeMs ||
      stat.ino !== previous.ino ||
      stat.dev !== previous.dev)
  ) {
    throw new Error('文件在扫描后有变化，请重新扫描');
  }
  return { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev };
}

/** 盘容量（字节）；读不到时为 null。 */
export interface DiskSpace {
  total: number | null;
  free: number | null;
}

/** 读某个盘（或目录所在盘）的总容量与可用空间。 */
export function diskSpace(path: string): DiskSpace {
  try {
    const stat = statfsSync(path);
    return { total: stat.blocks * stat.bsize, free: stat.bavail * stat.bsize };
  } catch {
    return { total: null, free: null };
  }
}

/** 文件操作错误码 → 给普通人看的原因。 */
export function errorText(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const known: Record<string, string> = {
    EACCES: '没有访问权限',
    EPERM: '文件正在使用或没有权限',
    EBUSY: '文件正在使用',
    ENOENT: '文件已不存在',
    ENOSPC: '磁盘空间不足',
    EEXIST: '目标位置已有同名文件',
    EXDEV: '不能跨盘直接移动',
  };
  if (code && known[code]) return known[code];
  return error instanceof Error ? error.message : String(error);
}
