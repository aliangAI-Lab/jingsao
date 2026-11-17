/**
 * 测试模式（JINGSAO_TEST_ROOT）下的软件探针：不读真实注册表，把测试根里
 * Program Files\* 与 Users\*\AppData\Local\Programs\* 下的目录当作已安装软件。
 * 只给走查和演示用：真实注册表里的软件都在真实 C 盘上，测试模式本来就一个也列不出来。
 * @module jingsao/src/host/clean/software/test-probe
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InstalledApp, SoftwareProbe } from './probe.ts';

/** 列子目录名；读不到返回空。 */
function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 造一个只看测试根的探针。 */
export function testSoftwareProbe(root: string): SoftwareProbe {
  return {
    listInstalled: async (): Promise<InstalledApp[]> => {
      const out: InstalledApp[] = [];
      for (const base of [join(root, 'Program Files'), join(root, 'Program Files (x86)')]) {
        for (const name of dirs(base)) out.push({ key: `test/${name}`, name, installDir: join(base, name) });
      }
      for (const user of dirs(join(root, 'Users'))) {
        const base = join(root, 'Users', user, 'AppData', 'Local', 'Programs');
        for (const name of dirs(base)) out.push({ key: `test/${user}/${name}`, name, installDir: join(base, name) });
      }
      return out;
    },
    runningExecutables: async () => [],
    serviceImagePaths: async () => [],
  } as SoftwareProbe;
}
