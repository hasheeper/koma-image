import test from "node:test";
import assert from "node:assert/strict";
import { createConnections } from "../src/services/connections.ts";
import { createGateway, QuoteUnsupported } from "../src/gateway/client.ts";
import { standardProfile, profileFor, profilePath } from "../src/gateway/profile.ts";
import { apiBase } from "../src/gateway/transport.ts";
import { validateRouting, normalizeBaseUrl, imageConnections, reasoningConnections } from "../src/config/connections.ts";
import { createCostNotice } from "../src/domain/quote.ts";
import { normalizeQuota, quotaGauge, creditBalance } from "../src/domain/quota.ts";
import { normalizeCatalog, sourceState, validateCatalog, selectCatalogSources, modelSource } from "../src/domain/catalog.ts";
import { MODELS } from "../src/domain/models.ts";
import { createQuotePreview } from "../src/services/quote-preview.ts";
import { toNativePayload, toStandardPayload } from "../src/gateway/routes.ts";

const connection = (id = "primary") => ({ id, name: "测试连接", baseUrl: "https://gateway.example.test", profileId: standardProfile.id,
  credentialRef: `key-${id}`, revision: "initial" });
const config = (id = "primary") => ({ version: 1, connections: { [id]: connection(id) }, links: {} });
const raw = { studio_features: { version: 2, max_cost: true, max_context_images: 15 },
  models: { "nai-diffusion-5-full@local": { provider: "novelai", operations: ["generate", "edit"], tools: ["upscale"] } } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
async function setup(fetcher, routing = config(), profile = undefined) {
  const saved = new Map();
  const storage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  const connections = createConnections(storage, async work => work());
  connections.reload();
  await connections.save(routing);
  connections.supplyKey("key-primary", "synthetic-test-key");
  return { connections, saved, gateway: createGateway(connections.context("primary"), fetcher, profile) };
}

test("empty connections cannot communicate; configuration and cache identity never contain keys", async () => {
  const saved = new Map(), connections = createConnections({ getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) }, async fn => fn());
  connections.reload();
  assert.deepEqual(connections.configuration.connections, {});
  assert.throws(() => connections.context("primary"), /配置/);
  await connections.save({ ...config(), secret: "strip", connections: { primary: { ...connection(), key: "strip" } } });
  assert.throws(() => connections.context("primary"), /Key/);
  connections.supplyKey("key-primary", "synthetic-test-key");
  const first = connections.context("primary");
  connections.supplyKey("key-primary", "   ");
  assert.equal(first.key(), "synthetic-test-key");
  assert.ok(!first.cacheKey.includes("synthetic"));
  assert.ok(!JSON.stringify([...saved.values()]).includes("strip"));
  connections.supplyKey("key-primary", "replacement-test-key");
  assert.throws(first.assertCurrent, /改变/);
  assert.notEqual(first.cacheKey, connections.context("primary").cacheKey);
  connections.lock(); assert.throws(() => connections.context("primary"), /Key/);
  connections.supplyKey("key-primary", "synthetic-restored");
  const beforeCorruption = connections.context("primary");
  for (const key of saved.keys()) saved.set(key, "invalid JSON");
  connections.reload();
  assert.throws(beforeCorruption.assertCurrent, /改变/);
  assert.deepEqual(connections.configuration.connections, {});
  for (const url of ["", "https://user:pass@example.test", "http://example.test", "https://example.test?key=x", "javascript:alert(1)"]) assert.throws(() => normalizeBaseUrl(url));
  assert.equal(normalizeBaseUrl("http://127.0.0.1:3216/path/"), "http://127.0.0.1:3216/path");
  assert.equal(apiBase("https://app.example.test/repo/index.html#/chat").pathname, "/repo/api/");
  assert.equal(apiBase("https://app.example.test/").pathname, "/api/");
  assert.throws(() => validateRouting({ ...config(), connections: { primary: { ...connection(), profileId: "unknown" } } }));
});

