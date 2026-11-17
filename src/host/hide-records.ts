/** 收起记录的原子文件读写；调用方通过配置队列串行化修改。 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PetDisplay } from '../shared/types.ts';

/** 按宠物 id 保存的收起前显示位置。 */
export type HideRecords = Record<string, PetDisplay>;

/** 收起记录与主配置共用插件用户数据目录。 */
export const hideRecordsPath = (userRoot: string): string => join(userRoot, 'hidden-pets.json');

/** 缺失、损坏或版本不支持时返回空记录；其他 IO 错误交给动作入口报告。 */
export async function readHideRecords(path: string): Promise<HideRecords> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (!raw || typeof raw !== 'object') return {};
  const document = raw as { stateVersion?: unknown; pets?: unknown };
  if (
    document.stateVersion !== 1 ||
    !document.pets ||
    typeof document.pets !== 'object' ||
    Array.isArray(document.pets)
  )
    return {};
  return Object.fromEntries(
    Object.entries(document.pets).filter(
      ([, display]) => display === 'web' || display === 'desktop' || display === 'both',
    ),
  ) as HideRecords;
}

/** 先写同目录临时文件再替换，避免中断留下半份 JSON。 */
export async function writeHideRecords(path: string, pets: HideRecords): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify({ stateVersion: 1, pets }, null, 2), 'utf8');
  await rename(path + '.tmp', path);
}
