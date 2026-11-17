/**
 * 清理事件 → 鲸鱼娘的反应：「吸入 → 打嗝 → 推容量条」与气泡。
 *
 * 宿主驱动、两端渲染器照播（写 pets.<id>.anim 的分段指令，见 shared/state 的 readAnim）：
 * - 任务开始（清理 / 搬家 / 彻底删除遗留暂存）：吸入-开始（一次）→ 吸入-循环-<档>（一直循环，直到下一条指令）；
 * - 任务成功：打嗝（一次，气泡「嗝～」）→ 推容量条-<档>（一次，档位按实际释放量重算）→ 回待机；
 *   推完时气泡「吃掉了 46.2 GB，C 盘喘口气了～」（真实数字），有文件被跳过等情况再补一句；
 * - 失败或取消：停循环，播 工作状态-垂头叹气冒汗，气泡说明原因并提示「右键 → 清理C盘 看详情」。
 * 档位：< 1 GB 小，1–10 GB 中，≥ 10 GB 大。
 *
 * 动作优先用条目配置的 animations.events.cleanSwallow；老配置没有这一段（或某段素材缺失）时退回
 * 老动画 清理-打扫中 / 清理-搬家（循环）与 清理-推容量条，再没有就退回工作状态动作，换了宠物种类也不报错。
 * 被第三方占用锁、正在睡觉、display = none 的宠物不播（结果下次打开面板时看）；只给开始时播了吸入的宠物收尾。
 * 只决定「说什么、播哪段」，不碰文件。
 * @module jingsao/src/host/clean/pet-fx
 */
import { animationNames } from '../anim.ts';
import { findPetInstance } from '../config/read.ts';
import type { CleanEvent, CleanJobAction } from './service.ts';
import type { CleanFeature } from './types.ts';

/** 气泡停留时长（毫秒）：清理结果要让人看清数字。 */
const BUBBLE_MS = 9000;
/** 「嗝～」气泡的停留时长。 */
const BURP_BUBBLE_MS = 2500;
/** 打嗝与推容量条的素材时长（毫秒）：推完时才冒结果气泡。 */
export const BURP_MS = 2000;
export const PUSH_MS = 6000;
/** 吸入至少演这么久再打嗝（吸入-开始 1.5 秒 + 一轮循环 2 秒）：清得太快时不至于一闪而过。 */
export const MIN_SWALLOW_MS = 3500;
/** 失败或取消时的动作。 */
const SIGH = '工作状态-垂头叹气冒汗';

/** 清理量分档。 */
export type CleanSizeTier = 'small' | 'medium' | 'large';

/** 字节 → 档位：< 1 GB 小，1–10 GB 中，≥ 10 GB 大。 */
export function sizeTier(bytes: number): CleanSizeTier {
  if (bytes >= 10 * 1024 ** 3) return 'large';
  if (bytes >= 1024 ** 3) return 'medium';
  return 'small';
}

/** 依赖：都是宿主现成的能力，测试注入假的。 */
export interface CleanFxDeps {
  /** 完成品配置聚合（条目 key → 条目配置）。 */
  readConfig: () => Record<string, Record<string, unknown>>;
  /** 当前全部宠物实例（拍平后）。 */
  effectivePetList: () => Record<string, unknown>[];
  /** 写宠物状态叶子（anim / say）。 */
  writePet: (petId: string, key: string, data: Record<string, unknown>) => void;
  /** 建一条播放记录，返回 playbackId（与 /anim 同一口径）。 */
  createPlayback: (petId: string, name: string) => string;
  /** 被第三方占用。 */
  locked: (petId: string) => boolean;
  /** 正在睡觉。 */
  sleeping: (petId: string) => boolean;
  /** 延时执行（推完时冒结果气泡）；测试注入同步的假定时器。 */
  schedule?: (fn: () => void, ms: number) => void;
  /** 随机源（候选里抽一个）；测试注入固定值。 */
  random?: () => number;
  /** 当前时刻（毫秒）；测试注入假时钟。 */
  now?: () => number;
}

