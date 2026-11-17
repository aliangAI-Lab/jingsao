/**
 * 软件搬家的提权路径：生成 PowerShell 脚本（robocopy 复制、建目录联接、带回滚），交给提权执行器运行。
 *
 * Program Files 下的目录普通进程写不了，这时把与 Node 侧同样的流程写成脚本，
 * 弹一次管理员确认后整体执行；脚本把结果写进 JSON 结果文件，Node 侧读回再复核。
 * 不负责判定能不能搬、记录怎么写（归 ./mover）。
 * 脚本本身在测试里以普通权限、对测试目录实际跑过；「以管理员身份运行」这一步（realElevatedRunner）未验证。
 * @module jingsao/src/host/clean/software/script
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** 交给提权执行器的一次请求（软件搬家与垃圾清理的系统规则共用）。 */
export interface ElevatedRequest {
  action: 'move' | 'restore' | 'clean';
  /** 要运行的 .ps1（UTF-8 带 BOM）。 */
  scriptFile: string;
  /** 脚本写结果的 JSON 文件。 */
  resultFile: string;
  /** move：原目录；restore：原位置（现在是联接）；clean：待删清单文件。 */
  source: string;
  /** move：新目录；restore：搬过去的目录；clean：空串。 */
  target: string;
}

/** 提权执行器：以管理员身份运行脚本并等它结束（可注入；测试里用假的）。 */
export type ElevatedRunner = (request: ElevatedRequest) => Promise<void>;

/** 脚本写回的结果。 */
export interface ElevatedResult {
  ok: boolean;
  /** 停在哪一步。 */
  step?: string;
  error?: string | null;
  /** 成功但有尾巴（例如备份没删干净）。 */
  warning?: string | null;
}

/** 字符串 → PowerShell 单引号字面量。 */
function literal(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** 脚本公共开头：严格模式、结果写出函数、校验函数。 */
function prelude(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([name, value]) => `$${name} = ${literal(value)}`);
  return `$ErrorActionPreference = 'Stop'
${lines.join('\n')}
$step = 'start'
$warning = $null
function Save-Result([bool]$ok, $message) {
  $json = [pscustomobject]@{ ok = $ok; step = $step; error = $message; warning = $warning } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($result, $json, (New-Object Text.UTF8Encoding($false)))
}
function Test-Same($a, $b) {
  $x = @(Get-ChildItem -LiteralPath $a -Recurse -Force -File)
  $y = @(Get-ChildItem -LiteralPath $b -Recurse -Force -File)
  $sx = [int64](($x | Measure-Object -Property Length -Sum).Sum)
  $sy = [int64](($y | Measure-Object -Property Length -Sum).Sum)
  return ($x.Count -eq $y.Count) -and ($sx -eq $sy)
}
function Copy-Tree($from, $to) {
  & robocopy.exe $from $to /E /COPY:DAT /DCOPY:T /R:1 /W:1 /XJ /NP /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "复制失败（robocopy 返回 $LASTEXITCODE）" }
}
function Test-Junction($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  return [bool]((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}
`;
}

/**
 * 搬家脚本：robocopy 复制 → 校验文件数与总大小 → 原目录改名为 .jingsao-bak → 建目录联接 → 校验 → 删备份。
 * 任何一步失败按相反顺序回滚（删联接、备份改回原名、删目标里的副本）。
 */
