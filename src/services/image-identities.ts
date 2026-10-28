import { imageEntity } from "../domain/image-identity.ts";
import type { FavoriteIdentityState, FavoriteRegistration, FavoriteIdentityBackup } from "../domain/image-identity.ts";
import type { FavoriteRecord } from "../storage/records.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import type { openDatabases } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
type Databases = Awaited<ReturnType<typeof openDatabases>>;
export const identityStores = ["favorites", "identity", "favoriteTags"];
export async function readFavoriteIdentity(db: Databases): Promise<FavoriteIdentityBackup> {
  const tx = db.transaction(names.databases.favorites, ["identity", "favoriteTags"]);
  const [state, registrations] = await Promise.all([
    idbRequest<FavoriteIdentityState | undefined>(tx.objectStore("identity").get("library")),
    idbRequest<FavoriteRegistration[]>(tx.objectStore("favoriteTags").getAll()),
  ]);
  if (!state) throw new Error("收藏身份尚未就绪");
  return { version: 1, state, registrations };
}
/** Runs entirely on IDB request continuations. The caller owns the data lease. */
export async function assignFavorite(tx: IDBTransaction, row: FavoriteRecord, restore = false): Promise<FavoriteRecord> {
  const store = tx.objectStore("favorites"), tags = tx.objectStore("favoriteTags"), meta = tx.objectStore("identity");
  const [existing, saved] = await Promise.all([
    idbRequest<FavoriteRecord | undefined>(store.get(row.id)), idbRequest<FavoriteIdentityState | undefined>(meta.get("library")),
  ]);
  if (existing?.favSeq) return existing;
  const state = saved ?? { libraryId: crypto.randomUUID(), nextFavSeq: 1 };
  const registration = restore && row.favSeq ? await idbRequest<FavoriteRegistration | undefined>(tags.get(row.favSeq)) : undefined;
  const seq = registration?.recordId === row.id && registration.entity_key === row.entity_key && !registration.active ? registration.seq : state.nextFavSeq++;
  if (!Number.isSafeInteger(state.nextFavSeq)) throw new Error("收藏编号已达上限");
  const result = { ...row, favSeq: seq };
  store.put(result); tags.put({ seq, recordId: row.id, entity_key: row.entity_key!, active: true } satisfies FavoriteRegistration);
  meta.put(state, "library");
  return result;
}
export async function retireFavorite(tx: IDBTransaction, id: string) {
  const store = tx.objectStore("favorites"), tags = tx.objectStore("favoriteTags");
  const row = await idbRequest<FavoriteRecord | undefined>(store.get(id));
  if (row?.favSeq) {
    const entry = await idbRequest<FavoriteRegistration | undefined>(tags.get(row.favSeq));
    if (entry?.recordId === id) tags.put({ ...entry, active: false });
  }
  store.delete(id);
}
/** Backfill only current Koma records. Re-read under the write transaction to respect other tabs. */
export async function initializeFavoriteIdentity(db: Databases) {
  const read = db.transaction(names.databases.favorites, "favorites");
  const rows = await idbRequest<FavoriteRecord[]>(read.objectStore("favorites").getAll());
  const askTx = db.transaction(names.databases.ask,"conversations");
  const contexts = await idbRequest<{ scope?: { labels?: { favorites?: string[]; favoriteSeqs?: {id:string;seq:number}[] } } }[]>(askTx.objectStore("conversations").getAll());
  const byRecord = new Map<string,Set<number>>(), bySeq = new Map<number,Set<string>>();
  for (const c of contexts) for (const {id,seq} of (c.scope?.labels?.favoriteSeqs ?? (c.scope?.labels?.favorites ?? []).map((id,i)=>({id,seq:i+1})))) {
    if (!byRecord.has(id)) byRecord.set(id,new Set()); byRecord.get(id)!.add(seq);
    if (!bySeq.has(seq)) bySeq.set(seq,new Set()); bySeq.get(seq)!.add(id);
  }
  const preferred = new Map([...byRecord].flatMap(([id,seqs])=>seqs.size===1 && bySeq.get([...seqs][0])?.size===1 ? [[id,[...seqs][0]] as const] : []));
  const ready = new Map(await Promise.all(rows.map(async row => [row.id, await imageEntity(row.blob)] as const)));
  const tx = db.transaction(names.databases.favorites, identityStores, "readwrite"), done = transactionDone(tx);
  try {
    const [current, saved, registrations] = await Promise.all([
      idbRequest<FavoriteRecord[]>(tx.objectStore("favorites").getAll()),
      idbRequest<FavoriteIdentityState | undefined>(tx.objectStore("identity").get("library")),
      idbRequest<FavoriteRegistration[]>(tx.objectStore("favoriteTags").getAll()),
    ]);
    const state = saved ?? { libraryId: crypto.randomUUID(), nextFavSeq: 1 }, tags = new Map(registrations.map(r => [r.seq, r]));
    for (const r of current) if (r.favSeq && Number.isSafeInteger(r.favSeq)) state.nextFavSeq = Math.max(state.nextFavSeq, r.favSeq + 1);
    for (const r of registrations) state.nextFavSeq = Math.max(state.nextFavSeq, r.seq + 1);
    for (const row of current) if (!row.favSeq) {
      const seq=preferred.get(row.id);
      if (seq && !tags.has(seq) && !current.some(r=>r.favSeq===seq)) {
        row.favSeq=seq; state.nextFavSeq=Math.max(state.nextFavSeq,seq+1);
        // Reserve now so deterministic fallback cannot claim an old known number.
        tags.set(seq,{seq,recordId:row.id,entity_key:ready.get(row.id) ?? row.entity_key!,active:true});
        tx.objectStore("favorites").put({...row,entity_key:ready.get(row.id) ?? row.entity_key});
      }
    }
    for (const row of current.sort((a,b) => a.favoritedAt-b.favoritedAt || a.createdAt-b.createdAt || a.id.localeCompare(b.id))) {
      const key = ready.get(row.id) ?? row.entity_key;
      if (!key) throw new Error("收藏数据已变化，请重试");
      let seq = row.favSeq;
      if (!seq || seq < 1 || tags.has(seq) && tags.get(seq)!.recordId !== row.id) seq = state.nextFavSeq++;
      const entry = { seq, recordId: row.id, entity_key: key, active: true };
      tags.set(seq, entry); tx.objectStore("favoriteTags").put(entry);
      if (row.entity_key !== key || row.favSeq !== seq) tx.objectStore("favorites").put({ ...row, favSeq: seq, entity_key: key });
    }
    tx.objectStore("identity").put(state, "library");
    await done;
  } catch (e) { try { tx.abort(); } catch {} await done.catch(() => {}); throw e; }
}
/** Import holds the exclusive data lease. Preserve local numbers and adopt only a pristine library. */
export async function mergeFavoriteIdentity(tx: IDBTransaction, additions: readonly FavoriteRecord[], incoming?: FavoriteIdentityBackup) {
  const meta = tx.objectStore("identity"), tags = tx.objectStore("favoriteTags"), store = tx.objectStore("favorites");
  let state = await idbRequest<FavoriteIdentityState | undefined>(meta.get("library"));
  const registrations = await idbRequest<FavoriteRegistration[]>(tags.getAll());
  const pristine = !registrations.length && (!state || state.nextFavSeq === 1);
  if (pristine && incoming) {
    state = { ...incoming.state };
    for (const r of incoming.registrations) tags.put({ ...r, active: false });
  }
  state ??= { libraryId: crypto.randomUUID(), nextFavSeq: 1 };
  const sameLibrary = incoming?.state.libraryId === state.libraryId;
  const reserved = new Map((pristine && incoming ? incoming.registrations.map(r=>({...r,active:false})) : registrations).map(r => [r.seq, r]));
  for (const row of additions) {
    const old = row.favSeq ? reserved.get(row.favSeq) : undefined;
    const seq = sameLibrary && old?.recordId === row.id && old.entity_key === row.entity_key && !old.active ? old.seq : state.nextFavSeq++;
    const registration = { seq, recordId: row.id, entity_key: row.entity_key!, active: true };
    reserved.set(seq, registration); tags.put(registration); store.add({ ...row, favSeq: seq });
  }
  if (sameLibrary && incoming) {
    for (const r of incoming.registrations) if (!reserved.has(r.seq)) { tags.put({ ...r, active: false }); reserved.set(r.seq, r); }
    state.nextFavSeq = Math.max(state.nextFavSeq, incoming.state.nextFavSeq);
  }
  for (const seq of reserved.keys()) state.nextFavSeq = Math.max(state.nextFavSeq, seq + 1);
  if (!Number.isSafeInteger(state.nextFavSeq)) throw new Error("收藏编号已达上限");
  meta.put(state, "library");
}
