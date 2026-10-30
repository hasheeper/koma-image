import test from "node:test";
import assert from "node:assert/strict";
import { backupFormat, backupLimits, validateBackupManifest, collectBackupPreferences } from "../src/storage/backup-schema.ts";
import { names } from "../src/storage/names.ts";

const manifest = () => ({ app: "koma-image", kind: "backup", version: 2, id: "12345678-1234-1234-1234-123456789012",
  createdAt: new Date(0).toISOString(), favorites: [], conversations: [], assets: [], preferences: {} });

test("image source priorities remain separate from available links in exported/restored preferences", () => {
  const routing = { version: 1, connections: { official: { id: "official", name: "模拟官方", baseUrl: "https://image.novelai.net", profileId: "nai-official-v1", credentialRef: "official-key", revision: "r1" } }, links: {}, order: ["official"] };
  const preferences = collectBackupPreferences({ getItem: key => key === names.routing ? JSON.stringify(routing) : null });
  const restored = JSON.parse(validateBackupManifest({ ...manifest(), preferences }).preferences.routing);
  assert.deepEqual(restored.order, routing.order);
  assert.deepEqual(restored.links, {});
});

test('history capacities round-trip as general preferences, separate from transient EDIT images', () => {
  const drawing = JSON.stringify({historyLimit:17,editorHistoryLimit:0});
  const preferences = collectBackupPreferences({getItem:key=>key===names.preferences?drawing:null});
  const restored=validateBackupManifest({...manifest(),preferences});
  assert.deepEqual(JSON.parse(restored.preferences.drawing),{historyLimit:17,editorHistoryLimit:0});
  assert.equal('editor' in restored.preferences,false);
});

test('image identity metadata validates both registration directions and retains scoped lineage', () => {
  const entity_key=`sha256:${'a'.repeat(64)}`, parent_ref={tag:'#e1.2',record_id:'parent',entity_key,scope:{kind:'page',id:'old-page',board_id:'old-board'}};
  const favorite={id:'one',favSeq:3,entity_key,lineage:{via:'edit:photopea',parent_record_id:'parent',parent_entity_key:entity_key,parent_ref},image:{path:'favorites/0.png',type:'image/png'},thumbnail:null};
  const imageIdentity={version:1,state:{libraryId:'library',nextFavSeq:4},registrations:[{seq:1,recordId:'removed',entity_key,active:false},{seq:3,recordId:'one',entity_key,active:true}]};
  const read=()=>validateBackupManifest({...manifest(),favorites:[favorite],imageIdentity});
  assert.deepEqual(read().favorites[0].lineage.parent_ref,parent_ref);
  imageIdentity.version=2;assert.throws(read);imageIdentity.version=1;
  imageIdentity.registrations[0].active=true;assert.throws(read);imageIdentity.registrations[0].active=false;
  favorite.lineage.parent_ref={...parent_ref,scope:{kind:'page',id:''}};assert.throws(read);
  favorite.lineage.parent_ref={...parent_ref,entity_key:'unverified'};assert.throws(read);
});

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
  for (const key of [names.credentials, names.sessionKeys, names.tagHandoff]) assert.ok(!read.includes(key));
  const clean = validateBackupManifest({ ...manifest(), credentials: "excluded", preferences: { ...preferences, sessionKeys: "excluded" } });
  assert.equal(JSON.stringify(clean).includes("excluded"), false);
  assert.equal(backupFormat.filename, "koma-image-backup.json");
  assert.equal(backupLimits.entries, 60000); assert.equal(backupLimits.archiveBytes, 0xffffffff);
});

test("ASK settings travel as a validated logical field; the adult confirmation never does", () => {
  const stored = { [names.ask]: JSON.stringify({ version: 1, connectionId: "connection-a", model: "reasoning-model", images: false, preference: "先说结论", words: ["soft_light", "new topic", "自由设定"], replacements: [{ from: "red coat", to: "blue dress" }], alwaysCodec: true, extra: "dropped" }),
    [names.askAdult]: "true" };
  const read = [];
  const preferences = collectBackupPreferences({ getItem(key) { read.push(key); return stored[key] ?? null; } });
  assert.deepEqual(Object.keys(preferences), ["ask"]);
  assert.ok(!read.includes(names.askAdult));
  // A single older model ID becomes its connection's only pick.
  assert.deepEqual(JSON.parse(preferences.ask), { version: 1, connectionId: "connection-a", model: "reasoning-model", models: { "connection-a": ["reasoning-model"] }, images: false, textAttachments: { chars: 50_000, totalChars: 100_000 }, compaction: { highWaterTokens: 220_000 }, preference: "先说结论", words: ["soft light", "new topic", "自由设定"], replacements: [{ from: "red coat", to: "blue dress" }], alwaysCodec: true });
  const restored = validateBackupManifest({ ...manifest(), preferences: { ask: stored[names.ask], askAdult: "true" } });
  assert.deepEqual(Object.keys(restored.preferences), ["ask"]);
  assert.deepEqual(JSON.parse(restored.preferences.ask).replacements, [{ from: "red coat", to: "blue dress" }]);
  const custom = { ...JSON.parse(preferences.ask), textAttachments: { chars: 80_000, totalChars: 160_000 }, compaction: { highWaterTokens: 96_000 } };
  const roundTrip = validateBackupManifest({ ...manifest(), preferences: { ask: JSON.stringify(custom) } });
  assert.deepEqual(JSON.parse(roundTrip.preferences.ask).textAttachments, custom.textAttachments);
  assert.deepEqual(JSON.parse(roundTrip.preferences.ask).compaction, custom.compaction);
  for (const ask of ["[]", "null", "\"text\""]) assert.throws(() => validateBackupManifest({ ...manifest(), preferences: { ask } }));
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