test("execution requotes the exact snapshot, maps model IDs, and preserves all three routes", async () => {
  const calls = []; let cost = 0;
  const { gateway } = await setup(async (url, init) => {
    calls.push({ path: url.pathname, body: init.body && JSON.parse(init.body), headers: init.headers, redirect: init.redirect });
    if (url.pathname.endsWith("models")) return json(raw);
    if (url.pathname.endsWith("estimate")) return json({ cost });
    return json({ ok: true });
  });
  await gateway.catalog(); await gateway.catalog();
  assert.equal(calls.length, 1, "catalog cached within the context");
  const consume = r => r.json(), payload = { model: "nai-diffusion-5-full", prompt: "  原样  ", seed: 0, cache: false };
  const free = await gateway.execute(payload, consume);
  assert.equal(free.native, true);
  assert.equal(calls.at(-1).path, "/ai/generate-image");
  assert.equal(calls.at(-1).body.max_cost, 0);
  assert.equal(calls.at(-1).body.parameters.seed, 0);
  assert.equal(calls.at(-1).body.input, "  原样  ");
  assert.equal(calls.at(-2).body.model, "nai-diffusion-5-full@local");
  assert.equal(calls.at(-1).headers["X-Media-Provider"], "novelai");
  cost = 2.5;
  const notices = [];
  await gateway.execute(payload, consume, { shownCost: 0, onNotice: text => notices.push(text) });
  assert.equal(calls.at(-1).path, "/v1/studio/image/generate");
  assert.equal(calls.at(-1).body.max_cost, 2.5);
  assert.equal(notices.length, 1);
  cost = 0;
  await gateway.execute({ ...payload, cache: true }, consume);
  assert.equal(calls.at(-1).path, "/v1/studio/image/generate");
  await gateway.execute({ ...payload, tool: "upscale" }, consume);
  assert.equal(calls.at(-2).path, "/v1/image/tools/estimate");
  assert.equal(calls.at(-1).path, "/v1/image/tools/run");
  assert.ok(calls.every(call => call.redirect === "error"));
  assert.equal(payload.max_cost, undefined);
  assert.equal(toNativePayload({ ...payload, prompt: "", seed: -1 }, () => 0.5).parameters.seed, 2147483648);
});

test("C2 standard roles: one snapshot feeds quote, native, Studio and tools without losing negatives or coordinates", async () => {
  const calls=[];let cost=0;
  const {gateway}=await setup(async(url,init)=>{
    calls.push({path:url.pathname,body:init.body&&JSON.parse(init.body)});
    return json(url.pathname.endsWith('models')?raw:url.pathname.endsWith('estimate')?{cost}:{ok:true});
  });
  await gateway.catalog();
  const input={model:'nai-diffusion-5-full',prompt:'2people, outdoors',negative_prompt:'lowres',seed:42,placement:'manual',characters:[
    {id:'c7',on:true,prompt:'girl, red hair',negative:'',centers:[{x:.24,y:.76}]},
    {id:'c3',on:true,prompt:'boy, blue hair',negative:'red hair',centers:[{x:.8,y:.3}]},
    {id:'c4',on:false,prompt:'other, unused',negative:'unused',centers:[]}
  ]};
  const before=structuredClone(input),expected=[{prompt:'girl, red hair',uc:'',center:{x:.24,y:.76}},{prompt:'boy, blue hair',uc:'red hair',center:{x:.8,y:.3}}];
  await gateway.estimate(input);
  const preview=calls.at(-1).body;
  assert.deepEqual(preview.characters,expected);assert.equal(preview.use_coords,true);assert.equal(preview.placement,undefined);
  assert.equal(preview.model,'nai-diffusion-5-full@local');
  await gateway.execute(input,r=>r.json());
  assert.deepEqual(calls.at(-2).body,preview);
  const native=calls.at(-1).body.parameters;
  assert.deepEqual(native.v4_prompt.caption.char_captions,expected.map(c=>({char_caption:c.prompt,centers:[c.center]})));
  assert.deepEqual(native.v4_negative_prompt.caption.char_captions,expected.map(c=>({char_caption:c.uc,centers:[c.center]})));
  assert.equal(native.v4_prompt.use_coords,true);
  cost=3;
  await gateway.execute(input,r=>r.json(),{onQuote:()=>{input.characters[0].negative='later';input.characters[1].centers[0].x=.1;}});
  assert.equal(calls.at(-1).path,'/v1/studio/image/generate');
  assert.deepEqual(calls.at(-2).body,preview);assert.deepEqual(calls.at(-1).body,{...preview,max_cost:3});
  cost=0;
  await gateway.execute({...before,cache:true,placement:'auto'},r=>r.json());
  assert.equal(calls.at(-1).path,'/v1/studio/image/generate');assert.equal(calls.at(-1).body.use_coords,false);assert.deepEqual(calls.at(-1).body.characters,expected);
  await gateway.execute({...before,tool:'img2img',init_image:'synthetic'},r=>r.json());
  assert.equal(calls.at(-1).path,'/v1/image/tools/run');assert.equal(calls.at(-2).path,'/v1/image/tools/estimate');
  assert.deepEqual(calls.at(-1).body.characters,expected);assert.deepEqual(calls.at(-2).body.characters,expected);
  assert.deepEqual(toStandardPayload({...before,characters:[]}),Object.fromEntries(Object.entries(before).filter(([k])=>!['placement','characters'].includes(k))));
  const multi=structuredClone(before);multi.characters[0].centers.push({x:.5,y:.5});
  const count=calls.length;await assert.rejects(gateway.execute(multi,r=>r.json()),/单个位置/);assert.equal(calls.length,count);
  assert.equal(toStandardPayload({...multi,placement:'auto'}).use_coords,false);
  assert.equal(toNativePayload(multi).parameters.v4_prompt.caption.char_captions[0].centers.length,2);
});

