import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, submitAsk, hosts, reasoning, open, openai, text, tool, end, anthropic, askSettings, generation, drawer, route, stored } from "./helpers/ask-fixture.mjs";

useAskFixture();

test("ASK settings: free creation off by default, empty vocabulary and replacement editor; add/edit/delete", async () => {
  const { page, context, requests, errors } = await open("/#/image/settings/ask");
  try {
    const nav = page.locator(".set-nav button", { hasText: "ASK" });
    assert.equal(await nav.getAttribute("aria-current"), "true");
    const options = await page.locator("#askConnection option").allTextContents();
    assert.deepEqual(options.map((o) => o.trim()), ["选择连接", "推理 Chat", "推理 Messages"]);
    assert.equal(await page.locator("#askAdult").isChecked(), false);
    // The word list lives in the adult group and stays absent until the gate is on.
    const adultGroup = page.getByRole("region", { name: "创作", exact: true });
    assert.equal(await page.getByRole("switch", { name: "自由创作", exact: true }).isChecked(), false);
    assert.equal(await adultGroup.locator('.s-row').first().locator('p').count(), 0);
    assert.equal(await adultGroup.locator("#askAlwaysCodec").count(), 0);
    assert.equal(await page.getByRole("list", { name: "内置词条" }).count(), 0);
    assert.equal(await page.locator("#askImages").isChecked(), true);
    assert.equal(await page.getByRole("switch", { name: "发送图片给模型" }).isChecked(), true);
    assert.equal(await page.locator(".set-nav button", { hasText: "ASK" }).locator("use").getAttribute("href"), "/assets/icons.svg#i-ask");

    await page.locator("#askConnection").selectOption("claude");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.connectionId === "claude");
    // The selected connection shows its protocol and address like its card.
    assert.deepEqual((await page.locator("#askConnection").locator("xpath=ancestor::div[contains(@class,'s-row')]").locator(".s-meta span").allTextContents()).map((t) => t.trim()), ["Anthropic Messages", hosts.claude]);
    // The model list layout over the connection's catalog: a lamp per ID, the first one used becomes current.
    const act = (id) => `.lamp[aria-label$=" ${id}"]`, list = page.locator("#askModelDialog"), pick = (id) => list.locator(act(id));
    const tag = (id) => list.locator(".md-row", { has: page.locator(act(id)) }).locator(".md-miss");
    await page.getByRole("button", { name: "选择模型", exact: true }).click();
    await pick("reasoning-a").waitFor();
    assert.equal((await list.locator("#askModelTitle").textContent()).trim(), "推理 Messages 模型列表");
    assert.deepEqual(await list.locator(".md-row .md-id b").allTextContents(), ["reasoning-a", "reasoning-b"]);
    assert.deepEqual(await list.locator(".md-gtitle b").allTextContents(), ["其他"]);
    const fetched = requests.find((r) => r.host === hosts.claude);
    assert.equal(fetched.path, "/v1/models");
    assert.equal(fetched.headers["x-api-key"], "synthetic-claude");
    assert.equal(fetched.headers["anthropic-version"], "2023-06-01");
    await pick("reasoning-b").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.model === "reasoning-b");
    await pick("reasoning-a").click();
    // An ID outside the list is typed into the search field and stays marked.
    const search = list.getByRole("searchbox", { name: "搜索或填写模型 ID" });
    await search.fill("Manual Model (Thinking)");
    await search.press("Enter");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.models?.claude?.length === 3);
    assert.equal(await tag("Manual Model (Thinking)").textContent(), "列表外");
    assert.equal(await tag("reasoning-b").count(), 0);
    assert.equal(await pick("reasoning-b").getAttribute("data-s"), "on");
    // Dropping the current one moves to the next.
    await list.getByRole("tab", { name: "已用", exact: true }).click();
    assert.equal(await list.locator(".md-row").count(), 3);
    await pick("reasoning-b").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.model === "reasoning-a");
    await page.keyboard.press("Escape");
    await list.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#settingsPanel").evaluate((el) => el.open), true);
    // The row lists the picks with the current one checked; another row switches to it.
    const picks = page.getByRole("list", { name: "已选模型", exact: true }), current = picks.locator('[aria-current="true"] b');
    assert.deepEqual(await picks.locator("b").allTextContents(), ["reasoning-a", "Manual Model (Thinking)"]);
    assert.equal(await current.textContent(), "reasoning-a");
    assert.equal((await page.locator("#askModels").textContent()).trim(), "管理");
    await picks.getByRole("button", { name: "Manual Model (Thinking)", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.model === "Manual Model (Thinking)");
    assert.equal(await current.textContent(), "Manual Model (Thinking)");
    await picks.getByRole("button", { name: "reasoning-a", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.model === "reasoning-a");
    await page.locator('label[for="askImages"]').click();
    await page.locator("#askPreference").fill("先说结论");
    await page.locator("#askPreference").blur();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.preference === "先说结论");
    assert.deepEqual(await stored(page, "koma.ask.v1"), { version: 1, connectionId: "claude", model: "reasoning-a", models: { claude: ["reasoning-a", "Manual Model (Thinking)"] }, images: false, textAttachments: { chars: 50_000, totalChars: 100_000 }, compaction: { highWaterTokens: 220_000 }, preference: "先说结论", words: [], replacements: [], alwaysCodec: false });

    await page.locator('label[for="askAdult"]').click();
    await page.waitForFunction(() => localStorage.getItem("koma.ask.adult.v1") === "true");
    const words = adultGroup;
    await words.getByRole("switch", { name: "始终启用词表混淆" }).waitFor({ state: "attached" });
    assert.equal(await words.getByRole("list", { name: "内置词条" }).count(), 0);
    assert.equal(await words.getByRole("list", { name: "自定义词条" }).count(), 0);
    assert.equal(await words.getByRole("list", { name: "文本替换", exact: true }).count(), 0);
    const add = words.getByRole("textbox", { name: "添加词条" });
    await add.fill("See_Through");
    await words.getByRole("button", { name: "添加", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.words?.[0] === "see through");
    assert.deepEqual((await stored(page, "koma.ask.v1")).words, ["see through"]);
    await words.getByRole("button", { name: "删除 see through", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.words?.length === 0);
    const from = words.getByRole("textbox", { name: "原文 A", exact: true }), to = words.getByRole("textbox", { name: "替换为 B", exact: true });
    assert.equal(await from.inputValue(), ""); assert.equal(await to.inputValue(), "");
    await from.fill("red coat"); await to.fill("azure dress");
    await words.getByRole("button", { name: "添加替换", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.replacements?.[0]?.to === "azure dress");
    await words.getByRole("button", { name: "编辑替换 red coat", exact: true }).click();
    assert.equal(await from.inputValue(), "red coat");
    assert.equal(await from.evaluate(el => el === document.activeElement), true);
    await to.fill("amber dress");
    await words.getByRole("button", { name: "保存替换", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.replacements?.[0]?.to === "amber dress");
    await words.getByRole("button", { name: "编辑替换 red coat", exact: true }).click();
    await to.fill("unsaved"); await words.getByRole("button", { name: "取消", exact: true }).click();
    assert.deepEqual((await stored(page, "koma.ask.v1")).replacements, [{ from: "red coat", to: "amber dress" }]);
    await words.getByRole("button", { name: "删除替换 red coat", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.replacements?.length === 0);
    await from.fill("保留的服装描述与光影设定"); await to.fill("replacement_clothing_and_lighting");
    await words.getByRole("button", { name: "添加替换", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.replacements?.length === 1);
    await page.locator('label[for="askAdult"]').click();
    await page.waitForFunction(() => localStorage.getItem("koma.ask.adult.v1") === "false");
    assert.equal(await adultGroup.locator("#askAlwaysCodec").count(), 0);
    assert.equal(await page.getByRole("list", { name: "内置词条" }).count(), 0);

    await page.reload();
    await page.waitForSelector("#settingsPanel[open]");
    assert.equal(await current.textContent(), "reasoning-a");
    assert.equal(await page.locator("#askConnection").inputValue(), "claude");
    assert.equal(await page.locator("#askImages").isChecked(), false);
    await page.locator('label[for="askAdult"]').click();
    await words.getByRole("list", { name: "文本替换", exact: true }).waitFor();
    assert.deepEqual((await stored(page, "koma.ask.v1")).replacements, [{ from: "保留的服装描述与光影设定", to: "replacement_clothing_and_lighting" }]);

    await route(page, "#/image/settings/general");
    await page.locator("#historyLimit").waitFor();
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(80);
      const repository = page.getByRole("link", { name: "GitHub", exact: true });
      assert.equal(await repository.getAttribute("href"), "https://github.com/hasheeper/koma-image");
      assert.equal(await repository.getAttribute("rel"), "noopener noreferrer");
    }
    assert.deepEqual(errors, []);
    assert.ok(requests.every((r) => r.method === "GET" && r.path.endsWith("/v1/models")));
  } finally {
    await context.close();
  }
});

test("ASK compatibility: catalog and manual model IDs keep spaces/suffixes through the list, the quick switch, reload and tool turns", async () => {
  const modelIds = ["gemini-4", "Claude Sonnet 4.5 (Thinking)"];
  const { page, context, requests, errors, llm, calls } = await open("/#/image/settings/ask", { ask: askSettings() });
  try {
    await context.route(`https://${hosts.chat}/v1/models`, (route) => route.fulfill({ json: { data: modelIds.map((id) => ({ id })) } }));
    for (const id of [...modelIds, "vendor/Claude  Opus:thinking-预算"]) {
      await route(page, "#/image/settings/ask");
      await page.locator("#settingsPanel[open]").waitFor();
      await page.locator("#askModels").click();
      const list = page.locator("#askModelDialog");
      if (id === modelIds[0]) {
        // Catalogs carry no family: headings and icons follow the ID, the hand-kept pick sits under 其他.
        await list.locator(`.lamp[aria-label="选用 ${id}"]`).waitFor();
        assert.deepEqual(await list.locator(".md-gtitle b").allTextContents(), ["Claude", "Gemini", "其他"]);
        assert.deepEqual(await list.locator(".md-ghead .vtile use").evaluateAll((uses) => uses.map((u) => u.getAttribute("href"))), ["#v-claude-c", "#v-gemini-c", "/assets/icons.svg#i-model"]);
      }
      if (modelIds.includes(id)) await list.locator(`.lamp[aria-label="选用 ${id}"]`).click();
      else {
        await list.getByRole("searchbox", { name: "搜索或填写模型 ID" }).fill(id);
        await list.getByRole("searchbox", { name: "搜索或填写模型 ID" }).press("Enter");
      }
      await page.waitForFunction((id) => JSON.parse(localStorage.getItem("koma.ask.v1"))?.models?.chat?.includes(id), id);
      await page.keyboard.press("Escape");
      await list.waitFor({ state: "hidden" });
      await route(page, "#/image");
      await page.locator("#settingsPanel").waitFor({ state: "hidden" });
      if (!(await drawer(page).isVisible())) await page.keyboard.press("Control+j");
      await drawer(page).waitFor();
      // The composer's chip switches to the new pick; the title keeps exact spacing.
      await drawer(page).locator(".ask-model").click();
      await page.locator(`#askModelMenu [title="${id}"]`).click();
      await page.waitForFunction((id) => JSON.parse(localStorage.getItem("koma.ask.v1"))?.model === id, id);
      await page.reload();
      await page.waitForSelector(".switcher");
      await page.keyboard.press("Control+j");
      await drawer(page).waitFor();
      assert.equal(await drawer(page).locator(".ask-model-name").evaluate((el) => el.textContent), id);
      llm.push(
        { body: openai(tool("compat_state", "get_state"), end("tool_calls")) },
        { body: openai(text("模拟工具轮次完成。"), end()) },
      );
      const start = calls.length;
      await page.locator("#askPrompt").fill("读取当前工作台状态");
      await submitAsk(page);
      await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
      assert.equal(calls.length, start + 2);
      for (const call of calls.slice(start)) {
        assert.equal(call.path, "/v1/chat/completions");
        assert.equal(call.body.model, id);
        assert.equal(call.body.tools.length, 13);
        assert.equal(/"uniqueItems"\s*:/.test(JSON.stringify(call.body.tools)), false);
      }
      assert.equal(calls.at(-1).body.messages.at(-1).role, "tool");
    }
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("ASK composer: the model chip switches among picks across connections; a running turn keeps its model", async () => {
  const { page, context, llm, calls, requests, errors } = await open("/#/image", { ready: ".switcher", ask: askSettings({ models: { chat: ["reasoning-a", "reasoning-b"], claude: ["claude-x"] } }) });
  let release;
  const messages = anthropic(
    { type: "message_start", message: { id: "synthetic", usage: { input_tokens: 50, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "Messages 回答。" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  );
  try {
    await page.keyboard.press("Control+j");
    await drawer(page).waitFor();
    const chip = drawer(page).locator(".ask-model"), menu = page.locator("#askModelMenu");
    const send = async (question) => { await page.locator("#askPrompt").fill(question); await submitAsk(page); };
    assert.equal((await chip.textContent()).trim(), "reasoning-a");
    await chip.click();
    // With picks on more than one connection, each set sits under its connection's name.
    assert.deepEqual(await menu.locator(".ask-menu-group").allTextContents(), ["推理 Chat", "推理 Messages"]);
    assert.deepEqual(await menu.getByRole("menuitemradio").allTextContents(), ["reasoning-a", "reasoning-b", "claude-x"]);
    assert.equal(await menu.getByRole("menuitemradio", { name: "reasoning-a" }).getAttribute("aria-checked"), "true");
    await menu.getByRole("menuitemradio", { name: "claude-x" }).click();
    await menu.waitFor({ state: "detached" });
    await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem("koma.ask.v1")); return s.connectionId === "claude" && s.model === "claude-x"; });
    assert.equal((await chip.textContent()).trim(), "claude-x");
    // While a turn runs the picks are locked; the next turn uses the new one.
    llm.push({ body: messages, wait: new Promise((resolve) => { release = resolve; }) }, { body: openai(text("Chat 回答。"), end()) });
    const dispatched = page.waitForRequest((request) => reasoning.test(new URL(request.url()).pathname));
    await send("第一问");
    await dispatched;
    await chip.click();
    assert.equal(await menu.getByRole("menuitemradio", { name: "reasoning-b" }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    release();
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    await chip.click();
    await menu.getByRole("menuitemradio", { name: "reasoning-b" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1")).model === "reasoning-b");
    await send("第二问");
    await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
    assert.deepEqual(calls.map((c) => [c.host, c.body.model]), [[hosts.claude, "claude-x"], [hosts.chat, "reasoning-b"]]);
    // The last entry leads to the picks.
    await chip.click();
    await menu.getByRole("menuitem", { name: "管理模型" }).click();
    await page.waitForFunction(() => location.hash.endsWith("/settings/ask"));
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally {
    release?.();
    await context.close();
  }
});

test("ASK settings leave image work alone: cards, model sources and the protocol list", async () => {
  const { page, context, requests, errors } = await open("/#/image/settings/connections");
  try {
    await page.waitForFunction(() => [...document.querySelectorAll(".conn-card .st")].every((s) => s.dataset.s === "ok"));
    const card = (name) => page.locator(".conn-card", { hasText: name });
    const imageGroup = page.getByRole("region", { name: "图像供应商", exact: true });
    const llmGroup = page.getByRole("region", { name: "文本供应商", exact: true });
    assert.equal(await imageGroup.locator(".conn-card").count(), 1);
    assert.equal(await imageGroup.locator(".conn-priority").count(), 1);
    assert.deepEqual(await llmGroup.locator(".conn-name b").allTextContents(), ["推理 Chat", "推理 Messages"]);
    assert.equal(await llmGroup.locator(".conn-priority").count(), 0);
    assert.equal(await llmGroup.locator(".conn-meters").count(), 0);
    for (const name of ["推理 Chat", "推理 Messages"])
      assert.match(await card(name).locator(".connection-avatar use").getAttribute("href"), /#i-chat$/);
    assert.match(await card("图像连接").locator(".connection-avatar use").getAttribute("href"), /#i-image$/);

    assert.match(await card("推理 Chat").locator(".conn-models").textContent(), /ASK 模型\s*2 个 ID/);
    // The card ASK uses names its model; the others keep their catalog count.
    await page.evaluate(() => localStorage.setItem("koma.ask.v1", JSON.stringify({ version: 1, connectionId: "claude", model: "reasoning-b", images: true, preference: "", words: [], alwaysCodec: false })));
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "koma.ask.v1" })));
    await page.waitForFunction(() => /使用中 · reasoning-b/.test([...document.querySelectorAll(".conn-card")].find((c) => c.textContent.includes("推理 Messages"))?.querySelector(".conn-models")?.textContent ?? ""));
    assert.match(await card("推理 Chat").locator(".conn-models").textContent(), /2 个 ID/);
    assert.match(await card("图像连接").locator(".conn-models").textContent(), /模型\s*1\s*个可用/);
    // Like an image card, the row opens that connection's list, with ASK's picks ticked.
    await card("推理 Messages").locator(".conn-models").click();
    const list = page.locator("#askModelDialog");
    await list.locator(".lamp").first().waitFor();
    assert.match(await list.locator(".connection-avatar use").getAttribute("href"), /#i-chat$/);
    assert.equal((await list.locator("#askModelTitle").textContent()).trim(), "推理 Messages 模型列表");
    assert.deepEqual(await list.locator(".lamp").evaluateAll((lamps) => lamps.map((l) => l.dataset.s)), ["off", "on"]);
    await list.getByRole("button", { name: "选用 reasoning-a", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.ask.v1"))?.models?.claude?.length === 2);
    await page.keyboard.press("Escape");
    await list.waitFor({ state: "hidden" });
    assert.match(await card("推理 Messages").locator(".conn-models").textContent(), /使用中 · reasoning-b/);
    // A connection ASK does not use shows how many it picked there.
    await page.evaluate(() => localStorage.setItem("koma.ask.v1", JSON.stringify({ version: 1, connectionId: "claude", model: "reasoning-b", models: { chat: ["reasoning-a"] }, images: true, preference: "", words: [], alwaysCodec: false })));
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "koma.ask.v1" })));
    await page.waitForFunction(() => /已选 1 个/.test([...document.querySelectorAll(".conn-card")].find((c) => c.textContent.includes("推理 Chat"))?.querySelector(".conn-models")?.textContent ?? ""));
    // Expanded image models list their sources; reasoning connections are not among them.
    await route(page, "#/image/settings/models");
    await page.getByRole("button", { name: /^展开 .+ 的来源$/ }).first().click();
    await page.locator(".sm-lines .sm-conn").first().waitFor();
    assert.deepEqual([...new Set(await page.locator(".sm-lines .sm-conn").allTextContents())], ["图像连接"]);
    await route(page, "#/image/settings/connections");
    await page.getByRole("button", { name: "配置供应商", exact: true }).click();
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
