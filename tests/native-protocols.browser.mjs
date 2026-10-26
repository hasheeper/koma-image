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
      if (url.pathname.endsWith("/image/models")) return route.fulfill({ json: { studio_features: { version: 2, max_cost: true }, models: {
        ...Object.fromEntries(["nai-diffusion-5-full", "nai-diffusion-5-curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"].map(id => [id, { provider: "novelai", operations: ["generate", "edit"], tools: ["img2img", "inpaint", "upscale"], quota_group: "novelai-v5" }])),
        "gpt-image-1.5": { editor_family: "gpt", operations: ["generate", "edit"], tools: ["image-edit"], quota_group: "openai" },
      } } });
      if (url.pathname.endsWith("/media/quota")) return route.fulfill({ json: { credits: { remaining: 5000 }, images: { "novelai-v5": { remaining: 174, limit: 250 }, openai: { remaining: 50, limit: 100 } } } });
      if (url.pathname.endsWith("/token_stats_data")) return route.fulfill({ json: { temp_limits: { is_temp: false } } });
      if (url.pathname.endsWith("/estimate")) return route.fulfill({ json: { cost: 0 } });
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
    if (request.method() === "POST" && url.pathname === "/ai/generate-image") return account.generationStatus
      ? route.fulfill({ status: account.generationStatus, json: { error: "Synthetic generation failure" } })
      : route.fulfill({ contentType: "application/zip", body: zip });
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
    await page.waitForFunction(() => editor.snapshot().model?.connection === "primary");
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
    assert.equal(body.parameters.steps, 14); assert.equal(body.parameters.negative_prompt, "");
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

test("NovelAI basic: ZIP generation, non-free wallet, image editor without quote and no unsupported tools", async () => {
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
    await page.locator("#imageEditor[open]").waitFor();
    await page.waitForFunction(() => editor.snapshot().edit.canRun && editor.snapshot().edit.price === "费用未知");
    assert.equal(await page.locator('#editorRun .cost-tag').count(), 0);
    await page.evaluate(() => editor.run());
    await page.waitForFunction(() => !editor.snapshot().busy && editor.snapshot().session.versions.some(v => v.kind === "result"));
    const posts = t.requests.filter(r => r.method === "POST").map(r => JSON.parse(r.body));
    assert.equal(posts.length, 2);
    assert.equal(posts[0].parameters.seed, 0);
    assert.equal(posts[1].action, "img2img");
    assert.ok(posts.every(body => !Object.hasOwn(body, "max_cost")));
    assert.deepEqual(await page.evaluate(() => [...new Set(editor.snapshot().models.flatMap(m => m.tools))]), ["img2img"]);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
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
    assert.equal(body.parameters.negative_prompt, "");
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