/** 字节 → 「46.2 GB」这类给人看的写法。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  if (bytes >= 1024 ** 2) return Math.round(bytes / 1024 ** 2) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

/** 扫描开始时的台词。 */
const SCAN_START: Record<CleanFeature, string> = {
  junk: '我来翻翻 C 盘，看看哪些是垃圾～',
  chat: '看看微信和 QQ 偷偷囤了多少图片视频…',
  duplicates: '找找有没有一模一样的文件…',
  bigfiles: '找找又大又占地方的文件…',
  software: '看看哪些软件能搬去别的盘住…',
};

/** 动手开始时的台词。 */
const WORK_START: Partial<Record<CleanJobAction, string>> = {
  clean: '张嘴～全部吸进来！',
  'legacy-purge': '上次暂存的那些，我一口吃掉～',
  move: '嘿咻嘿咻，吸起来搬到别的盘去～',
  'software-move': '整个软件搬家中，这会儿先别打开它哦',
};

/** 会播「吸入」的动作：真的在给 C 盘腾地方的任务。 */
const SWALLOW_ACTIONS: ReadonlySet<CleanJobAction> = new Set(['clean', 'legacy-purge', 'move', 'software-move']);

/** 「右键 → 清理C盘」看详情的提示。 */
const DETAIL_HINT = '右键 → 清理C盘 看详情';

/** 事件 → 气泡文本（开始、扫描、恢复类结果；清理成功的结果气泡另见 resultText）。 */
export function textFor(event: CleanEvent): string {
  switch (event.kind) {
    case 'scan-start':
      return SCAN_START[event.feature];
    case 'scan-done':
      if (event.feature === 'software') return '软件列表整理好了，挑一个搬吧～';
      return event.bytes > 0 ? `找到 ${formatBytes(event.bytes)} 可以收拾！` : '没找到要收拾的，这块挺干净～';
    case 'work-start':
      return WORK_START[event.action] ?? '开工啦～';
    case 'work-done':
      if (event.action === 'legacy-restore') return '上次暂存的文件都原样放回去了～';
      if (event.action === 'move-restore' || event.action === 'software-restore') return '已经原样放回去了～';
      return resultText(event.freedBytes ?? event.bytes, event.notes);
    case 'error':
      return `哎呀，出了点问题：${event.message}。${DETAIL_HINT}`;
    case 'cancelled':
      return `好，先停下了，已经清掉的不会回来。${DETAIL_HINT}`;
  }
}

/** 清理成功（推完容量条）时的气泡。 */
export function resultText(freedBytes: number, notes: readonly string[] = []): string {
  const head =
    freedBytes > 0 ? `吃掉了 ${formatBytes(freedBytes)}，C 盘喘口气了～` : '这次没吃到什么，C 盘本来就挺干净～';
  return [head, ...notes].join('\n');
}

/** cleanSwallow 的一套名字（已按宠物动画池过滤，可直接播）。 */
interface SwallowNames {
  start: string;
  loop: string;
  burp: string | null;
  push: string | null;
}

/** 从候选数组里挑一个存在于动画池里的；没有返回 null。 */
function pickFrom(value: unknown, names: readonly string[], random: () => number): string | null {
  const pool = Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string' && names.includes(n)) : [];
  return pool.length ? pool[Math.floor(random() * pool.length)]! : null;
}

/** 分档候选里挑一个。 */
function pickTier(value: unknown, tier: CleanSizeTier, names: readonly string[], random: () => number): string | null {
  return value && typeof value === 'object' ? pickFrom((value as Record<string, unknown>)[tier], names, random) : null;
}

/**
 * 按宠物配置定「吸入」用哪几段：cleanSwallow 齐全就用它；缺段或素材缺失退回老动画。
 * @param animations - 条目配置的 animations。
 * @param action - 任务种类（搬家的老回退动画是 清理-搬家）。
 * @param loopTier - 循环段的档位（按预计处理量）。
 */
