/**
 * 垃圾规则的结构校验：目录展开始终留在规则自己的基础目录（环境变量推导）之内。
 * 文件身份与永久保护范围由安全闸复核，规则只提供可重建缓存的范围、分组和解释。
 *
 * 规则里没有写死任何用户名或盘符：base 决定从哪个环境变量出发（见 safety 的 locations），
 * paths 只能是相对路径，单层通配符 `*` 只展开一层目录。每条规则只认它自己的根目录，
 * 不跟随联接和符号链接，不进入根目录以外的地方。
 *
 * 「明确不做」的清理项（别的清理工具做了、我们判断有风险或不属于垃圾）不在这里，也加不进来：
 * safety 的 FORBIDDEN_SYSTEM 会把它们整棵拦下，理由见那里的注释和 README。
 * @module jingsao/src/host/clean/junk/rules
 */
import data from './rules.json' with { type: 'json' };
import type { CleanTier } from '../types.ts';

/** 规则的基础目录：用户级三个 + 系统级四个（都从环境变量推导，测试模式整体换进测试根）。 */
export type JunkBase = 'local' | 'roaming' | 'home' | 'windows' | 'programdata' | 'systemdrive' | 'programfilesx86';

/** 面板分组：应用程序 / 系统相关 / 缓存文件 / 临时文件 / 开发工具缓存 / 回收站。 */
export type JunkGroup = 'app' | 'system' | 'cache' | 'temp' | 'dev' | 'recycle';

/** 全部分组（面板按这个顺序排）。 */
export const JUNK_GROUPS: readonly JunkGroup[] = ['app', 'system', 'cache', 'temp', 'dev', 'recycle'];

/** 不直接删文件、改用系统官方命令的特殊规则。 */
export type JunkSpecial = 'delivery-opt' | 'recycle-bin';

/** 动手前要先过的系统检查：windows-update = Windows 更新正在下载或安装时整条跳过。 */
export type JunkGuard = 'windows-update';

/** 单个位置的细化写法：同一条规则里不同位置的文件模式、年龄可以不同。 */
export interface JunkPathSpec {
  /** 相对 base 的路径（规则同 paths 的字符串写法）。 */
  path: string;
  /** 只认这些文件名模式（只支持 *）；缺省沿用规则级 files。 */
  files?: string[];
  /** 只删这么多天以前修改的；缺省沿用规则级 ageDays。 */
  ageDays?: number;
  /** true = path 指向单个文件（例如 Windows\MEMORY.DMP），不是目录。 */
  single?: boolean;
}

/** 将风险说明与目录范围放在一起，便于页面解释每一次选择。 */
export interface JunkRule {
  id: string;
  label: string;
  /** 风险档位：用于排序和颜色。 */
  tier: CleanTier;
  /** 面板分组。 */
  group: JunkGroup;
  /** 扫描后是否默认勾选；false = 用户自己勾的风险项，点清理前要就地确认。 */
  defaultChecked: boolean;
  /** 目标在 Windows / ProgramData / Program Files 下，需要管理员权限（整批一次提权）。 */
  needsAdmin: boolean;
  base: JunkBase;
  paths: Array<string | JunkPathSpec>;
  files?: string[];
  ageDays?: number;
  /** 只删修改时间早于 N 小时的文件（临时目录一律 24）。 */
  minAgeHours?: number;
  /** 勾选时在面板里显示的一句风险提示。 */
  warn?: string;
  /** 不删文件、调系统官方命令的规则；paths 只用来估算大小。 */
  special?: JunkSpecial;
  /** 动手前的系统检查。 */
  guard?: JunkGuard;
  /** 通配符展开时跳过的目录名（不分大小写），例如英伟达下载包里的 latest。 */
  skipDirs?: string[];
  /** 根目录里（含子目录）至少要有一个文件匹配这些模式才算数（驱动解压目录要有 setup.exe 或 *.inf）。 */
  marker?: string[];
  explanation: string;
  basis: string;
}

const BASES: readonly JunkBase[] = [
  'local',
  'roaming',
  'home',
  'windows',
  'programdata',
  'systemdrive',
  'programfilesx86',
];
const SPECIALS: readonly JunkSpecial[] = ['delivery-opt', 'recycle-bin'];
const GUARDS: readonly JunkGuard[] = ['windows-update'];

