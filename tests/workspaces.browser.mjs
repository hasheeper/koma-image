import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createServer } from './helpers/vite.mjs';
import { chromium } from "playwright";
let browser, server, origin;
const catalog = {
  studio_features: { version: 2, max_cost: true, max_context_images: 3 },
  valid_samplers: ["k_euler_ancestral", "k_euler"],
  models: {
    "nai-diffusion-5-full": {
      name: "NAI Diffusion V5 Full",
      provider: "novelai",
      max_resolution: 1048576,
      operations: ["generate", "edit"],
      tools: ["img2img", "inpaint", "upscale"],
      quota_group: "novelai",
    },
    "gpt-image-2": {
      name: "GPT Image 2",
      provider: "openai",
      editor_family: "gpt",
      operations: ["generate", "edit"],
      tools: ["image-edit"],
      quota_group: "openai",
      image_capabilities: {
        fields: {
          quality: { options: ["auto", "low", "high"], default: "auto" },
          size: { options: ["1024x1024", "1536x1024"], default: "1024x1024" },
        },
      },
    },
    "gemini-3.1-flash-lite-image": {
      name: "Nano Banana 2 Lite",
      provider: "gemini",
      operations: ["generate", "edit"],
      tools: ["image-edit"],
      image_capabilities: {
        fields: { image_size: { options: ["1K"], default: "1K" } },
      },
    },
    "fal-upscale": {
      name: "Dedicated Upscale",
      provider: "fal",
      operations: ["edit"],
      tools: ["image-edit"],
      image_capabilities: {
        fields: {
          output_format: { options: ["png", "jpeg", "jpg"], default: "png" },
        },
      },
    },
  },
};
before(async () => {

  server = await createServer({
    server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
async function bind(page) {
  await page.evaluate(() => {
    const p = document.body.__vue_app__._instance.provides,
      a = document.body.__vue_app__._context.provides;
    for (const name of ["chat", "editor", "drawing", "ui", "app-shell"])
      window[name.replace("-", "_")] =
        p[Object.getOwnPropertySymbols(p).find((k) => k.description === name)];
    window.services =
      a[
        Object.getOwnPropertySymbols(a).find(
          (k) => k.description === "application-services",
        )
      ];
  });
}
async function open(path = "#/chat", extraModels = {}) {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  const state = {
    cost: 0,
    generations: 0,
    fail: false,
    hold: false,
    release: null,
    multiple: false,
  };
  await context.addInitScript(() => {
    if (location.protocol === "about:") return;
    localStorage.setItem(
      "koma.routing.v1",
      JSON.stringify({
        version: 1,
        connections: {
          test: {
            id: "test",
            name: "模拟连接",
            baseUrl: "https://gateway.example.test",
            profileId: "koma-standard-v1",
            credentialRef: "test-key",
            revision: "rev-1",
          },
        },
        links: {},
      }),
    );
    sessionStorage.setItem(
      "koma.session.keys",
      JSON.stringify({ "test-key": "synthetic-only-key" }),
    );
    const live = new Set(),
      create = URL.createObjectURL,
      revoke = URL.revokeObjectURL;
    window.liveImageUrls = live;
    URL.createObjectURL = (blob) => {
      const u = create(blob);
      live.add(u);
      return u;
    };
    URL.revokeObjectURL = (u) => {
      live.delete(u);
      revoke(u);
    };
  });
  await page.goto("about:blank");
  const image = async (w, h, color) =>
    Buffer.from(
      await page.evaluate(
        ({ w, h, color }) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const x = c.getContext("2d");
          x.fillStyle = color;
          x.fillRect(0, 0, w, h);
          x.fillStyle = "#b9c9e1";
          x.fillRect(w / 8, h / 8, w / 2, h / 2);
          return c.toDataURL().split(",")[1];
        },
        { w, h, color },
      ),
      "base64",
    );
  const png = await image(512, 512, "#26344d"),
    up = await image(1024, 1024, "#514b80"),
    ref = await image(384, 512, "#735057");
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.host !== "gateway.example.test")
      return route.fulfill({ json: { results: [] } });
    const payload = route.request().postDataJSON();
    requests.push({ path: url.pathname, payload });
    if (url.pathname.endsWith("/image/models"))
      return route.fulfill({ json: { ...catalog, models: { ...catalog.models, ...extraModels } } });
    if (url.pathname.endsWith("/media/quota"))
      return route.fulfill({
        json: {
          credits: { remaining: 42 },
          images: {
            novelai: { remaining: 20, limit: 100 },
            openai: { remaining: 5, limit: 10 },
          },
        },
      });
    if (url.pathname.endsWith("/token_stats_data"))
      return route.fulfill({ json: { temp_limits: { is_temp: false } } });
    if (url.pathname.endsWith("/estimate"))
      return route.fulfill({ json: { cost: state.cost } });
    state.generations++;
    if (state.hold) await new Promise((r) => (state.release = r));
    if (state.fail)
      return route.fulfill({
        status: 500,
        json: { error: "synthetic failure" },
      });
    const bytes =
      payload.tool === "upscale" || payload.model === "fal-upscale" ? up : png;
    return route.fulfill({
      json: {
        candidates: [
          {
            content: {
              parts: [
                { text: "模拟结果说明" },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: bytes.toString("base64"),
                  },
                },
                ...(state.multiple
                  ? [
                      { text: "第二张" },
                      {
                        inlineData: {
                          mimeType: "image/png",
                          data: ref.toString("base64"),
                        },
                      },
                    ]
                  : []),
              ],
            },
          },
        ],
      },
    });
  });
  await page.goto(`${origin}/${path}`);
  await page.waitForSelector("[data-workspace-root]");
  await bind(page);
  if (path.includes("chat"))
    await page.waitForFunction(() => chat.snapshot().ready);
  return {
    context,
    page,
    state,
    requests,
    png,
    ref,
    up,
    errors,
    async close() {
      state.release?.();
      await context.close();
      assert.deepEqual(errors, []);
    },
  };
}
const posts = (t) =>
  t.requests.filter(
    (r) => r.path.endsWith("/run") || r.path.endsWith("/generate"),
  );
