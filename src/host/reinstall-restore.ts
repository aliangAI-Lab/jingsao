/**
 * 重新安装后把鲸鱼娘叫回桌面。
 *
 * 用户数据目录（DSH_HOME/jingsao：配置、收起记录）在卸载时不会被删。卸载前点过「收起鲸鱼娘」的人，
 * 重装后读到的仍是 display = none，于是装完桌面上什么都没有，要重启 DSH 或输 /jingsao 才回来。
 *
 * 判定「这是一次新安装」：插件包目录的创建时刻（安装器每次都会新建这个目录）与上次记下的不同。
 * 是新安装、且有宠物处于 none（全部收起）时，把它们的收起记录改成 desktop，再走一遍和 /jingsao
 * 同一条「叫回」路由——写配置、清收起记录、重启桌面 Helper 都复用那条串行链，不另写一套。
 * 只动 none 的宠物：用户刻意选的「只在网页」不会被改。叫回失败时不记新时刻，下次启动再试。
 * @module jingsao/src/host/reinstall-restore
 */
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROUTE_SEGMENT } from '../shared/constants.ts';
import { flattenPetList, readAllConfig, type ConfigPaths } from './config.ts';
import { hideRecordsPath, readHideRecords, writeHideRecords } from './hide-records.ts';
import type { HttpRouteHandler } from './plugin/http-route.ts';

/** 记录上次见过的安装时刻的文件。 */
export const installStampPath = (userRoot: string): string => join(userRoot, 'install-stamp.json');

/** 插件包目录的创建时刻（毫秒，取整成字符串）；拿不到创建时刻的文件系统退回 ctime。 */
export function installStampOf(packageRoot: string): string {
  const st = statSync(realpathSync(packageRoot));
  return String(Math.round(st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs));
}

/** 重装检查的结果（只用于日志与测试）。 */
export type ReinstallRestoreResult = 'same-install' | 'nothing-hidden' | 'restored' | 'failed';

/** 依赖：都由 index.ts 装配好传进来，测试注入假的。 */
export interface ReinstallRestoreDeps {
  userRoot: string;
  packageRoot: string;
  configPaths: ConfigPaths;
  /** HTTP 路由同一份处理函数（叫回走 POST /pet-restore）。 */
  handle: HttpRouteHandler;
  log: { info?: (message: string) => void; warn?: (message: string) => void };
}

function readPreviousStamp(path: string): string {
  try {
    const stamp = (JSON.parse(readFileSync(path, 'utf8')) as { stamp?: unknown }).stamp;
    return typeof stamp === 'string' ? stamp : '';
  } catch {
    return '';
  }
}

function writeStamp(path: string, stamp: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ stamp }), 'utf8');
}

/**
 * 是新安装就把全部收起的鲸鱼娘叫回桌面（见模块说明）。
 */
export async function restoreAfterReinstall(deps: ReinstallRestoreDeps): Promise<ReinstallRestoreResult> {
  const { userRoot, packageRoot, configPaths, handle, log } = deps;
  let stamp: string;
  try {
    stamp = installStampOf(packageRoot);
  } catch {
    return 'same-install'; // 认不出是不是新安装：什么都不动
  }
  const stampPath = installStampPath(userRoot);
  if (readPreviousStamp(stampPath) === stamp) return 'same-install';
  try {
    const hidden = flattenPetList(readAllConfig(configPaths))
      .filter((pet) => pet.display === 'none')
      .map((pet) => String(pet.id));
    if (hidden.length > 0) {
      const recordsPath = hideRecordsPath(userRoot);
      const records = await readHideRecords(recordsPath);
      for (const id of hidden) {
        // defineProperty：宠物 id 是用户写的，避免 "__proto__" 这类 id 改到原型上（与收起路由同一写法）
        Object.defineProperty(records, id, { value: 'desktop', enumerable: true, configurable: true, writable: true });
      }
      await writeHideRecords(recordsPath, records);
      const result = await handle(ROUTE_SEGMENT + '/pet-restore', 'POST', '{}');
      if (!(result.kind === 'json' && (result.obj as { ok?: boolean }).ok === true)) {
        log.warn?.('[jingsao] 重新安装后叫回鲸鱼娘失败，下次启动再试');
        return 'failed';
      }
      log.info?.(`[jingsao] 检测到重新安装：已把收起的鲸鱼娘叫回桌面（${hidden.join('、')}）`);
    }
    writeStamp(stampPath, stamp);
    return hidden.length > 0 ? 'restored' : 'nothing-hidden';
  } catch (e) {
    log.warn?.(`[jingsao] 重新安装检查失败：${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  }
}
