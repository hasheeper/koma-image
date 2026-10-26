import test from "node:test";
import assert from "node:assert/strict";
import { createConnections } from "../src/services/connections.ts";
import { createGateway, QuoteUnsupported } from "../src/gateway/client.ts";
import { endpoint } from "../src/gateway/transport.ts";
import { testConnection } from "../src/gateway/connection-test.ts";
import { openaiImagesProfile as oai, geminiProfile as gemini, novelaiProfile as nai, NOVELAI_IMAGE_URL } from "../src/gateway/profile.ts";
import { validateRouting } from "../src/config/connections.ts";
import { novelaiUsage } from "../src/domain/quota.ts";
import { quoteLabel } from "../src/domain/quote.ts";
import { buildChatPayload } from "../src/domain/media.ts";

const json = data => Response.json(data);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGRkAAAAASUVORK5CYII=";
async function setup(profile, fetcher, baseUrl = "https://gateway.example.test/prefix") {
  const store = new Map(), connections = createConnections({ getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) }, work => work());
  const routing = { version: 1, connections: { test: { id: "test", name: "测试连接", baseUrl: profile === nai ? NOVELAI_IMAGE_URL : baseUrl, profileId: profile.id, credentialRef: "key-test", revision: "r1" } }, links: {} };
  await connections.save(routing);
  connections.supplyKey("key-test", "synthetic-native-key");
  const context = connections.context("test");
  return { gateway: createGateway(context, fetcher), context, connections, routing };
}

test("native protocols: explicit profiles, prefix normalization, safe model path and fixed official NAI host", async () => {
  assert.equal(endpoint("https://gateway.example.test/oai/v1", "/models", oai).href, "https://gateway.example.test/oai/v1/models");
  assert.equal(endpoint("https://gateway.example.test/google/v1beta", gemini.transport.paths.generate, gemini, "gemini-2.5-flash-image").pathname, "/google/v1beta/models/gemini-2.5-flash-image:generateContent");
  for (const id of ["../private", "models/a", "x?key=a", "x#fragment", "https://other.test"])
    assert.throws(() => endpoint("https://gateway.example.test", gemini.transport.paths.generate, gemini, id), /模型 ID/);
  const { routing } = await setup(nai, () => { throw new Error("no request expected"); });
  for (const path of [nai.transport.paths.catalog, nai.transport.paths.quota])
    assert.equal(endpoint(routing.connections.test.baseUrl, path, nai).href, "https://image.novelai.net/user/subscription");
  routing.connections.test.baseUrl = "https://gateway.example.test";
  assert.throws(() => validateRouting(routing), /固定/);
});

test("OpenAI Images: authenticated catalog, JSON generation, multipart reference bytes and no gateway charge fields", async () => {
  const calls = [];
  const { gateway, context } = await setup(oai, async (url, init) => {
    calls.push({ url, init });
    return url.pathname.endsWith("/models") ? json({ data: [{ id: "gpt-image-1.5" }, { id: "text-only" }] }) : json({ data: [{ b64_json: "synthetic-result" }] });
  }, "https://gateway.example.test/oai/v1");
  const catalog = await gateway.catalog();
  assert.equal(catalog.models.length, 1);
  const model = catalog.models[0];
  assert.equal(model.chat, true);
  assert.equal(model.profileId, oai.id);
  const generated = await gateway.execute(buildChatPayload(model, "exact prompt", {}), r => r.json());
  assert.equal(generated.quote, null);
  assert.equal(quoteLabel(generated.quote), "费用未知");
  let request = calls.at(-1);
  assert.equal(request.url.pathname, "/oai/v1/images/generations");
  assert.equal(request.init.headers.Authorization, "Bearer synthetic-native-key");
  assert.deepEqual(JSON.parse(request.init.body), { model: "gpt-image-1.5", prompt: "exact prompt", n: 1, size: "auto", quality: "auto", output_format: "png" });
  await gateway.execute(buildChatPayload(model, "edit prompt", {}, [png, png]), r => r.json());
  request = calls.at(-1);
  assert.equal(request.url.pathname, "/oai/v1/images/edits");
  assert.ok(request.init.body instanceof FormData);
  assert.equal(request.init.headers["Content-Type"], undefined);
  assert.equal(request.init.body.getAll("image[]").length, 2);
  assert.deepEqual(Buffer.from(await request.init.body.get("image[]").arrayBuffer()), Buffer.from(png.split(",")[1], "base64"));
  assert.equal(request.init.body.has("max_cost"), false);
  assert.equal(request.init.body.has("cache"), false);
  const before = calls.length;
  assert.equal((await gateway.quota()).temporary, null);
  await assert.rejects(gateway.estimate({ model: model.id }), QuoteUnsupported);
  assert.equal(calls.length, before);
  const result = await testConnection(context, async () => json({ data: [{ id: model.id }] }));
  assert.equal(result.s, "ok");
});

