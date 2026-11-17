/**
 * 提权清理脚本：以普通权限（不弹 UAC）对 F 盘测试目录实际跑一遍生成的 PowerShell 脚本，
 * 验证复核（大小 / 修改时间 / 根目录 / 联接）、目录枚举（文件名模式、年龄、不进联接）与结果回读；
 * 执行器失败时抛「没有获得管理员权限」。另测审计日志只保留 30 天。
 * @module jingsao/src/host/clean/delete/elevated.test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { DAY_MS, inspectCandidate, locations } from '../safety.ts';
import { runScriptFile } from '../software/script.ts';
import { buildCleanScript, ElevationDenied, manifestLines, realElevatedCleaner } from './elevated.ts';
import { appendCleanLog, readCleanLog } from './log.ts';
import type { DeleteCandidate } from './types.ts';

const PARENT = 'F:/dev/_cache/tmp';

function setup() {
  fs.mkdirSync(PARENT, { recursive: true });
  const root = fs.mkdtempSync(join(PARENT, 'elevated-'));
  const places = locations({ JINGSAO_TEST_ROOT: root });
  const put = (path: string, content = '1234', daysOld = 5): string => {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
    const at = new Date(Date.now() - daysOld * DAY_MS);
    fs.utimesSync(path, at, at);
    return path;
  };
  return { root, places, put };
}

test('清单一行一项（制表符分隔），脚本里没有写死的路径以外的东西', () => {
  const lines = manifestLines({
    files: [
      {
        id: '1',
        path: 'F:\\r\\Windows\\Temp\\a.tmp',
        identity: { size: 4, mtimeMs: 1700000000123.75, ino: 1, dev: 1 },
        categoryId: 'win-temp',
        root: 'F:\\r\\Windows\\Temp',
        minAgeHours: 24,
      },
    ],
    dirs: [{ categoryId: 'setup-logs', root: 'F:\\r\\Windows\\Panther', files: ['*.log'], minAgeMs: 0 }],
    commands: ['delivery-opt'],
  });
  assert.deepEqual(lines, [
    'file\twin-temp\t4\t1700000000123\t86400000\tF:\\r\\Windows\\Temp\tF:\\r\\Windows\\Temp\\a.tmp',
    'dir\tsetup-logs\t0\t^.*\\.log$\tF:\\r\\Windows\\Panther',
    'command\tdelivery-opt',
  ]);
  const script = buildCleanScript('F:\\x\\list.txt', 'F:\\x\\result.json');
  assert.match(script, /Delete-DeliveryOptimizationCache -Force/);
  assert.match(script, /ReparsePoint/);
  assert.match(script, /\[IO\.File\]::Delete/);
});

test('真实脚本（普通权限跑在测试目录）：复核一致才删，变了的跳过，目录枚举不进联接', async () => {
  const { root, places, put } = setup();
  const temp = join(places.windows, 'Temp');
  const good = put(join(temp, 'good.tmp'));
  const changed = put(join(temp, 'changed.tmp'));
  const fresh = put(join(temp, 'fresh.tmp'), '1234', 0);
  const panther = join(places.windows, 'Panther');
  const log = put(join(panther, 'sub', 'setupact.log'));
  const xml = put(join(panther, 'unattend.xml'));
  const outside = put(join(root, 'outside', 'keep.log'));
  fs.symlinkSync(dirname(outside), join(panther, 'link'), 'junction');
  const candidate = (path: string, minAgeHours?: number): DeleteCandidate => ({
    id: path,
    path,
    identity: inspectCandidate(path, places, { systemRoots: [temp], root: temp }),
    categoryId: 'win-temp',
    root: temp,
    systemRoot: temp,
    needsAdmin: true,
    ...(minAgeHours ? { minAgeHours } : {}),
  });
  const files = [candidate(good), candidate(changed), candidate(fresh, 24)];
  fs.writeFileSync(changed, '扫描后改过');
  const workDir = join(root, '.jingsao-data', 'clean', 'elevated');
  const requests: string[] = [];
  const cleaner = realElevatedCleaner({
    workDir,
    runner: async (request) => {
      requests.push(request.action);
      await runScriptFile(request.scriptFile);
    },
  });
  const result = await cleaner({
    files,
    dirs: [{ categoryId: 'setup-logs', root: panther, files: ['*.log'], minAgeMs: 0 }],
    commands: [],
  });
  assert.deepEqual(requests, ['clean']);
  assert.deepEqual(result.rules['win-temp'], { files: 1, bytes: 4, skipped: 2 });
  assert.deepEqual(result.rules['setup-logs'], { files: 1, bytes: 4, skipped: 0 });
  assert.ok(!fs.existsSync(good) && !fs.existsSync(log));
  assert.ok(fs.existsSync(changed) && fs.existsSync(fresh) && fs.existsSync(xml) && fs.existsSync(outside));
  assert.deepEqual(fs.readdirSync(workDir), [], '脚本、清单、结果文件用完即删');
});

test('执行器报错（用户在 UAC 里点了「否」）→ 抛 ElevationDenied，文件不动', async () => {
  const { root, places, put } = setup();
  const temp = join(places.windows, 'Temp');
  const file = put(join(temp, 'a.tmp'));
  const cleaner = realElevatedCleaner({
    workDir: join(root, '.jingsao-data', 'clean', 'elevated'),
    runner: async () => {
      throw new Error('操作已被用户取消');
    },
  });
  await assert.rejects(
    cleaner({
      files: [
        {
          id: '1',
          path: file,
          identity: inspectCandidate(file, places, { systemRoots: [temp] }),
          categoryId: 'win-temp',
          root: temp,
          needsAdmin: true,
        },
      ],
      dirs: [],
      commands: [],
    }),
    (error) => error instanceof ElevationDenied,
  );
  assert.ok(fs.existsSync(file));
});

test('审计日志：按规则一行，只保留最近 30 天', () => {
  const { root, places } = setup();
  const file = join(root, '.jingsao-data', 'clean-log.jsonl');
  const now = Date.now();
  appendCleanLog(
    file,
    [{ time: now - 40 * DAY_MS, feature: 'junk', ruleId: 'old', files: 1, bytes: 1, skipped: 0 }],
    places,
    now - 40 * DAY_MS,
  );
  appendCleanLog(
    file,
    [{ time: now - 10 * DAY_MS, feature: 'junk', ruleId: 'mid', files: 2, bytes: 2, skipped: 1 }],
    places,
    now - 10 * DAY_MS,
  );
  appendCleanLog(file, [{ time: now, feature: 'chat', ruleId: 'new', files: 3, bytes: 3, skipped: 0 }], places, now);
  assert.deepEqual(
    readCleanLog(file).map((entry) => entry.ruleId),
    ['mid', 'new'],
  );
  assert.throws(
    () =>
      appendCleanLog(
        'F:/dev/_cache/elsewhere.jsonl',
        [{ time: now, feature: 'junk', ruleId: 'x', files: 0, bytes: 0, skipped: 0 }],
        places,
        now,
      ),
    /测试目录/,
  );
});
