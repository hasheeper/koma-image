import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { useAskFixture, submitAsk, hosts, reasoning, open, openai, text, tool, end, anthropic, askSettings, generation, bind, addImage, drawer, openMore, route } from "./helpers/ask-fixture.mjs";

useAskFixture();

test("ASK Markdown: headings, nested lists, tables, literal code and links render in four widths; copy retains source", async () => {
  const sample = await readFile(new URL('./fixtures/ask-markdown.md', import.meta.url), 'utf8');
  const { page, context, requests, errors, llm } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page); await addImage(page, 'synthetic test image');
    await page.keyboard.press('Control+j'); await drawer(page).waitFor();
    llm.push({ body: openai(...sample.match(/.{1,60}|\n/g).map(chunk => text(chunk)), end()) });
    await page.locator('#askPrompt').fill('检查 Markdown 排版'); await submitAsk(page);
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    const md = drawer(page).locator('.ask-markdown');
    assert.deepEqual(await md.locator('h3').allTextContents(), ['1. 表现到位的地方','2. 画面目前存在的问题','3. 提示词层面的潜在诱因']);
    assert.equal(await md.locator('ul > li > ul > li > ol').count(), 1);
    assert.equal(await md.locator(':scope > ol').getAttribute('start'), '4');
    assert.equal(await md.locator('strong em').textContent(), '人物特征');
    assert.equal(await md.locator('strong').filter({hasText:'画风框架已就绪'}).textContent(), ' “画风框架已就绪，但角色设定尚未交接” ');
    assert.equal(await md.locator('strong').filter({hasText:'保留英文双引号'}).textContent(), '"保留英文双引号"');
    assert.equal(await md.locator('del').textContent(), '重复动作');
    assert.equal(await md.locator('blockquote').count(), 1);
    assert.equal(await md.locator('table tbody tr').count(), 2);
    assert.equal(await md.locator('table tbody tr').nth(1).locator('br').count(),3);
    assert.doesNotMatch(await md.locator('table').textContent(),/<br\s*\/?>/i);
    assert.deepEqual(await md.locator('input[type="checkbox"]').evaluateAll(nodes => nodes.map(n => [n.checked,n.disabled])), [[true,true],[false,true]]);
    assert.equal(await md.locator('pre h3, pre .ask-id, img, script').count(), 0);
    assert.match(await md.locator('pre code').textContent(), /### 这里是原始提示词/);
    assert.equal(await md.locator('a').filter({hasText:'无效链接'}).count(), 0);
    assert.equal(await md.locator('a .ask-id').count(), 0);
    assert.equal(await page.evaluate(()=>window.markdownExecuted), undefined);
    assert.ok((await md.textContent()).includes('实体：& < ©'));
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('.ask-stream').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
      await page.waitForTimeout(120);
      assert.ok(await md.evaluate(el=>el.scrollWidth<=el.clientWidth+1), `reply overflow at ${width}`);
      assert.ok(await drawer(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1), `window overflow at ${width}`);
      const message = await drawer(page).locator('.ask-turn').evaluate(el => {
        const question = el.querySelector('.ask-q'), user = question.parentElement;
        const q = getComputedStyle(question), u = getComputedStyle(user);
        const actions = getComputedStyle(el.querySelector('.ask-q-acts'));
        const button = getComputedStyle(el.querySelector('.ask-q-acts .ask-act'));
        const reply = getComputedStyle(el.querySelector('.ask-markdown'));
        const stream = getComputedStyle(el.closest('.ask-stream'));
        return {
          userAlignment: u.alignSelf, userDisplay: u.display, bubbleRadius: q.borderRadius,
          bubbleBackground: q.backgroundColor, actionsAlignment: actions.alignSelf,
          actionsDisplay: actions.display, buttonWidth: button.width,
          replyColor: reply.color, streamColor: stream.color,
          replyLineHeight: reply.lineHeight, streamLineHeight: stream.lineHeight,
          rightGap: el.getBoundingClientRect().right - user.getBoundingClientRect().right,
        };
      });
      assert.equal(message.userAlignment, 'flex-end', `question stays right-aligned at ${width}`);
      assert.equal(message.userDisplay, 'flex');
      assert.equal(message.bubbleRadius, '14px');
      assert.notEqual(message.bubbleBackground, 'rgba(0, 0, 0, 0)', 'question retains its bubble surface');
      assert.equal(message.actionsAlignment, 'flex-end');
      assert.equal(message.actionsDisplay, 'flex');
      assert.equal(message.buttonWidth, '28px');
      assert.equal(message.replyColor, message.streamColor, 'reply keeps the approved text contrast');
      assert.equal(message.replyLineHeight, message.streamLineHeight, 'reply keeps the message line height');
      assert.ok(Math.abs(message.rightGap) < 1, `question and actions use the right edge at ${width}`);
      assert.equal(await md.locator('h3').first().evaluate(el=>getComputedStyle(el).fontSize), '14px');
      await drawer(page).screenshot({path:`.local/ask/markdown/reply-${width}.png`});
      await md.locator('table').scrollIntoViewIfNeeded();
      await drawer(page).screenshot({path:`.local/ask/markdown/table-${width}.png`});
      await md.locator('pre').scrollIntoViewIfNeeded();
      assert.ok(await md.locator('pre').evaluate(el=>el.scrollWidth>el.clientWidth), 'long code scrolls inside the block');
      await drawer(page).screenshot({path:`.local/ask/markdown/code-${width}.png`});
    }
    assert.doesNotMatch(await md.evaluate(el => getComputedStyle(el).animationName), /ask-rise/, 'reduced motion removes message movement');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.match(await md.evaluate(el => getComputedStyle(el).animationName), /ask-rise/, 'normal motion retains the original message entrance');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ref = md.locator('.ask-id').first();
    await ref.scrollIntoViewIfNeeded(); await ref.hover(); await page.locator('.ask-preview').waitFor();
    await page.mouse.move(0,0); await page.locator('.ask-preview').waitFor({state:'detached'});
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await drawer(page).getByRole('button',{name:'复制回答',exact:true}).click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()), sample.trim());
    await drawer(page).getByRole('button',{name:'收起 ASK',exact:true}).click();
    assert.match(await page.locator('.ask-summary').textContent(), /#h1 的整体氛围稳定/);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
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
    assert.equal(await drawer(page).locator(".ask-capsule-id").count(), 0);
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
    await submitAsk(page);
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
    const announced = await page.locator('#askIsland [aria-live="polite"]').textContent();
    assert.match(announced, /先读一下状态。[\s\S]*原因[\s\S]*#h1 的色调词/);
    assert.equal(await page.evaluate(() => ask.announce.value.id), 1, "one announcement per finished turn");
    assert.match(await (await openMore(page)).getByRole("menuitem", { name: /调用调试/ }).getAttribute("title"), /tokens/);
    await page.keyboard.press("Escape");
    await page.locator("#askMoreMenu").waitFor({ state: "detached" });
    await drawer(page).screenshot({ path: ".local/ask/drawer-turn.png" });

    assert.equal(calls.length, 2);
    const [first, second] = calls;
    assert.equal(first.headers.authorization, "Bearer synthetic-chat");
    assert.equal(first.body.model, "reasoning-a");
    assert.deepEqual(first.body.tools.map((t) => t.function.name), ["get_state", "check_nai_input", "search_history", "get_meta", "diff_meta", "view_image", "view_sheet", "search_tags", "get_chat_context", "get_model_manual", "propose_draft", "get_turn", "read_ref"]);
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
    await submitAsk(page);
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
    const menu = await openMore(page);
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['压缩上下文','调用调试']);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await drawer(page).isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "更多");

    llm.push({ delay: 4000, body: openai(text("太迟了"), end()) });
    await page.locator("#askPrompt").fill("越改越糊？");
    await submitAsk(page);
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
    await submitAsk(page);
    const failed = drawer(page).locator('.ask-turn[data-status="failed"]');
    await failed.waitFor();
    assert.match(await failed.locator(".ask-fail-text").textContent(), /content_filter/);
    assert.deepEqual((await failed.locator(".ask-fail-actions button").allTextContents()).map((t) => t.trim()), ["重试", "仅发元数据重试", "设置"]);
    assert.match(await failed.locator(".ask-meta").textContent(), /开启自由创作后启用词表混淆/);
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
    await submitAsk(page);
    await failed.waitFor();
    assert.deepEqual((await failed.locator(".ask-fail-actions button").allTextContents()).map((t) => t.trim()), ["重试", "仅发元数据重试", "设置"], 'empty vocabulary does not offer an ineffective codec retry');
    const emptyCalls = calls.length;
    await page.evaluate(() => {
      const failed = ask.entries.value.find(e => e.type === 'turn' && e.turn.status === 'failed');
      ask.retry(failed.id, 'codec');
    });
    assert.equal(calls.length, emptyCalls);
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem("koma.ask.v1"));
      localStorage.setItem("koma.ask.v1", JSON.stringify({ ...settings, words: ["nsfw"] }));
      window.dispatchEvent(new StorageEvent("storage", { key: "koma.ask.v1" }));
    });
    await failed.getByRole("button", { name: "启用词表混淆并重试" }).waitFor();
    assert.deepEqual((await failed.locator(".ask-fail-actions button").allTextContents()).map((t) => t.trim()), ["重试", "启用词表混淆并重试", "仅发元数据重试"]);
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

