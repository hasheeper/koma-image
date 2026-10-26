import { safePath } from "./fs-driver.ts";
import type { RefEntry, RefIndex, RefSnapshot } from "../ask/reference-source.ts";

export const REF_LIMITS = Object.freeze({ listed: 48, files: 512, entries: 4096, depth: 8, path: 1024 });
const text = /\.(?:txt|md|markdown|json|csv|tsv|ya?ml|log)$/i;
const image = /\.(?:png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i;
const secret = /^(?:credentials|secrets)\.(?:json|ya?ml|txt)$|^id_(?:rsa|ed25519)(?:\.pub)?$/i;
export function refPath(path: string) {
  const parts = safePath(path);
  if (path.length > REF_LIMITS.path || parts.some(p => p.startsWith(".") || secret.test(p))) throw new Error("资料路径不可读取");
  return parts;
}
export function refKind(path: string): "text" | "image" {
  refPath(path);
  if (text.test(path)) return "text";
  if (image.test(path)) return "image";
  throw new Error("不支持此资料类型");
}
const absent = (e: unknown) => e instanceof DOMException && e.name === "NotFoundError";
type EnumerableDirectory = FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle> };
export interface RefCatalog { readonly files: readonly RefEntry[]; readonly limited: boolean }
export function refIndex(catalog: RefCatalog): RefIndex {
  return { available: true, files: catalog.files.slice(0, REF_LIMITS.listed), total: catalog.files.length,
    omitted: Math.max(0, catalog.files.length - REF_LIMITS.listed), limited: catalog.limited };
}
/** Metadata only: never opens file bodies while discovering the directory. */
export async function scanRefs(root: FileSystemDirectoryHandle, signal: AbortSignal): Promise<RefCatalog> {
  signal.throwIfAborted();
  const files: RefEntry[] = []; let visited = 0, limited = false;
  async function scan(directory: FileSystemDirectoryHandle, prefix: string, depth: number) {
    for await (const handle of (directory as EnumerableDirectory).values()) {
      signal.throwIfAborted();
      if (++visited > REF_LIMITS.entries || files.length >= REF_LIMITS.files) { limited = true; return; }
      const path = prefix + handle.name;
      try { refPath(path); } catch { continue; }
      if (handle.kind === "directory") {
        if (depth >= REF_LIMITS.depth) { limited = true; continue; }
        try { await scan(handle as FileSystemDirectoryHandle, path + "/", depth + 1); }
        catch (e) { if (!absent(e)) throw e; limited = true; }
        if (visited > REF_LIMITS.entries || files.length >= REF_LIMITS.files) { limited = true; return; }
      } else {
        try { refKind(path); } catch { continue; }
        try { files.push({ path, bytes: (await (handle as FileSystemFileHandle).getFile()).size }); }
        catch (e) { if (!absent(e)) throw e; }
      }
    }
  }
  try { await scan(await root.getDirectoryHandle("refs"), "", 0); }
  catch (e) { if (!absent(e)) throw e; }
  signal.throwIfAborted();
  return { files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), limited };
}
/** Captures one mount and its catalog; unmount aborts pending reads, never redirects them. */
export function referenceSnapshot(root: FileSystemDirectoryHandle, catalog: RefCatalog, lifetime: AbortSignal): RefSnapshot {
  const paths = new Set(catalog.files.map(f => f.path));
  function resolve(path: string) {
    refKind(path);
    if (paths.has(path)) return path;
    const matches = [...paths].filter(p => p.split("/").at(-1) === path);
    if (matches.length > 1) throw new Error(`资料同名，请使用完整相对路径：${matches.join("、")}`);
    if (matches.length === 1) return matches[0];
    throw new Error("资料不在本轮清单中，请刷新清单后重新提问");
  }
  return { index: refIndex(catalog), resolve, kind: refKind,
    async read(request, signal, maxBytes) {
      const path = resolve(request), abort = AbortSignal.any([signal, lifetime]); abort.throwIfAborted();
      const parts = refPath(path), name = parts.pop()!;
      try {
        let directory = await root.getDirectoryHandle("refs");
        for (const part of parts) directory = await directory.getDirectoryHandle(part);
        const file = await (await directory.getFileHandle(name)).getFile();
        abort.throwIfAborted();
        if (file.size > maxBytes) throw new Error("资料超过附件大小或本页容量限制");
        const bytes = await file.arrayBuffer(); abort.throwIfAborted();
        const hash = await crypto.subtle.digest("SHA-256", bytes); abort.throwIfAborted();
        return { file: new File([bytes], `refs/${path}`, { type: file.type, lastModified: file.lastModified }),
          origin: { path, modified: file.lastModified, version: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("") } };
      } catch (e) { if (absent(e)) throw new Error(`资料已移除：${path}`); throw e; }
    },
  };
}
