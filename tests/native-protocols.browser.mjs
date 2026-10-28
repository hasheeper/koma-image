import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";
import { createArchive } from "../src/storage/backup-archive.ts";

let server, browser, origin;
before(async () => {
  await mkdir(".local/native-protocols", { recursive: true });
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
async function open(profile, seed = true, customId = "", account = { status: 200, body: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 100 } } }, baseUrl = "", withGateway = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), requests = [], errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("about:blank");
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
    const c = canvas.getContext("2d"); c.fillStyle = "#50417c"; c.fillRect(0,0,512,512);
    c.fillStyle = "#c4b6ff"; c.fillRect(50,70,220,180);
    return canvas.toDataURL().split(",")[1];
  }), "base64");
  const zip = Buffer.from(await (await createArchive([["image_0.png", new Blob([png], { type: "image/png" })]])).arrayBuffer());
  if (seed) await context.addInitScript(({ profile, baseUrl, withGateway }) => {
    if (!/^https?:/.test(location.protocol) || localStorage.getItem("koma.routing.v1")) return;
    localStorage.setItem("koma.routing.v1", JSON.stringify({ version: 1, connections: {
      ...(withGateway ? { primary: { id: "primary", name: "模拟网关", baseUrl: "https://gateway.example.test/primary", profileId: "koma-standard-v1", credentialRef: "primary-key", revision: "rev1" } } : {}),
      test: { id: "test", name: "模拟协议", baseUrl: baseUrl || (profile === "nai-official-v1" ? "https://image.novelai.net" : "https://gateway.example.test/service"), profileId: profile, credentialRef: "test-key", revision: "rev1" } }, links: {} }));
    sessionStorage.setItem("koma.session.keys", JSON.stringify({ "test-key": "synthetic-native-only", ...(withGateway ? { "primary-key": "synthetic-primary-only" } : {}) }));
  }, { profile, baseUrl, withGateway });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (!["gateway.example.test", "image.novelai.net", "api.openai.com", "sample.openai.azure.com", "sample.services.ai.azure.com", "generativelanguage.googleapis.com", "aiplatform.googleapis.com", "us-central1-aiplatform.googleapis.com"].includes(url.hostname)) {
      errors.push(`unexpected external origin: ${url.origin}`); return route.abort();
    }
    const record = { url: url.href, path: url.pathname, method: request.method(), headers: request.headers(), body: request.postData() };
    requests.push(record);
    if (url.pathname.startsWith("/primary/")) {
      if (url.pathname.endsWith("/image/models")) return route.fulfill({ json: { studio_features: { version: 2, max_cost: true }, valid_samplers: account.mediumEditor ? ["k_euler_ancestral", "k_euler"] : undefined, models: {
        ...Object.fromEntries(["nai-diffusion-5-full", "nai-diffusion-5-curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated", ...(account.mediumEditor ? ["nai-diffusion-5-full-medium"] : [])].map(id => [id, { provider: "novelai", operations: ["generate", "edit"], tools: ["img2img", "inpaint", "upscale"], quota_group: "novelai-v5" }])),
        "gpt-image-1.5": { editor_family: "gpt", operations: ["generate", "edit"], tools: ["image-edit"], quota_group: "openai" },
      } } });
      if (url.pathname.endsWith("/media/quota")) return route.fulfill({ json: { credits: { remaining: 5000 }, images: { "novelai-v5": { remaining: 174, limit: 250 }, openai: { remaining: 50, limit: 100 } } } });
      if (url.pathname.endsWith("/token_stats_data")) return route.fulfill({ json: { temp_limits: { is_temp: false } } });
      if (url.pathname.endsWith("/estimate")) return route.fulfill({ json: { cost: account.quoteCost ?? 0 } });
      if (url.pathname.endsWith("/ai/generate-image")) return route.fulfill({ contentType: "application/zip", body: zip });
      if (url.pathname.endsWith("/tools/run") || url.pathname.endsWith("/studio/image/generate")) return route.fulfill({ json: { data: [{ b64_json: png.toString("base64") }] } });
    }
    if (url.pathname.endsWith("/models")) return url.pathname.endsWith("/v1beta/models")
      ? route.fulfill({ json: { models: [{ name: "models/" + (customId || "gemini-2.5-flash-image") }], nextPageToken: "repeated-token" } })
      : route.fulfill({ json: { data: [{ id: customId || "gpt-image-1.5" }] } });
    if (url.hostname === "image.novelai.net" && url.pathname === "/user/subscription") return route.fulfill({ status: account.status, json: account.body });
    if (request.method() === "POST" && /\/images\/(generations|edits)$/.test(url.pathname))
      return route.fulfill({ json: { data: [{ b64_json: png.toString("base64") }] } });
    if (request.method() === "POST" && url.pathname.endsWith(":generateContent"))
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "模拟结果" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] } });
    if (request.method() === "POST" && url.pathname === "/ai/encode-vibe") {
      await account.onEncode?.(record);
      return route.fulfill({status:account.encodingStatus || 200,contentType:"application/octet-stream",body:Buffer.from([0,1,254,255])});
    }
    if (request.method() === "POST" && ["/ai/generate-image", "/ai/upscale"].includes(url.pathname)) {
      await account.onGenerate?.(record);
      if (account.generationStatus) return route.fulfill({ status: account.generationStatus, json: { error: "Synthetic generation failure" } });
      const image = url.pathname === '/ai/upscale' ? account.upscaleImage : account.generatedImage;
      if (image && account.bareImage) return route.fulfill({contentType:'image/png',body:image});
      const body = image ? Buffer.from(await (await createArchive([['image_0.png',new Blob([image],{type:'image/png'})]])).arrayBuffer()) : zip;
      return route.fulfill({ contentType: "application/zip", body });
    }
    errors.push(`unexpected endpoint: ${url.pathname}`); return route.fulfill({ status: 404, json: { error: "Unexpected protocol request" } });
  });
  await page.goto(origin + (profile === "nai-official-v1" ? "/#/image" : "/#/chat"));
  await page.waitForFunction(() => !!document.body.__vue_app__?._instance);
  await bind(page);
  return { page, context, requests, errors, png };
}
async function bind(page) {
  await page.waitForFunction(() => !!document.body.__vue_app__?._instance);
  await page.evaluate(() => {
    const p = document.body.__vue_app__._instance.provides, a = document.body.__vue_app__._context.provides;
    for (const name of ["chat", "editor", "drawing", "ui"])
      window[name] = p[Object.getOwnPropertySymbols(p).find(k => k.description === name)];
    window.services = a[Object.getOwnPropertySymbols(a).find(k => k.description === "application-services")];
  });
}

async function chooseNai(page, id, value) {
  // Mode and Effort are always-visible segments; the rest are menus.
  if (id === "naiMode" || id === "effort") return page.locator(`#${id} label:has(input[value="${value}"])`).click();
  await page.locator(`#${id}`).click();
  await page.locator(`.nai-menu:popover-open [data-value="${value}"]`).click();
}