export function swallowNames(
  animations: unknown,
  action: CleanJobAction,
  loopTier: CleanSizeTier,
  random: () => number = Math.random,
): SwallowNames | null {
  const names = animationNames(animations);
  const events =
    animations && typeof animations === 'object'
      ? (animations as { events?: Record<string, unknown> }).events
      : undefined;
  const set = events?.cleanSwallow as Record<string, unknown> | undefined;
  if (set && typeof set === 'object') {
    const start = pickFrom(set.start, names, random);
    const loop = pickTier(set.loop, loopTier, names, random);
    if (start && loop) {
      return {
        start,
        loop,
        burp: pickFrom(set.burp, names, random),
        push: pickTier(set.push, loopTier, names, random),
      };
    }
  }
  // 老配置：没有「开始」段，循环用打扫中 / 搬家，没有打嗝，推容量条不分档
  const moving = action === 'move' || action === 'software-move';
  const legacyLoop = [moving ? '清理-搬家' : '清理-打扫中', '工作状态-忙碌点按'].find((n) => names.includes(n));
  if (!legacyLoop) return null;
  return {
    start: legacyLoop,
    loop: legacyLoop,
    burp: null,
    push: names.includes('清理-推容量条') ? '清理-推容量条' : null,
  };
}

/** 推容量条那一段：按实际释放量重新分档。 */
function pushName(animations: unknown, tier: CleanSizeTier, random: () => number): string | null {
  const names = animationNames(animations);
  const events =
    animations && typeof animations === 'object'
      ? (animations as { events?: Record<string, unknown> }).events
      : undefined;
  const set = events?.cleanSwallow as Record<string, unknown> | undefined;
  const picked = set ? pickTier(set.push, tier, names, random) : null;
  if (picked) return picked;
  return ['清理-推容量条', '工作状态-雀跃庆祝'].find((n) => names.includes(n)) ?? null;
}

/** 扫描与恢复类事件的单段动作：[首选, 退路]。 */
function plainAnimation(event: CleanEvent): [string, string] {
  switch (event.kind) {
    case 'scan-start':
      return ['清理-扫描中', '工作状态-原地踱步张望'];
    case 'scan-done':
      return event.bytes > 0 ? ['工作状态-清点归档', '工作状态-清点归档'] : ['清理-大功告成', '工作状态-雀跃庆祝'];
    case 'work-start':
      return ['清理-打扫中', '工作状态-忙碌点按'];
    case 'work-done':
      return ['清理-大功告成', '工作状态-雀跃庆祝'];
    case 'error':
    case 'cancelled':
      return [SIGH, SIGH];
  }
}

