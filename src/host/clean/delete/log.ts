/**
 * 清理审计日志：插件数据目录下的 clean-log.jsonl，每次清理按批次（规则）写一行，只保留最近 30 天。
 *
 * 一行 = { time, feature, ruleId, files, bytes, skipped }。只记数量，不记文件路径（路径可能含隐私）。
 * 写入先写同目录临时文件再整体替换，断电最多丢掉这一次的几行，不会把旧日志写坏。
 * @module jingsao/src/host/clean/delete/log
 */
import fs from 'node:fs';
import { dirname } from 'node:path';
import { DAY_MS, noLinks, within, type CleanPlaces } from '../safety.ts';
import type { CleanFeature } from '../types.ts';

/** 日志保留天数。 */
export const CLEAN_LOG_KEEP_DAYS = 30;

/** 日志里的一行。 */
export interface CleanLogEntry {
  /** 写入时刻（epoch 毫秒）。 */
  time: number;
  feature: CleanFeature;
  /** 规则 id（微信QQ = 分类 id，重复文件 = duplicates）。 */
  ruleId: string;
  files: number;
  bytes: number;
  skipped: number;
}

/** 读日志；文件不存在或坏行一律跳过。 */
export function readCleanLog(file: string): CleanLogEntry[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: CleanLogEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as CleanLogEntry;
      if (typeof entry.time === 'number' && typeof entry.ruleId === 'string') out.push(entry);
    } catch {
      /* 断电留下的半行：丢掉 */
    }
  }
  return out;
}

/**
 * 追加一批记录并裁掉 30 天以前的旧行。
 * @param file - 日志文件（测试模式下必须在测试根里）。
 * @param entries - 本批记录。
 * @param places - 位置表（只用来判断测试根）。
 * @param now - 当前时刻。
 */
export function appendCleanLog(
  file: string,
  entries: readonly CleanLogEntry[],
  places: CleanPlaces,
  now: number,
): void {
  if (!entries.length) return;
  if (places.test && !within(places.test, file)) throw new Error('写入位置超出测试目录');
  noLinks(file, { allowMissing: true });
  fs.mkdirSync(dirname(file), { recursive: true });
  const cutoff = now - CLEAN_LOG_KEEP_DAYS * DAY_MS;
  const kept = readCleanLog(file).filter((entry) => entry.time >= cutoff);
  const text = [...kept, ...entries].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, 'utf8');
  fs.renameSync(temp, file);
}