test("priority NAI: ordering, availability, actual source, wallet, quota fallback and recovery", async () => {
  const account = { status: 200, body: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 8000, purchasedTrainingSteps: 150 }, usage: { percent: 68, purchasedPercent: 20, isNegative: false } } };
  const t = await open("nai-official-v1", true, "", account, "", true), { page } = t;
  const generated = () => t.requests.filter(r => r.method === "POST" && !r.path.endsWith("/estimate"));
  try {
    await page.waitForFunction(() => drawing.snapshot().model?.connection === "primary" && drawing.snapshot().quota?.image?.remaining === 174);
    assert.equal(await page.locator("#meters:visible .w-free use").getAttribute("href"), "#v-novelai");
    await page.evaluate(() => location.hash = "#/image/settings/connections");
    await page.waitForFunction(() => [...document.querySelectorAll(".conn-card .st")].every(el => el.dataset.s === "ok"));
    const official = page.locator(".conn-card").filter({ hasText: "模拟协议" });
    const gateway = page.locator(".conn-card").filter({ hasText: "模拟网关" });
    await official.getByRole("button", { name: "提高 模拟协议 的优先级", exact: true }).click();
    await page.waitForFunction(() => drawing.snapshot().model?.connection === "test" && drawing.snapshot().quota?.media.subscription?.usage?.percent === 68);
    assert.deepEqual(await page.evaluate(() => services.connections.configuration.order), ["test", "primary"]);
    assert.match(await page.locator(".conn-card").first().textContent(), /模拟协议/);
    assert.match(await official.locator(".st").textContent(), /当前使用/);
    assert.match(await gateway.locator(".conn-models").textContent(), /模型\s*5\s*个可用/);
    assert.equal(await page.evaluate(() => Object.values(services.connections.configuration.links).some(links => Object.values(links).some(link => !link.on))), false);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await official.screenshot({ path: `.local/native-protocols/priority-card-${width}.png` });
      await page.screenshot({ path: `.local/native-protocols/priority-settings-${width}.png` });
      assert.ok(await official.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    }
    await official.locator(".conn-models").click();
    await page.getByRole("tab", { name: "优先来源", exact: true }).click();
    assert.equal(await page.locator("#modelListDialog .md-row").count(), 5);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".set-nav button").filter({ hasText: "模型" }).click();
    await page.getByRole("button", { name: "展开 NAI Diffusion V5 Full 的来源", exact: true }).click();
    const sources = page.locator('[data-model="nai-diffusion-5-full"] .sm-lines');
    assert.equal(await sources.locator('.md-act[aria-pressed="true"]').count(), 2);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await sources.screenshot({ path: `.local/native-protocols/priority-model-sources-${width}.png` });
      assert.ok(await sources.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    }
    await page.locator("#settingsPanel .set-back").click();
    await page.evaluate(() => ui.notices.value.forEach(n => ui.dismissNotice(n.id)));
    await page.waitForFunction(() => !document.querySelector('.toast'));
    const wallet = page.locator("#meters:visible");
    assert.match(await wallet.textContent(), /68%.*约 1176 张.*8,150/);
    assert.doesNotMatch(await wallet.textContent(), /174|5,000/);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `.local/native-protocols/priority-wallet-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await wallet.evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.getBoundingClientRect().left >= 0));
      assert.ok(await wallet.locator(".w-estimate").isVisible());
    }
    await page.evaluate(async () => { await drawing.patch({ prompt: "模拟画面", seed: "0" }); await drawing.run(); });
    await page.waitForFunction(() => !!drawing.snapshot().current && !drawing.snapshot().busy);
    assert.equal(new URL(generated()[0].url).hostname, "image.novelai.net");
    await page.evaluate(async png => {
      await editor.open("image", new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: "image/png" }), "synthetic.png", { mode: "img2img" });
    }, t.png.toString("base64"));
    await page.waitForFunction(() => editor.snapshot().model?.connection === "test" && editor.snapshot().edit.canRun);
    await page.evaluate(() => editor.run());
    await page.waitForFunction(() => !editor.snapshot().busy && editor.snapshot().session.versions.some(v => v.kind === "result"));
    await page.evaluate(() => editor.setMode("inpaint"));
    await page.waitForFunction(() => editor.snapshot().model?.connection === "test");
    assert.equal(generated().length, 2);
    assert.ok(generated().every(r => new URL(r.url).hostname === "image.novelai.net"));
    await page.reload(); await bind(page);
    await page.waitForFunction(() => drawing.snapshot().model?.connection === "test" && drawing.snapshot().quota?.media.subscription?.usage?.percent === 68);
    account.body.trainingStepsLeft = { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 };
    account.body.usage = { percent: 0, purchasedPercent: 0, isNegative: true };
    await page.evaluate(() => drawing.refreshQuota(true));
    await page.waitForFunction(() => drawing.snapshot().model?.connection === "primary" && drawing.snapshot().quota?.image?.remaining === 174);
    await page.evaluate(() => drawing.run());
    assert.match(generated().at(-1).path, /^\/primary\//);
    account.body.trainingStepsLeft.purchasedTrainingSteps = 100;
    account.body.usage = { percent: 50, purchasedPercent: 0, isNegative: false };
    await page.evaluate(() => drawing.run());
    assert.equal(new URL(generated().at(-1).url).hostname, "image.novelai.net");
    await page.waitForFunction(() => drawing.snapshot().model?.connection === "test");
    account.generationStatus = 503;
    const before = generated().length;
    await page.evaluate(() => drawing.run());
    assert.equal(generated().length, before + 1, "a submitted error never causes another provider POST");
    assert.equal(new URL(generated().at(-1).url).hostname, "image.novelai.net");
    account.status = 401; account.body = { error: "Unauthorized" };
    await page.evaluate(() => services.connections.reload());
    await page.waitForFunction(() => !drawing.snapshot().catalogLoading);
    await page.evaluate(() => drawing.run());
    assert.equal(generated().length, before + 1, "authentication errors do not masquerade as insufficient funds");
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("priority CHAT: ordering selects an official source despite its unknown balance", async () => {
  const t = await open("openai-images-v1", true, "", undefined, "", true), { page } = t;
  try {
    await page.waitForFunction(() => chat.snapshot().model?.connection === "primary" && chat.snapshot().quota?.image?.remaining === 50);
    await page.evaluate(() => chat.setPrompt("模拟请求"));
    await page.waitForFunction(() => chat.snapshot().quote?.cost === 0);
    await page.evaluate(async () => {
      const next = structuredClone(services.connections.configuration);
      next.order = ["test", "primary"];
      await services.connections.save(next);
    });
    await page.waitForFunction(() => chat.snapshot().model?.connection === "test");
    assert.equal(await page.evaluate(() => chat.snapshot().quote), null);
    assert.equal(await page.evaluate(() => chat.snapshot().quota?.image ?? null), null);
    await page.evaluate(() => chat.execute());
    await page.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns.some(t => t.versions[t.selectedVersion].status === "done"));
    const generated = t.requests.filter(r => r.method === "POST" && !r.path.endsWith("/estimate"));
    assert.equal(generated.length, 1);
    assert.match(generated[0].path, /\/service\/v1\/images\/generations$/);
    assert.equal(generated[0].headers.authorization, "Bearer synthetic-native-only");
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("official connection icons: Google AIS/Vertex and OpenAI/Azure identities follow the address in cards and lists", async () => {
  for (const [name, profile, baseUrl, glyph, responsive] of [
    ["google-ais", "gemini-native-v1", "https://generativelanguage.googleapis.com", "#v-gemini-c", true],
    ["google-vertex", "openai-chat-v1", "https://us-central1-aiplatform.googleapis.com/v1/projects/sample/locations/us-central1/endpoints/openapi", "#v-gemini-c"],
    ["google-global", "openai-chat-v1", "https://aiplatform.googleapis.com/v1/projects/sample/locations/global/endpoints/openapi", "#v-gemini-c"],
    ["openai", "openai-images-v1", "https://api.openai.com", "#v-openai", true],
    ["azure-openai", "openai-chat-v1", "https://sample.openai.azure.com/openai/v1", "#v-openai"],
    ["azure-foundry", "openai-chat-v1", "https://sample.services.ai.azure.com/openai/v1", "#v-openai"],
  ]) {
    const t = await open(profile, true, "", undefined, baseUrl), { page } = t;
    try {
      await page.goto(origin + "/#/image/settings/connections");
      await page.locator("#settingsPanel[open]").waitFor();
      await page.waitForFunction(() => document.querySelector(".conn-card .st")?.dataset.s === "ok");
      assert.equal(await page.locator(".conn-card .connection-avatar use").getAttribute("href"), glyph);
      for (const width of responsive ? [320, 390, 768, 1440] : [1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.locator(".conn-card").screenshot({ path: `.local/native-protocols/${name}-${width}.png` });
      }
      await page.locator(".conn-models").click();
      const list = page.locator(profile === "openai-chat-v1" ? "#askModelDialog[open]" : "#modelListDialog[open]");
      await list.waitFor();
      assert.equal(await list.locator(".connection-avatar use").getAttribute("href"), glyph);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("koma.routing.v1")).connections.test);
      assert.equal(saved.profileId, profile);
      assert.equal(saved.baseUrl, baseUrl);
      assert.ok(t.requests.every(r => r.method === "GET" && new URL(r.url).origin === new URL(baseUrl).origin && r.path.endsWith("/models")));
      assert.deepEqual(t.errors, []);
    } finally { await t.context.close(); }
  }
});

test("native chat: OpenAI and Gemini generate/edit, keep original references and save unknown costs", async () => {
  for (const protocol of ["openai-images-v1", "gemini-native-v1"]) {
    const t = await open(protocol), { page } = t;
    try {
      await page.waitForFunction(() => chat.snapshot().ready);
      assert.match(await page.locator("#chatApp #meters").textContent(), /费用未知/);
      for (const [i, prompt] of ["蓝色森林", "增加暖色阳光"].entries()) {
        await page.locator("#chatPrompt").fill(prompt);
        await page.waitForTimeout(750);
        assert.equal(await page.evaluate(() => chat.snapshot().error), "");
        await page.getByRole("button", { name: "发送绘图请求", exact: true }).click();
        await page.waitForFunction(n => chat.snapshot().current.turns.length === n && !chat.snapshot().busy && chat.snapshot().current.turns.every(t => t.versions[t.selectedVersion].status === "done"), i + 1);
      }
      const posts = t.requests.filter(r => r.method === "POST");
      assert.equal(posts.length, 2);
      if (protocol === "openai-images-v1") {
        assert.ok(posts[0].path.endsWith("/images/generations"));
        assert.ok(posts[1].path.endsWith("/images/edits"));
        assert.match(posts[1].headers["content-type"], /^multipart\/form-data; boundary=/);
        assert.match(posts[1].body, /name="image\[\]"/);
      } else {
        assert.ok(posts.every(r => r.path.endsWith(":generateContent")));
        assert.equal(JSON.parse(posts[1].body).contents[0].parts.filter(p => p.inlineData).length, 1);
        assert.equal(posts[1].headers["x-goog-api-key"], "synthetic-native-only");
      }
      assert.ok(posts.every(r => !r.body.includes("max_cost")));
      assert.ok(t.requests.every(r => !/estimate|quota|token_stats/.test(r.path)));
      const quotes = await page.evaluate(async () => {
        const result = await services.backup.export();
        const checked = await services.backup.read(result.blob);
        return { current: chat.snapshot().current.turns.map(t => t.versions[0].quote), backup: checked.conversations.length };
      });
      assert.deepEqual(quotes.current, [null, null]);
      assert.ok(quotes.backup > 0);
      assert.deepEqual(t.errors, []);
    } finally { await t.context.close(); }
  }
});

test("NovelAI model controls: transparency follows V5 capabilities and preserves the preference across model switches", async () => {
  const t = await open("nai-official-v1"), { page } = t;
  try {
    await page.waitForFunction(() => drawing.snapshot().model && drawing.snapshot().quota);
    await page.locator("#parametersToggle").click();
    await page.locator("#transparentBgWrap").click();
    await page.waitForFunction(() => drawing.snapshot().form.transparentBg);
    for (const model of ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated", "nai-diffusion-5-curated", "nai-diffusion-5-full"]) {
      const supportsAlpha = model.startsWith("nai-diffusion-5-");
      await chooseNai(page, "model", model);
      await page.waitForFunction(id => drawing.snapshot().model?.id === id, model);
      assert.equal(await page.locator("#transparentBgWrap").count(), supportsAlpha ? 1 : 0);
      assert.equal(await page.locator("#parametersToggle").getAttribute("aria-expanded"), "true");
      assert.equal(await page.evaluate(() => drawing.snapshot().form.transparentBg), true);
      if (supportsAlpha) assert.equal(await page.locator("#transparentBg").getAttribute("aria-pressed"), "true");
      if (model.endsWith("full")) {
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.locator("#resetAdv").scrollIntoViewIfNeeded();
          await page.screenshot({ path: `.local/native-protocols/${supportsAlpha ? "v5" : "v45"}-controls-${width}.png` });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }
        await page.evaluate(async () => { await drawing.patch({ prompt: "synthetic character" }); await drawing.run(); });
        const body = JSON.parse(t.requests.filter(r => r.method === "POST").at(-1).body);
        assert.equal(body.input, supportsAlpha ? "transparent background, synthetic character" : "synthetic character");
        assert.equal(body.parameters.v4_prompt.caption.base_caption, body.input);
      }
    }
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("NovelAI controls: compact presets, real Medium wire, remembered High parameters, imports and viewport layout", async () => {
  const t = await open("nai-official-v1"), { page } = t;
  try {
    await page.waitForFunction(() => drawing.snapshot().model && drawing.snapshot().quota);
    await page.evaluate(async () => {
      await drawing.patch({ tagSuggest: false, steps: 31, sampler: "k_euler", cfgRescale: 0.65, prompt: 'girl, Text: "HELLO"', negative: "custom negative" });
      ui.notices.value.forEach(n => ui.dismissNotice(n.id));
    });
    await chooseNai(page, "complexity", "high");
    await chooseNai(page, "qualityPreset", "light");
    await page.locator("#transparentBg").click();
    await page.locator("#tab-negative").click();
    await chooseNai(page, "negativePreset", "human");
    await chooseNai(page, "effort", "medium");
    await page.waitForFunction(() => drawing.snapshot().model?.id === "nai-diffusion-5-full-medium");
    assert.equal(await page.locator("#negative").getAttribute("readonly"), "");
    assert.equal(await page.locator("#negative").inputValue(), "custom negative");
    assert.equal(await page.locator("#negativePreset").count(), 0);
    await page.locator("#parametersToggle").click();
    assert.equal(await page.locator("#steps").inputValue(), "14");
    assert.equal(await page.locator("#sampler").inputValue(), "k_euler_ancestral");
    assert.equal(await page.locator("#steps").isDisabled(), true);
    assert.equal(await page.locator("#cfgRescale").isDisabled(), true);
    assert.equal(await page.locator("#scale").isDisabled(), false);
    await page.evaluate(() => drawing.run());
    let body = JSON.parse(t.requests.filter(r => r.method === "POST").at(-1).body);
    assert.equal(body.model, "nai-diffusion-5-full-medium");
    assert.equal(body.parameters.steps, 14); assert.match(body.parameters.negative_prompt, /^nsfw, lowres, artistic error/);
    assert.equal(body.parameters.cfg_rescale, undefined); assert.equal(body.parameters.cfg, undefined);
    assert.equal(body.input, 'transparent background, girl, high complexity, very aesthetic, amazing quality, no text, Text: "HELLO"');
    await chooseNai(page, "effort", "high");
    assert.equal(await page.locator("#steps").inputValue(), "31");
    assert.equal(await page.locator("#sampler").inputValue(), "k_euler");
    assert.equal(await page.locator("#cfgRescale").inputValue(), "0.65");
    assert.equal(await page.locator("#negativePreset").getAttribute("data-value"), "human");
    assert.equal(await page.locator("#negative").getAttribute("readonly"), null);
    await page.evaluate(() => drawing.run());
    body = JSON.parse(t.requests.filter(r => r.method === "POST").at(-1).body);
    assert.equal(body.parameters.cfg_rescale, 0.65); assert.match(body.parameters.negative_prompt, /^custom negative, lowres/);
    await page.locator("#tab-prompt").click();
    await page.locator("#parametersToggle").click();
    assert.equal(await page.locator("#prompt").inputValue(), 'girl, Text: "HELLO"');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#tab-prompt").scrollIntoViewIfNeeded();
      await page.evaluate(() => ui.notices.value.forEach(n => ui.dismissNotice(n.id)));
      await page.screenshot({ path: `.local/native-protocols/nai-presets-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await page.locator(".prompt-options").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      // Mode and Effort sit side by side under the full-width model field.
      const row = await page.locator(".model-row").boundingBox(), mode = await page.locator("#naiMode").boundingBox(), effort = await page.locator("#effort").boundingBox();
      assert.ok(mode.y >= row.y + row.height && Math.abs(mode.y - effort.y) <= 1 && effort.x + effort.width <= row.x + row.width + 1);
    }
    await chooseNai(page, "model", "nai-diffusion-4-5-curated");
    assert.equal(await page.locator("#effort").count(), 0); assert.equal(await page.locator("#complexity").count(), 0);
    await page.locator("#qualityPreset").click();
    assert.equal(await page.locator(".nai-menu:popover-open [data-value=light]").count(), 0);
    await page.keyboard.press("Escape");
    await page.locator("#tab-negative").click();
    await page.locator("#negativePreset").click();
    assert.equal(await page.locator(".nai-menu:popover-open [data-value=furry]").count(), 0);
    await page.keyboard.press("Escape");
    await chooseNai(page, "model", "nai-diffusion-5-curated");
    assert.equal(await page.locator("#effort").count(), 0);
    await page.locator("#tab-prompt").click();
    assert.equal(await page.locator("#qualityPreset").getAttribute("data-value"), "light");
    assert.equal(await page.locator("#complexity").getAttribute("data-value"), "high");
    await chooseNai(page, "model", "nai-diffusion-5-full");
    await chooseNai(page, "complexity", "ultra"); await chooseNai(page, "qualityPreset", "standard");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#effort").scrollIntoViewIfNeeded();
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `.local/native-protocols/nai-controls-polished-${width}.png` });
      if (width === 1440) await page.locator(".prompt-options").screenshot({ path: '.local/native-protocols/nai-footer-selected.png' });
      assert.ok(await page.locator(".prompt-options").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.locator("#qualityPreset").click();
      const menu = page.locator(".nai-menu:popover-open");
      assert.equal(await menu.getByRole("menuitemradio", { name: "Standard", exact: true }).getAttribute("aria-checked"), "true");
      await page.screenshot({ path: `.local/native-protocols/nai-menu-${width}.png` });
      const box = await menu.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
      await page.keyboard.press("Escape"); assert.equal(await page.locator("#qualityPreset").evaluate(el => el === document.activeElement), true);
    }
    await page.evaluate(() => drawing.patch({ complexity: "none", qualityPreset: "none", transparentBg: false }));
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(0, 0);
    await page.locator(".prompt-options").screenshot({ path: '.local/native-protocols/nai-footer-off.png' });
    const params = await page.evaluate(async () => {
      const record = drawing.snapshot().history[0];
      drawing.apply((await import('/src/domain/drawing.ts')).reuseFields(record));
      return drawing.snapshot().form;
    });
    assert.equal(params.prompt, 'girl, Text: "HELLO"'); assert.equal(params.negative, "custom negative");
    assert.equal(params.qualityPreset, "light"); assert.equal(params.negativePreset, "human");
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("NovelAI basic: ZIP generation, non-free wallet, image editor without quote and three edit tools", async () => {
  const t = await open("nai-official-v1"), { page } = t;
  try {
    await page.waitForFunction(() => drawing.snapshot().model && drawing.snapshot().quota);
    assert.match(await page.locator("#meters:visible").textContent(), /1,100.*Anlas/);
    assert.equal(await page.locator('#goCost').isVisible(), false);
    await page.evaluate(async () => { await drawing.patch({ prompt: "模拟画面", seed: "0" }); await drawing.run(); });
    await page.waitForFunction(() => !!drawing.snapshot().current && !drawing.snapshot().busy);
    assert.equal(await page.evaluate(() => drawing.snapshot().current.quote), null);
    await page.evaluate(async png => {
      await editor.open("image", new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: "image/png" }), "synthetic.png", { mode: "img2img" });
    }, t.png.toString("base64"));
    await page.locator("#imageEditor[data-active=true]").waitFor();
    await page.waitForFunction(() => editor.snapshot().edit.canRun && editor.snapshot().edit.price === "费用未知");
    assert.equal(await page.locator('#editorRun .cost-tag').count(), 0);
    await page.evaluate(() => editor.run());
    await page.waitForFunction(() => !editor.snapshot().busy && editor.snapshot().session.versions.some(v => v.kind === "result"));
    const posts = t.requests.filter(r => r.method === "POST").map(r => JSON.parse(r.body));
    assert.equal(posts.length, 2);
    assert.equal(posts[0].parameters.seed, 0);
    assert.equal(posts[1].action, "img2img");
    assert.ok(posts.every(body => !Object.hasOwn(body, "max_cost")));
    assert.deepEqual(await page.evaluate(() => [...new Set(editor.snapshot().models.flatMap(m => m.tools))]), ["img2img", "inpaint", "upscale", "director"]);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("NAI guidance: official and gateway routes keep rescale through EDIT, history and four widths without legacy cfg", async () => {
  for (const gateway of [false, true]) {
    const account = { status: 200, body: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 100 } }, quoteCost: 0 };
    const t = await open("nai-official-v1", true, "", account, "", gateway), { page } = t;
    const generated = () => t.requests.filter(r => r.method === "POST" && !r.path.endsWith("/estimate"));
    try {
      await page.waitForFunction(connection => drawing.snapshot().model?.connection === connection, gateway ? "primary" : "test");
      assert.equal(await page.evaluate(() => drawing.snapshot().form.cfg), null);
      await page.evaluate(async () => {
        await drawing.patch({ cfg: 10, scale: 5.5, cfgRescale: 0.65, seed: "0", prompt: "synthetic guidance check", tagSuggest: false });
        await drawing.run();
      });
      await page.waitForFunction(() => !!drawing.snapshot().current && !drawing.snapshot().busy);
      const native = JSON.parse(generated().at(-1).body);
      assert.equal(native.parameters.scale, 5.5); assert.equal(native.parameters.cfg_rescale, 0.65);
      assert.equal(Object.hasOwn(native.parameters, "cfg"), false);
      if (gateway) {
        account.quoteCost = 3;
        await page.evaluate(() => drawing.run());
        const paid = generated().at(-1);
        assert.ok(paid.path.endsWith("/studio/image/generate"));
        const body = JSON.parse(paid.body);
        assert.equal(body.scale, 5.5); assert.equal(body.cfg_rescale, 0.65); assert.equal(body.max_cost, 3);
        assert.equal(Object.hasOwn(body, "cfg"), false);
      }
      await page.locator("#editBtn").click();
      await page.locator("#imageEditor[data-active=true]").waitFor();
      await page.waitForFunction(() => editor.snapshot().edit.canRun);
      await page.locator("#editor-parametersToggle").click();
      assert.equal(await page.locator("#editorCfgRescale").inputValue(), "0.65");
      assert.equal(await page.locator("#editorScale").inputValue(), "5.5");
      await page.locator("#editorCfgRescale").evaluate(el => { el.value = "0.35"; el.dispatchEvent(new Event("input", { bubbles: true })); });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator("#editorCfgRescale").scrollIntoViewIfNeeded();
        assert.equal(await page.locator("#editorForm").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
        const box = await page.locator("#editorCfgRescale").boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
        if (!gateway && [390, 1440].includes(width)) await page.screenshot({ path: `.local/native-protocols/editor-rescale-${width}.png` });
      }
      await page.waitForFunction(() => editor.snapshot().edit.canRun && !editor.snapshot().reading && !editor.snapshot().preparing);
      const completed = await page.evaluate(async () => {
        await editor.run(); const v = editor.snapshot();
        return { result: v.session.versions.some(v => v.kind === "result"), error: v.edit.error, warning: v.warning };
      });
      assert.equal(completed.result, true, JSON.stringify({ gateway, ...completed }));
      const edit = JSON.parse(generated().at(-1).body), params = gateway ? edit : edit.parameters;
      assert.equal(params.scale, 5.5); assert.equal(params.cfg_rescale, 0.35); assert.equal(Object.hasOwn(params, "cfg"), false);
      if (gateway) assert.equal(edit.max_cost, 3);
      const saved = await page.evaluate(() => editor.session.versions.at(-1).params);
      assert.equal(saved.cfgRescale, 0.35); assert.equal(saved.cfg_rescale, 0.35);
      await page.evaluate(async () => {
        const item = drawing.snapshot().current;
        await editor.open("image", new Blob([item.blob], {type:'image/png'}), "synthetic.png", { settings: { model: item.params.model, prompt: item.params.prompt, cfg_rescale: 0.2 } });
      });
      await page.locator("#editor-parametersToggle").click();
      assert.equal(await page.locator("#editorCfgRescale").inputValue(), "0.2");
      await page.evaluate(async () => {
        const item = drawing.snapshot().current;
        await editor.open("image", new Blob([item.blob], {type:'image/png'}), "synthetic.png", { settings: { model: item.params.model, prompt: item.params.prompt, cfg: 10 } });
      });
      await page.locator("#editor-parametersToggle").click();
      assert.equal(await page.locator("#editorCfgRescale").inputValue(), "0");
      assert.ok(t.requests.filter(r => r.path.endsWith("/estimate")).every(r => !Object.hasOwn(JSON.parse(r.body), "cfg")));
      assert.deepEqual(t.errors, []);
    } finally { await t.context.close(); }
  }
});

