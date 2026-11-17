import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
/** 清理领域：未命中返回 undefined，命中返回应答。 */
export declare function handleCleanRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
