import type { PetImageRef } from './image-attachment.ts';
import { type ModelRef } from './model-selection.ts';
/** 生成失败原因（与 shared/whisper.ts 的 WhisperState 失败分支同构）。 */
export type ChatGenerateResult = {
    ok: true;
    text: string;
    action?: string;
} | {
    ok: false;
    reason: 'provider-missing' | 'generate-error';
    message?: string;
};
/** 记忆中的一条消息：GET /chat 返回的窗口条目就是它。 */
export interface ChatMemoryMessage {
    role: 'user' | 'assistant';
    content: string;
    ts: number;
    /** 该轮用户上传的图片（附件引用，不含图片本体）；只存不送——历史回放不带图。 */
    image?: PetImageRef;
    /** 该轮 AI 表演的动作名（animations.categories 内的名字）；回放历史时以 `[动作:名称]` 回填。 */
    action?: string;
}
/** 动作指令与动作标记的解析都在 ./chat-action：它们只服务对话这条路径，与 /anim 的决策层分开。 */
/** 一次对话生成的输入。 */
export interface ChatGenerateInput {
    /** 宿主上下文（注入 agentDefaultModel / llm）。 */
    readonly ctx: {
        agentDefaultModel: {
            currentSelection(): {
                provider: string;
                model: string;
            };
        };
        llm?: unknown;
    };
    /** 人设提示词（whisperPrompt，与碎碎念共用同一人设）。 */
    readonly system: string;
    /** 最近记忆（按时间正序，user / assistant 交替）。 */
    readonly history: readonly ChatMemoryMessage[];
    /** 用户刚输入的话；图片不带任何文字描述，语境全靠它。 */
    readonly userText: string;
    /** 可表演的动作名单（对话联动开关开启时传，来自 animations.categories）；空 / 缺省 = 不注入也不解析。 */
    readonly actions?: readonly string[];
    /** 条目单独指定的模型（chatModel）；缺省 / 留空 = 只用当前对话的模型。 */
    readonly preferred?: ModelRef;
    /** 本轮附带的图片；缺省 = 纯文本请求，数据路径与加入图片前一致。 */
    readonly image?: PetImageRef;
}
export declare function generateChat(input: ChatGenerateInput): Promise<ChatGenerateResult>;