test("NovelAI settings: an unsubscribed Key loads models and purchased Anlas without generating", async () => {
  const t = await open("nai-official-v1", false, "", { status: 200, body: { active: false, tier: 0, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 7 } } });
  const { page } = t;
  try {
    await page.locator("#settingsPanel[open]").waitFor();
    await page.getByRole("button", { name: "添加连接", exact: true }).click();
    await page.locator("#connectionProtocol").selectOption("nai-official-v1");
    await page.locator("#connectionName").fill("模拟未订阅账号");
    assert.equal(await page.locator("#connectionUrl").inputValue(), "https://image.novelai.net");
    assert.match(await page.locator("dialog[open]:has(#connectionTitle) .hint").textContent(), /Key 仅发送到 image\.novelai\.net/);
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.locator("#setupKey").fill("synthetic-native-only");
    await page.locator("#gate label").filter({ hasText: "不保存" }).click();
    await page.locator("#gate").getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".conn-card .st")?.dataset.s === "ok" && drawing.snapshot().models.length === 5);
    assert.match(await page.locator(".conn-card .st").textContent(), /^Key 有效/);
    assert.match(await page.locator(".conn-card .st").getAttribute("title"), /Key 有效 · 未订阅 · 生图尚未实测/);
    await page.waitForFunction(() => document.querySelector(".conn-meter b")?.textContent.trim() === "7");
    assert.match(await page.locator(".conn-meter").textContent(), /Anlas/);
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await page.locator('.toast[data-tone="ok"]').filter({ hasText: "Key 有效 · 未订阅" }).waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await page.locator(".conn-card .conn-meta").isVisible());
      await page.screenshot({ path: `.local/native-protocols/nai-unsubscribed-${width}.png` });
    }
    assert.ok(t.requests.length > 0);
    assert.ok(t.requests.every(r => r.method === "GET" && r.url === "https://image.novelai.net/user/subscription" && r.headers.authorization === "Bearer synthetic-native-only"));
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("NovelAI V5 settings: independent usage, refreshed states and four viewports without generating", async () => {
  const account = { status: 200, body: { active: true, tier: 3,
    trainingStepsLeft: { fixedTrainingStepsLeft: 8000, purchasedTrainingSteps: 150 },
    usage: { percent: 68, purchasedPercent: 20, timeUntilNextPercent: 6060, isNegative: false } } };
  const t = await open("nai-official-v1", true, "", account), { page } = t;
  try {
    await page.goto(origin + "/#/image/settings/connections");
    await page.locator("#settingsPanel[open]").waitFor();
    const usage = page.locator(".conn-meter").filter({ hasText: "V5 额度" });
    const purchased = page.locator(".conn-meter").filter({ hasText: "V5 加购" });
    await usage.getByText("68%", { exact: true }).waitFor();
    assert.equal(await page.locator(".conn-card .connection-avatar use").getAttribute("href"), "#v-novelai");
    assert.equal(await page.locator(".conn-meter").filter({ hasText: "Anlas" }).locator("b").textContent(), "8,150");
    assert.equal(await purchased.locator("b").textContent(), "20%");
    assert.equal(await usage.locator(".conn-meter-estimate").textContent(), "约 1,176 张");
    assert.match(await usage.locator(".conn-meter-estimate").getAttribute("title"), /23 步、约 1MP.*1,730 张/);
    assert.doesNotMatch(await usage.textContent(), /恢复|约需/);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await usage.locator("b").isVisible());
      assert.ok(await usage.getByText("约 1,176 张", { exact: true }).isVisible());
      assert.ok(await page.locator(".conn-meters").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: `.local/native-protocols/nai-v5-${width}.png` });
    }
    async function refresh(next) {
      Object.assign(account.body, next);
      await page.getByRole("button", { name: "测试连接", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.conn-acts button[aria-label="测试连接"]')?.disabled);
    }
    await refresh({ usage: { percent: 125, purchasedPercent: 0, timeUntilNextPercent: 0, isNegative: false } });
    assert.equal(await usage.locator("b").textContent(), "125%");
    assert.equal(await usage.locator(".conn-meter-estimate").textContent(), "约 2,163 张");
    assert.equal(await usage.locator(".conn-bar").evaluate(el => el.style.getPropertyValue("--p")), "100%");
    assert.equal(await purchased.count(), 0);
    await refresh({ usage: { percent: 0, purchasedPercent: 0, timeUntilNextPercent: 30, isNegative: true } });
    assert.equal(await usage.locator("b").textContent(), "0%");
    assert.match(await usage.textContent(), /额度暂不可用/);
    assert.doesNotMatch(await usage.textContent(), /恢复|约需/);
    assert.doesNotMatch(await usage.textContent(), /约.*张/);
    await refresh({ usage: null });
    assert.equal(await usage.locator("b").textContent(), "—");
    assert.match(await usage.textContent(), /用量未知/);
    assert.doesNotMatch(await usage.textContent(), /约.*张/);
    assert.equal(await usage.locator(".conn-bar").count(), 0);
    await refresh({ active: false, tier: 0, usage: { percent: 45, purchasedPercent: 0, timeUntilNextPercent: 3600, isNegative: false } });
    assert.equal(await usage.locator("b").textContent(), "45%");
    assert.match(await usage.textContent(), /未订阅 · 不可用/);
    assert.doesNotMatch(await usage.textContent(), /约.*张/);
    assert.match(await page.locator(".conn-card .st").textContent(), /^Key 有效/);
    await page.locator(".conn-models").click();
    await page.locator("#modelListDialog[open]").waitFor();
    assert.equal(await page.locator("#modelListDialog .connection-avatar use").getAttribute("href"), "#v-novelai");
    assert.ok(t.requests.length > 0);
    assert.ok(t.requests.every(r => r.method === "GET" && r.url === "https://image.novelai.net/user/subscription"));
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("NovelAI connection errors: startup and manual diagnostics identify Cloudflare without blaming the Key", async () => {
  const t = await open("nai-official-v1", true, "", { status: 403, body: { cloudflare_error: true, status: 403, error_code: 1010, detail: "Browser signature blocked" } });
  const { page } = t;
  try {
    const failure = page.locator('.toast[data-tone="err"]').filter({ hasText: "连接 模拟协议 失败 · 请求被 Cloudflare 拦截" });
    await failure.waitFor();
    assert.doesNotMatch(await failure.textContent(), /Key 无效|请检查地址、Key 或网络/);
    await failure.getByRole("button", { name: "设置", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".conn-card .st")?.dataset.s === "err");
    assert.match(await page.locator(".conn-card .st").textContent(), /Cloudflare/);
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await page.locator('.toast[data-tone="err"]').filter({ hasText: "模拟协议 · 请求被 Cloudflare 拦截" }).waitFor();
    assert.equal(await page.evaluate(() => drawing.snapshot().models.length), 0);
    assert.ok(t.requests.every(r => r.method === "GET" && r.url === "https://image.novelai.net/user/subscription"));
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("native settings: user maps a returned custom ID and the chat submits that exact upstream ID", async () => {
  for (const protocol of ["openai-images-v1", "gemini-native-v1"]) {
    const alias = protocol === "openai-images-v1" ? "custom/render@v2" : "custom-render@v2";
    const name = protocol === "openai-images-v1" ? "GPT Image 1.5" : "Nano Banana";
    const t = await open(protocol, true, alias), { page } = t;
    try {
      await page.evaluate(() => { location.hash = "#/chat/settings/models"; });
      await page.locator("#settingsPanel[open]").waitFor();
      await page.getByRole("button", { name: `展开 ${name} 的来源`, exact: true }).click();
      await page.getByRole("combobox", { name: `为 ${name} 指定 模拟协议 上的 ID`, exact: true }).selectOption(alias);
      await page.waitForFunction(() => chat.snapshot().ready);
      await page.locator("#settingsPanel").getByRole("button", { name: "返回", exact: true }).click();
      await page.locator("#chatPrompt").fill("使用手动匹配的模型");
      await page.getByRole("button", { name: "发送绘图请求", exact: true }).click();
      await page.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns[0]?.versions[0].status === "done");
      const posts = t.requests.filter(r => r.method === "POST");
      assert.equal(posts.length, 1);
      if (protocol === "openai-images-v1") assert.equal(JSON.parse(posts[0].body).model, alias);
      else assert.ok(posts[0].path.endsWith("/models/custom-render%40v2:generateContent"));
      assert.ok(t.requests.every(r => !new URL(r.url).searchParams.has("pageToken")));
      assert.deepEqual(t.errors, []);
    } finally { await t.context.close(); }
  }
});

test("native connection settings: explicit protocol, saved selection, key input, switch and four viewports", async () => {
  const t = await open("gemini-native-v1", false), { page } = t;
  try {
    await page.locator("#settingsPanel[open]").waitFor();
    await page.getByRole("button", { name: "添加连接", exact: true }).click();
    await page.locator("#connectionProtocol").selectOption("gemini-native-v1");
    await page.locator("#connectionName").fill("模拟原生连接");
    await page.locator("#connectionUrl").fill("https://gateway.example.test/google");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.locator("#setupKey").fill("synthetic-native-only");
    await page.locator("#gate label").filter({ hasText: "不保存" }).click();
    await page.locator("#gate").getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".conn-card .st")?.dataset.s === "ok");
    assert.match(await page.locator(".conn-card .conn-name .type").textContent(), /Gemini 原生/);
    assert.ok(t.requests.every(r => r.method === "GET"));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await page.locator(".conn-card .conn-meta").isVisible());
      await page.screenshot({ path: `.local/native-protocols/settings-${width}.png` });
    }
    // The protocol is changed in the connection form; NovelAI official still needs its own connection.
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "编辑连接…", exact: true }).click();
    const form = page.locator("dialog[open]:has(#connectionTitle)"), protocol = form.getByRole("combobox", { name: "接口协议", exact: true });
    assert.equal(await protocol.inputValue(), "gemini-native-v1");
    await protocol.selectOption("nai-official-v1");
    assert.equal(await protocol.inputValue(), "gemini-native-v1");
    assert.match(await form.locator(".modal-error").textContent(), /单独添加 NovelAI 官方连接/);
    assert.ok(t.requests.every(r => !r.path.includes("/user/subscription")));
    await protocol.selectOption("openai-images-v1");
    await form.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => services.connections.configuration.connections[Object.keys(services.connections.configuration.connections)[0]].profileId === "openai-images-v1" && document.querySelector(".conn-card .st")?.dataset.s === "ok");
    assert.ok(t.requests.some(r => r.path === "/google/v1/models"));
    assert.ok(t.requests.every(r => r.method === "GET"));
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('C2 official NAI: role arrays survive generation, history reuse, img2img and local snapshots', async()=>{
  const {page,context,requests,errors}=await open('nai-official-v1');
  try {
    await page.waitForFunction(()=>drawing.snapshot().models.length>0);
    await page.evaluate(()=>drawing.patch({tagSuggest:false,prompt:'2people, outdoors',negative:'lowres',placement:'manual',seed:'7',characters:[{id:'c1',on:true,prompt:'girl, red hair',negative:'',centers:[{x:.23,y:.34}]},{id:'c2',on:true,prompt:'boy, blue eyes',negative:'red hair',centers:[{x:.81,y:.7}]},{id:'c3',on:false,prompt:'other, unused',negative:'',centers:[]}]}));
    await page.evaluate(()=>drawing.run());
    const first=JSON.parse(requests.find(r=>r.path==='/ai/generate-image').body);
    assert.deepEqual(first.parameters.v4_prompt.caption.char_captions.map(c=>c.char_caption),['girl, red hair','boy, blue eyes']);
    assert.deepEqual(first.parameters.v4_negative_prompt.caption.char_captions.map(c=>c.char_caption),['','red hair']);assert.equal(first.parameters.v4_prompt.use_coords,true);
    const meta=await page.evaluate(()=>drawing.snapshot().history[0].params);assert.equal(meta.characters.length,2);assert.equal(meta.localCharacters.length,3);assert.ok(meta.boardId);
    await page.evaluate(async()=>{const record=drawing.snapshot().history[0];await drawing.patch({characters:[],placement:'auto'});drawing.apply((await import('/src/domain/drawing.ts')).reuseFields(record));});
    const restored=await page.evaluate(()=>drawing.snapshot().form.characters);assert.equal(restored.length,3);assert.deepEqual(restored.map(c=>c.id),['c4','c5','c6']);
    await page.evaluate(async()=>{const r=drawing.snapshot().history[0];await editor.open('image',r.blob,'synthetic.png',{mode:'img2img',settings:r.params});await drawing.createBoard(false);await drawing.patch({prompt:'another board'});await editor.run();});
    const posts=requests.filter(r=>r.path==='/ai/generate-image').map(r=>JSON.parse(r.body));assert.equal(posts.length,2);assert.equal(posts[1].action,'img2img');assert.deepEqual(posts[1].parameters.v4_prompt.caption.char_captions,first.parameters.v4_prompt.caption.char_captions);
    assert.equal(await page.evaluate(()=>drawing.snapshot().history[0].params.boardId),meta.boardId);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test("NAI modes: compact model row, matched menus, keyboard, persistence and dataset-aware completion", async () => {
  const t = await open("nai-official-v1"), { page } = t, queries = [];
  let release;
  await page.route("**/ai/generate-image/suggest-tags?**", async route => {
    const url = new URL(route.request().url()); queries.push(url.searchParams.get("prompt"));
    if (url.searchParams.get("prompt") === "late") await new Promise(resolve => release = resolve);
    await route.fulfill({ json: { tags: [{ tag: url.searchParams.get("prompt") === "late" ? "late furry result" : "wolf tail", count: 100 }] } }).catch(() => {});
  });
  await page.route("**/api/tags/suggest?**", route => route.fulfill({ json: { results: [{ name: "wolf_ears", category: 0, count: 80 }] } }));
  try {
    await page.waitForFunction(() => drawing.snapshot().model && drawing.snapshot().quota);
    await page.evaluate(() => drawing.patch({ tagSuggest: false, prompt: "wolf, soft light", negativePreset: "human" }));
    await chooseNai(page, "naiMode", "furry");
    assert.equal(await page.locator("#prompt").inputValue(), "wolf, soft light");
    assert.equal(await page.evaluate(() => drawing.snapshot().form.negativePreset), "human");
    await chooseNai(page, "effort", "medium");
    await chooseNai(page, "qualityPreset", "light");
    await page.locator("#transparentBg").click();
    await page.evaluate(() => drawing.run());
    const body = JSON.parse(t.requests.filter(r => r.method === "POST").at(-1).body);
    assert.equal(body.model, "nai-diffusion-5-full-medium");
    assert.match(body.input, /^fur dataset, transparent background, wolf,/);
    assert.match(body.parameters.negative_prompt, /^nsfw, lowres, artistic error/);
    const board = await page.evaluate(() => drawing.snapshot().activeBoardId);
    await page.evaluate(() => drawing.createBoard(false));
    assert.equal(await page.locator("#naiMode").getAttribute("data-value"), "anime");
    await page.evaluate(id => drawing.switchBoard(id), board);
    await page.reload(); await bind(page);
    await page.waitForFunction(() => drawing.snapshot().model && drawing.snapshot().quota);
    assert.equal(await page.locator("#naiMode").getAttribute("data-value"), "furry");
    assert.equal(await page.locator("#effort").getAttribute("data-value"), "medium");
    await chooseNai(page, "effort", "high");
    assert.equal(await page.locator("#model .choice-value").textContent(), "NAI Diffusion V5 Full");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await chooseNai(page, "effort", "medium");
      assert.ok(await page.locator(".model-row .choice-value, .model-switches span").evaluateAll(els => els.length === 5 && els.every(el => el.scrollWidth <= el.clientWidth + 1)));
      await chooseNai(page, "effort", "high");
      await page.locator("#model").scrollIntoViewIfNeeded();
      await page.evaluate(() => { ui.notices.value.forEach(n => ui.dismissNotice(n.id)); document.activeElement?.blur(); });
      await page.mouse.move(0, 0);
      assert.ok(await page.locator(".model-row").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.ok(await page.locator(".model-row .choice-value, .model-switches span").evaluateAll(els => els.length === 5 && els.every(el => el.scrollWidth <= el.clientWidth + 1)));
      await page.screenshot({ path: `.local/native-protocols/nai-mode-layout-${width}.png` });
      for (const id of ["model", "qualityPreset"]) {
        await page.locator(`#${id}`).click();
        const menu = page.locator(".nai-menu:popover-open");
        // Reduced motion still turns the menu's position writes into 0.01ms transitions; measure once they settle.
        await menu.evaluate(el => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => Promise.all(el.getAnimations().map(a => a.finished))));
        const box = await menu.boundingBox();
        assert.ok(box.x >= 8 && box.x + box.width <= width - 7 && box.y >= 8 && box.y + box.height <= 892, JSON.stringify({ id, width, box, errors: t.errors, menu: await menu.evaluate(el => el.outerHTML.slice(0, 450)) }));
        assert.equal(await menu.locator('[aria-checked="true"]').evaluate(el => getComputedStyle(el).outlineStyle), "none");
        await page.screenshot({ path: `.local/native-protocols/nai-mode-${id}-${width}.png` });
        await page.keyboard.press("Escape");
        assert.equal(await menu.count(), 0);
      }
    }
    await page.locator('#naiMode input[value="furry"]').focus(); await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator("#naiMode").getAttribute("data-value"), "anime");
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(700, 700);
    await page.screenshot({ path: ".local/native-protocols/nai-mode-row-final.png", clip: { x: 0, y: 330, width: 352, height: 215 } });
    await page.locator("#qualityPreset").click();
    await page.mouse.move(700, 700);
    await page.screenshot({ path: ".local/native-protocols/nai-mode-final.png", clip: { x: 0, y: 60, width: 352, height: 740 } });
    await page.keyboard.press("Escape");
    await page.locator("#model").click();
    await page.locator("#tab-prompt").click(); assert.equal(await page.locator(".nai-menu:popover-open").count(), 0);
    await page.evaluate(() => drawing.patch({ prompt: "fur dataset, wolf" }));
    assert.equal(await page.locator("#naiMode").getAttribute("data-value"), "furry");
    assert.equal(await page.locator('#naiMode input[value="anime"]').isDisabled(), true);
    await page.evaluate(() => drawing.patch({ prompt: "wolf", tagSuggest: true }));
    await chooseNai(page, "naiMode", "furry");
    await page.locator("#prompt").fill("wol");
    await page.locator('.tag-suggest-option').filter({ hasText: "wolf tail" }).waitFor();
    assert.match(await page.locator('.tag-suggest-option').textContent(), /Furry/);
    assert.deepEqual(queries, ["wol"]);
    await page.locator("#prompt").fill("late");
    for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(release, "delayed Furry query started");
    await chooseNai(page, "naiMode", "anime"); release();
    await page.locator("#prompt").fill("wol");
    await page.locator('.tag-suggest-option').filter({ hasText: "wolf_ears" }).waitFor();
    assert.equal(await page.locator('.tag-suggest-option').filter({ hasText: "late furry" }).count(), 0);
    await chooseNai(page, "naiMode", "furry");
    await page.locator("#prompt").click();
    await page.locator('.tag-suggest-option').filter({ hasText: "wolf tail" }).waitFor();
    assert.deepEqual(queries, ["wol", "late"]);
    await page.getByRole("button", { name: "查词插入", exact: true }).click();
    await page.locator("#pickerSearch").fill("tail");
    await page.locator(".picker-row").filter({ hasText: "wolf tail" }).waitFor();
    assert.match(await page.locator(".picker-row").textContent(), /Furry/);
    await page.getByRole("button", { name: "关闭查词插入", exact: true }).click();
    await page.getByRole("button", { name: "查词插入", exact: true }).click();
    assert.equal(await page.locator(".picker-status").isVisible(), false);
    await page.getByRole("button", { name: "关闭查词插入", exact: true }).click();
    await page.getByRole("button", { name: "添加角色", exact: true }).click();
    await page.locator("#char-c1-prompt").fill("role");
    await page.locator(".tag-suggest-option:visible").filter({ hasText: "wolf tail" }).waitFor();
    assert.deepEqual(queries, ["wol", "late", "tail", "role"]);
    assert.deepEqual(t.errors, []);
  } finally { release?.(); await t.context.close(); }
});


async function addReference(t, kind='vibe', count=1) {
  await chooseNai(t.page,'model','nai-diffusion-4-5-full');
  await t.page.getByRole('button',{name:kind==='vibe'?'Vibe Transfer':'Precise Reference',exact:true}).click();
  await t.page.locator('.bottom-reference-body input[type=file]').first().setInputFiles(Array.from({length:count},(_,i)=>({name:`synthetic-${i}.png`,mimeType:'image/png',buffer:t.png})));
  await t.page.waitForFunction(({kind,count})=>drawing.snapshot().form.naiReferences[kind].length===count,{kind,count});
}
const referencePosts=t=>t.requests.filter(r=>r.method==='POST' && ['/ai/encode-vibe','/ai/generate-image'].includes(r.path));
test('NAI references: upload/edit is free, explicit generate caches binary Vibe and keeps configuration after reload',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await addReference(t);
    assert.equal(referencePosts(t).length,0);
    assert.equal(await page.getByRole('switch',{name:'启用 Vibe Transfer'}).getAttribute('aria-checked'),'false');
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>!drawing.snapshot().busy && drawing.snapshot().history.length===1);
    const posts=referencePosts(t);
    assert.deepEqual(posts.map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    const encoding=JSON.parse(posts[0].body), generation=JSON.parse(posts[1].body);
    assert.equal(encoding.image,t.png.toString('base64'));
    assert.equal(encoding.information_extracted,.7);
    assert.equal(encoding.model,'nai-diffusion-4-5-full');
    assert.equal(generation.parameters.reference_image_multiple[0],'AAH+/w==');
    assert.equal('referencePlan' in generation,false);
    assert.equal('reference_information_extracted_multiple' in generation.parameters,false);
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>!drawing.snapshot().busy && drawing.snapshot().history.length===2);
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await page.reload();await bind(page);
    await page.waitForFunction(()=>drawing.snapshot().model && drawing.snapshot().form.naiReferences.vibe.length===1);
    await page.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    assert.ok(await page.locator('.reference-thumb img').getAttribute('src'));
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
test('NAI references: generation failure keeps successful encodings; failed encode never generates or retries',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}},generationStatus:500};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    account.generationStatus=0;
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await page.getByRole('slider',{name:'信息提取量'}).fill('0.8');
    account.encodingStatus=500;
    await page.evaluate(()=>drawing.run());
    const posts=referencePosts(t);assert.equal(posts.at(-1).path,'/ai/encode-vibe');
    assert.equal(posts.filter(r=>r.path==='/ai/encode-vibe').length,2);
    assert.equal(posts.filter(r=>r.path==='/ai/generate-image').length,2);
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/编码失败/);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
test('NAI references: Precise aspect-fit PNG, paired types and inverted Fidelity; incompatible models cannot drop refs',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t,'precise');
    await page.getByRole('slider',{name:'保真度'}).fill('0.85');
    await page.getByRole('switch',{name:'启用 Precise Reference'}).click();
    await page.evaluate(()=>drawing.run());
    const post=referencePosts(t).at(-1),wire=JSON.parse(post.body).parameters;
    assert.equal(post.path,'/ai/generate-image');
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,0);
    assert.deepEqual(wire.director_reference_descriptions,[{caption:{base_caption:'character&style',char_captions:[]},legacy_uc:false}]);
    assert.ok(Math.abs(wire.director_reference_secondary_strength_values[0]-.15)<1e-12);
    assert.deepEqual(wire.director_reference_strength_values,[1]);
    const dimensions=await page.evaluate(async b64=>{const b=await createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'}));const size=[b.width,b.height];b.close();return size;},wire.director_reference_images[0]);
    assert.deepEqual(dimensions,[1472,1472]);
    const before=referencePosts(t).length;
    await chooseNai(page,'model','nai-diffusion-5-full');
    assert.equal(await page.locator('#goBtn').isDisabled(),true);
    assert.equal(await page.locator('.reference-problem').count(),1);
    await page.evaluate(()=>drawing.run());assert.equal(referencePosts(t).length,before);
    await page.getByRole('button',{name:'停用参考',exact:true}).click();
    assert.equal(await page.locator('#goBtn').isDisabled(),false);
    assert.equal(await page.getByRole('button',{name:'Vibe Transfer',exact:true}).count(),0);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
test('NAI references: accepted drawer geometry and original parameters at 320/390/768/1440; switch is beside viewed group',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t,'precise',3);
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(()=>document.querySelector('.drawer-shell').getBoundingClientRect().height>150 && document.querySelector('.go-row').getBoundingClientRect().top-document.querySelector('.bottom-panel-content').getBoundingClientRect().bottom>=11.5);
      const geometry=await page.evaluate(()=>{
        const q=s=>document.querySelector(s).getBoundingClientRect(),nav=q('.bottom-controls'),body=q('.bottom-panel-content'),go=q('.go-row'),footer=q('.drawing-footer');
        return {width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,navBottom:nav.bottom,bodyTop:body.top,gap:go.top-body.bottom,footerHeight:footer.height,collapsed:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mobile-foot-h')),drawer:q('.drawer-shell').height,scrub:getComputedStyle(document.querySelector('.scrub')).borderRadius};
      });
      assert.ok(geometry.overflow<=1);assert.ok(geometry.bodyTop>=geometry.navBottom);assert.ok(geometry.gap>=11.5,JSON.stringify(geometry));
      if(width<860)assert.ok(Math.abs(geometry.footerHeight-geometry.drawer-geometry.collapsed)<2);
      assert.equal(await page.locator('.bottom-reference-segment.selected').innerText(),'Precise');
      await page.screenshot({path:`.local/native-protocols/reference-drawer-${width}.png`});
    }
    await page.locator('#parametersToggle').click();
    assert.equal(await page.getByRole('slider',{name:'Guidance',exact:true}).count(),1);
    assert.equal(await page.getByRole('switch',{name:'启用 Precise Reference'}).count(),0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#parametersToggle').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.drawer-shell').getAttribute('inert'),'');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: backup and official bundle restore original bytes, paid cache and board settings without encoding',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.evaluate(()=>drawing.run());
    const exported=await page.evaluate(async()=>{
      const refs=drawing.snapshot().form.naiReferences;
      const bundle=await services.references.export(refs.vibe,'vibe',drawing.snapshot().form.model);
      const bytes=new Uint8Array(await (await services.backup.export()).blob.arrayBuffer());
      window.referenceBackup=new Blob([bytes],{type:'application/zip'});
      window.referenceBundle=await bundle.text();
      const checked=await services.backup.read(referenceBackup);
      return {assets:checked.referenceAssets.length,encodings:checked.vibeEncodings.length,original:await checked.referenceAssets[0].blob.arrayBuffer().then(b=>Array.from(new Uint8Array(b))),bundle:JSON.parse(referenceBundle)};
    });
    assert.equal(exported.assets,1);assert.equal(exported.encodings,1);
    assert.deepEqual(Buffer.from(exported.original),t.png);
    assert.equal(exported.bundle.identifier,'novelai-vibe-transfer-bundle');
    assert.equal(exported.bundle.vibes[0].encodings['v4-5full'][Object.keys(exported.bundle.vibes[0].encodings['v4-5full'])[0]].encoding,'AAH+/w==');
    const before=referencePosts(t).length;
    await page.evaluate(async()=>{
      await drawing.patch({naiReferences:{active:null,normalize:false,vibe:[],precise:[]}});
      await services.data.write(async()=>{const {transactionDone}=await import('/src/storage/databases.ts');const tx=services.databases.transaction('koma-image-favorites',['referenceAssets','vibeEncodings'],'readwrite');tx.objectStore('referenceAssets').clear();tx.objectStore('vibeEncodings').clear();await transactionDone(tx);});
      const backup=await services.backup.read(referenceBackup);await services.backup.import(backup);
    });
    await page.waitForFunction(()=>drawing.snapshot().form.naiReferences.active==='vibe');
    assert.equal(referencePosts(t).length,before);
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await page.evaluate(async()=>{
      const items=await services.references.import(new File([referenceBundle],'synthetic.naiv4vibebundle',{type:'application/json'}),'vibe','nai-diffusion-4-5-full');
      await drawing.editReferences({...drawing.snapshot().form.naiReferences,vibe:items});
    });
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
test('NAI references: unknown fees do not bypass known reference minimum and standard fallback cannot drop images',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.evaluate(()=>drawing.run());
    assert.equal(t.requests.filter(r=>r.method==='POST' && !r.path.endsWith('/estimate')).length,0);
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/Anlas/);
    account.body.trainingStepsLeft.fixedTrainingStepsLeft=5;
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    assert.equal(t.requests.filter(r=>r.method==='POST' && r.path.startsWith('/primary/') && !r.path.endsWith('/estimate')).length,0);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
test('NAI references: paid preparation freezes board and group, keeps exact source, and escaped task encoders cannot run',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    const first=await page.evaluate(()=>drawing.snapshot().activeBoardId);
    account.onEncode=async()=>page.evaluate(async()=>{const id=await drawing.createBoard();await drawing.patch({prompt:'later board',model:'nai-diffusion-5-full'});return id;});
    await page.evaluate(()=>drawing.run());
    assert.notEqual(await page.evaluate(()=>drawing.snapshot().activeBoardId),first);
    const record=await page.evaluate(()=>drawing.snapshot().history[0]);
    assert.equal(record.params.boardId,first);assert.equal(record.params.model,'nai-diffusion-4-5-full');
    assert.equal(record.params.naiReferences.active,'vibe');
    assert.equal(JSON.parse(referencePosts(t).at(-1).body).model,'nai-diffusion-4-5-full');
    await page.evaluate(async()=>{await services.runTask({id:'capture-encoder',workspace:'image',snapshot:{}},async task=>{window.escapedEncoder=task.gateway('test').encodeVibe;});});
    const count=referencePosts(t).length;
    assert.match(await page.evaluate(()=>escapedEncoder('nai-diffusion-4-5-full','YWJj',.7,new AbortController().signal).then(()=>'',e=>e.message)),/任务已结束/);
    assert.equal(referencePosts(t).length,count);assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
test('NAI references: cancellation after successful encoding preserves cache and never automatically retries a submitted generation',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  let generation, release;
  const held=new Promise(resolve=>{release=resolve;});
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.route('https://image.novelai.net/ai/generate-image',async route=>{generation=route;await held;await route.abort().catch(()=>{});});
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>drawing.snapshot().label.includes('生成中'));
    while(!generation)await new Promise(resolve=>setTimeout(resolve,10));
    await page.locator('#cancelBtn').click();
    await page.waitForFunction(()=>!drawing.snapshot().busy);release();
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    await page.unroute('https://image.novelai.net/ai/generate-image');
    const encodes=referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length;
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,encodes);
    assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),1);
    assert.deepEqual(t.errors,[]);
  } finally {release();await t.context.close();}
});

