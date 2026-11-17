import { existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { IMAGE_HEAD_BYTES, MIME, imageExtOf, imageTypeOf, resolveAsset } from './http.ts';

/** 探测顺序：正常情况下同一素材根只有一个头像文件，顺序只影响同时存在多份时的遍历次序。 */
const AVATAR_EXTS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** 一只宠物的自定义头像：文件绝对路径与它的 Content-Type。 */
export interface PetAvatarFile {
  readonly file: string;
  readonly contentType: string;
}

/**
 * 找一只宠物的自定义头像。
 *
 * 多份并存时取修改时间最新的一份：换过格式但旧文件没删掉时，用户刚传的那张才是要显示的。
 *
 * @param avatarDir - `pet/` 目录（`ConfigPaths` 里的文件宠物目录）。
 * @param petId - 素材根；调用方须先用 isValidPetId 挡住非法字符。
 * @returns 头像文件；没上传过时 undefined，调用方回退包内默认 logo。
 */
export function petAvatarFile(avatarDir: string, petId: string): PetAvatarFile | undefined {
  let best: PetAvatarFile | undefined;
  let bestMtime = -Infinity;
  for (const ext of AVATAR_EXTS) {
    const file = resolveAsset(avatarDir, petId + '-avatar' + ext);
    if (file === undefined || !existsSync(file)) continue;
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue; // 探测的瞬间被删/无权读：当作没有这份，继续看下一个扩展名
    }
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = { file, contentType: MIME[ext] ?? 'application/octet-stream' };
    }
  }
  return best;
}

/** 保存结论：成功，或按原因分档——文案与状态码由路由层翻成 HTTP 结论。 */
export type PetAvatarSave = { ok: true } | { ok: false; reason: 'not-image' | 'write-failed' };

/**
 * 覆盖写入一只宠物的头像。
 *
 * @param avatarDir - `pet/` 目录。
 * @param petId - 素材根；调用方须先用 isValidPetId 挡住非法字符。
 * @param bytes - 已通过体积校验的图片字节。
 * @returns 保存结论；文件头不像支持的图片或写盘失败时给出原因。
 */
export function savePetAvatar(avatarDir: string, petId: string, bytes: Buffer): PetAvatarSave {
  const contentType = imageTypeOf(bytes, Math.min(bytes.length, IMAGE_HEAD_BYTES));
  const ext = contentType === undefined ? undefined : imageExtOf(contentType);
  if (ext === undefined) return { ok: false, reason: 'not-image' };
  const file = resolveAsset(avatarDir, petId + '-avatar' + ext);
  if (file === undefined) return { ok: false, reason: 'write-failed' };
  // 换格式（png → jpg）时旧文件尽量删掉：petAvatarFile 已按 mtime 兜底，这里只是不让旧图占着磁盘。
  for (const other of AVATAR_EXTS) {
    if (other === ext) continue;
    const stale = resolveAsset(avatarDir, petId + '-avatar' + other);
    if (stale === undefined) continue;
    try {
      unlinkSync(stale);
    } catch {
      // 不存在或被别的进程占着：都不该让这次保存失败
    }
  }
  try {
    writeFileSync(file, bytes);
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true };
}
