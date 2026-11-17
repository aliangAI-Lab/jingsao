/** 收起与恢复动作统一经配置队列执行，先持久化原显示位置再改配置。 */
import { setTimeout as delay } from 'node:timers/promises';
import { hiddenDisplay, restoredDisplay, type HideSurface } from '../../shared/pet-hide.ts';
import type { PetDisplay } from '../../shared/types.ts';
import { readAllConfig } from '../config.ts';
import { hideRecordsPath, readHideRecords, writeHideRecords } from '../hide-records.ts';
import type { RouteResult } from '../http.ts';
import { setPetDisplay } from './config/display.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/** 收起时给气泡预留的展示时间，单位毫秒。 */
const HIDE_DELAY_MS = 1500;

/** 收起、叫回与退出桌面共用同一条持久化链，业务失败回 200。 */
export async function handleHideRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest, method } = input;
  if (!(rest === 'pet-hide' || rest === 'pet-restore' || rest === 'desktop-exit')) return undefined;
  if (method !== 'POST') return methodNotAllowed();
  let payload: { id?: unknown; surface?: unknown };
  try {
    const parsed: unknown = JSON.parse(input.body ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return failResult('bad-request', '请求体必须是对象');
    payload = parsed;
  } catch {
    return invalidJson();
  }
  const surface = rest === 'desktop-exit' ? 'desktop' : (payload.surface ?? 'both');
  if (surface !== 'web' && surface !== 'desktop' && surface !== 'both')
    return failResult('bad-request', 'surface 必须是 web / desktop / both');
  if (payload.id !== undefined && (typeof payload.id !== 'string' || !payload.id.trim()))
    return failResult('pet-required', 'id 必须是非空字符串');
  try {
    return await changeVisibility(
      deps,
      input,
      surface,
      rest !== 'desktop-exit' && typeof payload.id === 'string' ? payload.id.trim() : undefined,
    );
  } catch (error) {
    deps.log.warn('[jingsao] 收起或恢复失败：' + String(error));
    return failResult('generate-error', '收起或恢复失败，请重试');
  }
}

/** 多宠物依次落盘，成功的恢复项即时移除记录，失败项保留供重试。 */
async function changeVisibility(
  deps: PetRouteDeps,
  input: RouteInput,
  surface: HideSurface,
  id?: string,
): Promise<RouteResult> {
  const merged = readAllConfig(deps.configPaths);
  const path = hideRecordsPath(deps.userRoot);
  const records = await readHideRecords(path);
  const restoring = input.rest === 'pet-restore';
  const pets = Object.values(merged).flatMap((conf) =>
    (conf.pets as Record<string, unknown>[]).map((pet) => ({ pet, conf })),
  );
  if (id && !pets.some(({ pet }) => pet.id === id)) return failResult('unknown-pet', '没有这只桌宠：' + id);
  const targets = pets.filter(
    ({ pet }) =>
      (!id || pet.id === id) &&
      (restoring
        ? Object.prototype.hasOwnProperty.call(records, String(pet.id)) || pet.display === 'none'
        : hiddenDisplay(pet.display as PetDisplay, surface) !== pet.display),
  );
  if (!restoring) {
    for (const { pet } of targets) {
      if (!Object.prototype.hasOwnProperty.call(records, String(pet.id)))
        Object.defineProperty(records, String(pet.id), {
          value: pet.display,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    await writeHideRecords(path, records);
    for (const { pet, conf } of targets) {
      const pool = conf.hideTexts as string[];
      deps.state.writePet(String(pet.id), 'say', {
        text: pool[Math.floor(Math.random() * pool.length)],
        duration: HIDE_DELAY_MS,
        anim: false,
      });
    }
    if (targets.length) await delay(HIDE_DELAY_MS);
  }
  // 批量操作期间只写配置，末尾统一重启，避免每只宠物都重建一次 Helper。
  const batchDeps = { ...deps, requestRestart: async () => {} };
  try {
    for (const { pet } of targets) {
      const petId = String(pet.id);
      const display = restoring
        ? restoredDisplay(Object.prototype.hasOwnProperty.call(records, petId) ? records[petId] : undefined)
        : hiddenDisplay(pet.display as PetDisplay, surface);
      const result = await setPetDisplay(batchDeps, { ...input, body: JSON.stringify({ id: petId, display }) });
      if (result.kind !== 'json' || (result.obj as { ok?: boolean }).ok === false) return result;
      if (restoring) {
        delete records[petId];
        await writeHideRecords(path, records);
      }
    }
    if (input.rest === 'desktop-exit') deps.suspendDesktopTray?.();
    return okResult({ ok: true });
  } finally {
    void deps.requestRestart();
  }
}
