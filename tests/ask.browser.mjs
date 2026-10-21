import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

let server, browser, origin;
before(async () => {
  await mkdir(".local/ask/a1", { recursive: true });
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
const tool = (id, name, input = {}) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(input) } }] } }] });
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
    assert.deepEqual(first.body.tools.map((t) => t.function.name), ["get_state", "search_history", "get_meta", "diff_meta", "view_image", "view_sheet", "search_tags"]);
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

async function addScene(page, variant = 0) {
  return page.evaluate(async (variant) => {
    const canvas = new OffscreenCanvas(1024, 768), g = canvas.getContext('2d');
    g.fillStyle = '#17243a'; g.fillRect(0, 0, 1024, 768);
    g.fillStyle = variant ? '#df8054' : '#5699ce';
    g.fillRect(300, 180, 160, 120); g.fillRect(550, 180, 160, 120);
    g.fillStyle = '#334a3e'; g.fillRect(0, 550, 1024, 218);
    const blob = await canvas.convertToBlob({type:'image/png'});
    const record = await drawing.addExternal(blob, {width:1024,height:768}, {
      model:'gpt-image-1.5', modelName:'GPT Image', seed:variant,
      prompt:variant ? 'landscape, warm light, blue details' : 'landscape, blue details',
      basePrompt:variant ? 'landscape, warm light, blue details' : 'landscape, blue details',
      scale:variant ? 7 : 5,
    }, null);
    return record.id;
  }, variant);
}
const toolReply = (id, name, input) => ({body:openai(tool(id,name,input),end('tool_calls'))});
const textReply = (value) => ({body:openai(text(value),end())});
const imageBlocks = (body) => body.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'image_url') : []);

