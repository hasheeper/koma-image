import test from "node:test";
import assert from "node:assert/strict";
import { backupFormat, backupLimits, validateBackupManifest, validateConversation, collectBackupPreferences } from "../src/storage/backup-schema.ts";
import { names } from "../src/storage/names.ts";
import { newConversation, contextSnapshot, beginTurn } from "../src/domain/conversation.ts";

const manifest = () => ({ app: "koma-image", kind: "backup", version: 2, id: "12345678-1234-1234-1234-123456789012",
  createdAt: new Date(0).toISOString(), favorites: [], conversations: [], assets: [], preferences: {} });
const favorite = () => ({ id: "one", createdAt: 0, favoritedAt: 1, params: {}, size: { width: 1, height: 1 }, image: { path: "favorites/0.png", type: "image/png" }, thumbnail: null });

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
  const row={...favorite(),favSeq:3,entity_key,lineage:{via:'edit:photopea',parent_record_id:'parent',parent_entity_key:entity_key,parent_ref}};
  const imageIdentity={version:1,state:{libraryId:'library',nextFavSeq:4},registrations:[{seq:1,recordId:'removed',entity_key,active:false},{seq:3,recordId:'one',entity_key,active:true}]};
  const read=()=>validateBackupManifest({...manifest(),favorites:[row],imageIdentity});
  assert.deepEqual(read().favorites[0].lineage.parent_ref,parent_ref);
  imageIdentity.version=2;assert.throws(read);imageIdentity.version=1;
  imageIdentity.registrations[0].active=true;assert.throws(read);imageIdentity.registrations[0].active=false;
  row.lineage.parent_ref={...parent_ref,scope:{kind:'page',id:''}};assert.throws(read);
  row.lineage.parent_ref={...parent_ref,entity_key:'unverified'};assert.throws(read);
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
  assert.deepEqual(JSON.parse(preferences.ask), { version: 1, connectionId: "connection-a", model: "reasoning-model", models: { "connection-a": ["reasoning-model"] }, images: false, responseMode: "text", textAttachments: { chars: 50_000, totalChars: 100_000 }, compaction: { highWaterTokens: 220_000 }, preference: "先说结论", words: ["soft light", "new topic", "自由设定"], wordEncoding: "alias", replacements: [{ from: "red coat", to: "blue dress" }], alwaysCodec: true });
  const restored = validateBackupManifest({ ...manifest(), preferences: { ask: stored[names.ask], askAdult: "true" } });
  assert.deepEqual(Object.keys(restored.preferences), ["ask"]);
  assert.deepEqual(JSON.parse(restored.preferences.ask).replacements, [{ from: "red coat", to: "blue dress" }]);
  const custom = { ...JSON.parse(preferences.ask), responseMode: "tool", wordEncoding: "unicode", textAttachments: { chars: 80_000, totalChars: 160_000 }, compaction: { highWaterTokens: 96_000 } };
  const roundTrip = validateBackupManifest({ ...manifest(), preferences: { ask: JSON.stringify(custom) } });
  assert.deepEqual(JSON.parse(roundTrip.preferences.ask).textAttachments, custom.textAttachments);
  assert.deepEqual(JSON.parse(roundTrip.preferences.ask).compaction, custom.compaction);
  assert.equal(JSON.parse(roundTrip.preferences.ask).responseMode, "tool");
  assert.equal(JSON.parse(roundTrip.preferences.ask).wordEncoding, "unicode");
  for (const ask of ["[]", "null", "\"text\""]) assert.throws(() => validateBackupManifest({ ...manifest(), preferences: { ask } }));
});

test("manifest rejects duplicate records, missing referenced assets, and unsafe image references", () => {
  const row = favorite();
  assert.throws(() => validateBackupManifest({ ...manifest(), favorites: [row, row] }));
  for (const path of ["../outside.png", "favorites/../outside.png", "https://example.test/img.png"]) {
    assert.throws(() => validateBackupManifest({ ...manifest(), favorites: [{ ...row, image: { ...row.image, path } }] }));
  }
  const c = { ...newConversation(), id: "conversation", title: "草稿", prompt: "text", attachments: ["missing"] };
  assert.throws(() => validateBackupManifest({ ...manifest(), conversations: [c] }));
  const asset = { id: "a".repeat(64), width: 1, height: 1, name: "synthetic", origin: "result", image: { path: "assets/0.png", type: "image/png" } };
  c.attachments = [asset.id];
  const result = validateBackupManifest({ ...manifest(), conversations: [c], assets: [asset] });
  assert.equal(result.conversations[0].prompt, "text");
  assert.throws(() => validateBackupManifest({ ...manifest(), assets: [asset, asset] }));
});

test("favorite metadata must provide renderable dimensions, parameters and timestamps", () => {
  const valid = favorite();
  assert.deepEqual(validateBackupManifest({ ...manifest(), favorites: [valid] }).favorites[0].size, valid.size);
  for (const field of ["size", "params", "createdAt", "favoritedAt"]) {
    const row = structuredClone(valid); delete row[field];
    assert.throws(() => validateBackupManifest({ ...manifest(), favorites: [row] }));
  }
  for (const change of [{ size: { width: 0, height: 1 } }, { size: { width: 1.5, height: 1 } }, { params: [] }, { createdAt: -1 }, { favoritedAt: Infinity }]) {
    assert.throws(() => validateBackupManifest({ ...manifest(), favorites: [{ ...valid, ...change }] }));
  }
});

test("CHAT backups accept actual domain records and reject broken versions, snapshots and branch graphs", () => {
  const c = newConversation({ model: "custom" });
  const first = beginTurn(c, contextSnapshot(c, "first"), "first", c.settings);
  first.version.status = "done"; first.version.blocks = [{ type: "text", text: "ok" }];
  c.headId = first.turn.id;
  const second = beginTurn(c, contextSnapshot(c, "second"), "second", c.settings);
  second.version.via = { connection: "test", upstreamId: "a".repeat(512) };
  c.headId = second.turn.id;
  assert.deepEqual(validateConversation(c), c);
  assert.equal(validateBackupManifest({ ...manifest(), conversations: [c] }).conversations.length, 1);
  const changes = [
    row => { delete row.baseFollows; },
    row => { row.headId = "missing"; },
    row => { row.turns[0].selectedVersion = 1; },
    row => { row.turns[0].versions = []; },
    row => { row.turns[1].versions[0].id = row.turns[0].versions[0].id; },
    row => { row.turns[0].snapshot.dropped = 0; },
    row => { delete row.turns[0].snapshot.text; },
    row => { row.turns[0].parentId = "missing"; },
    row => { row.turns[0].parentId = row.turns[1].id; },
    row => { row.turns[0].snapshot.turnIds = [row.turns[0].id]; },
    row => { row.turns[1].snapshot.parentId = "missing"; },
  ];
  for (const change of changes) {
    const row = structuredClone(c); change(row);
    assert.throws(() => validateConversation(row));
  }
});
