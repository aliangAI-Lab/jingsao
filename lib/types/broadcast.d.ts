/** pet 参数解析失败的两种分类（三个「pet 必填」端点共用这一对词汇，与 ./anim、./motion-cue 同口径）。 */
export type PetFailure = 'pet-required' | 'unknown-pet';
/** 投喂失败的分类（路由原样透出给调用方）。 */
export type BroadcastFailure = 'bad-request' | PetFailure;
export type BroadcastDecision = {
    ok: true;
    petId: string;
    text: string;
    url?: string;
    duration: number;
    anim: boolean;
} | {
    ok: false;
    reason: BroadcastFailure;
    message: string;
};
/** 清空气泡的决策结论（只有宠物解析这一步会失败）。 */
export type BubbleClearDecision = {
    ok: true;
    petId: string;
} | {
    ok: false;
    reason: PetFailure;
    message: string;
};
/** 投喂文本规范化：非字符串 / 纯空白 → 空串。
 *  路由与决策层共用这一条规则，免得为了一个必然失败的请求去读配置。 */
export declare function normalizeBroadcastText(text: unknown): string;
/** 气泡时长规范化：缺省 / null → 默认 10s；合法则原样；非法（非数字 / 非有限 / 负数）返回 null。
 *  路由先用它短路，别为一个必然失败的请求去碰磁盘；0 合法，字面意思「不显示」。 */
export declare function normalizeBroadcastDuration(duration: unknown): number | null;
/** 动画联动开关规范化：只有严格 false 才关闭，其余一律按「要联动」。
 *  宽松是有意的：老调用方不会传这个字段，宽松口径保证它们的行为一个字都不变。 */
export declare function normalizeBroadcastAnim(anim: unknown): boolean;
/** 播报开关规范化：只有严格 `true` 才念，其余（含 `"true"` 字符串）一律不念。
 *  缺省不念是有意的：投喂的文本与时机都由调用方决定，默认不该出声——否则任何一次
 *  高频投喂都会变成持续朗读，而调用方往往意识不到自己打开了扬声器。 */
export declare function normalizeBroadcastVoice(speak: unknown): boolean;
export declare function decideBroadcast(args: {
    cfg: Record<string, Record<string, unknown>>;
    /** `?pet=` 的原值（必填：空串 → pet-required） */
    requested: string;
    text: unknown;
    url: unknown;
    duration: number;
    anim: boolean;
}): BroadcastDecision;
/**
 * 清空气泡的决策：只需要确定「清哪只宠物的」。
 *
 * 占用门禁不在这里：「谁有资格清」由路由层在它之后过一遍锁，没带 lock 时那一步恒放行。
 * 与投喂的区别是没有「气泡不存在」这种失败：当前没气泡也返回 ok（幂等）。
 */
export declare function decideBubbleClear(args: {
    cfg: Record<string, Record<string, unknown>>;
    /** `?pet=` 的原值（必填：空串 → pet-required） */
    requested: string;
}): BubbleClearDecision;
