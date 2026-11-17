/**
 * 搬家记录文件（大文件搬家与软件搬家各用一份）：单个 JSON，构造时同步读入，改动后原子写回。
 *
 * 不负责搬家本身（归 ./store 与 ../software/mover），也不做并发排队：调用方用自己的 busy 锁保证同一时刻只有一个写者。
 * 记录是「还原」的唯一依据，所以每处理完一个文件就落盘一次，进程中途退出也不丢已完成的记录。
 * 坏文件按空记录继续，并把原文件改名留底（不覆盖用户还没还原的记录）。
 * @module jingsao/src/host/clean/bigfiles/records
 */
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MoveRecord } from '../types.ts';

/** 记录文件格式版本。 */
export const MOVE_RECORD_VERSION = 1;

/** 磁盘上的记录文件。 */
interface MoveRecordFile {
  version: number;
  records: MoveRecord[];
}

/** 粗校验一条记录的形状。 */
function isRecord(value: unknown): value is MoveRecord {
  const record = value as Partial<MoveRecord> | null;
  return (
    !!record &&
    typeof record.id === 'string' &&
    (record.feature === 'bigfiles' || record.feature === 'software') &&
    typeof record.from === 'string' &&
    typeof record.to === 'string' &&
    typeof record.size === 'number' &&
    typeof record.movedAt === 'number' &&
    (record.mode === 'linked' || record.mode === 'moved') &&
    (record.state === 'moved' || record.state === 'restored' || record.state === 'failed')
  );
}

/** 一份记录文件的内存副本与原子写。 */
export class RecordFile {
  declare private readonly file: string;
  declare private records: MoveRecord[];

  constructor(file: string) {
    this.file = file;
    this.records = RecordFile.load(file);
  }

  /** 同步读入；不存在返回空，坏文件改名为 .broken-<时间> 留底后返回空。 */
  private static load(file: string): MoveRecord[] {
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Partial<MoveRecordFile>;
      if (!Array.isArray(parsed.records)) throw new Error('记录文件格式不对');
      return parsed.records.filter(isRecord);
    } catch {
      try {
        mkdirSync(dirname(file), { recursive: true });
        renameSync(file, `${file}.broken-${Date.now()}`);
      } catch {
        /* 留底失败也按空记录继续；下一次写入会覆盖 */
      }
      return [];
    }
  }

  /** 全部记录的副本（新的在前）。 */
  list(): MoveRecord[] {
    return this.records
      .map((record, index) => ({ record, index }))
      .sort((a, b) => b.record.movedAt - a.record.movedAt || b.index - a.index)
      .map(({ record }) => ({ ...record }));
  }

  /** 按 id 取一条（副本）。 */
  get(id: string): MoveRecord | null {
    const found = this.records.find((record) => record.id === id);
    return found ? { ...found } : null;
  }

  /** 新增或按 id 替换一条，并原子落盘。 */
  async put(record: MoveRecord): Promise<void> {
    const next = [...this.records];
    const index = next.findIndex((item) => item.id === record.id);
    if (index >= 0) next[index] = { ...record };
    else next.push({ ...record });
    const body: MoveRecordFile = { version: MOVE_RECORD_VERSION, records: next };
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(body, null, 2) + '\n', 'utf8');
    await rename(temp, this.file);
    this.records = next;
  }
}
