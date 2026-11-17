/**
 * 需要管理员权限的那部分清理：整批交给一个提权子进程（复用软件搬家的 UAC 提权方式），一次清理只弹一次 UAC。
 *
 * 宿主把要删的文件写成一份清单（制表符分隔，一行一项），连同 PowerShell 脚本一起交给提权执行器；
 * 脚本对清单里每个文件做同样的身份复核（仍在根目录下、根目录到文件之间没有联接、大小与修改时间一致、
 * 年龄满足规则）再删，被占用或没权限的跳过计数；扫描时读不到的根目录（需管理员）在脚本里按同样的约束
 * 自己枚举（不进入联接），传递优化缓存用系统命令 Delete-DeliveryOptimizationCache 清。
 * 结果写回 JSON，宿主读回汇总。用户拒绝提权时执行器抛错，调用方据此把系统相关的规则记为「这次没清」。
 *
 * 测试与测试模式用 {@link simulatedElevatedCleaner}（同进程、只在测试根里），绝不弹 UAC。
 * 脚本本身在测试里以普通权限对测试目录实际跑过；「以管理员身份运行」这一步未验证。
 * @module jingsao/src/host/clean/delete/elevated
 */
import fs from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { denied, noLinks, within, type CleanPlaces } from '../safety.ts';
import { scriptBytes, type ElevatedRunner } from '../software/script.ts';
import { removeCandidates } from './remove.ts';
import type { AdminDir, DeleteCandidate, DeleteTally } from './types.ts';

/** 提权子进程要做的一整批事。 */
export interface ElevatedManifest {
  /** 扫描时已经记下身份的文件。 */
  files: DeleteCandidate[];
  /** 扫描时读不到的根目录：在子进程里自己枚举。 */
  dirs: AdminDir[];
  /** 要跑的系统命令（目前只有传递优化缓存）。 */
  commands: Array<'delivery-opt'>;
}

/** 提权子进程的结果。 */
export interface ElevatedCleanResult {
  /** 分类 id → 计数。 */
  rules: Record<string, DeleteTally>;
  /** 系统命令 → 是否成功。 */
  commands: Record<string, { ok: boolean; error?: string | null }>;
}

/** 提权清理执行器：拒绝提权时抛错（调用方据此跳过系统规则）。 */
export type ElevatedCleaner = (manifest: ElevatedManifest) => Promise<ElevatedCleanResult>;

/** 拒绝提权时抛的错误：调用方据此区分「用户没同意」与「脚本出错」。 */
export class ElevationDenied extends Error {
  constructor(message = '没有获得管理员权限') {
    super(message);
  }
}

/** 文件名模式 → 正则字符串（只认 *，其余字符原样）。 */
function patternSource(pattern: string): string {
  return (
    '^' +
    pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*') +
    '$'
  );
}

