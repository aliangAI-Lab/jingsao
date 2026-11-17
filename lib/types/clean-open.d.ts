import type { PetRouteDeps } from './routes/types.ts';
import type { PollStateStore } from './state.ts';
/** 轮询续租时长：两端都是 1 秒级长轮询，15 秒没来就当这一端不在线（与页面侧丢弃旧请求的窗口同值）。 */
export declare const CLEAN_SURFACE_LEASE_MS = 15000;
/** 会打开清理面板的两端。 */
export type CleanSurface = 'web' | 'desktop';
/** 「网页可见」的上报有效期：超过这么久没再上报 visible=1 就当用户看不见网页。 */
export declare const CLEAN_VISIBLE_LEASE_MS = 3000;
/** 打开请求的结果：成功带去向；失败是统一的失败实体。 */
export type CleanOpenResult = {
    ok: true;
    target: CleanSurface;
} | {
    ok: false;
    reason: 'pet-hidden' | 'surface-offline';
    message: string;
};
/** 把 /state 的 surface 查询参数认成一端；不认识的值（含缺省）返回 null。 */
export declare function cleanSurfaceOf(value: string | null): CleanSurface | null;
/** /state 的 visible 查询参数：'1' 可见、'0' 看不见；缺省（老页面）返回 undefined。 */
export declare function cleanVisibleOf(value: string | null): boolean | undefined;
/**
 * 一端来轮询了一次：续租。网页额外记「页面是否可见」；没带 visible 的老页面按可见处理（保持老行为）。
 */
export declare function touchCleanSurface(state: PollStateStore, surface: CleanSurface, now?: number, visible?: boolean): void;
/**
 * 发出一次「打开清理面板」：在用户看得见的那只鲸鱼娘旁边打开（顺序见模块说明）。
 */
export declare function requestCleanOpen(deps: Pick<PetRouteDeps, 'state' | 'configPaths'>, now?: number): CleanOpenResult;
/** 给对话里的 AI 看的结果：成功时补一句人话，方便它如实转告用户；失败实体本身已带 message。 */
export declare function describeCleanOpen(result: CleanOpenResult): CleanOpenResult & {
    message: string;
};
