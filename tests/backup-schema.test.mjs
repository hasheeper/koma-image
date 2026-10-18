import test from "node:test";
import assert from "node:assert/strict";
import { backupFormat, backupLimits, validateBackupManifest, collectBackupPreferences } from "../src/storage/backup-schema.ts";
import { names } from "../src/storage/names.ts";

const manifest = () => ({ app: "koma-image", kind: "backup", version: 2, id: "12345678-1234-1234-1234-123456789012",
  createdAt: new Date(0).toISOString(), favorites: [], conversations: [], assets: [], preferences: {} });

test("only the new Koma envelope is accepted, with logical allowlisted preference fields", () => {
  assert.equal(validateBackupManifest(manifest()).version, 2);
  for (const change of [{ version: 1 }, { app: "other-app" }, { kind: "routing" }, { id: "bad" }, { createdAt: "bad" }]) {
    assert.throws(() => validateBackupManifest({ ...manifest(), ...change }));
  }
  const read = [];
  const preferences = collectBackupPreferences({ getItem(key) {
    read.push(key);
    return key === names.preferences ? '{"historyLimit":25}' : key === names.routing ? '{"version":1,"connections":{},"links":{}}' : null;
  } });
  assert.deepEqual(Object.keys(preferences).sort(), ["drawing", "routing"]);
  for (const key of [names.vault, names.sessionKeys, names.sessionDerivedKey, names.tagHandoff]) assert.ok(!read.includes(key));
  const clean = validateBackupManifest({ ...manifest(), vault: "excluded", preferences: { ...preferences, sessionKeys: "excluded" } });
  assert.equal(JSON.stringify(clean).includes("excluded"), false);
  assert.equal(backupFormat.filename, "koma-image-backup.json");
  assert.equal(backupLimits.entries, 60000); assert.equal(backupLimits.archiveBytes, 0xffffffff);
});

test("manifest rejects duplicate records, missing referenced assets, and unsafe image references", () => {
  const favorite = { id: "one", image: { path: "favorites/0.png", type: "image/png" }, thumbnail: null };
  assert.throws(() => validateBackupManifest({ ...manifest(), favorites: [favorite, favorite] }));
  for (const path of ["../outside.png", "favorites/../outside.png", "https://example.test/img.png"]) {
    assert.throws(() => validateBackupManifest({ ...manifest(), favorites: [{ ...favorite, image: { ...favorite.image, path } }] }));
  }
  const c = { id: "conversation", title: "草稿", prompt: "text", settings: {}, attachments: ["missing"], keepIds: [], skipTurnIds: [], turns: [] };
  assert.throws(() => validateBackupManifest({ ...manifest(), conversations: [c] }));
  const asset = { id: "a".repeat(64), width: 1, height: 1, name: "synthetic", origin: "result", image: { path: "assets/0.png", type: "image/png" } };
  c.attachments = [asset.id];
  const result = validateBackupManifest({ ...manifest(), conversations: [c], assets: [asset] });
  assert.equal(result.conversations[0].prompt, "text");
  assert.throws(() => validateBackupManifest({ ...manifest(), assets: [asset, asset] }));
});