test('NAI references: drawer interrupt/collapse, focus, KeepAlive and binary URL lifetime remain owned',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.waitForFunction(()=>!document.querySelector('.drawer-shell').getAnimations().length);
    const before=await page.evaluate(()=>{
      const instance=document.querySelector('.drawing-bottom-panel').__vueParentComponent;window.drawerRenders=0;
      instance.u=[...(instance.u||[]),()=>window.drawerRenders++];return document.querySelector('.drawer-shell').getBoundingClientRect().height;
    });
    assert.ok(before>100);
    const interrupted=await page.evaluate(async()=>{
      const button=document.querySelector('.bottom-reference-segment.selected>.bottom-tab'),el=document.querySelector('.drawer-shell');
      button.click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const midway=el.getBoundingClientRect().height,inert=el.inert;
      button.click();await new Promise(requestAnimationFrame);
      return {midway,after:el.getBoundingClientRect().height,inert};
    });
    assert.equal(interrupted.inert,true);assert.ok(interrupted.midway<before);assert.ok(interrupted.midway>0);assert.ok(interrupted.after>0);assert.ok(interrupted.after<before);
    await page.waitForFunction(()=>!document.querySelector('.drawer-shell').getAnimations().length);
    const renderCount=await page.evaluate(()=>drawerRenders);
    assert.ok(renderCount<=4,`animation rerendered ${renderCount} times`);
    await page.getByRole('button',{name:'更多参考操作'}).click();
    assert.equal(await page.locator('.reference-menu:popover-open').count(),1);
    await page.evaluate(()=>location.hash='#/tags');
    await page.waitForSelector('[data-workspace-root=tags]');
    assert.equal(await page.locator('.reference-menu:popover-open').count(),0);
    await page.evaluate(()=>location.hash='#/image');
    await page.waitForSelector('.bottom-reference-body');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'Vibe Transfer',exact:true}).getAttribute('aria-expanded'),'false');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Vibe Transfer');
    await page.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    const old=await page.locator('.reference-thumb img').getAttribute('src');
    await page.locator('#parametersToggle').click();
    assert.equal(await page.evaluate(async url=>{try{await fetch(url);return true;}catch{return false;}},old),false,'unmounted editor releases thumbnail URL');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: encoded-only official files lock extraction, reject corruption and reuse cache without original',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await chooseNai(page,'model','nai-diffusion-4-5-full');
    const result=await page.evaluate(async()=>{
      const {sha256}=await import('/src/native/reference-images.ts');
      const value={identifier:'novelai-vibe-transfer',version:1,type:'encoding',id:await sha256('AAH+/w=='),encodings:{'v4-5full':{unknown:{encoding:'AAH+/w==',params:{information_extracted:.7}}}},importInfo:{model:'nai-diffusion-4-5-full',information_extracted:.7,strength:.6}};
      const file=new File([JSON.stringify(value)],'synthetic.naiv4vibe',{type:'application/json'});
      const refs=await services.references.import(file,'vibe','nai-diffusion-4-5-full');
      await drawing.editReferences({active:'vibe',normalize:false,vibe:refs,precise:[]});
      const corrupt={...value,id:'b'.repeat(64)};
      const bad=await services.references.import(new File([JSON.stringify(corrupt)],'bad.naiv4vibe'),'vibe','nai-diffusion-4-5-full').then(()=>'',e=>e.message);
      const wrongModel=await services.references.import(file,'vibe','nai-diffusion-4-5-curated').then(()=>'',e=>e.message);
      return {bad,wrongModel};
    });
    assert.match(result.bad,/校验失败/);assert.match(result.wrongModel,/不包含当前模型/);
    await page.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    assert.equal(await page.getByRole('slider',{name:'信息提取量'}).isDisabled(),true);
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/generate-image']);
    assert.equal(JSON.parse(referencePosts(t)[0].body).parameters.reference_image_multiple[0],'AAH+/w==');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: a connection change during paid encoding saves the receipt and prevents generation on a replacement context',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    account.onEncode=async()=>page.evaluate(()=>services.connections.supplyKey('test-key','synthetic-replaced-key'));
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe']);
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/变化|变更|失效|配置|Key/);
    account.onEncode=undefined;
    await page.waitForFunction(()=>drawing.snapshot().model);
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

