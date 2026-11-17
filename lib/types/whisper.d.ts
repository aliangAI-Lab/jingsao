import { type ModelRef } from './model-selection.ts';
/** 生成失败原因（与 shared/whisper.ts 的 WhisperState 失败分支同构）。 */
export type WhisperGenerateResult = {
    ok: true;
    text: string;
} | {
    ok: false;
    reason: 'provider-missing' | 'generate-error';
    message?: string;
};
/** 梦话指令的对外出口：调用方传进 generateWhisper 的 instruction，避免再抄一份文案。 */
export declare const SLEEP_TALK_INSTRUCTION = "\u4F60\u6B63\u5728\u7761\u89C9\uFF0C\u968F\u4FBF\u561F\u56D4\u4E00\u53E5\u68A6\u8BDD\uFF0C\u4E00\u53E5\u5C31\u597D\uFF0C20 \u5B57\u4EE5\u5185\uFF1B\u542B\u7CCA\u3001\u534A\u68A6\u534A\u9192\uFF0C\u4E0D\u8981\u6E05\u9192\u5730\u56DE\u5E94\u4EFB\u4F55\u4EBA\u3002";
/** 一次生成请求：人设必填，其余可选。参数改对象是为了不再往函数签名上挂第 5 个参数。 */
export interface WhisperRequest {
    /** 人设 system 提示词（whisperPrompt）。 */
    system: string;
    /** 条目单独指定的模型（whisperModel）；缺省 / 留空 = 只用当前对话的模型。 */
    preferred?: ModelRef;
    /** 功能指令（梦话传 SLEEP_TALK_INSTRUCTION）；缺省 = 碎碎念指令。 */
    instruction?: string;
}
export declare function generateWhisper(ctx: {
    agentDefaultModel: {
        currentSelection(): {
            provider: string;
            model: string;
        };
    };
    llm?: unknown;
}, request: WhisperRequest): Promise<WhisperGenerateResult>;
