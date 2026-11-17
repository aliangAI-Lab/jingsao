/**
 * 「C盘清理」面板（约 440×640 的小窗排版；网页浮层、桌面小窗、右侧栏标签用的是同一份）。
 *
 * 自上而下：顶栏（C 盘容量条 + 一行容量）→ 摘要卡（发现可清理 / 已选 / 立即清理 / 重新扫描）→
 * 工具条（微信QQ、重复文件、大文件搬家、软件搬家四个小图标）→ 中间可滚动区（垃圾清理按组折叠的列表；
 * 点了工具就换成该工具的界面，左上「← 返回垃圾清理」）。上个版本暂存区有遗留文件时，顶部提示一次。
 *
 * 面板只负责展示和收集勾选，所有动作都交给宿主任务：勾选里有默认不勾的风险项时，在摘要卡位置就地确认
 * （不弹系统对话框）；宿主接受任务后立刻关窗（props.onClose），任务在宿主后台跑，鲸鱼娘负责演「吸入 → 打嗝 →
 * 推容量条」。任务进行中打开面板显示进度条和「取消」，结束后显示结果。没有 JSX，直接用宿主给的 h。
 * @module jingsao/src/client/clean/panel
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import { flattenConfigPets } from '../../shared/config.ts';
import { postAction } from '../../shared/state.ts';
import {
  cancelJob,
  fetchResult,
  fetchSoftware,
  fetchStatus,
  formatBytes,
  moveFiles,
  restoreFiles,
  reveal,
  runClean,
  settleLegacy,
  softwareAction,
  startScan,
  systemAction,
  type CleanCategory,
  type CleanFeature,
  type CleanJobView,
  type CleanRunOutcome,
  type CleanScanResult,
  type CleanStatusView,
  type SoftwareEntry,
} from './api.ts';
import {
  CATEGORY_PICK,
  confirmText,
  decideAction,
  defaultPicks,
  junkGroups,
  launchThenClose,
  selectionOf,
  type ActionReply,
  type PickMap,
} from './selection.ts';

/** 宿主给的 React 原语（与对话面板同一套注入）。 */
export interface CleanPanelRuntime {
  h: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  useState: <T>(init: T | (() => T)) => [T, (next: T | ((prev: T) => T)) => void];
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useRef: <T>(init: T) => { current: T };
}

/** 面板的 props：onClose = 关掉所在的小窗 / 浮层（右侧栏没有，动作被接受后就留在原地看进度）。 */
export interface CleanPanelProps {
  onClose?: () => void;
}

/** 工具条上的四个工具。 */
type ToolId = Exclude<CleanFeature, 'junk'>;
const TOOLS: Array<{ id: ToolId; label: string; hint: string; icon: string }> = [
  {
    id: 'chat',
    label: '微信QQ',
    hint: '聊天软件存下的图片、视频、文件和缓存；聊天记录本身不碰',
    icon: 'M4 5h16v10H9l-5 4z',
  },
  {
    id: 'duplicates',
    label: '重复文件',
    hint: '内容一模一样的文件，每组至少留一份',
    icon: 'M8 8h11v12H8zM5 4h11v2H7v10H5z',
  },
  {
    id: 'bigfiles',
    label: '大文件搬家',
    hint: '把你自己文件夹里的大文件搬到别的盘，随时能搬回来',
    icon: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  },
  {
    id: 'software',
    label: '软件搬家',
    hint: '整个软件目录搬到别的盘，原位置留一个联接，软件照常打开',
    icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15 14l4 3-4 3z',
  },
];

/** 垃圾清理分组的图标。 */
const GROUP_ICONS: Record<string, string> = {
  app: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  system: 'M12 3l2 3 3-1 1 3 3 2-2 3 2 3-3 2-1 3-3-1-2 3-2-3-3 1-1-3-3-2 2-3-2-3 3-2 1-3 3 1z',
  cache: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0',
  temp: 'M12 4a8 8 0 1 0 0.01 0zM12 8v5l3 2',
  dev: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  recycle: 'M5 7h14l-1 13H6zM9 7V4h6v3M3 7h18',
  report: 'M12 3l9 16H3zM12 10v4M12 17v.5',
};

/** 盾牌：需要管理员权限。 */
const SHIELD = 'M12 2l8 3v6c0 5-3.4 9.7-8 11-4.6-1.3-8-6-8-11V5z';