async function openEditorFixture(t, settings) {
  await t.page.evaluate(async ({ png, settings }) => {
    await editor.open('image', new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}),'synthetic.png',{ settings });
    ui.notices.value.forEach(n=>ui.dismissNotice(n.id));
  },{png:t.png.toString('base64'),settings});
  await t.page.locator('#imageEditor[data-active=true]').waitFor();
}

test('EDIT alignment: raw presets, actual random/zero seed, role editing and position ownership, result round-trip and four widths', async () => {
  for (const gateway of [false,true]) {
    const t=await open('nai-official-v1',true,'',undefined,'',gateway),{page}=t;
    const edits=()=>t.requests.filter(r=>r.method==='POST' && /(?:tools\/run|ai\/generate-image)$/.test(r.path));
    try {
      await page.waitForFunction(()=>drawing.snapshot().model);
      await page.evaluate(()=>drawing.patch({prompt:'drawing stays unchanged',tagSuggest:false}));
      await openEditorFixture(t,{
        model:'nai-diffusion-5-full',basePrompt:'wolf, Text: "Hello"',prompt:'obsolete expanded tags',
        baseNegative:'custom negative',negative_prompt:'obsolete negative tags',naiMode:'furry',complexity:'ultra',qualityPreset:'light',negativePreset:'human',transparentBg:true,
        scale:5.5,cfgRescale:.65,steps:31,seed:-1,sampler:'k_euler',
        localCharacters:[{id:'c3',on:true,prompt:'1girl, red coat',negative:'hat',centers:[{x:.31,y:.61}]},{id:'c8',on:false,prompt:'1boy, blue coat',negative:'cloak',centers:[{x:.72,y:.42}]}],placement:'manual',
      });
      const root=page.locator('#imageEditor');
      assert.equal(await page.locator('#editorPrompt').inputValue(),'wolf, Text: "Hello"');
      assert.equal(await page.locator('#editor-qualityPreset').getAttribute('data-value'),'light');
      assert.equal(await page.locator('#editor-effort input[value=medium]').isDisabled(),false);
      await root.getByRole('button',{name:'添加角色',exact:true}).click();
      await page.locator('#editor-char-c9-prompt').fill('1girl, green coat');
      await root.getByRole('button',{name:'删除角色 3',exact:true}).click();
      await root.getByRole('button',{name:'添加角色',exact:true}).click();
      await page.locator('#editor-char-c10-prompt').fill('1girl, green coat');
      await root.locator('[data-character-id=c10] .mc-switch').click();
      assert.equal(await root.getByRole('switch',{name:'发送角色 3',exact:true}).isChecked(),false);
      await root.getByRole('button',{name:'在画面上调整',exact:true}).click();
      assert.equal(await page.locator('#editorPositionLayer .mc-stage').isVisible(),true);
      await page.locator('#editorPositionLayer').getByRole('button',{name:'完成',exact:true}).click();
      await page.locator('#editor-parametersToggle').click();
      assert.equal(await page.locator('#editorSeed').inputValue(),'');
      await page.locator('#editor-parametersToggle').click();
      for(const width of [320,390,768,1440]) {
        await page.setViewportSize({width,height:900});
        await page.locator('#editorModel').scrollIntoViewIfNeeded();
        assert.ok(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
        assert.ok(await page.locator('#editorPromptBox .prompt-options:visible').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
        const row=await page.locator('#editorModel').boundingBox(), prompt=await page.locator('#editorPromptBox').boundingBox();
        assert.ok(row.y<prompt.y);
        await page.screenshot({path:`.local/native-protocols/editor-aligned-${gateway?'gateway':'official'}-${width}.png`});
      }
      await page.setViewportSize({width:1440,height:900});
      await page.waitForFunction(()=>editor.snapshot().edit.canRun);
      await page.evaluate(()=>editor.run());
      assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
      let raw=JSON.parse(edits().at(-1).body),wire=gateway?raw:raw.parameters;
      assert.equal(gateway?raw.prompt:raw.input,'fur dataset, transparent background, wolf, ultra complexity, very aesthetic, amazing quality, no text, Text: "Hello"');
      assert.match(wire.negative_prompt,/^custom negative, lowres/);
      assert.ok(Number.isInteger(wire.seed)&&wire.seed>=0&&wire.seed<=4294967295);
      const params=await page.evaluate(()=>editor.session.versions.at(-1).params);
      assert.equal(params.seed,wire.seed); assert.equal(params.randomSeed,true);
      assert.equal(params.basePrompt,'wolf, Text: "Hello"'); assert.equal(params.baseNegative,'custom negative');
      assert.equal(params.localCharacters.length,3); assert.equal(params.localCharacters[2].id,'c10');
      assert.equal(params.qualityPreset,'light'); assert.equal(params.complexity,'ultra'); assert.equal(params.naiMode,'furry'); assert.equal(params.transparentBg,true);
      assert.equal(gateway?wire.characters.length:wire.v4_prompt.caption.char_captions.length,1);
      assert.equal(await page.evaluate(()=>drawing.snapshot().form.prompt),'drawing stays unchanged');
      await page.evaluate(async()=>{ const v=editor.snapshot().viewed; await editor.open('image',v.blob,v.name,{settings:v.params}); });
      assert.equal(await page.locator('#editorPrompt').inputValue(),'wolf, Text: "Hello"');
      await page.evaluate(()=>editor.patch({qualityPreset:'none',complexity:'none',negativePreset:'none',transparentBg:false,naiMode:'anime',seed:'0'}));
      await page.waitForFunction(()=>editor.snapshot().edit.canRun);
      await page.evaluate(()=>editor.run());
      raw=JSON.parse(edits().at(-1).body);wire=gateway?raw:raw.parameters;
      assert.equal(gateway?raw.prompt:raw.input,'wolf, Text: "Hello"'); assert.equal(wire.negative_prompt,'custom negative'); assert.equal(wire.seed,0);
      assert.equal(await page.evaluate(()=>editor.session.versions.at(-1).params.seed),0);
      const drawingFields=await page.evaluate(async()=> (await import('/src/domain/drawing.ts')).reuseFields(editor.records().find(r=>r.id===editor.session.versions.at(-1).recordId)));
      assert.equal(drawingFields.prompt,'wolf, Text: "Hello"');assert.equal(drawingFields.cfgRescale,.65);assert.equal(drawingFields.characters[2].on,false);
      assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);
      await chooseNai(page,'editorModel','nai-diffusion-4-5-curated');
      assert.equal(await page.locator('#editor-complexity').count(),0);assert.equal(await page.locator('#editor-transparentBg').count(),0);
      await page.locator('#editor-qualityPreset').click();
      assert.equal(await root.locator('.nai-menu:popover-open [data-value=light]').count(),0);await page.keyboard.press('Escape');
      assert.equal(await root.getAttribute('data-active'),'true');
      assert.deepEqual(t.errors,[]);
    } finally { await t.context.close(); }
  }
});

test('EDIT references: inherited Vibe/Precise prepare only on submit, share cache, retain URLs, protect operation and persist small snapshots', async () => {
  const t=await open('nai-official-v1',true,'',undefined,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    const drawingThumb=await page.locator('.reference-thumb img').getAttribute('src');
    await openEditorFixture(t);
    const root=page.locator('#imageEditor');
    assert.equal(await page.evaluate(()=>editor.snapshot().referenceSupported),true);
    await root.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    assert.equal(await root.getByRole('switch',{name:'启用 Vibe Transfer'}).getAttribute('aria-checked'),'true');
    assert.equal(referencePosts(t).length,0);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    let body=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(body.action,'img2img');assert.equal(body.parameters.reference_image_multiple[0],'AAH+/w==');assert.ok(body.parameters.image);
    const saved=await page.evaluate(()=>editor.session.versions.at(-1).params);
    for(const key of ['referencePlan','preparedReferences','init_image','mask_image'])assert.equal(key in saved,false);
    assert.equal(saved.naiReferences.active,'vibe');assert.equal(saved.naiReferences.vibe.length,1);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await root.getByRole('button',{name:'Precise Reference',exact:true}).click();
    await root.locator('.bottom-reference-body input[type=file]').first().setInputFiles({name:'precise.png',mimeType:'image/png',buffer:t.png});
    await page.waitForFunction(()=>editor.snapshot().session.naiReferences.precise.length===1);
    await root.getByRole('switch',{name:'启用 Precise Reference'}).click();
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.naiReferences.precise.length),0);
    await page.evaluate(()=>editor.run());
    body=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(body.parameters.director_reference_images.length,1);assert.equal('reference_image_multiple' in body.parameters,false);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.naiReferences.active),'precise');
    const before=referencePosts(t).length;
    await root.getByRole('button',{name:'重绘',exact:true}).click();
    assert.equal(await page.evaluate(()=>editor.snapshot().referenceProblem),'');
    assert.equal(await root.getByRole('button',{name:'Vibe Transfer',exact:true}).count(),0);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,before);
    await paintEditorMask(page);
    await page.evaluate(()=>editor.run());
    body=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(body.action,'infill');assert.equal(body.parameters.director_reference_images.length,1);
    await page.evaluate(()=>editor.editReferences({...editor.snapshot().session.naiReferences,active:'vibe'}));
    assert.match(await page.evaluate(()=>editor.snapshot().referenceProblem),/不支持 Vibe/);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.setMode('img2img'));
    await chooseNai(page,'editorModel','nai-diffusion-5-full');
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await chooseNai(page,'editorModel','nai-diffusion-4-5-full');
    await page.evaluate(()=>editor.close());await page.evaluate(()=>location.hash='#/image');
    await page.locator('#imageEditor').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(async url=>(await fetch(url)).ok,drawingThumb),true);
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

async function paintEditorMask(page) {
  await page.locator('#editorMask:not([hidden])').waitFor();
  const box=await page.locator('#editorMask').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
  await page.mouse.down();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5,{steps:3});await page.mouse.up();
  await page.waitForFunction(()=>editor.snapshot().edit.canRun);
}
async function solidPng(page,width,height,color='#e04050') {
  return Buffer.from(await page.evaluate(({width,height,color})=>{
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
    return c.toDataURL().split(',')[1];
  },{width,height,color}),'base64');
}

