import { isEntityKey } from "../domain/image-identity.ts";
import type { FavoriteIdentityBackup, ImageLineage, ImageTagBinding } from "../domain/image-identity.ts";
import { isPictureId } from "../ask/ids.ts";
import { readReferences, encodingKey, referenceModel } from "../domain/nai-references.ts";
import type { ReferenceAsset, VibeEncoding } from "../domain/nai-references.ts";
import { DEFAULTS, boardKeys } from "../domain/drawing.ts";
import { names } from "./names.ts";
import { validateRouting, validateModelLinks } from "../config/connections.ts";
import { object } from "../domain/value.ts";
import { readAskSettings } from "../ask/settings.ts";
import type {
  ConversationRecord,
  FavoriteRecord,
  AssetRecord,
} from "./records.ts";
import { assetRefs } from "./records.ts";

export const backupFormat = Object.freeze({
  app: "koma-image",
  kind: "backup",
  version: 2,
  filename: "koma-image-backup.json",
} as const);
export const backupLimits = Object.freeze({
  entries: 60_000,
  archiveBytes: 0xffffffff,
  directoryBytes: 64 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024,
  imageBytes: 128 * 1024 * 1024,
  preferenceChars: 2 * 1024 * 1024,
  pathBytes: 1024,
});
/**
 * A closed list of logical preferences. Vault/session/history/editor/handoff
 * and the ASK adult confirmation are absent.
 */
export const backupPreferences = Object.freeze({
  drawing: names.preferences,
  routing: names.routing,
  chatSettings: names.chatSettings,
  currentConversation: names.chatCurrent,
  chatRail: names.chatRail,
  tagCart: names.tagCart,
  tagCategories: names.tagCategories,
  localModels: names.localModels,
  ask: names.ask,
});
export type BackupPreferences = Partial<
  Record<keyof typeof backupPreferences, string>
>;
export interface ImageReference {
  path: string;
  type: "image/png" | "image/jpeg" | "image/webp";
}
export type FavoriteManifest = Omit<FavoriteRecord, "blob" | "thumbBlob"> & {
  image: ImageReference;
  thumbnail: ImageReference | null;
};
export type AssetManifest = Omit<AssetRecord, "blob"> & {
  image: ImageReference;
};
export type ReferenceAssetManifest = Omit<ReferenceAsset,"blob"|"thumbnail"> & { image: ImageReference | null; thumbnail: ImageReference | null };
export type VibeEncodingManifest = Omit<VibeEncoding,"data"> & { path: string; hash: string };
export interface BackupManifest {
  imageIdentity?: FavoriteIdentityBackup;
  app: "koma-image";
  kind: "backup";
  version: 2;
  id: string;
  createdAt: string;
  favorites: FavoriteManifest[];
  conversations: ConversationRecord[];
  assets: AssetManifest[];
  referenceAssets?: ReferenceAssetManifest[];
  vibeEncodings?: VibeEncodingManifest[];
  preferences: BackupPreferences;
}
const bad = () =>
  new Error("备份内容不完整或格式不受支持，请使用新版 Koma 备份");
