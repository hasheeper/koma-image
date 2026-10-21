import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

let server, browser, origin;
before(async () => {
  await mkdir(".local/ask", { recursive: true });
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

const hosts = { image: "gateway.example.test", chat: "chat.example.test", claude: "claude.example.test" };
const reasoning = /^\/v1\/(?:chat\/completions|messages)$/;
async function open(hash, { ready = "#settingsPanel[open]", ask = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), requests = [], errors = [], llm = [], calls = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(({ hosts, ask }) => {
    if (!/^https?:/.test(location.protocol) || localStorage.getItem("koma.routing.v1")) return;
    const c = (id, name, baseUrl, profileId) => ({ id, name, baseUrl, profileId, credentialRef: `${id}-key`, revision: "rev1" });
    localStorage.setItem("koma.routing.v1", JSON.stringify({ version: 1, links: {}, connections: {
      image: c("image", "图像连接", `https://${hosts.image}/service`, "openai-images-v1"),
      chat: c("chat", "推理 Chat", `https://${hosts.chat}/v1`, "openai-chat-v1"),
      claude: c("claude", "推理 Messages", `https://${hosts.claude}`, "anthropic-messages-v1"),
    } }));
    if (ask) localStorage.setItem("koma.ask.v1", JSON.stringify(ask));
    sessionStorage.setItem("koma.session.keys", JSON.stringify({ "image-key": "synthetic-image", "chat-key": "synthetic-chat", "claude-key": "synthetic-claude" }));
  }, { hosts, ask });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (!Object.values(hosts).includes(url.hostname)) {
      errors.push(`unexpected external origin: ${url.origin}`);
      return route.abort();
    }
    requests.push({ host: url.hostname, path: url.pathname, method: request.method(), headers: request.headers() });
    if (request.method() === "GET" && url.pathname.endsWith("/v1/models"))
      return route.fulfill({ json: { data: url.hostname === hosts.image ? [{ id: "gpt-image-1.5" }] : [{ id: "reasoning-b" }, { id: "reasoning-a" }] } });
    if (request.method() === "POST" && url.hostname !== hosts.image && reasoning.test(url.pathname)) {
      // A scripted model: each request takes the next reply in line.
      const reply = llm.shift() ?? { body: openai(text("（脚本已用完）"), end()) };
      calls.push({ host: url.hostname, path: url.pathname, headers: request.headers(), raw: request.postData(), body: JSON.parse(request.postData()) });
      if (reply.delay) await new Promise((done) => setTimeout(done, reply.delay));
      try {
        await route.fulfill({ status: reply.status ?? 200, contentType: reply.type ?? "text/event-stream", body: reply.body });
      } catch {
        // The page aborted the request first.
      }
      return;
    }
    errors.push(`unexpected endpoint: ${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 404, json: { error: "Unexpected request" } });
  });
  await page.goto(origin + hash);
  await page.waitForSelector(ready);
  return { page, context, requests, errors, llm, calls };
}
const openai = (...chunks) => [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
const text = (content) => ({ choices: [{ index: 0, delta: { content } }] });
const tool = (id, name) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "{}" } }] } }] });
const end = (finish_reason = "stop") => ({ choices: [{ index: 0, delta: {}, finish_reason }], usage: { prompt_tokens: 1800, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1500 } } });
const anthropic = (...events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const askSettings = (over = {}) => ({ version: 1, connectionId: "chat", model: "reasoning-a", images: true, preference: "", words: [], alwaysCodec: false, ...over });
/** Generation, edit, upscale, quote and balance endpoints: ASK must never reach them. */
const generation = (requests) => requests.filter((r) => r.host === hosts.image && !r.path.endsWith("/v1/models"));
async function bind(page) {
  await page.evaluate(() => {
    const p = document.body.__vue_app__._instance.provides;
    for (const name of ["ask", "drawing", "editor", "chat"])
      window[name] = p[Object.getOwnPropertySymbols(p).find((k) => k.description === name)];
  });
}
async function addImage(page, prompt) {
  return page.evaluate(async (prompt) => {
    const canvas = new OffscreenCanvas(256, 384);
    const g = canvas.getContext("2d");
    g.fillStyle = "#7b3446";
    g.fillRect(0, 0, 256, 384);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const record = await drawing.addExternal(blob, { width: 256, height: 384 }, { prompt, basePrompt: prompt, model: "gpt-image-1.5", modelName: "GPT Image", seed: 7 }, null);
    return record.id;
  }, prompt);
}
const drawer = (page) => page.locator("#askDrawer");
const route = (page, hash) => page.evaluate((hash) => (location.hash = hash), hash);
const stored = (page, key) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);

test("ASK settings: own group, reasoning connections only, adult gate off by default, word list behind it", async () => {
  const { page, context, requests, errors } = await open("/#/image/settings/ask");
  try {
    const nav = page.locator(".set-nav button", { hasText: "ASK" });
    assert.equal(await nav.getAttribute("aria-current"), "true");
    const options = await page.locator("#askConnection option").allTextContents();
    assert.deepEqual(options.map((o) => o.trim()), ["选择连接", "推理 Chat", "推理 Messages"]);
    assert.equal(await page.locator("#askAdult").isChecked(), false);
    assert.equal(await page.getByRole("region", { name: "词表" }).count(), 0);
    assert.equal(await page.getByText("词表", { exact: true }).count(), 0);
    assert.equal(await page.locator("#askImages").isChecked(), true);

    await page.locator("#askConnection").selectOption("claude");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.connectionId === "claude");
    await page.getByRole("button", { name: "获取", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#askModelIds option").length === 2);
    const fetched = requests.find((r) => r.host === hosts.claude);
    assert.equal(fetched.path, "/v1/models");
    assert.equal(fetched.headers["x-api-key"], "synthetic-claude");
    assert.equal(fetched.headers["anthropic-version"], "2023-06-01");
    await page.locator("#askModel").fill("reasoning-a");
    await page.locator("#askModel").press("Enter");
    await page.locator('label[for="askImages"]').click();
    await page.locator("#askPreference").fill("先说结论");
    await page.locator("#askPreference").blur();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.preference === "先说结论");
    assert.deepEqual(await stored(page, "koma.ask.v1"), { version: 1, connectionId: "claude", model: "reasoning-a", images: false, preference: "先说结论", words: [], alwaysCodec: false });

    await page.locator('label[for="askAdult"]').click();
    await page.waitForFunction(() => localStorage.getItem("koma.ask.adult.v1") === "true");
    const words = page.getByRole("region", { name: "词表" });
    await words.waitFor();
    assert.ok((await words.getByRole("list", { name: "内置词条" }).locator("li").count()) > 10);
    const add = words.getByRole("textbox", { name: "添加词条" });
    await add.fill("See_Through");
    await words.getByRole("button", { name: "添加", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.words?.[0] === "see through");
    for (const term of ["LOLI", "guro"]) {
      await add.fill(term);
      await words.getByRole("button", { name: "添加", exact: true }).click();
      assert.equal((await words.getByRole("alert").textContent()).trim(), "该词不在可混淆范围");
    }
    assert.deepEqual((await stored(page, "koma.ask.v1")).words, ["see through"]);
    await words.getByRole("button", { name: "删除 see through", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.words?.length === 0);
    await page.locator('label[for="askAdult"]').click();
    await page.waitForFunction(() => localStorage.getItem("koma.ask.adult.v1") === "false");
    assert.equal(await page.getByRole("region", { name: "词表" }).count(), 0);

    await page.reload();
    await page.waitForSelector("#settingsPanel[open]");
    assert.equal(await page.locator("#askModel").inputValue(), "reasoning-a");
    assert.equal(await page.locator("#askConnection").inputValue(), "claude");
    assert.equal(await page.locator("#askImages").isChecked(), false);

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(80);
      assert.ok(await page.locator("#settingsPanel").evaluate((el) => el.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
      await page.screenshot({ path: `.local/ask/settings-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    assert.ok(requests.every((r) => r.method === "GET" && r.path.endsWith("/v1/models")));
  } finally {
    await context.close();
  }
});

test("ASK settings leave image work alone: cards, model sources and the protocol list", async () => {
  const { page, context, requests, errors } = await open("/#/image/settings/connections");
  try {
    await page.waitForFunction(() => [...document.querySelectorAll(".conn-card .st")].every((s) => s.dataset.s === "ok"));
    const card = (name) => page.locator(".conn-card", { hasText: name });
    assert.match(await card("推理 Chat").locator(".conn-models").textContent(), /ASK 模型\s*2 个 ID/);
    assert.match(await card("图像连接").locator(".conn-models").textContent(), /1 个 · 已用/);
    await card("推理 Messages").locator(".conn-models").click();
    await page.waitForFunction(() => location.hash.endsWith("/settings/ask"));
    // Expanded image models list their sources; reasoning connections are not among them.
    await route(page, "#/image/settings/models");
    await page.getByRole("button", { name: /^展开 .+ 的来源$/ }).first().click();
    await page.locator(".sm-lines .sm-conn").first().waitFor();
    assert.deepEqual([...new Set(await page.locator(".sm-lines .sm-conn").allTextContents())], ["图像连接"]);
    await route(page, "#/image/settings/connections");
    await page.getByRole("button", { name: "添加连接", exact: true }).click();
    const labels = await page.locator("#connectionProtocol option").allTextContents();
    assert.ok(labels.includes("OpenAI Chat 兼容 · ASK") && labels.includes("Anthropic Messages · ASK"));
    await page.keyboard.press("Escape");
    // The chat workspace catalog still comes only from the image connection.
    await route(page, "#/chat");
    await page.waitForFunction(() => !document.querySelector("#settingsPanel[open]"));
    await page.waitForTimeout(400);
    assert.deepEqual(errors, []);
    assert.ok(requests.every((r) => r.method === "GET" && r.path.endsWith("/v1/models")), JSON.stringify(requests));
    assert.equal(requests.some((r) => /chat\/completions|messages|images/.test(r.path)), false);
  } finally {
    await context.close();
  }
});

test("ASK drawer: Ctrl+J toggles, a scripted tool turn streams and is announced once, prefix grows at the tail, no generation requests", async () => {
  const { page, context, requests, errors, llm, calls } = await open("/#/image", { ready: ".switcher", ask: askSettings({ preference: "先说结论" }) });
  try {
    await bind(page);
    await addImage(page, "1girl, crimson theme, blue eyes");
    assert.equal(await drawer(page).isVisible(), false);
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "askPrompt");
    assert.equal((await drawer(page).locator(".ask-capsule-id").textContent()).trim(), "#h1");
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor({ state: "hidden" });
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor();

    llm.push(
      { body: openai(text("先读"), text("一下状态。"), tool("call_1", "get_state"), end("tool_calls")) },
      { body: openai(text("**原因**是 `crimson theme` 压过了 blue eyes。\n\n"), text("- #h1 的色调词把红色带进了眼睛。"), end()) },
    );
    await page.locator("#askPrompt").fill("为什么 #h1 还是红眼睛？");
    await drawer(page).locator(".ask-composer").screenshot({ path: ".local/ask/composer-ready.png" });
    await page.locator("#askPrompt").press("Enter");
    const turn = drawer(page).locator(".ask-turn").last();
    await turn.and(page.locator('[data-status="done"]')).waitFor();
    assert.equal(await page.locator("#askPrompt").inputValue(), "");
    assert.match(await turn.locator(".ask-q").textContent(), /为什么 #h1 还是红眼睛/);
    assert.equal(await turn.locator(".ask-q .ask-id").textContent(), "#h1");
    assert.deepEqual(
      await turn.locator(".ask-tool").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("span")].map((s) => s.textContent).join(" "))),
      ["已读取 工作台 1 张历史"],
    );
    assert.match(await turn.locator(".ask-lead").textContent(), /原因是 crimson theme 压过了 blue eyes/);
    assert.equal(await turn.locator(".ask-lead code").textContent(), "crimson theme");
    assert.equal(await turn.locator("li .ask-id").textContent(), "#h1");
    const announced = await drawer(page).locator('[aria-live="polite"]').textContent();
    assert.match(announced, /先读一下状态。[\s\S]*原因[\s\S]*#h1 的色调词/);
    assert.equal(await page.evaluate(() => ask.announce.value.id), 1, "one announcement per finished turn");
    assert.match(await drawer(page).locator(".ask-spent").textContent(), /tokens/);
    await drawer(page).screenshot({ path: ".local/ask/drawer-turn.png" });

    assert.equal(calls.length, 2);
    const [first, second] = calls;
    assert.equal(first.headers.authorization, "Bearer synthetic-chat");
    assert.equal(first.body.model, "reasoning-a");
    assert.deepEqual(first.body.tools.map((t) => t.function.name), ["get_state"]);
    assert.match(first.body.messages[0].content, /你是 Koma ASK[\s\S]*<user_preferences>\n先说结论\n<\/user_preferences>/);
    const question = first.body.messages.at(-1).content;
    // Text-only user turns flatten to one string: the locked state, then the question.
    assert.match(question, /^<workspace_state>\n[\s\S]*1girl, crimson theme, blue eyes[\s\S]*\n<\/workspace_state>\n\n为什么 #h1 还是红眼睛？$/);
    // Messages close the body, so the next step only appends bytes.
    assert.ok(second.raw.startsWith(first.raw.slice(0, -2)));
    assert.equal(second.body.messages.at(-1).role, "tool");
    assert.match(second.body.messages.at(-1).content, /<workspace_state>/);

    // A second turn carries the first as history and a fresh state at the tail.
    llm.push({ body: openai(text("好的。"), end()) });
    await page.locator("#askPrompt").fill("再说一遍");
    await page.locator("#askPrompt").press("Enter");
    await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
    const third = calls[2];
    assert.ok(third.raw.startsWith(second.raw.slice(0, -2)));
    assert.equal(third.body.messages.filter((m) => m.role === "user").length, 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(generation(requests), []);
    assert.ok(requests.every((r) => r.method === "GET" ? r.path.endsWith("/v1/models") : reasoning.test(r.path)));
  } finally {
    await context.close();
  }
});

test("ASK drawer: Esc closes the popover, then stops the turn, then the drawer; a refused turn rolls back and retries only on click", async () => {
  const { page, context, requests, errors, llm, calls } = await open("/#/chat", { ready: ".switcher", ask: askSettings({ preference: "先说结论" }) });
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  try {
    await bind(page);
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor();
    const chip = drawer(page).locator(".ask-pref-chip");
    await chip.click();
    await page.locator("#askPreferencePreview").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#askPreferencePreview").waitFor({ state: "hidden" });
    assert.equal(await drawer(page).isVisible(), true);

    llm.push({ delay: 4000, body: openai(text("太迟了"), end()) });
    await page.locator("#askPrompt").fill("越改越糊？");
    await page.locator("#askPrompt").press("Enter");
    await drawer(page).locator('.ask-turn[data-status="thinking"]').waitFor();
    const motion = () =>
      drawer(page).evaluate((el) => [
        getComputedStyle(el.querySelector('.ask-tool[data-state="run"] .ask-tool-text')).animationName,
        getComputedStyle(el.querySelector(".ask-head .think rect")).animationName,
      ]);
    // The suite runs with reduced motion: no pulse, no sheen; both return without it.
    assert.deepEqual(await motion(), ["none", "none"]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.deepEqual((await motion()).map((name) => name.replace(/-[0-9a-f]{8}$/, "")), ["ask-sheen", "ask-pulse"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await drawer(page).locator(".ask-stop").isVisible(), true);
    await page.keyboard.press("Escape");
    const stopped = drawer(page).locator('.ask-turn[data-status="stopped"]');
    await stopped.waitFor();
    assert.match(await stopped.locator(".ask-fail-text").textContent(), /已停止，本轮未计入对话/);
    assert.equal(await drawer(page).isVisible(), true);
    await page.keyboard.press("Escape");
    await drawer(page).waitFor({ state: "hidden" });
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor();
    assert.equal(await stopped.count(), 1);

    // Refused by the channel: rolled back; codec retry hidden until adult is confirmed.
    llm.push({ status: 400, type: "application/json", body: JSON.stringify({ error: { message: "content_filter: request blocked" } }) });
    await page.locator("#askPrompt").fill("nsfw 标签为什么不生效");
    await page.locator("#askPrompt").press("Enter");
    const failed = drawer(page).locator('.ask-turn[data-status="failed"]');
    await failed.waitFor();
    assert.match(await failed.locator(".ask-fail-text").textContent(), /content_filter/);
    assert.deepEqual((await failed.locator(".ask-fail-actions button").allTextContents()).map((t) => t.trim()), ["仅发元数据重试", "设置"]);
    assert.match(await failed.locator(".ask-meta").textContent(), /确认成年内容后启用词表混淆/);
    await drawer(page).screenshot({ path: ".local/ask/drawer-failed.png" });
    const before = calls.length;
    await page.waitForTimeout(300);
    assert.equal(calls.length, before, "no automatic retry");

    llm.push({ body: openai(text("仅凭元数据：权重冲突。"), end()) });
    await failed.getByRole("button", { name: "仅发元数据重试" }).click();
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(await failed.count(), 0);
    const retried = calls.at(-1).body;
    // Neither the stopped nor the refused turn reached the history.
    assert.equal(retried.messages.filter((m) => m.role === "user").length, 1);
    assert.ok(retried.messages.at(-1).content.endsWith("</workspace_state>\n\nnsfw 标签为什么不生效"));

    // After confirming adult content, the codec retry appears and encodes outbound only.
    await page.evaluate(() => localStorage.setItem("koma.ask.adult.v1", "true"));
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "koma.ask.adult.v1" })));
    await page.waitForFunction(() => ask.adult.value === true);
    llm.push({ status: 403, type: "application/json", body: JSON.stringify({ error: { message: "blocked by moderation" } }) });
    await page.locator("#askPrompt").fill("nsfw 还是被拦截");
    await page.locator("#askPrompt").press("Enter");
    await failed.waitFor();
    assert.deepEqual((await failed.locator(".ask-fail-actions button").allTextContents()).map((t) => t.trim()), ["启用词表混淆并重试", "仅发元数据重试"]);
    llm.push({ body: openai(text("@t_001 本身没问题。"), end()) });
    await failed.getByRole("button", { name: "启用词表混淆并重试" }).click();
    await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
    const encoded = calls.at(-1);
    assert.equal(encoded.raw.includes("nsfw 还是被拦截"), false);
    assert.ok(encoded.body.messages.at(-1).content.endsWith("\n\n@t_001 还是被拦截"));
    assert.match(encoded.body.messages[0].content, /<codebook>/);
    assert.match(await drawer(page).locator(".ask-turn").last().locator(".ask-q").textContent(), /nsfw 还是被拦截/);
    assert.match(await drawer(page).locator(".ask-turn").last().locator("p").last().textContent(), /^nsfw 本身没问题。$/);
    assert.equal(await page.evaluate(() => ask.codecActive.value), true);

    assert.deepEqual(dialogs, [], "no native dialogs");
    assert.deepEqual(errors, []);
    assert.deepEqual(generation(requests), []);
  } finally {
    await context.close();
  }
});

