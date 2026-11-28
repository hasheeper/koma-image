import { MAX_INPUT_BYTES, MAX_TOTAL_BYTES } from "../domain/media.ts";
import { decodeImage, makeThumb } from "./image-response.ts";
import { assetRefs } from "../storage/records.ts";
import type { AssetRecord, ConversationRecord } from "../storage/records.ts";
export const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
interface Preview {
  users: number;
  blob?: Blob | null;
  url?: string;
  ready: Promise<void>;
}
export class AssetStore {
  private disposed = false;
  private previews = new Map<string, Map<number, Preview>>();
  private previewQueue = Promise.resolve();
  readonly assets = new Map<string, AssetRecord & { url: string }>();
  get(id: string) {
    const a = this.assets.get(id);
    if (!a) throw new Error("引用的图片已失效");
    return a;
  }
  async add(
    blob: Blob,
    name = "图片",
    size?: { width: number; height: number },
    origin: AssetRecord["origin"] = size ? "result" : "upload",
  ) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type))
      throw new Error("仅支持 PNG、JPEG、WebP");
    if (!blob.size || blob.size > (size ? MAX_TOTAL_BYTES : MAX_INPUT_BYTES))
      throw new Error(size ? "结果图片超过 32MB" : "单张图片需在 8MB 以内");
    const dimensions = size || (await decodeImage(blob));
    if (dimensions.width * dimensions.height > 40_000_000)
      throw new Error("图片像素过大（最多 4000 万像素）");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await blob.arrayBuffer(),
    );
    const id = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    if (!this.assets.has(id))
      this.adopt({ id, entity_key: `sha256:${id}`, blob, name, origin, ...dimensions });
    return this.get(id);
  }
  async encode(ids: string[]) {
    const assets = ids.map((id) => this.get(id));
    if (assets.some((a) => a.blob.size > MAX_INPUT_BYTES))
      throw new Error("参考图超过 8MB，请缩小后重新上传");
    if (assets.reduce((n, a) => n + a.blob.size, 0) > MAX_TOTAL_BYTES)
      throw new Error("本轮图片总大小不得超过 32MB");
    return Promise.all(assets.map((a) => dataUrl(a.blob)));
  }
  adopt(record: AssetRecord) {
    if (this.disposed) return;
    // The id is the content hash, so identity is derived from it: rows saved before entity_key existed, or restored from backups, carry none.
    if (!this.assets.has(record.id))
      this.assets.set(record.id, {
        ...record,
        entity_key: `sha256:${record.id}`,
        url: URL.createObjectURL(record.blob),
      });
  }
  record(id: string) {
    const { url, ...record } = this.get(id);
    return record;
  }
  /** Display-only copies: never stored, encoded for a request, or returned as originals. */
  preview(id: string, maxEdge: 256 | 1280 = 256) {
    const asset = this.get(id);
    let sizes = this.previews.get(id);
    if (!sizes) { sizes = new Map(); this.previews.set(id, sizes); }
    let entry = sizes.get(maxEdge);
    if (!entry) {
      entry = { users: 0, ready: Promise.resolve() };
      sizes.set(maxEdge, entry);
    }
    const preview = entry;
    const current = () => this.assets.get(id) === asset && this.previews.get(id)?.get(maxEdge) === preview;
    preview.users++;
    if (preview.blob === undefined && preview.users === 1) {
      // Only visible consumers request work. Serialize large decodes and skip stale queued work.
      preview.ready = this.previewQueue.then(async () => {
        if (!current() || !preview.users || preview.blob !== undefined) return;
        const blob = await makeThumb(asset.blob, maxEdge);
        if (current()) preview.blob = blob;
      });
      this.previewQueue = preview.ready.catch(() => {});
    }
    let released = false;
    return {
      url: preview.ready.then(() => {
        if (released || !current()) return undefined;
        return preview.url ??= preview.blob ? URL.createObjectURL(preview.blob) : asset.url;
      }),
      release: () => {
        if (released) return;
        released = true;
        if (--preview.users === 0) {
          if (preview.url && preview.blob) URL.revokeObjectURL(preview.url);
          preview.url = undefined;
        }
      },
    };
  }
  private dropPreviews(id: string) {
    for (const preview of this.previews.get(id)?.values() ?? [])
      if (preview.url && preview.blob) { URL.revokeObjectURL(preview.url); preview.url = undefined; }
    this.previews.delete(id);
  }
  collect(conversations: ConversationRecord[]) {
    const used = assetRefs(conversations);
    for (const [id, a] of this.assets)
      if (!used.has(id)) {
        this.dropPreviews(id);
        URL.revokeObjectURL(a.url);
        this.assets.delete(id);
      }
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
  clear() {
    for (const a of this.assets.values()) { this.dropPreviews(a.id); URL.revokeObjectURL(a.url); }
    this.assets.clear();
  }
}