test('EDIT official: five Img2Img and four Inpaint variants, painted-area pixels, actual seed and compact four-width controls',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic detail',seed:0,cfgRescale:.6});
    account.generatedImage=await solidPng(page,512,512);
    for(const model of ['nai-diffusion-4-5-full','nai-diffusion-4-5-curated','nai-diffusion-5-full','nai-diffusion-5-curated','nai-diffusion-5-full-medium']) {
      await page.evaluate(model=>{editor.setMode('img2img');editor.setBase(1);editor.setModel(model);editor.setNumber('strength',.4);editor.setNumber('noise',.2);},model);
      await page.evaluate(()=>editor.run());
      assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
      let body=JSON.parse(referencePosts(t).at(-1).body);
      assert.equal(body.model,model);assert.equal(body.action,'img2img');assert.equal(body.parameters.strength,.4);assert.equal(body.parameters.noise,.2);
      assert.equal(body.parameters.seed,0);assert.equal(body.parameters.cfg_rescale,model.endsWith('medium')?undefined:.6);
      if(model==='nai-diffusion-5-curated') {
        await page.evaluate(()=>editor.setMode('inpaint'));
        await page.locator('#editorModel').click();
        const menu=page.locator('#'+await page.locator('#editorModel').getAttribute('aria-controls'));
        assert.equal(await menu.locator('button[role="menuitemradio"]').count(),3);
        assert.equal(await menu.locator('button[data-value="nai-diffusion-5-curated"]').count(),0);
        assert.notEqual(await page.locator('#editorModel').getAttribute('data-value'),model);
        await page.keyboard.press('Escape');
        continue;
      }
      await page.evaluate(model=>{editor.setMode('inpaint');editor.setBase(1);editor.setModel(model);editor.setNumber('strength',.65);},model);
      await paintEditorMask(page);
      await page.evaluate(()=>editor.run());
      assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
      body=JSON.parse(referencePosts(t).at(-1).body);
      assert.equal(body.model,model+'-inpainting');assert.equal(body.action,'infill');
      assert.deepEqual(body.parameters.img2img,{strength:.65,color_correct:true});assert.equal(body.parameters.noise,undefined);
      const saved=await page.evaluate(async()=>{
        const v=editor.snapshot().viewed,b=await createImageBitmap(v.blob),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');
        x.drawImage(b,0,0);b.close();return {outside:[...x.getImageData(0,0,1,1).data],inside:[...x.getImageData(256,256,1,1).data],params:v.params};
      });
      assert.deepEqual(saved.outside,[80,65,124,255]);assert.deepEqual(saved.inside,[224,64,80,255]);
      assert.equal(saved.params.seed,0);assert.equal(saved.params.noise,0);
      for(const key of ['init_image','mask_image','preparedReferences'])assert.equal(key in saved.params,false);
    }
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorNoise').count(),0);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('#imageEditor').getByRole('button',{name:'适应窗口',exact:true}).click();
      await page.waitForTimeout(120);
      await page.screenshot({path:`.local/native-protocols/editor-official-inpaint-${width}.png`});
      assert.ok(await page.locator('#imageEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const image=await page.locator('#editorImage').boundingBox();assert.ok(image.width>200&&image.height>200);
    }
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('EDIT official Upscale: one menu choice, 4x ZIP/raw output, original bytes, validation, failure and cancellation never retry',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t);
    account.upscaleImage=await solidPng(page,2048,2048);
    await page.locator('#editorUpscaleToggle').click();
    assert.equal(await page.getByRole('menuitemradio',{name:'外部放大',exact:true}).isDisabled(),true);
    await page.getByRole('menuitemradio',{name:'原生放大',exact:true}).click();
    assert.equal(await page.locator('#editorUpscalePop .editor-pop-item').count(),0);
    assert.equal(await page.locator('#editorUpscalePop .editor-mini-value').count(),1);
    assert.match(await page.locator('#editorUpscalePop').textContent(),/NovelAI Upscale/);
    assert.match(await page.locator('#editorUpscalePop .editor-mini-facts').textContent(),/4×.*2048×2048/);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(()=>document.querySelector('#editorImage').getBoundingClientRect().width>200);
      await page.waitForTimeout(120);
      await page.screenshot({path:`.local/native-protocols/editor-official-upscale-${width}.png`});
      const box=await page.locator('#editorUpscalePop').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
    }
    await page.locator('#editorUpscaleRun').click();
    await page.waitForFunction(()=>!editor.snapshot().busy&&editor.snapshot().viewed.kind==='result');
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.width),2048);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.upscaleFactor),4);
    assert.match(t.requests.filter(r=>r.path==='/ai/upscale').at(-1).body,/declared_blur_sigma/);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.blob.size),account.upscaleImage.length);
    // Re-run from the original, not the just-upscaled image.
    await page.evaluate(()=>editor.setBase(1));account.bareImage=true;
    await page.evaluate(()=>editor.run('upscale'));assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    await page.evaluate(()=>editor.setBase(1));
    account.upscaleImage=t.png;
    const count=await page.evaluate(()=>editor.snapshot().session.versions.length);
    await page.evaluate(()=>editor.run('upscale'));
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/4×/);assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),count);
    account.generationStatus=503;
    await page.evaluate(()=>editor.run('upscale'));
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/Synthetic generation failure/);
    account.generationStatus=undefined;account.upscaleImage=await solidPng(page,2048,2048);
    let started;
    const arrived=new Promise(resolve=>{started=resolve;});
    account.onGenerate=()=>new Promise(r=>{release=r;started();});
    const pending=page.evaluate(()=>editor.run('upscale'));
    await arrived;await page.evaluate(()=>editor.cancel());release?.();await pending;
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),count);
    assert.equal(t.requests.filter(r=>r.path==='/ai/upscale').length,5);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});

test('EDIT official Inpaint: empty masks never submit; wrong output dimensions fail without saving a partial result',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t);
    await page.evaluate(()=>editor.setMode('inpaint'));
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,0);
    await paintEditorMask(page);account.generatedImage=await solidPng(page,256,256);
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/尺寸.*不一致/);
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),1);
    assert.equal(referencePosts(t).length,1);assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('EDIT Medium: only an advertised gateway tool is selectable; effective constraints preserve High controls', async () => {
  const t=await open('nai-official-v1',true,'',{status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}},mediumEditor:true},'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic',negative_prompt:'keep this negative',steps:31,sampler:'k_euler',cfgRescale:.65,seed:-1,
      localCharacters:[{id:'c1',on:true,prompt:'1girl',negative:'hat',centers:[]}],negativePreset:'human'});
    await page.locator('#editor-effort label:has(input[value=medium])').click();
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorSteps').inputValue(),'14');assert.equal(await page.locator('#editorSampler').inputValue(),'k_euler_ancestral');
    assert.equal(await page.locator('#editorSteps').isDisabled(),true);assert.equal(await page.locator('#editorCfgRescale').isDisabled(),true);
    await page.waitForFunction(()=>editor.snapshot().edit.quote);
    await page.evaluate(()=>editor.run());
    const req=t.requests.filter(r=>r.path.endsWith('/tools/run')).at(-1),body=JSON.parse(req.body);
    assert.equal(body.model,'nai-diffusion-5-full-medium');assert.equal(body.steps,14);assert.match(body.negative_prompt,/^nsfw, lowres, artistic error/);assert.equal(body.characters[0].uc,'');
    assert.equal('cfg_rescale' in body,false);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.baseNegative),'keep this negative');
    await page.locator('#editor-effort label:has(input[value=high])').click();
    assert.equal(await page.locator('#editorSteps').inputValue(),'31');assert.equal(await page.locator('#editorCfgRescale').inputValue(),'0.65');
    assert.equal(await page.locator('#editorSampler').inputValue(),'k_euler');
    assert.equal(await page.evaluate(()=>editor.snapshot().session.characters[0].negative),'hat');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('EDIT reference failures: known balance, encoding error, cancellation and key changes never lose cache or switch source', async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();await openEditorFixture(t);
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).length,0);assert.match(await page.evaluate(()=>editor.snapshot().runError),/不足/);
    account.body.trainingStepsLeft.fixedTrainingStepsLeft=100;account.encodingStatus=500;
    await page.evaluate(()=>editor.refreshQuota());
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe'],await page.evaluate(()=>editor.snapshot().runError));
    assert.equal(await page.evaluate(()=>services.references.pending(editor.session.naiReferences.vibe[0],editor.snapshot().model.id)),true);
    account.encodingStatus=200;
    const held=new Promise(resolve=>{release=resolve;});
    await page.route('https://image.novelai.net/ai/generate-image',async route=>{await held;await route.abort().catch(()=>{});});
    await page.locator('#editorRun').click();
    await page.waitForFunction(()=>editor.snapshot().busy && !services.references.pending(editor.session.naiReferences.vibe[0],editor.snapshot().model.id));
    await page.locator('#editorStop').click();
    await page.waitForFunction(()=>!editor.snapshot().busy);release();
    await page.unroute('https://image.novelai.net/ai/generate-image');
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),1);
    const encodes=referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length;
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,encodes);
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),2);
    await page.evaluate(()=>editor.editReferences({...editor.session.naiReferences,vibe:editor.session.naiReferences.vibe.map(r=>({...r,information:.5}))}));
    account.onEncode=async()=>page.evaluate(()=>services.connections.supplyKey('test-key','synthetic-replaced-editor-key'));
    const before=referencePosts(t).filter(r=>r.path==='/ai/generate-image').length;
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/generate-image').length,before);
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/变化|变更|失效|配置|Key/);
    assert.equal(await page.evaluate(()=>services.references.pending(editor.session.naiReferences.vibe[0],editor.snapshot().model.id)),false);
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});

