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
async function open(path = "/#/image", options = {}) {
  if (!path.includes("#") && !path.includes("transfer.html")) path += "#/image";
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
  if (options.connections)
    await context.addInitScript(({ connections, keys }) => {
      if (localStorage.getItem("koma.routing.v1")) return;
      localStorage.setItem("koma.routing.v1", JSON.stringify({
        version: 1, connections, links: {},
      }));
      if (keys) sessionStorage.setItem("koma.session.keys", JSON.stringify(keys));
    }, { connections: options.connections, keys: options.keys });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    requests.push({
      url: url.href,
      method: route.request().method(),
      auth: route.request().headers().authorization,
    });
    if (url.host === "tagsuggest.zeabur.app" && url.pathname === "/api/tags/suggest")
      return route.fulfill({ json: { results: tags } });
    if (url.host === "gateway.example.test") {
      if (url.pathname.endsWith("/image/models"))
        return options.catalogResponse
          ? options.catalogResponse(route)
          : route.fulfill({ json: catalog });
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
  if (!options.keepStartup && !options.connections && !path.includes("/settings/")) {
    await page.waitForSelector("#settingsPanel[open]");
    await page.locator("#settingsPanel .set-back").click();
    await page.waitForSelector("#settingsPanel[open]", { state: "hidden" });
  }
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
// Card actions other than testing live in the card's ⋯ menu.
async function connectionAction(page, name, card = page.locator("#settingsPanel .conn-card").first()) {
  await card.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.locator(".conn-menu:popover-open").getByRole("menuitem", { name, exact: true }).click();
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
    () => document.querySelector(".conn-card .st")?.dataset.s === "ok",
  );
}

const startupConnection = {
  id: "startup",
  name: "测试供应商",
  baseUrl: "https://gateway.example.test",
  profileId: "koma-standard-v1",
  credentialRef: "startup-key",
  revision: "startup-rev",
};
const successNotice = '.toast[data-tone="ok"]:has-text("已连接")';

test("startup: empty configuration opens connections once, with no requests or Key prompt", async () => {
  const t = await open("/", { keepStartup: true });
  try {
    const { page } = t;
    await page.waitForSelector("#settingsPanel[open]");
    assert.match(page.url(), /settings\/connections$/);
    assert.equal(await page.locator("#gate[open]").count(), 0);
    assert.equal(t.requests.length, 0);
    await page.locator("#settingsPanel .set-back").click();
    await page.waitForSelector("#settingsPanel[open]", { state: "hidden" });
    for (const hash of ["#/chat", "#/tags", "#/image"])
      await route(page, hash);
    await page.waitForSelector("#prompt");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(t.requests.length, 0);
    await clean(t);
  } finally { await t.context.close(); }
});

test("startup: restored Key automatically connects, progress is replaced by the result, and renames stay silent", async () => {
  let release;
  const options = {
    connections: { startup: startupConnection },
    keys: { "startup-key": "synthetic-startup-key" },
    catalogResponse: async (route) => {
      await new Promise((resolve) => { release = resolve; });
      return route.fulfill({ json: catalog });
    },
  };
  const t = await open("/", options);
  try {
    const { page } = t;
    await page.waitForSelector('.toast[data-tone="load"]');
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.locator(".toast-timer").count(), 0);
    assert.equal(await page.locator('.toast[aria-busy="true"]').count(), 1);
    assert.equal(t.requests.length, 1);
    assert.equal(t.requests[0].auth, "Bearer synthetic-startup-key");
    options.catalogResponse = (route) => route.fulfill({ json: catalog });
    release();
    await page.waitForSelector(successNotice);
    assert.equal(await page.locator(".toast").count(), 1);
    assert.match(await page.locator(successNotice).textContent(), /测试供应商 · 2 个模型/);
    await page.reload();
    await page.waitForSelector(successNotice);
    assert.equal(t.requests.length, 2, "one automatic catalog request per document");
    // A rename changes the config revision but must not announce a new connection.
    await settings(page);
    await connectionAction(page, "编辑连接…");
    await page.locator("#connectionName").fill("新名称");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document.querySelector(".conn-name b")?.textContent === "新名称" &&
      document.querySelector(".conn-card .st")?.dataset.s === "ok",
    );
    assert.equal(await page.locator('.toast[data-tone="load"]').count(), 0);
    assert.equal(await page.locator('.toast:has-text("已连接 新名称")').count(), 0);
    assert.ok(t.requests.every((r) => r.method === "GET"));
    await clean(t);
  } finally { release?.(); await t.context.close(); }
});