async function send(t, text = "画一片蓝色森林") {
  await t.page.locator("#chatPrompt").fill(text);
  await t.page
    .getByRole("button", { name: "发送绘图请求", exact: true })
    .click();
  await t.page.waitForFunction(
    () =>
      !chat.snapshot().busy &&
      chat.snapshot().current.turns.at(-1)?.versions.at(-1)?.status === "done",
  );
}
function resultAction(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}
async function showResultTools(turn) {
  await turn.locator(".chat-result").first().hover();
}
async function openRerun(page, turn) {
  await showResultTools(turn);
  await resultAction(turn, '重新生成').click();
  return page.getByRole('dialog', { name: '重新生成', exact: true });
}
async function rerunVersion(page, turn) {
  await (await openRerun(page, turn)).getByRole('button', { name: '生成新版本' }).click();
}
async function editorSource(t, origin = "image", mode = "img2img") {
  await t.page.evaluate(
    async ({ png, origin, mode }) => {
      const blob = new Blob(
        [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
        { type: "image/png" },
      );
      await editor.open(origin, blob, "synthetic.png", {
        mode,
        conversationId:
          origin === "chat" ? chat.snapshot().current.id : undefined,
      });
    },
    { png: t.png.toString("base64"), origin, mode },
  );
  await t.page.waitForSelector("#imageEditor[data-active=true]");
  await t.page.waitForFunction(
    () =>
      editor.snapshot().edit.quote !== null ||
      editor.snapshot().upscale.quote !== null,
  );
}
async function closeEditor(p) {
  await p.evaluate(() => app_shell.router.switchWorkspace(editor.session.origin === "chat" ? "chat" : "image"));
  await p.waitForSelector("#imageEditor", { state: "hidden" });
}

test("[core] M5 chat UI: ordered response, exact context, consumption, version/branch selection, model caps and draft persistence", async () => {
  const t = await open(),
    p = t.page;
  try {
    await p.locator("input[type=file]").first().setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: t.ref,
    });
    await p.waitForSelector(".attachment");
    await send(t, "  调整颜色  ");
    let payload = posts(t)[0].payload;
    assert.equal(payload.tool, "image-edit");
    assert.equal(payload.prompt, "  调整颜色  ");
    assert.equal(payload.max_cost, 0);
    assert.equal(await p.locator(".attachment").count(), 0);
    assert.equal(await p.locator(".msg-text").textContent(), "模拟结果说明");
    await p.locator("#chatPrompt").fill("下一轮");
    await p.getByRole("button", { name: "上下文", exact: true }).click();
    await p.waitForSelector("#contextPanel[open]");
    assert.equal(
      await p.locator(".context-tile[data-state=base] .context-badge").textContent(),
      "底图",
    );
    assert.equal(await p.locator(".context-tile[data-state=ref]").count(), 1);
    await p.locator(".context-follow").click();
    const before = await p.evaluate(() => chat.snapshot().current.mainId);
    await p.getByRole("button", { name: "关闭上下文", exact: true }).click();
    await send(t, "下一轮");
    assert.equal(
      await p.evaluate(() => chat.snapshot().current.mainId),
      before,
    );
    payload = posts(t)[1].payload;
    assert.match(payload.prompt, /此前的绘图要求/);
    assert.equal(payload.additional_images.length, 1);
    await rerunVersion(p, p.locator(".chat-turn").first());
    await p.waitForFunction(
      () =>
        chat.snapshot().current.turns[0].versions.length === 2 &&
        !chat.snapshot().busy,
    );
    assert.equal(
      await p
        .locator(".chat-turn")
        .first()
        .locator(".version-count")
        .textContent(),
      "1/2",
    );
    await p
      .locator(".chat-turn")
      .first()
      .getByRole("button", { name: "第 1 个版本 · 已完成", exact: true })
      .click();
    assert.equal(
      await p
        .locator(".chat-turn")
        .first()
        .locator(".version-count")
        .textContent(),
      "1/2",
    );
    await p.evaluate(() => chat.setModel("gemini-3.1-flash-lite-image"));
    // The composer's context chip says how many pictures fall past the cap.
    await p.getByRole("button", { name: "上下文", exact: true }).click();
    assert.equal(
      await p.locator(".context-tile[data-dropped=true]").count(),
      1,
    );
    await p.getByRole("button", { name: "关闭上下文", exact: true }).click();
    await p.locator("#chatPrompt").fill("保留草稿");
    await p.evaluate(() => chat.flush());
    await p.evaluate(() => (location.hash = "#/image"));
    await p.waitForSelector("#prompt");
    await p.evaluate(() => (location.hash = "#/chat"));
    await p.waitForSelector("#chatPrompt");
    assert.equal(await p.locator("#chatPrompt").inputValue(), "保留草稿");
    await p.reload();
    await p.waitForSelector(".chat-turn");
    await bind(p);
    assert.equal(await p.locator("#chatPrompt").inputValue(), "保留草稿");
    await p.locator('.chat-result img').first().scrollIntoViewIfNeeded();
    await p.waitForFunction(() => document.querySelector('.chat-result img').naturalWidth > 0);
    assert.equal(
      await p
        .locator(".chat-result img")
        .first()
        .evaluate((img) => img.naturalWidth),
      512,
    );
  } finally {
    await t.close();
  }
});
test('CHAT 协创分屏保留参数浮层左侧选项的鼠标操作', async () => {
  const model = 'gpt-image-2', original = catalog.models[model];
  const fixture = await open('#/chat', { [model]: {
    ...original,
    image_capabilities: { fields: {
      ...original.image_capabilities.fields,
      quality: { options: ['auto', 'low', 'medium', 'high', 'xhigh'], default: 'auto' },
      output_format: { options: ['png', 'jpeg', 'webp'], default: 'png' },
    } },
  } });
  const { page } = fixture;
  try {
    await page.setViewportSize({ width: 1120, height: 850 });
    await page.evaluate(() => location.hash = '#/chat/settings/general');
    await page.locator('.s-toggle[title="画布协创 BETA"]').click();
    await page.evaluate(() => location.hash = '#/chat');
    await page.getByRole('group', { name: '对话侧栏内容' }).getByRole('button', { name: '上下文', exact: true }).click();
    const divider = page.getByRole('separator', { name: '调整对话侧栏宽度' });
    await divider.press('Shift+ArrowLeft');
    await divider.press('Shift+ArrowLeft');
    assert.equal(await divider.getAttribute('aria-valuenow'), '45');
    await page.evaluate(model => chat.setModel(model), model);
    await page.getByRole('button', { name: /^参数：/ }).click();
    const params = page.getByRole('dialog', { name: '参数', exact: true });
    await params.getByRole('radio', { name: '草稿', exact: true }).check({ timeout: 3000 });
    assert.equal(await page.evaluate(() => chat.snapshot().current.settings.options.quality), 'low');
    assert.equal(posts(fixture).length, 0);
  } finally { await fixture.close(); }
});

test('CHAT同轮重新生成：可改模型与参数，复用原请求，版本可对比并持久保存', { timeout: 45000 }, async () => {
  const target = 'gemini-3-pro-image';
  const t = await open('#/chat', { [target]: {
    ...catalog.models['gemini-3.1-flash-lite-image'], name: '模拟对比模型',
    image_capabilities: { fields: { image_size: { options: ['1K', '2K'], default: '1K' } } },
  } }), p = t.page;
  try {
    await p.evaluate(() => chat.setModel('gpt-image-2'));
    await send(t, '准备底图');
    await p.evaluate(async bytes => {
      await chat.upload([new File([Uint8Array.from(atob(bytes), character => character.charCodeAt(0))], 'ref.png', { type: 'image/png' })]);
      chat.setOption('size', '1536x1024');
    }, t.ref.toString('base64'));
    await send(t, '用同一张底图和参考图改造');
    const original = posts(t).at(-1).payload;
    assert.ok(original.init_image); assert.equal(original.additional_images.length, 1);
    await send(t, '后续楼层应当保留');
    await p.evaluate(() => {
      const { current } = chat.snapshot();
      chat.editHistoricalText(current.id, current.turns[0].id, '这段修改只给未来轮次使用');
      chat.setPrompt('不要覆盖这段草稿');
    });
    const state = () => p.evaluate(() => {
      const { headId, mainId, prompt, settings, turns, attachments, keepIds } = chat.snapshot().current;
      return { headId, mainId, prompt, settings, attachments, keepIds, turns: turns.map(turn => ({ id: turn.id, selectedVersion: turn.selectedVersion })) };
    });
    const before = await state(), count = posts(t).length;
    const source = p.locator('.chat-turn').nth(1);
    const picker = await openRerun(p, source);
    const models = picker.getByRole('combobox', { name: '重跑模型' }), submit = picker.getByRole('button', { name: '生成新版本' });
    assert.equal(await models.inputValue(), 'gpt-image-2');
    assert.equal(await picker.getByRole('radio', { name: '横向' }).isChecked(), true);
    await picker.getByRole('radio', { name: '高质量' }).check();
    await p.keyboard.press('Escape');
    await picker.waitFor({ state: 'hidden' });
    assert.equal(posts(t).length, count);
    await openRerun(p, source);
    assert.equal(await picker.getByRole('radio', { name: '高质量' }).isChecked(), false);
    await models.selectOption('gemini-3.1-flash-lite-image');
    assert.match(await picker.textContent(), /该模型最多支持 1 张/); assert.equal(await submit.isDisabled(), true);
    await models.selectOption(target);
    assert.match(await picker.textContent(), /输入图 2 张/);
    assert.equal(await picker.getByRole('radio', { name: '横向' }).count(), 0);
    assert.equal(await picker.getByRole('radio', { name: '1K' }).isChecked(), true);
    await picker.getByRole('radio', { name: '2K' }).check();
    assert.equal(posts(t).length, count);
    t.state.hold = true; t.state.multiple = true;
    const posted = p.waitForRequest(request => request.url().endsWith('/run') || request.url().endsWith('/generate'));
    await submit.click();
    await posted;
    await source.getByRole('button', { name: '第 2 个版本 · 生成中', exact: true }).waitFor();
    assert.equal(await source.getByRole('button', { name: '第 1 个版本 · 已完成', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await state(), before);
    t.state.hold = false; t.state.release?.();
    await p.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns[1].versions[1]?.status === 'done');
    const next = posts(t).at(-1).payload;
    assert.equal(posts(t).length, count + 1);
    assert.equal(next.model, target);
    assert.equal(next.prompt, original.prompt); assert.equal(next.init_image, original.init_image);
    assert.deepEqual(next.additional_images, original.additional_images);
    assert.deepEqual(next.image_options, { output_size: '2k' });
    assert.deepEqual(await state(), before);

    await resultAction(source, '对比版本').click();
    const compare = p.getByRole('dialog', { name: '对比版本' });
    assert.match(await compare.getByRole('combobox', { name: 'A 版本' }).locator('option:checked').textContent(), /^V1 · /);
    assert.match(await compare.getByRole('combobox', { name: 'B 版本' }).locator('option:checked').textContent(), /^V2 · /);
    assert.match(await compare.getByRole('figure', { name: 'A 图' }).textContent(), /横向/);
    assert.match(await compare.getByRole('figure', { name: 'B 图' }).textContent(), /2K/);
    await compare.getByRole('combobox', { name: 'B 图片' }).selectOption('1');
    assert.match(await compare.getByRole('figure', { name: 'B 图' }).textContent(), /384×512/);
    await p.setViewportSize({ width: 550, height: 780 });
    await compare.getByRole('button', { name: 'B · V2', exact: true }).click();
    assert.equal(await compare.getByRole('img', { name: 'B 结果图' }).isVisible(), true);
    assert.equal(await compare.getByRole('img', { name: 'A 结果图' }).isVisible(), false);
    await compare.getByRole('button', { name: '关闭对比' }).click();
    await p.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual(await state(), before);
    assert.equal(posts(t).length, count + 1);
    await openRerun(p, source);
    await picker.getByRole('radio', { name: '高质量' }).check();
    await submit.click();
    await p.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns[1].versions[2]?.status === 'done');
    const same = posts(t).at(-1).payload;
    assert.equal(posts(t).length, count + 2);
    assert.equal(same.model, original.model);
    assert.equal(same.prompt, original.prompt); assert.equal(same.init_image, original.init_image);
    assert.deepEqual(same.additional_images, original.additional_images);
    assert.deepEqual(same.image_options, { ...original.image_options, quality: 'high' });
    assert.deepEqual(await state(), before);
    await p.evaluate(() => chat.flush());
    await p.reload(); await p.waitForSelector('#chatPrompt'); await bind(p);
    const saved = await p.evaluate(() => chat.snapshot().current.turns[1].versions[1]);
    assert.equal(saved.settings.model, target); assert.equal(saved.compareTo, 0);
    assert.equal(saved.settings.options.image_size, '2K');
    const rerun = p.locator('.chat-turn').nth(1).getByRole('button', { name: '第 2 个版本 · 已完成', exact: true });
    assert.equal(await rerun.getAttribute('aria-description'), saved.settings.modelName);
    await rerun.click();
    assert.equal(await p.locator('.chat-turn').nth(1).locator('.msg-name').first().textContent(), saved.settings.modelName);
  } finally { await t.close(); }
});