/** 动作 → 进行中的说法。 */
const ACTION_TEXT: Record<string, string> = {
  scan: '正在扫描',
  clean: '正在清理',
  'legacy-purge': '正在删除上个版本暂存的文件',
  'legacy-restore': '正在把上个版本暂存的文件放回去',
  move: '正在搬家',
  'move-restore': '正在搬回',
  'software-move': '正在搬软件',
  'software-restore': '正在搬回软件',
};

/** 可以中途取消的任务。 */
const CANCELABLE = new Set(['scan', 'clean', 'move']);

/** 列表里每类最多展开显示的文件数（再多也只是滚动，没意义）。 */
const SHOW_ITEMS = 60;

/** 时间筛选选项（微信QQ）。 */
const AGE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 0, label: '不限时间' },
  { days: 7, label: '7 天前的' },
  { days: 30, label: '30 天前的' },
  { days: 180, label: '半年前的' },
];

/** 大小下限选项（大文件 / 重复文件）。 */
const SIZE_OPTIONS: Array<{ bytes: number; label: string }> = [
  { bytes: 1024 ** 2, label: '1 MB 以上' },
  { bytes: 100 * 1024 ** 2, label: '100 MB 以上' },
  { bytes: 500 * 1024 ** 2, label: '500 MB 以上' },
  { bytes: 1024 ** 3, label: '1 GB 以上' },
];

/** 就地确认：要确认的那句话和确认后要做的事。 */
interface PendingConfirm {
  /** 确认卡出现在哪：summary = 摘要卡（垃圾清理），tool = 工具界面底部，legacy = 遗留数据提示条。 */
  where: 'summary' | 'tool' | 'legacy';
  text: string;
  okLabel: string;
  run: () => void;
}

/** 上一个已结束任务 → 给人看的一句结果；扫描不提示。 */
function jobResultText(job: CleanJobView): { text: string; error: boolean } | null {
  if (job.action === 'scan' || job.finishedAt === undefined) return null;
  if (job.progress.phase === 'cancelled') return { text: '上次的任务取消了，已经处理掉的不会回来。', error: false };
  if (job.error) return { text: job.error, error: true };
  if (job.action === 'clean') {
    const o = job.outcome as CleanRunOutcome | undefined;
    if (!o) return null;
    const notes: string[] = [];
    if (o.skipped > 0) notes.push(`有 ${o.skipped} 个文件正在被使用，没删掉`);
    if (o.adminSkipped > 0) notes.push(`系统相关的 ${o.adminSkipped} 项需要管理员权限，这次没清`);
    if (o.updateBusy.length) notes.push(`系统正在更新，稍后再清：${o.updateBusy.join('、')}`);
    notes.push(...o.commandErrors);
    return { text: [`清理完成：腾出了 ${formatBytes(o.bytes)}。`, ...notes].join('\n'), error: false };
  }
  if (job.action === 'legacy-purge' || job.action === 'legacy-restore') {
    const o = job.outcome as { files?: number; failed?: number } | undefined;
    const verb = job.action === 'legacy-purge' ? '删掉' : '放回';
    return {
      text: `上个版本暂存的文件已${verb} ${o?.files ?? 0} 个` + (o?.failed ? `，${o.failed} 个没处理成功` : '') + '。',
      error: false,
    };
  }
  if (job.action === 'move' || job.action === 'software-move') return { text: '搬家完成。', error: false };
  return { text: '已经原样搬回去了。', error: false };
}

