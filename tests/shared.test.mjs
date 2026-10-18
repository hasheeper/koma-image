import { test } from "node:test";
import assert from "node:assert/strict";
import { createVault, PBKDF2_ITERATIONS } from "../src/services/vault.ts";
import { names } from "../src/storage/names.ts";
import { createArchive, readArchive } from "../src/storage/backup-archive.ts";
import { readBackup, hashImage } from "../src/services/backup.ts";
import { createTagSearch } from "../src/services/tag-search.ts";
import {
  fragmentAtCaret,
  insertTag,
  togglePromptTag,
  combinedPrompt,
  readCart,
  rankTags,
} from "../src/domain/tags.ts";
import { render } from "../src/domain/highlight.ts";
import { testConnection } from "../src/gateway/connection-test.ts";
const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k),
  };
};
const vault = (local = memory(), session = memory(), extra = {}) => ({
  local,
  session,
  service: createVault({ local, session, write: async (f) => f(), ...extra }),
});

test("vault: encrypted multi-key persistence, wrong password, empty replacement, salt rotation and session resume", async () => {
  const a = vault();
  await a.service.saveEncrypted("key-a", "synthetic-a", "pass-one");
  await a.service.setKey("key-b", "synthetic-b");
  await a.service.setKey("key-a", "  ");
  const sealed = JSON.parse(a.local.getItem(names.vault));
  assert.equal(sealed.iterations, PBKDF2_ITERATIONS);
  assert.equal(sealed.kdf, "PBKDF2-SHA256");
  assert.equal(a.local.getItem(names.vault).includes("synthetic"), false);
  assert.equal(a.service.key("key-a"), "synthetic-a");
  assert.equal(a.session.getItem(names.sessionKeys), null);
  const b = vault(a.local, a.session);
  assert.equal(await b.service.resume(), true);
  assert.equal(b.service.key("key-b"), "synthetic-b");
  await b.service.lock();
  await assert.rejects(b.service.unlock("wrong"), /口令/);
  assert.equal(b.service.isUnlocked(), false);
  await b.service.unlock("pass-one");
  await b.service.changePassphrase("pass-two");
  assert.notEqual(JSON.parse(a.local.getItem(names.vault)).salt, sealed.salt);
  await b.service.lock();
  await assert.rejects(b.service.unlock("pass-one"), /口令/);
  await b.service.unlock("pass-two");
  await b.service.forget();
  assert.equal(a.local.getItem(names.vault), null);
  assert.equal(b.service.isUnlocked(), false);
  a.service.dispose();
  b.service.dispose();
});
test("vault: session mode avoids local secrets and disposal cannot revive an in-flight encryption", async () => {
  const a = vault();
  await a.service.saveSession("key-a", "synthetic-session");
  assert.equal(a.local.values.size, 0);
  const b = vault(a.local, a.session);
  await b.service.resume();
  assert.equal(b.service.key("key-a"), "synthetic-session");
  const fresh = vault();
  const pending = fresh.service.saveEncrypted(
    "key-a",
    "synthetic",
    "passphrase",
  );
  await new Promise((resolve) => setImmediate(resolve));
  fresh.service.dispose();
  await assert.rejects(pending, /关闭/);
  assert.equal(fresh.service.isUnlocked(), false);
  assert.equal(fresh.local.values.size, 0);
  assert.equal(fresh.session.values.size, 0);
  a.service.dispose();
  b.service.dispose();
});
test("vault: lock waits for task gate; late peer share cannot reopen the locked session", async () => {
  let release, entered;
  const ready = new Promise((r) => (entered = r)),
    hold = new Promise((r) => (release = r));
  const channel = new EventTarget();
  channel.postMessage = () => {};
  const a = vault(undefined, undefined, {
    channel,
    locks: {
      request: async (_n, _o, fn) => {
        entered();
        await hold;
        return fn();
      },
    },
  });
  await a.service.saveSession("key-a", "synthetic");
  const pending = a.service.lock();
  await ready;
  assert.equal(a.service.isUnlocked(), true);
  channel.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "vault/share", mode: "session", keys: { "key-a": "late" } },
    }),
  );
  release();
  await pending;
  await new Promise((r) => setImmediate(r));
  assert.equal(a.service.isUnlocked(), false);
  a.service.dispose();
});
const envelope = (changes = {}) => ({
  app: "koma-image",
  kind: "backup",
  version: 2,
  id: "12345678-1234-1234-1234-123456789012",
  createdAt: "2026-10-19T00:00:00Z",
  favorites: [],
  conversations: [],
  assets: [],
  preferences: {},
  ...changes,
});
const archive = (manifest, entries = []) =>
  createArchive([
    ["koma-image-backup.json", new Blob([JSON.stringify(manifest)])],
    ...entries,
  ]);
