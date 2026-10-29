import type { PngVibes, ReferenceAsset, VibeEncoding, NaiReference, ReferenceKind, ReferencePlan, PreparedReferences } from "../domain/nai-references.ts";
import { encodingKey, encodingGroup, referenceModel, referenceStrengths, referencePlan, referenceSurcharge } from "../domain/nai-references.ts";
import { blobBase64, base64Blob, sha256, referenceBitmap, preciseImage, imageBase64 } from "../native/reference-images.ts";
import { object } from "../domain/value.ts";
import { makeThumb } from "./image-response.ts";
import { names } from "../storage/names.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import type { openDatabases } from "../storage/databases.ts";
import type { DataLease } from "./data-lease.ts";

type Databases = ReturnType<typeof openDatabases> extends Promise<infer T> ? T : never;
export function createNaiReferences(databases: () => Databases, data: DataLease) {
  const assets = new Map<string, ReferenceAsset>(), encodings = new Map<string, VibeEncoding>(), urls = new Map<string, string>(), listeners = new Set<() => void>();
  const thumbnailOwners = new Map<string, Set<object>>();
  let loaded = false, loading: Promise<void> | undefined, disposed = false;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(names.sync) : undefined;
  const emit = () => { if (!disposed) listeners.forEach(fn => fn()); };
  const clearUrls = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  async function reload() {
    const tx = databases().transaction(names.databases.favorites, ["referenceAssets", "vibeEncodings"]);
    const done = transactionDone(tx);
    const [a, e] = await Promise.all([idbRequest(tx.objectStore("referenceAssets").getAll()) as Promise<ReferenceAsset[]>, idbRequest(tx.objectStore("vibeEncodings").getAll()) as Promise<VibeEncoding[]>]);
    await done;
    if (disposed) return;
    clearUrls(); assets.clear(); encodings.clear(); a.forEach(r => assets.set(r.id,r)); e.forEach(r => encodings.set(r.id,r)); loaded = true; emit();
  }
  async function ready() { if (!loaded) await (loading ??= reload().finally(() => { loading = undefined; })); }
  async function persist(a: ReferenceAsset[], e: VibeEncoding[]) {
    await data.write(async () => {
      const tx = databases().transaction(names.databases.favorites, ["referenceAssets", "vibeEncodings"], "readwrite"); const done = transactionDone(tx);
      for (const row of a) tx.objectStore("referenceAssets").put(row);
      for (const row of e) tx.objectStore("vibeEncodings").put(row);
      await done;
    });
    a.forEach(r => assets.set(r.id,r)); e.forEach(r => encodings.set(r.id,r)); emit(); channel?.postMessage({ type: "references-changed" });
  }
  async function asset(blob: Blob): Promise<ReferenceAsset> {
    const image = await referenceBitmap(blob);
    try { return { id: await sha256(blob), blob, thumbnail: await makeThumb(blob), width:image.width, height:image.height }; }
    finally { image.close(); }
  }
  const row = (assetId: string, kind: ReferenceKind, model: string): NaiReference => ({ id: crypto.randomUUID(), assetId, on:true, strength:kind === "vibe" ? .6 : 1, information:kind === "vibe" && model.replace(/@local$/, "") === "nai-diffusion-4-5-full" ? .7 : 1, fidelity:1, type:"character&style" });
  const unregister = data.register({ async flush() {}, reload });
  const changed = (event: MessageEvent) => { if (event.data?.type === "references-changed" && data.phase === "ready") void reload().catch(() => {}); };
  channel?.addEventListener("message", changed);
  return {
    ready,
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
    thumbnail(id: string, owner?: object) {
      if (owner) { const owners = thumbnailOwners.get(id) ?? new Set<object>(); owners.add(owner); thumbnailOwners.set(id, owners); }
      const item = assets.get(id); if (!item?.thumbnail) return "";
      let url = urls.get(id); if (!url) { url = URL.createObjectURL(item.thumbnail); urls.set(id,url); } return url;
    },
    releaseThumbnails(ids: Iterable<string>, owner?: object) { for (const id of ids) {
      const owners = thumbnailOwners.get(id); if (owner) owners?.delete(owner);
      if (owners?.size) continue;
      thumbnailOwners.delete(id);
      const url = urls.get(id); if (url) { URL.revokeObjectURL(url); urls.delete(id); }
    } },
    original: (id: string) => !!assets.get(id)?.blob,
    pending: (r: NaiReference, model: string) => !encodings.has(encodingKey(model,r.assetId,r.information)),
    /** Synchronous cache read for ASK. Never loads storage or starts encoding. */
    cachedCost(config: import("../domain/nai-references.ts").NaiReferences, model: string): number | undefined {
      let plan: ReferencePlan | undefined;
      try { plan = referencePlan(config); } catch { return; }
      if (!plan) return 0;
      if (!loaded) return;
      const missing = new Set<string>();
      for (const r of plan.items) {
        const a = assets.get(r.assetId), key = encodingKey(model, r.assetId, r.information);
        if (!a || (plan.kind === "precise" && !a.blob)) return;
        if (plan.kind === "vibe" && !encodings.has(key)) {
          if (!a.blob) return;
          missing.add(key);
        }
      }
      return referenceSurcharge(plan) + missing.size * 2;
    },
    async pendingCost(plan: ReferencePlan, model: string) {
      await ready(); if(plan.kind!=="vibe")return 0;
      const tx=databases().transaction(names.databases.favorites,"vibeEncodings");
      const cached=new Set(await idbRequest(tx.objectStore("vibeEncodings").getAllKeys()));
      return new Set(plan.items.map(r=>encodingKey(model,r.assetId,r.information)).filter(key=>!cached.has(key))).size*2;
    },
    async upload(files: File[], kind: ReferenceKind, model: string) {
      await ready();
      if (files.length > 16 || files.reduce((sum,f)=>sum+f.size,0) > 64*1024*1024) throw new Error("每组最多 16 张，单次上传最多 64MB");
      const imported: ReferenceAsset[] = [];
      for (const file of files) imported.push(await asset(file));
      await persist(imported, []); return imported.map(a => row(a.id,kind,model));
    },
    /** Called only inside runTask. Each completed paid encoding commits before the next request. */
    async prepare(plan: ReferencePlan, model: string, signal: AbortSignal, encode: (image: string, information: number) => Promise<string>): Promise<PreparedReferences> {
      await ready();
      if (!referenceModel(model)) throw new Error("当前模型不支持参考，配置已保留");
      const images: string[] = [];
      for (const r of plan.items) {
        signal.throwIfAborted();
        let a = assets.get(r.assetId);
        if (!a) { const tx=databases().transaction(names.databases.favorites,"referenceAssets");a=await idbRequest(tx.objectStore("referenceAssets").get(r.assetId)) as ReferenceAsset | undefined; }
        if (!a) throw new Error("参考原图缺失，请重新添加");
        if (plan.kind === "precise") {
          if (!a.blob) throw new Error("Precise Reference 需要原图");
          images.push(await preciseImage(a.blob));
        } else {
          const id = encodingKey(model,r.assetId,r.information);
          // Another tab may have populated this paid cache while this task waited for the global slot.
          const tx = databases().transaction(names.databases.favorites, "vibeEncodings");
          const cached = await idbRequest(tx.objectStore("vibeEncodings").get(id)) as VibeEncoding | undefined;
          let encoded = cached?.data ?? encodings.get(id)?.data;
          if (!encoded) {
            if (!a.blob) throw new Error("此 Vibe 文件没有当前模型与信息提取量的编码，需重新添加原图");
            encoded = await encode(await blobBase64(a.blob), r.information);
            await persist([], [{ id, assetId:r.assetId, model:model.replace(/@local$/, ""), information:r.information, data:encoded }]);
          }
          images.push(encoded);
        }
      }
      signal.throwIfAborted();
      return { kind:plan.kind, images, strengths:referenceStrengths(plan), information:plan.items.map(r=>r.information), fidelities:plan.items.map(r=>r.fidelity), types:plan.items.map(r=>r.type) };
    },
    async export(items: NaiReference[], kind: ReferenceKind, model: string) {
      await ready();
      const vibes = [];
      for (const r of items) {
        const a = assets.get(r.assetId); if (!a) throw new Error("参考图片缺失，无法导出");
        if (kind === "precise") {
          if (!a.blob) throw new Error("参考原图缺失");
          vibes.push({ image:await blobBase64(a.blob), mime:a.blob.type, settings:r }); continue;
        }
        const entries: Record<string, Record<string, unknown>> = {};
        for (const e of encodings.values()) if (e.assetId === a.id) {
          const group = encodingGroup(e.model); entries[group] ??= {};
          entries[group][await sha256(`information_extracted:${e.information}`)] = { encoding:e.data, params:{information_extracted:e.information} };
        }
        const image = a.blob ? await blobBase64(a.blob) : undefined;
        const first = [...encodings.values()].find(e=>e.assetId===a.id);
        if (!image && !first) throw new Error("Vibe 编码缺失");
        vibes.push({ identifier:"novelai-vibe-transfer", version:1, type:image ? "image" : "encoding", image, id:await sha256(image ?? first!.data), encodings:entries, thumbnail:a.thumbnail ? `data:${a.thumbnail.type};base64,${await blobBase64(a.thumbnail)}` : undefined, importInfo:{model, information_extracted:r.information, strength:r.strength} });
      }
      return new Blob([JSON.stringify(kind === "vibe" ? { identifier:"novelai-vibe-transfer-bundle", version:1, vibes } : { identifier:"koma-precise-references", version:1, images:vibes })], {type:"application/json"});
    },
    /** PNG metadata contains model-bound encodings, never the original reference pixels. */
    async importPng(vibes: PngVibes) {
      await ready();
      if (!referenceModel(vibes.model) || !vibes.items.length || vibes.items.length > 16) throw new Error("PNG 参考编码格式无效");
      const imported: ReferenceAsset[] = [], encoded: VibeEncoding[] = [], rows: NaiReference[] = [];
      let bytes = 0;
      for (const entry of vibes.items) {
        bytes += base64Blob(entry.encoding).size;
        if (bytes > 24 * 1024 * 1024) throw new Error("PNG 参考编码总量过大");
        if (![entry.information, entry.strength].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error("PNG 参考参数无效");
        const id = await sha256(entry.encoding), r = row(id, "vibe", vibes.model);
        r.information = entry.information; r.strength = entry.strength;
        imported.push(assets.get(id) ?? { id, blob: null, thumbnail: null, width: 1, height: 1 });
        encoded.push({ id: encodingKey(vibes.model, id, r.information), assetId: id, model: vibes.model, information: r.information, data: entry.encoding });
        rows.push(r);
      }
      await persist(imported, encoded); return rows;
    },
    async import(file: File, kind: ReferenceKind, model: string) {
      await ready(); if (file.size > 64*1024*1024) throw new Error("参考文件最多 64MB");
      const source = object(JSON.parse(await file.text()));
      if (source.version !== 1) throw new Error("不支持此参考文件版本");
      const raw = kind === "precise" && source.identifier === "koma-precise-references" ? source.images : kind === "vibe" && source.identifier === "novelai-vibe-transfer-bundle" ? source.vibes : kind === "vibe" && source.identifier === "novelai-vibe-transfer" ? [source] : null;
      if (!Array.isArray(raw) || !raw.length || raw.length > 16) throw new Error("参考文件格式无效，最多 16 张");
      const imported:ReferenceAsset[] = [], encoded:VibeEncoding[] = [], rows:NaiReference[] = [];
      for (const entry of raw) {
        const v = object(entry), info = object(kind === "vibe" ? v.importInfo : v.settings);
        if (info.mask) throw new Error("暂不支持带 Mask 的 Vibe 文件");
        let a:ReferenceAsset;
        if (typeof v.image === "string") {
          const blob = await imageBase64(v.image);
          // Content decoding validates official files even when the original MIME is not present.
          const bitmap = await referenceBitmap(blob); bitmap.close();
          if (kind === "vibe" && v.id !== await sha256(v.image)) throw new Error("Vibe 图片校验失败");
          a = await asset(blob);
        } else {
          if (kind !== "vibe" || v.type !== "encoding" || typeof v.id !== "string" || !/^[a-f0-9]{64}$/.test(v.id)) throw new Error("参考原图缺失");
          a = { id:v.id, blob:null, thumbnail:null, width:1, height:1 };
        }
        if (!a.blob && typeof v.thumbnail === "string") {
          const match=/^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(v.thumbnail);
          if (!match) throw new Error("Vibe 缩略图无效");
          const thumb=await imageBase64(match[1],1024*1024), bitmap=await referenceBitmap(thumb);bitmap.close();
          a.thumbnail=await makeThumb(thumb);
        }
        const r = row(a.id,kind,model);
        const strength = Number(info.strength), information = Number(info.information_extracted ?? info.information);
        if (Number.isFinite(strength) && strength >= 0 && strength <= 1) r.strength = strength;
        if (Number.isFinite(information) && information >= 0 && information <= 1) r.information = information;
        if (kind === "precise") { if (info.type === "character" || info.type === "style") r.type = info.type; if (typeof info.fidelity === "number" && info.fidelity >= 0 && info.fidelity <= 1) r.fidelity = info.fidelity; }
        let count = 0; let encodingHashMatches = !!a.blob;
        for (const [group, values] of Object.entries(object(v.encodings))) {
          const m = group === "v4-5full" ? "nai-diffusion-4-5-full" : group === "v4-5curated" ? "nai-diffusion-4-5-curated" : null;
          if (!m) continue;
          for (const value of Object.values(object(values))) {
            if (++count > 64) throw new Error("Vibe 文件包含过多编码");
            const e = object(value), params = object(e.params), extraction = params.information_extracted ?? info.information_extracted;
            if (Object.keys(params).some(k=>k!=="information_extracted" && params[k]!=null)) throw new Error("暂不支持此 Vibe 编码参数");
            if (params.mask) throw new Error("暂不支持带 Mask 的 Vibe 编码");
            if (typeof extraction !== "number" || !Number.isFinite(extraction) || extraction < 0 || extraction > 1 || typeof e.encoding !== "string") throw new Error("Vibe 编码参数不完整");
            base64Blob(e.encoding);
            if (!a.blob && v.id === await sha256(e.encoding)) encodingHashMatches = true;
            encoded.push({id:encodingKey(m,a.id,extraction),assetId:a.id,model:m,information:extraction,data:e.encoding});
          }
        }
        if (!encodingHashMatches) throw new Error("Vibe 编码校验失败");
        if (!a.blob && !encoded.some(e=>e.assetId===a.id && e.model===model.replace(/@local$/, "") && e.information===r.information)) throw new Error("文件不包含当前模型与信息提取量的编码");
        imported.push(a); rows.push(r);
      }
      await persist(imported,encoded); return rows;
    },
    dispose() { disposed = true; thumbnailOwners.clear(); unregister(); channel?.close(); clearUrls(); listeners.clear(); assets.clear(); encodings.clear(); },
  };
}