test("ASK drawer layering: settings above it, hidden with the editor, Anthropic turns, bottom panel on narrow screens", async () => {
  const { page, context, requests, errors, llm, calls } = await open("/#/image", { ready: ".switcher", ask: askSettings({ connectionId: "claude", images: false }) });
  try {
    await bind(page);
    await addImage(page, "1girl, white hair");
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor();
    assert.equal((await drawer(page).locator(".ask-limited").textContent()).trim(), "仅元数据");

    await route(page, "#/image/settings/ask");
    await page.waitForSelector("#settingsPanel[open]");
    const box = await drawer(page).boundingBox();
    assert.equal(
      await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("#askDrawer"), { x: box.x + box.width / 2, y: box.y + 120 }),
      false,
    );
    await page.keyboard.press("Control+j");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#settingsPanel[open]"));
    assert.equal(await drawer(page).isVisible(), true);

    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(256, 256);
      canvas.getContext("2d").fillRect(0, 0, 256, 256);
      await editor.open("image", await canvas.convertToBlob({ type: "image/png" }), "synthetic.png", { mode: "img2img" });
    });
    await page.waitForSelector("#imageEditor[open]");
    await drawer(page).waitFor({ state: "hidden" });
    await page.keyboard.press("Control+j");
    await page.waitForTimeout(150);
    assert.equal(await drawer(page).isVisible(), false);
    await page.locator("#imageEditor .editor-back").click();
    await page.waitForFunction(() => !document.querySelector("#imageEditor").open);
    await drawer(page).waitFor();

    // An empty stream fails like a silent filter; images are off, so the retry is plain.
    llm.push({
      body: anthropic(
        { type: "message_start", message: { id: "m0", usage: { input_tokens: 30, output_tokens: 0 } } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } },
        { type: "message_stop" },
      ),
    });
    await page.locator("#askPrompt").fill("这张的光影怎么来的？");
    await page.locator("#askPrompt").press("Enter");
    const empty = drawer(page).locator('.ask-turn[data-status="failed"]');
    await empty.waitFor();
    assert.match(await empty.locator(".ask-fail-text").textContent(), /模型没有返回内容/);
    assert.deepEqual((await empty.locator(".ask-fail-actions button").allTextContents()).map((t) => t.trim()), ["重试", "设置"]);
    llm.push({
      body: anthropic(
        { type: "message_start", message: { id: "m1", usage: { input_tokens: 30, cache_read_input_tokens: 1700, cache_creation_input_tokens: 0, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "白发的光影来自 " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "#h1 的逆光。" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
        { type: "message_stop" },
      ),
    });
    await empty.getByRole("button", { name: "重试" }).click();
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(await empty.count(), 0);
    const call = calls.at(-1);
    assert.equal(call.body.messages.length, 1, "the empty turn left no history");
    assert.equal(call.host, hosts.claude);
    assert.equal(call.path, "/v1/messages");
    assert.equal(call.headers["x-api-key"], "synthetic-claude");
    assert.equal(call.body.tools.at(-1).cache_control.type, "ephemeral");
    assert.equal(call.body.system.at(-1).cache_control.type, "ephemeral");

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(120);
      const rect = await drawer(page).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, overflow: el.scrollWidth > el.clientWidth + 1 };
      });
      assert.equal(rect.overflow, false, `overflow at ${width}`);
      if (width <= 860) {
        assert.equal(Math.round(rect.bottom), 900, `bottom panel at ${width}`);
        assert.equal(Math.round(rect.width), width);
      } else {
        assert.equal(Math.round(rect.width), 460);
        assert.equal(Math.round(rect.top), 60);
        assert.equal(Math.round(rect.left + rect.width), width);
      }
      await page.screenshot({ path: `.local/ask/drawer-${width}.png` });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(generation(requests), []);
  } finally {
    await context.close();
  }
});

