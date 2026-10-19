import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";
import { createArchive } from "../src/storage/backup-archive.ts";
let browser, server, origin;
const output = ".local/m3";
const tags = Array.from({ length: 26 }, (_, i) => ({
  name: i === 0 ? "blue_hair" : `blue_tag_${i}`,
  cn_name: i === 0 ? "蓝发" : `测试 ${i}`,
  category: 0,
  count: 10000 - i,
}));
const catalog = {
  studio_features: { version: 2, max_cost: true },
  models: {
    "gpt-image-2": {
      name: "GPT Image 2",
      editor_family: "gpt",
      operations: ["generate", "edit"],
    },
    "custom-image": {
      name: "Custom",
      editor_family: "gpt",
      operations: ["generate"],
    },
  },
};
before(async () => {
  await mkdir(output, { recursive: true });
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
async function open(path = "/") {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    requests.push({
      url: url.href,
      method: route.request().method(),
      auth: route.request().headers().authorization,
    });
    if (url.host === "tagsuggest.zeabur.app")
      return route.fulfill({ json: { results: tags } });
    if (url.host === "gateway.example.test") {
      if (url.pathname.endsWith("/image/models"))
        return route.fulfill({ json: catalog });
      if (url.pathname.endsWith("/media/quota"))
        return route.fulfill({
          json: {
            credits: { remaining: 0 },
            images: { openai: { remaining: 12, limit: 20 } },
          },
        });
      if (url.pathname.endsWith("/token_stats_data"))
        return route.fulfill({ json: {} });
    }
    errors.push(`unexpected request: ${url.host}${url.pathname}`);
    return route.abort();
  });
  await page.goto(origin + path);
  await page.waitForSelector("[data-workspace-root]");
  return { context, page, errors, requests };
}
async function clean(t) {
  assert.deepEqual(t.errors, []);
  await t.context.close();
}
async function route(page, hash) {
  await page.evaluate((hash) => (location.hash = hash), hash);
}
async function settings(page, section = "connections") {
  await route(page, `#/image/settings/${section}`);
  await page.waitForSelector("#settingsPanel[open]");
}
async function addConnection(page, encrypted = false) {
  await settings(page);
  await page.getByRole("button", { name: "添加连接", exact: true }).click();
  await page.locator("#connectionName").fill("测试连接");
  await page.locator("#connectionUrl").fill("https://gateway.example.test");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.waitForSelector("#gate[open]");
  await page.locator("#setupKey").fill("synthetic-key-123");
  if (encrypted) {
    await page.locator("#setupPass").fill("test-passphrase");
    await page.locator("#setupPass2").fill("test-passphrase");
  } else
    await page.locator("#gate label").filter({ hasText: "不保存" }).click();
  await page
    .locator("#gate")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.waitForSelector("#gate[open]", { state: "hidden" });
  await page.waitForFunction(
    () => document.querySelector(".conn-row .st")?.dataset.s === "ok",
  );
}

