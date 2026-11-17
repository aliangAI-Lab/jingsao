import { type CleanPanelRuntime } from './panel.ts';
import type { PetChatTabHost } from '../chat/register.ts';
/** 打开清理标签。 */
export declare function openCleanTab(ctx: PetChatTabHost): void;
/** 注入样式、注册浮层与侧栏标签；返回清理函数。 */
export declare function registerCleanTab(ctx: PetChatTabHost, rt: CleanPanelRuntime): () => void;
