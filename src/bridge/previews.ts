import type { Picture } from "../ask/library.ts";
import type { fileDriver } from "./fs-driver.ts";
/** Cache belongs to one mounted directory; no work when it is not mounted. */
export function previewCache() {
  const cached = new Map<string, { source: Blob; path: string }>();
  let owned = new Set<string>();
  return {
    adopt(paths: readonly string[]) { for (const path of paths) if (/^live\/[a-f0-9-]{36}\.webp$/.test(path)) owned.add(path); },
    async prepare(pictures: readonly Picture[], driver: ReturnType<typeof fileDriver>, signal: AbortSignal, saveOwned: (paths: readonly string[]) => Promise<void>) {
      const paths = new Map<string, string>();
      for (const picture of pictures) {
        signal.throwIfAborted();
        let item = cached.get(picture.id);
        if (!item || item.source !== picture.blob) {
          const bitmap = await createImageBitmap(picture.blob);
          let blob: Blob;
          try {
            signal.throwIfAborted();
            const ratio = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
            const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
            const context = canvas.getContext("2d");
            if (!context) throw new Error("无法生成协同预览");
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            blob = await canvas.convertToBlob({ type: "image/webp", quality: .8 });
            if (blob.type !== "image/webp") throw new Error("浏览器不支持 WebP 预览");
          } finally { bitmap.close(); }
          const path = `live/${crypto.randomUUID()}.webp`;
          signal.throwIfAborted();
          // Persist ownership before creating files; never trust paths in external JSON for deletion.
          owned.add(path); await saveOwned([...owned]);
          await driver.write(path, blob, signal);
          item = { source: picture.blob, path }; cached.set(picture.id, item);
        }
        paths.set(picture.id, item.path);
      }
      return paths;
    },
    async commit(paths: ReadonlyMap<string, string>, driver: ReturnType<typeof fileDriver>, signal: AbortSignal, saveOwned: (paths: readonly string[]) => Promise<void>) {
      const retained = new Set(paths.values());
      for (const path of owned) if (!retained.has(path)) await driver.remove(path, signal);
      owned = retained;
      await saveOwned([...owned]);
      for (const [id, item] of cached) if (!retained.has(item.path)) cached.delete(id);
    },
    clear() { cached.clear(); owned.clear(); },
  };
}