test("backup ZIP: original bytes, CRC verification, SHA256 verification and unsupported envelopes rejected", async () => {
  const bytes = new Uint8Array([0, 128, 255, 10]),
    blob = new Blob([bytes], { type: "image/png" }),
    id = await hashImage(blob);
  const manifest = envelope({
    favorites: [
      { id: "fav", image: { path: "favorites/0.png", type: "image/png" } },
    ],
    assets: [
      {
        id,
        name: "test",
        origin: "image",
        width: 1,
        height: 1,
        image: { path: "assets/0.png", type: "image/png" },
      },
    ],
  });
  const zip = await archive(manifest, [
    ["favorites/0.png", blob],
    ["assets/0.png", blob],
  ]);
  const result = await readBackup(zip);
  assert.deepEqual(
    new Uint8Array(await result.favorites[0].blob.arrayBuffer()),
    bytes,
  );
  const corrupted = new Uint8Array(await zip.arrayBuffer());
  const offset = corrupted.findIndex((_, i) =>
    bytes.every((v, j) => corrupted[i + j] === v),
  );
  assert.ok(offset > 0);
  corrupted[offset] ^= 1;
  await assert.rejects(readBackup(new Blob([corrupted])), /校验|损坏|不完整/);
  manifest.assets[0].id = "0".repeat(64);
  await assert.rejects(
    readBackup(
      await archive(manifest, [
        ["favorites/0.png", blob],
        ["assets/0.png", blob],
      ]),
    ),
    /校验/,
  );
  for (const invalid of [
    { version: 1 },
    { app: "other-app" },
    { kind: "routing" },
  ])
    await assert.rejects(
      readBackup(await archive(envelope(invalid))),
      /不受支持|新版/,
    );
  await assert.rejects(readArchive(new Blob(["not a ZIP"])), /ZIP|损坏|备份/);
});
test("tags: text preserving insertion, weights, normalization and escaped highlight markup", () => {
  assert.deepEqual(fragmentAtCaret("a, {blue h}", 10), {
    query: "blue h",
    start: 4,
    end: 10,
  });
  assert.equal(
    insertTag("a, {blue h}", 10, 10, "blue_hair").value,
    "a, {blue hair}",
  );
  assert.equal(
    togglePromptTag("first,\nblue hair, last", "blue_hair").value,
    "first,\nlast",
  );
  assert.equal(
    togglePromptTag("first\nline,   ", "blue_hair").value,
    "first\nline, blue hair",
  );
  assert.equal(
    combinedPrompt(
      readCart([
        { name: "blue_hair", weight: 1.4 },
        { name: "blue_hair", weight: 1 },
      ]),
    ),
    "1.4::blue hair::",
  );
  const html = render("<script>alert(1)</script>, {blue hair}");
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;"));
  assert.match(html, /span/);
  assert.deepEqual(
    rankTags(
      [
        { name: "blue", cnName: "", category: 0, count: 1 },
        { name: "blue_hair", cnName: "", category: 0, count: 9 },
        { name: "artist", cnName: "", category: 1, count: 99 },
      ],
      "blue",
      [0],
      20,
    ).map((t) => t.name),
    ["blue_hair", "blue"],
  );
});
test("tags: explicit search only, cache, Chinese no fallback, English fallback and pagination probe", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        results: Array.from({ length: 26 }, (_, i) => ({
          name: `tag_${i}`,
          category: 0,
          count: 30 - i,
        })),
      }),
    );
  };
  const tags = createTagSearch(() => [0, 3, 4], fetcher);
  assert.equal(calls.length, 0);
  assert.equal(
    (await tags.suggest("blue", { limit: 20, broad: true })).length,
    20,
  );
  await tags.suggest("blue", { limit: 20, broad: true });
  assert.equal(calls.length, 1);
  const p = await tags.page("page", { page: 2 });
  assert.equal(p.items.length, 25);
  assert.equal(p.hasNext, true);
  assert.match(calls.at(-1), /offset=25/);
  assert.match(calls.at(-1), /limit=26/);
  const fallback = [];
  const empty = createTagSearch(
    () => [0],
    async (url) => {
      fallback.push(String(url));
      return new Response(
        JSON.stringify(
          String(url).includes("danbooru")
            ? [{ value: "blue_hair", category: 0, post_count: 1 }]
            : { results: [] },
        ),
      );
    },
  );
  assert.deepEqual(await empty.suggest("蓝发"), []);
  assert.equal(fallback.length, 1);
  assert.equal((await empty.suggest("blue"))[0].name, "blue_hair");
  assert.equal(fallback.length, 3);
});
test("connection diagnostic distinguishes auth/protocol/network and never sends a Key in no-cors probe", async () => {
  const context = {
    connection: {
      baseUrl: "https://gateway.example.test",
      profileId: "koma-standard-v1",
    },
    key: () => "synthetic-key",
    assertCurrent() {},
  };
  assert.match(
    (
      await testConnection(
        context,
        async () => new Response("", { status: 401 }),
      )
    ).text,
    /Key 无效/,
  );
  assert.match(
    (await testConnection(context, async () => new Response("{}"))).text,
    /报价保护/,
  );
  let calls = 0;
  const result = await testConnection(context, async (_url, options) => {
    calls++;
    if (calls === 1) throw new TypeError("network");
    assert.equal(options.headers, undefined);
    return new Response("");
  });
  assert.match(result.text, /不允许网页/);
  assert.equal(calls, 2);
});
