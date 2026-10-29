import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from './helpers/vite.mjs';
import { chromium } from "playwright";
import { createArchive } from "../src/storage/backup-archive.ts";
let browser, server, origin;
const catalog = {
  studio_features: { version: 2, max_cost: true },
  valid_samplers: ["k_euler_ancestral", "k_euler"],
  models: {
    "nai-diffusion-5-full": {
      name: "NAI Diffusion V5 Full",
      provider: "novelai",
      max_resolution: 2200000,
      quota_group: "novelai",
    },
    "nai-diffusion-4-5-full": {
      name: "NAI Diffusion 4.5 Full",
      provider: "novelai",
      max_resolution: 1048576,
      quota_group: "novelai",
    },
  },
};
before(async () => {
  await mkdir(".local/m4", { recursive: true });
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
async function open(options = {}) {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    requests = [],
    notices = [];
  const state = {
    cost: 0,
    left: 900,
    failAt: 0,
    holdAt: 0,
    generations: 0,
    hold: null,
    ...options,
  };
  await context.addInitScript(() => {
    const live = new Set(),
      create = URL.createObjectURL,
      revoke = URL.revokeObjectURL;
    window.liveImageUrls = live;
    URL.createObjectURL = function (blob) {
      const url = create.call(this, blob);
      live.add(url);
      return url;
    };
    URL.revokeObjectURL = function (url) {
      live.delete(url);
      return revoke.call(this, url);
    };
  });
  await context.addInitScript(() => {
    if (location.protocol === "about:") return;
    if (!localStorage.getItem("koma.routing.v1"))
      localStorage.setItem(
        "koma.routing.v1",
        JSON.stringify({
          version: 1,
          connections: {
            test: {
              id: "test",
              name: "测试连接",
              baseUrl: "https://gateway.example.test",
              profileId: "koma-standard-v1",
              credentialRef: "test-key",
              revision: "test-rev",
            },
          },
          links: {},
        }),
      );
    sessionStorage.setItem(
      "koma.session.keys",
      JSON.stringify({ "test-key": "synthetic-only-key" }),
    );
    if (!localStorage.getItem("koma.prefs.v1"))
      localStorage.setItem(
        "koma.prefs.v1",
        // A previously disabled history switch must not override the quantity.
        JSON.stringify({ tagSuggest: false, localCache: false }),
      );
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto("about:blank");
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 832;
      c.height = 1216;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 832, 1216);
      g.addColorStop(0, "#514b80");
      g.addColorStop(1, "#192736");
      x.fillStyle = g;
      x.fillRect(0, 0, 832, 1216);
      x.fillStyle = "#b6c8e1";
      x.fillRect(100, 120, 500, 700);
      return c.toDataURL().split(",")[1];
    }),
    "base64",
  );
  const zip = Buffer.from(
    await (await createArchive([["image.png", new Blob([png])]])).arrayBuffer(),
  );
  await context.route("https://gateway.example.test/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      payload = req.postDataJSON();
    requests.push({ path: url.pathname, payload });
    if (url.pathname.endsWith("/image/models"))
      return route.fulfill({ json: catalog });
    if (url.pathname.endsWith("/media/quota")) {
      if (state.holdQuota) {
        state.holdQuota = false;
        await new Promise((resolve) => {
          state.quotaRelease = resolve;
        });
      }
      return route.fulfill({
        json: {
          credits: { remaining: 34.5 },
          images: { novelai: { used: 100, remaining: 20, limit: 120 } },
        },
      });
    }
    if (url.pathname.endsWith("/token_stats_data"))
      return route.fulfill({
        json: {
          temp_limits: {
            is_temp: true,
            limited: true,
            rpd_remaining: state.left,
            rpd: 1000,
          },
        },
      });
    if (url.pathname.endsWith("/estimate"))
      return route.fulfill({ json: { cost: state.cost } });
    state.generations++;
    if (state.holdAt === state.generations)
      await new Promise((resolve) => {
        state.hold = resolve;
      });
    if (state.failAt === state.generations)
      return route.fulfill({
        status: 500,
        json: { error: "synthetic failure" },
      });
    return route.fulfill({
      contentType: url.pathname.endsWith("generate-image")
        ? "application/octet-stream"
        : "image/png",
      body: url.pathname.endsWith("generate-image") ? zip : png,
    });
  });
  await page.goto(origin + "/#/image");
  await page.waitForFunction(
    () => document.querySelector(`[id="${document.querySelector("#model")?.getAttribute("aria-controls")}"]`)?.querySelectorAll("[role=menuitemradio]").length === 2,
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#goCost")?.textContent.includes("免费") ||
      document.querySelector("#goCost")?.textContent.includes("积分"),
  );
  await page.evaluate(() => {
    const provides = document.body.__vue_app__._instance.provides;
    window.drawing =
      provides[
        Object.getOwnPropertySymbols(provides).find(
          (k) => k.description === "drawing",
        )
      ];
    window.services =
      document.body.__vue_app__._context.provides[
        Object.getOwnPropertySymbols(
          document.body.__vue_app__._context.provides,
        ).find((k) => k.description === "application-services")
      ];
  });
  return {
    page,
    context,
    errors,
    requests,
    notices,
    state,
    png,
    async close() {
      state.hold?.();
      await context.close();
      assert.deepEqual(errors, []);
    },
  };
}
async function run(t) {
  await t.page.locator("#goBtn").click();
  await t.page.waitForFunction(
    () =>
      document.body.dataset.state === "done" &&
      document.querySelector("#form").getAttribute("aria-busy") === "false",
  );
}
async function patch(t, values) {
  await t.page.evaluate((values) => window.drawing.patch(values), values);
}
const generationRequests = (t) =>
  t.requests.filter(
    (r) => r.path.endsWith("/generate") || r.path.endsWith("/generate-image"),
  );

