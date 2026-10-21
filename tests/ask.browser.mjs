import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

let server, browser, origin;
before(async () => {
  await mkdir(".local/ask/a4", { recursive: true });
  await mkdir(".local/ask/a3", { recursive: true });
  await mkdir(".local/ask/a2", { recursive: true });
  await mkdir(".local/ask/a1", { recursive: true });
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

const hosts = { image: "gateway.example.test", chat: "chat.example.test", claude: "claude.example.test" };
const reasoning = /^\/v1\/(?:chat\/completions|messages)$/;
async function open(hash, { ready = "#settingsPanel[open]", ask = null, standard = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), requests = [], errors = [], llm = [], calls = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(({ hosts, ask, standard }) => {
    if (!/^https?:/.test(location.protocol) || localStorage.getItem("koma.routing.v1")) return;
    const c = (id, name, baseUrl, profileId) => ({ id, name, baseUrl, profileId, credentialRef: `${id}-key`, revision: "rev1" });
    localStorage.setItem("koma.routing.v1", JSON.stringify({ version: 1, links: {}, connections: {
      image: c("image", "图像连接", `https://${hosts.image}/service`, standard ? "koma-standard-v1" : "openai-images-v1"),
      chat: c("chat", "推理 Chat", `https://${hosts.chat}/v1`, "openai-chat-v1"),
      claude: c("claude", "推理 Messages", `https://${hosts.claude}`, "anthropic-messages-v1"),
    } }));
    if (ask) localStorage.setItem("koma.ask.v1", JSON.stringify(ask));
    sessionStorage.setItem("koma.session.keys", JSON.stringify({ "image-key": "synthetic-image", "chat-key": "synthetic-chat", "claude-key": "synthetic-claude" }));
      localStorage.setItem("koma.prefs.v1", JSON.stringify({ tagSuggest: false }));
  }, { hosts, ask, standard });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (!Object.values(hosts).includes(url.hostname)) {
      errors.push(`unexpected external origin: ${url.origin}`);
      return route.abort();
    }
    requests.push({ host: url.hostname, path: url.pathname, method: request.method(), headers: request.headers() });
    if (standard && url.hostname === hosts.image) {
      if (url.pathname.endsWith("/image/models")) return route.fulfill({ json: {
        studio_features: { version: 2, max_cost: true }, valid_samplers: ["k_euler_ancestral", "k_euler"],
        models: { "nai-diffusion-5-full": { name: "NAI V5", provider: "novelai", max_resolution: 2200000, quota_group: "novelai" }, "nai-diffusion-4-5-full": { name: "NAI V4.5", provider: "novelai", max_resolution: 1048576, quota_group: "novelai" } },
      } });
      if (url.pathname.endsWith("/media/quota")) return route.fulfill({json:{credits:{remaining:100},images:{novelai:{used:0,remaining:100,limit:100}}}});
      if (url.pathname.endsWith("/token_stats_data")) return route.fulfill({json:{temp_limits:{is_temp:false}}});
      if (url.pathname.endsWith("/estimate")) return route.fulfill({json:{cost:1}});
    }
    if (request.method() === "GET" && url.pathname.endsWith("/v1/models"))
      return route.fulfill({ json: { data: url.hostname === hosts.image ? [{ id: "gpt-image-1.5" }] : [{ id: "reasoning-b" }, { id: "reasoning-a" }] } });
    if (request.method() === "POST" && url.hostname !== hosts.image && reasoning.test(url.pathname)) {
      // A scripted model: each request takes the next reply in line.
      const reply = llm.shift() ?? { body: openai(text("（脚本已用完）"), end()) };
      calls.push({ host: url.hostname, path: url.pathname, headers: request.headers(), raw: request.postData(), body: JSON.parse(request.postData()) });
      if (reply.delay) await new Promise((done) => setTimeout(done, reply.delay));
      try {
        await route.fulfill({ status: reply.status ?? 200, contentType: reply.type ?? "text/event-stream", body: typeof reply.body === "function" ? reply.body(calls.at(-1).body) : reply.body });
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
    assert.deepEqual(first.body.tools.map((t) => t.function.name), ["get_state", "search_history", "get_meta", "diff_meta", "view_image", "view_sheet", "search_tags", "get_chat_context", "propose_draft"]);
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
        assert.equal(Math.round(rect.top), 0);
        assert.equal(Math.round(rect.bottom), 900);
        assert.equal(Math.round(rect.left + rect.width), width);
        assert.ok(await drawer(page).evaluate(el=>document.elementFromPoint(el.getBoundingClientRect().left+20,20)?.closest('#askDrawer')===el), 'ASK covers its top-bar area');
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

// A2 exercises the actual provider → tool → preview → user confirmation path.
const patchStep = (mode, anchor, text, target = 'image.prompt') => ({kind:'prompt_patch',target,mode,anchor,text});
const proposal = (steps, title = '调整提示词') => ({body: request => {
  const content=request.messages.at(-1).content;
  const state=JSON.parse(content.match(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/)[1]);
  return openai(text('保留已有特征，只调整指定部分。'),tool('draft_1','propose_draft',{base_hash:state.base_hash,title,steps}),end('tool_calls'));
}});
async function askDraft(page,llm,steps,question='把红眼睛改为蓝眼睛',title) {
  llm.push(proposal(steps,title));
  await page.evaluate(()=>ask.show());
  await page.locator('#askPrompt').fill(question);
  await page.locator('#askPrompt').press('Enter');
  await page.locator('.ask-draft[data-status="pending"]').waitFor();
}
const form = page => page.evaluate(()=>({...drawing.snapshot().form}));
const applyDraft = async page => {await page.locator('.ask-draft-apply').click();await page.locator('.ask-draft[data-status="applied"]').waitFor();};

test('ASK A2: confirmation, step withdrawal, four-width draft previews, apply and single-action undo preserve original tags',async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await addImage(page,'adult woman, red eyes, large breasts, nude');
    const prompt='adult woman, red eyes, large breasts, nude';
    await page.evaluate(prompt=>drawing.patch({prompt,negative:'low quality'}),prompt);
    const initial=await form(page);
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes'),patchStep('append','',', soft lighting')]);
    assert.deepEqual(await form(page),initial);assert.equal(calls.length,1);
    const steps=page.locator('.draft-step');
    await steps.nth(1).getByRole('button',{name:'撤回 Prompt',exact:true}).click();
    assert.equal(await steps.nth(1).getAttribute('class').then(c=>c.includes('off')),true);
    await steps.nth(0).getByRole('button',{name:'撤回 Prompt',exact:true}).click();
    assert.equal(await page.locator('.ask-draft-apply').isDisabled(),true);
    await steps.nth(0).getByRole('button',{name:'恢复 Prompt',exact:true}).click();
    await steps.nth(1).getByRole('button',{name:'恢复 Prompt',exact:true}).click();
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.waitForTimeout(80);
      assert.ok(await drawer(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1),`drawer overflow ${width}`);
      assert.ok(await page.locator('.ask-draft').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`draft overflow ${width}`);
      assert.ok(await page.locator('.ask-draft-apply').isVisible());
      await page.screenshot({path:`.local/ask/a2/patch-${width}.png`,fullPage:true});
    }
    await applyDraft(page);
    assert.equal((await form(page)).prompt,'adult woman, blue eyes, large breasts, nude, soft lighting');
    await page.waitForFunction(()=>document.activeElement?.id==='prompt');
    assert.match(await drawer(page).locator('[aria-live="polite"]').textContent(),/已应用草稿/);
    await page.keyboard.press('Control+z');
    await page.locator('.ask-draft[data-status="pending"]').waitFor();
    assert.deepEqual(await form(page),initial);
    await applyDraft(page);
    await page.evaluate(()=>drawing.patch({negative:'manual negative'}));
    await page.getByRole('button',{name:'撤销',exact:true}).click();
    await page.locator('.ask-draft[data-status="pending"]').waitFor();
    assert.equal((await form(page)).negative,'manual negative');assert.equal((await form(page)).prompt,prompt);
    await applyDraft(page);
    await page.evaluate(()=>drawing.patch({prompt:'later manual prompt'}));
    assert.equal(await page.getByRole('button',{name:'撤销',exact:true}).isDisabled(),true);
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: rewrite compares original, underlines local kept tags and renders model HTML as text',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);
    const prompt='adult woman, nude, large breasts, blue eyes';
    await page.evaluate(prompt=>drawing.patch({prompt}),prompt);
    await askDraft(page,llm,[patchStep('rewrite','','BLUE EYES, adult woman, nude, large breasts, <img src=x onerror=alert(1)>')],'保留原有特征，整理顺序');
    assert.deepEqual(await page.locator('.draft-slice .keep').allTextContents(),['BLUE EYES','adult woman','nude','large breasts']);
    assert.equal(await page.locator('.draft-slice img').count(),0);
    await page.getByRole('button',{name:'原文',exact:true}).click();assert.equal(await page.locator('.draft-slice').textContent(),prompt);
    await page.getByRole('button',{name:'新稿',exact:true}).click();
    for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.screenshot({path:`.local/ask/a2/rewrite-${width}.png`});}
    assert.equal((await form(page)).prompt,prompt);
    await applyDraft(page);assert.match((await form(page)).prompt,/nude, large breasts/);
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: changes while thinking realign unique anchors; stale preview fingerprint and stale rewrite refuse writes',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await page.evaluate(()=>drawing.patch({prompt:'red eyes, user tags'}));
    llm.push({...proposal([patchStep('replace','red eyes','blue eyes'),patchStep('rewrite','','replacement','image.negative')]),delay:250});
    await page.evaluate(()=>ask.show());await page.locator('#askPrompt').fill('调整眼睛');await page.locator('#askPrompt').press('Enter');
    await page.waitForFunction(()=>ask.running.value);
    await page.evaluate(()=>drawing.patch({prompt:'user prefix, red eyes, user tags',negative:'manual negative'}));
    await page.locator('.ask-draft').waitFor();
    assert.match(await page.locator('.draft-aligned').textContent(),/按当前内容对齐/);
    assert.match(await page.locator('.ask-note').last().textContent(),/外部修改/);
    assert.match(await page.locator('.draft-step.invalid').textContent(),/原文已变化/);
    const fingerprint=await page.locator('.ask-draft-apply').getAttribute('data-fingerprint');
    await page.evaluate(async fp=>{await drawing.patch({prompt:'new prefix, red eyes, user tags'});await ask.applyDraft(fp);},fingerprint);
    assert.match((await form(page)).prompt,/red eyes/);assert.match(await page.locator('.ask-notice').textContent(),/核对/);
    await applyDraft(page);assert.equal((await form(page)).prompt,'new prefix, blue eyes, user tags');assert.equal((await form(page)).negative,'manual negative');
    await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.ask-draft[data-status="pending"]').waitFor();
    await page.evaluate(()=>drawing.patch({prompt:'anchor removed'}));
    assert.equal(await page.locator('.ask-draft-apply').isDisabled(),true);
    llm.push(proposal([patchStep('append','',', new detail')]));
    await page.getByRole('button',{name:'基于当前内容重新提议',exact:true}).click();
    await page.waitForFunction(()=>!ask.running.value&&ask.draftPlan.value?.steps[0]?.after===', new detail');
    assert.equal(await page.locator('.draft-step.invalid').count(),0);
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: Tab focus/selection/IME guards, Esc draft layer and stopped pacing never publish a draft',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await page.locator('#askPrompt').focus();await page.keyboard.press('Tab');assert.equal((await form(page)).prompt,'red eyes');
    await page.locator('#prompt').focus();await page.keyboard.press('Tab');assert.equal((await form(page)).prompt,'red eyes');
    await page.evaluate(()=>{document.activeElement.blur();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',isComposing:true,bubbles:true,cancelable:true}));});
    assert.equal((await form(page)).prompt,'red eyes');
    await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.draft-slice'));getSelection().removeAllRanges();getSelection().addRange(range);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));});
    assert.equal((await form(page)).prompt,'red eyes');
    await page.evaluate(()=>getSelection().removeAllRanges());await page.keyboard.press('Tab');
    await page.locator('.ask-draft[data-status="applied"]').waitFor();assert.equal((await form(page)).prompt,'blue eyes');
    await page.keyboard.press('Control+z');await page.locator('.ask-draft[data-status="pending"]').waitFor();
    await page.locator('#askPrompt').focus();await page.keyboard.press('Escape');await page.locator('.ask-draft').waitFor({state:'hidden'});assert.equal(await drawer(page).isVisible(),true);
    llm.push(proposal([patchStep('append','',', new detail')]));await page.locator('#askPrompt').fill('追加细节');await page.locator('#askPrompt').press('Enter');
    await page.waitForFunction(()=>ask.live.value?.items.some(i=>i.kind==='tools'));
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!ask.running.value);
    assert.equal(await page.locator('.ask-draft').count(),0);assert.equal((await form(page)).prompt,'red eyes');
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: cross-workspace application reveals destination, chat composer stays unsent and undo preserves identity',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await route(page,'#/chat');await page.waitForFunction(()=>location.hash==='#/chat');
    assert.match(await page.locator('.ask-draft-apply').textContent(),/切回绘图并应用/);
    await applyDraft(page);assert.equal(await page.evaluate(()=>location.hash),'#/image');
    await page.evaluate(()=>chat.setPrompt('original chat text'));
    await askDraft(page,llm,[patchStep('rewrite','','composed description','chat.composer')],'整理对话输入');
    assert.match(await page.locator('.ask-draft-apply').textContent(),/切回对话并应用/);
    await applyDraft(page);assert.equal(await page.evaluate(()=>location.hash),'#/chat');
    await page.waitForFunction(()=>document.activeElement?.id==='chatPrompt');
    assert.equal(await page.locator('#chatPrompt').inputValue(),'composed description');
    await page.keyboard.press('Control+z');await page.locator('.ask-draft[data-status="pending"]').waitFor();
    assert.equal(await page.locator('#chatPrompt').inputValue(),'original chat text');
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: restore checklist reuses import rules; apply/undo issue zero quotes or quota calls; manual edit resumes quote',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings(),standard:true});
  try {
    await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length===2);
    await page.evaluate(async()=>{
      await drawing.patch({prompt:'adult woman, nude',model:'nai-diffusion-5-full',scale:5,seed:'42',width:832,height:1216});
      const c=new OffscreenCanvas(256,384);c.getContext('2d').fillRect(0,0,256,384);
      await drawing.addExternal(await c.convertToBlob({type:'image/png'}),{width:256,height:384},{basePrompt:'adult woman, nude',model:'nai-diffusion-4-5-full',width:512,height:512,scale:7.3,seed:0,sampler:'k_euler',steps:99},null);
    });
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');await page.waitForTimeout(150);
    const initial=await form(page),start=requests.length;
    await askDraft(page,llm,[{kind:'restore_partial',source:'#h1',fields:['model','sampler','width','height','scale','seed','steps']}],'恢复 #h1 参数','从 #h1 恢复');
    assert.deepEqual(await form(page),initial);
    assert.match(await page.locator('[data-step="0:scale"]').textContent(),/7.5/);
    await page.locator('[data-step="0:steps"] button').click();
    for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.locator('.ask-draft').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`.local/ask/a2/restore-${width}.png`});}
    await applyDraft(page);let current=await form(page);
    assert.equal(current.model,'nai-diffusion-4-5-full');assert.equal(current.scale,7.5);assert.equal(current.seed,'0');assert.equal(current.steps,initial.steps);assert.equal(current.width,512);assert.equal(current.sampler,'k_euler');
    await page.waitForTimeout(700);assert.equal(generation(requests.slice(start)).length,0,JSON.stringify(generation(requests.slice(start))));
    await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.ask-draft[data-status="pending"]').waitFor();
    assert.deepEqual(await form(page),initial);await page.waitForTimeout(700);assert.equal(generation(requests.slice(start)).length,0,JSON.stringify(generation(requests.slice(start))));
    await page.locator('#prompt').fill('manual edit resumes quotation');
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');
    assert.ok(requests.slice(start).some(r=>r.path.endsWith('/estimate')));
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: failed persistence rolls back the draft; later manual edits survive; chat identity blocks stale writes',{timeout:45000},async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);
    await page.evaluate(()=>{
      const p=document.body.__vue_app__._context.provides;
      window.services=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')];
    });
    await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await page.evaluate(()=>{window.savedSet=services.preferences.set;window.savedWrite=services.data.write;services.preferences.set=async()=>{throw new Error('synthetic persistence failure');};});
    await page.locator('.ask-draft-apply').click();
    await page.waitForFunction(()=>!ask.writingDraft.value&&ask.notice.value.includes('synthetic persistence failure'));
    assert.equal((await form(page)).prompt,'red eyes');assert.equal(await page.locator('.ask-draft').getAttribute('data-status'),'pending');
    // An edit arriving while the write is unresolved must survive its rejection.
    await page.evaluate(()=>{services.preferences.set=()=>new Promise((resolve,reject)=>{window.rejectDraftWrite=reject;});});
    await page.locator('.ask-draft-apply').click();await page.waitForFunction(()=>ask.writingDraft.value&&window.rejectDraftWrite);
    await page.evaluate(async()=>{const reject=window.rejectDraftWrite;services.preferences.set=window.savedSet;await drawing.patch({prompt:'later manual text'});reject(new Error('synthetic late failure'));});
    await page.waitForFunction(()=>!ask.writingDraft.value);assert.equal((await form(page)).prompt,'later manual text');
    await page.evaluate(()=>ask.ignoreDraft());
    await route(page,'#/chat');await page.locator('#chatPrompt').waitFor();
    await page.evaluate(()=>chat.setPrompt('old conversation text'));await page.evaluate(()=>chat.flush());
    await askDraft(page,llm,[patchStep('rewrite','','new composer text','chat.composer')],'整理输入框');
    await page.evaluate(()=>{services.data.write=async()=>{throw new Error('synthetic chat failure');};});
    await page.locator('.ask-draft-apply').click();await page.waitForFunction(()=>!ask.writingDraft.value&&ask.notice.value.includes('synthetic chat failure'));
    assert.equal(await page.locator('#chatPrompt').inputValue(),'old conversation text');
    await page.evaluate(()=>{services.data.write=window.savedWrite;chat.addConversation();});
    await page.waitForFunction(()=>ask.draftPlan.value.steps[0].issue==='当前对话已切换');
    assert.equal(await page.locator('.ask-draft-apply').isDisabled(),true);
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

async function seedAskChat(page) {
  await page.evaluate(async()=>{
    const d=await import('/src/domain/conversation.ts');
    const canvas=new OffscreenCanvas(64,64),g=canvas.getContext('2d');
    const assets=[];
    for(let i=0;i<3;i++){g.fillStyle=['#4b638b','#866152','#746085'][i];g.fillRect(0,0,64,64);assets.push((await chat.assets.add(await canvas.convertToBlob({type:'image/png'}),`synthetic${i}`,{width:64,height:64})).id);}
    chat.mutate(c=>{for(let i=0;i<3;i++){const {turn,version}=d.beginTurn(c,d.contextSnapshot(c),`第 ${i+1} 轮描述`,{});d.completeVersion(c,turn,version,[{type:'image',assetId:assets[i]}],null,c.selectionRevision);}c.prompt='原来的下一轮';});
    await chat.flush();
  });
}
test('ASK A3 S6: read locked CHAT context, review branch/skip/composer, apply with zero sends and undo restores one action',async()=>{
 const {page,context,llm,calls,requests,errors}=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings()});
 try{
  await bind(page);await seedAskChat(page);
  const before=await page.evaluate(()=>chat.snapshot().current);
  llm.push({body:openai(tool('ctx','get_chat_context'),end('tool_calls'))});
  llm.push({body:r=>{
   const first=r.messages.find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('<workspace_state>'));
   const base_hash=JSON.parse(first.content.match(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/)[1]).base_hash;
   return openai(text('从第一轮继续，保留原图并提纯描述。'),tool('draft','propose_draft',{base_hash,title:'提纯并准备新分支',steps:[{kind:'chat_distill_branch',source:'#c1.1',exclude:['#c2.1','#c3.1'],text:'保留轮廓和蓝色背景，增强清晰度'}]}),end('tool_calls'));
  }});
  await page.evaluate(()=>ask.show());await page.locator('#askPrompt').fill('为什么越改越糊？从第一轮整理新分支');await page.locator('#askPrompt').press('Enter');
  await page.locator('.ask-draft[data-status="pending"]').waitFor();
  assert.deepEqual(await page.evaluate(()=>chat.snapshot().current),before);
  assert.match(calls[1].body.messages.at(-1).content,/actual_text/);assert.equal(await page.locator('[data-step="0:source"] button').count(),0);
  await page.locator('[data-step="0:exclude"] button').click();await page.locator('[data-step="0:exclude"] button').click();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.locator('.ask-draft').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`.local/ask/a3/branch-${width}.png`});}
  await applyDraft(page);const after=await page.evaluate(()=>chat.snapshot().current);
  assert.equal(after.turns.length,3);assert.equal(after.headId,before.turns[0].id);assert.equal(after.skipTurnIds.length,2);assert.equal(after.prompt,'保留轮廓和蓝色背景，增强清晰度');
  await page.keyboard.press('Control+z');await page.locator('.ask-draft[data-status="pending"]').waitFor();
  const undone=await page.evaluate(()=>chat.snapshot().current);for(const key of ['headId','mainId','skipTurnIds','prompt'])assert.deepEqual(undone[key],before[key]);
  assert.equal(await page.locator('.ask-draft-apply').isDisabled(),false);
  await page.evaluate(()=>chat.mutate(c=>{c.baseFollows=!c.baseFollows;},true));
  assert.equal(await page.locator('.ask-draft-apply').isDisabled(),true);assert.match(await page.locator('.draft-issue').first().textContent(),/上下文已变化/);
  assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A4 inline: selected text, four widths, confirmation, undo, expand and native focus guards',async()=>{
 const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);await page.evaluate(()=>drawing.patch({prompt:'adult woman, red eyes, blue hair'}));
  const initial=await form(page),source=page.locator('#prompt');
  await source.focus();await source.evaluate(el=>el.setSelectionRange(13,21));
  await source.dispatchEvent('keydown',{key:'k',ctrlKey:true,isComposing:true});assert.equal(await drawer(page).isVisible(),false);
  await source.press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='askPrompt');
  assert.equal(calls.length,0);assert.deepEqual(await page.evaluate(()=>ask.inline.value),{target:'image.prompt',text:'red eyes'});
  llm.push(proposal([patchStep('replace','red eyes','blue eyes')]));
  await page.locator('#askPrompt').fill('把选中的眼睛颜色改成蓝色');await page.locator('#askPrompt').press('Enter');await page.locator('.ask-draft[data-status="pending"]').waitFor();
  const dynamic=calls[0].body.messages.at(-1).content;
  assert.match(dynamic,/"inline_selection":\{"target":"image.prompt","text":"red eyes"\}/);assert.deepEqual(await form(page),initial);
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(80);
   await page.waitForFunction(()=>{
    const source=document.querySelector('#prompt').getBoundingClientRect(),panel=document.querySelector('#askDrawer').getBoundingClientRect();
    const left=Math.max(8,Math.min(innerWidth-panel.width-8,source.left)),top=Math.max(8,Math.min(innerHeight-panel.height-8,source.bottom+8));
    return Math.abs(panel.left-left)<1&&Math.abs(panel.top-top)<1;
   });
   assert.ok(await drawer(page).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&el.scrollWidth<=el.clientWidth+1;}),`inline bounds ${width}`);
   await page.screenshot({path:`.local/ask/a4/inline-${width}.png`,fullPage:true});
  }
  await source.focus();await source.press('Tab');assert.deepEqual(await form(page),initial);
  await page.locator('#askPrompt').fill('保留这条未发送的问题');
  await drawer(page).getByRole('button',{name:'展开',exact:true}).click();
  assert.equal(await drawer(page).getAttribute('class').then(c=>c.includes('ask-inline')),false);
  assert.equal(await page.locator('#askPrompt').inputValue(),'保留这条未发送的问题');assert.equal(await page.locator('.ask-draft[data-status="pending"]').count(),1);
  await applyDraft(page);assert.match((await form(page)).prompt,/blue eyes/);
  await source.focus();await source.press('Control+z');await page.locator('.ask-draft[data-status="pending"]').waitFor();assert.deepEqual(await form(page),initial);
  await page.locator('#askPrompt').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('.ask-draft').count(),0);assert.equal(await drawer(page).isVisible(),true);
  await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});assert.equal(await source.evaluate(el=>document.activeElement===el),true);
  await source.press('Meta+k');await page.locator('#askDrawer.ask-inline').waitFor();await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});
  await route(page,'#/image/settings/ask');await page.locator('#askModel').focus();await page.locator('#askModel').press('Control+k');assert.equal(await drawer(page).isVisible(),false);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A4 inline: autocomplete retains Tab/Esc and IME; K dismisses suggestions without selecting, supports Negative and CHAT',async()=>{
 const {page,context,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);
  await context.route('https://tagsuggest.zeabur.app/**',r=>r.fulfill({json:{results:[{name:'blue_hair',cn_name:'蓝发',category:0,count:100}]}}));
  await page.evaluate(async()=>{const p=document.body.__vue_app__._instance.provides;const {servicesKey}=await import('/src/app/services.ts');const s=p[servicesKey];await s.preferences.set('koma.prefs.v1',{...s.preferences.get('koma.prefs.v1',{}),tagSuggest:true});});
  const source=page.locator('#prompt');await source.fill('blue');await page.locator('.tag-suggest:not([hidden]) .tag-suggest-option').waitFor();
  await source.press('Tab');assert.match(await source.inputValue(),/blue hair/);assert.equal(await drawer(page).isVisible(),false);
  await source.fill('blue');await page.locator('.tag-suggest:not([hidden]) .tag-suggest-option').waitFor();await source.press('Escape');assert.equal(await source.getAttribute('aria-expanded'),'false');assert.equal(await source.inputValue(),'blue');
  await source.fill('blu');await source.dispatchEvent('compositionstart');await source.dispatchEvent('keydown',{key:'k',metaKey:true,isComposing:true});assert.equal(await drawer(page).isVisible(),false);await source.dispatchEvent('compositionend');
  await source.fill('blue');await page.locator('.tag-suggest:not([hidden]) .tag-suggest-option').waitFor();await source.press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();
  assert.equal(await source.getAttribute('aria-expanded'),'false');assert.equal(await source.inputValue(),'blue');
  await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});
  await page.locator('#tab-negative').click();await page.locator('#negative').fill('low quality');await page.locator('#negative').press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();assert.equal(await page.evaluate(()=>ask.inline.value.target),'image.negative');
  await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});
  await route(page,'#/chat');await page.locator('#chatPrompt').fill('保留当前风格');await page.locator('#chatPrompt').press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();
  assert.deepEqual(await page.evaluate(()=>ask.inline.value),{target:'chat.composer',text:'保留当前风格'});
  await page.locator('#askPrompt').press('Control+k');assert.equal(await page.evaluate(()=>ask.inline.value.target),'chat.composer');
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