test("startup: incompatible connection reports failure; manual test shows progress and a fresh result", async () => {
  let release;
  const options = {
    connections: { startup: startupConnection },
    keys: { "startup-key": "synthetic-startup-key" },
    catalogResponse: (route) => route.fulfill({ json: { models: {} } }),
  };
  const t = await open("/", options);
  try {
    const { page } = t;
    const failure = page.locator('.toast[data-tone="err"]');
    await failure.waitFor();
    assert.match(await failure.textContent(), /连接 测试供应商 失败/);
    assert.equal(await page.locator('.toast[data-tone="load"]').count(), 0);
    await failure.getByRole("button", { name: "设置", exact: true }).click();
    await page.waitForSelector("#settingsPanel[open]");
    await page.waitForFunction(() => document.querySelector(".conn-card .st")?.dataset.s === "err");
    options.catalogResponse = async (route) => {
      await new Promise((resolve) => { release = resolve; });
      return route.fulfill({ json: catalog });
    };
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await page.waitForSelector('#settingsPanel .toast[data-tone="load"]');
    options.catalogResponse = (route) => route.fulfill({ json: catalog });
    release();
    await page.waitForSelector('.toast[data-tone="ok"]:has-text("可用，共 2 个模型")');
    assert.equal(await page.locator('.toast[data-tone="load"]').count(), 0);
    assert.ok(t.requests.every((r) => r.method === "GET"));
    await clean(t);
  } finally { release?.(); await t.context.close(); }
});

test("startup: saved URL without Key prompts setup, partial connections are reported, and backup stays accessible", async () => {
  const t = await open("/", {
    connections: { startup: startupConnection },
  });
  try {
    const { page } = t;
    await page.waitForSelector("#gate[open] #setupKey");
    assert.equal(t.requests.length, 0);
    await page.getByRole("button", { name: "返回设置", exact: true }).click();
    await page.waitForSelector("#settingsPanel[open]");
    await page.locator("#settingsPanel .set-back").click();
    await page.waitForSelector("#settingsPanel[open]", { state: "hidden" });
    await page.evaluate(() => {
      const routing = JSON.parse(localStorage.getItem("koma.routing.v1"));
      routing.connections.missing = {
        ...routing.connections.startup, id: "missing", credentialRef: "missing-key",
      };
      localStorage.setItem("koma.routing.v1", JSON.stringify(routing));
      sessionStorage.setItem("koma.session.keys", JSON.stringify({ "startup-key": "synthetic-startup-key" }));
    });
    await page.reload();
    await page.waitForSelector('.toast[data-tone="warn"]:has-text("1 个待配置 Key")');
    assert.equal(await page.locator("#gate[open]").count(), 0);
    assert.equal(t.requests.length, 1, "missing Key never reaches the network");
    await route(page, "#/image/settings/backup");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.waitForSelector('#settingsPanel[open] button[aria-label="导出备份"]');
    assert.equal(await page.locator("#gate[open]").count(), 0);
    assert.equal(t.requests.length, 1);
    await clean(t);
  } finally { await t.context.close(); }
});

