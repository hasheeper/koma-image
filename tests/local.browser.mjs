import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createLocalServer } from "../server.mjs";
import { createArchive } from "../src/storage/backup-archive.ts";
import { readBackup } from "../src/services/backup.ts";

let browser, png, zip;
const key = "synthetic-server-only-key";
const catalog = {
  studio_features: { version: 2, max_cost: true, max_context_images: 3 },
  valid_samplers: ["k_euler_ancestral", "k_euler"],
  models: {
    "nai-diffusion-5-full": {
      name: "NAI Diffusion V5 Full",
      provider: "novelai",
      max_resolution: 2200000,
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
    },
  },
};
before(async () => {
  await mkdir(".local/m7", { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#26344d";
      ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = "#b9c9e1";
      ctx.fillRect(64, 64, 256, 256);
      return canvas.toDataURL().split(",")[1];
    }),
    "base64",
  );
  await page.close();
  zip = Buffer.from(
    await (await createArchive([["image.png", new Blob([png])]])).arrayBuffer(),
  );
});
after(() => browser?.close());
const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = async (server) => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};
async function open(path = "#/image", staleVault = false) {
  const upstreamRequests = [],
    browserRequests = [],
    errors = [],
    state = { cost: 0 };
  // Real HTTP upstream and proxy: only the unrelated tag lookup is browser-mocked.
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : undefined;
    const url = new URL(req.url, "http://localhost");
    upstreamRequests.push({
      path: url.pathname,
      payload,
      headers: req.headers,
      query: url.searchParams,
    });
    const json = (data) =>
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(data));
    if (url.pathname.endsWith("/image/models")) return json(catalog);
    if (url.pathname.endsWith("/media/quota"))
      return json({
        credits: { remaining: 42 },
        images: {
          novelai: { remaining: 20, limit: 100 },
          openai: { remaining: 5, limit: 10 },
        },
      });
    if (url.pathname.endsWith("/token_stats_data"))
      return json({ temp_limits: { is_temp: false } });
    if (url.pathname.endsWith("/estimate")) return json({ cost: state.cost });
    const native = url.pathname.endsWith("/generate-image");
    res
      .writeHead(200, {
        "Content-Type": native ? "application/octet-stream" : "image/png",
      })
      .end(native ? zip : png);
  });
  const upstreamUrl = await listen(upstream);
  const local = createLocalServer({
    env: {
      KOMA_GATEWAY_URL: upstreamUrl,
      KOMA_GATEWAY_KEY: key,
      KOMA_BASE_PATH: "/app/",
    },
  });
  const origin = await listen(local);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await context.addInitScript((stale) => {
    if (location.protocol === "about:") return;
    localStorage.setItem(
      "koma.prefs.v1",
      JSON.stringify({ tagSuggest: false }),
    );
    if (stale)
      localStorage.setItem(
        "koma.vault.v2",
        JSON.stringify({
          v: 2,
          kdf: "PBKDF2-SHA256",
          iterations: 210000,
          salt: "AA==",
          iv: "AA==",
          ct: "AA==",
        }),
      );
  }, staleVault);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()))
      browserRequests.push({ url: r.url(), headers: r.headers() });
  });
  await context.route("https://tagsuggest.zeabur.app/**", (route) =>
    route.fulfill({ json: { results: [] } }),
  );
  await page.goto(origin + "/app/" + path);
  await page.waitForSelector("[data-workspace-root]");
  return {
    page,
    context,
    state,
    origin,
    upstreamUrl,
    upstreamRequests,
    browserRequests,
    errors,
    async close() {
      await context.close();
      await close(local);
      await close(upstream);
      assert.deepEqual(errors, []);
    },
  };
}
async function route(page, hash) {
  await page.evaluate((hash) => (location.hash = hash), hash);
}
async function download(page, button) {
  const pending = page.waitForEvent("download");
  await button.click();
  return readFile(await (await pending).path());
}
async function assertPrivate(t) {
  const stored = await t.page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  const html = await t.page.content();
  for (const value of [key, t.upstreamUrl]) {
    assert.equal(stored.includes(value), false);
    assert.equal(html.includes(value), false);
    assert.equal(JSON.stringify(t.browserRequests).includes(value), false);
  }
  assert.ok(
    t.browserRequests.every(
      (r) =>
        new URL(r.url).origin === t.origin ||
        r.url.startsWith("https://tagsuggest.zeabur.app/"),
    ),
  );
  assert.equal(await t.page.locator("#gate[open]").count(), 0);
}

