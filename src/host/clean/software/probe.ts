/**
 * 软件搬家的系统探针：已安装软件列表（注册表卸载项）、正在运行的程序、Windows 服务的可执行文件。
 *
 * 只读；不负责判定能不能搬（归 ./list）。真实实现通过 powershell 读注册表与 CIM，
 * 输出统一转成 UTF-8 JSON（reg.exe 的输出编码随系统代码页变化，中文系统上不可靠）。
 * 探针做成可注入的接口：测试注入假数据，真实系统上的解析逻辑拆成纯函数单独测。
 * @module jingsao/src/host/clean/software/probe
 */
import { execFile } from 'node:child_process';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/** 注册表里的一个已安装软件（安装目录已推好；推不出时为 undefined）。 */
export interface InstalledApp {
  /** 注册表键全名。 */
  key: string;
  name: string;
  publisher?: string;
  installDir?: string;
  systemComponent?: boolean;
  uninstall?: string;
}

/** 可注入的系统探针。 */
export interface SoftwareProbe {
  listInstalled(): Promise<InstalledApp[]>;
  /** 正在运行进程的完整 exe 路径。 */
  runningExecutables(): Promise<string[]>;
  /** 所有 Windows 服务（含驱动）的可执行文件路径。 */
  serviceImagePaths(): Promise<string[]>;
}

/** 注册表卸载项的原始字段。 */
export interface UninstallRaw {
  key: string;
  name?: string | null;
  publisher?: string | null;
  installLocation?: string | null;
  displayIcon?: string | null;
  uninstall?: string | null;
  systemComponent?: number | string | null;
}

/** 展开 %VAR% 环境变量（找不到的原样保留）。 */
function expandEnv(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? (env[key] ?? whole) : whole;
  });
}

/**
 * 从命令行里取出 exe 路径：带引号取引号内，不带引号取到第一个 .exe 为止；
 * 处理 \??\ 前缀与 %VAR%。取不出绝对路径返回 null。
 */
export function exePathFromCommand(command: string | null | undefined): string | null {
  if (!command) return null;
  let text = expandEnv(command.trim()).replace(/^\\\?\?\\/, '');
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    text = end > 0 ? text.slice(1, end) : text.slice(1);
  } else {
    const match = /^(.+?\.(exe|sys|dll))(\s|,|$)/i.exec(text);
    if (match) text = match[1]!;
  }
  text = text.trim();
  return isAbsolute(text) && /^[a-z]:\\/i.test(text) ? resolve(text) : null;
}

/** 安装目录如果是这些名字（或纯版本号），往上走一级才是软件本身的目录。 */
const SUBDIR_NAMES = new Set(['bin', 'uninstall', 'uninst', '_uninstall', 'utility', 'x64', 'x86', 'program']);

/** 规整安装目录：去引号与末尾分隔符；子目录名或版本号目录上移一级。 */
function normalizeDir(dir: string): string {
  let current = resolve(dir.trim().replace(/^"+|"+$/g, ''));
  for (let i = 0; i < 2; i += 1) {
    const name = basename(current).toLowerCase();
    if (!SUBDIR_NAMES.has(name) && !/^v?\d+(\.\d+){1,3}$/.test(name)) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

/** 推出来的目录如果落在这些地方就不可信（安装缓存、系统目录），宁可跳过。 */
const UNTRUSTED_DERIVED = /^[a-z]:\\(windows|programdata)\\|\\package cache\\/i;

/**
 * 从卸载项推安装目录：InstallLocation → DisplayIcon（只认 .exe）→ UninstallString（只认卸载程序）。
 * 推不出返回 undefined。
 */
export function installDirFromRegistry(
  raw: Pick<UninstallRaw, 'installLocation' | 'displayIcon' | 'uninstall'>,
): string | undefined {
  const location = raw.installLocation
    ? expandEnv(raw.installLocation)
        .trim()
        .replace(/^"+|"+$/g, '')
    : '';
  if (location && /^[a-z]:\\/i.test(location)) return normalizeDir(location);
  const icon = exePathFromCommand(raw.displayIcon?.replace(/,\s*-?\d+\s*$/, ''));
  if (icon && /\.exe$/i.test(icon) && !UNTRUSTED_DERIVED.test(icon)) return normalizeDir(dirname(icon));
  const uninstaller = exePathFromCommand(raw.uninstall);
  if (
    uninstaller &&
    /(unins|uninst|uninstall|卸载)/i.test(basename(uninstaller)) &&
    !/msiexec/i.test(basename(uninstaller)) &&
    !UNTRUSTED_DERIVED.test(uninstaller)
  ) {
    return normalizeDir(dirname(uninstaller));
  }
  return undefined;
}

/** 卸载项原始字段 → InstalledApp；没有名字的返回 null。 */
export function appFromRaw(raw: UninstallRaw): InstalledApp | null {
  const name = raw.name?.trim();
  if (!name) return null;
  const app: InstalledApp = { key: raw.key, name };
  if (raw.publisher?.trim()) app.publisher = raw.publisher.trim();
  const installDir = installDirFromRegistry(raw);
  if (installDir) app.installDir = installDir;
  if (Number(raw.systemComponent) === 1) app.systemComponent = true;
  if (raw.uninstall?.trim()) app.uninstall = raw.uninstall.trim();
  return app;
}

/** 解析 powershell ConvertTo-Json 的输出：空 → []，单个对象 → [对象]。 */
export function parseJsonList<T>(text: string): T[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as T | T[] | null;
  if (parsed === null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** 运行一段 powershell 脚本（UTF-16LE base64 传入，输出强制 UTF-8），返回标准输出。 */
export function runPowerShell(script: string, timeoutMs = 60_000): Promise<string> {
  const full = `$ErrorActionPreference='SilentlyContinue'\n[Console]::OutputEncoding=[Text.Encoding]::UTF8\n${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolvePromise, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolvePromise(stdout)),
    );
  });
}

const LIST_SCRIPT = `
$roots = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
           'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
           'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
$out = foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root | ForEach-Object {
    $p = Get-ItemProperty -LiteralPath $_.PSPath
    [pscustomobject]@{ key = $_.Name; name = $p.DisplayName; publisher = $p.Publisher;
      installLocation = $p.InstallLocation; displayIcon = $p.DisplayIcon;
      uninstall = $p.UninstallString; systemComponent = $p.SystemComponent }
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 2`;

const RUNNING_SCRIPT = `ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { $_.ExecutablePath }) -Compress`;

const SERVICE_SCRIPT = `ConvertTo-Json -InputObject @(@(Get-CimInstance Win32_Service) + @(Get-CimInstance Win32_SystemDriver) | Where-Object { $_.PathName } | ForEach-Object { $_.PathName }) -Compress`;

/** 真实探针：powershell 读注册表卸载项、Win32_Process、Win32_Service / Win32_SystemDriver。 */
export function realSoftwareProbe(run: (script: string) => Promise<string> = runPowerShell): SoftwareProbe {
  return {
    async listInstalled() {
      return parseJsonList<UninstallRaw>(await run(LIST_SCRIPT))
        .map(appFromRaw)
        .filter((app): app is InstalledApp => app !== null);
    },
    async runningExecutables() {
      return parseJsonList<string>(await run(RUNNING_SCRIPT)).filter(
        (path) => typeof path === 'string' && isAbsolute(path),
      );
    },
    async serviceImagePaths() {
      return parseJsonList<string>(await run(SERVICE_SCRIPT))
        .map((command) => exePathFromCommand(command))
        .filter((path): path is string => path !== null);
    },
  };
}