test("ASK drawer layering: settings above it, available in EDIT and hidden during Photopea, Anthropic turns, floating bounds on four screens", async () => {
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
    await page.waitForSelector("#imageEditor[data-active=true]");
    await drawer(page).waitFor();
    await page.evaluate(() => { window.photopeaTest = editor.beginExternalEdit(); });
    await drawer(page).waitFor({ state: "hidden" });
    await page.keyboard.press("Control+j");
    await page.waitForTimeout(150);
    assert.equal(await drawer(page).isVisible(), false);
    await page.evaluate(() => { editor.cancelExternalEdit(window.photopeaTest.id); ask.show(); location.hash = "#/image"; });
    await page.waitForSelector("#imageEditor", { state: "hidden" });
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
    await submitAsk(page);
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
      if (width > 860) {
        assert.ok(rect.left >= 8 && rect.left + rect.width <= width - 7, `horizontal bounds at ${width}`);
        assert.ok(rect.top >= 8 && rect.bottom <= 893, `vertical bounds at ${width}`);
        assert.equal(Math.round(rect.width), Math.min(420, width - 16));
        const rail = await page.locator('#gallery').boundingBox();
        const bar = await page.locator('body > .topbar').boundingBox();
        assert.equal(Math.round(bar.width + rail.width), width, 'workspace retains its full width');
        assert.equal(Math.round(rail.x + rail.width), width);
      } else {
        assert.equal(rect.left, 0);
        assert.equal(rect.top, 0);
        assert.equal(Math.round(rect.width), width);
        assert.equal(rect.bottom, 900);
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
    await submitAsk(page);
    await page.waitForFunction(() => ask.usage.value.input === 3600 && ask.running.value);
    const before = await page.evaluate(() => ({ running: ask.running.value, status: ask.live.value?.status }));
    assert.equal(before.running, true, "still shows a stoppable running turn");
    await drawer(page).getByRole("button", { name: "停止", exact: true }).click();
    await page.waitForFunction(() => !ask.running.value);
    const after = await page.evaluate(() => ask.entries.value.filter(e => e.type === "turn").map(e => ({ status: e.turn.status, question: e.turn.question })));
    llm.push({ body: openai(text("audit next answer"), end()) });
    await page.locator("#askPrompt").fill("audit next question");
    await submitAsk(page);
    await drawer(page).locator('.ask-turn[data-status="done"]').last().waitFor();
    await page.waitForFunction(() => !ask.running.value);
    const nextHistory = calls.at(-1).body.messages.filter(m => m.role === "user").map(m => m.content);
    assert.equal(nextHistory.some(t => String(t).includes("audit cancelled question")), false);
    assert.equal(after[0].status, "stopped", "Stop while pacing must not commit as done");
  } finally { await context.close(); }
});
