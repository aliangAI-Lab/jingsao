/**
 * 让对话里的 AI 也能帮忙清 C 盘：注册两个只读工具（扫描、打开面板）和一份技能说明。
 *
 * 刻意只给这两个工具：AI 只能看和解释，任何移动、删除、还原都必须由用户在清理面板里亲手点。
 * 用户在聊天里说「同意」也不算数——确认动作不接受工具参数，工具层根本没有改动文件的入口。
 * tools / skills 服务是可选注入：宿主没有这两个服务时静默跳过，不影响桌宠其它功能。
 * @module jingsao/src/host/clean/agent
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';
import { formatBytes } from './pet-fx.ts';
import type { CleanFeature, CleanScanResult } from './types.ts';
import type { CleanService } from './service.ts';

/** 扫描等待上限：超过就把已有进度告诉 AI，不让对话一直挂着。 */
const SCAN_WAIT_MS = 120_000;

/** 宿主上下文的最小形状（Cordis ctx）。 */
interface AgentCtx {
  inject(names: string[], callback: (sub: AgentCtx & Record<string, unknown>) => void): void;
  logger?: { info?(message: string): void };
}

/** 工具注册表的最小形状。 */
interface ToolRegistry {
  register(definition: Record<string, unknown>): unknown;
}

/** 技能注册表的最小形状。 */
interface SkillRegistry {
  register(definition: { name: string; description: string; source: string; content: string }): unknown;
}

/** 等扫描任务结束（或超时 / 被取消）。 */
async function waitScan(clean: CleanService, feature: CleanFeature, signal?: AbortSignal): Promise<void> {
  const until = Date.now() + SCAN_WAIT_MS;
  for (;;) {
    const job = clean.status().job;
    if (!job || job.finishedAt !== undefined || job.feature !== feature) return;
    if (signal?.aborted || Date.now() > until) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** 扫描结果 → 给 AI 看的精简摘要（不含文件内容，只有分类、大小、说明和最大的几个路径）。 */
export function summarize(result: CleanScanResult | null): unknown {
  if (!result) return { ok: false, message: '还没有扫描结果' };
  return {
    ok: true,
    feature: result.feature,
    total: formatBytes(result.totalBytes),
    categories: result.categories.map((c) => ({
      label: c.label,
      group: c.group,
      tier: { safe: '放心清', cost: '清了有点代价', risky: '我不敢动' }[c.tier],
      size: formatBytes(c.bytes),
      files: c.count,
      reportOnly: c.reportOnly === true,
      defaultChecked: c.defaultChecked ?? c.tier !== 'risky',
      ...(c.needsAdmin ? { needsAdmin: true } : {}),
      ...(c.unreadable ? { unreadable: '部分目录需要管理员权限才能看到大小' } : {}),
      ...(c.warn ? { warn: c.warn } : {}),
      explanation: c.explanation,
      biggest: c.items.slice(0, 3).map((i) => `${i.path}（${formatBytes(i.size)}）`),
    })),
  };
}

/**
 * 注册 AI 工具与技能。
 *
 * @param ctx - 插件上下文（独立模式的伪 ctx 没有 inject，直接跳过）。
 * @param clean - 清理服务（只用它的只读扫描与结果）。
 * @param openPanel - 打开清理面板：返回给 AI 看的结果（开在网页浮层 / 桌面小窗，或为什么没打开），原样转成工具输出。
 */
export function registerCleanAgent(
  ctx: AgentCtx,
  clean: CleanService,
  openPanel: () => { ok: boolean; message: string },
): void {
  const noArgs = { type: 'object', properties: {}, additionalProperties: false };
  const textOut = {
    schema: { type: 'string' },
    render: (_a: unknown, value: string) => [{ type: 'text', text: value }],
  };

  // 独立模式（不装 DSH）的伪 ctx 没有 inject，也没有对话：直接跳过，面板照常可用
  if (typeof ctx.inject !== 'function') return;

  ctx.inject(['tools'], (sub) => {
    const tools = sub.tools as ToolRegistry;
    tools.register({
      name: 'jingsao_scan',
      description:
        '只读查看 C 盘：feature 取 junk（垃圾清理，默认）/ chat（微信QQ）/ bigfiles（大文件）。返回分类、大小与说明，不会移动或删除任何文件。',
      parameters: {
        type: 'object',
        properties: { feature: { type: 'string', enum: ['junk', 'chat', 'bigfiles'] } },
        additionalProperties: false,
      },
      output: textOut,
      execute: async (args: { feature?: CleanFeature }, exec: { signal?: AbortSignal }) => {
        const feature = args?.feature ?? 'junk';
        try {
          clean.startScan(feature);
        } catch {
          // 已有任务在跑：等它结束后读已有结果
        }
        await waitScan(clean, feature, exec?.signal);
        return JSON.stringify(summarize(clean.result(feature)));
      },
    });
    tools.register({
      name: 'jingsao_open_panel',
      description:
        '在用户看得见的那只鲸鱼娘旁边打开鲸扫的 C 盘清理面板，让用户亲自勾选和确认。此工具不会移动或删除任何文件；返回 ok=false 时把 message 如实告诉用户。',
      parameters: noArgs,
      output: textOut,
      execute: async () => JSON.stringify(openPanel()),
    });
  });

  ctx.inject(['skills'], (sub) => {
    const skills = sub.skills as SkillRegistry;
    const content = readFileSync(join(PACKAGE_ROOT, 'skills', 'jingsao', 'SKILL.md'), 'utf8').replace(
      /^---[\s\S]*?---\s*/,
      '',
    );
    skills.register({
      name: 'jingsao',
      description: '用户说帮我清 C 盘、C 盘满了、C 盘爆红时，用鲸扫只读扫描并解释清单，再打开面板让用户亲自确认。',
      source: 'bundled',
      content,
    });
  });
}
