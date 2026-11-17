/**
 * 「打开清理面板」的去向判定（AI 工具与 POST /clean/open 共用）：在用户看得见的那只鲸鱼娘旁边打开。
 *
 * 顺序：
 * 1. 网页在线且页面可见（最近约 3 秒内上报过 visible=1）、并且有宠物在网页端显示（web / both）→ 网页浮层；
 * 2. 否则桌面 Helper 在线、并且有宠物在桌面显示（desktop / both）→ 桌面小窗（贴着那只桌面鲸鱼娘）；
 * 3. 否则网页在线 → 网页浮层（兜底：用户切回 DSH 时能看到；全部收起时面板顶部有「叫她回来」）；
 * 4. 否则宠物全部收起 → pet-hidden；两端都不在线 → surface-offline。
 * 右键菜单不经过这里：在哪一端右键就在哪一端弹。
 *
 * 在线与否按 /state 轮询续租判断：网页轮询带 `surface=web&visible=0|1`（visible = document.visibilityState），
 * 桌面 Helper 带 `surface=desktop`，第三方不带参数的轮询不计入任何一端。两端都是 1 秒级长轮询：
 * 在线租约 15 秒；「页面可见」只认 3 秒内的上报（最小化或切走后浏览器会节流，过期就当看不见）。
 * 判定结果写进 /state 的 clean 段（`{ open, target }`），由对应一端消费；本模块只写信号，
 * 不碰清理任务本身（任务在 ./clean/service，与面板开在哪无关）。
 * @module jingsao/src/host/clean-open
 */
import { flattenPetList, readAllConfig } from './config.ts';
import { failureBody } from './routes/result.ts';
import type { PetRouteDeps } from './routes/types.ts';
import type { PollStateStore } from './state.ts';

/** 轮询续租时长：两端都是 1 秒级长轮询，15 秒没来就当这一端不在线（与页面侧丢弃旧请求的窗口同值）。 */
export const CLEAN_SURFACE_LEASE_MS = 15_000;

/** 会打开清理面板的两端。 */
export type CleanSurface = 'web' | 'desktop';

/** 「网页可见」的上报有效期：超过这么久没再上报 visible=1 就当用户看不见网页。 */
export const CLEAN_VISIBLE_LEASE_MS = 3_000;

/** 每个状态仓库各记一份两端最近一次轮询的时刻（WeakMap：测试各建各的仓库，互不串）。 */
const lastSeen = new WeakMap<PollStateStore, Partial<Record<CleanSurface, number>>>();

/** 网页最近一次上报「页面可见」的时刻（上报 hidden 时清掉）。 */
const lastVisible = new WeakMap<PollStateStore, number>();

/** 打开请求的结果：成功带去向；失败是统一的失败实体。 */
export type CleanOpenResult =
  { ok: true; target: CleanSurface } | { ok: false; reason: 'pet-hidden' | 'surface-offline'; message: string };

/** 把 /state 的 surface 查询参数认成一端；不认识的值（含缺省）返回 null。 */
export function cleanSurfaceOf(value: string | null): CleanSurface | null {
  return value === 'web' || value === 'desktop' ? value : null;
}

/** /state 的 visible 查询参数：'1' 可见、'0' 看不见；缺省（老页面）返回 undefined。 */
export function cleanVisibleOf(value: string | null): boolean | undefined {
  return value === '1' ? true : value === '0' ? false : undefined;
}

/**
 * 一端来轮询了一次：续租。网页额外记「页面是否可见」；没带 visible 的老页面按可见处理（保持老行为）。
 */
export function touchCleanSurface(
  state: PollStateStore,
  surface: CleanSurface,
  now = Date.now(),
  visible?: boolean,
): void {
  const seen = lastSeen.get(state) ?? {};
  seen[surface] = now;
  lastSeen.set(state, seen);
  if (surface !== 'web') return;
  if (visible === false) lastVisible.delete(state);
  else lastVisible.set(state, now);
}

/** 网页此刻是否可见（3 秒内上报过 visible=1）。 */
function webVisible(state: PollStateStore, now: number): boolean {
  const at = lastVisible.get(state);
  return at !== undefined && now - at < CLEAN_VISIBLE_LEASE_MS;
}

/** 这一端是否在线（租约内来过）。 */
function isOnline(state: PollStateStore, surface: CleanSurface, now: number): boolean {
  const at = lastSeen.get(state)?.[surface];
  return at !== undefined && now - at < CLEAN_SURFACE_LEASE_MS;
}

/** 每一端有没有宠物在显示；配置读不出来时两端都按「有」算、也不下「全部收起」的结论。 */
function petDisplays(deps: Pick<PetRouteDeps, 'configPaths'>): { web: boolean; desktop: boolean; allHidden: boolean } {
  try {
    const displays = flattenPetList(readAllConfig(deps.configPaths)).map((pet) => String(pet.display ?? ''));
    return {
      web: displays.some((d) => d === 'web' || d === 'both'),
      desktop: displays.some((d) => d === 'desktop' || d === 'both'),
      allHidden: displays.every((d) => d === 'none'),
    };
  } catch {
    return { web: true, desktop: true, allHidden: false };
  }
}

/**
 * 发出一次「打开清理面板」：在用户看得见的那只鲸鱼娘旁边打开（顺序见模块说明）。
 */
export function requestCleanOpen(deps: Pick<PetRouteDeps, 'state' | 'configPaths'>, now = Date.now()): CleanOpenResult {
  const shown = petDisplays(deps);
  const webOnline = isOnline(deps.state, 'web', now);
  let target: CleanSurface;
  if (webOnline && webVisible(deps.state, now) && shown.web) target = 'web';
  else if (isOnline(deps.state, 'desktop', now) && shown.desktop) target = 'desktop';
  else if (webOnline) target = 'web';
  else if (shown.allHidden) {
    return failureBody('pet-hidden', '鲸鱼娘都收起来了，也没有打开的网页，面板没有地方弹出来') as CleanOpenResult;
  } else return failureBody('surface-offline', '网页和桌面鲸鱼娘都不在线，面板没有地方弹出来') as CleanOpenResult;
  deps.state.writeSection('clean', { open: now, target });
  return { ok: true, target };
}

/** 给对话里的 AI 看的结果：成功时补一句人话，方便它如实转告用户；失败实体本身已带 message。 */
export function describeCleanOpen(result: CleanOpenResult): CleanOpenResult & { message: string } {
  if (!result.ok) return result;
  return {
    ...result,
    message:
      result.target === 'web'
        ? '已经在网页里的鲸鱼娘旁边打开「C盘清理」面板，请用户亲自查看和确认。'
        : '已经在桌面鲸鱼娘旁边弹出「C盘清理」小窗，请用户亲自查看和确认。',
  };
}
