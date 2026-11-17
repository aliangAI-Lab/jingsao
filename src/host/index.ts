/**
 * 插件入口：Cordis 插件，把 host 半侧的配置、路由、斜杠命令、轮询与桌面 Helper 装配到 ctx。
 * 装配顺序不能改：`getHandlePetRoute` 惰性取用（`httpRoute` 在本函数后段才创建），`startHelper` 必须最后调用。
 * @module jingsao/src/host/index
 */
import { createHostSetup } from './plugin/setup.ts';
import { readAllConfig } from './config.ts';
import { createHttpRoute, registerHttpRoute } from './plugin/http-route.ts';
import { registerLifecycle } from './plugin/lifecycle.ts';
import { registerChatCommand } from './plugin/command-chat.ts';
import { registerJingsaoCommand } from './plugin/command-jingsao.ts';
import { registerPetCommand } from './plugin/command-pet.ts';
import { registerLoops } from './plugin/loops.ts';
import { registerBalanceCommand } from './plugin/command-balance.ts';
import { registerSessionWatch } from './plugin/session-watch.ts';
import { createDesktopHelper } from './plugin/desktop-helper.ts';
import { createBalancePoll } from './plugin/balance-poll.ts';
import { createChatMemory } from './plugin/chat-memory.ts';
import { createSessionNotify } from './plugin/session-notify.ts';
import { createPetLookup } from './plugin/pet-lookup.ts';
import { createDownloadReport } from './plugin/download-report.ts';
import { createWorkStatusBridge } from './plugin/work-status-bridge.ts';
import { createVoiceService } from './voice/speak.ts';
import { createHearService } from './voice/hear.ts';
import { CleanService } from './clean/service.ts';
import { createCleanFx } from './clean/pet-fx.ts';
import { describeCleanOpen, requestCleanOpen } from './clean-open.ts';
import { registerCleanAgent } from './clean/agent.ts';
import { restoreAfterReinstall } from './reinstall-restore.ts';
import { PACKAGE_ROOT } from './paths.ts';
import type { PetRouteDeps } from './routes/types.ts';

/** 插件行 id（与 cordis.patch.yml 一致） */
export const name = 'pet';
/** 需要注入的服务：webServer（路由）+ agentDefaultModel（当前服务商）+ credentials（凭证）+ llm（对话模型调用）+ commands（/balance 斜杠命令）+ connection（桌面 Helper「打开 AI 设置」用的已鉴权站点 URL） */
export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection'];

