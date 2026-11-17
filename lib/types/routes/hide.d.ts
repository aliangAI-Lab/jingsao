import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
/** 收起、叫回与退出桌面共用同一条持久化链，业务失败回 200。 */
export declare function handleHideRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
