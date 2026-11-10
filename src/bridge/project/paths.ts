import { safePath } from '../fs-driver.ts';

export const REF_LIMITS = Object.freeze({ listed: 128, files: 2048, entries: 16384, depth: 8, path: 1024, metadataBytes: 256 * 1024 });
const text = /\.(?:txt|md|markdown|json|csv|tsv|ya?ml|log)$/i;
const image = /\.(?:png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i;
const secret = /^(?:credentials|secrets)\.(?:json|ya?ml|txt)$|^id_(?:rsa|ed25519)(?:\.pub)?$/i;
export function refPath(path: string) {
  const parts = safePath(path);
  if (path.length > REF_LIMITS.path || parts.some(p => p.startsWith('.') || secret.test(p))) throw new Error('资料路径不可读取');
  return parts;
}
export function refKind(path: string): 'text' | 'image' {
  refPath(path);
  if (text.test(path)) return 'text';
  if (image.test(path)) return 'image';
  throw new Error('不支持此资料类型');
}
export const missing = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError';
export const permissionError = (e: unknown) => e instanceof DOMException && ['NotAllowedError', 'SecurityError', 'AbortError'].includes(e.name);
export async function projectFile(root: FileSystemDirectoryHandle, path: string) {
  const parts = refPath(path), name = parts.pop()!;
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(name)).getFile();
}
