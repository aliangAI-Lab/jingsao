export declare function timeContextOf(date: Date): string;
/**
 * 历史消息的时间前缀（对话历史专用）：`10月31日 22:53`，跨年时带年份。
 *
 * 不带方括号，由调用方决定怎么包；是否加前缀（阈值）也归调用方判断。
 *
 * @param ts - 那条消息的发送时刻（毫秒时间戳，`memory.json` 里每条都带）。
 * @param now - 当前时刻；与发送时刻不同年时前缀带年份，消掉“哪一年”的歧义。
 * @returns `ts` 或 `now` 非法时返回空串（调用方据此不加前缀，原样发送）。
 */
export declare function historyStampOf(ts: number, now: Date): string;