test("H1 chat rail: compact history, exact version states, responsive tools and retained selection", async () => {
  const t = await open(), p = t.page;
  try {
    await send(t, "第一轮");
    await send(t, "第二轮");
    const first = p.locator(".chat-turn").first(), last = p.locator(".chat-turn").last();
    assert.deepEqual(await p.locator(".turn-number").allTextContents(), ["1", "2"]);
    assert.equal(await first.getAttribute("data-older"), "");
    assert.equal(await last.getAttribute("data-base"), "");
    const source = await p.evaluate(() => ({ mainId: chat.snapshot().current.mainId, headId: chat.snapshot().current.headId }));
    t.state.fail = true;
    await rerunVersion(p, first);
    await p.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns[0].versions.length === 2);
    assert.equal(await first.locator(".chat-version[data-status=error]").count(), 1);
    await first.getByRole("button", { name: "第 1 个版本 · 已完成", exact: true }).click();
    assert.deepEqual(await p.evaluate(() => ({ mainId: chat.snapshot().current.mainId, headId: chat.snapshot().current.headId })), source);
    t.state.fail = false;
    t.state.hold = true;
    await rerunVersion(p, first);
    await first.getByRole('button', { name: '第 3 个版本 · 生成中', exact: true }).click();
    await p.waitForSelector(".chat-turn[data-pending] .chat-pending .tile-wave");
    assert.equal(await first.getAttribute("data-older"), null, "an earlier turn being regenerated stays full-size");
    assert.equal(await first.locator(".chat-version[data-status=pending]").count(), 1);
    await first.getByRole("button", { name: "第 1 个版本 · 已完成", exact: true }).click();
    await p.evaluate(() => chat.cancel());
    t.state.release?.();
    t.state.hold = false;
    await p.waitForFunction(() => !chat.snapshot().busy);
    await first.getByRole("button", { name: "第 3 个版本 · 已取消", exact: true }).click();
    assert.equal(await first.locator(".turn-output").getAttribute("data-status"), "cancelled");
    await first.getByRole("button", { name: "第 2 个版本 · 失败", exact: true }).click();
    assert.equal(await first.locator(".turn-output").getAttribute("data-status"), "error");
    await first.getByRole("button", { name: "第 1 个版本 · 已完成", exact: true }).click();
    assert.equal(await first.locator(".chat-version").count(), 3);
    {
      const width = 1440;
      await p.setViewportSize({ width, height: 900 });
      await first.scrollIntoViewIfNeeded();
      await showResultTools(first);
      const tools = first.getByRole("toolbar", { name: "图片操作" });
      assert.deepEqual(await tools.locator("button, a").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))), ["在 EDIT 编辑这张图", "重新生成", "基于此图新开对话", "从此处分支", "收藏图片", "下载图片"]);
      await first.getByRole("button", { name: "设为底图", exact: true }).click();
      await p.waitForFunction(() => chat.snapshot().current.headId === chat.snapshot().current.turns[0].id);
      assert.equal(await first.locator(".chat-base-badge").count(), 1);
      assert.equal(await first.getByRole("button", { name: "设为底图", exact: true }).count(), 0);
      assert.ok(await tools.getByRole("link", { name: "下载图片", exact: true }).getAttribute("download"));
    }
    // The same version control retains selection when switching to mobile BETA and across KeepAlive.
    await p.setViewportSize({ width: 320, height: 900 });
    await p.getByRole("dialog", { name: "当前窗口较窄", exact: true }).getByRole("button", { name: "切换到 BETA", exact: true }).click();
    await first.getByRole("button", { name: "第 2 个版本 · 失败", exact: true }).click();
    assert.equal(await first.locator(".turn-output").getAttribute("data-status"), "error");
    await first.getByRole("button", { name: "第 1 个版本 · 已完成", exact: true }).click();
    const mobileRerun = await openRerun(p, first);
    await mobileRerun.getByRole('combobox', { name: '重跑模型' }).waitFor();
    await mobileRerun.getByRole('button', { name: '关闭重新生成' }).click();
    await mobileRerun.waitFor({ state: 'hidden' });
    await p.evaluate(() => location.hash = "#/tags");
    await p.waitForSelector("[data-workspace-root=tags]");
    await p.evaluate(() => location.hash = "#/chat");
    await p.waitForSelector("#chatPrompt");
    assert.equal(await first.locator(".chat-version[aria-pressed=true]").getAttribute("data-status"), "done");
    // One EDIT entry: the image opens on a CHAT board in its general mode, not pre-switched to upscale.
    await showResultTools(first);
    await resultAction(first, "在 EDIT 编辑这张图").click();
    await p.locator("#imageEditor[data-active=true]").waitFor();
    assert.deepEqual(await p.evaluate(() => ({ origin: editor.session.origin, own: editor.session.conversationId === chat.snapshot().current.id, upscale: editor.snapshot().upscaleOpen })), { origin: "chat", own: true, upscale: false });
  } finally { await t.close(); }
});

