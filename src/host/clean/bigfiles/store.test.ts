/**
 * 大文件搬家执行与记录的单元测试 —— 钉住四件事：
 *   ① 目标检查：相对路径、用户目录内、测试根外、系统目录 / Program Files 都不能用；
 *   ② 搬家：保留相对结构、重名加后缀、内容一致、源文件删除、记录落盘可读回；
 *   ③ 失败不伤源：扫描后文件变了、取消，都保持源文件原样且不留半个目标；
 *   ④ 还原：放回原位并清掉新位置；原位已有同名文件时不覆盖；只读与忙碌时拒绝。
 *
 * 所有文件都造在 F:\dev\_cache\tmp 下的测试根里，不碰真实 C 盘。
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { locations, type CleanPlaces } from '../safety.ts';
import { checkDestination, MoveStore, scanBigFiles, type BigFileCandidate } from './index.ts';

const TMP = 'F:\\dev\\_cache\\tmp';
let root = '';
let places: CleanPlaces;
let dest = '';
let recordFile = '';
let caseSeq = 0;
let clock = 1_000_000;

/** 造文件，内容按名字区分，便于比对。 */
function make(rel: string, size: number): string {
  const file = join(places.home, rel);
  mkdirSync(dirname(file), { recursive: true });
  const body = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) body[i] = (i * 31 + rel.length) % 251;
  writeFileSync(file, body);
  return file;
}

/** 扫一次，取出某个文件的候选。 */
async function candidateOf(path: string): Promise<BigFileCandidate> {
  const { candidates } = await scanBigFiles(places, { minSize: 1000 });
  const found = [...candidates.values()].find((item) => item.path === path);
  assert.ok(found, `扫描结果里应该有 ${path}`);
  return found;
}

function makeStore(overrides: Partial<CleanPlaces> = {}): MoveStore {
  return new MoveStore({ places: { ...places, ...overrides }, file: recordFile, now: () => (clock += 1) });
}

before(() => {
  mkdirSync(TMP, { recursive: true });
  root = mkdtempSync(join(TMP, 'jingsao-bigmove-'));
  places = locations({ JINGSAO_TEST_ROOT: root });
});