test("Gemini native: one model-list request, API-key header, ordered inline references and generation settings", async () => {
  const calls = [];
  const { gateway } = await setup(gemini, async (url, init) => {
    calls.push({ url, init });
    if (url.pathname.endsWith("/models")) return json({ models: [{ name: "models/text-model" }, { name: "models/gemini-3-pro-image-preview", displayName: "Image model" }], nextPageToken: "repeated-token" });
    return json({ candidates: [{ content: { parts: [{ text: "caption" }, { inlineData: { mimeType: "image/png", data: "result" } }] } }] });
  }, "https://gateway.example.test/google");
  const { models } = await gateway.catalog();
  assert.equal(models.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("pageSize"), "1000");
  assert.equal(calls[0].url.searchParams.has("pageToken"), false);
  assert.deepEqual(Object.keys((await gateway.rawCatalog()).models), ["text-model", "gemini-3-pro-image-preview"]);
  const payload = buildChatPayload(models[0], "keep original text", { aspect_ratio: "16:9", image_size: "2K" }, [png]);
  const output = await gateway.execute(payload, r => r.json());
  const request = calls.at(-1), body = JSON.parse(request.init.body);
  assert.equal(request.url.pathname, "/google/v1beta/models/gemini-3-pro-image-preview:generateContent");
  assert.equal(request.init.headers["x-goog-api-key"], "synthetic-native-key");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.url.searchParams.has("key"), false);
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "keep original text" }, { inlineData: { mimeType: "image/png", data: png.split(",")[1] } }] }]);
  assert.deepEqual(body.generationConfig, { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } });
  assert.equal(body.max_cost, undefined);
  assert.equal(output.quote, null);
  assert.equal(payload.image_options.output_size, "2k");
});

test("native discovery keeps IDs despite repeated page tokens and still rejects malformed or empty lists", async () => {
  let count = 0;
  const { gateway } = await setup(gemini, async () => { count++; return json({ models: [{ name: "models/custom-render" }], nextPageToken: "repeat" }); });
  assert.deepEqual(Object.keys((await gateway.rawCatalog()).models), ["custom-render"]);
  assert.deepEqual((await gateway.catalog()).models, []);
  assert.equal(count, 1);
  const empty = await setup(gemini, async () => json({ models: [], nextPageToken: "repeat" }));
  await assert.rejects(empty.gateway.catalog(), /没有返回模型 ID/);
  const malformed = await setup(oai, async () => json({ studio_features: { version: 2 }, models: {} }));
  await assert.rejects(malformed.gateway.catalog(), /所选接口协议/);
});

test("native model mappings: keep arbitrary IDs, use the selected model's capabilities and send the upstream ID", async () => {
  for (const profile of [oai, gemini]) {
    const calls = [], alias = profile === oai ? "custom/render@v2" : "custom-render@v2";
    const canonical = profile === oai ? "gpt-image-1.5" : "gemini-2.5-flash-image";
    const fetcher = async (url, init) => {
      calls.push({ url, init });
      return url.pathname.endsWith("/models")
        ? json(profile === oai ? { data: [{ id: alias }, { id: "another-model" }] } : { models: [{ name: "models/" + alias }, { name: "models/another-model" }], nextPageToken: "repeat" })
        : json({ result: "synthetic" });
    };
    const { gateway, connections, routing, context } = await setup(profile, fetcher);
    assert.equal((await testConnection(context, fetcher)).s, "ok");
    assert.deepEqual(Object.keys((await gateway.rawCatalog()).models), [alias, "another-model"]);
    assert.equal((await gateway.catalog()).models.length, 0);
    routing.links.test = { [canonical]: { id: alias, manual: true, on: true } };
    await connections.save(routing);
    const mapped = createGateway(connections.context("test"), fetcher);
    const [model] = (await mapped.catalog()).models;
    assert.equal(model.id, canonical);
    assert.equal(model.upstreamId, alias);
    assert.equal(model.maxImages, profile === oai ? 16 : 3);
    if (profile === gemini) assert.equal(model.fields.image_size, undefined);
    await mapped.execute(buildChatPayload(model, "exact prompt", {}), r => r.json());
    const request = calls.at(-1);
    if (profile === oai) assert.equal(JSON.parse(request.init.body).model, alias);
    else assert.ok(request.url.pathname.endsWith("/models/custom-render%40v2:generateContent"));
    assert.ok(calls.every(c => !c.url.searchParams.has("pageToken")));
    routing.links.test[canonical].on = false;
    await connections.save(routing);
    assert.equal((await createGateway(connections.context("test"), fetcher).catalog()).models.length, 0);
  }
});