export function buildMoveScript(source: string, target: string, backup: string, resultFile: string): string {
  return `${prelude({ src: source, dst: target, bak: backup, result: resultFile })}
$copied = $false; $renamed = $false; $linked = $false
try {
  if (Test-Path -LiteralPath $bak) { throw '上次搬家留下的备份还在' }
  if (Test-Path -LiteralPath $dst) { throw '目标位置已经有同名目录' }
  $step = 'copy'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  $copied = $true
  Copy-Tree $src $dst
  $step = 'verify'
  if (-not (Test-Same $src $dst)) { throw '复制后文件数或大小对不上' }
  $step = 'rename'
  Rename-Item -LiteralPath $src -NewName (Split-Path -Leaf $bak)
  $renamed = $true
  $step = 'link'
  New-Item -ItemType Junction -Path $src -Value $dst | Out-Null
  $linked = $true
  $step = 'check'
  if (-not (Test-Junction $src)) { throw '联接没有建成' }
  if (@(Get-ChildItem -LiteralPath $src -Force).Count -ne @(Get-ChildItem -LiteralPath $dst -Force).Count) { throw '联接里看到的文件对不上' }
  $step = 'cleanup'
  try { Remove-Item -LiteralPath $bak -Recurse -Force } catch { $warning = "软件已经搬好，但原目录的备份没删干净：$bak" }
  Save-Result $true $null
} catch {
  $message = $_.Exception.Message
  try {
    if ($linked -or (Test-Junction $src)) { [IO.Directory]::Delete($src, $false) }
    if ($renamed) { Rename-Item -LiteralPath $bak -NewName (Split-Path -Leaf $src) }
    if ($copied -and (Test-Path -LiteralPath $dst)) { Remove-Item -LiteralPath $dst -Recurse -Force }
  } catch { $message = "$message；而且没能完全复原：$($_.Exception.Message)" }
  Save-Result $false $message
}
`;
}

/**
 * 还原脚本：确认原位置是联接 → robocopy 把搬过去的目录复制到原位置旁的临时目录 → 校验 →
 * 删联接（只删联接本身）→ 临时目录改成原名 → 删搬过去的目录。失败时把联接建回去、删临时目录。
 */
export function buildRestoreScript(link: string, moved: string, temp: string, resultFile: string): string {
  return `${prelude({ link, moved, tmp: temp, result: resultFile })}
$copied = $false; $unlinked = $false; $swapped = $false
try {
  if (-not (Test-Junction $link)) { throw '原位置已经不是联接' }
  if (Test-Path -LiteralPath $tmp) { throw '上次还原留下的临时目录还在' }
  $step = 'copy'
  $copied = $true
  Copy-Tree $moved $tmp
  $step = 'verify'
  if (-not (Test-Same $moved $tmp)) { throw '复制后文件数或大小对不上' }
  $step = 'unlink'
  [IO.Directory]::Delete($link, $false)
  $unlinked = $true
  $step = 'rename'
  Rename-Item -LiteralPath $tmp -NewName (Split-Path -Leaf $link)
  $swapped = $true
  $step = 'cleanup'
  try { Remove-Item -LiteralPath $moved -Recurse -Force } catch { $warning = "软件已经放回原位，但新位置的副本没删干净：$moved" }
  Save-Result $true $null
} catch {
  $message = $_.Exception.Message
  try {
    if ($unlinked -and -not $swapped) { New-Item -ItemType Junction -Path $link -Value $moved | Out-Null }
    if ($copied -and -not $swapped -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  } catch { $message = "$message；而且没能完全复原：$($_.Exception.Message)" }
  Save-Result $false $message
}
`;
}

/** 脚本文件内容：UTF-8 带 BOM（Windows PowerShell 5.1 才能正确读中文路径）。 */
export function scriptBytes(script: string): Buffer {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(script.replace(/\r?\n/g, '\r\n'), 'utf8')]);
}

/** 读脚本写回的结果；没有文件或格式不对返回 null。 */
export async function readElevatedResult(file: string): Promise<ElevatedResult | null> {
  try {
    const parsed = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as Partial<ElevatedResult>;
    return typeof parsed.ok === 'boolean' ? (parsed as ElevatedResult) : null;
  } catch {
    return null;
  }
}

/** 以普通权限运行一个 .ps1 并等它结束（测试与非提权场景用）。 */
export function runScriptFile(scriptFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
      { windowsHide: true, timeout: 30 * 60_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

/**
 * 真实提权执行器：Start-Process powershell -Verb RunAs -Wait，弹一次管理员确认（UAC）。
 * 用户拒绝时 Start-Process 报错，这里转成「没有获得管理员权限」。未验证（需要真人点 UAC）。
 */
export function realElevatedRunner(): ElevatedRunner {
  return (request) => {
    const inner = `Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${literal(`"${request.scriptFile}"`)})`;
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true },
        (error) => (error ? reject(new Error('没有获得管理员权限')) : resolve()),
      );
    });
  };
}
