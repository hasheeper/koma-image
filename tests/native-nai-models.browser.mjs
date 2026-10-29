import { test } from "node:test";
import assert from "node:assert/strict";

import { useNativeFixture, origin, open, bind, chooseNai, openEditorFixture } from "./helpers/native-fixture.mjs";

useNativeFixture();

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
        {
      const width = 1440;
          await page.setViewportSize({ width, height: 900 });
          await page.locator("#resetAdv").scrollIntoViewIfNeeded();
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

test("NovelAI controls: compact presets, real Medium wire, remembered High parameters, imports", async () => {
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
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#tab-prompt").scrollIntoViewIfNeeded();
      await page.evaluate(() => ui.notices.value.forEach(n => ui.dismissNotice(n.id)));
      // Mode and Effort sit side by side under the full-width model field.
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
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#effort").scrollIntoViewIfNeeded();
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.mouse.move(0, 0);

      await page.locator("#qualityPreset").click();
      const menu = page.locator(".nai-menu:popover-open");
      assert.equal(await menu.getByRole("menuitemradio", { name: "Standard", exact: true }).getAttribute("aria-checked"), "true");

      await page.keyboard.press("Escape"); assert.equal(await page.locator("#qualityPreset").evaluate(el => el === document.activeElement), true);
    }
    await page.evaluate(() => drawing.patch({ complexity: "none", qualityPreset: "none", transparentBg: false }));
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(0, 0);
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

test("NAI guidance: official and gateway routes keep rescale through EDIT, history without legacy cfg", async () => {
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
      {
      const width = 1440;
        await page.setViewportSize({ width, height: 900 });
        await page.locator("#editorCfgRescale").scrollIntoViewIfNeeded();
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
    await page.getByRole("button", { name: "配置供应商", exact: true }).click();
    await page.locator("#connectionProtocol").selectOption("nai-official-v1");
    await page.locator("#connectionName").fill("模拟未订阅账号");
    assert.equal(await page.locator("#connectionUrl").inputValue(), "https://image.novelai.net");
    assert.equal(await page.locator("dialog[open]:has(#connectionTitle) .hint").count(), 0);
    await page.locator("#connectionKey").fill("synthetic-native-only");
    await page.getByRole("checkbox", { name: "在此浏览器保存 Key" }).uncheck();
    await page.locator("dialog[open]:has(#connectionTitle)").getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".conn-card .st")?.dataset.s === "ok" && drawing.snapshot().models.length === 5);
    assert.match(await page.locator(".conn-card .st").textContent(), /^Key 有效/);
    assert.match(await page.locator(".conn-card .st").getAttribute("title"), /Key 有效 · 未订阅 · 生图尚未实测/);
    await page.waitForFunction(() => document.querySelector(".conn-meter b")?.textContent.trim() === "7");
    assert.match(await page.locator(".conn-meter").textContent(), /Anlas/);
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await page.locator('.toast[data-tone="ok"]').filter({ hasText: "Key 有效 · 未订阅" }).waitFor();
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator(".conn-card .conn-meta").isVisible());
    }
    assert.ok(t.requests.length > 0);
    assert.ok(t.requests.every(r => r.method === "GET" && r.url === "https://image.novelai.net/user/subscription" && r.headers.authorization === "Bearer synthetic-native-only"));
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test("NovelAI V5 settings: independent usage, refreshed states without generating", async () => {
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
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await usage.locator("b").isVisible());
      assert.ok(await usage.getByText("约 1,176 张", { exact: true }).isVisible());
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

test("native connection settings: explicit protocol, saved selection, key input, switch", async () => {
  const t = await open("gemini-native-v1", false), { page } = t;
  try {
    await page.locator("#settingsPanel[open]").waitFor();
    await page.getByRole("button", { name: "配置供应商", exact: true }).click();
    await page.locator("#connectionProtocol").selectOption("gemini-native-v1");
    await page.locator("#connectionName").fill("模拟原生连接");
    await page.locator("#connectionUrl").fill("https://gateway.example.test/google");
    await page.locator("#connectionKey").fill("synthetic-native-only");
    await page.getByRole("checkbox", { name: "在此浏览器保存 Key" }).uncheck();
    await page.locator("dialog[open]:has(#connectionTitle)").getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".conn-card .st")?.dataset.s === "ok");
    assert.match(await page.locator(".conn-card .conn-name .type").textContent(), /Gemini 原生/);
    assert.ok(t.requests.every(r => r.method === "GET"));
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator(".conn-card .conn-meta").isVisible());
    }
    // The protocol is changed in the connection form; NovelAI official still needs its own connection.
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "配置供应商", exact: true }).click();
    const form = page.locator("dialog[open]:has(#connectionTitle)"), protocol = form.getByRole("combobox", { name: "接口协议", exact: true });
    assert.equal(await protocol.inputValue(), "gemini-native-v1");
    await protocol.selectOption("nai-official-v1");
    assert.equal(await protocol.inputValue(), "gemini-native-v1");
    assert.match(await form.locator(".modal-error").textContent(), /单独配置 NovelAI 官方供应商/);
    assert.ok(t.requests.every(r => !r.path.includes("/user/subscription")));
    await protocol.selectOption("openai-images-v1");
    await page.locator("#connectionKey").fill("synthetic-openai-only");
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
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      await chooseNai(page, "effort", "medium");
      await chooseNai(page, "effort", "high");
      await page.locator("#model").scrollIntoViewIfNeeded();
      await page.evaluate(() => { ui.notices.value.forEach(n => ui.dismissNotice(n.id)); document.activeElement?.blur(); });
      await page.mouse.move(0, 0);
      for (const id of ["model", "qualityPreset"]) {
        await page.locator(`#${id}`).click();
        const menu = page.locator(".nai-menu:popover-open");
        // Reduced motion still turns the menu's position writes into 0.01ms transitions; measure once they settle.
        await page.keyboard.press("Escape");
        assert.equal(await menu.count(), 0);
      }
    }
    await page.locator('#naiMode input[value="furry"]').focus(); await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator("#naiMode").getAttribute("data-value"), "anime");
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(700, 700);
    await page.locator("#qualityPreset").click();
    await page.mouse.move(700, 700);
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

test("NAI parameter alignment: official drawers, manual Guidance, schedules", async () => {
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
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.locator('#editorNoiseSchedule').scrollIntoViewIfNeeded();

    }
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test("Variety+: compact V4.5 toggle, actual requests, model switching, EDIT", async () => {
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
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await button.scrollIntoViewIfNeeded();
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
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});await editButton.scrollIntoViewIfNeeded();
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

test("NAI local estimates and model token budgets share compact IMAGE/EDIT UI at", async()=>{
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