/** 宿主插件主体：注册 `/jingsao-7341` 前缀路由与斜杠命令（/balance /pet /chat）；ctx 暂用 any（peer 类型包本地不可解析）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 注入的 ctx（webServer/locale 等 service 无静态类型）
export function apply(ctx: any): void {
  const setup = createHostSetup(ctx);
  const {
    userRoot,
    log,
    configPaths,
    thumbUserRoot,
    standaloneAiPolicy,
    standaloneAiBalance,
    state,
    playback,
    workStatus,
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
  } = setup;
  const workStatusBridge = createWorkStatusBridge({ state, workStatus, EXTERNAL_WORK_SESSION });
  const { publishWorkStatus, stopWorkStatusFlush } = workStatusBridge;
  const downloadReport = createDownloadReport({
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
    publishWorkStatus,
    workStatus,
  });
  const { reportDownload, stopDownloadSlotTimer } = downloadReport;
  const petLookup = createPetLookup({ state, configPaths });
  const { lock, sleep, sleepRefusalText } = petLookup;
  const sessionNotify = createSessionNotify({ ctx, publishWorkStatus, state, workStatus });
  const {
    pushNotifyFrame,
    turnFlags,
    terminalTimers,
    lastTodoText,
    lastReplyText,
    toolsInFlight,
    cancelTerminalCleanup,
    scheduleTerminalCleanup,
    notifyActivityTimers,
    scheduleCompletionNotify,
  } = sessionNotify;
  const chatMemory = createChatMemory({ ctx, configPaths, log, playback, state, userRoot });
  const { lastWhisperAt, publishWhisper, publishSleepTalk, chatWithPet, getActivePetId, setActivePetId } = chatMemory;

  const balancePoll = createBalancePoll({ ctx, configPaths, getActivePetId, log, state, standaloneAiBalance });
  const { effectivePetList, balancePeriodSec, whisperPeriodSec, refreshBalance, resolveActivePetId, petDisplayName } =
    balancePoll;

  // C 盘清理：任务事件交给宠物反应（播清理动作、冒气泡）；记录与审计落在插件数据根下的 clean/。
  const clean = new CleanService({
    dataDir: userRoot,
    log,
    onEvent: createCleanFx({
      readConfig: () => readAllConfig(configPaths),
      effectivePetList: () => balancePoll.effectivePetList(),
      writePet: (petId, key, data) => state.writePet(petId, key as 'anim' | 'say', data),
      createPlayback: (petId, name) => playback.create(petId, name).playbackId,
      locked: (petId) => lock.locked(petId),
      sleeping: (petId) => sleep.sleeping(petId),
    }),
  });

  const desktopHelper = createDesktopHelper({
    ctx,
    configPaths,
    effectivePetList,
    log,
    reportDownload,
    thumbUserRoot,
    // 惰性取用：handlePetRoute 在下方装配，Helper 只在启动/收请求时才真正调用它
    getHandlePetRoute: () => httpRoute.handlePetRoute,
  });
  const { startHelper, stopHelper, markDisposed } = desktopHelper;

  const deps: PetRouteDeps = {
    ...setup,
    ...petLookup,
    ...workStatusBridge,
    ...chatMemory,
    ...balancePoll,
    ...desktopHelper,
    ...sessionNotify,
    ctx,
    clean,
    // 语音合成：缓存落 userRoot，失败只留日志，不打断宿主
    voice: createVoiceService({ userRoot, log }),
    // 语音识别：能力来自宿主（DSH 的 speechToText），没启用时服务自己在调用时回 unsupported
    speech: createHearService({ speechToText: () => setup.optionalService('speechToText') }),
  };
  const httpRoute = createHttpRoute(deps);
  // 对话入口：「帮我清 C 盘」→ AI 只读扫描 + 打开面板；改动永远只能由用户在面板里点。
  // 打开面板与 POST /clean/open 同一套去向判定：网页在线开浮层，只有桌面开小窗，全部收起不弹。
  registerCleanAgent(ctx, clean, () => describeCleanOpen(requestCleanOpen(deps)));
  registerHttpRoute(ctx, httpRoute.handlePetRoute);
  registerJingsaoCommand(ctx, httpRoute.handlePetRoute);

  registerSessionWatch({
    ctx,
    cancelTerminalCleanup,
    lastTodoText,
    lastReplyText,
    notifyActivityTimers,
    publishWorkStatus,
    pushNotifyFrame,
    scheduleCompletionNotify,
    scheduleTerminalCleanup,
    terminalTimers,
    toolsInFlight,
    turnFlags,
    workStatus,
  });

  registerBalanceCommand({ ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText });

  registerLoops({
    ctx,
    balancePeriodSec,
    configPaths,
    lastWhisperAt,
    lock,
    log,
    publishWhisper,
    publishSleepTalk,
    refreshBalance,
    sleep,
    standaloneAiPolicy,
    whisperPeriodSec,
  });

  registerPetCommand({ ctx, effectivePetList, petDisplayName, resolveActivePetId, setActivePetId });

  registerChatCommand({ ctx, chatWithPet, log, publishWhisper, resolveActivePetId, sleep, sleepRefusalText });

  registerLifecycle({
    ctx,
    lock,
    markDisposed,
    playback,
    state,
    stopDownloadSlotTimer,
    stopHelper,
    stopWorkStatusFlush,
  });

  // 路由就绪后拉起桌面 Helper（Electron 缺失时仅告警，不影响 DSH 与浏览器 overlay）
  startHelper();
  // 重新安装：卸载前收起过的鲸鱼娘叫回桌面（叫回路由自己会重启 Helper，所以排在 startHelper 之后）
  void restoreAfterReinstall({
    userRoot,
    packageRoot: PACKAGE_ROOT,
    configPaths,
    handle: httpRoute.handlePetRoute,
    log,
  });
}
