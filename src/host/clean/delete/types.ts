/**
 * 直接删除的候选契约：扫描时记下身份与范围，动手前逐个复核，三个删除类功能（垃圾 / 微信QQ / 重复文件）共用。
 * 页面展示类型归 ../types；删除过程与提权脚本分别在 ./remove 与 ./elevated。
 * @module jingsao/src/host/clean/delete/types
 */
import type { FileIdentity } from '../safety.ts';

/** 一个待删文件：保留扫描依据，防止用户确认期间文件被替换后仍然删掉。 */
export interface DeleteCandidate {
  id: string;
  path: string;
  identity: FileIdentity;
  /** 所属分类（垃圾清理 = 规则 id）。 */
  categoryId: string;
  /** 文件必须位于这个根目录之内（不含根本身）。 */
  root?: string;
  /** 规则登记的系统根目录（Windows / ProgramData / Program Files 下的规则才有），安全闸据此放行。 */
  systemRoot?: string;
  /** 只删这么多天以前修改的。 */
  ageDays?: number;
  /** 只删这么多小时以前修改的。 */
  minAgeHours?: number;
  /** 需要管理员权限：交给提权子进程整批删。 */
  needsAdmin?: boolean;
}

/**
 * 扫描时读不到（需要管理员）的根目录：提权子进程在里面按同样的约束自己枚举再删。
 * 没有扫描时的身份可比，只能靠根目录、不跟随联接、文件名模式与年龄这几条约束。
 */
export interface AdminDir {
  categoryId: string;
  root: string;
  /** 文件名模式（只支持 *）；缺省 = 全部文件。 */
  files?: string[];
  /** 只删修改时间早于这么多毫秒的（ageDays 与 minAgeHours 取严的那个）。 */
  minAgeMs: number;
}

/** 一个分类的删除计数。 */
export interface DeleteTally {
  files: number;
  bytes: number;
  /** 跳过（被占用、没有权限、扫描后有变化、已经不在）的文件数，不算失败。 */
  skipped: number;
}

/** 跳过原因：只用于计数与日志，不给页面逐个列出。 */
export type SkipReason = 'busy' | 'denied' | 'changed' | 'gone';