const id = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length < 512;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(id);
const plain = (v: unknown) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function readBackupPreferences(value: unknown): BackupPreferences {
  if (!plain(value)) throw bad();
  const values = object(value),
    out: BackupPreferences = {};
  for (const key of Object.keys(
    backupPreferences,
  ) as (keyof typeof backupPreferences)[]) {
    const text = values[key];
    if (text === undefined) continue;
    if (typeof text !== "string" || text.length > backupLimits.preferenceChars)
      throw bad();
    if (key === "routing")
      out[key] = JSON.stringify(validateRouting(JSON.parse(text)));
    else if (key === "localModels")
      out[key] = JSON.stringify(validateModelLinks(JSON.parse(text)));
    else if (key === "drawing") {
      const value = object(JSON.parse(text));
      if (value.boards !== undefined) {
        const boards = object(value.boards), seen = new Set<string>();
        if (!Array.isArray(boards.items) || !boards.items.length) throw bad();
        for (const raw of boards.items) {
          const b = object(raw), f = object(b.form), chars = f.characters;
          if (!id(b.id) || seen.has(b.id) || typeof b.name !== "string" || !plain(b.form) || !Number.isSafeInteger(b.nextCharacterId) || Number(b.nextCharacterId) < 1 || !["auto", "manual"].includes(String(f.placement)) || !Array.isArray(chars)) throw bad();
          for (const key of boardKeys) {
            if (key === "characters" || key === "placement" || key === "naiReferences") continue;
            if (key === "cfg") {
              if (f.cfg != null && (typeof f.cfg !== "number" || !Number.isFinite(f.cfg))) throw bad();
              continue;
            }
            // Older Koma v2 backups predate the NAI controls; readBoards supplies defaults.
            if (["cfgRescale", "noiseSchedule", "varietyPlus", "naiMode", "complexity", "qualityPreset", "negativePreset"].includes(key) && f[key] === undefined) continue;
            if (typeof f[key] !== typeof DEFAULTS[key] || typeof f[key] === "number" && !Number.isFinite(f[key])) throw bad();
          }
          if (f.naiReferences !== undefined) checkedReferences(f.naiReferences);
          seen.add(b.id); const roles = new Set<string>();
          for (const raw of chars) {
            const c = object(raw);
            if (typeof c.id !== "string" || !/^c[1-9]\d*$/.test(c.id) || roles.has(c.id) || Number(c.id.slice(1)) >= Number(b.nextCharacterId) || typeof c.on !== "boolean" || typeof c.prompt !== "string" || typeof c.negative !== "string" || !Array.isArray(c.centers)) throw bad();
            roles.add(c.id);
            for (const raw of c.centers) { const p = object(raw); if ([p.x, p.y].some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) throw bad(); }
          }
        }
        if (typeof boards.activeId !== "string" || !seen.has(boards.activeId)) throw bad();
      }
      out[key] = text;
    }
    else if (key === "ask") {
      const value = JSON.parse(text);
      if (!plain(value)) throw bad();
      out[key] = JSON.stringify(readAskSettings(value));
    } else if (key === "currentConversation" || key === "chatRail")
      out[key] = text;
    else {
      JSON.parse(text);
      out[key] = text;
    }
  }
  return out;
}
export function collectBackupPreferences(
  storage: Pick<Storage, "getItem">,
): BackupPreferences {
  const result: BackupPreferences = {};
  for (const [field, key] of Object.entries(backupPreferences)) {
    const value = storage.getItem(key);
    if (value !== null) result[field as keyof BackupPreferences] = value;
  }
  return readBackupPreferences(result);
}
function checkedReferences(value: unknown) {
  const raw=object(value), r=readReferences(value);
  if (!plain(value) || raw.active!==r.active || raw.normalize!==r.normalize || !Array.isArray(raw.vibe) || !Array.isArray(raw.precise) || r.vibe.length!==raw.vibe.length || r.precise.length!==raw.precise.length || r.vibe.length>16 || r.precise.length>16) throw bad();
  for (const rawItem of [...raw.vibe,...raw.precise]) { const item=object(rawItem); if (typeof item.on!=="boolean" || [item.strength,item.information,item.fidelity].some(v=>typeof v!=="number" || !Number.isFinite(v) || v<0 || v>1) || !["character","style","character&style"].includes(String(item.type))) throw bad(); }
  return r;
}
function imageReference(value: unknown, folder: string): ImageReference {
  const ref = object(value);
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(String(ref.type)) ||
    typeof ref.path !== "string" ||
    !ref.path.startsWith(`${folder}/`) ||
    ref.path.includes("..") ||
    !/^[a-zA-Z0-9_./-]+$/.test(ref.path) ||
    new TextEncoder().encode(ref.path).length > backupLimits.pathBytes
  )
    throw bad();
  return { path: ref.path, type: ref.type as ImageReference["type"] };
}
export function validateConversation(value: unknown): ConversationRecord {
  const c = object(value);
  if (
    !id(c.id) ||
    typeof c.title !== "string" ||
    typeof c.prompt !== "string" ||
    !plain(c.settings) ||
    !ids(c.attachments) ||
    !ids(c.keepIds) ||
    !ids(c.skipTurnIds) ||
    !Array.isArray(c.turns)
  )
    throw bad();
  const seen = new Set<string>();
  for (const item of c.turns) {
    const t = object(item),
      snapshot = object(t.snapshot);
    if (
      !id(t.id) ||
      seen.has(t.id) ||
      !ids(snapshot.imageIds) ||
      !ids(snapshot.turnIds) ||
      !Array.isArray(t.versions)
    )
      throw bad();
    seen.add(t.id);
    for (const item of t.versions) {
      const v = object(item);
      if (
        !id(v.id) ||
        !Array.isArray(v.blocks) ||
        !["pending", "done", "error", "cancelled"].includes(String(v.status))
      )
        throw bad();
      for (const item of v.blocks) {
        const b = object(item);
        if (
          b.type === "image"
            ? !id(b.assetId)
            : b.type !== "text" || typeof b.text !== "string"
        )
          throw bad();
      }
    }
  }
  return structuredClone(c) as unknown as ConversationRecord;
}
function checkedIdentity(value: unknown): FavoriteIdentityBackup | undefined {
  if (value === undefined) return undefined;
  const raw = object(value), state = object(raw.state);
  if (raw.version !== 1 || !id(state.libraryId) || !Number.isSafeInteger(state.nextFavSeq) || Number(state.nextFavSeq) < 1 || !Array.isArray(raw.registrations)) throw bad();
  const seqs = new Set<number>();
  for (const value of raw.registrations) {
    const r = object(value);
    if (!Number.isSafeInteger(r.seq) || Number(r.seq)<1 || Number(r.seq)>=Number(state.nextFavSeq) || seqs.has(Number(r.seq)) || !id(r.recordId) || !isEntityKey(r.entity_key) || typeof r.active!=="boolean") throw bad();
    seqs.add(Number(r.seq));
  }
  return structuredClone(value) as FavoriteIdentityBackup;
}
function checkedLineage(value: unknown): ImageLineage | undefined {
  if (value === undefined) return undefined;
  const r = object(value);
  if (!["image","chat","edit:img2img","edit:inpaint","edit:enhance","edit:upscale","edit:director","edit:photopea","upload"].includes(String(r.via)) || r.parent_record_id!==undefined && !id(r.parent_record_id) || r.parent_entity_key!==undefined && !isEntityKey(r.parent_entity_key) || r.tool_detail!==undefined && typeof r.tool_detail!=="string") throw bad();
  let parent: ImageTagBinding | undefined;
  if (r.parent_ref !== undefined) {
    const ref = object(r.parent_ref), scope = object(ref.scope);
    if (typeof ref.tag !== "string" || !isPictureId(ref.tag) || !isEntityKey(ref.entity_key) || !id(ref.record_id) || !["page", "favorites", "chat", "ask"].includes(String(scope.kind)) || !id(scope.id) || ["board_id", "turn_id", "version_id", "asset_id"].some(k => scope[k] !== undefined && !id(scope[k]))) throw bad();
    parent = structuredClone(r.parent_ref) as ImageTagBinding;
  }
  // Diagnostic snapshots retain their original scope; import does not grant live access.
  return { via: r.via as ImageLineage["via"], ...(r.parent_record_id ? {parent_record_id:String(r.parent_record_id)} : {}), ...(r.parent_entity_key ? {parent_entity_key:String(r.parent_entity_key)} : {}), ...(r.tool_detail ? {tool_detail:String(r.tool_detail)} : {}), ...(parent ? { parent_ref: parent } : {}) };
}
/** Metadata validation only. M3's archive reader verifies CRC, bytes and asset hashes before writes. */
export function validateBackupManifest(value: unknown): BackupManifest {
  const m = object(value);
  if (
    m.app !== backupFormat.app ||
    m.kind !== backupFormat.kind ||
    m.version !== backupFormat.version ||
    typeof m.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(m.id) ||
    typeof m.createdAt !== "string" ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    !Array.isArray(m.favorites) ||
    !Array.isArray(m.assets) ||
    !Array.isArray(m.conversations)
  )
    throw bad();
  const imageIdentity = checkedIdentity(m.imageIdentity);
  const favorites: FavoriteManifest[] = [],
    assets: AssetManifest[] = [],
    seenFavorites = new Set(),
    seenAssets = new Set();
  for (const item of m.favorites) {
    const row = object(item);
    if (!id(row.id) || seenFavorites.has(row.id)) throw bad();
    seenFavorites.add(row.id);
    if (row.entity_key !== undefined && !isEntityKey(row.entity_key) || row.favSeq !== undefined && (!Number.isSafeInteger(row.favSeq) || Number(row.favSeq)<1)) throw bad();
    favorites.push({
      ...(row.entity_key ? { entity_key: row.entity_key } : {}),
      ...(row.favSeq ? { favSeq: row.favSeq } : {}),
      ...(row.lineage ? { lineage: checkedLineage(row.lineage) } : {}),
      id: row.id,
      createdAt: row.createdAt,
      favoritedAt: row.favoritedAt,
      params: row.params,
      size: row.size,
      quote: row.quote,
      ms: row.ms,
      image: imageReference(row.image, "favorites"),
      thumbnail: row.thumbnail
        ? imageReference(row.thumbnail, "thumbnails")
        : null,
    } as FavoriteManifest);
  }
  if (imageIdentity) for (const f of favorites) {
    const entry = imageIdentity.registrations.find(r => r.seq===f.favSeq);
    if (!entry?.active || entry.recordId!==f.id || entry.entity_key!==f.entity_key) throw bad();
  }
  if (imageIdentity?.registrations.some(r => r.active && !favorites.some(f => f.favSeq === r.seq && f.id === r.recordId && f.entity_key === r.entity_key))) throw bad();
  for (const item of m.assets) {
    const row = object(item);
    if (
      typeof row.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.id) ||
      seenAssets.has(row.id) ||
      typeof row.width !== "number" ||
      !Number.isFinite(row.width) ||
      row.width < 1 ||
      typeof row.height !== "number" ||
      !Number.isFinite(row.height) ||
      row.height < 1 ||
      !["upload", "result", "image"].includes(String(row.origin))
    )
      throw bad();
    seenAssets.add(row.id);
    assets.push({
      id: row.id,
      name: String(row.name || "图片"),
      origin: row.origin,
      width: row.width,
      height: row.height,
      image: imageReference(row.image, "assets"),
    } as AssetManifest);
  }
  const conversations = m.conversations.map(validateConversation),
    seenConversations = new Set();
  for (const c of conversations) {
    if (seenConversations.has(c.id)) throw bad();
    seenConversations.add(c.id);
  }
  if ([...assetRefs(conversations)].some((key) => !seenAssets.has(key)))
    throw bad();
  const referenceAssets: ReferenceAssetManifest[] = [], vibeEncodings: VibeEncodingManifest[] = [], referenceIds = new Set<string>(), encodingIds = new Set<string>();
  if (m.referenceAssets !== undefined && !Array.isArray(m.referenceAssets) || m.vibeEncodings !== undefined && !Array.isArray(m.vibeEncodings)) throw bad();
  for (const raw of (m.referenceAssets ?? []) as unknown[]) {
    const r = object(raw);
    if (typeof r.id !== "string" || !/^[a-f0-9]{64}$/.test(r.id) || referenceIds.has(r.id) || !Number.isSafeInteger(r.width) || !Number.isSafeInteger(r.height) || Number(r.width)<1 || Number(r.height)<1 || Number(r.width)*Number(r.height)>40_000_000) throw bad();
    referenceIds.add(r.id);
    referenceAssets.push({id:r.id,width:Number(r.width),height:Number(r.height), image:r.image ? imageReference(r.image,"references") : null, thumbnail:r.thumbnail ? imageReference(r.thumbnail,"references") : null});
  }
  for (const raw of (m.vibeEncodings ?? []) as unknown[]) {
    const e = object(raw);
    if (typeof e.assetId !== "string" || !referenceIds.has(e.assetId) || typeof e.model !== "string" || !referenceModel(e.model) || typeof e.information !== "number" || !Number.isFinite(e.information) || e.information<0 || e.information>1 || e.id!==encodingKey(e.model,e.assetId,e.information) || encodingIds.has(String(e.id)) || typeof e.path!=="string" || !/^references\/encodings\/[0-9]+\.bin$/.test(e.path) || typeof e.hash!=="string" || !/^[a-f0-9]{64}$/.test(e.hash)) throw bad();
    encodingIds.add(String(e.id)); vibeEncodings.push(e as unknown as VibeEncodingManifest);
  }
  if(referenceAssets.some(a=>!a.image && !vibeEncodings.some(e=>e.assetId===a.id))) throw bad();
  const preferences = readBackupPreferences(m.preferences);
  const forms = preferences.drawing ? object(JSON.parse(preferences.drawing)) : {};
  const configs = [forms.naiReferences, ...((object(forms.boards).items ?? []) as unknown[]).map(b=>object(object(b).form).naiReferences), ...favorites.flatMap(f=>{
    const params = object(f.params);
    return [params.naiReferences, ...(["manual-edit", "director"].includes(String(params.tool)) ? [object(params.sourceRecipe).naiReferences] : [])];
  })];
  for (const value of configs) {
    const r=value===undefined ? readReferences(undefined) : checkedReferences(value);
    for (const item of [...r.vibe,...r.precise]) if (!referenceIds.has(item.assetId)) throw new Error("备份缺少参考图片");
  }
  return {
    app: "koma-image",
    kind: "backup",
    version: 2,
    id: m.id,
    createdAt: m.createdAt,
    favorites,
    conversations,
    assets,
    preferences, referenceAssets, vibeEncodings, ...(imageIdentity ? { imageIdentity } : {}),
  };
}