test("CHAT history edit, image sub-conversation and fork stay independent across reload", async () => {
  const t = await open(), p = t.page;
  try {
    await t.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    t.state.multiple = true;
    await send(t, "第一轮原文");
    await send(t, "第二轮原文");
    const first = p.locator(".chat-turn").first();
    const result = first.locator(".chat-result").nth(1);
    const beforeEdit = await p.evaluate(() => chat.snapshot().current);
    await p.locator("#chatPrompt").fill("未发送草稿");
    await first.getByRole("button", { name: "编辑上下文" }).click();
    await first.getByRole("textbox", { name: "历史上下文文字" }).fill("不保存的文字");
    await first.getByRole("button", { name: "取消" }).click();
    await first.getByRole("button", { name: "编辑上下文" }).click();
    assert.equal(await first.getByRole("textbox", { name: "历史上下文文字" }).inputValue(), "第一轮原文");
    await first.getByRole("textbox", { name: "历史上下文文字" }).fill("后续引用的描述");
    await first.getByRole("button", { name: "保存", exact: true }).click();
    await first.getByRole("button", { name: "复制描述" }).click();
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), "第一轮原文");
    assert.equal(await p.locator("#chatPrompt").inputValue(), "未发送草稿");
    const afterEdit = await p.evaluate(() => chat.snapshot().current);
    assert.equal(afterEdit.headId, beforeEdit.headId);
    assert.equal(afterEdit.mainId, beforeEdit.mainId);
    assert.deepEqual(afterEdit.turns.map(turn => turn.snapshot), beforeEdit.turns.map(turn => turn.snapshot));
    await send(t, "第三轮请求");
    assert.match(posts(t).at(-1).payload.prompt, /后续引用的描述/);
    assert.doesNotMatch(posts(t).at(-1).payload.prompt, /第一轮原文/);
    await rerunVersion(p, first);
    await p.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns[0].versions.length === 2);
    await first.getByRole("button", { name: "第 1 个版本 · 已完成", exact: true }).click();
    const original = await p.evaluate(() => chat.snapshot().current);
    const anchor = original.turns[0], version = anchor.versions[0], assetId = version.blocks.filter(block => block.type === "image")[1].assetId;
    const postsBefore = posts(t).length;
    await result.hover();
    await resultAction(result, "基于此图新开对话").click();
    await p.getByRole("button", { name: "查看来源图" }).waitFor();
    const imageChild = await p.evaluate(() => chat.snapshot().current);
    assert.deepEqual(imageChild.source, { kind: "image", conversationId: original.id, turnId: anchor.id, versionId: version.id, assetId });
    assert.deepEqual(imageChild.turns, []);
    assert.equal(imageChild.mainId, null);
    assert.deepEqual(await p.evaluate(() => chat.snapshot().context.imageIds), []);
    await p.evaluate(() => chat.flush());
    await p.reload();
    await p.getByRole("button", { name: "返回来源对话" }).click();
    await bind(p);
    await result.hover();
    await resultAction(result, "从此处分支").click();
    const fork = await p.evaluate(() => chat.snapshot().current);
    assert.deepEqual(fork.source, { ...imageChild.source, kind: "fork" });
    assert.deepEqual(fork.turns.map(turn => turn.prompt), ["第一轮原文"]);
    assert.equal(fork.turns[0].contextText, "后续引用的描述");
    assert.deepEqual(fork.turns[0].versions.map(item => item.blocks), [version.blocks]);
    assert.equal(fork.mainId, assetId);
    const originalRow = p.locator(`.conversation-item[data-id="${original.id}"]`);
    const childRow = p.locator(`.conversation-item[data-id="${imageChild.id}"]`);
    const forkRow = p.locator(`.conversation-item[data-id="${fork.id}"]`);
    const categories = p.getByRole("navigation", { name: "会话列表" }).getByRole("heading", { level: 3 });
    assert.deepEqual(await categories.allTextContents(), ["分支", "子区"]);
    assert.equal(await childRow.getByRole("button", { name: /，子区$/ }).count(), 1);
    assert.equal(await forkRow.getByRole("button", { name: /，分支$/ }).count(), 1);
    await originalRow.getByRole("button", { name: /^折叠关联会话/ }).click();
    assert.equal(await forkRow.count(), 0);
    assert.equal(await childRow.count(), 0);
    assert.equal(await categories.count(), 0);
    await p.getByRole("button", { name: "搜索对话" }).click();
    const search = p.getByRole("searchbox", { name: "搜索对话" });
    await search.fill("图片子对话");
    assert.deepEqual(await categories.allTextContents(), ["子区"]);
    assert.equal(await originalRow.count(), 1);
    assert.equal(await childRow.count(), 1);
    assert.equal(await forkRow.count(), 0);
    await search.press("Escape");
    await originalRow.getByRole("button", { name: /^展开关联会话/ }).click();
    await forkRow.waitFor();
    await childRow.waitFor();
    await p.evaluate(() => chat.flush());
    await p.reload();
    await forkRow.waitFor();
    assert.deepEqual(await categories.allTextContents(), ["分支", "子区"]);
    await bind(p);
    assert.equal(await p.evaluate(() => chat.snapshot().current.id), fork.id);
    await originalRow.getByRole("button", { name: original.title, exact: true }).click();
    const returned = await p.evaluate(() => chat.snapshot().current);
    assert.deepEqual(returned, original);
    assert.equal(posts(t).length, postsBefore);
  } finally { await t.close(); }
});

