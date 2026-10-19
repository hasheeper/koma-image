import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
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
  await mkdir(".local/m56", { recursive: true });
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
async function open(path = "#/chat") {
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
      return route.fulfill({ json: catalog });
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
  await t.page.waitForSelector("#imageEditor[open]");
  await t.page.waitForFunction(
    () =>
      editor.snapshot().edit.quote !== null ||
      editor.snapshot().upscale.quote !== null,
  );
}
async function closeEditor(p) {
  await p.locator("#imageEditor .editor-back").click();
  await p.waitForFunction(() => !document.querySelector("#imageEditor").open);
}

test("M5 chat UI: ordered response, exact context, consumption, version/branch selection, model caps and draft persistence", async () => {
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
      await p.locator(".context-base-label b").textContent(),
      "底图",
    );
    assert.equal(
      await p.locator(".context-grid[aria-label=参考图] .context-tile").count(),
      1,
    );
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
    await p
      .locator(".chat-turn")
      .first()
      .getByRole("button", { name: "重新生成此版本", exact: true })
      .click();
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
      "2/2",
    );
    await p
      .locator(".chat-turn")
      .first()
      .getByRole("button", { name: "上一个版本" })
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
      await drawing.addExternal(
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
test("M6 editor modes, quote protection, source-pixel mask, undo/redo, persistent sessions, and result history", async () => {
  const t = await open("#/image"),
    p = t.page;
  try {
    await editorSource(t);
    await p.locator("#editorForm .drawer summary").click();
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
    assert.equal(await p.evaluate(() => drawing.snapshot().history.length), 1);
    assert.equal(await p.evaluate(() => editor.snapshot().base.id), 1);
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
    await p.waitForSelector("#imageEditor[open]");
    assert.equal(await p.locator(".editor-rail .tile").count(), 3);
    assert.equal(await p.locator("#editorPrompt").inputValue(), "edit exact");
  } finally {
    await t.close();
  }
});
test("M6 upscale uses viewed original and independent detail, chat return ownership and run-close guard", async () => {
  const t = await open(),
    p = t.page;
  try {
    await editorSource(t, "chat", "upscale");
    await p.waitForSelector("#editorUpscalePop:popover-open");
    await p
      .locator("#editorUpscalePop label")
      .filter({ hasText: "Dedicated Upscale" })
      .click();
    await p
      .getByRole("textbox", { name: "细节描述", exact: true })
      .fill("preserve linework");
    await p.waitForFunction(() => editor.snapshot().upscale.quote !== null);
    t.state.hold = true;
    await p.locator("#editorUpscaleRun").click();
    await p.waitForFunction(() => editor.snapshot().busy);
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#imageEditor").getAttribute("open"), "");
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
    await p
      .locator("#imageEditor")
      .getByRole("button", { name: "添加为参考图", exact: true })
      .click();
    await p.waitForFunction(() => !document.querySelector("#imageEditor").open);
    assert.equal(
      await p.evaluate(() => chat.snapshot().context.imageIds.length),
      1,
    );
    await editorSource(t, "image");
    assert.equal(await p.locator(".editor-rail .tile").count(), 1);
    assert.equal(await p.locator("#editorPrompt").inputValue(), "");
    await closeEditor(p);
    await p.evaluate(() => editor.open("chat"));
    await p.waitForSelector("#imageEditor[open]");
    assert.equal(await p.locator(".editor-rail .tile").count(), 2);
  } finally {
    await t.close();
  }
});
test("M5/M6 four viewports and high-frequency native ownership; repeated overlay cycles release resources", async () => {
  const t = await open(),
    p = t.page;
  try {
    await send(t);
    await p.getByRole("button", { name: "上下文", exact: true }).click();
    await p.screenshot({ path: ".local/m56/context-1440.png" });
    await p.getByRole("button", { name: "关闭上下文", exact: true }).click();
    for (const width of [320, 390, 768, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      await p.screenshot({ path: `.local/m56/chat-${width}.png` });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    await editorSource(t, "chat");
    await p.getByRole("button", { name: "重绘", exact: true }).click();
    await p.waitForSelector("#editorMask:not([hidden])");
    for (const width of [320, 390, 768, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      await p.waitForFunction(
        () =>
          document.querySelector("#editorStage").getBoundingClientRect().width >
          100,
      );
      await p.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      await p.waitForFunction(() => {
        const stage = document.querySelector("#editorStage");
        return (
          Math.abs(
            stage.getBoundingClientRect().width - parseFloat(stage.style.width),
          ) < 1
        );
      });
      await p.screenshot({ path: `.local/m56/editor-${width}.png` });
      assert.equal(
        await p
          .locator("#imageEditor")
          .evaluate((d) => d.scrollWidth <= innerWidth),
        true,
      );
    }
    const box = await p.locator("#editorMask").boundingBox();
    await p.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await p.mouse.down();
    await p.evaluate(() => {
      const c = document.querySelector("#imageEditor").__vueParentComponent;
      window.renders = 0;
      c.u = [...(c.u || []), () => window.renders++];
    });
    await p.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, {
      steps: 40,
    });
    assert.equal(await p.evaluate(() => renders), 0);
    await p.mouse.up();
    await closeEditor(p);
    await p.evaluate(() => (location.hash = "#/image"));
    await p.waitForSelector("#prompt");
    await p.evaluate(() => (location.hash = "#/chat"));
    await p.waitForSelector("#chatPrompt");
    const cdp = await p.context().newCDPSession(p);
    async function listeners(expression) {
      const { result } = await cdp.send("Runtime.evaluate", { expression });
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
        objectId: result.objectId,
      });
      await cdp.send("Runtime.releaseObject", { objectId: result.objectId });
      return listeners.map((l) => `${l.type}:${l.useCapture}`).sort();
    }
    const before = await listeners("window"),
      beforeDoc = await listeners("document"),
      beforeCanvas = await listeners('document.querySelector("#editorMask")'),
      urls = await p.evaluate(() => liveImageUrls.size);
    for (let i = 0; i < 6; i++) {
      await p.evaluate(() => editor.open("chat"));
      await p.waitForSelector("#imageEditor[open]");
      await closeEditor(p);
      await p.evaluate(() => (location.hash = "#/image"));
      await p.waitForSelector("#prompt");
      await p.evaluate(() => (location.hash = "#/chat"));
      await p.waitForSelector("#chatPrompt");
    }
    assert.deepEqual(await listeners("window"), before);
    assert.deepEqual(await listeners("document"), beforeDoc);
    assert.deepEqual(
      await listeners('document.querySelector("#editorMask")'),
      beforeCanvas,
    );
    assert.equal(await p.evaluate(() => liveImageUrls.size), urls);
    await cdp.detach();
  } finally {
    await t.close();
  }
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

test("M6 EXIF orientation aligns source and mask; session switching and 30-version eviction preserve the base", async () => {
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
    await p.evaluate(() => editor.open("image"));
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
      for (let i = 0; i < 32; i++) {
        await editor.addSource(
          new Blob([base.blob], { type: base.blob.type }),
          `synthetic-${i}.jpg`,
        );
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
      count: 30,
      base: 1,
      retained: true,
      revoked: true,
    });
  } finally {
    await t.close();
  }
});

test("M5 pending and result waves stay native and release on workspace deactivation", async () => {
  const t = await open(),
    p = t.page;
  try {
    await p.emulateMedia({ reducedMotion: "no-preference" });
    t.state.hold = true;
    await p.locator("#chatPrompt").fill("native reveal");
    await p.getByRole("button", { name: "发送绘图请求", exact: true }).click();
    while (!t.state.release) await p.waitForTimeout(20);
    await p.waitForSelector(".chat-pending .tile-wave");
    await p.evaluate(() => {
      const c = document.querySelector(".chat-turn").__vueParentComponent;
      window.pendingRenders = 0;
      c.u = [...(c.u || []), () => pendingRenders++];
    });
    await p.waitForTimeout(180);
    assert.equal(await p.evaluate(() => pendingRenders), 0);
    await p.evaluate(() => (location.hash = "#/tags"));
    await p.waitForSelector("[data-workspace-root=tags]");
    assert.equal(await p.locator(".tile-wave").count(), 0);
    await p.evaluate(() => (location.hash = "#/chat"));
    await p.waitForSelector(".chat-pending .tile-wave");
    t.state.release();
    await p.waitForSelector(".chat-print[data-wave=crest] .tile-wave");
    await p.evaluate(() => {
      const c = document.querySelector(".chat-print").__vueParentComponent;
      window.resultRenders = 0;
      c.u = [...(c.u || []), () => resultRenders++];
    });
    await p.waitForTimeout(180);
    assert.equal(await p.evaluate(() => resultRenders), 0);
    await p.evaluate(() => (location.hash = "#/tags"));
    await p.waitForSelector("[data-workspace-root=tags]");
    assert.equal(await p.locator(".tile-wave").count(), 0);
    await p.evaluate(() => (location.hash = "#/chat"));
    await p.waitForSelector(".chat-print:not([data-reveal]) img");
    assert.equal(await p.locator(".tile-wave").count(), 0);
  } finally {
    await t.close();
  }
});