test("M4 complete draw, original controls, strict native wire, favorite persistence, retention and undo", async () => {
  const t = await open(),
    p = t.page;
  try {
    assert.equal(await p.locator("#width").inputValue(), "832");
    await p.locator("label:has(input[name=tier][value=l])").click();
    assert.equal(await p.locator("#width").inputValue(), "1024");
    await p.locator("label:has(input[name=orientation][value=square])").click();
    assert.equal(await p.locator("#width").inputValue(), "1472");
    await p
      .locator("label:has(input[name=orientation][value=landscape])")
      .click();
    assert.equal(await p.locator("#width").inputValue(), "1536");
    await p.locator("#swapSize").click();
    assert.equal(await p.locator("#width").inputValue(), "1024");
    await p.locator("#width").fill("801");
    assert.equal(await p.locator("#width").inputValue(), "801");
    await p.locator("#width").blur();
    assert.equal(await p.locator("#width").inputValue(), "832");
    await patch(t, {
      width: 832,
      height: 1216,
      seed: "0",
      prompt: "  blue hair  ",
    });
    await patch(t, { prompt: "before preflight" });
    await p.evaluate(() => {
      window.publishedImages = [];
      window.stopImageCheck = drawing.onImage(record => publishedImages.push(record.id));
    });
    t.state.holdQuota = true;
    await p.locator("#goBtn").click();
    while (!t.state.quotaRelease) await p.waitForTimeout(20);
    await p.locator("#prompt").fill("  blue hair  ");
    t.state.quotaRelease();
    await p.waitForFunction(
      () => !drawing.snapshot().busy && drawing.snapshot().state === "done",
    );
    const req = generationRequests(t)[0];
    assert.equal(req.payload.input, "blue hair");
    assert.equal(req.payload.parameters.seed, 0);
    assert.equal(req.payload.max_cost, 0);
    assert.equal(req.payload.basePrompt, undefined);
    const publication = await p.evaluate(async () => {
      stopImageCheck();
      const p = document.body.__vue_app__._instance.provides, home = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'home')];
      await home.ready; await home.store.flush();
      return {events:publishedImages, current:drawing.snapshot().current.id,
        preview:home.store.snapshot().previews.find(p => p.boardId === drawing.snapshot().activeBoardId)?.sourceId};
    });
    assert.deepEqual(publication.events, [publication.current]);
    assert.equal(publication.preview, publication.current, 'real drawing completion still publishes the HOME preview');
    await p.locator("#favoriteBtn").click();
    await p.waitForFunction(
      () =>
        document.querySelector("#favoriteBtn").getAttribute("aria-pressed") ===
        "true",
    );
    assert.equal(await p.locator(".tile-favorite").count(), 1);
    await patch(t, { historyLimit: 1 });
    await run(t);
    assert.equal(await p.locator(".tile[data-id]").count(), 1);
    assert.equal(await p.locator("#favoritesTab b").textContent(), "1");
    await p.locator("#favoritesTab").click();
    await p.locator(".tile[data-id]").click();
    await p.locator("#favoriteBtn").click();
    await p.getByRole("button", { name: "撤销", exact: true }).click();
    await p.waitForFunction(
      () => document.querySelector("#favoritesTab b").textContent === "1",
    );
    await p.reload();
    await p.waitForSelector(".home-fav");
    assert.equal(await p.locator("#historyTab b").textContent(), "0");
    assert.equal(await p.locator("#favoritesTab b").textContent(), "1");
    await p.locator(".home-fav").click();
    assert.equal(
      await p
        .locator("#resultSeed")
        .textContent()
        .then((s) => s.trim()),
      "Seed 0",
    );
    await p.locator("#favoritesTab").click();
    await p.locator("#histToggle").click();
    await p.waitForFunction(
      () => document.querySelector("#gallery").getBoundingClientRect().width === 52,
    );
    await p.locator("#tray .tile[data-id]").first().hover();
    await p.waitForFunction(() => {
      const peek = document.querySelector(".library-peek");
      return peek && !peek.hidden && parseFloat(peek.style.top) >= 72;
    });
    await p.locator("#histToggle").click();
    await p.waitForSelector(".library-peek[hidden]", { state: "attached" });
    for (const width of [320, 390, 768, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      await p.waitForTimeout(150);
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await p.screenshot({
        path: `.local/m4/result-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await t.close();
  }
});

test("M4 serial batch holds global slot, seeds wrap, cost rises once, comparison stays local", async () => {
  const t = await open({ cost: 2, holdAt: 1 }),
    p = t.page;
  try {
    await patch(t, { seed: "4294967295", batchCount: 3 });
    await p.locator("#goBtn").click();
    await p.waitForFunction(() => drawing.snapshot().busy);
    while (!t.state.hold) await p.waitForTimeout(20);
    const held = await p.evaluate(async () => {
      const q = await navigator.locks.query();
      return q.held
        .filter((l) => l.name.includes("generation"))
        .map((l) => l.name);
    });
    assert.ok(held.includes("koma-image-generation-slot-v1:1"));
    t.state.cost = 5;
    t.state.hold();
    await p.waitForFunction(() => !drawing.snapshot().busy);
    assert.equal(t.state.generations, 3);
    assert.deepEqual(
      generationRequests(t).map((r) => r.payload.seed),
      [4294967295, 0, 1],
    );
    assert.deepEqual(
      generationRequests(t).map((r) => r.payload.max_cost),
      [2, 5, 5],
    );
    assert.equal(
      await p.locator(".toast-text").filter({ hasText: "报价已变为" }).count(),
      1,
    );
    assert.equal(await p.locator(".tile[data-id]").count(), 4);
    assert.match(await p.locator("#resultName").textContent(), /batch-3\.png/);
    assert.equal(
      await p.evaluate(() => drawing.snapshot().current.params.isComparison),
      true,
    );
  } finally {
    await t.close();
  }
});

test("M4 failure and cancellation stop remaining requests; browsing and workspace switching preserve task/state", async () => {
  const t = await open({ cost: 1 }),
    p = t.page;
  try {
    await patch(t, { seed: "8" });
    await run(t);
    const old = await p.locator("#image").getAttribute("src");
    t.state.holdAt = 2;
    await patch(t, { batchCount: 3 });
    await p.locator("#goBtn").click();
    while (!t.state.hold) await p.waitForTimeout(20);
    await p.locator(".tile[data-id]").click();
    assert.equal(await p.locator("#image").getAttribute("src"), old);
    await p.evaluate(() => (location.hash = "#/tags"));
    t.state.hold();
    await p.waitForFunction(() => !drawing.snapshot().busy);
    await p.evaluate(() => (location.hash = "#/image"));
    assert.equal(await p.locator("#prompt").inputValue(), "");
    assert.equal(await p.locator(".tile[data-id]").count(), 5);
    t.state.failAt = t.state.generations + 2;
    await p.locator("#goBtn").click();
    await p.waitForFunction(() => !drawing.snapshot().busy);
    assert.equal(
      await p.locator("#errBody").textContent(),
      "第 2/3 张失败，队列已停止。synthetic failure",
    );
    const failed = t.state.generations;
    await p.waitForTimeout(100);
    assert.equal(t.state.generations, failed);
    t.state.failAt = 0;
    t.state.holdAt = t.state.generations + 1;
    t.state.hold = null;
    await p.locator("#goBtn").click();
    while (!t.state.hold) await p.waitForTimeout(20);
    await p.locator("#cancelBtn").click();
    t.state.hold();
    await p.waitForFunction(() => !drawing.snapshot().busy);
    assert.equal(t.state.generations, failed + 1);
    assert.ok((await p.locator(".tile[data-id]").count()) >= 5);
  } finally {
    await t.close();
  }
});

test("M4 batch count ignores the daily quota; strict limits and restored preferences", async () => {
  const t = await open({ cost: 2, left: 1 }),
    p = t.page;
  try {
    await patch(t, { batchCount: 5 });
    await p.locator("#parametersToggle").click();
    await p.evaluate(() => drawing.refreshQuota(true));
    assert.equal(await p.locator("#batchCount").inputValue(), "5");
    assert.equal(await p.locator("#batchCount").isDisabled(), false);
    await patch(t, { width: 2048, height: 2048 });
    assert.equal(await p.locator("#goBtn").isDisabled(), true);
    await patch(t, {
      width: 832,
      height: 1216,
      model: "nai-diffusion-4-5-full",
      transparentBg: true,
    });
    assert.equal(await p.locator("#transparentBg").count(), 0);
    assert.equal(await p.evaluate(() => drawing.snapshot().form.transparentBg), true);
    await p.reload();
    await p.waitForSelector("#width");
    assert.equal(await p.locator("#width").inputValue(), "832");
    assert.equal(await p.locator("#transparentBg").count(), 0);
    await p.locator("#model").click();
    await p.locator('.nai-menu:popover-open [data-value="nai-diffusion-5-full"]').click();
    assert.equal(await p.locator("#transparentBg").getAttribute("aria-pressed"), "true");
  } finally {
    await t.close();
  }
});

test("M4 history import review, copy/reuse, high-frequency splitter has no Vue rerenders and resources clean up", async () => {
  const t = await open(),
    p = t.page;
  try {
    await patch(t, { seed: "0", prompt: "blue hair", steps: 25 });
    await run(t);
    await patch(t, { prompt: "other", steps: 30 });
    await p.locator(".tile[data-id]").dragTo(p.locator("#prompt"));
    await p.waitForSelector("#importSheet:not([hidden])");
    assert.equal(await p.locator(".import-chip[data-state=change]").count(), 1);
    await p.screenshot({ path: ".local/m4/import-1440.png" });
    await p.locator("#importApply").click();
    assert.equal(await p.locator("#prompt").inputValue(), "blue hair");
    await p.locator("#parametersToggle").click();
    assert.equal(await p.locator("#steps").inputValue(), "25");
    // Finish the import's debounced quote before measuring pointer-only updates.
    await p.waitForFunction(() => drawing.snapshot().quote.status === "ready");
    await p.evaluate(() => {
      const c = document.querySelector(
        "[data-workspace-root=image]",
      ).__vueParentComponent;
      window.renderCount = 0;
      c.u = [
        ...(c.u || []),
        () => {
          window.renderCount++;
        },
      ];
    });
    const box = await p.locator("#splitter").boundingBox();
    await p.mouse.move(box.x + 2, box.y + 50);
    await p.mouse.down();
    await p.mouse.move(box.x + 60, box.y + 50, { steps: 30 });
    assert.equal(await p.evaluate(() => window.renderCount), 0);
    await p.mouse.up();
    const initial = await p.evaluate(async () => ({
      locks: (await navigator.locks.query()).held.length,
      waves: document.querySelectorAll(".tile-wave").length,
    }));
    for (let i = 0; i < 8; i++) {
      await p.evaluate(() => (location.hash = "#/tags"));
      await p.waitForSelector("[data-workspace-root=tags]");
      assert.equal(await p.locator(".tile-wave").count(), 0);
      await p.evaluate(() => (location.hash = "#/image"));
      await p.waitForSelector("[data-workspace-root=image]");
    }
    const after = await p.evaluate(async () => ({
      locks: (await navigator.locks.query()).held.length,
      waves: document.querySelectorAll(".tile-wave").length,
    }));
    assert.deepEqual(after, initial);
  } finally {
    await t.close();
  }
});

test("transparent previews preserve alpha and bypass existing flattened JPEG thumbnails", async () => {
  const t = await open(), p = t.page;
  try {
    const result = await p.evaluate(async () => {
      const { makeThumb } = await import('/src/services/image-response.ts');
      const pixel = async blob => {
        const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return { size: [canvas.width, canvas.height], corner: [...ctx.getImageData(0, 0, 1, 1).data], center: [...ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data] };
      };
      const canvas = new OffscreenCanvas(832, 1216), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#b3a1ff80'; ctx.fillRect(200, 300, 432, 616);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const item = await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, blob, { width: 832, height: 1216 }, { boardId: drawing.snapshot().activeBoardId, prompt: 'synthetic transparent image' }, null);
      const legacy = { ...item, id: 'existing-jpeg-preview', thumbBlob: await canvas.convertToBlob({ type: 'image/jpeg' }) };
      await drawing.toggleFavorite(legacy);
      const stored = drawing.snapshot().favorites.find(r => r.id === legacy.id);
      const preview = await (await fetch(drawing.url(stored, true))).blob();
      const alpha = await pixel(item.thumbBlob), existing = await pixel(preview);
      ctx.fillStyle = '#345678'; ctx.fillRect(0, 0, 832, 1216);
      const opaque = await pixel(await makeThumb(await canvas.convertToBlob({ type: 'image/png' })));
      return { type: item.thumbBlob.type, alpha, existing, opaque, storedType: stored.thumbBlob.type, originalUnchanged: await stored.blob.text() === await blob.text() };
    });
    assert.equal(result.type, 'image/webp');
    assert.deepEqual(result.alpha.size, [525, 768]);
    assert.equal(result.alpha.corner[3], 0); assert.equal(result.alpha.center[3], 128);
    assert.equal(result.existing.corner[3], 0); assert.equal(result.existing.center[3], 128);
    assert.equal(result.storedType, 'image/jpeg'); assert.equal(result.originalUnchanged, true);
    assert.equal(result.opaque.corner[3], 255); assert.equal(result.opaque.center[3], 255);
    if (await p.locator('#histToggle').getAttribute('aria-expanded') !== 'true') await p.locator('#histToggle').click();
    await p.waitForSelector('#tray .tile img', { state: 'visible' });
    const image = await p.locator('#tray .tile img').first().evaluate(el => {
      const box = el.getBoundingClientRect(), tile = el.parentElement.getBoundingClientRect();
      return { background: getComputedStyle(el).backgroundImage, ratio: box.width / box.height, left: box.left - tile.left, right: tile.right - box.right };
    });
    assert.match(image.background, /repeating-conic-gradient/);
    assert.ok(Math.abs(image.ratio - 832 / 1216) < .01);
    assert.ok(Math.abs(image.left - image.right) < 1);
    assert.equal(t.state.generations, 0);
  } finally { await t.close(); }
});

test("M4 large home previews use saved originals, including favorites with small thumbnails", async () => {
  const t = await open(),
    p = t.page;
  try {
    const sizes = await p.evaluate(async (bytes) => {
      const { makeThumb } = await import("/src/services/image-response.ts");
      const { transactionDone } = await import("/src/storage/databases.ts");
      const { names } = await import("/src/storage/names.ts");
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const oldCanvas = new OffscreenCanvas(164, 240),
        original = await createImageBitmap(blob);
      oldCanvas.getContext("2d").drawImage(original, 0, 0, 164, 240);
      original.close();
      const thumbBlob = await oldCanvas.convertToBlob({
        type: "image/jpeg",
        quality: 0.72,
      });
      const smallCanvas = new OffscreenCanvas(80, 120);
      smallCanvas.getContext("2d").fillRect(0, 0, 80, 120);
      const small = await smallCanvas.convertToBlob();
      const sizes = [];
      for (const source of [blob, small]) {
        const bitmap = await createImageBitmap(await makeThumb(source));
        sizes.push([bitmap.width, bitmap.height]);
        bitmap.close();
      }
      await services.data.write(async () => {
        const tx = services.databases.transaction(
          names.databases.favorites, "favorites", "readwrite",
        );
        for (let i = 0; i < 2; i++)
          tx.objectStore("favorites").put({
            id: `preview-${i}`, createdAt: 1000 + i, favoritedAt: 1000 + i,
            blob, thumbBlob, size: { width: 832, height: 1216 },
            params: { ...drawing.snapshot().form, seed: i },
          });
        await transactionDone(tx);
      });
      return sizes;
    }, [...t.png]);
    assert.deepEqual(sizes, [[525, 768], [80, 120]]);
    await p.reload();
    await p.waitForSelector(".home-fav");
    await p.evaluate(() => document.fonts.ready);
    await p.waitForFunction(
      () => document.querySelector(".home-fav").offsetHeight === 240,
    );
    const previewBytes = await p.locator(".home-fav").first().evaluate(async (el) => {
      const url = getComputedStyle(el).getPropertyValue('--thumb').trim().slice(5, -2);
      return [...new Uint8Array(await (await fetch(url)).arrayBuffer())];
    });
    assert.deepEqual(Buffer.from(previewBytes), t.png);
    await p.screenshot({ path: ".local/m4/home-large-two.png" });

    // Fill the shelf to check two centred rows and the overflow link.
    await p.evaluate(async () => {
      const provides = document.body.__vue_app__._instance.provides;
      const drawing = provides[Object.getOwnPropertySymbols(provides).find(
        (k) => k.description === "drawing",
      )];
      const app = document.body.__vue_app__._context.provides;
      const services = app[Object.getOwnPropertySymbols(app).find(
        (k) => k.description === "application-services",
      )];
      const { transactionDone } = await import("/src/storage/databases.ts");
      const { names } = await import("/src/storage/names.ts");
      const favorite = drawing.snapshot().favorites[0];
      const { assignFavorite, identityStores } = await import('/src/services/image-identities.ts');
      await services.data.write(async () => {
        const tx = services.databases.transaction(names.databases.favorites, identityStores, "readwrite"), done = transactionDone(tx);
        for (let i = 2; i < 16; i++) await assignFavorite(tx, {...favorite, id:`preview-${i}`});
        await done;
      });
      await drawing.reloadFavorites();
    });
    await p.waitForSelector(".home-all");
    for (const width of [320, 390, 768, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      await p.waitForTimeout(150);
      const layout = await p.evaluate(() => {
        const home = document.querySelector(".home").getBoundingClientRect(),
          viewport = document.querySelector("#viewport").getBoundingClientRect(),
          rows = [...document.querySelectorAll(".home-row")];
        return {
          fits: home.top >= viewport.top - 1 && home.bottom <= viewport.bottom + 1,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          centred: rows.every((row) => {
            const r = row.getBoundingClientRect();
            return Math.abs((r.left + r.right - home.left - home.right) / 2) < 1;
          }),
          counts: rows.map((row) => row.children.length),
          height: document.querySelector(".home-fav").offsetHeight,
        };
      });
      assert.ok(layout.fits && layout.centred && !layout.overflow, JSON.stringify({ width, ...layout }));
      assert.equal(layout.counts.length, 2);
      if (width <= 390) assert.deepEqual(layout.counts, [3, 3]);
      if (width === 1440) assert.equal(layout.height, 240);
      assert.match(await p.locator(".home-all").textContent(), /全部 16 张/);
      await p.screenshot({ path: `.local/m4/home-large-${width}.png` });
    }
    await p.locator(".home-fav").first().click();
    await p.waitForFunction(() => document.querySelector("#image")?.naturalWidth === 832);
    assert.equal(await p.locator("#image").evaluate((img) => img.naturalHeight), 1216);
    assert.equal(t.state.generations, 0);
  } finally {
    await t.close();
  }
});

test("M4 commit-first favorites, cross-tab refresh, backup reload and lossless download", async () => {
  const t = await open(),
    p = t.page;
  try {
    await run(t);
    const initial = await p.evaluate(() => liveImageUrls.size);
    await p.evaluate(() => {
      window.realWrite = services.data.write;
      services.data.write = async () => {
        throw new DOMException("synthetic quota", "QuotaExceededError");
      };
    });
    await p.locator("#favoriteBtn").click();
    await p.waitForSelector(".toast[data-tone=err]");
    assert.equal(
      await p.locator("#favoriteBtn").getAttribute("aria-pressed"),
      "false",
    );
    await p.evaluate(() => {
      services.data.write = realWrite;
    });
    await p.locator("#favoriteBtn").click();
    await p.waitForFunction(() => drawing.snapshot().favorites.length === 1);
    const [download] = await Promise.all([
      p.waitForEvent("download"),
      p.locator("#saveBtn").click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), t.png);
    const second = await t.context.newPage();
    await second.goto(origin + "/#/image");
    await second.waitForSelector(".home-fav");
    await second.locator(".home-fav").click();
    await second.locator("#favoriteBtn").click();
    await p.waitForFunction(() => drawing.snapshot().favorites.length === 0);
    await second.close();
    await p.locator("#favoriteBtn").click();
    await p.waitForFunction(() => drawing.snapshot().favorites.length === 1);
    await p.evaluate(async () => {
      const backup = await services.backup.export();
      window.checkedBackup = await services.backup.read(backup.blob);
      await drawing.patch({
        model: "nai-diffusion-4-5-full",
        prompt: "changed after backup",
      });
      await drawing.toggleFavorite();
      await services.backup.import(checkedBackup);
    });
    await p.waitForFunction(
      () =>
        drawing.snapshot().favorites.length === 1 &&
        drawing.snapshot().model?.id === "nai-diffusion-5-full",
    );
    assert.equal(await p.locator("#prompt").inputValue(), "");
    assert.equal(await p.evaluate(() => services.data.phase), "ready");
    for (let i = 0; i < 5; i++) {
      await p.locator(".tile[data-id]").dragTo(p.locator("#prompt"));
      await p.waitForSelector("#importSheet:not([hidden])");
      await p.keyboard.press("Escape");
    }
    assert.equal(await p.evaluate(() => liveImageUrls.size), initial);
  } finally {
    await t.close();
  }
});

test("M4 native wave does not rerender Vue and releases canvas work while inactive", async () => {
  const t = await open({ holdAt: 1 }),
    p = t.page;
  try {
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.locator("#goBtn").click();
    while (!t.state.hold) await p.waitForTimeout(20);
    await p.evaluate(() => {
      window.waveRenders = 0;
      const c = document.querySelector(".stage").__vueParentComponent;
      c.u = [...(c.u || []), () => waveRenders++];
    });
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => waveRenders), 0);
    assert.equal(await p.locator(".tile-wave").count(), 2);
    await p.evaluate(() => (location.hash = "#/tags"));
    await p.waitForSelector("[data-workspace-root=tags]");
    assert.equal(await p.locator(".tile-wave").count(), 0);
    await p.evaluate(() => (location.hash = "#/image"));
    await p.waitForSelector("[data-workspace-root=image]");
    assert.equal(await p.locator(".tile-wave").count(), 2);
    t.state.hold();
    await p.waitForFunction(() => !drawing.snapshot().busy);
    assert.equal(
      await p.locator("#image").evaluate((img) => img.naturalWidth),
      832,
    );
  } finally {
    await t.close();
  }
});

test("M4 reveal hands over in place: the landed tile takes the placeholder slot", async () => {
  const t = await open({ holdAt: 2 }),
    p = t.page;
  try {
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await patch(t, { width: 832, height: 1216 });
    for (const round of [1, 2]) {
      await p.locator("#goBtn").click();
      if (round === 1) {
        await p.waitForFunction(() => !drawing.snapshot().busy);
        continue;
      }
      while (!t.state.hold) await p.waitForTimeout(20);
    }
    t.state.hold();
    const landed = p.locator("#tray .tile[data-landing]");
    await landed.waitFor();
    assert.equal(await p.evaluate(() => document.body.dataset.state), "busy");
    assert.equal(await p.locator(".tile-pending").count(), 0);
    assert.equal(await landed.getAttribute("aria-current"), "true");
    assert.equal(
      await p.locator("#tray .library-item > .tile").first().getAttribute("data-landing"),
      "",
    );
    await p.waitForFunction(() => !drawing.snapshot().busy);
    assert.equal(await p.locator("#tray .tile[data-landing]").count(), 0);
  } finally {
    await t.close();
  }
});

test("comparison: bitmap and image fallbacks release resources on success, decode failure and cancellation", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.goto(origin + "/#/image");
    const result = await page.evaluate(async () => {
      const { makeComparison } = await import("/src/native/comparison.ts");
      const source = document.createElement("canvas");
      source.width = 128; source.height = 64;
      source.getContext("2d").fillStyle = "rgb(200,30,40)";
      source.getContext("2d").fillRect(0, 0, 128, 64);
      const blob = await new Promise((resolve) => source.toBlob(resolve));
      const records = [{ blob, params: { seed: 0 } }];
      const base = { width: 128, height: 64, model: "fixture", steps: 25, sampler: "fixture" };
      const bitmap = window.createImageBitmap, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      const decode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
      const urls = new Set();
      let closed = 0;
      URL.createObjectURL = (blob) => { const url = create(blob); urls.add(url); return url; };
      URL.revokeObjectURL = (url) => { urls.delete(url); revoke(url); };
      const pixel = async (blob) => {
        const image = await bitmap(blob), canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0);
        image.close();
        return [...canvas.getContext("2d").getImageData(50, 150, 1, 1).data];
      };
      try {
        window.createImageBitmap = async (blob) => {
          const image = await bitmap(blob), close = image.close.bind(image);
          image.close = () => { closed++; close(); };
          return image;
        };
        const direct = await makeComparison(records, base);
        window.createImageBitmap = async () => { throw new Error("force image fallback"); };
        const fallback = await makeComparison(records, base);
        Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: undefined });
        const loadEvent = await makeComparison(records, base);
        let failure = "", cancelled = "";
        try { await makeComparison([{ blob: new Blob(["invalid"]), params: { seed: 0 } }], base); }
        catch (error) { failure = error.message; }
        const abort = new AbortController(); abort.abort();
        try { await makeComparison(records, base, abort.signal); }
        catch (error) { cancelled = error.name; }
        return { closed, urls: urls.size, failure, cancelled,
          sizes: [direct.size, fallback.size, loadEvent.size],
          pixels: await Promise.all([direct, fallback, loadEvent].map((v) => pixel(v.blob))) };
      } finally {
        window.createImageBitmap = bitmap;
        URL.createObjectURL = create; URL.revokeObjectURL = revoke;
        if (decode) Object.defineProperty(HTMLImageElement.prototype, "decode", decode);
      }
    });
    assert.equal(result.closed, 1);
    assert.equal(result.urls, 0);
    assert.equal(result.failure, "图片解码失败");
    assert.equal(result.cancelled, "AbortError");
    assert.deepEqual(result.sizes, Array(3).fill({ width: 528, height: 364 }));
    assert.deepEqual(result.pixels, Array(3).fill([200, 30, 40, 255]));
  } finally { await context.close(); }
});

test('Board menu: compact footer, per-board actions, nested Escape and four-width previews', async () => {
  const {page,context,state,errors}=await open();
  try {
    await mkdir('.local/boards/menu',{recursive:true});
    await page.evaluate(()=>{const p=document.body.__vue_app__._instance.provides;window.drawing=p[Object.getOwnPropertySymbols(p).find(s=>s.description==='drawing')];});
    await page.evaluate(()=>drawing.patch({prompt:'night station',seed:'7'}));
    const first=await page.evaluate(()=>drawing.snapshot().activeBoardId);
    const main=page.locator('#boardMenu'), action=()=>page.locator('.bd-actions:popover-open');
    const preview=async file=>{
      const p=await page.locator('.bd-pill').boundingBox(),m=await main.boundingBox();
      await page.screenshot({path:`.local/boards/menu/${file}.png`,clip:{x:Math.max(0,p.x-5),y:Math.max(0,p.y-5),width:p.width+10,height:m.y+m.height-p.y+10}});
    };
    await page.locator('.bd-switch').click();
    assert.ok((await main.boundingBox()).height<130,'one board no longer carries four management rows');
    assert.equal(await main.locator('.bd-footer button').count(),2);
    await preview('single-desktop');
    await main.locator('.bd-more').click();assert.equal(await action().getByRole('menuitem',{name:'删除画板',exact:true}).isDisabled(),true);
    await page.keyboard.press('Escape');assert.equal(await main.evaluate(el=>el.matches(':popover-open')),true);
    assert.equal(await main.locator('.bd-more').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await main.evaluate(el=>el.matches(':popover-open')),false);
    await page.getByRole('button',{name:'新建空白画板',exact:true}).click();
    const second=await page.evaluate(()=>drawing.snapshot().activeBoardId);
    assert.notEqual(first,second);assert.equal(await page.locator('#prompt').inputValue(),'');
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.seed),'');
    await page.locator('.bd-switch').click();await main.locator('.bd-row').first().locator('.bd-more').click();
    await action().getByRole('menuitem',{name:'重命名',exact:true}).click();
    await main.getByRole('textbox',{name:'画板名称',exact:true}).fill('夜景原稿');
    await main.getByRole('textbox',{name:'画板名称',exact:true}).press('Enter');
    assert.equal(await page.evaluate(()=>drawing.snapshot().activeBoardId),second,'renaming an inactive row does not switch boards');
    assert.equal(await page.evaluate(id=>drawing.board(id).name,first),'夜景原稿');
    await page.evaluate(async()=>{await drawing.renameBoard(drawing.snapshot().activeBoardId,'清晨车站与暖色灯光 · 长名称');});
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});await page.locator('.bd-switch').scrollIntoViewIfNeeded();await page.locator('.bd-switch').click();
      assert.ok(await main.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;}));
      await preview(`menu-${width}`);
      await main.locator('.bd-row').first().locator('.bd-more').click();
      assert.ok(await action().evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
      await page.screenshot({path:`.local/boards/menu/actions-${width}.png`});
      await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    }
    await page.locator('.bd-switch').click();await main.locator('.bd-row').first().locator('.bd-more').click();
    await action().getByRole('menuitem',{name:'删除画板',exact:true}).click();
    await page.getByRole('button',{name:'删除',exact:true}).click();
    assert.equal(await page.evaluate(()=>drawing.snapshot().activeBoardId),second);
    assert.equal(await page.evaluate(id=>!!drawing.board(id),first),false,'deletes the row target, never the active board by accident');
    await page.evaluate(async()=>{for(let i=0;i<19;i++)await drawing.createBoard(false);});
    await page.setViewportSize({width:390,height:700});await page.locator('.bd-switch').scrollIntoViewIfNeeded();await page.locator('.bd-switch').click();
    assert.ok(await main.locator('.bd-list').evaluate(el=>el.scrollHeight>el.clientHeight));
    await main.locator('.bd-row').last().locator('.bd-more').click();
    const endMenu=await action().evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),height:innerHeight,style:el.getAttribute('style')}));
    assert.ok(endMenu.rect.bottom<=endMenu.height&&endMenu.rect.top>=0,JSON.stringify(endMenu));
    await page.keyboard.press('Escape');await main.locator('.bd-list').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.equal(await main.evaluate(el=>el.matches(':popover-open')),true,'closing the last row submenu keeps the scrolled board list open');
    assert.ok(await main.locator('.bd-footer').evaluate(el=>{const r=el.getBoundingClientRect(),m=el.parentElement.getBoundingClientRect();return r.bottom<=m.bottom&&r.top>=m.top;}));
    await page.screenshot({path:'.local/boards/menu/long-list.png'});
    await main.locator('.bd-row').last().locator('.bd-more').click();await action().waitFor();
    await main.locator('.bd-list').evaluate(el=>el.scrollTop=0);
    await page.waitForFunction(()=>!document.querySelector('.bd-actions:popover-open'));
    assert.equal(await main.evaluate(el=>el.matches(':popover-open')),true,'scroll dismisses only the submenu');
    assert.equal(state.generations,0);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('Board prompt: native resize and saved height survive board switches without overlapping characters', async () => {
  const { page, context, state, errors } = await open();
  try {
    await mkdir('.local/boards/resize', { recursive: true });
    const first = await page.evaluate(() => drawing.snapshot().activeBoardId);
    await page.locator('#prompt').fill('night station, soft light, 1girl\n'.repeat(24));
    const wrap = () => page.locator('#form .promptbox .pane:not([hidden]) .hl-wrap');
    const layout = () => page.evaluate(() => {
      const hero = document.querySelector('#form .promptbox').getBoundingClientRect();
      const input = document.querySelector('#form .promptbox .pane:not([hidden]) .hl-wrap').getBoundingClientRect();
      const characters = document.querySelector('.mc').getBoundingClientRect();
      const el = document.querySelector('#form .promptbox');
      return { width: innerWidth, resized: el.dataset.resized, flex: getComputedStyle(el).flex, rows: getComputedStyle(el).gridTemplateRows, heroBottom: hero.bottom, inputBottom: input.bottom, inputHeight: input.height, charactersTop: characters.top };
    });
    const contained = async () => {
      // Let the native resize observers and the newly mounted grid finish layout.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const bounds = await layout();
      if (bounds.inputBottom > bounds.heroBottom + 1) await page.screenshot({ path: '.local/boards/resize/overlap.png' });
      assert.ok(bounds.inputBottom <= bounds.heroBottom + 1, JSON.stringify(bounds));
      assert.ok(bounds.charactersTop - bounds.inputBottom >= 19, JSON.stringify(bounds));
    };
    const resizeTo = async height => {
      await wrap().scrollIntoViewIfNeeded();
      const box = await wrap().boundingBox();
      await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 3, box.y + height - 3, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(expected => Math.abs(document.querySelector('#form .promptbox .pane:not([hidden]) .hl-wrap').getBoundingClientRect().height - expected) <= 1, height);
      const actual = Math.round((await layout()).inputHeight);
      await page.waitForFunction(expected => services.preferences.get('koma.prefs.v1', {}).promptH === expected, actual);
      await contained();
      return actual;
    };
    await contained();
    const initialHeight = await resizeTo(260);
    await page.getByRole('button', { name: '新建空白画板', exact: true }).click();
    const second = await page.evaluate(() => drawing.snapshot().activeBoardId);
    assert.notEqual(second, first);
    await page.screenshot({ path: '.local/boards/resize/after-switch.png' });
    assert.equal(Math.round((await layout()).inputHeight), initialHeight, 'board remount restores the shared prompt height');
    const savedHeight = await resizeTo(320);
    await page.getByRole('tab', { name: /^Negative/ }).first().click();
    assert.equal(Math.round((await layout()).inputHeight), savedHeight, 'both prompt tabs share the resized height');
    await contained();
    await page.getByRole('tab', { name: /^Prompt/ }).first().click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(id => drawing.switchBoard(id), first);
      await page.waitForFunction(id => drawing.snapshot().activeBoardId === id && document.querySelector('#prompt').value.startsWith('night station'), first);
      assert.equal(Math.round((await layout()).inputHeight), savedHeight);
      await contained();
      await page.locator('#form .promptbox').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.local/boards/resize/board-${width}.png` });
      await page.evaluate(id => drawing.switchBoard(id), second);
      await page.waitForFunction(() => document.querySelector('#prompt').value === '');
      await contained();
    }
    await page.evaluate(() => { location.hash = '#/chat'; });
    await page.waitForFunction(() => !!document.querySelector('.chat-app'));
    await page.evaluate(() => { location.hash = '#/image'; });
    await page.locator('#prompt').waitFor({ state: 'visible' });
    await resizeTo(280);
    assert.equal(state.generations, 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('C1/C3 boards: approved capsule, role controls and four-width layout; copy, reload and empty board', async () => {
  const {page,context,errors}=await open();
  try {
    await mkdir('.local/multi-char/implementation/ui',{recursive:true});
    await page.evaluate(()=>{const p=document.body.__vue_app__._instance.provides;window.drawing=p[Object.getOwnPropertySymbols(p).find(s=>s.description==='drawing')];});
    await page.locator('#prompt').fill('2people, city at dusk');
    await page.getByRole('button',{name:'添加角色',exact:true}).click();
    await page.locator('#char-c1-prompt').fill('girl, red hair, white dress');
    await page.getByRole('button',{name:'添加角色',exact:true}).click();
    await page.locator('#char-c2-prompt').fill('boy, blue hair, black coat');
    await page.locator('.mc').getByRole('button',{name:'手动',exact:true}).click();
    const dot=page.locator('.mc-pad:not(.mc-pad-stage) [data-char-id=c2]');
    const before=await page.evaluate(()=>drawing.snapshot().form.characters[1].centers[0].x);
    await dot.focus();await dot.press('ArrowRight');
    assert.ok(await page.evaluate(x=>Math.abs(drawing.snapshot().form.characters[1].centers[0].x-x-.01)<.0001,before));
    await page.locator('.mc-tools').getByRole('button',{name:'上移',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>drawing.snapshot().form.characters.map(c=>c.id)),['c2','c1']);
    await page.locator('.bd-switch').click();await page.getByRole('menuitem',{name:'复制当前',exact:true}).click();
    assert.equal(await page.evaluate(()=>drawing.snapshot().boards.length),2);
    await page.locator('#prompt').fill('copy only');
    assert.equal(await page.evaluate(()=>drawing.snapshot().boards[0].form.prompt),'2people, city at dusk');
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('.bd-switch').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:`.local/multi-char/implementation/ui/board-${width}.png`});
      await page.locator('.bd-switch').click();await page.locator('#boardMenu:popover-open').waitFor();
      // The menu fits its longest row between the footer's 216px and the pill, so short names leave no empty band.
      await page.waitForFunction(()=>{const m=document.querySelector('#boardMenu').getBoundingClientRect().width,p=document.querySelector('.bd-pill').getBoundingClientRect().width;return m<=p+1&&m>=Math.min(216,p)-1;});
      assert.ok(await page.locator('#boardMenu .bd-menu-name').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth)),'short board names are never cut');
      if(width===1440)assert.ok(await page.evaluate(()=>document.querySelector('#boardMenu').getBoundingClientRect().width<document.querySelector('.bd-pill').getBoundingClientRect().width-40));
      const bounds=await page.locator('#boardMenu').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
      await page.screenshot({path:`.local/multi-char/implementation/ui/menu-${width}.png`});await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.bd-switch').click();await page.getByRole('menuitemradio',{name:/画板 1 V5/}).click();
    await page.waitForFunction(()=>document.querySelector('#prompt')?.value==='2people, city at dusk');
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await page.getByRole('button',{name:'在画面上调整',exact:true}).click();await page.locator('.mc-stage').waitFor();
      assert.ok(await page.locator('.mc-stage').evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&Math.abs(r.width/r.height-832/1216)<.01;}));
      assert.ok(await page.locator('.mc-stage-bar > .btn').evaluate(el=>{const r=el.getBoundingClientRect(),bar=el.parentElement.getBoundingClientRect();return r.x>=bar.x&&r.right<=bar.right;}));
      await page.screenshot({path:`.local/multi-char/implementation/ui/stage-${width}.png`});await page.getByRole('button',{name:'完成',exact:true}).click();
    }
    await page.reload();await page.locator('#goBtn').waitFor();
    assert.equal(await page.locator('#prompt').inputValue(),'2people, city at dusk');assert.equal(await page.locator('.mc-item').count(),2);
    await page.locator('.bd-switch').click();await page.getByRole('menuitem',{name:'新建空白',exact:true}).click();
    assert.equal(await page.locator('#prompt').inputValue(),'');assert.equal(await page.locator('.mc-item').count(),0);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('C3 generation: preflight and in-flight board switches never change request ownership or steal the stage', async () => {
  const {page,context,state,requests,errors}=await open();
  try {
    await page.evaluate(()=>{const p=document.body.__vue_app__._instance.provides;window.drawing=p[Object.getOwnPropertySymbols(p).find(s=>s.description==='drawing')];});
    await page.evaluate(async()=>{await drawing.patch({prompt:'board A',seed:'1',batchCount:1});window.sourceBoard=drawing.snapshot().activeBoardId;window.otherBoard=await drawing.createBoard(false);await drawing.patch({prompt:'board B',seed:'2'});await drawing.switchBoard(sourceBoard);});
    await page.waitForTimeout(700);
    state.holdQuota=true;state.holdAt=1;
    const run=page.evaluate(()=>drawing.run());
    for(let i=0; !state.quotaRelease && i<1000; i++) await new Promise(r=>setTimeout(r,10));
    assert.ok(state.quotaRelease);
    await page.evaluate(()=>drawing.switchBoard(otherBoard));state.quotaRelease();
    for(let i=0; !state.hold && i<1000; i++) await new Promise(r=>setTimeout(r,10));
    assert.ok(state.hold);
    await page.evaluate(()=>drawing.patch({prompt:'board B edited'}));state.hold();await run;
    const result=await page.evaluate(()=>({form:drawing.snapshot().form.prompt,current:drawing.snapshot().current,history:drawing.snapshot().history.map(h=>({prompt:h.params.basePrompt,board:h.params.boardId})),source:sourceBoard}));
    assert.equal(result.form,'board B edited');assert.equal(result.current,null);assert.deepEqual(result.history,[{prompt:'board A',board:result.source}]);
    const sent=requests.find(r=>r.path.endsWith('generate-image')).payload;assert.equal(sent.input,'board A');assert.equal(sent.parameters.seed,1);
    // Deletion during the initial preflight cancels before a paid/execute request.
    await page.evaluate(()=>drawing.switchBoard(sourceBoard));await page.waitForTimeout(300);
    state.quotaRelease=null;state.holdQuota=true;const cancelled=page.evaluate(()=>drawing.run());
    for(let i=0; !state.quotaRelease && i<1000; i++) await new Promise(r=>setTimeout(r,10));
    assert.ok(state.quotaRelease);
    await page.evaluate(()=>drawing.removeBoard(sourceBoard));state.quotaRelease();await cancelled;
    assert.equal(state.generations,1);assert.deepEqual(errors,[]);
  } finally {state.hold?.();state.quotaRelease?.();await context.close();}
});