// S1's pictures and model replies are synthetic; this verifies plumbing, not visual reasoning quality.
test('ASK A1 S1: metadata, full image, padded crop, stable snapshot, privacy retry and no generation', async () => {
  const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await addScene(page,1);
    await page.getByRole('button',{name:'Ask 这张图',exact:true}).click();
    await drawer(page).waitFor();
    assert.equal(calls.length,0,'entry only opens, never sends');
    llm.push(toolReply('m1','get_meta',{id:'#h1'}),toolReply('v1','view_image',{id:'#h1',spec:'look'}),toolReply('v2','view_image',{id:'#h1',spec:'crop',region:[25,15,50,30]}),textReply('**暖色光照影响了蓝色。** #h1 可先核对 `warm light`。'));
    await page.locator('#askPrompt').fill('为什么 #h1 的蓝色细节变成暖色？');
    await page.locator('#askPrompt').press('Enter');
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length,4);
    assert.equal(imageBlocks(calls[0].body).length,0);
    assert.equal(imageBlocks(calls[2].body).length,1);
    assert.equal(imageBlocks(calls[3].body).length,2);
    const images=imageBlocks(calls[3].body).map(x=>x.image_url.url);
    const sizes=await page.evaluate(async (urls)=>Promise.all(urls.map(async url=>{const img=new Image();img.src=url;await img.decode();return [img.naturalWidth,img.naturalHeight];})),images);
    assert.deepEqual(sizes[0],[768,576]);
    assert.ok(sizes[1][0]<=768 && sizes[1][1]<=768);
    assert.ok(images.every(url=>url.startsWith('data:image/webp;base64,')));
    const state=calls[0].body.messages.find(m=>m.role==='user').content;
    for(const call of calls.slice(1))assert.equal(call.body.messages.find(m=>m.role==='user').content,state);
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.prompt),'');
    const ref=drawer(page).locator('.ask-lead .ask-id').first();
    // A reply anchor remains an actual button and uses borrowed thumbnail URLs.
    const anyRef=drawer(page).locator('.ask-turn[data-status="done"] .ask-id').last();
    await anyRef.hover();await page.locator('.ask-preview').waitFor();
    await page.mouse.move(1,1);await page.locator('.ask-preview').waitFor({state:'hidden'});
    await drawer(page).screenshot({path:'.local/ask/a1/s1-diagnosis.png'});

    // Privacy retry must strip pixels from earlier successful turns as well.
    llm.push({status:403,type:'application/json',body:JSON.stringify({error:{message:'content_filter blocked'}})});
    await page.locator('#askPrompt').fill('再解释一次');await page.locator('#askPrompt').press('Enter');
    const failed=drawer(page).locator('.ask-turn[data-status="failed"]');await failed.waitFor();
    llm.push(toolReply('denied','view_image',{id:'#h1',spec:'look'}),textReply('本轮只能依据元数据。'));
    await failed.getByRole('button',{name:'仅发元数据重试',exact:true}).click();
    await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
    assert.equal(imageBlocks(calls.at(-1).body).length,0);
    assert.match(JSON.stringify(calls.at(-1).body),/本轮仅发送元数据/);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A1 S2: explicit two-picture selection, parameter diff, contact sheet, candidates and locate',async()=>{
 const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);const first=await addScene(page),second=await addScene(page,1);
  await page.getByRole('button',{name:'对比',exact:true}).click();
  await page.getByRole('button',{name:'选择 #h1 对比',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Ask Diff',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'选择 #h2 对比',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.library-pick[aria-pressed="true"]').length===2);
  assert.equal(await page.evaluate(()=>drawing.snapshot().current.id),second,'selecting does not replace viewing');
  await page.waitForTimeout(100);
  await page.screenshot({path:'.local/ask/a1/entries-diff-1440.png'});
  await page.getByRole('button',{name:'Ask Diff',exact:true}).click();
  assert.match(await page.locator('#askPrompt').inputValue(),/#h1.*#h2/);
  assert.equal(calls.length,0);
  llm.push(toolReply('d1','diff_meta',{a:'#h1',b:'#h2'}),toolReply('s1','view_sheet',{ids:['#h1','#h2']}),textReply('**#h2 增加了暖色光。** Scale 也从 5 改为 7；#h1 保留了蓝色。'));
  await page.locator('#askPrompt').press('Enter');
  await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
  assert.match(JSON.stringify(calls[1].body),/warm light/);
  assert.equal(imageBlocks(calls.at(-1).body).length,1);
  await drawer(page).screenshot({path:'.local/ask/a1/s2-comparison.png'});
  await drawer(page).locator('.ask-turn[data-status="done"] .ask-id').last().click();
  assert.equal(await page.evaluate(()=>drawing.snapshot().current.id),first);

  llm.push(toolReply('find','search_history',{query:'landscape'}),textReply('找到两张，选一张继续。'));
  await page.locator('#askPrompt').fill('找一张之前的 landscape');await page.locator('#askPrompt').press('Enter');
  await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
  const candidates=drawer(page).getByRole('group',{name:'选择要分析的图片'});
  assert.equal(await candidates.getByRole('button').count(),2);
  const count=calls.length;
  await candidates.getByRole('button',{name:'选择 #h1 继续提问',exact:true}).click();
  assert.equal(calls.length,count);
  assert.equal(await page.locator('#askPrompt').inputValue(),'请分析 #h1');
  await page.evaluate(id=>drawing.remove(id),first);
  assert.equal(await candidates.getByRole('button',{name:'选择 #h1 继续提问',exact:true}).isDisabled(),true);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A1 vision: real resize/crop/cache, four-call and pixel/byte ceilings, disposal, zero model requests',async()=>{
 const {page,context,requests,errors,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  const results=await page.evaluate(async()=>{
   const {createVision}=await import('/src/ask/vision.ts');
   const canvas=new OffscreenCanvas(1600,1200),g=canvas.getContext('2d');
   g.fillStyle='#254568';g.fillRect(0,0,1600,1200);
   const blob=await canvas.convertToBlob({type:'image/png'});
   const nativeDecode=window.createImageBitmap;
   let decoded=0,closed=0;
   window.createImageBitmap=async(...args)=>{
    const bitmap=await nativeDecode(...args),close=bitmap.close.bind(bitmap);
    decoded++;bitmap.close=()=>{closed++;close();};return bitmap;
   };
   const p={id:'one',label:'#h1',aliases:['#h1'],createdAt:1,params:{},size:{width:1600,height:1200},blob};
   const v=createVision(), signal=new AbortController().signal;
   const context=()=>({signal,metadataOnly:false,budget:{calls:0,pixels:0,bytes:0},viewed:new Set()});
   const c=context(), failures=[];
   try{await v.image(p,'crop',[10,10,20,20],c);}catch(e){failures.push(e.message);}
   const a=await v.image(p,'glance',undefined,c), b=await v.image(p,'glance',undefined,c);
   await v.image(p,'crop',[10,10,20,20],c);await v.image(p,'glance',undefined,c);
   try{await v.image(p,'glance',undefined,c);}catch(e){failures.push(e.message);}
   const pixels=context();await v.image(p,'look',undefined,pixels);await v.image(p,'look',undefined,pixels);await v.image(p,'look',undefined,pixels);
   try{await v.image(p,'look',undefined,pixels);}catch(e){failures.push(e.message);}
   const bytes=context();bytes.budget.bytes=399999;
   try{await v.image(p,'glance',undefined,bytes);}catch(e){failures.push(e.message);}
   const cancelled=context();const abort=new AbortController();abort.abort();cancelled.signal=abort.signal;
   try{await v.image(p,'glance',undefined,cancelled);}catch(e){failures.push(e.name);}
   // Eviction must release the cache's derived image and require a fresh decode.
   for(let n=0;n<17;n++)await v.image({...p,id:`evict-${n}`},'glance',undefined,context());
   const beforeDecode=decoded;
   await v.image(p,'glance',undefined,context());
   const evicted=decoded===beforeDecode+1;
   const during=context(),abortDuring=new AbortController();during.signal=abortDuring.signal;
   const pending=v.image({...p,id:'cancel-during-decode'},'look',undefined,during);
   abortDuring.abort();
   try{await pending;}catch(e){failures.push(e.name);}
   v.dispose();try{await v.image(p,'glance',undefined,context());}catch(e){failures.push(e.message);}
   window.createImageBitmap=nativeDecode;
   return {failures,calls:c.budget.calls,cache:a.image.data===b.image.data,pixels:a.pixels,bytesUnchanged:bytes.budget.bytes,decoded,closed,evicted};
  });
  assert.match(results.failures[0],/先用 glance 或 look/);
  assert.match(results.failures[1],/4 次/);
  assert.match(results.failures[2],/预算/);assert.match(results.failures[3],/预算/);
  assert.equal(results.failures[4],'AbortError');assert.equal(results.failures[5],'AbortError');assert.match(results.failures[6],/已关闭/);
  assert.equal(results.decoded,results.closed,'every bitmap closes, including cancellation');assert.equal(results.evicted,true);
  assert.equal(results.calls,4);assert.equal(results.cache,true);assert.equal(results.pixels,384*288);
  assert.equal(results.bytesUnchanged,399999);assert.equal(calls.length,0);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A1 Anthropic: streamed visual tool, WebP tool_result, cache boundaries and no generation',async()=>{
 const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings({connectionId:'claude'})});
 try{
  await bind(page);await addScene(page);
  llm.push({body:anthropic(
   {type:'message_start',message:{id:'v1',usage:{input_tokens:60,output_tokens:1}}},
   {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'view1',name:'view_image',input:{}}},
   {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"id":"#h1",'}},
   {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'"spec":"glance"}'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:20}},
   {type:'message_stop'},
  )},{body:anthropic(
   {type:'message_start',message:{id:'v2',usage:{input_tokens:180,cache_read_input_tokens:1200,output_tokens:1}}},
   {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
   {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'#h1 的蓝色块已查看。'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:18}},
   {type:'message_stop'},
  )});
  await page.getByRole('button',{name:'Ask 这张图',exact:true}).click();
  await page.locator('#askPrompt').fill('查看 #h1');await page.locator('#askPrompt').press('Enter');
  await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
  assert.equal(calls.length,2);
  const [first,second]=calls, result=second.body.messages.at(-1).content[0];
  assert.equal(second.headers['x-api-key'],'synthetic-claude');
  assert.equal(second.headers['anthropic-dangerous-direct-browser-access'],'true');
  assert.equal(result.type,'tool_result');assert.equal(result.tool_use_id,'view1');
  const picture=result.content.find(b=>b.type==='image');
  assert.equal(picture.source.media_type,'image/webp');assert.equal(picture.source.type,'base64');
  assert.equal(Buffer.from(picture.source.data,'base64').subarray(8,12).toString(),'WEBP');
  assert.deepEqual(second.body.system,first.body.system);assert.deepEqual(second.body.tools,first.body.tools);
  assert.equal(second.body.tools.at(-1).cache_control.type,'ephemeral');
  assert.equal(second.body.system.at(-1).cache_control.type,'ephemeral');
  assert.equal(result.cache_control.type,'ephemeral');
  assert.equal(JSON.stringify(second.body).includes('"viewed"'),false,'local provenance stays off wire');
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A1 entries: four viewports, collapsed history, touch selection and Ask Why only prefills',async()=>{
 const {page,context,requests,errors,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);await addScene(page);await addScene(page,1);
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(450);
   assert.equal(await page.getByRole('button',{name:'Ask 这张图',exact:true}).isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.screenshot({path:`.local/ask/a1/entry-${width}.png`});
   await page.getByRole('button',{name:'Ask 这张图',exact:true}).click();await drawer(page).waitFor();
   await drawer(page).getByRole('button',{name:'关闭 ASK',exact:true}).click();await drawer(page).waitFor({state:'hidden'});
  }
  await page.locator('#histToggle').click();await page.waitForTimeout(400);
  const folded=await page.locator('#tray .tile[data-id]').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));
  assert.ok(folded.every(h=>h>=7&&h<=12));
  await page.locator('#histToggle').click();
  await page.setViewportSize({width:390,height:900});
  await page.evaluate(()=>{
   const p=document.body.__vue_app__._instance.provides;
   p[Object.getOwnPropertySymbols(p).find(k=>k.description==='app-shell')].image.menuOpen=true;
  });
  await page.getByRole('button',{name:'对比',exact:true}).click();
  await page.getByRole('button',{name:'选择 #h1 对比',exact:true}).click();
  await page.getByRole('button',{name:'选择 #h2 对比',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.library-pick[aria-pressed="true"]').length===2);
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(450);
   const bounds=await page.locator('.topbar-history-slot').evaluate(el=>{
    const frame=el.getBoundingClientRect();
    return [...el.querySelectorAll('.library-head,.library-item,.library-diff,.library-compare')].map(child=>{
     const r=child.getBoundingClientRect();
     return {name:child.className,inside:r.left>=frame.left-1&&r.right<=frame.right+1};
    });
   });
   assert.ok(bounds.every(b=>b.inside),`menu clipping at ${width}: ${JSON.stringify(bounds)}`);
   await page.screenshot({path:`.local/ask/a1/entry-selection-${width}.png`});
  }
  await page.setViewportSize({width:390,height:900});
  await page.waitForTimeout(450);
  await page.screenshot({path:'.local/ask/a1/entry-touch-selection.png'});
  await page.evaluate(async()=>{for(const item of drawing.snapshot().history)await drawing.toggleFavorite(item);});
  await page.locator('#favoritesTab').click();
  assert.equal(await page.locator('.library-compare').isVisible(),true,'favorites retain compare action when clear-history is hidden');
  assert.equal(await page.getByRole('button',{name:'Ask Diff',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Ask Diff',exact:true}).click();await drawer(page).waitFor();
  assert.equal(calls.length,0);
  await drawer(page).getByRole('button',{name:'关闭 ASK',exact:true}).click();
  // Isolated UI state: never submit a generation to obtain an error card.
  await page.evaluate(()=>{document.body.dataset.state='error';document.querySelector('#errBody').textContent='synthetic 503';});
  await page.getByRole('button',{name:'Ask Why',exact:true}).click();await drawer(page).waitFor();
  assert.match(await page.locator('#askPrompt').inputValue(),/为什么这次生成失败/);
  assert.equal(calls.length,0);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