/** 造一个事件处理器，交给 CleanService 的 onEvent。 */
export function createCleanFx(deps: CleanFxDeps): (event: CleanEvent) => void {
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  /** 这次任务开始时播了吸入的宠物 → 开始吸入的时刻：只给它们收尾（打嗝或叹气）。 */
  const swallowing = new Map<string, number>();
  /** 任务代数：等吸入演够时长期间又开了新任务，旧的收尾就作废。 */
  let generation = 0;

  /** 此刻能打扰的宠物（显示中、没被占用、没睡着），连同它的动画配置。 */
  const eligible = (): Array<{ petId: string; animations: unknown }> => {
    const cfg = deps.readConfig();
    const out: Array<{ petId: string; animations: unknown }> = [];
    for (const pet of deps.effectivePetList()) {
      const petId = String(pet.id ?? '');
      if (!petId || String(pet.display ?? '') === 'none') continue;
      if (deps.locked(petId) || deps.sleeping(petId)) continue;
      out.push({ petId, animations: findPetInstance(cfg, petId)?.conf.animations });
    }
    return out;
  };

  /** 写一条点播指令（带播放回执）。 */
  const play = (petId: string, name: string, extra: { next?: string; loop?: boolean } = {}): void => {
    deps.writePet(petId, 'anim', { name, ...extra, playbackId: deps.createPlayback(petId, name) });
  };

  /** 冒一句气泡（anim: false：不联动说话动作，免得盖掉清理动作）。 */
  const say = (petId: string, text: string, duration = BUBBLE_MS): void => {
    deps.writePet(petId, 'say', { text, duration, anim: false });
  };

  /** 单段动作 + 气泡（扫描、恢复类、没有吸入素材时的退路）。 */
  const plain = (petId: string, animations: unknown, event: CleanEvent): void => {
    const names = animationNames(animations);
    const [preferred, fallback] = plainAnimation(event);
    const name = names.includes(preferred) ? preferred : names.includes(fallback) ? fallback : null;
    if (name) play(petId, name);
    say(petId, textFor(event));
  };

  return (event) => {
    // 任务开始：吸入-开始 → 吸入-循环-<档>，一直循环到任务结束
    if (event.kind === 'work-start' && SWALLOW_ACTIONS.has(event.action)) {
      swallowing.clear();
      generation++;
      const tier = sizeTier(event.bytes);
      for (const { petId, animations } of eligible()) {
        const set = swallowNames(animations, event.action, tier, random);
        if (!set) {
          plain(petId, animations, event);
          continue;
        }
        if (set.start === set.loop) play(petId, set.loop, { loop: true });
        else play(petId, set.start, { next: set.loop, loop: true });
        say(petId, textFor(event));
        swallowing.set(petId, now());
      }
      return;
    }

    // 任务成功（释放空间类）：打嗝 → 推容量条-<按实际释放量重新分档>，推完冒结果气泡
    if (event.kind === 'work-done' && SWALLOW_ACTIONS.has(event.action)) {
      const freed = event.freedBytes ?? event.bytes;
      const startedAt = Math.min(...[...swallowing.values()], now());
      const wait = Math.max(0, MIN_SWALLOW_MS - (now() - startedAt));
      const ids = new Set(swallowing.keys());
      const gen = generation;
      if (wait > 0) schedule(() => gen === generation && finish(ids, freed, event), wait);
      else finish(ids, freed, event);
      return;
    }

    // 失败或取消：停循环，叹气冒汗
    if ((event.kind === 'error' || event.kind === 'cancelled') && event.action !== 'scan') {
      const started = new Set(swallowing.keys());
      swallowing.clear();
      generation++;
      for (const { petId, animations } of eligible()) {
        // 吸入过的宠物一定要收尾；没吸入的只在出错时说一声（取消是用户自己点的，不必打扰）
        if (!started.has(petId) && event.kind === 'cancelled') continue;
        plain(petId, animations, event);
      }
      return;
    }

    for (const { petId, animations } of eligible()) plain(petId, animations, event);
  };

  /** 成功收尾：打嗝 → 推容量条-<按实际释放量重新分档>，推完冒结果气泡。 */
  function finish(ids: Set<string>, freed: number, event: Extract<CleanEvent, { kind: 'work-done' }>): void {
    swallowing.clear();
    const pets = eligible().filter(({ petId }) => ids.has(petId));
    for (const { petId, animations } of pets) {
      if (freed <= 0) {
        // 什么都没吃到：不打嗝，直接收尾
        plain(petId, animations, event);
        continue;
      }
      const set = swallowNames(animations, event.action, sizeTier(freed), random);
      const push = pushName(animations, sizeTier(freed), random);
      const burp = set?.burp ?? null;
      if (burp && push) play(petId, burp, { next: push });
      else if (push) play(petId, push);
      else if (burp) play(petId, burp);
      if (burp) say(petId, '嗝～', BURP_BUBBLE_MS);
      const text = resultText(freed, event.notes);
      schedule(() => say(petId, text), burp ? BURP_MS + PUSH_MS : PUSH_MS);
    }
  }
}