test('C3 board management: rename, delete and backup restore keep independent forms and role identities', async () => {
  const {page,context,state,errors}=await open();
  try {
    const rename=async name=>{
      await page.locator('.bd-switch').click();await page.locator('.bd-row[data-selected="true"] .bd-more').click();await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
      await page.getByRole('textbox',{name:'画板名称',exact:true}).fill(name);
      await page.getByRole('textbox',{name:'画板名称',exact:true}).press('Enter');
      await page.waitForFunction(name=>document.querySelector('.bd-name')?.textContent===name,name);
    };
    await page.locator('#prompt').fill('2people, night city');await page.locator('#parametersToggle').click();await page.locator('#seed').fill('0');
    await page.getByRole('button',{name:'添加角色',exact:true}).click();await page.locator('#char-c1-prompt').fill('girl, red hair');
    await page.locator('.mc').getByRole('tab',{name:/Negative/}).click();await page.locator('#char-c1-negative').fill('blue hair');
    await page.locator('.mc').getByRole('button',{name:'手动',exact:true}).click();
    await rename('夜景原稿');
    await page.locator('.bd-switch').click();await page.getByRole('menuitem',{name:'复制当前',exact:true}).click();assert.equal(await page.locator('#seed').inputValue(),'0');
    await rename('第二套构图与角色配色方案 · 保留完整长名称');await page.locator('#prompt').fill('2people, morning garden');
    await page.getByRole('button',{name:'删除角色 1',exact:true}).click();await page.getByRole('button',{name:'添加角色',exact:true}).click();
    await page.locator('#char-c2-prompt').fill('boy, green hair');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('koma.prefs.v1')).boards.items[1].form.characters[0].prompt==='boy, green hair');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('koma.prefs.v1')).boards);
    assert.equal(saved.items[0].form.characters[0].negative,'blue hair');assert.equal(saved.items[1].nextCharacterId,3);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});await page.locator('.bd-switch').click();
      await page.locator('#boardMenu:popover-open').waitFor();
      assert.ok(await page.locator('#boardMenu').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;}));
      await page.screenshot({path:`.local/multi-char/implementation/ui/final-board-menu-${width}.png`});await page.keyboard.press('Escape');
    }
    await page.evaluate(()=>location.hash='#/image/settings/backup');
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出备份',exact:true}).click();
    const download=await downloading,stream=await download.createReadStream(),chunks=[];
    for await(const chunk of stream)chunks.push(chunk);
    const backup=Buffer.concat(chunks);
    await page.evaluate(()=>location.hash='#/image');await page.locator('#settingsPanel[open]').waitFor({state:'hidden'});
    await page.locator('.bd-switch').click();await page.locator('.bd-row[data-selected="true"] .bd-more').click();await page.getByRole('menuitem',{name:'删除画板',exact:true}).click();
    await page.getByRole('button',{name:'删除',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.bd-count')?.textContent==='1/1');
    await page.locator('.bd-switch').click();await page.locator('.bd-row[data-selected="true"] .bd-more').click();assert.equal(await page.getByRole('menuitem',{name:'删除画板',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');
    await page.getByRole('menuitem',{name:'新建空白',exact:true}).click();
    assert.equal(await page.locator('#seed').inputValue(),'');assert.equal(await page.locator('.mc-item').count(),0);
    await page.locator('#prompt').fill('temporary form to replace');
    await page.evaluate(()=>location.hash='#/image/settings/backup');
    await page.locator('input[accept=".zip,application/zip"]').setInputFiles({name:'boards-synthetic.zip',mimeType:'application/zip',buffer:backup});
    await page.locator('.transfer-preview').waitFor();await page.getByRole('button',{name:'导入到此站点',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.transfer-status')?.textContent.includes('导入完成'));
    assert.deepEqual(await page.evaluate(()=>({activeId:drawing.snapshot().activeBoardId,items:drawing.snapshot().boards})),saved);
    await page.evaluate(()=>location.hash='#/image');await page.locator('#settingsPanel[open]').waitFor({state:'hidden'});
    assert.equal(await page.locator('#prompt').inputValue(),'2people, morning garden');
    await page.getByRole('button',{name:'添加角色',exact:true}).click();await page.locator('#char-c3-prompt').fill('girl, blonde hair');
    await page.reload();await page.locator('#goBtn').waitFor();
    assert.equal(await page.locator('.bd-name').textContent(),saved.items[1].name);
    assert.equal(await page.locator('.mc-item').count(),2);
    await page.locator('.bd-switch').click();await page.getByRole('menuitemradio',{name:/夜景原稿/}).click();
    assert.equal(await page.locator('#prompt').inputValue(),'2people, night city');
    await page.locator('.mc').getByRole('tab',{name:/Negative/}).click();assert.equal(await page.locator('#char-c1-negative').inputValue(),'blue hair');
    assert.equal(state.generations,0);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('C3 invalid source size stops before execution', async () => {
  const {page,context,state,errors}=await open();
  try {
    state.holdQuota=true;
    const run=page.evaluate(()=>drawing.run());
    for(let i=0; !state.quotaRelease && i<1000; i++) await new Promise(r=>setTimeout(r,10));
    assert.ok(state.quotaRelease);
    await page.evaluate(()=>drawing.patch({width:4096,height:4096}));
    state.quotaRelease();await run;
    assert.equal(await page.evaluate(()=>drawing.snapshot().busy),false);
    assert.equal(await page.evaluate(()=>drawing.snapshot().state),'error');
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/画幅超出/);
    assert.equal(state.generations,0);

    assert.equal(state.generations,0);assert.deepEqual(errors,[]);
  } finally {state.quotaRelease?.();await context.close();}
});

test('C2 standard role generation: V4.5 grid/V5 coordinates, quote and native/Studio routes retain the same roles',async()=>{
  const {page,context,state,requests,errors}=await open();
  try {
    for(const model of ['nai-diffusion-4-5-full','nai-diffusion-5-full']) {
      state.cost=0;
      await page.evaluate(model=>drawing.patch({model,prompt:'2people, outdoors',placement:'manual',seed:'42',characters:[
        {id:'c1',on:true,prompt:'girl, red hair',negative:'',centers:[{x:.24,y:.76}]},
        {id:'c2',on:true,prompt:'boy, blue hair',negative:'red hair',centers:[{x:.8,y:.3}]},
        {id:'c3',on:false,prompt:'other, unused',negative:'',centers:[]}
      ]}),model);
      await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');
      const centers=model.includes('4-5')?[{x:.3,y:.7},{x:.9,y:.3}]:[{x:.24,y:.76},{x:.8,y:.3}];
      const expected=[{prompt:'girl, red hair',uc:'',center:centers[0]},{prompt:'boy, blue hair',uc:'red hair',center:centers[1]}];
      const quoted=requests.findLast(r=>r.path.endsWith('/estimate')).payload;
      assert.deepEqual(quoted.characters,expected);assert.equal(quoted.use_coords,true);assert.equal(quoted.placement,undefined);
      await page.evaluate(()=>drawing.run());
      const native=requests.findLast(r=>r.path.endsWith('generate-image')).payload;
      assert.deepEqual(native.parameters.v4_prompt.caption.char_captions,expected.map(c=>({char_caption:c.prompt,centers:[c.center]})));
      assert.deepEqual(native.parameters.v4_negative_prompt.caption.char_captions.map(c=>c.char_caption),['','red hair']);
      assert.equal(native.max_cost,0);
      const saved=await page.evaluate(()=>drawing.snapshot().history[0].params);
      assert.equal(saved.localCharacters.length,3);assert.equal(saved.characters.length,2);assert.deepEqual(saved.localCharacters[0].centers,[{x:.24,y:.76}]);
      state.cost=3;await page.evaluate(()=>drawing.patch({placement:'auto'}));await page.evaluate(()=>drawing.run());
      const studio=requests.findLast(r=>r.path.endsWith('/generate')).payload;
      assert.deepEqual(studio.characters,expected);assert.equal(studio.use_coords,false);assert.equal(studio.max_cost,3);assert.equal(studio.placement,undefined);
    }
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