test("quote failure/unsupported/changed credentials never become unprotected generation; no retries", async () => {
  for (const bad of [{}, { cost: null }, { cost: "0" }, { cost: -1 }, { error: "quote failed" }]) {
    let count = 0;
    const { gateway } = await setup(async () => { count++; return json(bad); });
    await assert.rejects(gateway.execute({ model: "model" }, r => r.json()));
    assert.equal(count, 1);
  }
  let calls = 0;
  const { connections } = await setup(async () => { calls++; return json({ cost: 0 }); });
  const context = connections.context("primary");
  const unsupported = createGateway(context, async () => { calls++; }, { ...standardProfile, quote: { ...standardProfile.quote, supported: false } });
  await assert.rejects(unsupported.execute({ model: "model" }, r => r.json()), QuoteUnsupported);
  assert.equal(calls, 0);
  const changed = createGateway(context, async () => { calls++; connections.supplyKey("key-primary", "changed"); return json({ cost: 1 }); });
  await assert.rejects(changed.execute({ model: "model" }, r => r.json()), /改变/);
  assert.equal(calls, 1);
  const failed = await setup(async url => { calls++; return url.pathname.endsWith("estimate") ? json({ cost: 3 }) : json({ error: "failure" }, 502); });
  const before = calls;
  await assert.rejects(failed.gateway.execute({ model: "model" }, r => r.json()), /failure/);
  assert.equal(calls - before, 2);
});

