/** Identity belongs to original file bytes; recipes belong to the record. */
export interface ImageLineage {
  parent_record_id?: string;
  parent_entity_key?: string;
  parent_ref?: ImageTagBinding;
  via: "image" | "chat" | "edit:img2img" | "edit:inpaint" | "edit:enhance" | "edit:upscale" | "edit:director" | "edit:photopea" | "upload";
  tool_detail?: string;
}
export interface ImageTagBinding {
  tag: string;
  entity_key: string;
  record_id: string;
  scope: { kind: "page" | "favorites" | "chat" | "ask"; id: string; board_id?: string; turn_id?: string; version_id?: string; asset_id?: string };
}
export interface FavoriteIdentityState { libraryId: string; nextFavSeq: number }
export interface FavoriteRegistration { seq: number; recordId: string; entity_key: string; active: boolean }
export interface FavoriteIdentityBackup { version: 1; state: FavoriteIdentityState; registrations: FavoriteRegistration[] }
export const isEntityKey = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const hashes = new WeakMap<Blob, Promise<string>>();
/** Weak memoization owns neither originals nor URLs. Hash before opening IDB transactions. */
export function imageEntity(blob: Blob): Promise<string> {
  let pending = hashes.get(blob);
  if (!pending) {
    pending = blob.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(hash => `sha256:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")}`);
    hashes.set(blob, pending);
    void pending.catch(() => hashes.delete(blob));
  }
  return pending;
}
