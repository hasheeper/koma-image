import { shallowRef } from "vue";
import type { Slates } from "./service.ts";
import type { Slate } from "./model.ts";
import { sha256 } from "./model.ts";
import { captionText } from "./captions.ts";
import { assetReceipt, externalEdit, slateFile } from "./documents.ts";
import type { bridgeStorage } from "../bridge/storage.ts";
import type { InboxReceipt } from "../bridge/protocol.ts";
import { DRAFT_SCHEMA } from "../bridge/protocol.ts";
import { fileDriver, safePath } from "../bridge/fs-driver.ts";

export interface SlateSession { id: string; root: FileSystemDirectoryHandle; signal: AbortSignal }
interface Delivery { path: string; sha256: string; asset_id: string; delivered_at: string }
export interface Mapping { id: string; path: string; hash: string | null; version: number; status: "pending" | "synced" | "conflict" | "error"; error?: string; deliveries: Delivery[]; files?: Record<string, { hash: string; complete: boolean }>; writing?: { before: string | null; after: string; version: number }; proposal?: { draft: string; hash: string } }
export function createSlateSync(slates: Slates, storage: ReturnType<typeof bridgeStorage>, port: {
  accept(value: unknown, context: string): Promise<InboxReceipt>;
  receipt(context: string, id: string): InboxReceipt | null;
  focus(context: string, id: string): boolean;
}) {
  const mappings = shallowRef<readonly Mapping[]>([]);
  let session: SlateSession | null = null, sequence = Promise.resolve();
  const key = (s: SlateSession) => `slates:${s.id}`;
  const serial = <T>(work: () => Promise<T>) => { const task = sequence.catch(() => {}).then(work); sequence = task.then(() => {}, () => {}); return task; };
  async function read(s: SlateSession) { return await storage.read<Mapping[]>(key(s)) ?? []; }
  async function save(s: SlateSession, all: Mapping[]) { await storage.put(key(s), all); if (s === session) mappings.value = all; }
  async function ensure(s: SlateSession, id: string) {
    const all = await read(s); let map = all.find(m => m.id === id);
    if (!map) { map = { id, path: `slates/${id}.slate.json`, hash: null, version: 0, status: "pending", deliveries: [] }; all.push(map); await save(s, all); }
    return map;
  }
  async function bytes(s: SlateSession, path: string) {
    const parts = safePath(path), name = parts.pop()!; let dir = s.root;
    try { for (const part of parts) dir = await dir.getDirectoryHandle(part); return await (await dir.getFileHandle(name)).getFile(); }
    catch (e) { if (e instanceof DOMException && e.name === "NotFoundError") return null; throw e; }
  }
  async function verifiedWrite(s: SlateSession, map: Mapping, all: Mapping[], path: string, value: Blob | string) {
    s.signal.throwIfAborted();
    const expected = await sha256(value), existing = await bytes(s, path);
    const existingHash = existing ? await sha256(existing) : null, owned = map.files?.[path];
    const pendingEmpty = !!existing && existing.size === 0 && owned?.hash === expected && !owned.complete;
    if (existing && existingHash !== expected && !pendingEmpty) throw new Error(`${path} 已存在不同内容，请改用新的成果路径`);
    if (!existing || pendingEmpty) {
      map.files ??= {}; map.files[path] = { hash: expected, complete: false }; await save(s, all);
      await fileDriver(s.root).write(path, value, s.signal);
    }
    const written = await bytes(s, path);
    if (!written || await sha256(written) !== expected) throw new Error(`${path} 写入校验失败`);
    map.files ??= {}; map.files[path] = { hash: expected, complete: true }; await save(s, all);
    return expected;
  }
  async function deliver(s: SlateSession, slate: Slate | null, id: string, required: boolean) {
    const all = await read(s), map = all.find(m => m.id === id);
    if (!map) { if (required) throw new Error("任务板尚未映射到此目录"); return; }
    const driver = fileDriver(s.root);
    try {
      const existing = await bytes(s, map.path), rawHash = existing ? await sha256(existing) : null;
      if (map.writing && rawHash === map.writing.after) { map.hash = rawHash; map.version = map.writing.version; delete map.writing; await save(s, all); }
      const hash = map.writing?.before === null && existing?.size === 0 ? null : rawHash;
      // Applying a reviewed file commits locally before ASK publishes its applied receipt.
      // Leave the unchanged proposal for scan() to acknowledge; this is pending review,
      // not a failed delivery. Required deliveries and newer external edits still fail.
      if (!required && map.proposal && hash === map.proposal.hash && port.receipt(s.id, map.proposal.draft)?.status === "pending") return;
      if (hash !== map.hash) throw new Error("目录任务文件已有外部修改，请先审阅或明确保留本机版本");
      if (map.proposal) throw new Error("外部任务修改正在等待审阅");
      if (!slate) {
        // Undo/deletion never deletes external files or originals. A tombstone is a checked versioned update.
        const value = JSON.stringify({ schema: "koma.bridge.slate.v1", deleted: true, id }, null, 2);
        await driver.write(map.path, value, s.signal); map.hash = await sha256(value); map.status = "synced"; map.version = 0;
        await save(s, all); return;
      }
      for (const todo of slate.todos) if (todo.binding) {
        const binding = todo.binding, asset = await slates.asset(binding.assetId);
        if (!asset) throw new Error("本机成果不可用");
        await verifiedWrite(s, map, all, binding.target_path, asset.blob);
        const receiptPath = `${binding.target_path}.json`, captionPath = `${binding.target_path}.txt`;
        await verifiedWrite(s, map, all, receiptPath, JSON.stringify(assetReceipt(asset), null, 2));
        await verifiedWrite(s, map, all, captionPath, captionText(asset, binding.caption));
        if (!map.deliveries.some(d => d.asset_id === asset.id && d.path === binding.target_path)) {
          map.deliveries.push({ path: binding.target_path, sha256: asset.sha256, asset_id: asset.id, delivered_at: new Date().toISOString() });
          map.status = "pending"; await save(s, all);
        }
      }
      // Check again after asset awaits. Filesystem has no cross-file CAS; a final verification detects observable races.
      const latest = await bytes(s, map.path);
      if ((map.writing?.before === null && latest?.size === 0 ? null : latest ? await sha256(latest) : null) !== hash) throw new Error("交付期间目录任务文件发生变化");
      const payload = JSON.stringify(slateFile(slate, map.deliveries.filter(d => slate.todos.some(t => t.binding?.assetId === d.asset_id && t.binding.target_path === d.path))), null, 2), nextHash = await sha256(payload);
      if (nextHash !== hash) {
        map.writing = { before: hash, after: nextHash, version: slate.version }; await save(s, all);
        await driver.write(map.path, payload, s.signal);
      }
      const result = await bytes(s, map.path);
      if (!result || await sha256(result) !== nextHash) throw new Error("任务文件写入后被修改");
      map.hash = nextHash; map.version = slate.version; map.status = "synced"; slates.deliverySucceeded(id); delete map.error; delete map.writing;
      await save(s, all);
    } catch (e) {
      map.status = "error"; map.error = e instanceof Error ? e.message : String(e); await save(s, all); throw e;
    }
  }
  async function propose(s: SlateSession, map: Mapping, text: string, hash: string) {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { await new Promise(resolve => setTimeout(resolve, 120)); const again = await bytes(s, map.path); if (!again) return; if (again.size > 1024 * 1024) throw new Error("任务文件超过 1 MB"); text = await again.text(); raw = JSON.parse(text); hash = await sha256(text); }
    const local = slates.get(map.id), doc = raw as { deleted?: boolean; id?: string };
    const step = doc.deleted ? { kind: "slate_edit", op: "delete", slate_id: local?.id, expected_version: local?.version } : externalEdit(raw, local);
    if (doc.deleted && (!local || doc.id !== local.id)) throw new Error("外部删除目标不存在");
    const id = `slate-${crypto.randomUUID()}`;
    const result = await port.accept({ schema: DRAFT_SCHEMA, draft_id: id, source_label: `任务文件 · ${map.path}`, draft_title: `审阅任务文件 · ${local?.title ?? "新清单"}`, steps: [step] }, s.id);
    if (result.status === "invalid") throw new Error(result.error ?? "任务文件无效");
    // Keep a new file's reviewed local identity on its original path before commit.
    // Auto-mapping a newly created Slate must not create a second canonical file.
    const target = await storage.read<string>(`slate-target:${s.id}:${id}`);
    if (target) map.id = target;
    map.proposal = { draft: id, hash }; map.status = "conflict"; map.error = "外部修改已加入 ASK 草稿，等待审阅";
  }
  async function scan(s: SlateSession) {
    s.signal.throwIfAborted();
    const all = await read(s), known = new Set(all.map(m => m.path));
    try {
      const dir = await s.root.getDirectoryHandle("slates");
      const iterable = dir as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> };
      let count = 0;
      for await (const handle of iterable.values()) {
        if (++count > 100) break;
        if (handle.kind !== "file" || !handle.name.endsWith(".slate.json")) continue;
        const path = `slates/${handle.name}`; if (known.has(path)) continue;
        const file = await bytes(s, path); if (!file || file.size > 1024 * 1024) continue;
        const map: Mapping = { id: `external-${crypto.randomUUID()}`, path, hash: null, version: 0, status: "pending", deliveries: [] };
        all.push(map); known.add(path);
      }
    } catch (e) { if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e; }
    for (const map of all) {
      try {
        s.signal.throwIfAborted();
        const file = await bytes(s, map.path);
        if (file && file.size > 1024 * 1024) throw new Error("任务文件超过 1 MB");
        const rawHash = file ? await sha256(file) : null;
        if (map.writing && rawHash === map.writing.after) { map.hash = rawHash; map.version = map.writing.version; map.status = "synced"; delete map.writing; }
        const hash = map.writing?.before === null && file?.size === 0 ? null : rawHash;
        if (map.proposal) {
          const receipt = port.receipt(s.id, map.proposal.draft) ?? (await storage.received(s.id, map.proposal.draft))?.receipt;
          if (receipt?.status === "applied") {
            const target = await storage.read<string>(`slate-target:${s.id}:${map.proposal.draft}`);
            if (target) map.id = target;
            map.hash = map.proposal.hash; delete map.proposal; delete map.error; map.status = "pending";
          } else if (receipt?.status === "dismissed" || receipt?.status === "invalid") { map.status = "conflict"; map.error = "外部修改未采用；可重新审阅，或明确用本机版本覆盖"; }
        }
        if (!map.proposal && hash !== map.hash) {
          if (!file) throw new Error("目录任务文件已被删除，请明确保留本机版本后重建");
          // Existing same-ID files are also reviewed; no implicit overwrite on first mount.
          if (map.id.startsWith("external-")) {
            const raw = JSON.parse(await file.text());
            if (typeof raw?.slate?.id === "string" && slates.get(raw.slate.id)) map.id = raw.slate.id;
          }
          await propose(s, map, await file.text(), hash!);
        }
      } catch (e) { map.status = "conflict"; map.error = e instanceof Error ? e.message : String(e); }
    }
    await save(s, all);
    for (const map of all) if (!map.proposal && map.status !== "conflict") {
      const local = slates.get(map.id);
      if (local && (map.version !== local.version || map.status !== "synced")) await deliver(s, local, map.id, false).catch(() => {});
    }
  }
  return {
    mappings,
    attach(s: SlateSession) { session = s; return serial(async () => { await slates.restored; const active = slates.snapshot(); if (active) await ensure(s, active.id); mappings.value = await read(s); }); },
    async detach() { session = null; await sequence; mappings.value = []; },
    scan: (s: SlateSession) => serial(() => scan(s)),
    deliver(slate: Slate | null, id: string, required: boolean, created = false) {
      const s = session;
      if (!s) return required ? Promise.reject(new Error("目录已断开，交付未完成")) : Promise.resolve();
      return serial(async () => {
        if (s.signal.aborted) throw new Error("目录已断开");
        if (slate && (required || created)) await ensure(s, id);
        await deliver(s, slate, id, required);
      });
    },
    map(id: string) { const s = session; if (!s) return Promise.reject(new Error("请先挂载目录")); return serial(async () => { await ensure(s, id); await scan(s); }); },
    resolve(id: string, mode: "local" | "review") { const s = session; if (!s) return Promise.reject(new Error("目录已断开")); return serial(async () => {
      const all = await read(s), map = all.find(m => m.id === id); if (!map) return;
      const file = await bytes(s, map.path), hash = file ? await sha256(file) : null;
      if (mode === "local") {
        if (!slates.get(id)) throw new Error("没有可覆盖的本机任务板");
        map.hash = hash; map.status = "pending"; delete map.proposal; delete map.error; await save(s, all); await deliver(s, slates.get(id), id, false);
      } else { if (map.proposal && port.receipt(s.id, map.proposal.draft)?.status === "pending") { if (!port.focus(s.id, map.proposal.draft)) throw new Error("ASK 正在运行，请先结束当前操作再审阅"); return; } if (!file) throw new Error("外部文件不存在"); await propose(s, map, await file.text(), hash!); await save(s, all); }
    }); },
    async settled() { await sequence; },
  };
}