test("M5 shared task slot, failure/cancellation, IME and attachments keep original request semantics", async () => {
  const t = await open(),
    p = t.page;
  try {
    await p.locator("#chatPrompt").fill("输入法");
    await p
      .locator("#chatPrompt")
      .dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal(posts(t).length, 0);
    t.state.hold = true;
    await p.getByRole("button", { name: "发送绘图请求", exact: true }).click();
    await p.waitForFunction(() => chat.snapshot().busy?.versionId);
    await p.evaluate(() => (location.hash = "#/image"));
    await p.waitForSelector("#prompt");
    await p.evaluate(async () => {
      window.slotResult = await services.runTask(
        { id: "probe", workspace: "editor", snapshot: {} },
        async () => true,
      );
    });
    assert.equal(await p.evaluate(() => slotResult.status), "busy");
    await p.evaluate(() => (location.hash = "#/chat"));
    await p.waitForSelector("#chatPrompt");
    await p.evaluate(() => chat.cancel());
    t.state.release();
    t.state.hold = false;
    await p.waitForFunction(() => !chat.snapshot().busy);
    assert.equal(
      await p.locator(".turn-output").getAttribute("data-status"),
      "cancelled",
    );
    t.state.fail = true;
    await p
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: t.ref });
    await p.waitForSelector(".attachment");
    await p.locator("#chatPrompt").fill("failed");
    await p.getByRole("button", { name: "发送绘图请求", exact: true }).click();
    await p.waitForFunction(
      () =>
        !chat.snapshot().busy &&
        chat.snapshot().current.turns.at(-1)?.versions[0].status === "error",
    );
    assert.equal(await p.locator(".attachment").count(), 0);
    assert.equal(posts(t).length, 2);
    assert.equal(
      (await p.evaluate(() => navigator.locks.query())).held.filter((l) =>
        l.name.includes("generation"),
      ).length,
      0,
    );
  } finally {
    await t.close();
  }
});
test("M5 conversation management, atomic save retries, backup reload and interrupted turns", async () => {
  const t = await open(),
    p = t.page;
  try {
    await send(t);
    await p.evaluate(async () => {
      chat.setPrompt("unsaved draft");
      await chat.flush();
      window.backup = await services.backup.read(
        (await services.backup.export()).blob,
      );
      chat.duplicate(chat.snapshot().conversations[0]);
      await chat.flush();
    });
    await p.waitForFunction(() => chat.snapshot().conversations.length === 2);
    assert.equal(await p.locator("#chatPrompt").inputValue(), "");
    await p.evaluate(() =>
      chat.rename(chat.snapshot().conversations[0], "  renamed  name  "),
    );
    await p.evaluate(() => chat.pin(chat.snapshot().conversations[0]));
    assert.equal(
      await p.locator(".conversation-group").first().textContent(),
      "置顶",
    );
    await p.evaluate(async () => {
      const real = services.data.write;
      services.data.write = async () => {
        throw new DOMException("full", "QuotaExceededError");
      };
      chat.setPrompt("retry draft");
      try {
        await chat.flush();
      } catch {}
      services.data.write = real;
      await chat.flush();
    });
    await p.evaluate(() => services.backup.import(backup));
    await p.waitForFunction(() => chat.snapshot().ready);
    assert.equal(await p.evaluate(() => services.data.phase), "ready");
    assert.ok(await p.locator(".chat-result img").count());
    t.state.hold = true;
    await p.locator("#chatPrompt").fill("interrupted");
    await p.getByRole("button", { name: "发送绘图请求", exact: true }).click();
    await p.waitForFunction(() => chat.snapshot().busy?.versionId);
    await p.evaluate(() => chat.flush());
    p.on("dialog", (d) => d.accept());
    await p.reload();
    t.state.release();
    t.state.hold = false;
    await p.waitForSelector(".turn-output[data-status=cancelled]");
    assert.match(
      await p.locator(".turn-error").last().textContent(),
      /页面关闭时仍在生成/,
    );
  } finally {
    await t.close();
  }
});
test("chat sidebar and starters: unsent conversation is the new row, starters only fill the composer, rows show the cover, search covers later prompts", async () => {
  const t = await open(),
    p = t.page,
    fresh = p.getByRole("button", { name: "新对话", exact: true });
  try {
    assert.equal(await fresh.getAttribute("aria-current"), "page");
    assert.equal(await p.locator(".conversation-item").count(), 0);
    await p.getByRole("button", { name: "窗边打盹的橘猫" }).click();
    assert.match(await p.locator("#chatPrompt").inputValue(), /橘猫/);
    assert.equal(
      await p.locator(".chat-starters").getAttribute("data-quiet"),
      "true",
    );
    assert.equal(posts(t).length, 0);
    t.state.multiple = true;
    await send(t, "蓝色森林");
    await send(t, "加一只猫");
    assert.equal(await p.locator(".chat-starters").count(), 0);
    assert.equal(await fresh.getAttribute("aria-current"), null);
    await fresh.click();
    assert.equal(await fresh.getAttribute("aria-current"), "page");
    await send(t, "雨夜街头");
    assert.equal(await p.locator(".conversation-group").textContent(), "今天");
    const forest = p.locator(".conversation-item", { hasText: "蓝色森林" });
    await p.waitForFunction(() => [...document.querySelectorAll('.conversation-item')].find(el => el.textContent.includes('蓝色森林'))?.querySelector('img')?.naturalWidth > 0);
    assert.equal(
      await forest.locator(".conversation-thumb img").getAttribute("src"),
      await p.evaluate(
        async () => {
          const id = chat.snapshot().conversations.find(c => c.title === '蓝色森林').turns[1].versions[0].blocks.find(b => b.type === 'image').assetId;
          const lease = chat.assets.preview(id), url = await lease.url;
          lease.release(); return url;
        },
      ),
    );
    await p.getByRole("button", { name: "搜索对话" }).click();
    await p.keyboard.type("猫");
    assert.deepEqual(
      await p.locator(".conversation-title").allTextContents(),
      ["蓝色森林"],
    );
    await p.keyboard.type("狗");
    assert.equal(await p.locator(".conversation-item").count(), 0);
    await p.keyboard.press("Escape");
    assert.equal(await p.locator(".conversation-item").count(), 2);
    assert.equal(
      await p.evaluate(() => document.activeElement?.textContent?.trim()),
      "搜索对话",
    );
  } finally {
    await t.close();
  }
});
test("M5 drawing handoff is one-use, retained chat receives it, oversized image fitting and expiry", async () => {
  const t = await open(),
    p = t.page;
  try {
    await p.locator("#chatPrompt").fill("keep previous");
    await p.evaluate(() => (location.hash = "#/image"));
    await p.waitForSelector("#prompt");
    await p.evaluate(async (png) => {
      const blob = new Blob(
        [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
        { type: "image/png" },
      );
      await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home},
        blob,
        { width: 512, height: 512 },
        { model: "nai-diffusion-5-full" },
        null,
      );
    }, t.png.toString("base64"));
    await p.locator("#chatBtn").click();
    // The loading placeholder also has .attachment; wait for the completed claim.
    await p.waitForSelector(".attachment:not(.attachment-loading)");
    await p.waitForFunction(
      () => !new URL(location.href).searchParams.has("image"),
    );
    assert.equal(await p.locator("#chatPrompt").inputValue(), "");
    assert.equal(
      await p.evaluate(() => chat.snapshot().conversations.length),
      2,
    );
    assert.equal(new URL(p.url()).searchParams.has("image"), false);
    const info = await p.evaluate(async () => {
      const { createHandoff, fitReference } = await import(
        "/src/services/handoff.ts"
      );
      const h = createHandoff(services),
        asset = chat.assets.assets.values().next().value;
      const ticket = await h.queue(asset.blob, "x.png"),
        first = await h.take(ticket),
        second = await h.take(ticket);
      const fitted = await fitReference(
        new Blob(
          [await asset.blob.arrayBuffer(), new Uint8Array(8 * 1024 * 1024)],
          { type: "image/png" },
        ),
        "big.png",
      );
      const tx = services.databases.transaction(
        "koma-handoff",
        "items",
        "readwrite",
      );
      tx.objectStore("items").put(
        { blob: asset.blob, name: "expired", at: Date.now() - 31 * 60 * 1000 },
        "expired",
      );
      await new Promise((r) => (tx.oncomplete = r));
      return {
        first: !!first,
        second,
        expired: await h.take("expired"),
        fit: fitted.blob.size,
        type: fitted.blob.type,
      };
    });
    assert.equal(info.first, true);
    assert.equal(info.second, null);
    assert.equal(info.expired, null);
    assert.ok(info.fit <= 8 * 1024 * 1024);
    assert.equal(info.type, "image/jpeg");
  } finally {
    await t.close();
  }
});
test("[core] M6 editor modes, quote protection, source-pixel mask, undo/redo, persistent sessions, and EDIT-owned results", async () => {
  const t = await open("#/image"),
    p = t.page;
  try {
    await editorSource(t);
    await p.locator("#editor-parametersToggle").click();
    await p.locator("#editorSeed").fill("0");
    await p.locator("#editorPrompt").fill("edit exact");
    await p.locator("#editorStrength").fill("0.35");
    await p.waitForFunction(() => editor.snapshot().edit.quote !== null);
    t.state.cost = 2;
    await p.locator("#editorRun").click();
    await p.waitForFunction(
      () =>
        !editor.snapshot().busy &&
        editor.snapshot().session.versions.length === 2,
    );
    let payload = posts(t)[0].payload;
    assert.equal(payload.tool, "img2img");
    assert.equal(payload.max_cost, 2);
    assert.equal(payload.seed, 0);
    assert.equal(payload.strength, 0.35);
    assert.equal(await p.evaluate(() => drawing.snapshot().history.length), 0);
    assert.equal(await p.evaluate(() => editor.snapshot().base.id), 1);
    const firstOrigin = await p.evaluate(() => ({ params: editor.snapshot().viewed.params, boardId: drawing.snapshot().activeBoardId, parent: editor.session.versions[0].sourceId }));
    assert.equal(firstOrigin.params.boardId, firstOrigin.boardId);
    assert.equal(firstOrigin.params.editParent, firstOrigin.parent);
    assert.ok(firstOrigin.params.editId);
    await p.getByRole("button", { name: "重绘", exact: true }).click();
    await p.waitForSelector("#editorMask:not([hidden])");
    assert.equal(await p.locator("#editorStrength").inputValue(), "1");
    const box = await p.locator("#editorMask").boundingBox();
    await p.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, {
      steps: 20,
    });
    await p.mouse.up();
    await p.waitForFunction(() => editor.snapshot().edit.quote !== null);
    await p.getByRole("button", { name: "撤销", exact: true }).click();
    await p.waitForFunction(() => editor.snapshot().edit.price === "先涂抹");
    assert.equal(await p.locator("#editorRun").isDisabled(), true);
    await p.getByRole("button", { name: "重做", exact: true }).click();
    await p.waitForFunction(() => editor.snapshot().edit.quote !== null);
    await p.locator("#editorRun").click();
    await p.waitForFunction(
      () =>
        !editor.snapshot().busy &&
        editor.snapshot().session.versions.length === 3,
    );
    payload = posts(t)[1].payload;
    assert.equal(payload.tool, "inpaint");
    assert.ok(payload.mask_image.startsWith("data:image/png;base64,"));
    assert.equal(payload.strength, 1);
    assert.equal(await p.evaluate(() => editor.snapshot().viewed.params.editParent), `edit:${firstOrigin.params.editId}`);
    const mask = await p.evaluate(async (data) => {
      const b = await (await fetch(data)).blob(),
        image = await createImageBitmap(b),
        c = new OffscreenCanvas(image.width, image.height),
        x = c.getContext("2d");
      x.drawImage(image, 0, 0);
      const black = x.getImageData(0, 0, 1, 1).data,
        white = x.getImageData(154, 154, 1, 1).data;
      return {
        w: image.width,
        h: image.height,
        black: [...black],
        white: [...white],
      };
    }, payload.mask_image);
    assert.equal(mask.w, 512);
    assert.equal(mask.h, 512);
    assert.deepEqual(mask.black, [0, 0, 0, 255]);
    assert.deepEqual(mask.white, [255, 255, 255, 255]);
    await closeEditor(p);
    await p.evaluate(() => editor.open("image"));
    await p.waitForSelector("#imageEditor[data-active=true]");
    assert.equal(await p.locator(".editor-rail .tile").count(), 3);
    assert.equal(await p.locator("#editorPrompt").inputValue(), "edit exact");
  } finally {
    await t.close();
  }
});
test("M6 upscale uses viewed original and independent detail, chat return ownership and workspace navigation", async () => {
  const t = await open(),
    p = t.page;
  try {
    await editorSource(t, "chat", "upscale");
    await p.waitForSelector("#editorUpscalePop:popover-open");
    await p.locator('#editorUpscaleToggle').click();
    await p.getByRole('menuitemradio', { name: '外部放大', exact: true }).click();
    assert.match(await p.locator('#editorUpscalePop .editor-mini-value').textContent(), /Dedicated Upscale/);
    await p
      .getByRole("textbox", { name: "细节描述", exact: true })
      .fill("preserve linework");
    await p.waitForFunction(() => editor.snapshot().upscale.quote !== null);
    t.state.hold = true;
    await p.locator("#editorUpscaleRun").click();
    await p.waitForFunction(() => editor.snapshot().busy);
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#imageEditor").getAttribute("data-active"), "true");
    t.state.release?.();
    t.state.hold = false;
    await p.waitForFunction(
      () =>
        !editor.snapshot().busy &&
        editor.snapshot().session.versions.length === 2,
    );
    const payload = posts(t)[0].payload;
    assert.equal(payload.prompt, "preserve linework");
    assert.equal(payload.tool, "image-edit");
    assert.equal(payload.model, "fal-upscale");
    assert.equal(payload.mask_image, undefined);
    assert.equal(await p.evaluate(() => drawing.snapshot().history.length), 0);
    const origin = await p.evaluate(() => ({ result: editor.session.versions[1].params, parent: editor.session.versions[0].sourceId, conversationId: chat.snapshot().current.id }));
    assert.equal(origin.result.editParent, origin.parent);
    assert.equal(origin.result.chatConversationId, origin.conversationId);
    assert.equal(origin.result.boardId, undefined);
    assert.ok(origin.result.editId);
    assert.equal(await p.locator("#imageEditor").getByRole("button", { name: "添加为参考图", exact: true }).count(), 0);
    await p.locator("#editorSend").click();
    await p.getByRole("menuitem", { name: /^CHAT 改图 · 来源对话 / }).click();
    await p.waitForSelector("#imageEditor", { state: "hidden" });
    assert.equal(
      await p.evaluate(() => chat.snapshot().context.imageIds.length),
      1,
    );
    await editorSource(t, "image");
    assert.equal(await p.locator(".editor-rail .tile").count(), 1);
    assert.equal(await p.locator("#editorPrompt").inputValue(), "");
    await closeEditor(p);
    await p.evaluate(() => { const board = editor.boards().find(s => s.origin === "chat"); editor.switchBoard(board.id); app_shell.router.switchWorkspace("edit"); });
    await p.waitForSelector("#imageEditor[data-active=true]");
    assert.equal(await p.locator(".editor-rail .tile").count(), 2);
  } finally {
    await t.close();
  }
});
test("M6 toolbar separates native/external upscale without generating on selection", async () => {
  const t = await open(), p = t.page;
  try {
    await editorSource(t);
    {
      const width = 1440;
      await p.setViewportSize({ width, height: 900 });
      await p.waitForTimeout(100);
      await p.locator('#editorInpaintToggle').scrollIntoViewIfNeeded();
      await p.locator('#editorUpscaleToggle').click();
      const menu = p.locator('#editorUpscaleMenu');
      await menu.waitFor({ state: 'visible' });
      assert.deepEqual(await menu.locator('.menu-label').allTextContents(), ['原生放大', '外部放大']);
      assert.equal(await menu.locator('button:disabled').count(), 0);

      assert.equal(await menu.evaluate(el=>el.matches(':popover-open')), true);
      await p.keyboard.press('Escape');
    }
    assert.equal(posts(t).length, 0);
    await p.locator('#editorUpscaleToggle').click();
    await p.getByRole('menuitemradio', { name: '外部放大', exact: true }).click();
    await p.waitForSelector('#editorUpscalePop:popover-open');
    assert.equal(await p.locator('#editorUpscalePop').getAttribute('aria-label'), '外部放大');
    assert.equal(await p.locator('#editorUpscalePop .editor-pop-item').count(), 0);
    assert.equal(await p.locator('#editorUpscalePop .editor-mini-value').count(), 1);
    assert.match(await p.locator('#editorUpscalePop').textContent(), /Dedicated Upscale/);
    assert.equal(await p.evaluate(() => editor.snapshot().upscaleModel.id), 'fal-upscale');
    await p.getByRole('textbox', { name: '细节描述', exact: true }).fill('keep linework');
    await p.locator('#editorUpscaleToggle').click();
    await p.getByRole('menuitemradio', { name: '原生放大', exact: true }).click();
    await p.waitForSelector('#editorUpscalePop:popover-open');
    assert.equal(await p.locator('#editorUpscalePop').getAttribute('aria-label'), '原生放大');
    assert.equal(await p.evaluate(() => editor.snapshot().upscaleModel.provider), 'novelai');
    assert.equal(await p.getByRole('textbox', { name: '细节描述', exact: true }).count(), 0);
    assert.equal(posts(t).length, 0);
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'editorUpscale');
    // Main action reopens the selected type; no hidden cross-type model appears in its settings.
    await p.locator('#editorUpscale').click();await p.waitForSelector('#editorUpscalePop:popover-open');
    assert.equal(await p.locator('#editorUpscalePop').getAttribute('aria-label'), '原生放大');
    await p.locator('#editorUpscale').click();await p.locator('#editorUpscalePop').waitFor({state:'hidden'});
    await p.locator('#editorUpscale').click();await p.waitForSelector('#editorUpscalePop:popover-open');
    await p.locator('#editorUpscaleToggle').click();
    await p.getByRole('menuitemradio', { name: '外部放大', exact: true }).click();
    assert.equal(await p.getByRole('textbox', { name: '细节描述', exact: true }).inputValue(), 'keep linework');
    await p.waitForFunction(() => editor.snapshot().upscale.canRun);
    await p.locator('#editorUpscaleRun').click();
    await p.waitForFunction(() => !editor.snapshot().busy && editor.session.versions.length === 2);
    assert.equal(posts(t).length, 1);assert.equal(posts(t)[0].payload.model, 'fal-upscale');
    assert.equal(posts(t)[0].payload.tool, 'image-edit');
    assert.equal(posts(t)[0].payload.prompt, 'keep linework');
  } finally { await t.close(); }
});

