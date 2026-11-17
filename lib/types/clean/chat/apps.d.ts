import type { CleanPlaces } from '../safety.ts';
import type { CleanTier } from '../types.ts';
/** 文件种类：决定档位、文案与默认勾选。 */
export type ChatKind = 'cache' | 'image' | 'video' | 'emoji' | 'file';
/** 每种文件的展示信息。 */
export declare const CHAT_KINDS: Record<ChatKind, {
    label: string;
    tier: CleanTier;
    explanation: string;
}>;
/** 一个账号目录下的一类文件位置。 */
export interface ChatSpot {
    /** 绝对路径（目录）。 */
    dir: string;
    kind: ChatKind;
    /** 只要这一层下面子目录里叫这个名字的目录（例如旧版微信 MsgAttach/<会话>/Image）；缺省 = dir 整棵。 */
    childDir?: string;
}
/** 一个软件的一个账号。 */
export interface ChatAccount {
    /** 软件展示名，例如「微信」。 */
    app: string;
    /** 软件 id（分类 id 前缀）。 */
    appId: string;
    /** 账号目录绝对路径。 */
    root: string;
    spots: ChatSpot[];
}
/** 找出本机所有聊天软件账号与可清理位置。 */
export declare function findChatAccounts(places: CleanPlaces): ChatAccount[];
