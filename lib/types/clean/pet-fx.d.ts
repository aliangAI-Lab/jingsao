import type { CleanEvent, CleanJobAction } from './service.ts';
/** 打嗝与推容量条的素材时长（毫秒）：推完时才冒结果气泡。 */
export declare const BURP_MS = 2000;
export declare const PUSH_MS = 6000;
/** 吸入至少演这么久再打嗝（吸入-开始 1.5 秒 + 一轮循环 2 秒）：清得太快时不至于一闪而过。 */
export declare const MIN_SWALLOW_MS = 3500;
/** 清理量分档。 */
export type CleanSizeTier = 'small' | 'medium' | 'large';
/** 字节 → 档位：< 1 GB 小，1–10 GB 中，≥ 10 GB 大。 */
export declare function sizeTier(bytes: number): CleanSizeTier;
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
export declare function formatBytes(bytes: number): string;
/** 事件 → 气泡文本（开始、扫描、恢复类结果；清理成功的结果气泡另见 resultText）。 */
export declare function textFor(event: CleanEvent): string;
/** 清理成功（推完容量条）时的气泡。 */
export declare function resultText(freedBytes: number, notes?: readonly string[]): string;
/** cleanSwallow 的一套名字（已按宠物动画池过滤，可直接播）。 */
interface SwallowNames {
    start: string;
    loop: string;
    burp: string | null;
    push: string | null;
}
/**
 * 按宠物配置定「吸入」用哪几段：cleanSwallow 齐全就用它；缺段或素材缺失退回老动画。
 * @param animations - 条目配置的 animations。
 * @param action - 任务种类（搬家的老回退动画是 清理-搬家）。
 * @param loopTier - 循环段的档位（按预计处理量）。
 */
export declare function swallowNames(animations: unknown, action: CleanJobAction, loopTier: CleanSizeTier, random?: () => number): SwallowNames | null;
/** 造一个事件处理器，交给 CleanService 的 onEvent。 */
export declare function createCleanFx(deps: CleanFxDeps): (event: CleanEvent) => void;
export {};
