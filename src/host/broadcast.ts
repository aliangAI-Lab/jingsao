/** 校验第三方气泡文本、图片地址和宠物归属，生成状态写入结果。 */
import { findPetInstance } from './config.ts';
// url 参数的 scheme 规则与 /anim 是同一条（两个「第三方投喂」端点不各写一份，免得走样）
import { normalizeHttpUrl } from './anim.ts';

/** 气泡默认显示时长（ms）——与两端消费侧的常量同值（host 不得 import src/shared，只能各写一份）。
 *  它只用于把缺省解析成显式值写进叶子，让 /state 里能看到实际生效的时长。 */
const DEFAULT_BUBBLE_DURATION_MS = 10 * 1000;

/** pet 参数解析失败的两种分类（三个「pet 必填」端点共用这一对词汇，与 ./anim、./motion-cue 同口径）。 */
export type PetFailure = 'pet-required' | 'unknown-pet';

/** 投喂失败的分类（路由原样透出给调用方）。 */
export type BroadcastFailure = 'bad-request' | PetFailure;

export type BroadcastDecision =
  | { ok: true; petId: string; text: string; url?: string; duration: number; anim: boolean }
  | { ok: false; reason: BroadcastFailure; message: string };

/** 清空气泡的决策结论（只有宠物解析这一步会失败）。 */
export type BubbleClearDecision = { ok: true; petId: string } | { ok: false; reason: PetFailure; message: string };

/** 投喂文本规范化：非字符串 / 纯空白 → 空串。
 *  路由与决策层共用这一条规则，免得为了一个必然失败的请求去读配置。 */
export function normalizeBroadcastText(text: unknown): string {
  return typeof text === 'string' ? text.trim() : '';
}

/** 气泡时长规范化：缺省 / null → 默认 10s；合法则原样；非法（非数字 / 非有限 / 负数）返回 null。
 *  路由先用它短路，别为一个必然失败的请求去碰磁盘；0 合法，字面意思「不显示」。 */
export function normalizeBroadcastDuration(duration: unknown): number | null {
  if (duration === undefined || duration === null) return DEFAULT_BUBBLE_DURATION_MS;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null;
  return duration;
}

/** 动画联动开关规范化：只有严格 false 才关闭，其余一律按「要联动」。
 *  宽松是有意的：老调用方不会传这个字段，宽松口径保证它们的行为一个字都不变。 */
export function normalizeBroadcastAnim(anim: unknown): boolean {
  return anim !== false;
}

/** 播报开关规范化：只有严格 `true` 才念，其余（含 `"true"` 字符串）一律不念。
 *  缺省不念是有意的：投喂的文本与时机都由调用方决定，默认不该出声——否则任何一次
 *  高频投喂都会变成持续朗读，而调用方往往意识不到自己打开了扬声器。 */
export function normalizeBroadcastVoice(speak: unknown): boolean {
  return speak === true;
}

/**
 * `?pet=` → 实际落点（与 ./anim、./motion-cue 同一口径）：必填且必须真实存在。
 *
 * 两种失败分开报（绝不默认退到列表第一只）：没给 → pet-required，给了但配置里没有 → unknown-pet。
 */
function resolvePetId(
  cfg: Record<string, Record<string, unknown>>,
  requested: string,
):
  | { ok: true; petId: string; entry: string; conf: Record<string, unknown> }
  | { ok: false; reason: PetFailure; message: string } {
  const petId = String(requested ?? '').trim();
  if (!petId) return { ok: false, reason: 'pet-required', message: 'pet 必填：要指定操作哪只桌宠' };

  const found = findPetInstance(cfg, petId);
  if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
  return { ok: true, petId, entry: found.entry, conf: found.conf };
}

export function decideBroadcast(args: {
  cfg: Record<string, Record<string, unknown>>;
  /** `?pet=` 的原值（必填：空串 → pet-required） */
  requested: string;
  text: unknown;
  url: unknown;
  duration: number;
  anim: boolean;
}): BroadcastDecision {
  const { cfg, requested } = args;

  const text = normalizeBroadcastText(args.text);
  if (!text) return { ok: false, reason: 'bad-request', message: 'text 为空' };

  const who = resolvePetId(cfg, requested);
  if (!who.ok) return { ok: false, reason: who.reason, message: who.message };
  const petId = who.petId;

  const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
  if (!rawUrl) return { ok: true, petId, text, duration: args.duration, anim: args.anim };

  // 自己表现（图裂），宿主不做代理、也不预取，所以这里没有可校验的「图是否真实存在」。
  if (rawUrl) {
    const url = normalizeHttpUrl(rawUrl);
    if (url === null) {
      return { ok: false, reason: 'bad-request', message: 'url 必须是 http/https 的完整地址' };
    }
    return { ok: true, petId, text, url, duration: args.duration, anim: args.anim };
  }

  return { ok: true, petId, text, duration: args.duration, anim: args.anim };
}

/**
 * 清空气泡的决策：只需要确定「清哪只宠物的」。
 *
 * 占用门禁不在这里：「谁有资格清」由路由层在它之后过一遍锁，没带 lock 时那一步恒放行。
 * 与投喂的区别是没有「气泡不存在」这种失败：当前没气泡也返回 ok（幂等）。
 */
export function decideBubbleClear(args: {
  cfg: Record<string, Record<string, unknown>>;
  /** `?pet=` 的原值（必填：空串 → pet-required） */
  requested: string;
}): BubbleClearDecision {
  const who = resolvePetId(args.cfg, args.requested);
  if (!who.ok) return { ok: false, reason: who.reason, message: who.message };
  return { ok: true, petId: who.petId };
}
