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
async function open(profile, seed = true, customId = "") {
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
  if (seed) await context.addInitScript(profile => {
    if (!/^https?:/.test(location.protocol) || localStorage.getItem("koma.routing.v1")) return;
    localStorage.setItem("koma.routing.v1", JSON.stringify({ version: 1, connections: { test: { id: "test", name: "模拟协议", baseUrl: profile === "nai-official-v1" ? "https://image.novelai.net" : "https://gateway.example.test/service", profileId: profile, credentialRef: "test-key", revision: "rev1" } }, links: {} }));
    sessionStorage.setItem("koma.session.keys", JSON.stringify({ "test-key": "synthetic-native-only" }));
  }, profile);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (!["gateway.example.test", "api.novelai.net", "image.novelai.net"].includes(url.hostname)) {
      errors.push(`unexpected external origin: ${url.origin}`); return route.abort();
    }
    const record = { url: url.href, path: url.pathname, method: request.method(), headers: request.headers(), body: request.postData() };
    requests.push(record);
    if (url.pathname.endsWith("/v1/models")) return route.fulfill({ json: { data: [{ id: customId || "gpt-image-1.5" }] } });
    if (url.pathname.endsWith("/v1beta/models")) return route.fulfill({ json: { models: [{ name: "models/" + (customId || "gemini-2.5-flash-image") }], nextPageToken: "repeated-token" } });
    if (url.pathname === "/user/subscription") return route.fulfill({ json: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 100 } } });
    if (request.method() === "POST" && /\/images\/(generations|edits)$/.test(url.pathname))
      return route.fulfill({ json: { data: [{ b64_json: png.toString("base64") }] } });
    if (request.method() === "POST" && url.pathname.endsWith(":generateContent"))
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "模拟结果" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] } });
    if (request.method() === "POST" && url.pathname === "/ai/generate-image") return route.fulfill({ contentType: "application/zip", body: zip });
    errors.push(`unexpected endpoint: ${url.pathname}`); return route.fulfill({ status: 404, json: { error: "Unexpected protocol request" } });
  });
  await page.goto(origin + (profile === "nai-official-v1" ? "/#/image" : "/#/chat"));
  await page.waitForFunction(() => !!document.body.__vue_app__?._instance);
  await page.evaluate(() => {
    const p = document.body.__vue_app__._instance.provides, a = document.body.__vue_app__._context.provides;
    for (const name of ["chat", "editor", "drawing", "ui"])
      window[name] = p[Object.getOwnPropertySymbols(p).find(k => k.description === name)];
    window.services = a[Object.getOwnPropertySymbols(a).find(k => k.description === "application-services")];
  });
  return { page, context, requests, errors, png };
}

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

test("NovelAI basic: ZIP generation, non-free wallet, image editor without quote and no unsupported tools", async () => {
  const t = await open("nai-official-v1"), { page } = t;
  try {
    await page.waitForFunction(() => drawing.snapshot().model && drawing.snapshot().quota);
    assert.match(await page.locator("#meters:visible").textContent(), /1,100.*Anlas/);
    await page.evaluate(async () => { await drawing.patch({ prompt: "模拟画面", seed: "0" }); await drawing.run(); });
    await page.waitForFunction(() => !!drawing.snapshot().current && !drawing.snapshot().busy);
    assert.equal(await page.evaluate(() => drawing.snapshot().current.quote), null);
    await page.evaluate(async png => {
      await editor.open("image", new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: "image/png" }), "synthetic.png", { mode: "img2img" });
    }, t.png.toString("base64"));
    await page.locator("#imageEditor[open]").waitFor();
    await page.waitForFunction(() => editor.snapshot().edit.canRun && editor.snapshot().edit.price === "费用未知");
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