/** 字符串 → PowerShell 单引号字面量。 */
function literal(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** 候选 → 清单行（制表符分隔；Windows 路径里不会出现制表符和换行）。 */
export function manifestLines(manifest: ElevatedManifest): string[] {
  const lines: string[] = [];
  for (const file of manifest.files) {
    const minAgeMs = Math.max((file.ageDays ?? 0) * 86_400_000, (file.minAgeHours ?? 0) * 3_600_000);
    const root = file.root ?? file.systemRoot ?? '';
    lines.push(
      [
        'file',
        file.categoryId,
        String(file.identity.size),
        String(Math.floor(file.identity.mtimeMs)),
        String(minAgeMs),
        root,
        file.path,
      ].join('\t'),
    );
  }
  for (const dir of manifest.dirs) {
    lines.push(
      [
        'dir',
        dir.categoryId,
        String(Math.floor(dir.minAgeMs)),
        (dir.files ?? []).map(patternSource).join('|'),
        dir.root,
      ].join('\t'),
    );
  }
  for (const command of manifest.commands) lines.push(['command', command].join('\t'));
  return lines;
}

/**
 * 提权清理脚本：逐行读清单，复核后删除，结果写回 JSON。
 * 任何一个文件出错只计入该规则的跳过数，不影响其它文件；整个脚本出错写 ok=false。
 */
export function buildCleanScript(manifestFile: string, resultFile: string): string {
  return `$ErrorActionPreference = 'Stop'
$manifest = ${literal(manifestFile)}
$result = ${literal(resultFile)}
$epoch = New-Object DateTime 1970,1,1,0,0,0,([DateTimeKind]::Utc)
$now = [DateTime]::UtcNow
$rules = @{}
$commands = @{}
function Get-Tally($id) {
  if (-not $rules.ContainsKey($id)) { $rules[$id] = @{ files = 0; bytes = [int64]0; skipped = 0 } }
  return $rules[$id]
}
function Test-Reparse($path) {
  return [bool]((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}
# 从文件逐级往上直到根目录：任何一级是联接或符号链接就不动；走出根目录也不动
function Test-Inside($path, $root) {
  $top = $root.TrimEnd('\\')
  if (-not $path.StartsWith($top + '\\', [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $current = $path
  while ($current.Length -ge $top.Length) {
    if (Test-Reparse $current) { return $false }
    if ($current.TrimEnd('\\') -ieq $top) { return $true }
    $current = Split-Path -Parent $current
    if (-not $current) { return $false }
  }
  return $false
}
function Remove-One($path) {
  $item = Get-Item -LiteralPath $path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReadOnly) { $item.Attributes = $item.Attributes -bxor [IO.FileAttributes]::ReadOnly }
  [IO.File]::Delete($path)
}
function Test-Name($name, $patterns) {
  if (-not $patterns) { return $true }
  foreach ($p in $patterns.Split('|')) { if ($name -match $p) { return $true } }
  return $false
}
function Save-Result([bool]$ok, $message) {
  $json = [pscustomobject]@{ ok = $ok; error = $message; rules = $rules; commands = $commands } | ConvertTo-Json -Compress -Depth 5
  [IO.File]::WriteAllText($result, $json, (New-Object Text.UTF8Encoding($false)))
}
try {
  foreach ($line in [IO.File]::ReadAllLines($manifest, [Text.Encoding]::UTF8)) {
    if (-not $line) { continue }
    $f = $line.Split([char]9)
    if ($f[0] -eq 'file') {
      $tally = Get-Tally $f[1]
      try {
        $size = [int64]$f[2]; $mtime = [int64]$f[3]; $minAge = [int64]$f[4]; $root = $f[5]; $path = $f[6]
        $item = Get-Item -LiteralPath $path -Force
        if ($item.PSIsContainer) { throw '不是文件' }
        if (-not (Test-Inside $path $root)) { throw '不在规则的根目录里，或经过了联接' }
        if ($item.Length -ne $size) { throw '大小变了' }
        $ms = [int64][Math]::Floor(($item.LastWriteTimeUtc - $epoch).TotalMilliseconds)
        if ([Math]::Abs($ms - $mtime) -gt 1) { throw '修改时间变了' }
        if ($minAge -gt 0 -and ($now - $item.LastWriteTimeUtc).TotalMilliseconds -lt $minAge) { throw '太新' }
        Remove-One $path
        $tally.files++; $tally.bytes += $size
      } catch { $tally.skipped++ }
    } elseif ($f[0] -eq 'dir') {
      $tally = Get-Tally $f[1]
      $minAge = [int64]$f[2]; $patterns = $f[3]; $root = $f[4]
      if (-not (Test-Path -LiteralPath $root)) { continue }
      if (Test-Reparse $root) { continue }
      $stack = New-Object System.Collections.Stack
      $stack.Push($root)
      while ($stack.Count -gt 0) {
        $dir = $stack.Pop()
        try { $entries = @(Get-ChildItem -LiteralPath $dir -Force) } catch { $tally.skipped++; continue }
        foreach ($entry in $entries) {
          if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
          if ($entry.PSIsContainer) { $stack.Push($entry.FullName); continue }
          if (-not (Test-Name $entry.Name $patterns)) { continue }
          if ($minAge -gt 0 -and ($now - $entry.LastWriteTimeUtc).TotalMilliseconds -lt $minAge) { continue }
          try { $size = [int64]$entry.Length; Remove-One $entry.FullName; $tally.files++; $tally.bytes += $size } catch { $tally.skipped++ }
        }
      }
    } elseif ($f[0] -eq 'command' -and $f[1] -eq 'delivery-opt') {
      try {
        Delete-DeliveryOptimizationCache -Force -ErrorAction Stop
        $commands['delivery-opt'] = @{ ok = $true; error = $null }
      } catch { $commands['delivery-opt'] = @{ ok = $false; error = $_.Exception.Message } }
    }
  }
  Save-Result $true $null
} catch {
  Save-Result $false $_.Exception.Message
}
`;
}

/** 读脚本写回的结果；没有文件或格式不对返回 null。 */
async function readCleanResult(file: string): Promise<(ElevatedCleanResult & { ok: boolean; error?: string }) | null> {
  try {
    const parsed = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, '')) as {
      ok?: unknown;
      error?: unknown;
      rules?: Record<string, Partial<DeleteTally>>;
      commands?: Record<string, { ok?: unknown; error?: unknown }>;
    };
    if (typeof parsed.ok !== 'boolean') return null;
    const rules: Record<string, DeleteTally> = {};
    for (const [id, tally] of Object.entries(parsed.rules ?? {})) {
      rules[id] = {
        files: Number(tally.files) || 0,
        bytes: Number(tally.bytes) || 0,
        skipped: Number(tally.skipped) || 0,
      };
    }
    const commands: ElevatedCleanResult['commands'] = {};
    for (const [id, value] of Object.entries(parsed.commands ?? {})) {
      commands[id] = { ok: value.ok === true, error: typeof value.error === 'string' ? value.error : null };
    }
    return {
      ok: parsed.ok,
      ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
      rules,
      commands,
    };
  } catch {
    return null;
  }
}

