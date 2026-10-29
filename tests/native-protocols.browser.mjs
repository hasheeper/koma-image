import { test } from "node:test";
import assert from "node:assert/strict";

import { useNativeFixture, origin, open, bind } from "./helpers/native-fixture.mjs";

useNativeFixture();

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

    await official.locator(".conn-models").click();
    await page.getByRole("tab", { name: "优先来源", exact: true }).click();
    assert.equal(await page.locator("#modelListDialog .md-row").count(), 5);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".set-nav button").filter({ hasText: "模型" }).click();
    await page.getByRole("button", { name: "展开 NAI Diffusion V5 Full 的来源", exact: true }).click();
    const sources = page.locator('[data-model="nai-diffusion-5-full"] .sm-lines');
    assert.equal(await sources.locator('.md-act[aria-pressed="true"]').count(), 2);

    await page.locator("#settingsPanel .set-back").click();
    await page.evaluate(() => ui.notices.value.forEach(n => ui.dismissNotice(n.id)));
    await page.waitForFunction(() => !document.querySelector('.toast'));
    const wallet = page.locator("#meters:visible");
    assert.match(await wallet.textContent(), /68%.*约 1176 张.*8,150/);
    assert.doesNotMatch(await wallet.textContent(), /174|5,000/);
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
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
  for (const [name, profile, baseUrl, glyph] of [
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
