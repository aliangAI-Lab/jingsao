/**
 * 清理面板的请求层：只包 /clean/* 的几个调用，返回形状与宿主 ../../host/clean/service 对齐。
 *
 * 失败统一变成 { ok: false, message }，面板直接把 message 给人看；网络错误也走同一条路。
 * @module jingsao/src/client/clean/api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type {
  CleanFeature,
  CleanProgress,
  CleanScanResult,
  LegacyStagingSummary,
  MoveRecord,
  SoftwareEntry,
} from '../../host/clean/types.ts';

export type {
  CleanCategory,
  CleanFeature,
  CleanItem,
  CleanRunOutcome,
  CleanScanResult,
  LegacyStagingSummary,
  MoveRecord,
  SoftwareEntry,
} from '../../host/clean/types.ts';

/** 宿主任务（与 host CleanJob 同形，页面只读）。 */
export interface CleanJobView {
  id: string;
  feature: CleanFeature;
  action: string;
  startedAt: number;
  finishedAt?: number;
  /** 预计处理的字节（清理 = 勾选总量，搬家 = 搬走总量）。 */
  estimateBytes?: number;
  progress: CleanProgress;
  outcome?: unknown;
  error?: string;
}

/** 搬家目标盘。 */
export interface DriveView {
  root: string;
  total: number | null;
  free: number | null;
}

/** GET /clean/status。 */
export interface CleanStatusView {
  disk: { root: string; total: number | null; free: number | null };
  job: CleanJobView | null;
  scans: Partial<Record<CleanFeature, { scanId: string; finishedAt: number; totalBytes: number }>>;
  /** 上个版本暂存区里还留着的东西；没有为 null。 */
  legacy: LegacyStagingSummary | null;
  moves: MoveRecord[];
  drives: DriveView[];
  readOnly: boolean;
}

/** 调用结果。 */
export type Reply<T> = ({ ok: true } & T) | { ok: false; message: string };

/** 发请求并归一失败。 */
async function call<T>(path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(ROUTE_PATH + '/clean/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (data.ok === true) return data as { ok: true } & T;
    return { ok: false, message: data.message ?? `请求失败（${res.status}）` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 状态快照。 */
export const fetchStatus = (): Promise<Reply<CleanStatusView>> => call<CleanStatusView>('status');

/** 某功能的完整扫描结果。 */
export const fetchResult = (feature: CleanFeature): Promise<Reply<{ result: CleanScanResult | null }>> =>
  call('result?feature=' + feature);

/** 软件列表。 */
export const fetchSoftware = (): Promise<Reply<{ software: SoftwareEntry[] }>> => call('result?feature=software');

/** 开始扫描。 */
export const startScan = (
  feature: CleanFeature,
  options: { minSize?: number; olderThanDays?: number; extraRoots?: string[] } = {},
): Promise<Reply<{ job: CleanJobView }>> => call('scan', { feature, ...options });

/** 取消当前任务。 */
export const cancelJob = (): Promise<Reply<object>> => call('cancel', {});

/** 立即清理：直接删除（不进回收站、不进暂存区）。 */
export const runClean = (
  feature: CleanFeature,
  ids: string[],
  categories: string[],
): Promise<Reply<{ job: CleanJobView }>> => call('run', { feature, ids, categories });

/** 上个版本暂存区的遗留数据：彻底删除 / 原样放回。 */
export const settleLegacy = (mode: 'purge' | 'restore'): Promise<Reply<{ job: CleanJobView }>> =>
  call('legacy', { mode });

/** 只报告的系统大块头：用系统方式清理（打开系统自带的入口）。 */
export const systemAction = (action: 'winsxs' | 'windows-old'): Promise<Reply<object>> =>
  call('system-action', { action });

/** 大文件搬家。 */
export const moveFiles = (ids: string[], dest: string): Promise<Reply<{ job: CleanJobView }>> =>
  call('move', { ids, dest });

/** 大文件搬回。 */
export const restoreFiles = (ids: string[]): Promise<Reply<{ job: CleanJobView }>> => call('move/restore', { ids });

/** 软件搬家 / 搬回。 */
export const softwareAction = (
  action: 'move' | 'restore',
  id: string,
  dest?: string,
): Promise<Reply<{ job: CleanJobView }>> => call('software/' + action, { id, ...(dest === undefined ? {} : { dest }) });

/** 在资源管理器里定位。 */
export const reveal = (feature: CleanFeature, id: string): Promise<Reply<object>> => call('reveal', { feature, id });

/** 字节 → 给人看的大小。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes >= 1024 ** 4) return (bytes / 1024 ** 4).toFixed(2) + ' TB';
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  if (bytes >= 1024 ** 2) return Math.round(bytes / 1024 ** 2) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
