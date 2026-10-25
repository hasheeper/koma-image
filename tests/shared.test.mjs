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
test("vault: removing one Key keeps the others, the save mode and the passphrase", async () => {
  const a = vault();
  await a.service.saveEncrypted("key-a", "synthetic-a", "pass-one");
  await a.service.setKey("key-b", "synthetic-b");
  await a.service.removeKey("key-a");
  await a.service.removeKey("key-missing");
  assert.equal(a.service.key("key-a"), null);
  assert.equal(a.service.mode(), "encrypted");
  assert.equal(a.local.getItem(names.vault).includes("synthetic"), false);
  await a.service.lock();
  await assert.rejects(a.service.removeKey("key-b"), /解锁/);
  await a.service.unlock("pass-one");
  assert.deepEqual(a.service.ids(), ["key-b"]);
  const b = vault();
  await b.service.saveSession("key-a", "synthetic-a");
  await b.service.setKey("key-b", "synthetic-b");
  await b.service.removeKey("key-b");
  assert.deepEqual(JSON.parse(b.session.getItem(names.sessionKeys)), {
    "key-a": "synthetic-a",
  });
  assert.equal(b.local.values.size, 0);
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
test("tags: explicit search only, cache, supported bilingual endpoint, English fallback and local pagination", async () => {
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
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].name, "tag_25");
  assert.equal(p.hasNext, false);
  const url = new URL(calls.at(-1));
  assert.equal(url.pathname, "/api/tags/suggest");
  assert.equal(url.searchParams.get("q"), "page");
  assert.equal(url.searchParams.has("offset"), false);
  assert.equal(url.searchParams.has("limit"), false);
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

test("tags: autocomplete, picker and dictionary share the 30-candidate snapshot without repeated pages", async () => {
  const calls = [];
  const rows = Array.from({ length: 30 }, (_, i) => ({
    name: `blue_tag_${i}`, cn_name: `蓝色标签 ${i}`, category: 0, count: 30 - i,
  }));
  const tags = createTagSearch(() => [0], async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(JSON.stringify({ results: rows }));
  });
  const suggestions = await tags.suggest("blue hair", { limit: 20, broad: true });
  assert.equal(suggestions.length, 20);
  assert.equal((await tags.suggest("blue hair", { limit: 30, broad: true })).length, 30);
  const first = await tags.page("blue hair"),
    second = await tags.page("blue hair", { page: 2 }),
    last = await tags.page("blue hair", { page: 3 });
  assert.equal(first.items.length, 25);
  assert.equal(first.hasNext, true);
  assert.equal(second.items.length, 5);
  assert.equal(second.hasNext, false);
  assert.equal(last.items.length, 0);
  assert.equal(last.hasNext, false);
  assert.equal(new Set([...first.items, ...second.items].map((v) => v.name)).size, 30);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/tags/suggest");
  assert.equal(calls[0].url.searchParams.get("q"), "blue_hair");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  first.items[0].name = "mutated";
  assert.equal((await tags.page("blue hair")).items[0].name, rows[0].name);
});

test("tags: Chinese network failures and timeouts are readable; cancellation never retries or falls back", async () => {
  let calls = 0;
  const unavailable = createTagSearch(() => [0], async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(unavailable.suggest("蓝发", { broad: true }), /Tag 服务暂时不可用/);
  assert.equal(calls, 2, "one network retry, no Chinese official fallback");
  calls = 0;
  const timedOut = createTagSearch(() => [0], async () => {
    calls++;
    throw new DOMException("timed out", "TimeoutError");
  });
  await assert.rejects(timedOut.page("蓝发"), /Tag 查询超时/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  calls = 0;
  const cancelled = createTagSearch(() => [0], async (_url, { signal }) => {
    calls++;
    started();
    await new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const result = cancelled.suggest("blue", { signal: controller.signal });
  await waiting;
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(calls, 1);
  const invalid = createTagSearch(() => [0], async () => new Response("<html>upstream error</html>"));
  await assert.rejects(invalid.suggest("蓝发"), /Tag 词典返回格式异常/);
});
const diagnosticContext = (extra = {}) => ({
  connection: {
    baseUrl: "https://gateway.example.test",
    profileId: "koma-standard-v1",
  },
  key: () => "synthetic-key",
  assertCurrent() {},
  ...extra,
});
const reply = (status, body) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const timedOut = () => new DOMException("timed out", "TimeoutError");
// Answers the CORS request, and the no-cors probe when there is one.
function diagnosticFetch(answer, probe = () => new Response("")) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const value = init.mode === "no-cors" ? probe() : answer();
    if (value instanceof Error) throw value;
    return value;
  };
  return { fetch, calls };
}
const supported = {
  studio_features: { version: 2, max_cost: true },
  models: { "gpt-image-2": {}, "custom-image": {} },
};
test("connection diagnostic: a supported gateway is usable and the Key goes only in the CORS request", async () => {
  const f = diagnosticFetch(() => reply(200, supported));
  const result = await testConnection(diagnosticContext(), f.fetch);
  assert.deepEqual(result, { s: "ok", text: "可用，共 2 个模型" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://gateway.example.test/v1/image/models");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer synthetic-key");
  assert.equal(f.calls[0].init.credentials, "omit");
  assert.equal(f.calls[0].init.redirect, "error");
});
test("connection diagnostic: each failure says what to fix", async () => {
  const cases = [
    [() => reply(401, { error: "bad key" }), "err", "Key 无效"],
    [() => reply(403, { error: "forbidden" }), "err", "访问被拒绝（403），请检查 Key 权限"],
    [() => reply(404, "Not Found"), "err", "地址错误"],
    [() => reply(200, "<html>a page</html>"), "err", "地址错误"],
    [() => reply(429, { error: "slow down" }), "err", "请求失败（429）"],
    [() => reply(502, "Bad Gateway"), "warn", "供应商暂时不可用（502）"],
    [() => reply(200, {}), "err", "该地址不支持所需的网关报价保护协议"],
    [
      () => reply(200, { models: supported.models }),
      "err",
      "该地址不支持所需的网关报价保护协议",
    ],
    [
      () =>
        reply(200, {
          ...supported,
          studio_features: { version: 1, max_cost: true },
        }),
      "err",
      "该地址不支持所需的网关报价保护协议",
    ],
    [() => timedOut(), "warn", "连接超时"],
  ];
  for (const [answer, s, text] of cases) {
    const result = await testConnection(
      diagnosticContext(),
      diagnosticFetch(answer).fetch,
    );
    assert.deepEqual([result.s, result.text], [s, text]);
  }
});
test("connection diagnostic: a refused request is told apart from an unreachable host, and the probe carries no Key", async () => {
  const refused = diagnosticFetch(() => new TypeError("Failed to fetch"));
  assert.equal(
    (await testConnection(diagnosticContext(), refused.fetch)).text,
    "该地址不允许网页直接调用，可改用本地代理",
  );
  assert.equal(refused.calls.length, 2);
  assert.equal(refused.calls[1].init.mode, "no-cors");
  assert.equal(refused.calls[1].init.headers, undefined);
  const down = diagnosticFetch(
    () => new TypeError("Failed to fetch"),
    () => new TypeError("Failed to fetch"),
  );
  const result = await testConnection(diagnosticContext(), down.fetch);
  assert.deepEqual([result.s, result.text], ["err", "网络不可达或域名错误"]);
});
test("connection diagnostic: the local proxy uses its token, never a Key, and is not probed", async () => {
  const context = diagnosticContext({
    connection: {
      baseUrl: "http://127.0.0.1:3217/api",
      profileId: "koma-standard-v1",
    },
    localToken: "synthetic-token",
    key: () => assert.fail("the local proxy must not read a Key"),
  });
  const ok = diagnosticFetch(() => reply(200, supported));
  assert.equal((await testConnection(context, ok.fetch)).s, "ok");
  assert.equal(
    ok.calls[0].init.headers["X-Koma-Local-Token"],
    "synthetic-token",
  );
  assert.equal(ok.calls[0].init.headers.Authorization, undefined);
  const down = diagnosticFetch(() => new TypeError("Failed to fetch"));
  assert.equal(
    (await testConnection(context, down.fetch)).text,
    "本地代理连接失败，请检查服务端配置",
  );
  assert.equal(down.calls.length, 1);
});
test("connection diagnostic: a connection changed during the request reports the change, not a result", async () => {
  let checks = 0;
  const context = diagnosticContext({
    assertCurrent() {
      if (++checks > 1) throw new Error("连接或 Key 已改变，请重新操作");
    },
  });
  await assert.rejects(
    testConnection(context, diagnosticFetch(() => reply(401, {})).fetch),
    /改变/,
  );
});

test('tags: fallback failures distinguish an empty primary index from two unavailable sources', async()=>{
  const empty=createTagSearch(()=>[0],async url=>{
    if(url.hostname==='danbooru.donmai.us')throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({results:[]}));
  });
  await assert.rejects(empty.suggest('hair buns'),/中英词典未命中.*Danbooru.*暂时不可用/);
  const down=createTagSearch(()=>[0],async url=>{
    if(url.hostname==='danbooru.donmai.us')return new Response('',{status:503});
    throw new DOMException('timed out','TimeoutError');
  });
  await assert.rejects(down.suggest('two buns'),/中英词典.*超时.*Danbooru.*503/);
});

test('tags: body timeouts, cancellation and network errors keep their cause instead of becoming malformed JSON',async t=>{
  const timeout=new AbortController();
  t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,8000);return timeout.signal;});
  const fetcher=async(_url,options)=>new Response(new ReadableStream({start(c){
    options.signal.addEventListener('abort',()=>c.error(options.signal.reason),{once:true});
    queueMicrotask(()=>timeout.abort(new DOMException('timed out','TimeoutError')));
  }}));
  await assert.rejects(createTagSearch(()=>[0],fetcher).suggest('蓝发'),/Tag 查询超时/);
  t.mock.restoreAll();
  const cancel=new AbortController();
  const waiting=createTagSearch(()=>[0],async(_url,options)=>new Response(new ReadableStream({start(c){
    options.signal.addEventListener('abort',()=>c.error(options.signal.reason),{once:true});
    queueMicrotask(()=>cancel.abort(new DOMException('已停止','AbortError')));
  }})));
  await assert.rejects(waiting.suggest('蓝发',{signal:cancel.signal}),{name:'AbortError'});
  const disconnected=createTagSearch(()=>[0],async()=>new Response(new ReadableStream({start(c){c.error(new TypeError('connection reset'));}})));
  await assert.rejects(disconnected.suggest('蓝发'),/Tag 服务暂时不可用/);
  const malformed=createTagSearch(()=>[0],async()=>new Response('{broken'));
  await assert.rejects(malformed.suggest('蓝发'),/Tag 词典返回格式异常/);
});

test("Furry suggestions use the public NAI vocabulary, isolate caches and never fall back to Anime", async () => {
  const calls = [];
  let status = 200;
  const tags = createTagSearch(() => [3], async (url, init) => {
    calls.push({ url, init });
    return url.hostname === "image.novelai.net"
      ? Response.json({ tags: [{ tag: "wolf", count: 123 }, { tag: "wolf", count: 123 }, { tag: "wolf tail", count: 42 }] }, { status })
      : Response.json({ results: [{ name: "wolf_character", count: 456, category: 3 }] });
  });
  assert.equal((await tags.suggest("wolf"))[0].name, "wolf_character");
  const furry = await tags.suggest("wolf", { dataset: "furry" });
  assert.deepEqual(furry.map(t => t.name), ["wolf", "wolf tail"]);
  assert.ok(furry.every(t => t.source === "nai-furry"));
  assert.equal(calls[1].url.href, "https://image.novelai.net/ai/generate-image/suggest-tags?model=nai-diffusion-furry-3&prompt=wolf");
  assert.equal(calls[1].init.credentials, "omit"); assert.equal(calls[1].init.headers.Authorization, undefined);
  await tags.suggest("wolf", { dataset: "furry" }); await tags.suggest("wolf"); assert.equal(calls.length, 2);
  assert.deepEqual((await tags.suggest("wolf", { dataset: "furry", limit: 1 })).map(t => t.name), ["wolf"]);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(tags.suggest("wolf", { dataset: "furry", signal: aborted.signal }), { name: "AbortError" });
  await assert.rejects(tags.suggest("狼", { dataset: "furry" }), /英文/);
  status = 503;
  await assert.rejects(tags.suggest("tail", { dataset: "furry" }), /Furry.*503/);
  assert.equal(calls.at(-1).url.hostname, "image.novelai.net");
});