/** 真实执行器的构造参数。 */
export interface RealElevatedCleanerOptions {
  /** 脚本、清单与结果文件放哪（插件数据目录下）。 */
  workDir: string;
  /** 提权执行器（软件搬家的同一个）；测试里换成普通权限运行。 */
  runner: ElevatedRunner;
}

/**
 * 真实提权清理：写清单与脚本 → 提权运行一次 → 读结果 → 删掉临时文件。
 * 执行器报错（用户点了「否」）时抛 {@link ElevationDenied}。
 */
export function realElevatedCleaner(options: RealElevatedCleanerOptions): ElevatedCleaner {
  return async (manifest) => {
    await mkdir(options.workDir, { recursive: true });
    const stem = join(options.workDir, `clean-${randomUUID().slice(0, 8)}`);
    const manifestFile = `${stem}.list.txt`;
    const scriptFile = `${stem}.ps1`;
    const resultFile = `${stem}.result.json`;
    try {
      await writeFile(manifestFile, manifestLines(manifest).join('\n') + '\n', 'utf8');
      await writeFile(scriptFile, scriptBytes(buildCleanScript(manifestFile, resultFile)));
      try {
        await options.runner({ action: 'clean', scriptFile, resultFile, source: manifestFile, target: '' });
      } catch (error) {
        throw new ElevationDenied(error instanceof Error ? error.message : undefined);
      }
      const result = await readCleanResult(resultFile);
      if (!result) throw new Error('管理员脚本没有返回结果');
      if (!result.ok) throw new Error(result.error ?? '管理员脚本出错');
      return { rules: result.rules, commands: result.commands };
    } finally {
      for (const file of [manifestFile, scriptFile, resultFile]) await unlink(file).catch(() => undefined);
    }
  };
}

/** 传递优化缓存目录（相对 %SystemRoot%）：模拟执行器在测试根里清它。 */
const DELIVERY_CACHE = 'ServiceProfiles/NetworkService/AppData/Local/Microsoft/Windows/DeliveryOptimization/Cache';

/**
 * 模拟提权：同进程按同样的约束删（测试与测试模式用），不弹 UAC。
 * 测试根以外的任何路径一律跳过。
 */
export function simulatedElevatedCleaner(places: CleanPlaces): ElevatedCleaner {
  if (!places.test) throw new Error('模拟提权只能在测试模式下使用');
  const testRoot = places.test;
  return async (manifest) => {
    const rules: Record<string, DeleteTally> = {};
    const tally = (id: string): DeleteTally => (rules[id] ??= { files: 0, bytes: 0, skipped: 0 });
    const removed = await removeCandidates(manifest.files, places, { feature: 'junk' });
    for (const [id, value] of removed.perCategory) {
      const target = tally(id);
      target.files += value.files;
      target.bytes += value.bytes;
      target.skipped += value.skipped;
    }
    for (const dir of manifest.dirs) {
      const target = tally(dir.categoryId);
      const patterns = (dir.files ?? []).map((pattern) => new RegExp(patternSource(pattern), 'i'));
      if (!within(testRoot, dir.root) || denied(dir.root, places, { systemRoots: [dir.root] })) continue;
      const stack = [dir.root];
      while (stack.length) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
          noLinks(current);
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          target.skipped++;
          continue;
        }
        for (const entry of entries) {
          const path = join(current, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            stack.push(path);
            continue;
          }
          if (!entry.isFile() || (patterns.length && !patterns.some((pattern) => pattern.test(basename(path))))) {
            continue;
          }
          const stat = fs.lstatSync(path);
          if (dir.minAgeMs > 0 && Date.now() - stat.mtimeMs < dir.minAgeMs) continue;
          try {
            fs.unlinkSync(path);
            target.files++;
            target.bytes += stat.size;
          } catch {
            target.skipped++;
          }
        }
      }
    }
    const commands: ElevatedCleanResult['commands'] = {};
    if (manifest.commands.includes('delivery-opt')) {
      const cache = join(places.windows, DELIVERY_CACHE);
      if (fs.existsSync(cache)) {
        for (const name of fs.readdirSync(cache)) fs.rmSync(join(cache, name), { recursive: true, force: true });
      }
      commands['delivery-opt'] = { ok: true, error: null };
    }
    return { rules, commands };
  };
}
