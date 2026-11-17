/**
 * C 盘清理路由：`/clean/...`。清理面板（网页浮层 / 右侧栏 / 桌面小窗）与「打开面板」请求都走这里。
 *
 * `GET /clean/page`、`GET /clean/page.js` 是桌面小窗加载的独立页（见 ./clean-page）；
 * `POST /clean/open` 按「网页在线 → 浮层，只有桌面 → 小窗，全部收起 → pet-hidden」分流（见 ../clean-open）。
 *
 * 只做输入形状校验与错误归一，业务全在 ../clean/service。所有改动类请求都是「开一个任务、立即返回」，
 * 进度与结果由 GET /clean/status 轮询；页面只能提交扫描结果里的 id，不能提交路径。
 * 任何业务失败一律 200 + { ok: false, reason: 'clean-failed', code, message }，与其它路由同口径。
 * @module jingsao/src/host/routes/clean
 */
import { cleanPageResource } from './clean-page.ts';
import { requestCleanOpen } from '../clean-open.ts';
import { CLEAN_FEATURES, CleanError, type CleanService } from '../clean/service.ts';
import type { CleanFeature } from '../clean/types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult, payloadTooLarge } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/** 请求体上限：最多几万个 id，256 KiB 足够。 */
const BODY_MAX_BYTES = 256 * 1024;

/** 解析 JSON 对象请求体；不是对象 → null。 */
function parseBody(body: string | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 取合法的功能名。 */
function featureOf(value: unknown): CleanFeature | null {
  return typeof value === 'string' && (CLEAN_FEATURES as readonly string[]).includes(value)
    ? (value as CleanFeature)
    : null;
}

/** 取字符串数组（id 列表）；形状不对 → null。 */
function idsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v === '' || v.length > 200)) return null;
  return value as string[];
}

/** 可选的非负数字。 */
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 业务错误 → 统一失败实体。 */
function failed(error: unknown): RouteResult {
  if (error instanceof CleanError) return failResult('clean-failed', error.message, { code: error.code });
  return failResult('clean-failed', error instanceof Error ? error.message : String(error), { code: 'internal' });
}

/** 清理领域：未命中返回 undefined，命中返回应答。 */
export async function handleCleanRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest, method, url, body } = input;
  if (rest !== 'clean' && !rest.startsWith('clean/')) return undefined;
  const clean: CleanService = deps.clean;
  const action = rest.slice('clean/'.length);

  if (method === 'GET') {
    // 桌面小窗的独立页：HTML 壳与打包好的面板脚本（只读）
    const page = cleanPageResource(action);
    if (page) return page;
    if (action === 'status') return okResult({ ok: true, ...clean.status() });
    if (action === 'result') {
      const feature = featureOf(url.searchParams.get('feature'));
      if (!feature) return failResult('bad-request', 'feature 不合法');
      if (feature === 'software') return okResult({ ok: true, software: clean.softwareEntries() });
      return okResult({ ok: true, result: clean.result(feature) });
    }
    return methodNotAllowed();
  }
  if (method !== 'POST') return methodNotAllowed();
  if (Buffer.byteLength(body ?? '', 'utf8') > BODY_MAX_BYTES) return payloadTooLarge();
  const o = parseBody(body);
  if (o === null) return invalidJson();

  try {
    switch (action) {
      case 'open':
        // 打开面板：只写一次带去向的打开信号（/state 的 clean 段），由网页浮层或桌面 Helper 消费。
        return okResult(requestCleanOpen(deps));
      case 'scan': {
        const feature = featureOf(o.feature);
        if (!feature) return failResult('bad-request', 'feature 不合法');
        const minSize = optionalNumber(o.minSize);
        const olderThanDays = optionalNumber(o.olderThanDays);
        const extraRoots = idsOf(o.extraRoots ?? []);
        const job = clean.startScan(feature, {
          ...(minSize === undefined ? {} : { minSize }),
          ...(olderThanDays === undefined ? {} : { olderThanDays }),
          ...(extraRoots && extraRoots.length ? { extraRoots } : {}),
        });
        return okResult({ ok: true, job });
      }
      case 'cancel':
        clean.cancel();
        return okResult({ ok: true });
      case 'run': {
        // 立即清理：直接删除（垃圾 / 微信QQ / 重复文件），宿主接受后页面即可关窗
        const feature = featureOf(o.feature);
        const ids = idsOf(o.ids ?? []);
        const categories = idsOf(o.categories ?? []);
        if (!feature || !ids || !categories) return failResult('bad-request', 'feature / ids / categories 不合法');
        return okResult({ ok: true, job: clean.clean(feature, ids, categories) });
      }
      case 'legacy': {
        // 上个版本暂存区的遗留数据：彻底删除 / 原样放回
        if (o.mode !== 'purge' && o.mode !== 'restore')
          return failResult('bad-request', 'mode 只能是 purge 或 restore');
        return okResult({ ok: true, job: clean.settleLegacy(o.mode) });
      }
      case 'system-action': {
        // 只报告的系统大块头：打开系统自带的清理方式，由用户在系统界面里确认
        if (o.action !== 'winsxs' && o.action !== 'windows-old') {
          return failResult('bad-request', 'action 只能是 winsxs 或 windows-old');
        }
        await clean.systemAction(o.action);
        return okResult({ ok: true });
      }
      case 'move': {
        const ids = idsOf(o.ids);
        if (!ids || typeof o.dest !== 'string') return failResult('bad-request', 'ids / dest 不合法');
        return okResult({ ok: true, job: clean.moveBigFiles(ids, o.dest) });
      }
      case 'move/restore': {
        const ids = idsOf(o.ids);
        if (!ids) return failResult('bad-request', 'ids 不合法');
        return okResult({ ok: true, job: clean.restoreBigFiles(ids) });
      }
      case 'software/move':
        if (typeof o.id !== 'string' || typeof o.dest !== 'string')
          return failResult('bad-request', 'id / dest 不合法');
        return okResult({ ok: true, job: clean.moveSoftware(o.id, o.dest) });
      case 'software/restore':
        if (typeof o.id !== 'string') return failResult('bad-request', 'id 不合法');
        return okResult({ ok: true, job: clean.restoreSoftware(o.id) });
      case 'reveal': {
        const feature = featureOf(o.feature);
        if (!feature || typeof o.id !== 'string') return failResult('bad-request', 'feature / id 不合法');
        clean.reveal(feature, o.id);
        return okResult({ ok: true });
      }
      default:
        return failResult('bad-request', '未知的清理动作');
    }
  } catch (error) {
    return failed(error);
  }
}