test("settings: empty network default, connection/key input, model source controls, persistence and encryption lock", async () => {
  const t = await open();
  try {
    const { page } = t;
    assert.equal(t.requests.length, 0);
    await addConnection(page, true);
    assert.ok(t.requests.length >= 3);
    assert.ok(t.requests.every((r) => r.method === "GET"));
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("koma.vault.v2").includes("synthetic-key"),
      ),
      false,
    );
    await page.getByRole("button", { name: "模型列表", exact: true }).click();
    await page.waitForSelector("#modelListDialog[open]");
    await page.getByRole("searchbox", { name: "搜索模型" }).fill("custom");
    assert.equal(await page.locator("#modelListDialog .md-row").count(), 1);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".set-nav button").filter({ hasText: "模型" }).click();
    await page
      .getByRole("button", { name: "展开 GPT Image 2 的来源", exact: true })
      .click();
    await page
      .getByRole("button", { name: "移除 测试连接 来源", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Object.values(
          JSON.parse(localStorage.getItem("koma.routing.v1")).links,
        )[0]?.["gpt-image-2"]?.on === false,
    );
    await page
      .getByRole("button", { name: "添加 测试连接 来源", exact: true })
      .click();
    await page.getByRole("button", { name: "安全与备份", exact: true }).click();
    await page.getByRole("button", { name: "立即锁定", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#gate").open);
    assert.equal(
      await page
        .getByRole("button", { name: "导出备份", exact: true })
        .isVisible(),
      true,
    );
    await page.getByRole("button", { name: "解锁", exact: true }).click();
    await page.waitForSelector("#gate[open]");
    await page.locator("#unlockPass").fill("wrong");
    await page
      .locator("#gate")
      .getByRole("button", { name: "解锁", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector("#gate .note").textContent.includes("不正确"),
    );
    await page.locator("#unlockPass").fill("test-passphrase");
    await page
      .locator("#gate")
      .getByRole("button", { name: "解锁", exact: true })
      .click();
    await page.waitForSelector("#gate[open]", { state: "hidden" });
    await page.reload();
    await page.waitForSelector("#settingsPanel[open]");
    assert.equal(await page.locator("#gate[open]").count(), 0);
    await clean(t);
  } catch (e) {
    await t.page.screenshot({ path: `${output}/failure-settings.png` });
    await t.context.close();
    throw e;
  }
});

test("dictionary and prompt: weighted handoff once, picker toggle, highlight, autocomplete, IME and unload on disable", async () => {
  const t = await open();
  try {
    const { page } = t;
    await page.locator("#prompt").fill("original,\n{kept}");
    await route(page, "#/tags");
    await page.locator("#tagSearch").fill("blue");
    await page.waitForSelector(".tag-card");
    await page.locator(".tag-add").first().click();
    await page
      .getByRole("spinbutton", { name: "blue_hair 权重", exact: true })
      .fill("1.4");
    await page
      .getByRole("spinbutton", { name: "blue_hair 权重", exact: true })
      .blur();
    assert.equal(
      await page.locator("#tagCartPrompt").textContent(),
      "1.4::blue hair::",
    );
    await page
      .getByRole("button", { name: "应用到生成器", exact: true })
      .click();
    await page.waitForSelector("#confirmSheet[open]");
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "original,\n{kept}",
    );
    await page.getByRole("button", { name: "插入", exact: true }).click();
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "original,\n{kept}, 1.4::blue hair::",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("koma.tag.handoff.v1")),
      null,
    );
    await route(page, "#/tags");
    await route(page, "#/image");
    assert.equal(await page.locator("#confirmSheet[open]").count(), 0);
    await page.getByRole("button", { name: "查词插入", exact: true }).click();
    await page.locator("#pickerSearch").fill("blue");
    await page.waitForSelector(".picker-row");
    await page.locator(".picker-row").first().click();
    assert.ok(
      (await page.locator("#prompt").inputValue()).endsWith(", blue hair"),
    );
    await page.locator(".picker-row").first().click();
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "original,\n{kept}, 1.4::blue hair::",
    );
    await page.keyboard.press("Escape");
    await page.waitForSelector("#pickerSheet", { state: "hidden" });
    await page.locator("#prompt").fill("blue h");
    await page.waitForSelector(
      ".tag-suggest:not([hidden]) .tag-suggest-option",
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#prompt").inputValue(), "blue hair, ");
    await page.locator("#prompt").fill("<img src=x onerror=alert(1)>, {blue}");
    assert.equal(await page.locator(".hl-mirror img").count(), 0);
    assert.ok((await page.locator(".hl-mirror span").count()) > 0);
    assert.equal(await page.locator("#settingsPrefs").count(), 0);
    await settings(page, "general");
    await page.locator('label[for="tagSuggest"]').click();
    await route(page, "#/image");
    const n = t.requests.length;
    await page.locator("#prompt").fill("unique disabled");
    await page.waitForTimeout(350);
    assert.equal(t.requests.length, n);
    assert.equal(
      await page.locator("#prompt").getAttribute("aria-autocomplete"),
      null,
    );
    await settings(page, "general");
    await page.locator('label[for="tagSuggest"]').click();
    await route(page, "#/image");
    await page.locator("#prompt").focus();
    await page.locator("#prompt").evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart"));
      el.value = "蓝";
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, isComposing: true }),
      );
    });
    const before = t.requests.length;
    await page.waitForTimeout(350);
    assert.equal(t.requests.length, before);
    await page
      .locator("#prompt")
      .evaluate((el) =>
        el.dispatchEvent(
          new CompositionEvent("compositionend", { data: "蓝" }),
        ),
      );
    await page.waitForSelector(".tag-suggest:not([hidden])");
    // Shared preferences remain available outside the drawing workspace.
    await route(page, "#/chat/settings/general");
    await page.waitForSelector('section[aria-label="通用"]', {
      state: "visible",
    });
    await page.locator('label[for="localCache"]').click();
    assert.equal(await page.locator("#historyLimit").isDisabled(), true);
    assert.equal(await page.locator("#historyLimit").inputValue(), "1");
    await page.locator('label[for="localCache"]').click();
    assert.equal(await page.locator("#historyLimit").inputValue(), "25");
    await page.locator("#historyLimit").fill("0");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("koma.prefs.v1")).historyLimit === 0,
    );
    await page.reload();
    await page.waitForSelector("#historyLimit");
    assert.equal(await page.locator("#historyLimit").inputValue(), "0");
    assert.equal(await page.locator("#localCache").isChecked(), true);
    await clean(t);
  } catch (e) {
    await t.page.screenshot({ path: `${output}/failure-tags.png` });
    await t.context.close();
    throw e;
  }
});