test("ASK stop after network completion rolls back queued output and history", async () => {
  const { page, context, llm, calls } = await open("/#/image", { ready: ".switcher", ask: askSettings() });
  try {
    await bind(page);
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor();
    llm.push(
      { body: openai(tool("audit_1", "get_state"), end("tool_calls")) },
      { body: openai(text("audit first answer"), end()) },
    );
    await page.locator("#askPrompt").fill("audit cancelled question");
    await page.locator("#askPrompt").press("Enter");
    await page.waitForFunction(() => ask.usage.value.input === 3600 && ask.running.value);
    const before = await page.evaluate(() => ({ running: ask.running.value, status: ask.live.value?.status }));
    assert.equal(before.running, true, "still shows a stoppable running turn");
    await drawer(page).getByRole("button", { name: "停止", exact: true }).click();
    await page.waitForFunction(() => !ask.running.value);
    const after = await page.evaluate(() => ask.entries.value.filter(e => e.type === "turn").map(e => ({ status: e.turn.status, question: e.turn.question })));
    llm.push({ body: openai(text("audit next answer"), end()) });
    await page.locator("#askPrompt").fill("audit next question");
    await page.locator("#askPrompt").press("Enter");
    await drawer(page).locator('.ask-turn[data-status="done"]').last().waitFor();
    await page.waitForFunction(() => !ask.running.value);
    const nextHistory = calls.at(-1).body.messages.filter(m => m.role === "user").map(m => m.content);
    assert.equal(nextHistory.some(t => String(t).includes("audit cancelled question")), false);
    assert.equal(after[0].status, "stopped", "Stop while pacing must not commit as done");
  } finally { await context.close(); }
});