test('CHAT long histories load visible previews and retain originals for inspection, download and shared asset leases', async () => {
  const t = await open(), p = t.page;
  try {
    await p.evaluate(async () => {
      const { beginTurn, contextSnapshot, completeVersion } = await import('/src/domain/conversation.ts');
      const images = [];
      for (let i = 0; i < 12; i++) {
        const canvas = new OffscreenCanvas(2048, 1024), ctx = canvas.getContext('2d');
        ctx.fillStyle = `hsla(${i * 28},50%,50%,.5)`; ctx.fillRect(0, 0, 2048, 1024);
        images.push(await chat.assets.add(await canvas.convertToBlob({ type: 'image/png' }), `sample-${i}.png`, { width: 2048, height: 1024 }));
      }
      chat.mutate(c => { for (const image of images) {
        const { turn, version } = beginTurn(c, contextSnapshot(c), image.name, c.settings);
        completeVersion(c, turn, version, [{ type: 'image', assetId: image.id }], null, c.selectionRevision);
      } });
    });
    await p.locator('.chat-print').last().waitFor();
    await p.locator('#chatScroll').evaluate(el => { el.scrollTop = 0; });
    const first = p.locator('.chat-print img').first(), last = p.locator('.chat-print img').last();
    await p.waitForFunction(() => document.querySelector('.chat-print img').naturalWidth === 1280);
    const url = await first.getAttribute('src');
    assert.equal(await last.getAttribute('src'), null, 'far-away result images do not keep a display URL');
    assert.deepEqual(await first.evaluate(async image => {
      const bitmap = await createImageBitmap(await (await fetch(image.src)).blob()), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return [image.naturalWidth, image.naturalHeight, ctx.getImageData(10, 10, 1, 1).data[3]];
    }), [1280, 640, 128]);
    const original = await p.evaluate(() => {
      const c = chat.snapshot().current, id = c.turns[0].versions[0].blocks.find(b => b.type === 'image').assetId;
      return chat.assets.get(id).url;
    });
    assert.notEqual(url, original);
    assert.equal(await p.locator('.chat-result-tools').first().getByRole('link', { name: '下载图片' }).getAttribute('href'), original);
    await first.click();
    const full = p.locator('.chat-lightbox img');
    await full.waitFor();
    assert.equal(await full.getAttribute('src'), original);
    await p.waitForFunction(() => document.querySelector('.chat-lightbox img').naturalWidth === 2048);
    await p.getByRole('button', { name: '关闭图片', exact: true }).click();
    await p.locator('#chatScroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await p.waitForFunction(() => !document.querySelector('.chat-print img').hasAttribute('src') && [...document.querySelectorAll('.chat-print img')].at(-1).naturalWidth === 1280);
    assert.equal(await p.evaluate(url => liveImageUrls.has(url), url), false, 'leaving the viewport releases the display URL');
    assert.equal(await p.evaluate(url => liveImageUrls.has(url), original), true, 'originals retain their conversation ownership');
    const leases = await p.evaluate(async () => {
      const { AssetStore, dataUrl } = await import('/src/services/assets.ts');
      const store = new AssetStore(), source = [...chat.assets.assets.values()][0];
      const a = await store.add(source.blob, 'shared.png', { width: source.width, height: source.height });
      const one = store.preview(a.id), two = store.preview(a.id), [u1, u2] = await Promise.all([one.url, two.url]);
      one.release(); const kept = liveImageUrls.has(u1);
      two.release(); const released = !liveImageUrls.has(u1);
      const encoded = (await store.encode([a.id]))[0] === await dataUrl(source.blob);
      const record = store.record(a.id), cleanRecord = record.blob === source.blob && !('url' in record) && !('preview' in record);
      const cancelled = store.preview(a.id, 1280); cancelled.release();
      const noLateUrl = await cancelled.url === undefined;
      const reload = store.preview(a.id, 1280); store.clear(); store.adopt(record);
      const noResurrection = await reload.url === undefined; reload.release();
      const next = store.preview(a.id), current = await next.url;
      store.collect([]); next.release();
      return { shared: u1 === u2, kept, released, encoded, cleanRecord, noLateUrl, noResurrection, collected: !liveImageUrls.has(current) && !liveImageUrls.has(a.url) };
    });
    assert.deepEqual(leases, { shared: true, kept: true, released: true, encoded: true, cleanRecord: true, noLateUrl: true, noResurrection: true, collected: true });
    assert.equal(posts(t).length, 0);
  } finally { await t.close(); }
});

test("M5 embedded multi-image order, asset limits, exact bytes and immediate page-leave draft flush", async () => {
  const t = await open(),
    p = t.page;
  try {
    t.state.multiple = true;
    await send(t);
    assert.deepEqual(
      await p.evaluate(() =>
        chat.snapshot().current.turns[0].versions[0].blocks.map((b) => b.type),
      ),
      ["text", "image", "text", "image"],
    );
    assert.equal(await p.locator(".chat-result").count(), 2);
    assert.deepEqual(await p.locator(".msg-body > .msg-text, .msg-body > .chat-result").evaluateAll(nodes => nodes.map(n => n.classList.contains("chat-result") ? "image" : "text")), ["text", "image", "text", "image"]);
    const limits = await p.evaluate(async () => {
      const { AssetStore } = await import("/src/services/assets.ts"),
        assets = new AssetStore();
      const rejected = async (f) => {
        try {
          await f();
          return "";
        } catch (e) {
          return e.message;
        }
      };
      const single = await rejected(() =>
        assets.add(
          new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], {
            type: "image/png",
          }),
        ),
      );
      const result = await rejected(() =>
        assets.add(
          new Blob([new Uint8Array(32 * 1024 * 1024 + 1)], {
            type: "image/png",
          }),
          "result",
          { width: 512, height: 512 },
        ),
      );
      const blob = new Blob([new Uint8Array(7 * 1024 * 1024)], {
        type: "image/png",
      });
      for (let i = 0; i < 5; i++)
        assets.adopt({
          id: `synthetic-${i}`,
          name: "synthetic",
          origin: "upload",
          width: 512,
          height: 512,
          blob,
        });
      const total = await rejected(() =>
        assets.encode([...assets.assets.keys()]),
      );
      const urls = [...assets.assets.values()].map((a) => a.url);
      assets.dispose();
      return {
        single,
        result,
        total,
        released: urls.every((u) => !liveImageUrls.has(u)),
      };
    });
    assert.match(limits.single, /8MB/);
    assert.match(limits.result, /32MB/);
    assert.match(limits.total, /32MB/);
    assert.equal(limits.released, true);
    // Fire the actual page lifecycle before the 400ms debounce can run.
    await p.evaluate(() => {
      chat.setPrompt("离开前最后一次输入");
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: false }),
      );
    });
    await p.waitForFunction(() => services.data.phase === "disposed");
    await p.reload();
    await p.waitForSelector(".chat-turn");
    await bind(p);
    assert.equal(
      await p.locator("#chatPrompt").inputValue(),
      "离开前最后一次输入",
    );
    const saved = await p.evaluate(async () => {
      const v = chat.snapshot().current.turns[0].versions[0];
      const b = chat.assets.get(
        v.blocks.find((b) => b.type === "image").assetId,
      ).blob;
      return {
        via: v.via,
        bytes: Array.from(new Uint8Array(await b.arrayBuffer())),
      };
    });
    assert.equal(saved.via.connection, "test");
    assert.deepEqual(Buffer.from(saved.bytes), t.png);
  } finally {
    await t.close();
  }
});