test("NovelAI basic: static catalog after subscription auth, unknown charge, generation/one-image edit and explicit unsupported tools", async () => {
  const calls = [];
  const { gateway } = await setup(nai, async (url, init) => {
    calls.push({ url, init });
    return url.pathname === "/user/subscription" ? json({ active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 25 } }) : new Response("native-output");
  });
  const { models } = await gateway.catalog();
  assert.ok(models.length);
  assert.deepEqual(models[0].tools, ["img2img"]);
  assert.equal((await gateway.quota()).media.credits.remaining, 1025);
  const output = await gateway.execute({ model: models[0].id, prompt: "exact", seed: 0, width: 832, height: 1216, max_cost: 999 }, r => r.text());
  assert.equal(output.quote, null);
  assert.equal(output.native, true);
  let request = calls.at(-1), body = JSON.parse(request.init.body);
  assert.equal(request.url.href, "https://image.novelai.net/ai/generate-image");
  assert.equal(request.init.headers["X-Media-Provider"], undefined);
  assert.equal(body.parameters.seed, 0);
  assert.equal(body.max_cost, undefined);
  await gateway.execute({ model: models[0].id, prompt: "edit", tool: "img2img", init_image: png, strength: 0.5, noise: 0.1, seed: 0 }, r => r.text());
  body = JSON.parse(calls.at(-1).init.body);
  assert.equal(body.action, "img2img");
  assert.equal(body.parameters.image, png.split(",")[1]);
  assert.equal(body.parameters.width, 1);
  const before = calls.length;
  await assert.rejects(gateway.execute({ model: models[0].id, tool: "upscale", init_image: png }, r => r.text()), /尚未支持/);
  assert.equal(calls.length, before);
});

test("NovelAI recognition: subscription status and balance never invalidate an authenticated Key", async () => {
  for (const [active, purchased, remaining] of [[false, 7, 7], [false, 0, 0], [false, undefined, null], [true, 25, 25]]) {
    const calls = [], account = { active, tier: active ? 3 : 0, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: purchased } };
    const fetcher = async (url, init) => {
      calls.push({ url, init });
      assert.equal(url.href, "https://image.novelai.net/user/subscription");
      assert.ok(!init.method || init.method === "GET");
      assert.equal(init.body, undefined);
      assert.equal(init.headers.Authorization, "Bearer synthetic-native-key");
      assert.equal(init.redirect, "error");
      return json(account);
    };
    const { gateway, context } = await setup(nai, fetcher);
    assert.deepEqual((await gateway.rawCatalog()).subscription, { active, tier: account.tier });
    assert.equal((await gateway.catalog()).models.length, 5);
    assert.equal((await gateway.quota()).media.credits.remaining, remaining);
    assert.deepEqual(await testConnection(context, fetcher), {
      s: "ok", text: `Key 有效 · ${active ? "订阅已激活" : "未订阅"} · 生图尚未实测`,
    });
    assert.equal(calls.length, 3);
  }
});

test("NovelAI recognition: invalid credentials, malformed accounts and Cloudflare blocks stay distinct", async () => {
  for (const body of [{}, { active: false }, { active: "false", tier: 0 }]) {
    const fetcher = async () => json(body), { gateway, context } = await setup(nai, fetcher);
    await assert.rejects(gateway.catalog(), /订阅响应不符合/);
    assert.equal((await testConnection(context, fetcher)).s, "err");
  }
  for (const [status, body, expected] of [
    [401, { message: "Unauthorized" }, "Key 无效"],
    [403, { message: "Forbidden" }, "访问被拒绝（403），请检查 Key 权限"],
    [403, { cloudflare_error: true, error_code: 1010, status: 403, detail: "Browser signature blocked" }, "请求被 Cloudflare 拦截，请检查网络或浏览器"],
  ]) {
    const fetcher = async () => Response.json(body, { status }), { gateway, context } = await setup(nai, fetcher);
    await assert.rejects(gateway.catalog(), body.cloudflare_error ? /Cloudflare/ : /Unauthorized|Forbidden/);
    assert.deepEqual(await testConnection(context, fetcher), { s: "err", text: expected });
  }
});

