/**
 * 不直接删文件、要靠系统自带能力的几件事：回收站大小与清空、传递优化缓存大小、Windows 更新是否在忙、
 * 「用系统方式清理」按钮（WinSxS 组件清理、旧系统备份的系统设置页）。
 *
 * 真实实现全部通过 PowerShell 调系统官方命令；测试模式换成 {@link testSystemOps}，只在测试根里模拟，
 * 不碰真实系统。需要管理员权限的传递优化清理不在这里，写进 ./elevated 的提权脚本里一起跑。
 * 真实实现只在作者机器上手动核对过命令写法，单测不跑真实命令（未验证）。
 * @module jingsao/src/host/clean/delete/system-ops
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import type { CleanPlaces } from '../safety.ts';

/** 「用系统方式清理」能做的事（只报告的分类上那个按钮）。 */
export type SystemAction = 'winsxs' | 'windows-old';

/** 系统能力的接口（可注入；测试用假的）。 */
export interface SystemOps {
  /** 系统盘回收站里的总字节；读不到返回 null。 */
  recycleBinBytes(): Promise<number | null>;
  /** 清空系统盘回收站（Clear-RecycleBin）。 */
  clearRecycleBin(): Promise<void>;
  /** 传递优化缓存的字节（Get-DeliveryOptimizationStatus 汇总）；读不到返回 null，调用方再按目录估算。 */
  deliveryCacheBytes(): Promise<number | null>;
  /** Windows 更新是否正在下载或安装（正在忙就跳过更新下载缓存）。 */
  windowsUpdateBusy(): Promise<boolean>;
  /** 打开系统自带的清理方式，由用户在系统界面里确认（UAC 或设置页）。 */
  launch(action: SystemAction): Promise<void>;
}

/** 跑一段 PowerShell，返回标准输出（去掉首尾空白）。 */
function powershell(script: string, timeout = 60_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim())),
    );
  });
}

/** 输出 → 非负整数；不是数字返回 null。 */
function toBytes(text: string): number | null {
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 真实系统能力。
 * @param drive - 系统盘根（例如 C:\）；回收站只统计、只清这一个盘。
 */
export function realSystemOps(drive: string): SystemOps {
  const letter = drive.slice(0, 1).toUpperCase();
  return {
    // Shell.Application 命名空间 10 = 回收站（合并了所有盘）；按路径前缀只算系统盘
    recycleBinBytes: async () => {
      try {
        return toBytes(
          await powershell(
            `$t=[int64]0; $bin=(New-Object -ComObject Shell.Application).Namespace(10); ` +
              `foreach($i in $bin.Items()){ if($i.Path -like '${letter}:\\*'){ $t += [int64]$i.ExtendedProperty('Size') } }; $t`,
          ),
        );
      } catch {
        return null;
      }
    },
    clearRecycleBin: async () => {
      await powershell(`Clear-RecycleBin -DriveLetter ${letter} -Force -ErrorAction Stop`, 10 * 60_000);
    },
    deliveryCacheBytes: async () => {
      try {
        return toBytes(
          await powershell(
            `$s=(Get-DeliveryOptimizationStatus -ErrorAction Stop | Measure-Object -Property FileSizeInCache -Sum).Sum; if($s){[int64]$s}else{0}`,
          ),
        );
      } catch {
        return null;
      }
    },
    // 判据：更新服务在跑，且安装工作进程（TiWorker / TrustedInstaller / MoUsoCoreWorker）也在跑
    windowsUpdateBusy: async () => {
      try {
        const out = await powershell(
          `$s=Get-Service wuauserv -ErrorAction SilentlyContinue; ` +
            `if($s -and $s.Status -eq 'Running' -and (Get-Process TiWorker,TrustedInstaller,MoUsoCoreWorker -ErrorAction SilentlyContinue)){'busy'}else{'idle'}`,
        );
        return out === 'busy';
      } catch {
        return false;
      }
    },
    launch: async (action) => {
      if (action === 'winsxs') {
        // 管理员控制台里跑系统组件清理：UAC 由用户自己点，窗口可见，跑完由用户关
        await powershell(
          `Start-Process -FilePath 'dism.exe' -ArgumentList '/Online','/Cleanup-Image','/StartComponentCleanup' -Verb RunAs`,
        );
        return;
      }
      // 旧系统备份：打开「设置 → 系统 → 存储」，由用户在临时文件里勾选「以前的 Windows 安装」
      await powershell(`Start-Process 'ms-settings:storagesense'`);
    },
  };
}

/** 测试用的系统能力：回收站 = 测试根下的 $Recycle.Bin 目录；更新忙 = 测试根下有 .wu-busy 文件。 */
export interface TestSystemOps extends SystemOps {
  /** 点过的系统方式（测试断言用）。 */
  launched: SystemAction[];
}

/** 目录里所有普通文件的总字节（不跟随链接）。 */
function folderBytes(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) total += fs.lstatSync(path).size;
    }
  }
  return total;
}

/** 测试模式的系统能力：只在测试根里模拟，不调任何系统命令。 */
export function testSystemOps(places: CleanPlaces): TestSystemOps {
  const root = places.test;
  if (!root) throw new Error('测试系统能力只能在测试模式下使用');
  const bin = join(root, '$Recycle.Bin');
  const launched: SystemAction[] = [];
  return {
    launched,
    recycleBinBytes: async () => (fs.existsSync(bin) ? folderBytes(bin) : 0),
    clearRecycleBin: async () => {
      if (fs.existsSync(bin)) {
        for (const name of fs.readdirSync(bin)) fs.rmSync(join(bin, name), { recursive: true, force: true });
      }
    },
    deliveryCacheBytes: async () => null,
    windowsUpdateBusy: async () => fs.existsSync(join(root, '.wu-busy')),
    launch: async (action) => {
      launched.push(action);
    },
  };
}