beforeEach(() => {
  caseSeq += 1;
  rmSync(places.home, { recursive: true, force: true });
  dest = join(root, `D盘-${caseSeq}`, '搬家');
  recordFile = join(root, 'data', `moves-${caseSeq}.json`);
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('checkDestination', () => {
  test('各种不能用的目标', () => {
    assert.match(checkDestination('relative\\dir', places)!, /完整的文件夹路径/);
    assert.match(checkDestination(join(places.home, 'Desktop'), places)!, /用户文件夹/);
    assert.match(checkDestination('F:\\elsewhere', places)!, /超出测试目录/);
    assert.match(checkDestination(join(root, 'Windows', 'x'), places)!, /系统目录/);
    assert.match(checkDestination(join(root, 'Program Files', 'x'), places)!, /软件安装目录/);
    assert.match(checkDestination('\\\\server\\share', places)!, /网络位置/);
    assert.match(checkDestination(dest, places, Number.MAX_SAFE_INTEGER)!, /空间不够/);
  });

  test('测试根里、用户目录外的目录可用（可以还不存在）', () => {
    assert.equal(checkDestination(dest, places), null);
  });

  test('真实模式下不能在系统盘', () => {
    const real: CleanPlaces = { ...places, test: null, drive: 'C:\\', home: 'C:\\Users\\x' };
    assert.match(checkDestination('C:\\Backup', real)!, /不能在 C 盘/);
    assert.match(checkDestination('c:\\Backup', real)!, /不能在 C 盘/);
  });
});

describe('MoveStore —— 搬家', () => {
  test('搬走：保留结构、内容一致、源删除、记录可读回', async () => {
    const source = make('Downloads\\sub\\movie.mp4', 5000);
    const original = readFileSync(source);
    const candidate = await candidateOf(source);
    const store = makeStore();
    const phases: string[] = [];
    const [record] = await store.moveFiles([candidate], dest, { onProgress: (p) => phases.push(p.phase) });
    assert.equal(record!.state, 'moved', String(record!.error));
    assert.equal(record!.mode, 'moved');
    assert.equal(record!.to, join(dest, '鲸扫搬家', '大文件', 'Downloads', 'sub', 'movie.mp4'));
    assert.equal(existsSync(source), false);
    assert.deepEqual(readFileSync(record!.to), original);
    assert.ok(Math.abs(lstatSync(record!.to).mtimeMs - candidate.identity.mtimeMs) < 1);
    assert.equal(phases[phases.length - 1], 'done');
    const reread = makeStore().history();
    assert.equal(reread.length, 1);
    assert.equal(reread[0]!.id, record!.id);
  });

  test('目标已有同名文件时加 (1) 后缀，history 新的在前', async () => {
    const source = make('Videos\\a.mkv', 3000);
    const existing = join(dest, '鲸扫搬家', '大文件', 'Videos', 'a.mkv');
    mkdirSync(dirname(existing), { recursive: true });
    writeFileSync(existing, 'old');
    const second = make('Videos\\b.mkv', 3000);
    const store = makeStore();
    const records = await store.moveFiles([await candidateOf(source), await candidateOf(second)], dest);
    assert.equal(records[0]!.to, join(dirname(existing), 'a (1).mkv'));
    assert.equal(readFileSync(existing, 'utf8'), 'old');
    assert.deepEqual(
      store.history().map((record) => record.name),
      ['b.mkv', 'a.mkv'],
    );
  });

  test('扫描后文件变了：记 failed，源不动，目标不留', async () => {
    const source = make('Documents\\big.pdf', 3000);
    const candidate = await candidateOf(source);
    writeFileSync(source, Buffer.alloc(3500, 1));
    const [record] = await makeStore().moveFiles([candidate], dest);
    assert.equal(record!.state, 'failed');
    assert.match(record!.error!, /变化/);
    assert.equal(lstatSync(source).size, 3500);
    assert.equal(existsSync(join(dest, '鲸扫搬家', '大文件', 'Documents', 'big.pdf')), false);
  });

  test('目标不可用时直接抛错，什么都不动', async () => {
    const source = make('Downloads\\x.zip', 3000);
    await assert.rejects(makeStore().moveFiles([await candidateOf(source)], join(places.home, 'X')), /用户文件夹/);
    assert.ok(existsSync(source));
  });

  test('取消：已取消的信号不处理任何文件', async () => {
    const source = make('Downloads\\y.zip', 3000);
    const controller = new AbortController();
    controller.abort();
    const records = await makeStore().moveFiles([await candidateOf(source)], dest, { signal: controller.signal });
    assert.deepEqual(records, []);
    assert.ok(existsSync(source));
  });

  test('只读模式与并发调用都被拒绝', async () => {
    const source = make('Downloads\\z.zip', 3000);
    const candidate = await candidateOf(source);
    await assert.rejects(makeStore({ readOnly: true }).moveFiles([candidate], dest), /只读/);
    const store = makeStore();
    const first = store.moveFiles([candidate], dest);
    await assert.rejects(store.moveFiles([candidate], dest), /还没结束/);
    assert.equal((await first)[0]!.state, 'moved');
  });
});

describe('MoveStore —— 还原', () => {
  test('放回原位、清掉新位置与空目录、记录变 restored', async () => {
    const source = make('Music\\album\\song.flac', 4000);
    const original = readFileSync(source);
    const store = makeStore();
    const [moved] = await store.moveFiles([await candidateOf(source)], dest);
    rmSync(join(places.home, 'Music'), { recursive: true });
    const [restored] = await store.restore([moved!.id]);
    assert.equal(restored!.state, 'restored', String(restored!.error));
    assert.deepEqual(readFileSync(source), original);
    assert.equal(existsSync(moved!.to), false);
    assert.equal(existsSync(join(dest, '鲸扫搬家', '大文件', 'Music')), false);
    assert.equal(makeStore().history()[0]!.state, 'restored');
  });

  test('原位置已有同名文件：不覆盖，记录仍是 moved 并带原因', async () => {
    const source = make('Pictures\\p.psd', 4000);
    const store = makeStore();
    const [moved] = await store.moveFiles([await candidateOf(source)], dest);
    writeFileSync(source, 'new one');
    const [result] = await store.restore([moved!.id]);
    assert.equal(result!.state, 'moved');
    assert.match(result!.error!, /同名文件/);
    assert.equal(readFileSync(source, 'utf8'), 'new one');
    assert.ok(existsSync(moved!.to));
  });

  test('未知 id 与已还原的记录跳过', async () => {
    const store = makeStore();
    assert.deepEqual(await store.restore(['nope']), []);
  });
});
