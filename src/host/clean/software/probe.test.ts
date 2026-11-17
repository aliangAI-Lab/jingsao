/**
 * 软件探针解析的单元测试 —— 钉住注册表与服务命令行的解析：
 *   ① 命令行取 exe：带引号、不带引号含空格、带参数、\??\ 前缀、图标序号；
 *   ② 推安装目录：InstallLocation 优先（去引号、版本号目录上移），其次 DisplayIcon 的 exe，
 *      再次卸载程序；msiexec、Steam 的 .ico、安装缓存目录不可信，宁可推不出；
 *   ③ 真实探针的 JSON 解析（注入假的 powershell 输出，不调系统）。
 * 样例按真实机器上 reg query 看到的形状造，路径已换成通用名。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { appFromRaw, exePathFromCommand, installDirFromRegistry, parseJsonList, realSoftwareProbe } from './probe.ts';

describe('exePathFromCommand', () => {
  test('各种命令行形状', () => {
    assert.equal(exePathFromCommand('"C:\\Program Files\\Foo\\svc.exe" -autorun'), 'C:\\Program Files\\Foo\\svc.exe');
    assert.equal(
      exePathFromCommand('C:\\Program Files\\Foo Bar\\svc.exe -k netsvcs'),
      'C:\\Program Files\\Foo Bar\\svc.exe',
    );
    assert.equal(
      exePathFromCommand('\\??\\C:\\Windows\\system32\\drivers\\x.sys'),
      'C:\\Windows\\system32\\drivers\\x.sys',
    );
    assert.equal(exePathFromCommand('MsiExec.exe /X{010792BA}'), null);
    assert.equal(exePathFromCommand(''), null);
    assert.equal(exePathFromCommand(null), null);
  });
});

describe('installDirFromRegistry', () => {
  test('InstallLocation 优先：去引号、去末尾分隔符、版本号目录上移', () => {
    assert.equal(
      installDirFromRegistry({ installLocation: 'C:\\Program Files\\WinRAR\\' }),
      'C:\\Program Files\\WinRAR',
    );
    assert.equal(
      installDirFromRegistry({ installLocation: '"D:\\Meeting\\WeMeet\\3.41.10.435"' }),
      'D:\\Meeting\\WeMeet',
    );
  });

  test('没有 InstallLocation 时用 DisplayIcon 的 exe（去掉 ,0）', () => {
    assert.equal(
      installDirFromRegistry({ displayIcon: 'C:\\Users\\u\\AppData\\Local\\Programs\\Notion\\Notion.exe,0' }),
      'C:\\Users\\u\\AppData\\Local\\Programs\\Notion',
    );
    assert.equal(
      installDirFromRegistry({ displayIcon: 'C:\\Program Files\\Ant\\PayGuard\\0.4.0.6001\\PayGuard.exe' }),
      'C:\\Program Files\\Ant\\PayGuard',
    );
  });

  test('图标是 .ico 时退到卸载程序；卸载程序在子目录时上移', () => {
    assert.equal(
      installDirFromRegistry({ displayIcon: '"D:\\Feishu\\icon.ico"', uninstall: '"D:\\Feishu\\uninstall.exe"' }),
      'D:\\Feishu',
    );
    assert.equal(
      installDirFromRegistry({
        displayIcon: 'D:\\Office\\uninst\\icon.ico',
        uninstall: 'D:\\Office\\uninst\\uninst.exe',
      }),
      'D:\\Office',
    );
  });

  test('不可信的来源推不出', () => {
    assert.equal(installDirFromRegistry({ uninstall: 'MsiExec.exe /X{1D8E6291}' }), undefined);
    assert.equal(
      installDirFromRegistry({
        displayIcon: 'C:\\Program Files (x86)\\Steam\\steam\\games\\abc.ico',
        uninstall: '"C:\\Program Files (x86)\\Steam\\steam.exe" steam://uninstall/261570',
      }),
      undefined,
    );
    assert.equal(
      installDirFromRegistry({
        displayIcon: 'C:\\ProgramData\\Package Cache\\{11A8}\\Setup.exe,0',
        uninstall: '"C:\\ProgramData\\Package Cache\\{11A8}\\Setup.exe" /uninstall',
      }),
      undefined,
    );
    assert.equal(
      installDirFromRegistry({ displayIcon: 'C:\\Users\\u\\AppData\\Local\\Package Cache\\{b6ce}\\python-3.12.exe,0' }),
      undefined,
    );
  });
});

describe('appFromRaw / parseJsonList', () => {
  test('系统组件、发布者、没名字的跳过', () => {
    assert.deepEqual(
      appFromRaw({
        key: 'K',
        name: ' Foo ',
        publisher: 'Bar',
        installLocation: 'C:\\Foo',
        systemComponent: 1,
        uninstall: 'C:\\Foo\\unins000.exe',
      }),
      {
        key: 'K',
        name: 'Foo',
        publisher: 'Bar',
        installDir: 'C:\\Foo',
        systemComponent: true,
        uninstall: 'C:\\Foo\\unins000.exe',
      },
    );
    assert.equal(appFromRaw({ key: 'K', name: null }), null);
  });

  test('ConvertTo-Json 的各种输出', () => {
    assert.deepEqual(parseJsonList(''), []);
    assert.deepEqual(parseJsonList('\uFEFF"C:\\\\a.exe"'), ['C:\\a.exe']);
    assert.deepEqual(parseJsonList('[1,2]'), [1, 2]);
    assert.deepEqual(parseJsonList('null'), []);
  });
});

describe('realSoftwareProbe（注入假的 powershell）', () => {
  test('三个查询都按 JSON 解析', async () => {
    const probe = realSoftwareProbe(async (script) => {
      if (script.includes('Uninstall')) {
        return JSON.stringify([
          {
            key: 'HKEY_LOCAL_MACHINE\\X',
            name: 'WinRAR',
            publisher: 'win.rar',
            installLocation: 'C:\\Program Files\\WinRAR\\',
          },
          { key: 'HKEY_LOCAL_MACHINE\\Y', name: null },
        ]);
      }
      if (script.includes('Win32_Process'))
        return JSON.stringify(['C:\\Program Files\\WinRAR\\WinRAR.exe', 'relative.exe']);
      return JSON.stringify(['"C:\\Program Files\\Foo\\svc.exe" -k', 'C:\\WINDOWS\\system32\\svchost.exe -k netsvcs']);
    });
    assert.deepEqual(await probe.listInstalled(), [
      { key: 'HKEY_LOCAL_MACHINE\\X', name: 'WinRAR', publisher: 'win.rar', installDir: 'C:\\Program Files\\WinRAR' },
    ]);
    assert.deepEqual(await probe.runningExecutables(), ['C:\\Program Files\\WinRAR\\WinRAR.exe']);
    assert.deepEqual(await probe.serviceImagePaths(), [
      'C:\\Program Files\\Foo\\svc.exe',
      'C:\\WINDOWS\\system32\\svchost.exe',
    ]);
  });
});