test("M6 EXIF orientation aligns source and mask; session switching and default retention preserve the base", async () => {
  const t = await open("#/image"),
    p = t.page;
  try {
    await p.evaluate(async () => {
      const canvas = new OffscreenCanvas(384, 256),
        ctx = canvas.getContext("2d");
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 192, 256);
      ctx.fillStyle = "blue";
      ctx.fillRect(192, 0, 192, 256);
      const jpeg = new Uint8Array(
        await (
          await canvas.convertToBlob({ type: "image/jpeg", quality: 1 })
        ).arrayBuffer(),
      );
      const exif = new Uint8Array([
        255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1,
        0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
      ]);
      await editor.open(
        "image",
        new Blob([jpeg.slice(0, 2), exif, jpeg.slice(2)], {
          type: "image/jpeg",
        }),
        "oriented.jpg",
        { mode: "inpaint" },
      );
    });
    await p.waitForSelector("#editorMask:not([hidden])");
    assert.deepEqual(
      await p.evaluate(() => [
        editor.snapshot().base.width,
        editor.snapshot().base.height,
        document.querySelector("#editorMask").width,
        document.querySelector("#editorMask").height,
      ]),
      [256, 384, 256, 384],
    );
    const box = await p.locator("#editorMask").boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
    await p.waitForFunction(() => editor.snapshot().edit.quote !== null);
    await closeEditor(p);
    await editorSource(t, "chat");
    await closeEditor(p);
    await p.evaluate(() => { const board = editor.boards().find(s => s.origin === "image"); editor.switchBoard(board.id); app_shell.router.switchWorkspace("edit"); });
    await p.waitForFunction(() => editor.snapshot().edit.quote !== null);
    await p.locator("#editorRun").click();
    await p.waitForFunction(
      () =>
        !editor.snapshot().busy &&
        editor.snapshot().session.versions.length === 2,
    );
    const payload = posts(t)[0].payload;
    const pixels = await p.evaluate(
      async ({ image, mask }) => {
        const inspect = async (url) => {
          const bitmap = await createImageBitmap(
            await (await fetch(url)).blob(),
          );
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
            x = canvas.getContext("2d");
          x.drawImage(bitmap, 0, 0);
          bitmap.close();
          return {
            w: canvas.width,
            h: canvas.height,
            top: [...x.getImageData(128, 96, 1, 1).data],
            bottom: [...x.getImageData(128, 288, 1, 1).data],
          };
        };
        return { image: await inspect(image), mask: await inspect(mask) };
      },
      { image: payload.init_image, mask: payload.mask_image },
    );
    assert.equal(pixels.image.w, 256);
    assert.equal(pixels.image.h, 384);
    assert.ok(pixels.image.top[0] > 240 && pixels.image.top[2] < 15);
    assert.ok(pixels.image.bottom[2] > 240 && pixels.image.bottom[0] < 15);
    assert.deepEqual(pixels.mask.top, [255, 255, 255, 255]);
    assert.deepEqual(pixels.mask.bottom, [0, 0, 0, 255]);
    const capped = await p.evaluate(async () => {
      const base = editor.snapshot().base,
        old = editor.snapshot().viewed;
      editor.setMode("img2img");
      editor.setBase(base.id);
      for (let i = 0; i < 37; i++) {
        // Synthetic derivatives exercise per-board eviction; imports create boards.
        const token = editor.beginExternalEdit();
        const c = new OffscreenCanvas(base.width, base.height), x = c.getContext("2d");
        x.fillStyle = "rgb(" + i + ",80,160)"; x.fillRect(0,0,c.width,c.height);
        await editor.applyExternalEdit(token.id, {mode:"image", image:await c.convertToBlob({type:"image/png"})});
        editor.setBase(base.id);
      }
      const s = editor.snapshot();
      return {
        count: s.session.versions.length,
        base: s.base.id,
        retained: s.session.versions.some((v) => v.id === base.id),
        revoked: !liveImageUrls.has(old.url),
      };
    });
    assert.deepEqual(capped, {
      count: 35,
      base: 1,
      retained: true,
      revoked: true,
    });
  } finally {
    await t.close();
  }
});