function validSegment(segment: string): boolean {
  return (
    segment === '*' ||
    (segment.length > 0 &&
      !/[\\:*?"<>|]/.test(segment) &&
      ![...segment].some((character) => character.charCodeAt(0) < 32) &&
      !/[. ]$/.test(segment))
  );
}

/** 相对路径：只能由合法段与单独的 * 组成。 */
function validPath(path: unknown): boolean {
  return typeof path === 'string' && path.split('/').every(validSegment);
}

/** 文件名模式：只认文件名与 *，不能带路径。 */
function validFilePatterns(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (file) =>
        typeof file === 'string' &&
        !!file &&
        !/[\\/:?"<>|]/.test(file) &&
        ![...file].some((character) => character.charCodeAt(0) < 32) &&
        file !== '..',
    )
  );
}

/** 非负有限数。 */
const nonNegative = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** 单个位置：字符串或细化写法。 */
function validPathEntry(entry: unknown): boolean {
  if (typeof entry === 'string') return validPath(entry);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const spec = entry as Record<string, unknown>;
  if (!validPath(spec.path)) return false;
  if (spec.files !== undefined && !validFilePatterns(spec.files)) return false;
  if (spec.ageDays !== undefined && !nonNegative(spec.ageDays)) return false;
  if (spec.single !== undefined && typeof spec.single !== 'boolean') return false;
  // 单文件不能带通配符：它指的就是那一个文件
  if (spec.single === true && (spec.path as string).split('/').includes('*')) return false;
  return true;
}

/** 调用方注入的规则也走同一校验，避免测试入口绕过目录边界。 */
export function validateJunkRules(value: unknown): JunkRule[] {
  if (!Array.isArray(value)) throw new Error('规则必须是数组');
  const ids = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') throw new Error('规则必须是对象');
    const rule = raw as Record<string, unknown>;
    for (const key of ['id', 'label', 'explanation', 'basis']) {
      if (typeof rule[key] !== 'string' || !(rule[key] as string).trim()) throw new Error(`规则缺少 ${key}`);
    }
    const id = rule.id as string;
    if (ids.has(id) || id.startsWith('system-')) throw new Error(`规则 id 重复或占用系统前缀：${id}`);
    ids.add(id);
    if (!['safe', 'cost', 'risky'].includes(String(rule.tier))) throw new Error('规则风险档位无效');
    if (!(BASES as readonly string[]).includes(String(rule.base))) throw new Error('规则基础目录无效');
    if (!(JUNK_GROUPS as readonly string[]).includes(String(rule.group))) throw new Error('规则分组无效');
    if (typeof rule.defaultChecked !== 'boolean') throw new Error('规则缺少 defaultChecked');
    if (typeof rule.needsAdmin !== 'boolean') throw new Error('规则缺少 needsAdmin');
    if (!Array.isArray(rule.paths) || !rule.paths.length || !rule.paths.every(validPathEntry)) {
      throw new Error('规则路径必须是相对路径，不能含 ..、反斜线或无效路径段');
    }
    if (rule.files !== undefined && !validFilePatterns(rule.files)) throw new Error('文件模式只支持文件名和 *');
    if (rule.ageDays !== undefined && !nonNegative(rule.ageDays)) throw new Error('文件年龄必须是非负数');
    if (rule.minAgeHours !== undefined && !nonNegative(rule.minAgeHours)) throw new Error('文件年龄必须是非负数');
    if (rule.warn !== undefined && (typeof rule.warn !== 'string' || !rule.warn.trim())) {
      throw new Error('风险提示必须是非空字符串');
    }
    if (rule.special !== undefined && !(SPECIALS as readonly unknown[]).includes(rule.special)) {
      throw new Error('特殊规则类型无效');
    }
    if (rule.guard !== undefined && !(GUARDS as readonly unknown[]).includes(rule.guard)) {
      throw new Error('规则检查类型无效');
    }
    if (
      rule.skipDirs !== undefined &&
      (!Array.isArray(rule.skipDirs) ||
        rule.skipDirs.some((name) => typeof name !== 'string' || name === '*' || !validSegment(name)))
    ) {
      throw new Error('跳过的目录名无效');
    }
    if (rule.marker !== undefined && !validFilePatterns(rule.marker)) throw new Error('标记文件模式只支持文件名和 *');
  }
  return structuredClone(value) as JunkRule[];
}

/** 每次返回独立副本，避免调用者修改后影响后续扫描。 */
export function loadJunkRules(): JunkRule[] {
  return validateJunkRules(data);
}

/** 位置的统一写法（字符串展开成细化写法）。 */
export function pathSpecs(rule: JunkRule): JunkPathSpec[] {
  return rule.paths.map((entry) => (typeof entry === 'string' ? { path: entry } : entry));
}
