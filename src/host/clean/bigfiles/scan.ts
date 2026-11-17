/**
 * 大文件搬家的扫描：在用户自己的文件夹里找大文件，按类型分好类交给页面挑。
 *
 * 只读，不负责搬（归 ./store）。遍历规则（去哪找、哪些不碰）在 ./walk，这里只管分类与汇总。
 * 每个文件记下身份（大小、修改时间、ino、dev），搬之前再比对，变了就不动。
 * 大文件默认不勾选：搬哪个由用户自己决定。
 * @module jingsao/src/host/clean/bigfiles/scan
 */
import { randomUUID } from 'node:crypto';
import {
  MAX_ITEMS_PER_CATEGORY,
  type CleanCategory,
  type CleanItem,
  type CleanProgress,
  type CleanScanResult,
} from '../types.ts';
import type { CleanPlaces, FileIdentity } from '../safety.ts';
import { defaultUserRoots, walkUserFiles, type FileType } from './walk.ts';

/** 默认大小下限：100 MB。 */
export const BIG_FILE_MIN_SIZE = 100 * 1024 * 1024;

/** 扫描选项。 */
export interface BigFileScanOptions {
  /** 大小下限（字节），默认 100 MB。 */
  minSize?: number;
  /** 扫描根；缺省用用户主目录下的个人文件夹。 */
  roots?: string[];
  signal?: AbortSignal;
  onProgress?: (p: CleanProgress) => void;
}

/** 一个可搬的大文件：搬家时只认 id，按这里的路径和身份复核。 */
export interface BigFileCandidate {
  id: string;
  path: string;
  identity: FileIdentity;
  categoryId: string;
}

/** 分类定义：按类型固定顺序展示。 */
const CATEGORY_DEFS: Array<{ type: FileType; id: string; label: string; explanation: string }> = [
  {
    type: 'installer',
    id: 'installers',
    label: '安装包',
    explanation: '下载、桌面、文档里的安装程序；软件装好后通常用不到了，搬走不影响已装的软件。',
  },
  { type: 'archive', id: 'archives', label: '压缩包和镜像', explanation: '压缩包与光盘镜像；搬到别的盘后照样能打开。' },
  { type: 'video', id: 'videos', label: '视频', explanation: '你自己的视频文件；搬到别的盘后从新位置打开。' },
  { type: 'audio', id: 'audio', label: '音频', explanation: '你自己的音频文件；搬到别的盘后从新位置打开。' },
  { type: 'image', id: 'images', label: '图片', explanation: '大尺寸图片与设计稿；搬到别的盘后从新位置打开。' },
  {
    type: 'document',
    id: 'documents',
    label: '办公文档',
    explanation: 'PDF、Word、Excel、PPT 等；搬走后旧的「最近打开」记录会失效。',
  },
  { type: 'other', id: 'others', label: '其他大文件', explanation: '其他类型的大文件；不确定是什么的先别搬。' },
];

/** 生成一次扫描的 id。 */
function newScanId(feature: string): string {
  return `${feature}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * 扫描大文件。
 *
 * @returns result 给页面；candidates 留在宿主侧，搬家时按 id 取（只含列出来的项）。
 */
export async function scanBigFiles(
  places: CleanPlaces,
  options: BigFileScanOptions = {},
): Promise<{ result: CleanScanResult; candidates: Map<string, BigFileCandidate> }> {
  const startedAt = Date.now();
  const scanId = newScanId('bigfiles');
  const minSize = options.minSize ?? BIG_FILE_MIN_SIZE;
  const report = (progress: Omit<CleanProgress, 'feature'>): void =>
    options.onProgress?.({ feature: 'bigfiles', ...progress });
  const roots = options.roots ?? (await defaultUserRoots(places));
  const found = new Map<FileType, Array<{ path: string; identity: FileIdentity }>>();
  let bytes = 0;
  try {
    await walkUserFiles(
      roots,
      places,
      {
        minSize,
        signal: options.signal,
        onDir: (dir, files) => report({ phase: 'scanning', current: dir, files, bytes }),
      },
      (file) => {
        bytes += file.identity.size;
        const list = found.get(file.type) ?? [];
        list.push({ path: file.path, identity: file.identity });
        found.set(file.type, list);
      },
    );
  } catch (error) {
    if (options.signal?.aborted) report({ phase: 'cancelled', files: 0, bytes });
    else report({ phase: 'error', files: 0, bytes, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }

  const candidates = new Map<string, BigFileCandidate>();
  const categories: CleanCategory[] = [];
  let seq = 0;
  for (const def of CATEGORY_DEFS) {
    const list = found.get(def.type);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => b.identity.size - a.identity.size || a.path.localeCompare(b.path));
    const items: CleanItem[] = list.slice(0, MAX_ITEMS_PER_CATEGORY).map((file) => {
      seq += 1;
      const id = `${scanId}-${seq.toString(36)}`;
      candidates.set(id, { id, path: file.path, identity: file.identity, categoryId: def.id });
      return { id, path: file.path, size: file.identity.size, mtimeMs: file.identity.mtimeMs, selected: false };
    });
    categories.push({
      id: def.id,
      label: def.label,
      tier: 'cost',
      explanation: def.explanation,
      bytes: list.reduce((sum, file) => sum + file.identity.size, 0),
      count: list.length,
      items,
    });
  }
  const totalBytes = categories.reduce((sum, category) => sum + category.bytes, 0);
  report({ phase: 'done', files: [...found.values()].reduce((n, list) => n + list.length, 0), bytes: totalBytes });
  return {
    result: { feature: 'bigfiles', scanId, startedAt, finishedAt: Date.now(), categories, totalBytes },
    candidates,
  };
}
