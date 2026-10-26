import { INBOX_LIMIT } from "./protocol.ts";
export type Directory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
};
export const directoryPicker = () => (window as Window & { showDirectoryPicker?: (options: { mode: "readwrite"; id: string }) => Promise<Directory> }).showDirectoryPicker;
export function safePath(path: string) {
  const parts = path.split("/");
  if (!path || parts.some(p => !p || p === "." || p === ".." || /[\\:\x00-\x1f]/.test(p))) throw new Error("协同路径无效");
  return parts;
}
export function fileDriver(root: FileSystemDirectoryHandle) {
  async function parent(path: string, create = false) {
    const parts = safePath(path), name = parts.pop()!;
    let directory = root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
    return { directory, name };
  }
  return {
    async read(path: string, limit = INBOX_LIMIT) {
      const { directory, name } = await parent(path);
      try {
        const file = await (await directory.getFileHandle(name)).getFile();
        if (file.size > limit) throw new Error(`文件超过 ${Math.round(limit / 1024)} KB`);
        return { text: await file.text(), version: `${file.lastModified}:${file.size}` };
      } catch (e) { if (e instanceof DOMException && e.name === "NotFoundError") return null; throw e; }
    },
    async write(path: string, value: string | Blob, signal: AbortSignal) {
      signal.throwIfAborted();
      const { directory, name } = await parent(path, true);
      signal.throwIfAborted();
      const stream = await (await directory.getFileHandle(name, { create: true })).createWritable();
      try { signal.throwIfAborted(); await stream.write(value); signal.throwIfAborted(); await stream.close(); }
      catch (error) { await stream.abort().catch(() => {}); throw error; }
    },
    async remove(path: string, signal: AbortSignal) {
      signal.throwIfAborted();
      try {
        const { directory, name } = await parent(path);
        signal.throwIfAborted();
        await directory.removeEntry(name);
      } catch (e) { if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e; }
    },
  };
}
/** A partially replaced JSON file gets exactly one quiet, short re-read. */
export async function readInbox(driver: Pick<ReturnType<typeof fileDriver>, "read">, signal: AbortSignal) {
  const first = await driver.read("draft.inbox.json");
  if (!first) return null;
  try { return { ...first, value: JSON.parse(first.text) as unknown }; }
  catch {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 120);
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    });
    const second = await driver.read("draft.inbox.json");
    signal.throwIfAborted();
    return second ? { ...second, value: JSON.parse(second.text) as unknown } : null;
  }
}