/** 造面板组件。 */
export function makeCleanPanel(rt: CleanPanelRuntime): (props: CleanPanelProps) => unknown {
  const { useState, useEffect, useRef } = rt;
  // 宿主注入的 h 只认 props.children，不接受第三个及以后的参数（对话面板也是这么写的）：
  // 这里把可变参数收进 props.children，面板其余代码照常按 createElement 的习惯写。
  const h = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown =>
    rt.h(type, {
      ...(props ?? {}),
      ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }),
    });
  /** 小图标（24×24 描边）。 */
  const icon = (d: string, className = 'js-clean-ico'): unknown =>
    h('svg', { className, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d }));

  return function CleanPanel(props: CleanPanelProps): unknown {
    const onClose = props?.onClose;
    const [allHidden, setAllHidden] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [view, setView] = useState<CleanFeature>('junk');
    const [status, setStatus] = useState<CleanStatusView | null>(null);
    const [results, setResults] = useState<Partial<Record<CleanFeature, CleanScanResult | null>>>({});
    const [software, setSoftware] = useState<SoftwareEntry[] | null>(null);
    const [picked, setPicked] = useState<PickMap>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [warnShown, setWarnShown] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
    const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
    const [age, setAge] = useState(30);
    const [minBig, setMinBig] = useState(100 * 1024 ** 2);
    const [minDup, setMinDup] = useState(1024 ** 2);
    const [dupDrives, setDupDrives] = useState<string[]>([]);
    const [dest, setDest] = useState('');
    /** 已经刷新过结果的那个任务（任务结束后只重取一次结果）。 */
    const handledJob = useRef<string | null>(null);
    /** 首次打开且从没扫过垃圾时自动扫一遍（只读）。 */
    const autoScanned = useRef(false);
    // 轮询定时器里的 refresh 是旧闭包，读不到最新的 dest：用 ref 判断「用户是否已选过目标盘」
    const destRef = useRef('');
    destRef.current = dest;
    const alive = useRef(true);

    useEffect(() => {
      let active = true;
      let pending = false;
      const refreshPets = async (): Promise<void> => {
        if (pending) return;
        pending = true;
        try {
          const response = await fetch(ROUTE_PATH + '/config');
          if (!response.ok) return;
          const merged = (await response.json()) as Record<string, Record<string, unknown>>;
          const pets = flattenConfigPets(merged);
          if (active) setAllHidden(pets.length > 0 && pets.every((pet) => pet.display === 'none'));
        } catch {
          /* 暂时断连时保留上次显示状态。 */
        } finally {
          pending = false;
        }
      };
      void refreshPets();
      const timer = setInterval(() => void refreshPets(), 1000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, []);

    const restorePets = async (): Promise<void> => {
      setRestoring(true);
      const ok = await postAction(ROUTE_PATH + '/pet-restore');
      if (!alive.current) return;
      setRestoring(false);
      if (ok) setAllHidden(false);
      else setNotice({ text: '叫回失败，请重试。', error: true });
    };

    /** 取某功能的结果，并按默认规则初始化勾选。 */
    const loadResult = async (feature: CleanFeature): Promise<void> => {
      if (feature === 'software') {
        const reply = await fetchSoftware();
        if (reply.ok && alive.current) setSoftware(reply.software);
        return;
      }
      const reply = await fetchResult(feature);
      if (!reply.ok || !alive.current) return;
      setResults((prev) => ({ ...prev, [feature]: reply.result }));
      setPicked((prev) => ({ ...prev, ...defaultPicks(feature, reply.result) }));
    };

    /** 拉状态；任务刚结束时刷新对应结果；第一次打开且没扫过就自动扫一遍。 */
    const refresh = async (): Promise<void> => {
      const reply = await fetchStatus();
      if (!alive.current || !reply.ok) return;
      setStatus(reply);
      const current = reply.job;
      if (current && current.finishedAt !== undefined && handledJob.current !== current.id) {
        handledJob.current = current.id;
        await loadResult(current.feature);
      }
      const busy = current !== null && current.finishedAt === undefined;
      if (!autoScanned.current && !busy && !reply.scans.junk) {
        autoScanned.current = true;
        const started = await startScan('junk');
        if (started.ok && alive.current) setStatus((prev) => (prev ? { ...prev, job: started.job } : prev));
      }
      autoScanned.current = true;
      if (!destRef.current && reply.drives.length) {
        const best = [...reply.drives].sort((a, b) => (b.free ?? 0) - (a.free ?? 0))[0];
        if (best) setDest(best.root);
      }
    };

    useEffect(() => {
      alive.current = true;
      void refresh();
      for (const f of ['junk', 'chat', 'duplicates', 'bigfiles', 'software'] as CleanFeature[]) void loadResult(f);
      return () => {
        alive.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh 只读 ref 与 setState，进依赖会让定时器每次渲染都重建
    }, []);

    // 有任务在跑时 0.7 秒一拉，否则 5 秒一拉（只为刷新 C 盘剩余空间）。
    const job = status?.job ?? null;
    const running = job ? job.finishedAt === undefined : false;
    useEffect(() => {
      const timer = setInterval(() => void refresh(), running ? 700 : 5000);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh 只读 ref 与 setState，进依赖会让定时器每次渲染都重建
    }, [running]);

    /** 只读扫描：不关窗，留在面板里看结果。 */
    const scan = async (
      request: Promise<{ ok: true; job: CleanJobView } | { ok: false; message: string }>,
    ): Promise<void> => {
      setNotice(null);
      setConfirm(null);
      const reply = await request;
      if (!alive.current) return;
      if (!reply.ok) setNotice({ text: reply.message, error: true });
      await refresh();
    };

    /** 改动类动作：宿主接受后立刻关窗（任务在宿主后台跑）；被拒绝就把原因显示出来。 */
    const act = async (request: Promise<ActionReply>): Promise<void> => {
      setNotice(null);
      setConfirm(null);
      const failure = await launchThenClose(request, onClose);
      if (!alive.current) return;
      if (failure) setNotice({ text: failure, error: true });
      await refresh();
    };

    /** 点了动作按钮：有需要确认的项就地确认，否则直接开始。 */
    const guarded = (
      where: PendingConfirm['where'],
      labels: string[],
      run: () => void,
      verb?: string,
      okLabel = '确认清理',
    ): void => {
      if (decideAction({ confirm: labels }, false) === 'confirm') {
        setConfirm({ where, text: confirmText(labels, verb), okLabel, run });
      } else {
        run();
      }
    };

    const isOn = (key: string): boolean => picked[key] === true;
    const toggle = (key: string): void => {
      setConfirm(null);
      setPicked((prev) => ({ ...prev, [key]: !prev[key] }));
    };
    const setMany = (keys: string[], value: boolean): void => {
      setConfirm(null);
      setPicked((prev) => {
        const next = { ...prev };
        for (const key of keys) next[key] = value;
        return next;
      });
    };

    /** 就地确认卡。 */
    const confirmCard = (pending: PendingConfirm): unknown =>
      h(
        'div',
        { className: 'js-clean-confirm', role: 'alert' },
        h('div', { className: 'js-clean-confirm-text' }, pending.text),
        h(
          'div',
          { className: 'js-clean-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'js-clean-btn is-danger is-small',
              onClick: () => {
                setConfirm(null);
                pending.run();
              },
            },
            pending.okLabel,
          ),
          h(
            'button',
            { type: 'button', className: 'js-clean-btn is-small', onClick: () => setConfirm(null) },
            '再看看',
          ),
        ),
      );

    // ---------- 顶栏：容量条 ----------
    const disk = status?.disk;
    const used = disk && disk.total ? disk.total - (disk.free ?? 0) : null;
    const ratio = disk && disk.total && used !== null ? used / disk.total : 0;
    const topBar = h(
      'div',
      { className: 'js-clean-top' },
      h(
        'div',
        { className: 'js-clean-bar' + (ratio >= 0.9 ? ' is-red' : '') },
        h('div', { className: 'js-clean-bar-fill', style: { width: Math.round(ratio * 100) + '%' } }),
      ),
      h(
        'div',
        { className: 'js-clean-bar-text' },
        disk ? `C 盘共 ${formatBytes(disk.total)}，剩 ${formatBytes(disk.free)}` : '读取中…',
      ),
    );

    // ---------- 顶部提示：收起、遗留暂存、只读 ----------
    const banners: unknown[] = [];
    if (allHidden) {
      banners.push(
        h(
          'div',
          { key: 'hidden', className: 'js-clean-banner' },
          h('span', { className: 'js-clean-banner-text' }, '鲸鱼娘收起来了'),
          h(
            'button',
            {
              type: 'button',
              className: 'js-clean-btn is-small',
              disabled: restoring,
              onClick: () => void restorePets(),
            },
            '叫她回来',
          ),
        ),
      );
    }
    const legacy = status?.legacy ?? null;
    if (legacy && !(running && job?.action.startsWith('legacy'))) {
      banners.push(
        h(
          'div',
          { key: 'legacy', className: 'js-clean-banner is-legacy' },
          h(
            'span',
            { className: 'js-clean-banner-text' },
            `上个版本暂存了 ${formatBytes(legacy.bytes)}（${legacy.files} 个文件）`,
          ),
          confirm?.where === 'legacy'
            ? confirmCard(confirm)
            : h(
                'div',
                { className: 'js-clean-row' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'js-clean-btn is-small is-danger',
                    disabled: running || status?.readOnly === true,
                    onClick: () =>
                      guarded(
                        'legacy',
                        ['上个版本暂存的文件'],
                        () => void act(settleLegacy('purge')),
                        '删除后无法恢复',
                        '确认删除',
                      ),
                  },
                  '彻底删除',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'js-clean-btn is-small',
                    disabled: running || status?.readOnly === true,
                    onClick: () => void act(settleLegacy('restore')),
                  },
                  '原样放回',
                ),
              ),
        ),
      );
    }
    if (status?.readOnly) {
      banners.push(h('div', { key: 'ro', className: 'js-clean-notice' }, '当前是只读模式：只能扫描，不会改动任何文件'));
    }

    // ---------- 摘要卡 ----------
    const junk = results.junk ?? null;
    const junkSel = selectionOf('junk', junk, picked);
    const found = junk ? junk.categories.filter((c) => !c.reportOnly).reduce((sum, c) => sum + c.bytes, 0) : null;
    const startJunk = (): void =>
      guarded('summary', junkSel.confirm, () => void act(runClean('junk', junkSel.ids, junkSel.categories)));
    let summaryBody: unknown;
    if (running && job) {
      const total = job.progress.totalBytes ?? job.estimateBytes ?? 0;
      summaryBody = h(
        'div',
        { className: 'js-clean-progress' },
        h(
          'div',
          { className: 'js-clean-progress-line' },
          `${ACTION_TEXT[job.action] ?? '处理中'}…  ${job.progress.files} 个文件 · ${formatBytes(job.progress.bytes)}`,
        ),
        total
          ? h(
              'div',
              { className: 'js-clean-bar is-thin' },
              h('div', {
                className: 'js-clean-bar-fill',
                style: { width: Math.min(100, Math.round((job.progress.bytes / total) * 100)) + '%' },
              }),
            )
          : h(
              'div',
              { className: 'js-clean-bar is-thin is-indeterminate' },
              h('div', { className: 'js-clean-bar-fill' }),
            ),
        job.progress.current
          ? h('div', { className: 'js-clean-path', title: job.progress.current }, job.progress.current)
          : null,
        CANCELABLE.has(job.action)
          ? h('button', { type: 'button', className: 'js-clean-btn is-small', onClick: () => void cancelJob() }, '取消')
          : null,
      );
    } else if (confirm?.where === 'summary') {
      summaryBody = confirmCard(confirm);
    } else {
      summaryBody = h(
        'div',
        { className: 'js-clean-summary-row' },
        h(
          'div',
          { className: 'js-clean-summary-text' },
          h('div', { className: 'js-clean-big' }, found === null ? '还没扫描' : `发现可清理 ${formatBytes(found)}`),
          h('div', { className: 'js-clean-hint' }, `已选 ${formatBytes(junkSel.bytes)}`),
          h(
            'button',
            {
              type: 'button',
              className: 'js-clean-link',
              disabled: running,
              onClick: () => void scan(startScan('junk')),
            },
            found === null ? '开始扫描' : '重新扫描',
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'js-clean-btn is-primary is-main',
            disabled: running || status?.readOnly === true || (!junkSel.ids.length && !junkSel.categories.length),
            onClick: startJunk,
          },
          '立即清理',
        ),
      );
    }
    const lastResult = !running && job ? jobResultText(job) : null;
    const summary = h(
      'div',
      { className: 'js-clean-summary' },
      summaryBody,
      lastResult && !confirm
        ? h('div', { className: 'js-clean-result' + (lastResult.error ? ' is-error' : '') }, lastResult.text)
        : null,
    );

    // ---------- 工具条 ----------
    const toolbar = h(
      'div',
      { className: 'js-clean-tools', role: 'toolbar', 'aria-label': '更多清理工具' },
      ...TOOLS.map((tool) =>
        h(
          'button',
          {
            key: tool.id,
            type: 'button',
            className: 'js-clean-tool' + (view === tool.id ? ' is-active' : ''),
            title: tool.hint,
            'aria-pressed': String(view === tool.id),
            onClick: () => {
              setConfirm(null);
              setView(view === tool.id ? 'junk' : tool.id);
            },
          },
          icon(tool.icon),
          h('span', { className: 'js-clean-tool-label' }, tool.label),
        ),
      ),
    );

    const noticeNode = notice
      ? h('div', { className: 'js-clean-notice' + (notice.error ? ' is-error' : '') }, notice.text)
      : null;

    // ---------- 垃圾清理：按组折叠的列表 ----------
    const categoryLine = (c: CleanCategory): unknown => {
      const key = 'c:' + c.id;
      const showWarn = warnShown === c.id;
      const adminOnly = c.unreadable === true && !c.bytes;
      return h(
        'div',
        { key: c.id, className: 'js-clean-line' },
        h(
          'div',
          { className: 'js-clean-line-head' },
          c.reportOnly ? null : h('input', { type: 'checkbox', checked: isOn(key), onChange: () => toggle(key) }),
          h('span', { className: 'js-clean-name', title: c.label + '\n' + c.explanation }, c.label),
          c.warn
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'js-clean-warn',
                  title: c.warn,
                  'aria-label': '风险提示：' + c.warn,
                  onClick: () => setWarnShown(showWarn ? null : c.id),
                },
                '!',
              )
            : null,
          c.needsAdmin
            ? h('span', { className: 'js-clean-admin', title: '需要管理员权限，清理时会弹一次确认' }, icon(SHIELD))
            : null,
          h(
            'span',
            { className: 'js-clean-size' + (adminOnly ? ' is-admin' : '') },
            adminOnly ? '需管理员' : formatBytes(c.bytes),
          ),
        ),
        showWarn && c.warn ? h('div', { className: 'js-clean-warn-text' }, c.warn) : null,
        c.reportOnly
          ? h(
              'div',
              { className: 'js-clean-report' },
              h('div', { className: 'js-clean-explain' }, c.explanation),
              c.systemAction
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'js-clean-btn is-small',
                      disabled: status?.readOnly === true,
                      onClick: () =>
                        void systemAction(c.systemAction!).then((reply) => {
                          if (!alive.current) return;
                          setNotice(
                            reply.ok
                              ? { text: '已打开系统自带的清理方式，请在系统界面里确认。' }
                              : { text: reply.message, error: true },
                          );
                        }),
                    },
                    '用系统方式清理',
                  )
                : null,
            )
          : null,
      );
    };

    const junkView = (): unknown => {
      if (!junk) {
        return h(
          'div',
          { className: 'js-clean-empty' },
          running && job?.action === 'scan' ? '鲸鱼娘正在只读地翻一遍 C 盘…' : '点「开始扫描」，鲸鱼娘先只读地看一遍',
        );
      }
      const groups = junkGroups(junk, picked);
      if (!groups.length) return h('div', { className: 'js-clean-empty' }, '这里很干净，没什么要收拾的～');
      return h(
        'div',
        { className: 'js-clean-groups' },
        ...groups.map((group) => {
          const open = expanded['g:' + group.id] === true;
          const keys = group.categories.map((c) => 'c:' + c.id);
          return h(
            'div',
            { key: group.id, className: 'js-clean-group' + (group.id === 'report' ? ' is-report' : '') },
            h(
              'div',
              { className: 'js-clean-group-head' },
              group.check === null
                ? null
                : h('input', {
                    type: 'checkbox',
                    'aria-label': '整组勾选：' + group.label,
                    checked: group.check === 'all',
                    ref: (el: HTMLInputElement | null) => {
                      if (el) el.indeterminate = group.check === 'some';
                    },
                    onChange: () => setMany(keys, group.check !== 'all'),
                  }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'js-clean-group-name',
                  'aria-expanded': String(open),
                  onClick: () => setExpanded((prev) => ({ ...prev, ['g:' + group.id]: !open })),
                },
                icon(GROUP_ICONS[group.id] ?? GROUP_ICONS.cache!),
                h('span', { className: 'js-clean-name' }, group.label),
                h('span', { className: 'js-clean-caret' }, open ? '▾' : '▸'),
              ),
              h('span', { className: 'js-clean-size' }, formatBytes(group.bytes)),
            ),
            open ? h('div', { className: 'js-clean-lines' }, ...group.categories.map(categoryLine)) : null,
          );
        }),
      );
    };

    // ---------- 工具界面 ----------
    const destPicker = (): unknown =>
      status?.drives.length
        ? h(
            'select',
            {
              className: 'js-clean-select',
              value: dest,
              onChange: (e: { target: { value: string } }) => setDest(e.target.value),
            },
            ...status.drives.map((d) =>
              h('option', { key: d.root, value: d.root }, `搬到 ${d.root}（剩 ${formatBytes(d.free)}）`),
            ),
          )
        : h('span', { className: 'js-clean-hint' }, '没找到别的盘，搬家需要第二块盘或分区');

    const itemRow = (feature: CleanFeature, c: CleanCategory, item: CleanCategory['items'][number]): unknown =>
      h(
        'div',
        { key: item.id, className: 'js-clean-item' },
        CATEGORY_PICK.includes(feature) || c.reportOnly
          ? null
          : h('input', { type: 'checkbox', checked: isOn('i:' + item.id), onChange: () => toggle('i:' + item.id) }),
        h('span', { className: 'js-clean-item-path', title: item.path }, item.path),
        item.note ? h('span', { className: 'js-clean-tag', title: item.note }, item.note) : null,
        h('span', { className: 'js-clean-size' }, formatBytes(item.size)),
        h(
          'button',
          {
            type: 'button',
            className: 'js-clean-link',
            title: '在资源管理器里看看',
            onClick: () => void reveal(feature, item.id),
          },
          '定位',
        ),
      );

    const toolCategory = (feature: CleanFeature, c: CleanCategory): unknown => {
      const open = expanded[c.id] === true;
      const pickByCategory = CATEGORY_PICK.includes(feature);
      return h(
        'div',
        { key: c.id, className: 'js-clean-cat' },
        h(
          'div',
          { className: 'js-clean-line-head' },
          pickByCategory
            ? h('input', { type: 'checkbox', checked: isOn('c:' + c.id), onChange: () => toggle('c:' + c.id) })
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'js-clean-group-name',
              title: c.label,
              onClick: () => setExpanded((prev) => ({ ...prev, [c.id]: !open })),
            },
            h('span', { className: 'js-clean-name' }, c.label),
            h('span', { className: 'js-clean-caret' }, open ? '▾' : '▸'),
          ),
          h('span', { className: 'js-clean-size' }, formatBytes(c.bytes)),
        ),
        h('div', { className: 'js-clean-explain' }, c.explanation),
        open
          ? h(
              'div',
              { className: 'js-clean-items' },
              ...c.items.slice(0, SHOW_ITEMS).map((item) => itemRow(feature, c, item)),
              c.count > Math.min(c.items.length, SHOW_ITEMS)
                ? h('div', { className: 'js-clean-more' }, `只列出最大的 ${Math.min(c.items.length, SHOW_ITEMS)} 个`)
                : null,
            )
          : null,
      );
    };

    const toolView = (tool: ToolId): unknown => {
      const info = TOOLS.find((t) => t.id === tool)!;
      const options: unknown[] = [];
      if (tool === 'chat') {
        options.push(
          h(
            'select',
            {
              key: 'age',
              className: 'js-clean-select',
              value: String(age),
              onChange: (e: { target: { value: string } }) => setAge(Number(e.target.value)),
            },
            ...AGE_OPTIONS.map((o) => h('option', { key: o.days, value: String(o.days) }, o.label)),
          ),
        );
      }
      if (tool === 'bigfiles' || tool === 'duplicates') {
        const value = tool === 'bigfiles' ? minBig : minDup;
        options.push(
          h(
            'select',
            {
              key: 'size',
              className: 'js-clean-select',
              value: String(value),
              onChange: (e: { target: { value: string } }) =>
                (tool === 'bigfiles' ? setMinBig : setMinDup)(Number(e.target.value)),
            },
            ...SIZE_OPTIONS.filter((o) => tool === 'duplicates' || o.bytes >= 100 * 1024 ** 2).map((o) =>
              h('option', { key: o.bytes, value: String(o.bytes) }, o.label),
            ),
          ),
        );
      }
      if (tool === 'duplicates' && status?.drives.length) {
        options.push(
          h(
            'span',
            { key: 'drives', className: 'js-clean-drives' },
            '也查：',
            ...status.drives.map((d) =>
              h(
                'label',
                { key: d.root, className: 'js-clean-check' },
                h('input', {
                  type: 'checkbox',
                  checked: dupDrives.includes(d.root),
                  onChange: () =>
                    setDupDrives((prev) =>
                      prev.includes(d.root) ? prev.filter((r) => r !== d.root) : [...prev, d.root],
                    ),
                }),
                d.root.length <= 3 ? d.root.replace('\\', '') : d.root,
              ),
            ),
          ),
        );
      }
      const doScan = (): void => {
        const scanOptions =
          tool === 'chat'
            ? age > 0
              ? { olderThanDays: age }
              : {}
            : tool === 'bigfiles'
              ? { minSize: minBig }
              : tool === 'duplicates'
                ? { minSize: minDup, ...(dupDrives.length ? { extraRoots: dupDrives } : {}) }
                : {};
        void scan(startScan(tool, scanOptions));
      };
      const scanned = tool === 'software' ? status?.scans.software !== undefined : !!results[tool];
      const head = h(
        'div',
        { className: 'js-clean-tool-head' },
        h(
          'button',
          {
            type: 'button',
            className: 'js-clean-link',
            onClick: () => {
              setConfirm(null);
              setView('junk');
            },
          },
          '← 返回垃圾清理',
        ),
        h('div', { className: 'js-clean-hint' }, info.hint),
        h(
          'div',
          { className: 'js-clean-row' },
          ...options,
          h(
            'button',
            { type: 'button', className: 'js-clean-btn is-small', disabled: running, onClick: doScan },
            scanned ? '重新扫描' : '开始扫描',
          ),
        ),
      );

      let body: unknown;
      let foot: unknown = null;
      if (tool === 'software') {
        body = software?.length
          ? h(
              'div',
              { className: 'js-clean-list' },
              ...software.map((s) =>
                h(
                  'div',
                  { key: s.id, className: 'js-clean-cat' + (s.blocked ? ' is-report' : '') },
                  h(
                    'div',
                    { className: 'js-clean-line-head' },
                    h('span', { className: 'js-clean-name', title: s.name }, s.name),
                    h('span', { className: 'js-clean-size' }, formatBytes(s.size)),
                    s.blocked
                      ? null
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'js-clean-btn is-small',
                            disabled: running || !dest || (s.running?.length ?? 0) > 0 || status?.readOnly === true,
                            onClick: () => void act(softwareAction('move', s.id, dest)),
                          },
                          '搬家',
                        ),
                  ),
                  h(
                    'div',
                    { className: 'js-clean-explain' },
                    s.blocked
                      ? '不建议搬：' + s.blocked
                      : s.running?.length
                        ? '正在运行（' + s.running.join('、') + '），先关掉再搬'
                        : s.installDir,
                  ),
                ),
              ),
            )
          : h(
              'div',
              { className: 'js-clean-empty' },
              scanned ? '没找到装在 C 盘、又值得搬的软件～' : '点「开始扫描」，看看哪些软件可以搬到别的盘',
            );
        foot = destPicker();
      } else {
        const result = results[tool] ?? null;
        if (!result) {
          body = h('div', { className: 'js-clean-empty' }, '点「开始扫描」，鲸鱼娘先只读地看一遍，不会动任何文件');
        } else if (!result.categories.length) {
          body = h('div', { className: 'js-clean-empty' }, '这里很干净，没什么要收拾的～');
        } else {
          const groups: unknown[] = [];
          const order: string[] = [];
          for (const c of result.categories) if (!order.includes(c.group ?? '')) order.push(c.group ?? '');
          for (const g of order) {
            if (g) groups.push(h('div', { key: 'g:' + g, className: 'js-clean-subtitle' }, g));
            groups.push(...result.categories.filter((c) => (c.group ?? '') === g).map((c) => toolCategory(tool, c)));
          }
          body = h('div', { className: 'js-clean-list' }, ...groups);
          const sel = selectionOf(tool, result, picked);
          const moving = tool === 'bigfiles';
          const label = moving ? `搬走 ${formatBytes(sel.bytes)}` : `立即清理 ${formatBytes(sel.bytes)}`;
          const start = (): void =>
            guarded(
              'tool',
              sel.confirm,
              () => void act(moving ? moveFiles(sel.ids, dest) : runClean(tool, sel.ids, sel.categories)),
              moving ? '确认后开始搬家' : '删除后无法恢复',
              moving ? '确认搬家' : '确认清理',
            );
          foot =
            confirm?.where === 'tool'
              ? confirmCard(confirm)
              : h(
                  'div',
                  { className: 'js-clean-row' },
                  moving ? destPicker() : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'js-clean-btn is-primary is-small',
                      disabled:
                        running ||
                        status?.readOnly === true ||
                        (!sel.ids.length && !sel.categories.length) ||
                        (moving && !dest),
                      onClick: start,
                    },
                    label,
                  ),
                );
        }
      }

      // 搬家记录（大文件 / 软件）
      const moves =
        tool === 'bigfiles' || tool === 'software'
          ? (status?.moves ?? []).filter((m) => m.state === 'moved' && m.feature === tool).slice(0, 30)
          : [];
      const movesNode = moves.length
        ? h(
            'div',
            { className: 'js-clean-section' },
            h('div', { className: 'js-clean-subtitle' }, '搬家记录'),
            ...moves.map((m) =>
              h(
                'div',
                { key: m.id, className: 'js-clean-batch' },
                h(
                  'div',
                  { className: 'js-clean-batch-text', title: m.from + ' → ' + m.to },
                  `${m.name} · ${formatBytes(m.size)} → ${m.to}`,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'js-clean-btn is-small',
                    disabled: running,
                    onClick: () =>
                      void act(m.feature === 'software' ? softwareAction('restore', m.id) : restoreFiles([m.id])),
                  },
                  '搬回来',
                ),
              ),
            ),
          )
        : null;

      return h(
        'div',
        { className: 'js-clean-toolview' },
        head,
        body,
        movesNode,
        foot ? h('div', { className: 'js-clean-foot' }, foot) : null,
      );
    };

    return h(
      'div',
      { className: 'js-clean' },
      h('div', { className: 'js-clean-fixed' }, ...banners, topBar, summary, toolbar, noticeNode),
      h('div', { className: 'js-clean-scroll' }, view === 'junk' ? junkView() : toolView(view as ToolId)),
    );
  };
}