test('EDIT drawer and uploads: native height animation, four widths, and stale imports cannot mutate another session', async () => {
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'synthetic'});
    const root=page.locator('#imageEditor');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await root.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    assert.ok(await root.locator('.drawer-shell').evaluate(el=>el.getAnimations().some(a=>a.effect.getKeyframes().some(k=>'height' in k))));
    await root.locator('.bottom-reference-body input[type=file]').first().setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:t.png});
    await page.waitForFunction(()=>editor.session.naiReferences.vibe.length===1);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await root.locator('.reference-thumb').scrollIntoViewIfNeeded();
      assert.ok(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const footer=await root.locator('.composer-foot').boundingBox(),run=await page.locator('#editorRun').boundingBox();
      assert.ok(run.y+run.height<=900&&footer.y>=0);
      await page.screenshot({path:`.local/native-protocols/editor-vibe-drawer-${width}.png`});
    }
    await page.setViewportSize({width:390,height:900});
    await page.locator('#editor-parametersToggle').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editor-parametersToggle').getAttribute('aria-expanded'),'false');
    assert.equal(await root.getAttribute('data-active'),'true');
    await root.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    await page.evaluate(()=>{
      const original=services.references.upload;
      services.references.upload=async(...args)=>{ const rows=await original(...args);await new Promise(resolve=>window.finishEditorUpload=resolve);return rows; };
    });
    await root.locator('.bottom-reference-body input[type=file]').first().setInputFiles({name:'late.png',mimeType:'image/png',buffer:t.png});
    await page.waitForFunction(()=>!!window.finishEditorUpload);
    await page.evaluate(()=>editor.createBoard());
    await page.evaluate(()=>window.finishEditorUpload());
    await page.waitForFunction(()=>ui.notices.value.some(n=>n.text.includes('来源')||n.text.includes('会话')));
    assert.equal(await page.evaluate(()=>editor.session.naiReferences.vibe.length),0);
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.naiReferences.vibe.length),0);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI parameter alignment: official drawers, manual Guidance, schedules and four viewport widths', async () => {
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-4-5-full',tagSuggest:false}));
    await page.locator('#parametersToggle').click();
    const options=await page.locator('#sampler option').evaluateAll(els=>els.map(el=>el.value));
    assert.ok(options.includes('k_dpmpp_2s_ancestral'));assert.ok(!options.includes('ddim_v3'));
    await page.locator('#sampler').selectOption('k_dpmpp_2m');
    assert.match(await page.locator('#noiseSchedule option[value=auto]').textContent(),/Exponential/);
    await page.locator('#noiseSchedule').selectOption('polyexponential');
    assert.equal(await page.locator('#scale').getAttribute('max'),'10');assert.equal(await page.locator('#scale').getAttribute('step'),'0.1');
    await page.locator('#scaleVal button').click();
    await page.locator('#scaleInput').fill('21.3');await page.locator('#scaleInput').press('Enter');
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.scale),21.3);
    await page.evaluate(()=>drawing.run());
    let wire=JSON.parse(t.requests.filter(r=>r.path==='/ai/generate-image').at(-1).body);
    assert.equal(wire.parameters.scale,21.3);assert.equal(wire.parameters.noise_schedule,'polyexponential');
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-5-full'}));
    assert.equal(await page.locator('#noiseSchedule').count(),0);
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.noiseSchedule),'polyexponential');
    await page.evaluate(()=>drawing.run());
    wire=JSON.parse(t.requests.filter(r=>r.path==='/ai/generate-image').at(-1).body);
    assert.equal(wire.parameters.noise_schedule,'karras');
    await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'synthetic',sampler:'k_dpmpp_2m',noiseSchedule:'polyexponential',scale:21.3});
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorNoiseSchedule').inputValue(),'polyexponential');
    assert.equal(await page.locator('#editorStrength').getAttribute('min'),'0.01');assert.equal(await page.locator('#editorStrength').getAttribute('max'),'0.99');
    assert.equal(await page.locator('#editorNoise').getAttribute('max'),'0.99');
    await page.locator('#editorScaleVal button').click();
    await page.locator('#editorScaleInput').fill('11.7');await page.locator('#editorScaleInput').press('Enter');
    await page.evaluate(()=>editor.run());
    wire=JSON.parse(t.requests.filter(r=>r.path==='/ai/generate-image').at(-1).body);
    assert.equal(wire.action,'img2img');assert.equal(wire.parameters.scale,11.7);assert.equal(wire.parameters.noise_schedule,'polyexponential');
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.noise_schedule),'polyexponential');
    await page.evaluate(()=>editor.setMode('inpaint'));
    assert.equal(await page.locator('#editorStrength').getAttribute('max'),'1');assert.equal(await page.locator('#editorNoise').count(),0);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('#editorNoiseSchedule').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#imageEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const run=await page.locator('#editorRun').boundingBox();assert.ok(run.y+run.height<=900);
      await page.screenshot({path:`.local/native-protocols/nai-parameters-${width}.png`});
    }
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Variety+: compact V4.5 toggle, actual requests, model switching, EDIT and four widths', async () => {
  const t=await open('nai-official-v1'),{page}=t;
  const posts=()=>t.requests.filter(r=>r.path==='/ai/generate-image');
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-4-5-full',tagSuggest:false}));
    await page.locator('#parametersToggle').click();
    const button=page.locator('#scaleVarietyPlus');
    assert.equal(await button.getAttribute('aria-pressed'),'false');
    const guidance=await page.evaluate(()=>drawing.snapshot().form.scale);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.scale),guidance);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await button.scrollIntoViewIfNeeded();
      const outer=await page.locator('.drawing-parameters .guidance').boundingBox(),toggle=await button.boundingBox();
      assert.ok(toggle.x>=outer.x&&toggle.x+toggle.width<=outer.x+outer.width);
      assert.ok(toggle.y>=outer.y&&toggle.y+toggle.height<=outer.y+outer.height);
      assert.ok(toggle.height<=26);
      await page.screenshot({path:`.local/native-protocols/variety-image-${width}.png`,animations:'disabled'});
    }
    await page.evaluate(()=>drawing.run());
    let wire=JSON.parse(posts().at(-1).body);
    assert.equal(wire.parameters.skip_cfg_above_sigma,58);
    assert.equal(await page.evaluate(()=>drawing.snapshot().current.params.varietyPlus),true);
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-5-full'}));
    assert.equal(await button.count(),0);
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.varietyPlus),true);
    await page.evaluate(()=>drawing.run());
    assert.equal(JSON.parse(posts().at(-1).body).parameters.skip_cfg_above_sigma,undefined);
    assert.equal(await page.evaluate(()=>drawing.snapshot().current.params.varietyPlus),false);
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-4-5-curated'}));
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    await page.locator('#resetAdv').click();
    assert.equal(await button.getAttribute('aria-pressed'),'false');
    await button.focus();await page.keyboard.press('Space');
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    const beforeEdit=await page.evaluate(()=>({id:drawing.snapshot().current.id,count:drawing.snapshot().history.length,varietyPlus:drawing.snapshot().current.params.varietyPlus}));
    await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'synthetic',varietyPlus:true});
    await page.locator('#editor-parametersToggle').click();
    const editButton=page.locator('#editorScaleVarietyPlus');
    assert.equal(await editButton.getAttribute('aria-pressed'),'true');
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});await editButton.scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#imageEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await page.screenshot({path:`.local/native-protocols/variety-edit-${width}.png`,animations:'disabled'});
    }
    await page.evaluate(()=>editor.run());
    wire=JSON.parse(posts().at(-1).body);
    assert.equal(wire.action,'img2img');assert.equal(wire.parameters.skip_cfg_above_sigma,58*Math.sqrt(4096/15808));
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.varietyPlus),true);
    assert.deepEqual(await page.evaluate(()=>({id:drawing.snapshot().current.id,count:drawing.snapshot().history.length,varietyPlus:drawing.snapshot().current.params.varietyPlus})),beforeEdit);
    await editButton.click();
    await page.evaluate(()=>editor.run());
    assert.equal(JSON.parse(posts().at(-1).body).parameters.skip_cfg_above_sigma,undefined);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.varietyPlus),false);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Enhance: compact official controls, exact output, fresh Seed, recipe/history and four widths', async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'girl, Text:hello',negative_prompt:'watermark',seed:0,steps:31,cfgRescale:.3,noiseSchedule:'exponential'});
    await page.evaluate(()=>{editor.setNumber('strength',.33);editor.setNumber('noise',.04);});
    assert.equal(referencePosts(t).length,0);
    await page.locator('.enhance-toggle').click();
    assert.equal(await page.evaluate(()=>editor.snapshot().model.profileId),'nai-official-v1');
    assert.equal(await page.locator('#editorEnhance').isChecked(),true);
    assert.match(await page.locator('#editorRun').textContent(),/Enhance/);
    await page.locator('#editorEnhanceScale').selectOption('1.5');
    await page.locator('#editorEnhanceMagnitude').selectOption('5');
    assert.equal(await page.locator('#editorStrength').inputValue(),'0.7');
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorSeed').isDisabled(),true);
    assert.equal(await page.locator('#editorSeed').inputValue(),'');
    assert.equal(await page.locator('#editorNoise').inputValue(),'0.1');
    await page.evaluate(()=>editor.setNumber('noise',.08));
    assert.equal(await page.locator('#editorEnhanceMagnitude').inputValue(),'0');
    await page.locator('#editor-parametersToggle').click();
    await page.locator('#editorEnhanceMagnitude').selectOption('5');
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('.enhance-control').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#imageEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      assert.ok(await page.locator('.enhance-control').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const run=await page.locator('#editorRun').boundingBox();assert.ok(run.y+run.height<=900);
      await page.screenshot({path:`.local/native-protocols/enhance-${width}.png`});
    }
    account.generatedImage=await solidPng(page,768,768);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    const post=referencePosts(t).at(-1),wire=JSON.parse(post.body);
    assert.equal(new URL(post.url).hostname,'image.novelai.net');
    assert.equal(wire.action,'img2img');assert.equal(wire.parameters.width,768);assert.equal(wire.parameters.height,768);
    assert.equal(wire.parameters.strength,.7);assert.equal(wire.parameters.noise,.1);
    assert.equal(wire.parameters.noise_schedule,'exponential');assert.equal(wire.parameters.steps,31);
    assert.equal(wire.parameters.upscaled_enhance,undefined);assert.equal(wire.parameters.enhance,undefined);
    assert.match(wire.input,/-2::upscaled, blurry::,Text:hello$/);
    const result=await page.evaluate(()=>({params:editor.snapshot().viewed.params,width:editor.snapshot().viewed.width,record:editor.record(editor.snapshot().viewed.recordId).params,seed:editor.session.fields.seed}));
    assert.equal(result.width,768);assert.equal(result.params.enhance,true);assert.equal(result.params.enhanceScale,1.5);assert.equal(result.params.enhanceMagnitude,5);
    assert.equal(result.params.basePrompt,'girl, Text:hello');assert.equal(result.params.seed,wire.parameters.seed);assert.equal(result.params.randomSeed,true);
    assert.equal(result.record.enhance,true);assert.equal(result.seed,'0');
    assert.match(await page.locator('.editor-info-meta b').textContent(),/Enhance/);
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    const board=await page.evaluate(()=>editor.session.id);
    await page.evaluate(()=>editor.createBoard());
    assert.equal(await page.evaluate(()=>editor.session.enhance.on),false);
    await page.evaluate(id=>editor.switchBoard(id),board);
    assert.equal(await page.locator('#editorEnhance').isChecked(),true);
    assert.equal(await page.locator('#editorEnhanceScale').inputValue(),'1.5');
    await page.evaluate(()=>{editor.setMode('inpaint');});
    assert.equal(await page.locator('#editorEnhance').count(),0);
    await page.evaluate(()=>editor.setMode('img2img'));
    assert.equal(await page.locator('#editorEnhance').isChecked(),true);
    await page.locator('.enhance-toggle').click();
    assert.equal(await page.locator('#editorStrength').inputValue(),'0.33');
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorNoise').inputValue(),'0.04');assert.equal(await page.locator('#editorSeed').inputValue(),'0');
    assert.equal(await page.locator('#editorSeed').isDisabled(),false);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Enhance: failure, wrong dimensions, cancellation and exhausted official sources cannot create results or fall back', async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full-medium',prompt:'synthetic',seed:0});
    await page.evaluate(()=>{editor.setEnhance(true);editor.setEnhanceScale(1);editor.setEnhanceMagnitude(1);});
    account.generationStatus=500;
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/Synthetic generation failure/);
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/generate-image').length,1);
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generationStatus=0;account.generatedImage=await solidPng(page,256,256);
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/尺寸/);
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generatedImage=await solidPng(page,512,512);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    let wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(wire.parameters.steps,14);assert.equal(wire.parameters.sampler,'k_euler_ancestral');assert.equal(wire.parameters.cfg_rescale,undefined);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.enhanceScale),1);
    const count=await page.evaluate(()=>editor.session.versions.length);
    const held=new Promise(resolve=>{release=resolve;});
    await page.route('https://image.novelai.net/ai/generate-image',async route=>{await held;await route.abort().catch(()=>{});});
    await page.locator('#editorRun').click();await page.waitForFunction(()=>editor.snapshot().busy);
    await page.locator('#editorStop').click();await page.waitForFunction(()=>!editor.snapshot().busy);
    release();await page.unroute('https://image.novelai.net/ai/generate-image');
    assert.equal(await page.evaluate(()=>editor.session.versions.length),count);
    account.body.trainingStepsLeft.fixedTrainingStepsLeft=0;account.body.usage={percent:0,purchasedPercent:0,isNegative:true};
    // The gateway advertises Full: its presence must still not allow a downgrade.
    await page.evaluate(()=>editor.setModel('nai-diffusion-5-full'));
    const before=referencePosts(t).length;
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/不足/);
    assert.equal(referencePosts(t).length,before);
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});

test('Enhance Max: V5 capability, server flag, non-aligned output, model changes and preserved history', async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    t.png=await solidPng(page,832,1216);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'girl, Text:hello',negative_prompt:'watermark',seed:0});
    await page.locator('.enhance-toggle').click();
    await page.locator('#editorEnhanceScale').selectOption('max');
    await page.locator('#editorEnhanceMagnitude').selectOption('4');
    assert.match(await page.locator('.enhance-options output').textContent(),/1467×2144/);
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('.enhance-control').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('.enhance-control').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      assert.ok(await page.locator('#imageEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await page.screenshot({path:`.local/native-protocols/enhance-max-${width}.png`});
    }
    // A request-sized response must not be mistaken for the actual Max output.
    account.generatedImage=t.png;
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/尺寸/);
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generatedImage=await solidPng(page,1467,2144);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    let wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(wire.model,'nai-diffusion-5-full');assert.equal(wire.action,'img2img');
    assert.equal(wire.parameters.upscaled_enhance,true);
    assert.equal(wire.parameters.width,832);assert.equal(wire.parameters.height,1216);
    assert.equal(wire.parameters.image,t.png.toString('base64'));
    assert.equal(wire.parameters.strength,.6);assert.equal(wire.parameters.noise,0);
    assert.equal(wire.input,'girl, Text:hello');assert.equal(wire.parameters.v4_prompt.caption.base_caption,wire.input);
    const result=await page.evaluate(()=>({params:editor.snapshot().viewed.params,width:editor.snapshot().viewed.width,height:editor.snapshot().viewed.height,record:editor.record(editor.snapshot().viewed.recordId).params}));
    assert.equal(result.width,1467);assert.equal(result.height,2144);
    assert.equal(result.params.width,1467);assert.equal(result.params.height,2144);
    assert.equal(result.params.enhanceScale,'max');assert.equal(result.params.enhanceMagnitude,4);
    assert.equal(result.record.enhanceScale,'max');assert.equal(result.record.seed,wire.parameters.seed);
    assert.equal(result.params.basePrompt,'girl, Text:hello');
    assert.match(await page.locator('.editor-info-meta b').textContent(),/Enhance Max/);
    const board=await page.evaluate(()=>editor.session.id);
    await page.evaluate(()=>editor.createBoard());
    assert.equal(await page.evaluate(()=>editor.session.enhance.on),false);
    await page.evaluate(id=>editor.switchBoard(id),board);
    assert.equal(await page.locator('#editorEnhanceScale').inputValue(),'max');
    await page.evaluate(()=>editor.setModel('nai-diffusion-4-5-full'));
    assert.equal(await page.locator('#editorEnhanceScale option[value=max]').isDisabled(),true);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    const posts=referencePosts(t).length;
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).length,posts);
    assert.equal(await page.evaluate(()=>editor.session.enhance.scale),'max');
    await page.evaluate(()=>editor.setModel('nai-diffusion-5-full-medium'));
    assert.equal(await page.locator('#editorEnhanceScale option[value=max]').isDisabled(),false);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(wire.parameters.upscaled_enhance,true);assert.equal(wire.parameters.steps,14);
    assert.equal(wire.parameters.sampler,'k_euler_ancestral');assert.equal(wire.parameters.cfg_rescale,undefined);
    assert.equal(wire.input,'girl, Text:hello');
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

async function drawEditorFocus(page, from=[.25,.25], to=[.75,.75]) {
  if (await page.locator('#editorSelectFocus').getAttribute('aria-pressed') !== 'true') await page.locator('#editorSelectFocus').click();
  const b=await page.locator('#editorFocusRegion').boundingBox();
  await page.mouse.move(b.x+b.width*from[0],b.y+b.height*from[1]);await page.mouse.down();
  await page.mouse.move(b.x+b.width*to[0],b.y+b.height*to[1],{steps:12});await page.mouse.up();
  await page.getByRole('button',{name:'画笔',exact:true}).click();
}

async function chooseInpaint(page, focused) {
  await page.locator('#editorInpaintToggle').click();
  await page.getByRole('menuitemradio',{name:focused?'聚焦重绘':'普通重绘',exact:true}).click();
}