test("NovelAI V5 usage: preserve independent percentages without adding gateway guards", async () => {
  const usage = { percent: 68, purchasedPercent: 20, timeUntilNextPercent: 6060, isNegative: false };
  const { gateway } = await setup(nai, async () => json({ active: true, tier: 3, usage,
    trainingStepsLeft: { fixedTrainingStepsLeft: 500, purchasedTrainingSteps: 25 } }));
  const quota = await gateway.quota(), meter = novelaiUsage(quota.media.subscription);
  assert.equal(quota.media.credits.remaining, 525);
  assert.deepEqual(meter, { entitlement: "opus", percent: 68, purchasedPercent: 20,
    unavailable: false, ratio: 0.68, estimatedImages: 1176 });
  const bonus = novelaiUsage({ active: true, tier: 3, usage: { ...usage, percent: 125, timeUntilNextPercent: 0 } });
  assert.equal(bonus.percent, 125);
  assert.equal(bonus.ratio, 1);
  assert.equal(bonus.estimatedImages, 2163);
});

test("NovelAI V5 usage: unknown data, unavailable rounded zero and subscription rights stay distinct", () => {
  const account = { active: true, tier: 3 };
  for (const usage of [undefined, null, [], {}, { percent: "50", purchasedPercent: false, timeUntilNextPercent: "600", isNegative: "false" },
    { percent: NaN, purchasedPercent: Infinity, timeUntilNextPercent: -1 }, { percent: -1, purchasedPercent: -1 }]) {
    assert.deepEqual(novelaiUsage({ ...account, usage }), { entitlement: "opus", percent: null, purchasedPercent: null,
      unavailable: null, ratio: undefined, estimatedImages: null });
  }
  const usage = { percent: 0, purchasedPercent: 0, timeUntilNextPercent: 3600, isNegative: true };
  const empty = novelaiUsage({ ...account, usage });
  assert.equal(empty.percent, 0);
  assert.equal(empty.unavailable, true);
  assert.equal(empty.ratio, 0);
  assert.equal(empty.estimatedImages, null);
  assert.equal(novelaiUsage({ active: false, tier: 0 }), null);
  assert.equal(novelaiUsage({ active: true, tier: 2 }), null);
  assert.equal(novelaiUsage({ active: false, tier: 3, usage }).entitlement, "inactive");
  assert.equal(novelaiUsage({ active: true, tier: 2, usage }).entitlement, "other");
  assert.equal(novelaiUsage({ usage }).entitlement, "unknown");
});

test("NovelAI V5 image estimate uses the published baseline only with known Opus usage", () => {
  const account = { active: true, tier: 3 }, usage = { percent: 100, isNegative: false };
  for (const [percent, expected] of [[0, 0], [1, 17], [50, 865], [100, 1730], [125, 2163]])
    assert.equal(novelaiUsage({ ...account, usage: { ...usage, percent } }).estimatedImages, expected);
  for (const account of [{ active: false, tier: 3 }, { active: true, tier: 2 }, {}])
    assert.equal(novelaiUsage({ ...account, usage }).estimatedImages, null);
  for (const usage of [{ percent: 100 }, { percent: 100, isNegative: true }, { percent: Number.MAX_VALUE, isNegative: false }])
    assert.equal(novelaiUsage({ ...account, usage }).estimatedImages, null);
});

test("native execution: abort and failure never retry; cancelled request cannot call the consumer", async () => {
  for (const profile of [oai, gemini]) {
    let count = 0, consumed = false;
    const controller = new AbortController();
    const { gateway } = await setup(profile, async (_url, init) => {
      count++;
      await new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }); controller.abort(); });
    });
    const model = profile === oai ? "gpt-image-1.5" : "gemini-2.5-flash-image";
    await assert.rejects(gateway.execute({ model, prompt: "x" }, async () => { consumed = true; }, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(count, 1);
    assert.equal(consumed, false);
    const failed = await setup(profile, async () => { count++; return new Response('{"error":{"message":"synthetic unavailable"}}', { status: 503 }); });
    await assert.rejects(failed.gateway.execute({ model, prompt: "x" }, r => r.json()), /synthetic unavailable/);
    assert.equal(count, 2);
    const lateAbort = new AbortController();
    const late = await setup(profile, async () => { lateAbort.abort(); return json({ data: [] }); });
    await assert.rejects(late.gateway.execute({ model, prompt: "x" }, async () => { consumed = true; }, { signal: lateAbort.signal }), { name: "AbortError" });
    assert.equal(consumed, false);
  }
});
