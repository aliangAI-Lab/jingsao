/** 点播失败的分类；路由原样透出给调用方。 */
export type AnimFailure = 'bad-request' | 'pet-required' | 'unknown-pet' | 'unknown-animation';
/**
 * 朝向：`left` = 素材原样，`right` = 镜像（渲染端贴 `scaleX(-1)`）。
 * 与 shared/state.ts 的同名联合体是两份（宿主不 import src/shared），改动时两边要一起改。
 */
export type PetFacing = 'left' | 'right';
/**
 * 决策结论：通过则给出最终要写进 S 的内容（`name` 与 `url` 恰好一个），否则给出显式原因。
 * `facing` 缺席 = 调用方没指定，渲染端不动朝向（不是回落 left）。
 */
export type AnimDecision = {
    ok: true;
    petId: string;
    name?: string;
    url?: string;
    facing?: PetFacing;
} | {
    ok: false;
    reason: AnimFailure;
    message: string;
};
export declare function animationNames(animations: unknown): string[];
/**
 * 第三方资源地址规范化：只放行 http / https 的完整 URL，其余一律 null（调用方回 bad-request）。
 *
 * 桌面端换源是 `el.src = url` 直连（不经 `/thumb`），`file:` 能让渲染端读本地任意文件，
 * `javascript:` / `data:` 更没有理由开这个口。跨域不在这里解决、也不该在这里解决：桌面素材走
 * fetch + blob，CORS 由浏览器强制，第三方只能自己配响应头或注册同源路由；宿主不做代理，因此也
 * 没有 SSRF 面。与 ./broadcast 共用这一条规则（两个「第三方投喂」端点的 url 参数同一口径）。
 */
export declare function normalizeHttpUrl(v: unknown): string | null;
/**
 * 把外部给的点播请求与当前配置核对成一个结论。
 *
 * `name` 与 `url` 二选一：`url` 是第三方自带的素材地址，给了它就不查动画池——素材在别人手里，
 * 池里当然没有这个名字；两个都给 / 都不给都是意图不明，直接 bad-request，不替调用方猜一个。
 *
 * @param args - 点播参数：`cfg` 为成品配置（字段已填满，不做兜底解析）；`requested` 是 `?pet=` 原值
 *   （空串 → `pet-required`）；`name` / `url` 未规范化且二选一；`facing` 可选，没给则不动朝向。
 */
export declare function decideAnim(args: {
    cfg: Record<string, Record<string, unknown>>;
    requested: string;
    name: unknown;
    url: unknown;
    facing?: unknown;
}): AnimDecision;