test("M7 production local settings: readonly credentials, isolated model preferences, backup roundtrip and four viewports", async () => {
  const t = await open("#/image/settings/connections", true),
    p = t.page;
  try {
    await p.waitForFunction(
      () => document.querySelector(".conn-row .st")?.dataset.s === "ok",
    );
    assert.equal(
      await p.getByRole("button", { name: "添加连接", exact: true }).count(),
      0,
    );
    assert.equal(
      await p.getByRole("button", { name: "修改地址", exact: true }).count(),
      0,
    );
    assert.equal(
      await p
        .getByRole("button", { name: "配置或解锁 Key", exact: true })
        .count(),
      0,
    );
    assert.equal(await p.getByText("本机同源代理", { exact: true }).count(), 1);
    await p.getByRole("button", { name: "测试连接", exact: true }).click();
    await p.waitForFunction(
      () => document.querySelector(".conn-row .st")?.dataset.s === "ok",
    );
    for (const width of [320, 390, 768, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      for (const section of ["connections", "security"]) {
        await route(p, `#/image/settings/${section}`);
        await p.waitForTimeout(100);
        assert.ok(
          await p
            .locator("#settingsPanel")
            .evaluate((el) => el.scrollWidth <= innerWidth + 1),
        );
        await p.screenshot({ path: `.local/m7/${section}-${width}.png` });
      }
    }
    await route(p, "#/image/settings/models");
    await p
      .getByRole("button", { name: "展开 GPT Image 2 的来源", exact: true })
      .click();
    await p
      .getByRole("button", { name: "移除 本地网关 来源", exact: true })
      .click();
    await p.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("koma.local.models.v1"))?.[
          "gpt-image-2"
        ]?.on === false,
    );
    await p.reload();
    await p.waitForSelector("#settingsPanel[open]");
    await route(p, "#/image/settings/backup");
    const config = await download(
      p,
      p.getByRole("button", { name: "导出", exact: true }),
    );
    const parsed = JSON.parse(config);
    assert.equal(parsed.kind, "local-models");
    assert.equal(parsed.links["gpt-image-2"].on, false);
    assert.equal(parsed.connections, undefined);
    const bytes = await download(
      p,
      p.getByRole("button", { name: "导出备份", exact: true }),
    );
    const backup = await readBackup(new Blob([bytes]));
    assert.deepEqual(JSON.parse(backup.preferences.localModels), parsed.links);
    assert.equal(backup.preferences.routing, undefined);
    const token = await p.locator("#koma-runtime").textContent();
    for (const secret of [key, t.upstreamUrl, JSON.parse(token).token]) {
      assert.equal(bytes.includes(Buffer.from(secret)), false);
      assert.equal(config.includes(Buffer.from(secret)), false);
    }
    // Both the settings import and the complete backup restore only model mappings.
    parsed.links["gpt-image-2"].on = true;
    await p
      .locator('input[accept=".json,application/json"]')
      .setInputFiles({
        name: "models.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(parsed)),
      });
    await p.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("koma.local.models.v1"))["gpt-image-2"]
          .on === true,
    );
    await p
      .locator('input[accept=".zip,application/zip"]')
      .setInputFiles({
        name: "backup.zip",
        mimeType: "application/zip",
        buffer: bytes,
      });
    await p.waitForSelector(".transfer-preview");
    await p.getByRole("button", { name: "导入到此站点", exact: true }).click();
    await p.waitForFunction(() =>
      document
        .querySelector(".transfer-status")
        .textContent.includes("导入完成"),
    );
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("koma.local.models.v1"))[
            "gpt-image-2"
          ].on,
      ),
      false,
    );
    await assertPrivate(t);
  } finally {
    await t.close();
  }
});

test("M7 production local execution: native/Studio/tool routes, fresh max_cost, original bytes, chat and editor", async () => {
  const t = await open(),
    p = t.page;
  try {
    await p.waitForFunction(() =>
      document.querySelector("#goCost")?.textContent.includes("免费"),
    );
    await p.locator("#prompt").fill("local synthetic drawing");
    const run = async () => {
      await p.locator("#goBtn").click();
      await p.waitForFunction(
        () =>
          document.body.dataset.state === "done" &&
          document.querySelector("#form").getAttribute("aria-busy") === "false",
      );
    };
    await run();
    const native = t.upstreamRequests.find((r) =>
      r.path.endsWith("generate-image"),
    );
    assert.equal(native.payload.max_cost, 0);
    assert.equal(native.headers["x-media-provider"], "novelai");
    t.state.cost = 2;
    await run();
    const studio = t.upstreamRequests.find((r) => r.path.endsWith("/generate"));
    assert.equal(studio.payload.max_cost, 2);
    assert.equal(
      t.upstreamRequests.filter((r) => /\/generate(?:-image)?$/.test(r.path))
        .length,
      2,
    );
    await p.locator("#favoriteBtn").click();
    await p.waitForFunction(
      () =>
        document.querySelector("#favoriteBtn").getAttribute("aria-pressed") ===
        "true",
    );
    await p.locator("#editBtn").click();
    await p.waitForSelector("#imageEditor[open]");
    await p.locator("#editorPrompt").fill("local synthetic edit");
    await p.locator("#editorRun").click();
    await p.waitForFunction(
      () =>
        document.querySelectorAll("[data-version-id]").length === 2 &&
        !document.querySelector("#editorRun").disabled,
    );
    assert.equal(
      t.upstreamRequests.find((r) => r.path.endsWith("/tools/run")).payload
        .max_cost,
      2,
    );
    await p.locator("#imageEditor .editor-back").click();
    await route(p, "#/chat");
    await p.locator("#chatPrompt").fill("local synthetic chat");
    await p.getByRole("button", { name: "发送绘图请求", exact: true }).click();
    await p.waitForSelector(".chat-turn .chat-print img");
    await p.waitForFunction(
      () =>
        !document.querySelector("#chatPrompt").disabled &&
        document.querySelectorAll(".chat-turn img").length > 0,
    );
    await route(p, "#/chat/settings/backup");
    const bytes = await download(
      p,
      p.getByRole("button", { name: "导出备份", exact: true }),
    );
    const backup = await readBackup(new Blob([bytes]));
    assert.equal(backup.favorites.length, 1);
    assert.deepEqual(
      Buffer.from(await backup.favorites[0].blob.arrayBuffer()),
      png,
    );
    assert.equal(backup.conversations.length, 1);
    assert.ok(backup.assets.length >= 1);
    for (const r of t.upstreamRequests) {
      if (r.path.endsWith("/token_stats_data"))
        assert.equal(r.query.get("api_key"), key);
      else assert.equal(r.headers.authorization, `Bearer ${key}`);
      assert.equal(r.headers["x-koma-local-token"], undefined);
    }
    await assertPrivate(t);
  } finally {
    await t.close();
  }
});
