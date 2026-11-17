/** 按人设生成碎碎念或梦话，并在模型失败时尝试候选模型。 */
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { PET_CALL_IDENTITY, noTextReason } from './llm-call.ts';
import { supportsReasoningOff } from './llm-reasoning.ts';
import { defaultLog } from './log-file.ts';
import { modelCandidates, modelLabel, type ModelRef } from './model-selection.ts';

/** 生成失败原因（与 shared/whisper.ts 的 WhisperState 失败分支同构）。 */
export type WhisperGenerateResult =
  { ok: true; text: string } | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** 单次生成超时（ms）：碎碎念不需要长输出，30s 足够。 */
const TIMEOUT_MS = 30_000;

const USER_TEXT = '随便说一句日常碎碎念，一句就好，20 字以内。';

/** 梦话指令：睡觉期间嘟囔一句。与碎碎念指令同属「功能指令」，不进配置（配置里只有人设）。 */
const SLEEP_TALK_TEXT = '你正在睡觉，随便嘟囔一句梦话，一句就好，20 字以内；含糊、半梦半醒，不要清醒地回应任何人。';

/** 梦话指令的对外出口：调用方传进 generateWhisper 的 instruction，避免再抄一份文案。 */
export const SLEEP_TALK_INSTRUCTION = SLEEP_TALK_TEXT;

/** 一次生成请求：人设必填，其余可选。参数改对象是为了不再往函数签名上挂第 5 个参数。 */
export interface WhisperRequest {
  /** 人设 system 提示词（whisperPrompt）。 */
  system: string;
  /** 条目单独指定的模型（whisperModel）；缺省 / 留空 = 只用当前对话的模型。 */
  preferred?: ModelRef;
  /** 功能指令（梦话传 SLEEP_TALK_INSTRUCTION）；缺省 = 碎碎念指令。 */
  instruction?: string;
}

export async function generateWhisper(
  ctx: { agentDefaultModel: { currentSelection(): { provider: string; model: string } }; llm?: unknown },
  request: WhisperRequest,
): Promise<WhisperGenerateResult> {
  // 候选链：配置的模型优先 → 当前对话的模型兜底（whisperModel 留空时链上只有后者）
  const candidates = modelCandidates(ctx, request.preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  // ctx.llm 是核心服务但保持防御：缺失时显式失败（静默跳过由上层决定）
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  // 依次尝试：配置的模型失败（凭据被删 / 模型下架 / 该服务商没配 key）时回落到当前对话的模型
  // 重试一次——那才是用户当前真正在用的模型，报错更有意义。
  // 兜底文案与失败分支同源，避免两处字面量漂移
  let last: WhisperGenerateResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await generateWith(ctx, llm, sel, request);
    if (result.ok) return result;
    last = result;
    // 回落要留痕：配的模型没生效时能在日志里看到原因（否则「我明明配了 A，怎么还是用 B」没法查）
    if (i + 1 < candidates.length) {
      defaultLog(
        'warn',
        `jingsao: 碎碎念用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

/** 用一个确定的 provider/model 跑一次生成（候选链的一环；失败原样返回结构化原因，不吞）。 */
async function generateWith(
  ctx: { llm?: unknown },
  llm: { stream(o: unknown): AsyncIterable<unknown> },
  sel: ModelRef,
  request: WhisperRequest,
): Promise<WhisperGenerateResult> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  // 仅当模型声明支持 reasoning effort（含 "off"）时才传，否则省略：
  // 无 reasoning 元数据的模型显式传 off 会被 dsh-llm 判为 UNSUPPORTED_REASONING_EFFORT，
  // 折叠成空流（表现为「模型未返回文本」）。
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  const options = {
    provider: sel.provider,
    model: sel.model,
    // 调用身份（见 llm-call.ts）：缺它时 opencode-go 回 400
    sessionId: PET_CALL_IDENTITY,
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: request.instruction ?? USER_TEXT }],
        source: { kind: 'user' },
      }),
    ],
    system: request.system,
    // 不显式限 maxTokens：推理模型会把思考计入预算，显式小上限只会截断正文报「模型未返回文本」；
    // 不传由 dsh-llm 按适配器 defaultMaxTokens（默认 32768）兜底，碎碎念短指令输出仍短。
    temperature: 1,
    // 统一关闭深度思考：碎碎念不需要推理，只求随口一句（仅模型声明支持时传）
    ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    signal: deadline,
  };

  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'generate-error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const text = assembler
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b as { text: string }).text : ''))
    .join('')
    .trim();
  if (!text) return { ok: false, reason: 'generate-error', message: noTextReason(assembler.finish) };
  return { ok: true, text };
}