test("backup UI works without keys, validates file before import and exports version 2 without secrets", async () => {
  const t = await open("/#/image/settings/backup");
  try {
    const { page } = t;
    const manifest = {
      app: "koma-image",
      kind: "backup",
      version: 2,
      id: "12345678-1234-1234-1234-123456789012",
      createdAt: "2026-10-19T00:00:00Z",
      favorites: [],
      assets: [],
      conversations: [],
      preferences: {
        tagCart: JSON.stringify([{ name: "blue_hair", weight: 1.5 }]),
      },
    };
    const zip = await createArchive([
      ["koma-image-backup.json", new Blob([JSON.stringify(manifest)])],
    ]);
    // Hold the first archive read to exercise actual busy navigation guards.
    await page.evaluate(() => {
      const original = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        const blob = this;
        Blob.prototype.arrayBuffer = original;
        return new Promise((resolve) => {
          window.finishBackupRead = async () =>
            resolve(await original.call(blob));
        });
      };
    });
    await page.locator('input[accept=".zip,application/zip"]').setInputFiles({
      name: "synthetic.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(await zip.arrayBuffer()),
    });
    await page.waitForFunction(() => Boolean(window.finishBackupRead));
    await route(page, "#/chat");
    await page.waitForFunction(
      () => location.hash === "#/image/settings/backup",
    );
    assert.equal(await page.locator("#settingsPanel[open]").count(), 1);
    assert.equal(await page.locator("[data-workspace-root=image]").count(), 1);
    await page.evaluate(() => window.finishBackupRead());
    await page.waitForSelector(".transfer-preview");
    await page
      .getByRole("button", { name: "导入到此站点", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".transfer-status")
        .textContent.includes("导入完成"),
    );
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("koma.tag.cart.v1"))[0].weight,
      ),
      1.5,
    );
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出备份", exact: true }).click();
    const download = await downloading;
    assert.match(download.suggestedFilename(), /^koma-image-backup-.*\.zip$/);
    await download.saveAs(`${output}/synthetic-backup.zip`);
    const old = { ...manifest, version: 1 };
    const invalid = await createArchive([
      ["koma-image-backup.json", new Blob([JSON.stringify(old)])],
    ]);
    await page.locator('input[accept=".zip,application/zip"]').setInputFiles({
      name: "unsupported.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(await invalid.arrayBuffer()),
    });
    await page.waitForFunction(
      () => document.querySelector(".transfer-status").dataset.tone === "error",
    );
    assert.equal(await page.locator(".transfer-preview").count(), 0);
    assert.equal(t.requests.length, 0);
    await clean(t);
  } catch (e) {
    await t.context.close();
    throw e;
  }
});

test("four viewport inspection of settings, dictionary/cart and picker", async () => {
  const t = await open();
  try {
    const { page } = t;
    await addConnection(page);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await settings(page);
      await page.screenshot({ path: `${output}/connections-${width}.png` });
      await page
        .getByRole("button", { name: "安全与备份", exact: true })
        .click();
      assert.ok(
        await page
          .locator("#settingsPanel")
          .evaluate((el) => el.scrollWidth <= innerWidth + 1),
      );
      await page.screenshot({ path: `${output}/backup-${width}.png` });
      await page.getByRole("button", { name: "通用", exact: true }).click();
      assert.ok(
        await page
          .locator("#settingsPanel")
          .evaluate((el) => el.scrollWidth <= innerWidth + 1),
      );
      await page.screenshot({ path: `${output}/general-${width}.png` });
      await route(page, "#/tags");
      await page.locator("#tagSearch").fill("blue");
      await page.waitForSelector(".tag-card");
      if (!(await page.locator(".tag-cart-item").count()))
        await page.locator(".tag-add").first().click();
      await page.screenshot({ path: `${output}/tags-${width}.png` });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      if (width <= 860) {
        await page
          .getByRole("button", { name: "打开 Prompt 组合", exact: true })
          .click();
        await page.screenshot({ path: `${output}/cart-${width}.png` });
        await page
          .getByRole("button", { name: "关闭组合侧栏", exact: true })
          .first()
          .click();
      }
      await route(page, "#/image");
      await page.getByRole("button", { name: "查词插入", exact: true }).click();
      await page.locator("#pickerSearch").fill("blue");
      await page.waitForSelector(".picker-row");
      await page.screenshot({ path: `${output}/picker-${width}.png` });
      await page.keyboard.press("Escape");
      await page.waitForSelector("#pickerSheet", { state: "hidden" });
    }
    await clean(t);
  } catch (e) {
    await t.context.close();
    throw e;
  }
});
