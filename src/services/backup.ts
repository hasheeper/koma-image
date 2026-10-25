import type { ReferenceAsset, VibeEncoding } from "../domain/nai-references.ts";
import { base64Blob, blobBase64, sha256, referenceBitmap } from "../native/reference-images.ts";
import { createArchive, readArchive } from "../storage/backup-archive.ts";
import {
  backupFormat,
  backupLimits,
  backupPreferences,
  collectBackupPreferences,
  validateBackupManifest,
} from "../storage/backup-schema.ts";
import type {
  BackupPreferences,
  ImageReference,
  BackupManifest,
} from "../storage/backup-schema.ts";
import { assetRefs } from "../storage/records.ts";
import type {
  FavoriteRecord,
  AssetRecord,
  ConversationRecord,
} from "../storage/records.ts";
import { idbRequest, transactionDone } from "../storage/databases.ts";
import type { openDatabases } from "../storage/databases.ts";
import { names } from "../storage/names.ts";
import type { DataLease } from "./data-lease.ts";
type Progress = (done: number, total: number) => void;
export interface CheckedBackup {
  id: string;
  favorites: FavoriteRecord[];
  conversations: ConversationRecord[];
  assets: AssetRecord[];
  referenceAssets: ReferenceAsset[];
  vibeEncodings: VibeEncoding[];
  preferences: BackupPreferences;
}
const validated = new WeakSet<CheckedBackup>();
export const hashImage = async (blob: Blob) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const types = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function readBackup(
  file: Blob,
  progress: Progress = () => {},
): Promise<CheckedBackup> {
  const archive = await readArchive(file);
  const manifest = validateBackupManifest(
    JSON.parse(
      await (
        await archive.read(
          backupFormat.filename,
          "application/json",
          backupLimits.manifestBytes,
        )
      ).text(),
    ),
  );
  const image = async (ref: ImageReference) => {
    const blob = await archive.read(
      ref.path,
      ref.type,
      backupLimits.imageBytes,
    );
    if (!blob.size) throw new Error("备份包含空图片");
    return blob;
  };
  let done = 0;
  const favorites: FavoriteRecord[] = [],
    assets: AssetRecord[] = [];
  for (const { image: ref, thumbnail, ...row } of manifest.favorites) {
    favorites.push({
      ...row,
      blob: await image(ref),
      thumbBlob: thumbnail ? await image(thumbnail) : null,
    });
    progress(++done, manifest.favorites.length + manifest.assets.length);
  }
  for (const { image: ref, ...row } of manifest.assets) {
    const blob = await image(ref);
    if ((await hashImage(blob)) !== row.id)
      throw new Error("备份图片校验失败，请重新导出");
    assets.push({ ...row, blob });
    progress(++done, manifest.favorites.length + manifest.assets.length);
  }
  const referenceAssets: ReferenceAsset[] = [], vibeEncodings: VibeEncoding[] = [];
  for (const { image:ref, thumbnail, ...r } of manifest.referenceAssets ?? []) {
    const blob=ref ? await image(ref) : null;
    if (blob) {
      if (await hashImage(blob)!==r.id) throw new Error("参考图片校验失败");
      const bitmap=await referenceBitmap(blob);
      const matches=bitmap.width===r.width && bitmap.height===r.height;bitmap.close();
      if(!matches)throw new Error("参考图片尺寸校验失败");
    }
    referenceAssets.push({...r,blob,thumbnail:thumbnail ? await image(thumbnail) : null});
  }
  for (const {path,hash,...e} of manifest.vibeEncodings ?? []) {
    const blob=await archive.read(path,"application/octet-stream",8*1024*1024);
    if (!blob.size || await sha256(blob)!==hash) throw new Error("Vibe 编码校验失败");
    vibeEncodings.push({...e,data:await blobBase64(blob)});
  }
  const backup = {
    id: manifest.id,
    favorites,
    conversations: manifest.conversations,
    assets,
    preferences: manifest.preferences,
    referenceAssets, vibeEncodings,
  };
  validated.add(backup);
  return backup;
}
function revive(source: ConversationRecord): ConversationRecord {
  const c = structuredClone(source);
  for (const t of c.turns)
    for (const v of t.versions)
      if (v.status === "pending") {
        v.status = "cancelled";
        v.error = "页面关闭时仍在生成，结果没有保存；上游可能仍在处理或计费。";
      }
  return c;
}
function importedCopy(
  record: ConversationRecord,
  prefix: string,
): ConversationRecord {
  const copy = structuredClone(record),
    turns = new Map(copy.turns.map((t) => [t.id, `${prefix}:${t.id}`]));
  copy.id = prefix;
  copy.title = `${copy.title}（导入）`;
  copy.headId = turns.get(copy.headId ?? "") ?? null;
  copy.skipTurnIds = copy.skipTurnIds.flatMap((id) =>
    turns.has(id) ? [turns.get(id)!] : [],
  );
  for (const t of copy.turns) {
    t.id = turns.get(t.id)!;
    t.parentId = turns.get(t.parentId ?? "") ?? null;
    t.snapshot.parentId = turns.get(t.snapshot.parentId ?? "") ?? null;
    t.snapshot.turnIds = t.snapshot.turnIds.map((id) => turns.get(id) ?? id);
    for (const v of t.versions) v.id = `${prefix}:${v.id}`;
  }
  return copy;
}
export function createBackupService({
  databases,
  data,
  storage,
}: {
  databases: () => Awaited<ReturnType<typeof openDatabases>>;
  data: DataLease;
  storage: Pick<Storage, "getItem" | "setItem">;
}) {
  async function load() {
    const favoritesTx = databases().transaction(
      names.databases.favorites,
      ["favorites", "referenceAssets", "vibeEncodings"],
    );
    const chatTx = databases().transaction(names.databases.chat, [
      "conversations",
      "assets",
    ]);
    const [favorites, conversations, assets, referenceAssets, vibeEncodings] = await Promise.all([
      idbRequest(favoritesTx.objectStore("favorites").getAll()) as Promise<
        FavoriteRecord[]
      >,
      idbRequest(chatTx.objectStore("conversations").getAll()) as Promise<
        ConversationRecord[]
      >,
      idbRequest(chatTx.objectStore("assets").getAll()) as Promise<
        AssetRecord[]
      >,
      idbRequest(favoritesTx.objectStore("referenceAssets").getAll()) as Promise<ReferenceAsset[]>,
      idbRequest(favoritesTx.objectStore("vibeEncodings").getAll()) as Promise<VibeEncoding[]>,
    ]);
    return { favorites, conversations, assets, referenceAssets, vibeEncodings };
  }
  return {
    read: readBackup,
    async counts() {
      const stored = await load();
      return {
        favorites: stored.favorites.length,
        conversations: stored.conversations.length,
      };
    },
    export(progress?: Progress) {
      return data.export(async () => {
        const preferences = collectBackupPreferences(storage);
        const stored = await load(),
          entries: [string, Blob][] = [];
        const pack = (blob: Blob, prefix: string): ImageReference => {
          if (!(blob instanceof Blob) || !types.has(blob.type) || !blob.size)
            throw new Error("部分图片无法读取，未导出备份");
          const path = `${prefix}.${blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]}`;
          entries.push([path, blob]);
          return { path, type: blob.type as ImageReference["type"] };
        };
        const manifest: BackupManifest = {
          app: "koma-image",
          kind: "backup",
          version: 2,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          favorites: stored.favorites.map((r, i) => ({
            id: r.id,
            createdAt: r.createdAt,
            favoritedAt: r.favoritedAt,
            params: r.params,
            size: r.size,
            quote: r.quote,
            ms: r.ms,
            image: pack(r.blob, `favorites/${i}`),
            thumbnail: r.thumbBlob
              ? pack(r.thumbBlob, `thumbnails/${i}`)
              : null,
          })),
          conversations: stored.conversations,
          assets: stored.assets.map((r, i) => ({
            id: r.id,
            name: r.name,
            origin: r.origin,
            width: r.width,
            height: r.height,
            image: pack(r.blob, `assets/${i}`),
          })),
          referenceAssets: stored.referenceAssets.map((r,i)=>({id:r.id,width:r.width,height:r.height,image:r.blob ? pack(r.blob,`references/images/${i}`) : null,thumbnail:r.thumbnail ? pack(r.thumbnail,`references/thumbnails/${i}`) : null})),
          vibeEncodings: await Promise.all(stored.vibeEncodings.map(async ({data,...e},i)=>{const blob=base64Blob(data),path=`references/encodings/${i}.bin`;entries.push([path,blob]);return {...e,path,hash:await sha256(blob)};})),
          preferences,
        };
        const metadata = new Blob([JSON.stringify(manifest)], {
          type: "application/json",
        });
        if (metadata.size > backupLimits.manifestBytes)
          throw new Error("对话记录过大，当前备份最多支持 32MB 的文字与参数");
        entries.unshift([backupFormat.filename, metadata]);
        return {
          blob: await createArchive(entries, progress),
          counts: {
            favorites: stored.favorites.length,
            conversations: stored.conversations.length,
            images: stored.assets.length,
          },
        };
      });
    },
    import(backup: CheckedBackup) {
      if (!validated.has(backup))
        return Promise.reject(new Error("请先校验备份文件"));
      return data.import(async () => {
        const saved = await load(),
          existing = new Map(saved.conversations.map((c) => [c.id, c]));
        const records: ConversationRecord[] = [],
          current = new Map<string, string>();
        for (const source of backup.conversations) {
          const row = revive(source),
            match = existing.get(row.id);
          const target =
            match && JSON.stringify(match) !== JSON.stringify(row)
              ? importedCopy(row, `import-${backup.id}-${row.id}`)
              : row;
          current.set(row.id, target.id);
          if (!existing.has(target.id)) records.push(target);
        }
        // Conversation records and their assets commit or abort together.
        const tx = databases().transaction(
          names.databases.chat,
          ["conversations", "assets"],
          "readwrite",
        );
        const done = transactionDone(tx);
        void done.catch(() => {});
        try {
          const conversations = tx.objectStore("conversations"),
            assets = tx.objectStore("assets");
          for (const row of records) conversations.put(row);
          const [all, keys] = await Promise.all([
            idbRequest(conversations.getAll()) as Promise<ConversationRecord[]>,
            idbRequest(assets.getAllKeys()),
          ]);
          const used = assetRefs(all),
            have = new Set(keys),
            imported = new Map(backup.assets.map((a) => [a.id, a]));
          for (const id of used)
            if (!have.has(id) && imported.has(id))
              assets.put(imported.get(id)!);
          for (const id of keys) if (!used.has(String(id))) assets.delete(id);
          await done;
        } catch (error) {
          try {
            tx.abort();
          } catch {}
          await done.catch(() => {});
          throw error;
        }
        const savedIds = new Map(saved.favorites.map((f) => [f.id, f])),
          additions: FavoriteRecord[] = [];
        for (const row of backup.favorites) {
          const present = savedIds.get(row.id);
          if (!present) {
            additions.push(row);
            continue;
          }
          if (
            present.blob.size === row.blob.size &&
            present.blob.type === row.blob.type &&
            (await hashImage(present.blob)) === (await hashImage(row.blob))
          )
            continue;
          const id = `import-${backup.id}-${row.id}`;
          if (!savedIds.has(id)) additions.push({ ...row, id });
        }
        const favoritesTx = databases().transaction(
            names.databases.favorites,
            ["favorites", "referenceAssets", "vibeEncodings"],
            "readwrite",
          ),
          finished = transactionDone(favoritesTx);
        for (const row of additions)
          favoritesTx.objectStore("favorites").add(row);
        for (const row of backup.referenceAssets) favoritesTx.objectStore("referenceAssets").put(row);
        for (const row of backup.vibeEncodings) favoritesTx.objectStore("vibeEncodings").put(row);
        await finished;
        for (const field of Object.keys(
          backupPreferences,
        ) as (keyof BackupPreferences)[]) {
          const value = backup.preferences[field];
          if (value !== undefined)
            storage.setItem(
              backupPreferences[field],
              field === "currentConversation"
                ? (current.get(value) ?? value)
                : value,
            );
        }
        return { favorites: additions.length, conversations: records.length };
      });
    },
  };
}