test('Focused Inpaint: split entry preserves mask and rectangle, supports keyboard menus and closes with its workspace',async()=>{
  const t=await open('nai-official-v1',true,'',undefined,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic'});
    assert.equal(await page.locator('.composer #editorFocus, .focus-control').count(),0);
    await chooseInpaint(page,false);
    assert.equal(await page.evaluate(()=>editor.session.mode),'inpaint');assert.equal(await page.evaluate(()=>editor.session.focus.on),false);
    await paintEditorMask(page);
    const maskBefore=await page.evaluate(()=>JSON.stringify(editor.session.mask));
    await page.locator('#editorInpaint').click();assert.equal(await page.evaluate(()=>editor.session.mode),'img2img');
    await chooseInpaint(page,true);
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'true');
    await drawEditorFocus(page);
    const rect=await page.evaluate(()=>({...editor.session.focus.rect}));
    assert.match(await page.locator('.focus-label').textContent(),/256×256 → 1024×1024/);
    await chooseInpaint(page,false);
    assert.equal(await page.locator('#editorSelectFocus').count(),0);
    assert.equal(await page.locator('#editorFocusRegion').isHidden(),true);
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.equal(await page.evaluate(()=>JSON.stringify(editor.session.mask)),maskBefore);
    await chooseInpaint(page,true);
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'false');
    await page.locator('#editorInpaint').click();assert.equal(await page.evaluate(()=>editor.session.mode),'img2img');
    await page.locator('#editorInpaint').click();assert.equal(await page.evaluate(()=>editor.snapshot().focusing),true);
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'false');
    await page.locator('#editorSelectFocus').click();
    await page.locator('#editorInpaintToggle').focus();await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-checked')==='true');
    await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'普通重绘');
    await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'聚焦重绘');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'editorInpaintToggle');
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'true');
    // Pointer dismissal and a second trigger click close instead of reopening the native popover.
    await page.locator('#editorInpaintToggle').click();await page.locator('#editorInpaintToggle').click();
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    await page.locator('#editorInpaintToggle').click();await page.getByRole('button',{name:'画笔',exact:true}).click();
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.waitForTimeout(100);
      await page.locator('#editorInpaintToggle').click();
      await page.waitForFunction(()=>{
        const menu=document.querySelector('#editorInpaintMenu').getBoundingClientRect(),anchor=document.querySelector('#editorInpaintToggle').getBoundingClientRect();
        return Math.min(Math.abs(anchor.top-menu.bottom),Math.abs(menu.top-anchor.bottom))<=5;
      });
      const menu=await page.locator('#editorInpaintMenu').boundingBox(),anchor=await page.locator('#editorInpaintToggle').boundingBox();
      assert.ok(menu.x>=8&&menu.x+menu.width<=width-7&&menu.y>=0&&menu.y+menu.height<=900);
      assert.ok(Math.min(Math.abs(anchor.y-menu.y-menu.height),Math.abs(menu.y-anchor.y-anchor.height))<=5,JSON.stringify({width,menu,anchor}));
      assert.equal(await page.locator('#editorInpaintMenu .menu-item').count(),2);
      const arrows=await page.evaluate(()=>['#editorInpaintToggle','#editorUpscaleToggle'].map(selector=>{
        const button=document.querySelector(selector).getBoundingClientRect(),arrow=document.querySelector(`${selector} .editor-caret`).getBoundingClientRect();
        return {dy:Math.abs(button.top+button.height/2-arrow.top-arrow.height/2),inside:arrow.left>=button.left&&arrow.right<=button.right,width:arrow.width,height:arrow.height};
      }));
      for(const arrow of arrows) { assert.ok(arrow.dy<.6&&arrow.inside);assert.equal(arrow.width,11);assert.equal(arrow.height,11); }
      assert.equal(await page.evaluate(()=>{
        const group=document.querySelector('.editor-picture-ops'),arrow=document.querySelector('#editorInpaintToggle'),line=group.nextElementSibling;
        return line.classList.contains('editor-sep')&&line.getBoundingClientRect().left>arrow.getBoundingClientRect().right&&getComputedStyle(arrow,'::before').content==='none';
      }),true,'the repaint arrow stays before the separator as part of the whole tool');
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#editorInpaintMenu').isVisible(),true,`menu visible at ${width}`);
      await page.screenshot({path:`.local/native-protocols/focus-menu-${width}.png`});
      assert.equal(await page.locator('#editorInpaintMenu').evaluate(el=>el.matches(':popover-open')),true,`menu remains open at ${width}`);
      await page.keyboard.press('Escape');
      await page.locator('.editor-info-meta').click();
      await page.screenshot({path:`.local/native-protocols/focus-toolbar-${width}.png`});
    }
    const board=await page.evaluate(()=>editor.session.id);
    await page.locator('#editorInpaintToggle').click();await page.evaluate(()=>editor.createBoard());
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    await page.evaluate(id=>editor.switchBoard(id),board);
    await page.locator('#editorInpaintToggle').click();await page.evaluate(()=>location.hash='#/image');
    await page.locator('#imageEditor').waitFor({state:'hidden'});
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    await page.evaluate(()=>location.hash='#/edit');await page.locator('#imageEditor').waitFor();
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.equal(await page.evaluate(()=>JSON.stringify(editor.session.mask)),maskBefore);
    // A gateway still supports ordinary inpaint, but cannot silently accept the focused pipeline.
    await page.evaluate(async()=>{
      const next=structuredClone(services.connections.configuration);delete next.connections.test;delete next.links.test;
      await services.connections.save(next);
    });
    await page.waitForFunction(()=>!editor.snapshot().focusAvailable&&editor.snapshot().model?.connection==='primary');
    await page.locator('#editorInpaintToggle').click();
    assert.equal(await page.getByRole('menuitemradio',{name:'聚焦重绘',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('menuitemradio',{name:'普通重绘',exact:true}).isEnabled(),true);
    await page.getByRole('menuitemradio',{name:'普通重绘',exact:true}).click();
    assert.equal(await page.evaluate(()=>editor.session.focus.on),false);
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Focused Inpaint: manual mask and rectangle send only the enlarged crop, composite full-size pixels, preserve recipes and isolate boards',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic detail',seed:0,cfgRescale:.6,
      placement:'manual',localCharacters:[{id:'c1',on:true,prompt:'girl',negative:'hat',centers:[{x:.3,y:.7}]}]});
    await page.evaluate(()=>editor.setMode('inpaint'));await paintEditorMask(page);
    await chooseInpaint(page,true);
    assert.match(await page.evaluate(()=>editor.snapshot().warning),/框选/);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,0);
    await drawEditorFocus(page);
    const plan=await page.evaluate(()=>editor.snapshot().session.focus.rect);
    assert.deepEqual(plan,{x:128,y:128,width:256,height:256});
    account.generatedImage=await solidPng(page,1024,1024);
    await page.locator('#editorRun').click();
    await page.waitForFunction(()=>!editor.snapshot().busy&&!editor.snapshot().preparing&&editor.snapshot().session.versions.length===2);
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    const wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(referencePosts(t).length,1);assert.equal(wire.action,'infill');assert.equal(wire.model,'nai-diffusion-5-full-inpainting');
    assert.equal(referencePosts(t).at(-1).path,'/ai/generate-image');
    assert.equal(wire.parameters.width,1024);assert.equal(wire.parameters.height,1024);assert.equal(wire.parameters.seed,0);
    assert.equal(JSON.stringify(wire).includes('inpaintFocus'),false);
    assert.deepEqual(wire.parameters.v4_prompt.caption.char_captions[0].centers,[{x:.09999999999999998,y:.8999999999999999}]);
    const pixels=await page.evaluate(async()=>{
      const v=editor.snapshot().viewed,bitmap=await createImageBitmap(v.blob),c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      return {width:c.width,height:c.height,outside:[...ctx.getImageData(0,0,1,1).data],inside:[...ctx.getImageData(256,256,1,1).data],context:[...ctx.getImageData(140,140,1,1).data],params:v.params,record:editor.record(editor.snapshot().viewed.recordId).params};
    });
    assert.equal(pixels.width,512);assert.equal(pixels.height,512);assert.deepEqual(pixels.outside,[80,65,124,255]);
    assert.deepEqual(pixels.inside,[224,64,80,255]);assert.deepEqual(pixels.context,[196,182,255,255]);
    assert.equal(pixels.params.width,512);assert.equal(pixels.params.height,512);assert.equal(pixels.params.inpaintFocus.targetWidth,1024);
    assert.deepEqual(pixels.params.localCharacters[0].centers,[{x:.3,y:.7}]);assert.deepEqual(pixels.record.inpaintFocus,pixels.params.inpaintFocus);
    for(const key of ['init_image','mask_image','focusOriginal'])assert.equal(key in pixels.params,false);
    const board=await page.evaluate(()=>editor.snapshot().session.id);
    await page.evaluate(()=>editor.setBase(editor.snapshot().viewed.id));
    assert.deepEqual(await page.evaluate(()=>editor.snapshot().session.focus.rect),plan);
    assert.equal(await page.locator('#editorRun').isEnabled(),true);
    await page.evaluate(async()=>{const b=editor.session.versions[0].blob;await editor.addSource(b,'independent.png');});
    assert.equal(await page.evaluate(()=>editor.snapshot().session.focus.on),false);
    await page.evaluate(id=>editor.switchBoard(id),board);
    assert.deepEqual(await page.evaluate(()=>editor.snapshot().session.focus.rect),plan);
    // Switching dimensions clears only the focus/mask geometry, then returning does not resurrect it.
    await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=640;c.height=512;const blob=await new Promise(r=>c.toBlob(r));
      const start=editor.beginExternalEdit();await editor.applyExternalEdit(start.id,{mode:'image',image:blob});});
    assert.equal(await page.evaluate(()=>editor.snapshot().session.focus.rect),null);
    await page.evaluate(()=>editor.setBase(1));assert.equal(await page.evaluate(()=>editor.snapshot().session.focus.rect),null);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Focused Inpaint: rectangle gestures commit once, move/resize, cancel cleanly, survive pause and use compact four-width controls',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic'});
    await page.evaluate(()=>editor.setMode('inpaint'));await paintEditorMask(page);await chooseInpaint(page,true);
    // Account refresh is independent of pointer gestures; finish it before counting.
    await page.waitForFunction(()=>!!editor.snapshot().quota && editor.snapshot().warning.includes('框选') && !['idle','loading'].includes(drawing.snapshot().quote.status));
    await page.evaluate(()=>{window.focusEvents=0;window.stopFocusCount=editor.subscribe(()=>window.focusEvents++);});
    const host=page.locator('#editorFocusRegion'),box=await host.boundingBox();
    await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75,{steps:30});
    assert.equal(await page.evaluate(()=>window.focusEvents),0);assert.equal(await page.evaluate(()=>editor.session.focus.rect),null);
    await page.mouse.up();assert.ok(await page.evaluate(()=>window.focusEvents)<=3);
    const rect=await page.evaluate(()=>editor.session.focus.rect);assert.deepEqual(rect,{x:128,y:128,width:256,height:256});
    const current=await page.locator('.focus-box').boundingBox();
    await page.mouse.move(current.x+current.width/2,current.y+current.height/2);await page.mouse.down();
    await page.mouse.move(current.x+current.width/2+box.width/16,current.y+current.height/2,{steps:10});await page.mouse.up();
    assert.equal(await page.evaluate(()=>editor.session.focus.rect.x),160);
    const corner=await page.locator('.focus-handle[data-corner=se]').boundingBox();
    await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();
    await page.mouse.move(corner.x+corner.width/2+box.width/16,corner.y+corner.height/2+box.height/16,{steps:10});await page.mouse.up();
    const resized=await page.evaluate(()=>editor.session.focus.rect);assert.ok(resized.width>256);assert.ok(resized.height>256);
    await page.locator('.focus-box').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>editor.session.focus.rect.x),152);
    const before=await page.evaluate(()=>({...editor.session.focus.rect}));
    await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2,{steps:5});
    await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),before);
    await page.locator('#editorSelectFocus').click();await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+30,box.y+30);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),before);
    await page.getByRole('button',{name:'画笔',exact:true}).click();
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    assert.equal(await page.locator('#editorRun').isEnabled(),true);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});await page.waitForTimeout(100);
      assert.ok(await page.locator('#editorSelectFocus').isVisible());
      const metrics=await page.evaluate(()=>({w:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(metrics.scroll<=metrics.w+1);
      await page.screenshot({path:`.local/native-protocols/focus-${width}.png`});
    }
    await page.evaluate(()=>{stopFocusCount();location.hash='#/image';});await page.locator('#imageEditor').waitFor({state:'hidden'});
    await page.evaluate(()=>location.hash='#/edit');await host.waitFor();assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),before);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Focused Inpaint: outside coverage, empty masks, failure, cancel and wrong-size output never save or retry',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'synthetic'});
    await page.evaluate(()=>{editor.setMode('inpaint');editor.setFocus(true);editor.setFocusRect({x:128,y:128,width:256,height:256});});
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,0);
    await paintEditorMask(page);
    await page.evaluate(()=>editor.setFocusRect({x:0,y:0,width:128,height:128}));await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().edit.error),/全部蒙版/);assert.equal(referencePosts(t).length,0);
    await page.evaluate(()=>editor.setFocusRect({x:128,y:128,width:256,height:256}));
    account.generatedImage=await solidPng(page,512,512);await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/聚焦.*尺寸/);assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generationStatus=500;await page.evaluate(()=>editor.run());assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generationStatus=0;account.generatedImage=await solidPng(page,1024,1024);
    let arrived;const entered=new Promise(r=>arrived=r);account.onGenerate=async()=>{arrived();await new Promise(r=>release=r);};
    const pending=page.evaluate(()=>editor.run());await entered;await page.evaluate(()=>editor.cancel());release();await pending;
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);assert.equal(referencePosts(t).length,3);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});

test('NAI local estimates and model token budgets share compact IMAGE/EDIT UI at four widths', async()=>{
  const account={status:200,body:{active:true,tier:3,usage:{isNegative:false,percent:100},trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-4-5-full',prompt:'1girl, blue hair',negative:'',width:832,height:1216,steps:23}));
    await page.waitForFunction(()=>drawing.snapshot().quote.quote?.opusFree);
    await page.waitForFunction(()=>document.querySelector('#tab-prompt .tab-count')?.textContent==='6');
    assert.equal(await page.locator('#goCost').isVisible(),false);
    await page.evaluate(()=>drawing.patch({steps:29}));
    await page.waitForFunction(()=>drawing.snapshot().quote.quote?.cost===20);
    assert.match(await page.locator('#goCost').textContent(),/≈20 Anlas/);
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-5-full',steps:23}));
    await page.waitForFunction(()=>drawing.snapshot().quote.quote?.usagePercent>0);
    assert.equal(await page.locator('#goCost').isVisible(),false);
    await page.waitForFunction(()=>document.querySelector('#tab-prompt .tab-count')?.dataset.budget==='1471');
    await page.evaluate(()=>ui.notices.value.forEach(n=>ui.dismissNotice(n.id)));
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.screenshot({path:`.local/native-protocols/nai-input-${width}.png`});
      const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getBoundingClientRect().height>0).slice(0,20).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,100)}))}));
      assert.ok(overflow.scroll<=width+1,JSON.stringify(overflow));
    }
    await page.evaluate(()=>drawing.patch({model:'nai-diffusion-4-5-full',prompt:'Text: '+'猫'.repeat(119)}));
    await page.waitForFunction(()=>document.querySelector('#tab-prompt .nai-over'));
    const before=t.requests.filter(r=>r.method==='POST').length;
    await page.evaluate(()=>drawing.run());
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/Text:.*119.*118/);
    assert.equal(t.requests.filter(r=>r.method==='POST').length,before);
    await page.evaluate(()=>drawing.patch({prompt:'cat, '.repeat(400)}));
    await page.waitForFunction(()=>document.querySelector('#tab-prompt .nai-over')?.title.includes('截断'));
    await page.evaluate(async png=>editor.open('image',new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}),'token-test.png',{mode:'img2img',params:{model:'nai-diffusion-4-5-full',prompt:'1girl, blue hair'}}),t.png.toString('base64'));
    await page.locator('#imageEditor[data-active=true]').waitFor();
    await page.waitForFunction(()=>document.querySelector('#imageEditor .tab-count')?.dataset.budget==='512');
    assert.deepEqual(t.errors,[]);
  }finally{await t.context.close();}
});

test('NAI hidden PNG imports Vibe encoding only on Apply, preserves Precise, and generates with cached bytes',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await page.evaluate(async png=>{
      await drawing.patch({model:'nai-diffusion-4-5-full'});
      const rows=await services.references.upload([new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'precise.png',{type:'image/png'})],'precise','nai-diffusion-4-5-full');
      await drawing.editReferences({...drawing.snapshot().form.naiReferences,precise:rows});
    },t.png.toString('base64'));
    const bytes=await page.evaluate(async()=>{
      const comment={model:'nai-diffusion-4-5-full',prompt:'hidden test',seed:0,width:832,height:1216,steps:23,reference_image_multiple:['AAH+/w=='],reference_strength_multiple:[.6],reference_information_extracted_multiple:[.7]};
      const gzip=new Uint8Array(await new Response(new Blob([JSON.stringify({Software:'NovelAI',Comment:JSON.stringify(comment)})]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      const header=new Uint8Array(4);new DataView(header.buffer).setUint32(0,gzip.length*8);
      const all=new Uint8Array(19+gzip.length);all.set(new TextEncoder().encode('stealth_pngcomp'));all.set(header,15);all.set(gzip,19);
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
      const ctx=canvas.getContext('2d'),image=ctx.createImageData(128,128);image.data.fill(255);
      for(let b=0;b<all.length;b++)for(let bit=0;bit<8;bit++){const p=b*8+bit;image.data[4*(p%128*128+Math.floor(p/128))+3]=254|((all[b]>>(7-bit))&1);}
      ctx.putImageData(image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.locator('#importFile').setInputFiles({name:'synthetic-hidden.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
    await page.locator('#importApply').waitFor();
    assert.equal(await page.locator('input[value=pngVibes]').isChecked(),true);
    assert.equal(await page.evaluate(async()=>{const tx=services.databases.transaction('koma-image-favorites','vibeEncodings');return await new Promise(resolve=>{const r=tx.objectStore('vibeEncodings').count();r.onsuccess=()=>resolve(r.result);});}),0);
    await page.locator('#importApply').click();
    await page.waitForFunction(()=>drawing.snapshot().form.naiReferences.active==='vibe');
    const state=await page.evaluate(()=>{const refs=drawing.snapshot().form.naiReferences,r=refs.vibe[0];return{prompt:drawing.snapshot().form.prompt,precise:refs.precise.length,original:services.references.original(r.assetId),pending:services.references.pending(r,drawing.snapshot().form.model)};});
    assert.deepEqual(state,{prompt:'hidden test',precise:1,original:false,pending:false});
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,0);
    assert.deepEqual(JSON.parse(referencePosts(t).at(-1).body).parameters.reference_image_multiple,['AAH+/w==']);
    assert.deepEqual(t.errors,[]);
  }finally{await t.context.close();}
});
