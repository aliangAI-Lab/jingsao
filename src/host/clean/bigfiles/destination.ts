/**
 * 搬家目标位置的检查（大文件搬家与软件搬家共用）。
 *
 * 只判断「能不能往这里搬」，不建目录、不写盘。规则：完整路径；不能在系统盘（搬了等于没搬）；
 * 不能在系统目录、Program Files、上个版本的暂存区或受保护目录里；路径上不能有链接或联接（防止绕回 C 盘）；
 * 空间要够（给了本次总大小时按它算，另留一点余量）。
 * 测试模式下目标必须在测试根里、但不能在测试用户目录里（用「不在 home 之内」代替「不同盘」）。
 * @module jingsao/src/host/clean/bigfiles/destination
 */
import { lstatSync } from 'node:fs';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { denied, diskSpace, noLinks, within, type CleanPlaces } from '../safety.ts';

/** 搬家文件夹名：所有搬过去的东西都放在目标下的这个目录里。 */
export const MOVE_DIR_NAME = '鲸扫搬家';

/** 目标盘至少要多留的空间（字节）。 */
export const DEST_RESERVE_BYTES = 64 * 1024 * 1024;

/** 从 path 往上找第一个存在的路径；都不存在返回 null。 */
export function existingAncestor(path: string): string | null {
  let current = resolve(path);
  for (;;) {
    try {
      lstatSync(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/**
 * 目标位置为什么不能用；返回 null = 可以用。
 *
 * @param destRoot - 用户选的目标文件夹（可以还不存在，但所在盘必须存在）。
 * @param places - 位置表。
 * @param needBytes - 本次要搬的总字节数；给了就检查可用空间。
 * @returns 不能用的原因（给普通人看），或 null。
 */
export function checkDestination(destRoot: string, places: CleanPlaces, needBytes = 0): string | null {
  if (!destRoot || !isAbsolute(destRoot) || /^[\\/][^\\/]/.test(destRoot))
    return '请选择一个完整的文件夹路径（例如 D:\\搬家）';
  // 网络路径（\\server\share）不行：目录联接只能指向本机磁盘。
  if (/^[\\/]{2}/.test(destRoot)) return '请选择本机的磁盘，不能用网络位置';
  const dest = resolve(destRoot);
  if (places.test) {
    if (!within(places.test, dest)) return '超出测试目录';
    if (within(places.home, dest)) return '目标不能在用户文件夹里，请换一个位置';
  } else if (parse(dest).root.toLowerCase() === parse(places.drive).root.toLowerCase()) {
    return '目标不能在 C 盘，请选择别的盘';
  }
  const reason = denied(dest, places, { allowUserData: true, allowOtherDrives: true });
  if (reason) return `目标位置不能用：${reason}`;
  const existing = existingAncestor(dest);
  if (!existing) return '目标所在的盘不存在';
  try {
    if (!lstatSync(existing).isDirectory()) return '目标路径上有一个同名文件，请换一个位置';
    noLinks(dest, { allowMissing: true });
  } catch {
    return '目标路径里有链接或联接，请换一个普通文件夹';
  }
  const { free } = diskSpace(existing);
  if (free !== null && free < needBytes + DEST_RESERVE_BYTES) return '目标盘空间不够';
  return null;
}
