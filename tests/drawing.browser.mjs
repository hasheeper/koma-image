import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
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
        JSON.stringify({ tagSuggest: false }),
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
  await page.goto(origin);
  await page.waitForFunction(
    () => document.querySelector("#model")?.options.length === 2,
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

test("M4 quota restrictions remember requested batch; native-free exception, strict limits and restored preferences", async () => {
  const t = await open({ cost: 2, left: 299 }),
    p = t.page;
  try {
    await patch(t, { batchCount: 5 });
    assert.equal(await p.locator("#batchCount").inputValue(), "1");
    assert.equal(await p.locator("#batchCount").isDisabled(), true);
    await run(t);
    assert.equal(t.state.generations, 1);
    t.state.left = 300;
    await p.evaluate(() => drawing.refreshQuota(true));
    assert.equal(await p.locator("#batchCount").inputValue(), "5");
    assert.equal(await p.locator("#batchCount").isDisabled(), false);
    t.state.left = 1;
    t.state.cost = 0;
    await patch(t, { seed: "1" });
    await p.waitForFunction(() => drawing.snapshot().quote.quote?.cost === 0);
    await p.evaluate(() => drawing.refreshQuota(true));
    assert.equal(await p.locator("#batchCount").isDisabled(), false);
    await patch(t, { width: 2048, height: 2048 });
    assert.equal(await p.locator("#goBtn").isDisabled(), true);
    await patch(t, {
      width: 832,
      height: 1216,
      model: "nai-diffusion-4-5-full",
      transparentBg: true,
    });
    assert.equal(await p.locator("#transparentBg").isDisabled(), true);
    assert.equal(await p.locator("#transparentBg").isChecked(), true);
    await p.reload();
    await p.waitForSelector("#width");
    assert.equal(await p.locator("#width").inputValue(), "832");
    assert.equal(await p.locator("#transparentBg").isChecked(), true);
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
      const url = getComputedStyle(el).backgroundImage.slice(5, -2);
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
      await services.data.write(async () => {
        const tx = services.databases.transaction(
          names.databases.favorites, "favorites", "readwrite",
        );
        for (let i = 2; i < 16; i++)
          tx.objectStore("favorites").put({ ...favorite, id: `preview-${i}` });
        await transactionDone(tx);
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
    await second.goto(origin);
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