test("batch price increases notify once; cancellation during requote prevents submission", async () => {
  const notices = createCostNotice(0, true);
  assert.equal(notices({ cost: 0 }), "");
  assert.match(notices({ cost: 1 }), /之后每张/);
  assert.equal(notices({ cost: 2 }), "");
  const cancellation = new AbortController(); let requests = 0;
  const { gateway } = await setup(async () => { requests++; return json({ cost: 1 }); });
  await assert.rejects(gateway.execute({ model: "model" }, r => r.json(), {
    signal: cancellation.signal, onQuote: () => cancellation.abort(),
  }), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("reservation hook distinguishes pre-submit cancellation and uncertain billing", async () => {
  const outcomes = []; const abort = new AbortController();
  const { gateway } = await setup(async url => url.pathname.endsWith("estimate") ? json({ cost: 3 }) : Promise.reject(new TypeError("offline")));
  const reservation = { taskId: "test", pool: "credits", port: { async reserve() { abort.abort(); return { async finish(outcome) { outcomes.push(outcome); } }; } } };
  await assert.rejects(gateway.execute({ model: "model" }, r => r.json(), { signal: abort.signal, reservation }));
  assert.deepEqual(outcomes, ["not-submitted"]);
  reservation.port.reserve = async () => ({ async finish(outcome) { outcomes.push(outcome); } });
  await assert.rejects(gateway.execute({ model: "model" }, r => r.json(), { reservation }));
  assert.deepEqual(outcomes, ["not-submitted", "uncertain"]);
});

test("wallet semantics and a partial quota status", async () => {
  assert.equal(quotaGauge(null, 100, standardProfile).level, "unknown");
  assert.equal(quotaGauge(0, 100, standardProfile).level, "crit");
  assert.equal(quotaGauge(25, 100, standardProfile).level, "low");
  assert.equal(creditBalance(0).text, "0");
  assert.equal(creditBalance(null).text, "—");
  const { gateway } = await setup(async (url, init) => {
    if (url.pathname.endsWith("token_stats_data")) {
      assert.equal(url.searchParams.get("days"), "1");
      assert.equal(url.searchParams.get("api_key"), "synthetic-test-key");
      assert.equal(init.referrerPolicy, "no-referrer"); return json({ error: "unavailable" }, 503);
    }
    return json({ images: { pool: { used: 500, remaining: 0 } } });
  });
  const partial = await gateway.quota("pool");
  assert.deepEqual([partial.image.remaining, partial.temporary], [0, null]);
});

test("profiles come from a registry; unknown and prototype names are rejected; undeclared paths are refused", () => {
  assert.equal(profileFor("koma-standard-v1"), standardProfile);
  for (const id of ["unknown", "__proto__", "constructor", "toString", ""]) assert.throws(() => profileFor(id), /协议/);
  assert.equal(Object.isFrozen(standardProfile.transport.paths), true);
  const narrow = { ...standardProfile, transport: { ...standardProfile.transport, paths: { native: "/ai/generate-image" } } };
  assert.throws(() => profilePath(narrow, "estimate"), /不支持/);
  assert.equal(profilePath(narrow, "native"), "/ai/generate-image");
  const uncapped = { studio_features: { version: 2 }, models: { model: {} } };
  assert.throws(() => validateCatalog(uncapped, standardProfile), /报价保护/);
  assert.equal(validateCatalog(uncapped, { ...standardProfile, catalog: { minimumVersion: 2, requireCostCeiling: false } }), uncapped);
});

test("a profile without quotes or a cost ceiling executes unquoted; a quoted profile without a ceiling sends no max_cost", async () => {
  const calls = [], quotes = [], reserved = [];
  const fetcher = async (url, init) => {
    calls.push({ path: url.pathname, body: init.body && JSON.parse(init.body), headers: init.headers });
    return url.pathname.endsWith("estimate") ? json({ cost: 0 }) : json({ ok: true });
  };
  const unquoted = { ...standardProfile, id: "test-unquoted", quote: { ...standardProfile.quote, supported: false }, costCeiling: undefined };
  const { gateway } = await setup(fetcher, config(), unquoted);
  const reservation = { taskId: "test", pool: "credits", port: { async reserve(request) { reserved.push(request); return { async finish() {} }; } } };
  const result = await gateway.execute({ model: "nai-diffusion-5-full", seed: 0, cache: false }, r => r.json(), { onQuote: q => quotes.push(q), reservation });
  assert.deepEqual(calls.map(c => c.path), ["/v1/studio/image/generate"]);
  assert.equal("max_cost" in calls[0].body, false);
  assert.equal(result.quote, null);
  assert.equal(result.native, false);
  assert.deepEqual([quotes, reserved], [[], []]);
  await gateway.execute({ model: "model", tool: "upscale" }, r => r.json());
  assert.deepEqual(calls.map(c => c.path), ["/v1/studio/image/generate", "/v1/image/tools/run"]);
  calls.length = 0;
  const quotedOnly = { ...standardProfile, id: "test-quoted", costCeiling: undefined, transport: { ...standardProfile.transport, nativeHeaders: {} } };
  const quoted = (await setup(fetcher, config(), quotedOnly)).gateway;
  const free = await quoted.execute({ model: "nai-diffusion-5-full", seed: 0, cache: false }, r => r.json());
  assert.deepEqual(calls.map(c => c.path), ["/v1/studio/image/estimate", "/ai/generate-image"]);
  assert.equal(free.native, true);
  assert.equal("max_cost" in calls[1].body, false);
  assert.equal(calls[1].headers["X-Media-Provider"], undefined);
  assert.equal(free.quote.cost, 0);
});

test("wallet levels use the profile of the connection the status came from", () => {
  const relaxed = { ...standardProfile, id: "test-relaxed", quotaPresentation: { lowRatio: 0.1, criticalRatio: 0.05 } };
  const status = profile => normalizeQuota(profile, { images: { pool: { used: 500, remaining: 20, limit: 100 } } },
    { temp_limits: { is_temp: true, limited: true, rpd_remaining: 50 } }, "pool");
  assert.equal(status(standardProfile).profile, standardProfile);
  assert.equal(status(standardProfile).temporary.remaining, 50);
  assert.equal(quotaGauge(20, 100, standardProfile).level, "low");
  assert.equal(quotaGauge(20, 100, relaxed).level, "ok");
  assert.equal(quotaGauge(20, 100).level, "unknown");
});

test("catalog auto/manual/disabled mappings and per-model limits preserve the source rules", () => {
  const routing = config();
  const catalog = normalizeCatalog(raw, routing, "primary");
  assert.equal(catalog.models[0].id, "nai-diffusion-5-full");
  routing.links.primary = { "nai-diffusion-5-full": { id: "custom-native", manual: true, on: false } };
  const custom = { ...raw, models: { ...raw.models, "custom-native": { provider: "novelai" } } };
  assert.deepEqual(normalizeCatalog(custom, routing, "primary").models, []);
  assert.equal(sourceState(routing, "primary", MODELS[0], [{ id: "custom-native" }]), "off");
  assert.equal(sourceState(routing, "primary", MODELS[0], []), "gone");
  const lite = normalizeCatalog({ ...raw, models: { "gemini-3.1-flash-lite-image": {
    editor_family: "gemini", image_capabilities: { fields: { image_size: { options: ["1K", "2K", "4K"], default: "4K" } } },
  } } }, config(), "primary").models[0];
  assert.deepEqual(lite.fields.image_size.options, ["1K"]);
  assert.equal(lite.maxImages, 1);
});

test("source priority is independent of availability and follows the saved order", () => {
  const routing = { ...config(), connections: { primary: connection(), secondary: connection("secondary") }, order: ["secondary", "primary"] };
  const id = "nai-diffusion-5-full", identity = MODELS.find(m => m.id === id);
  const catalogs = () => ["primary", "secondary"].flatMap(c => normalizeCatalog(raw, routing, c).models);
  assert.equal(selectCatalogSources(routing, catalogs())[0].connection, "secondary");
  assert.equal(modelSource(routing, { primary: raw, secondary: raw }, identity), "secondary");
  assert.equal(sourceState(routing, "primary", identity, [{ id: "nai-diffusion-5-full@local" }]), "on");
  routing.links.secondary = { [id]: { id: "nai-diffusion-5-full@local", manual: false, on: false } };
  assert.equal(selectCatalogSources(routing, catalogs())[0].connection, "primary");
  delete routing.connections.secondary;
  assert.deepEqual(validateRouting(routing).order, ["primary"]);
});

test("source priority survives reload, completes new connections and invalidates captured contexts", async () => {
  const { connections } = await setup(() => json(raw), { ...config(), connections: { primary: connection(), secondary: connection("secondary") } });
  const before = connections.context("primary"), next = structuredClone(connections.configuration);
  next.order = ["secondary", "primary"];
  await connections.save(next);
  assert.throws(before.assertCurrent, /改变/);
  connections.reload();
  assert.deepEqual(connections.configuration.order, next.order);
  assert.deepEqual(validateRouting({ ...next, order: ["secondary"] }).order, next.order);
  for (const order of [["bad/id"], ["primary", "primary"], "primary"])
    assert.throws(() => validateRouting({ ...next, order }), /优先级/);
  connections.dispose();
});

test("supplier sections are independent: shared supplier interfaces appear on both sides and LLM order stays unchanged", () => {
  const routing = { version: 1, connections: {
    llmA: { ...connection("llmA"), name: "综合供应商", profileId: "openai-chat-v1" },
    imageA: { ...connection("imageA"), name: "综合供应商" },
    llmB: { ...connection("llmB"), profileId: "anthropic-messages-v1" },
    imageB: connection("imageB"),
  }, links: {}, order: ["llmB", "imageB", "imageA", "llmA"] };
  const valid = validateRouting(routing);
  assert.deepEqual(imageConnections(valid).map(c => c.id), ["imageB", "imageA"]);
  assert.deepEqual(reasoningConnections(valid).map(c => c.id), ["llmA", "llmB"]);
  assert.ok(imageConnections(valid).some(c => c.name === "综合供应商"));
  assert.ok(reasoningConnections(valid).some(c => c.name === "综合供应商"));
});

test("local source edits reuse raw metadata but remap models in a fresh execution context", async () => {
  const { connections } = await setup(() => json(raw));
  const shared = {}, calls = [];
  const read = async url => { calls.push(url.pathname); return json(raw); };
  const firstContext = connections.context("primary"), key = connections.catalogKey("primary");
  const first = createGateway(firstContext, read, undefined, shared);
  assert.equal((await first.catalog()).models.length, 1);
  const next = structuredClone(connections.configuration);
  next.links.primary = { "nai-diffusion-5-full": { id: "nai-diffusion-5-full@local", manual: false, on: false } };
  await connections.save(next);
  assert.equal(connections.catalogKey("primary"), key);
  assert.throws(firstContext.assertCurrent, /改变/);
  const second = createGateway(connections.context("primary"), read, undefined, shared);
  assert.equal((await second.catalog()).models.length, 0);
  assert.equal(calls.length, 1, "availability edits need no upstream catalog request");
  await second.rawCatalog(true);
  assert.equal(calls.length, 2, "explicit refresh still requests the catalog");
  connections.dispose();
});

test("image subscriptions ignore labels and text connections, while order, source and Key changes remain observable", async () => {
  const { connections } = await setup(() => json(raw), { ...config(), connections: {
    primary: connection(), secondary: connection("secondary"), text: { ...connection("text"), profileId: "openai-chat-v1" },
  } });
  let changes = 0;
  const stop = connections.subscribeImages(() => changes++);
  const key = connections.catalogKey("primary"), revision = connections.configuration.connections.primary.revision;
  let next = structuredClone(connections.configuration);
  next.connections.primary.name = "新名称";
  next.connections.text.baseUrl = "https://text.example.test";
  await connections.save(next);
  connections.supplyKey("key-text", "synthetic-text");
  assert.equal(changes, 0);
  assert.equal(connections.catalogKey("primary"), key);
  assert.equal(connections.configuration.connections.primary.revision, revision);
  next = structuredClone(connections.configuration); next.order = ["secondary", "primary", "text"];
  await connections.save(next);
  assert.equal(changes, 1);
  next = structuredClone(connections.configuration);
  next.links.primary = { "nai-diffusion-5-full": { id: "nai-diffusion-5-full@local", manual: false, on: false } };
  await connections.save(next);
  assert.equal(changes, 2);
  await connections.save(connections.configuration);
  assert.equal(changes, 2, "saving unchanged settings is a no-op");
  connections.supplyKey("key-primary", "synthetic-updated");
  assert.equal(changes, 3);
  assert.notEqual(connections.catalogKey("primary"), key);
  connections.reload();
  assert.equal(changes, 4, "an explicit reload still refreshes image connections");
  stop(); connections.dispose();
});

test("preview debounce invalidates late responses and retains the old displayed price", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const states = [], pending = [];
  const preview = createQuotePreview(standardProfile, "image", (payload, signal) => new Promise((resolve, reject) => pending.push({ payload, signal, resolve, reject })), state => states.push(state));
  preview.update({ seed: 0 }); t.mock.timers.tick(649); assert.equal(pending.length, 0);
  t.mock.timers.tick(1); assert.equal(pending.length, 1);
  preview.update({ seed: 1 }); assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ cost: 99 }); await Promise.resolve(); assert.equal(preview.state.status, "loading");
  t.mock.timers.tick(650); pending[1].resolve({ cost: 0 }); await Promise.resolve();
  assert.equal(preview.state.quote.cost, 0);
  preview.update({ seed: 2 }); assert.equal(preview.state.quote.cost, 0);
  t.mock.timers.tick(650); pending[2].reject(new Error("failed")); await Promise.resolve();
  assert.equal(preview.state.status, "error"); assert.equal(preview.state.quote.cost, 0);
  preview.update({ seed: 3 }); preview.dispose(); t.mock.timers.tick(650);
  assert.equal(pending.length, 3);
  assert.equal(standardProfile.quote.debounce.chat, 650); assert.equal(standardProfile.quote.debounce.editor, 400);
});