test("startup: locked vault makes no requests and connects immediately after unlock", async () => {
  const t = await open();
  try {
    const { page } = t;
    await addConnection(page, true);
    assert.match(await page.locator(".conn-card .connection-avatar use").getAttribute("href"), /#i-image$/);
    await page.locator("#settingsPanel .set-back").click();
    await page.waitForSelector("#settingsPanel[open]", { state: "hidden" });
    await page.evaluate(() => sessionStorage.clear());
    const before = t.requests.length;
    await page.reload();
    await page.waitForSelector("#gate[open] #unlockPass");
    assert.equal(t.requests.length, before);
    await page.locator("#unlockPass").fill("test-passphrase");
    await page.locator("#gate").getByRole("button", { name: "解锁", exact: true }).click();
    await page.waitForSelector(successNotice);
    assert.equal(await page.locator("#gate[open]").count(), 0);
    assert.equal(t.requests.length, before + 1);
    assert.ok(t.requests.every((r) => r.method === "GET"));
    await clean(t);
  } finally { await t.context.close(); }
});

test("startup: changing the address during a check suppresses the obsolete result", async () => {
  let release, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const t = await open("/", {
    connections: { startup: startupConnection },
    keys: { "startup-key": "synthetic-startup-key" },
    catalogResponse: async (route) => {
      if (!route.request().url().includes("/changed/")) {
        await new Promise((resolve) => { release = resolve; started(); });
        return route.fulfill({ json: { models: {} } });
      }
      return route.fulfill({ json: catalog });
    },
  });
  try {
    const { page } = t;
    await waiting;
    await page.waitForSelector('.toast[data-tone="load"]');
    await page.evaluate(() => {
      const routing = JSON.parse(localStorage.getItem("koma.routing.v1"));
      Object.assign(routing.connections.startup, {
        name: "新连接", baseUrl: "https://gateway.example.test/changed", revision: "changed-rev",
      });
      localStorage.setItem("koma.routing.v1", JSON.stringify(routing));
      dispatchEvent(new StorageEvent("storage", { key: "koma.routing.v1" }));
    });
    await page.waitForSelector(`${successNotice}:has-text("新连接")`);
    release();
    assert.equal(await page.locator('.toast[data-tone="load"], .toast[data-tone="err"]').count(), 0);
    assert.equal(await page.locator(".toast").count(), 1);
    assert.equal(t.requests.length, 2);
    assert.ok(t.requests.every((r) => r.method === "GET"));
    await clean(t);
  } finally { release?.(); await t.context.close(); }
});

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
    await page.locator("#settingsPanel .conn-models").click();
    await page.waitForSelector("#modelListDialog[open]");
    assert.match(await page.locator("#modelListDialog .connection-avatar use").getAttribute("href"), /#i-image$/);
    await page.getByRole("searchbox", { name: "搜索模型" }).fill("custom");
    assert.equal(await page.locator("#modelListDialog .md-row").count(), 1);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".set-nav button").filter({ hasText: "模型" }).click();
    await page
      .getByRole("button", { name: "展开 GPT Image 2 的来源", exact: true })
      .click();
    assert.match(await page.locator(".sm-lines .cm use").getAttribute("href"), /#i-image$/);
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

test("settings: source edits and sorting preserve lists, focus and catalogs; refresh and endpoint edits stay local", async () => {
  const c = (id, name) => ({ ...startupConnection, id, name, baseUrl: `https://gateway.example.test/${id}`, credentialRef: `${id}-key` });
  const t = await open("/#/image/settings/connections", {
    connections: { first: c("first", "第一连接"), second: c("second", "第二连接") },
    keys: { "first-key": "synthetic-first", "second-key": "synthetic-second" },
  });
  const catalogs = () => t.requests.filter(r => r.url.endsWith("/image/models"));
  const settle = () => t.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    const { page } = t;
    await page.waitForFunction(() => document.querySelectorAll('.conn-card .st[data-s="ok"]').length === 2);
    const before = catalogs().length;
    await page.getByRole("button", { name: "提高 第二连接 的优先级", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.routing.v1")).order?.[0] === "second");
    await settle();
    assert.equal(catalogs().length, before, "sorting reuses raw catalogs");
    assert.equal(await page.locator('.conn-card .st[data-s="wait"]').count(), 0);
    await settings(page, "models");
    await page.getByRole("button", { name: "展开 GPT Image 2 的来源", exact: true }).click();
    await page.evaluate(() => {
      window.originalModelList = document.querySelector('#settingsPanel .sm');
      window.originalSourceButton = [...document.querySelectorAll('.sm-line button')].find(b => b.getAttribute('aria-label') === '移除 第一连接 来源');
    });
    await page.getByRole("button", { name: "移除 第一连接 来源", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.routing.v1")).links.first?.["gpt-image-2"]?.on === false);
    await settle();
    assert.equal(await page.evaluate(() => originalModelList === document.querySelector('#settingsPanel .sm') && originalSourceButton.isConnected && document.activeElement === originalSourceButton), true);
    await page.getByRole("button", { name: "添加 第一连接 来源", exact: true }).click();
    await page.getByRole("button", { name: "移除 第二连接 来源", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.routing.v1")).links.second?.["gpt-image-2"]?.on === false);
    await settle();
    assert.equal(catalogs().length, before, "source switches never re-fetch every provider");
    assert.equal(await page.evaluate(() => originalModelList === document.querySelector('#settingsPanel .sm')), true);
    assert.equal(await page.getByRole("button", { name: "收起 GPT Image 2 的来源", exact: true }).count(), 1);

    await settings(page);
    const first = page.locator('.conn-card', { hasText: '第一连接' });
    await first.locator('.conn-models').click();
    await page.getByRole("searchbox", { name: "搜索模型" }).fill("custom");
    await page.evaluate(() => { window.originalDialogList = document.querySelector('#modelListDialog .md-list'); });
    await page.getByRole("combobox", { name: "把 custom-image 用作", exact: true }).selectOption("gpt-image-1.5");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("koma.routing.v1")).links.first?.["gpt-image-1.5"]?.id === "custom-image");
    await settle();
    assert.equal(await page.getByRole("searchbox", { name: "搜索模型" }).inputValue(), "custom");
    assert.equal(await page.evaluate(() => originalDialogList === document.querySelector('#modelListDialog .md-list')), true);
    assert.equal(await page.locator('#modelListDialog .md-row').count(), 1);
    assert.equal(catalogs().length, before);

    await page.getByRole("button", { name: "重新拉取", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#modelListDialog .md-row .lamp'));
    await page.waitForTimeout(80);
    assert.equal(catalogs().length, before + 1);
    assert.ok(catalogs().at(-1).url.includes('/first/'));
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await connectionAction(page, "编辑连接…", first);
    await page.locator('#connectionName').fill('改名连接');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.conn-name b')].some(el => el.textContent === '改名连接'));
    await settle();
    assert.equal(catalogs().length, before + 1, "a name edit is local presentation state");
    await connectionAction(page, "编辑连接…", page.locator('.conn-card', { hasText: '改名连接' }));
    await page.locator('#connectionUrl').fill('https://gateway.example.test/first-new');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.conn-card')].find(el => el.textContent.includes('改名连接'))?.querySelector('.st')?.dataset.s === 'ok');
    assert.ok(catalogs().slice(before + 1).length > 0);
    assert.ok(catalogs().slice(before + 1).every(r => r.url.includes('/first-new/')), "only the changed endpoint reloads");
    await clean(t);
  } finally { await t.context.close(); }
});

// Reads the sealed Key table with this session's derived key, as the vault does.
const vaultIds = (page) =>
  page.evaluate(async () => {
    const bytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const record = JSON.parse(localStorage.getItem("koma.vault.v2"));
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(sessionStorage.getItem("koma.session.dk")),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(record.iv) },
      key,
      bytes(record.ct),
    );
    return Object.keys(JSON.parse(new TextDecoder().decode(plain))).sort();
  });
const savedConnections = (page) =>
  page.evaluate(() =>
    Object.values(
      JSON.parse(localStorage.getItem("koma.routing.v1")).connections,
    ),
  );

test("settings: generating without a connection offers settings; connections rename and delete with their Key", async () => {
  const t = await open();
  try {
    const { page } = t;
    await page.keyboard.press("Control+Enter");
    await page
      .locator(".toast")
      .filter({ hasText: "请先配置连接并解锁 Key" })
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page.waitForSelector("#settingsPanel[open]");
    assert.match(
      await page.evaluate(() => location.hash),
      /settings\/connections/,
    );
    await addConnection(page, true);
    await page.getByRole("button", { name: "添加连接", exact: true }).click();
    await page.locator("#connectionName").fill("备用连接");
    await page.locator("#connectionUrl").fill("https://gateway.example.test");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.waitForSelector("#gate[open]");
    await page.locator("#setupKey").fill("synthetic-key-456");
    await page
      .locator("#gate")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.waitForSelector("#gate[open]", { state: "hidden" });
    const [first, second] = await savedConnections(page);
    assert.deepEqual(
      await vaultIds(page),
      [first.credentialRef, second.credentialRef].sort(),
    );
    const groups = page.locator("#settingsPanel .conn-card");
    assert.equal(await groups.count(), 2);

    await connectionAction(page, "编辑连接…", groups.first());
    assert.equal(await page.locator("#connectionTitle").textContent(), "编辑连接");
    assert.equal(await page.locator("#connectionUrl").inputValue(), "https://gateway.example.test");
    await page.locator("#connectionName").fill("主连接");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        Object.values(
          JSON.parse(localStorage.getItem("koma.routing.v1")).connections,
        )[0].name === "主连接",
    );
    await page.waitForSelector(".modal[open] #connectionName", { state: "hidden" });
    // Escape cancels the form only; the settings page stays open and nothing is saved.
    await connectionAction(page, "编辑连接…", groups.first());
    await page.locator("#connectionName").fill("不保存的名称");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".modal[open] #connectionName", { state: "hidden" });
    assert.equal(
      await groups.first().locator(".conn-name b").textContent(),
      "主连接",
    );
    assert.equal(await page.locator("#settingsPanel[open]").count(), 1);

    await connectionAction(page, "删除连接", groups.nth(1));
    await page.waitForSelector("#confirmSheet[open]");
    await page
      .locator("#confirmSheet")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Object.keys(
          JSON.parse(localStorage.getItem("koma.routing.v1")).connections,
        ).length === 1,
    );
    assert.deepEqual(
      (await savedConnections(page)).map((c) => c.id),
      [first.id],
    );
    for (let i = 0; i < 20 && (await vaultIds(page)).length > 1; i++)
      await page.waitForTimeout(50);
    assert.deepEqual(await vaultIds(page), [first.credentialRef]);

    await page.getByRole("button", { name: "安全与备份", exact: true }).click();
    await page.getByRole("button", { name: "立即锁定", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#gate").open);
    await page.locator(".set-nav button").filter({ hasText: "连接" }).click();
    await connectionAction(page, "删除连接", groups.first());
    assert.equal(await page.locator("#confirmSheet[open]").count(), 0);
    await page
      .locator(".toast")
      .filter({ hasText: "请先解锁 Key，再删除连接" })
      .getByRole("button", { name: "解锁", exact: true })
      .click();
    await page.waitForSelector("#gate[open]");
    // The dismissed notice fades out inside the gate before it leaves.
    await page.locator(".toast-action").waitFor({ state: "detached" });
    await page.locator("#unlockPass").fill("test-passphrase");
    await page
      .locator("#gate")
      .getByRole("button", { name: "解锁", exact: true })
      .click();
    await page.waitForSelector("#gate[open]", { state: "hidden" });
    await connectionAction(page, "删除连接", groups.first());
    await page
      .locator("#confirmSheet")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page.waitForSelector("#settingsPanel .sp-empty");
    for (let i = 0; i < 20 && (await vaultIds(page)).length; i++)
      await page.waitForTimeout(50);
    assert.deepEqual(await vaultIds(page), []);
    await clean(t);
  } catch (e) {
    await t.page.screenshot({ path: `${output}/failure-connections.png` });
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
    const tagRequests = t.requests.filter((r) => new URL(r.url).host === "tagsuggest.zeabur.app").length;
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".tag-card").length === 1);
    assert.match(await page.locator(".tag-card strong").textContent(), /blue_tag_25/);
    assert.equal(await page.getByRole("button", { name: "下一页", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".tag-card").length === 25);
    assert.equal(t.requests.filter((r) => new URL(r.url).host === "tagsuggest.zeabur.app").length, tagRequests);
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

test("shared Tag controls and editor highlighting do not depend on image CSS; version rail remains independent", async () => {
  const t = await open();
  try {
    const { page } = t;
    await page.evaluate(() => { document.querySelector("#style-image").media = "not all"; });
    await page.locator("#prompt").fill("blue");
    await page.waitForSelector('.tag-suggest:not([hidden]) .tag-suggest-option');
    assert.equal(await page.locator('.tag-suggest:not([hidden])').evaluate((element) => getComputedStyle(element).position), "fixed");
    // Inspect the shared menu row height rather than the animated rectangle.
    assert.equal(await page.locator('.tag-suggest-option').first().evaluate((element) => getComputedStyle(element).minHeight), "32px");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "查词插入", exact: true }).click();
    await page.waitForSelector("#pickerSearch");
    assert.equal(await page.locator("#pickerSheet").evaluate((element) => getComputedStyle(element).position), "fixed");
    assert.equal(await page.locator(".picker-card").evaluate((element) => getComputedStyle(element).display), "grid");
    await page.getByRole("button", { name: "关闭查词插入", exact: true }).click();
    await page.waitForSelector("#pickerSheet", { state: "hidden" });
    await page.evaluate(() => { document.querySelector("#style-image").media = "all"; });
    for (const workspace of ["chat", "tags"]) {
      await route(page, `#/${workspace}`);
      await page.waitForSelector(`[data-workspace-root="${workspace}"]`);
      await page.evaluate(async (workspace) => {
        const p = document.body.__vue_app__._instance.provides;
        const editor = p[Object.getOwnPropertySymbols(p).find((key) => key.description === "editor")];
        const canvas = document.createElement("canvas");
        canvas.width = 832; canvas.height = 1216;
        canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
        await editor.open(workspace, await new Promise((done) => canvas.toBlob(done)), "synthetic.png", { mode: "img2img" });
      }, workspace);
      await page.waitForSelector("#imageEditor[data-active=true]");
      await page.locator("#editorPrompt").fill("{blue_hair}");
      const styles = await page.evaluate(() => {
        const textarea = document.querySelector("#editorPrompt"), mirror = textarea.previousElementSibling;
        const metrics = (element) => {
          const style = getComputedStyle(element);
          return [style.fontFamily, style.fontSize, style.lineHeight, style.letterSpacing, style.padding];
        };
        return {
          imageMedia: document.querySelector("#style-image").media,
          textarea: metrics(textarea), mirror: metrics(mirror),
          weightRadius: getComputedStyle(mirror.querySelector(".w")).borderRadius,
          punctuation: getComputedStyle(mirror.querySelector(".w-mark")).opacity,
          rail: document.querySelector(".editor-rail").getBoundingClientRect().width,
        };
      });
      if (workspace === "chat") assert.equal(styles.imageMedia, "not all");
      assert.deepEqual(styles.textarea, styles.mirror);
      assert.equal(styles.weightRadius, "2px");
      assert.equal(styles.punctuation, "0.85");
      assert.equal(styles.rail, 132);
      await page.getByRole("button", { name: "版本栏", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".editor-rail").getBoundingClientRect().width <= 1);
      await page.getByRole("button", { name: "版本栏", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".editor-rail").getBoundingClientRect().width === 132);
      await page.evaluate(() => { location.hash = "#/image"; });
      await page.waitForSelector("#imageEditor[data-active=true]", { state: "hidden" });
    }
    await clean(t);
  } finally { await t.context.close(); }
});

test("scoped notices follow a modal and keep their real dismissal clock under reduced motion", async () => {
  const t = await open();
  try {
    const { page } = t;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      const p = document.body.__vue_app__._instance.provides;
      window.styleUi = p[Object.getOwnPropertySymbols(p).find((key) => key.description === "ui")];
      void styleUi.confirm({ title: "样式验证", message: "保留确认内容与操作。", items: ["第一项", "第二项"] });
    });
    await page.waitForSelector("#confirmSheet[open]");
    await page.evaluate(() => styleUi.toast("计时样式验证", "ok"));
    const notice = page.locator("#confirmSheet .editor-toasts .toast");
    await notice.waitFor();
    assert.equal(await notice.locator(".toast-timer").evaluate((element) => getComputedStyle(element).animationDuration), "3s");
    await page.waitForTimeout(150);
    assert.ok(await notice.isVisible(), "reduced motion must not dismiss immediately");
    await notice.waitFor({ state: "hidden", timeout: 5000 });
    assert.equal(await page.locator("#confirmSheet[open]").count(), 1);
    await page.locator("#confirmSheet [data-confirm=cancel]").click();
    await clean(t);
  } finally { await t.context.close(); }
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
