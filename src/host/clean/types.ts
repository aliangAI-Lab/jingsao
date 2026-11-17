/**
 * C 盘清理的共用类型：五个功能（垃圾清理 / 微信QQ专清 / 重复文件 / 大文件搬家 / 软件搬家）
 * 的扫描结果、进度与操作记录都按这里的形状交给路由层，再原样转给页面。
 *
 * 只放类型与常量，不放逻辑；各功能的实现分别在同目录的子模块里。
 * 字段一旦被页面使用就不能改名，新增字段一律可选。
 * @module jingsao/src/host/clean/types
 */

/** 五个功能的标识；路由路径与页面标签页都按它分。 */
export type CleanFeature = 'junk' | 'chat' | 'duplicates' | 'bigfiles' | 'software';

/**
 * 风险档位：safe = 放心清，cost = 清了有点代价，risky = 我不敢动（只报告或需要用户手动确认）。
 * 页面按档位分组、上色；risky 默认不勾选。
 */
export type CleanTier = 'safe' | 'cost' | 'risky';

/** 一个具体文件（或软件搬家里的一个目录）。 */
export interface CleanItem {
  /** 本次扫描内唯一的 id；后续操作只认 id，不认页面传回来的路径。 */
  id: string;
  /** 绝对路径（仅用于展示与「打开所在位置」）。 */
  path: string;
  /** 字节数。 */
  size: number;
  /** 最后修改时间（epoch 毫秒）。 */
  mtimeMs: number;
  /** 默认是否勾选。 */
  selected?: boolean;
  /** 额外说明（例如重复文件组里「建议保留」）。 */
  note?: string;
}

/** 一个分类（一条规则、一个聊天软件的一类文件、一组重复文件……）。 */
export interface CleanCategory {
  /** 分类 id（在同一功能内唯一）。 */
  id: string;
  /** 给普通人看的名字，例如「显卡画面缓存」。 */
  label: string;
  tier: CleanTier;
  /** 一句话解释：这是什么、清了有什么影响。 */
  explanation: string;
  /** 分类内总字节数（含未列出的项）。 */
  bytes: number;
  /** 分类内总文件数（含未列出的项）。 */
  count: number;
  /** 列出的项；超过上限时只列最大的若干个，bytes / count 仍是全量。 */
  items: CleanItem[];
  /** true = 只报告，不提供清理按钮。 */
  reportOnly?: boolean;
  /**
   * 分组：微信QQ = 聊天软件名（页面二级标题，例如「微信」）；
   * 垃圾清理 = app / system / cache / temp / dev / recycle，只报告的系统大块头为 report。
   */
  group?: string;
  /** 默认是否勾选；false = 用户自己勾的风险项，点清理前要就地确认。缺省按 tier !== 'risky' 推断。 */
  defaultChecked?: boolean;
  /** 需要管理员权限（Windows / ProgramData / Program Files 下的规则）：清理时整批提权一次。 */
  needsAdmin?: boolean;
  /** 勾选时显示的一句风险提示。 */
  warn?: string;
  /** 扫描时有目录读不到（多半需要管理员）：bytes 只是读得到的部分，为 0 时页面显示「需管理员」。 */
  unreadable?: boolean;
  /** 不直接删文件、改用系统命令清理（回收站、传递优化缓存）：没有逐个文件的列表。 */
  special?: 'delivery-opt' | 'recycle-bin';
  /** 只报告的分类上「用系统方式清理」按钮能做的事。 */
  systemAction?: 'winsxs' | 'windows-old';
}

/** 扫描进度；页面轮询或随状态推送。 */
export interface CleanProgress {
  feature: CleanFeature;
  phase: 'idle' | 'scanning' | 'working' | 'done' | 'error' | 'cancelled';
  /** 正在看的目录或文件（展示用，可截断）。 */
  current?: string;
  /** 已处理文件数。 */
  files: number;
  /** 已处理字节数。 */
  bytes: number;
  /** 已知总量时给出（用于进度条）；未知时缺省。 */
  totalFiles?: number;
  totalBytes?: number;
  /** phase = error 时的可读原因。 */
  error?: string;
}

/** 一次扫描的完整结果。 */
export interface CleanScanResult {
  feature: CleanFeature;
  scanId: string;
  startedAt: number;
  finishedAt: number;
  categories: CleanCategory[];
  /** 所有可清理（非 reportOnly）分类的字节数之和。 */
  totalBytes: number;
}

/** 一次直接删除的结果（垃圾清理 / 微信QQ / 重复文件共用），作为任务 outcome 原样给页面。 */
export interface CleanRunOutcome {
  /** 删掉的文件数与字节数（系统命令清掉的回收站、传递优化缓存按命令前统计的大小计入 bytes）。 */
  files: number;
  bytes: number;
  /** 跳过的文件数（被占用、没有权限、扫描后有变化），不算失败。 */
  skipped: number;
  /** 因为没有获得管理员权限而这次没清的规则数。 */
  adminSkipped: number;
  /** Windows 更新正在进行，整条跳过的规则（label）。 */
  updateBusy: string[];
  /** 系统命令（回收站、传递优化）失败的说明。 */
  commandErrors: string[];
  /** 是否中途取消。 */
  cancelled: boolean;
}

/** 上个版本暂存区里还留着的东西（面板顶部提示一次，处理完不再提示）。 */
export interface LegacyStagingSummary {
  files: number;
  bytes: number;
}

/** 搬家记录（大文件搬家与软件搬家共用）。 */
export interface MoveRecord {
  id: string;
  feature: 'bigfiles' | 'software';
  /** 展示名：文件名或软件名。 */
  name: string;
  from: string;
  to: string;
  size: number;
  movedAt: number;
  /** linked = 原位置留了目录联接（软件搬家）；moved = 原位置不留东西（大文件搬家）。 */
  mode: 'linked' | 'moved';
  state: 'moved' | 'restored' | 'failed';
  error?: string;
}

/** 已安装软件（软件搬家列表用）。 */
export interface SoftwareEntry {
  id: string;
  name: string;
  publisher?: string;
  installDir: string;
  size: number;
  /** 不能搬的原因；null = 可以搬。 */
  blocked: string | null;
  /** 正在运行的进程名（搬之前要先关）。 */
  running?: string[];
}

/** 列表里最多给页面的单分类项数；超出部分只计入 bytes / count。 */
export const MAX_ITEMS_PER_CATEGORY = 500;