// Import the native drivers without mounting the app, so failure injection cannot
// interfere with unrelated Vue canvases or paid-request mocks.
async function nativePage() {
  const context = await browser.newContext({ reducedMotion: "no-preference" });
  await context.route(`${origin}/__native-drivers`, (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><style>#frame{width:240px;height:180px}.tile-wave{width:100%;height:100%}</style><div id="frame"></div><canvas id="mask"></canvas>',
  }));
  const page = await context.newPage();
  await page.goto(`${origin}/__native-drivers`);
  return { context, page };
}

test("T4 mask snapshots preserve clear records, undo/redo, encoding cache and Canvas failure boundaries", async () => {
  const { context, page } = await nativePage();
  try {
    const result = await page.evaluate(async () => {
      const { createMaskEditor } = await import("/src/native/mask-editor.ts");
      const canvas = document.querySelector("#mask");
      const mask = createMaskEditor(canvas, () => {});
      const state = {
        width: 64, height: 48, position: 2,
        strokes: [
          { points: [{ x: 24, y: 24 }, { x: 40, y: 24 }], diameter: 16, erase: false, pointer: 1 },
          { clear: true },
        ],
      };
      const originalEncode = HTMLCanvasElement.prototype.toDataURL;
      const originalContext = HTMLCanvasElement.prototype.getContext;
      let encodes = 0;
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        encodes++;
        return originalEncode.apply(this, args);
      };
      const failure = (fn) => { try { fn(); return null; } catch (error) { return error.message; } };
      try {
        mask.restore(state);
        const cleared = mask.getMask();
        mask.undo();
        const encoded = mask.getMask(), cached = mask.getMask();
        const cachedEncodes = encodes;
        const bitmap = await createImageBitmap(await (await fetch(encoded)).blob());
        const sample = document.createElement("canvas");
        sample.width = bitmap.width; sample.height = bitmap.height;
        const g = sample.getContext("2d");
        g.drawImage(bitmap, 0, 0);
        const pixels = [Array.from(g.getImageData(32, 24, 1, 1).data), Array.from(g.getImageData(0, 0, 1, 1).data)];
        const size = [bitmap.width, bitmap.height];
        bitmap.close();
        mask.redo();
        const redone = mask.getMask();
        mask.undo();
        const undone = mask.getMask();
        const afterUndoEncodes = encodes;
        const snapshot = mask.snapshot();
        snapshot.strokes[0].points[0].x = 999;
        const isolated = mask.snapshot().strokes[0].points[0].x;
        mask.resize(32, 32);
        const resized = { value: mask.getMask(), undo: mask.canUndo(), redo: mask.canRedo() };
        mask.restore({ ...state, position: 1 });
        HTMLCanvasElement.prototype.getContext = () => null;
        const outputFailure = failure(() => mask.getMask());
        const initFailure = failure(() => createMaskEditor(canvas, () => {}));
        HTMLCanvasElement.prototype.getContext = function (...args) {
          return this === canvas ? null : originalContext.apply(this, args);
        };
        const previewFailure = failure(() => createMaskEditor(canvas, () => {}));
        HTMLCanvasElement.prototype.getContext = originalContext;
        const recovered = mask.getMask();
        return { cleared, redone, cached: cached === encoded, undone: undone === encoded,
          cachedEncodes, afterUndoEncodes, isolated, resized, pixels, size,
          outputFailure, initFailure, previewFailure, recovered: recovered === encoded };
      } finally {
        HTMLCanvasElement.prototype.toDataURL = originalEncode;
        HTMLCanvasElement.prototype.getContext = originalContext;
        mask.dispose();
      }
    });
    assert.equal(result.cleared, null);
    assert.equal(result.redone, null);
    assert.equal(result.cached, true);
    assert.equal(result.undone, true);
    assert.equal(result.cachedEncodes, 1);
    assert.equal(result.afterUndoEncodes, 2);
    assert.equal(result.isolated, 24);
    assert.deepEqual(result.resized, { value: null, undo: false, redo: false });
    assert.deepEqual(result.size, [64, 48]);
    assert.deepEqual(result.pixels, [[255, 255, 255, 255], [0, 0, 0, 255]]);
    for (const key of ["outputFailure", "initFailure", "previewFailure"])
      assert.equal(result[key], "当前浏览器不支持 Canvas 蒙版");
    assert.equal(result.recovered, true);
  } finally {
    await context.close();
  }
});

test("EDIT board navigation preserves a running task's source, mask and result owner", async () => {
  const t = await open("#/image"), p = t.page;
  try {
    await editorSource(t);
    const a = await p.evaluate(() => editor.session.id);
    t.state.hold = true;
    await p.locator("#editorRun").click();
    await p.waitForFunction(() => editor.snapshot().busy);
    await p.evaluate(() => app_shell.router.switchWorkspace("home"));
    await p.waitForURL("**/#/home");
    await p.evaluate(async png => {
      const blob = new Blob([Uint8Array.from(atob(png), c=>c.charCodeAt(0))],{type:"image/png"});
      await editor.open("edit",blob,"B.png");
      editor.patch({prompt:"B keeps its own fields"});
    }, t.ref.toString("base64"));
    assert.notEqual(await p.evaluate(() => editor.session.id), a);
    const b = await p.evaluate(() => editor.session.id);
    await p.waitForFunction(() => editor.session.versions.length === 1);
    for (let i=0; !t.state.release && i<100; i++) await new Promise(r=>setTimeout(r,20));
    assert.equal(typeof t.state.release,"function");
    t.state.release(); t.state.hold = false;
    await p.waitForFunction(() => !editor.snapshot().runningBoardId);
    assert.equal(await p.evaluate(() => editor.session.versions.length), 1);
    assert.equal(await p.evaluate(() => editor.session.fields.prompt), "B keeps its own fields");
    assert.equal(await p.evaluate(id=>editor.board(id).versions.length,a),2);
    assert.equal(await p.evaluate(id=>editor.board(id).versions.at(-1).params.editBoardId,a),a);
    assert.equal(t.state.generations,1);
    await p.evaluate(id=>editor.switchBoard(id),a);
    assert.equal(await p.evaluate(()=>editor.snapshot().viewed.kind),"result");
    await p.evaluate(id=>editor.switchBoard(id),b);
  } finally { await t.close(); }
});

test("EDIT asynchronous CHAT delivery keeps its source conversation and cannot redirect or report errors on another board", async () => {
  const t = await open(), p = t.page;
  try {
    await editorSource(t, "chat");
    await p.evaluate(() => {
      window.deliveryOwner = editor.session;
      window.deliveryConversation = editor.session.conversationId;
      const send = chat.useEditorResult;
      chat.useEditorResult = async (...args) => {
        await new Promise(resolve => { window.releaseDelivery = resolve; });
        return send(...args);
      };
      window.deliveryWork = editor.useResult();
    });
    await editorSource(t, "image");
    const other = await p.evaluate(() => editor.session.id);
    await p.evaluate(async () => { releaseDelivery(); await deliveryWork; });
    assert.equal(await p.evaluate(() => editor.session.id), other);
    assert.match(p.url(), /#\/edit$/);
    assert.equal(await p.evaluate(() => chat.snapshot().context.imageIds.length), 1);
    assert.equal(await p.evaluate(() => chat.snapshot().current.id === deliveryConversation), true);
    await p.evaluate(() => {
      editor.switchBoard(deliveryOwner.id);
      chat.useEditorResult = async () => {
        await new Promise(resolve => { window.releaseDelivery = resolve; });
        throw new Error("synthetic delivery failure");
      };
      window.deliveryWork = editor.useResult();
    });
    await p.evaluate(id => editor.switchBoard(id), other);
    await p.evaluate(async () => { releaseDelivery(); await deliveryWork; });
    assert.deepEqual(await p.evaluate(() => [editor.snapshot().runError, deliveryOwner.error]), ["", "synthetic delivery failure"]);
    assert.deepEqual(t.errors, []);
    assert.equal(t.state.generations, 0);
  } finally {
    await t.close();
  }
});
