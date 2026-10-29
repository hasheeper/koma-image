import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

let server, browser, origin;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
before(async () => {

  const root = resolve("dist");
  server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      ).replace(/^\/repo\//, "/");
      const file = resolve(
        root,
        `.${path.endsWith("/") ? `${path}index.html` : path}`,
      );
      if (!file.startsWith(`${root}/`)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(file);
      response
        .writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream",
        })
        .end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((done) => server?.close(done));
});

async function open(path = "/#/image") {
  if (!path.includes("#") && !path.includes("transfer.html")) path += "#/image";
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [],
    external = [],
    scripts = [];
  page.on("request", request => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await context.route("**/*", (route) => {
    if (
      ["tagsuggest.zeabur.app", "danbooru.donmai.us"].includes(
        new URL(route.request().url()).host,
      )
    )
      return route.fulfill({ json: { results: [] } });
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}${path}`);
  await page.waitForSelector("[data-workspace-root]");
  return { page, context, errors, external, scripts };
}
async function switchTo(page, id) {
  await page.locator(".switcher:visible").click();
  await page.locator(`.switch-menu:popover-open a[href='#/${id}']`).click();
  await page.waitForSelector(`[data-workspace-root='${id}']`);
}
async function clean(result) {
  assert.deepEqual(result.errors, [], "no runtime or resource errors");
  assert.deepEqual(result.external, [], "no external requests");
  await result.context.close();
}

test("single document, cached drafts and nodes, back/forward, and global overlay", async () => {
  const result = await open("/?image=synthetic-ticket&repeat=a&repeat=b");
  const { page, context } = result;
  const prompt = await page.locator("#prompt").elementHandle();
  await page.locator("#prompt").fill("保留绘图草稿");
  await page.locator("#favoritesTab").click();
  await switchTo(page, "chat");
  await page.locator("#chatPrompt").fill("保留对话草稿");
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await switchTo(page, "tags");
  await page.locator("#tagSearch").fill("blue hair");
  await page.getByRole("button", { name: "画师", exact: true }).click();
  await switchTo(page, "image");
  assert.equal(await page.locator("#prompt").inputValue(), "保留绘图草稿");
  assert.equal(
    await prompt.evaluate((node) => node === document.querySelector("#prompt")),
    true,
  );
  assert.equal(
    await page.locator("#favoritesTab").getAttribute("aria-selected"),
    "true",
  );
  await page.goBack();
  await page.waitForSelector("#tagSearch");
  assert.equal(await page.locator("#tagSearch").inputValue(), "blue hair");
  assert.equal(
    await page
      .getByRole("button", { name: "画师", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.goBack();
  await page.waitForSelector("#chatPrompt");
  assert.equal(await page.locator("#chatPrompt").inputValue(), "保留对话草稿");
  assert.equal(
    await page.locator("body").getAttribute("data-rail"),
    "collapsed",
  );
  await page.goForward();
  await page.waitForSelector("#tagSearch");
  await page.locator(".switcher:visible").click();
  await page
    .locator(".switch-menu:popover-open")
    .getByRole("button", { name: /^设置/ })
    .click();
  await page.waitForSelector("#settingsPanel[open]");
  await page.getByRole("button", { name: "安全与备份", exact: true }).click();
  assert.match(page.url(), /#\/tags\/settings\/security$/);
  assert.equal(await page.locator("#settingsPanel").count(), 1);
  assert.equal(await page.locator("#imageEditor").count(), 0);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#settingsPanel[open]", { state: "hidden" });
  assert.equal(
    await page
      .locator(".switcher")
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(await page.locator("#tagSearch").inputValue(), "blue hair");
  assert.equal(context.pages().length, 1);
  await page.goBack();
  await page.waitForSelector("#chatPrompt");
  await page.goForward();
  await page.waitForSelector("#tagSearch");
  assert.equal(
    await page.evaluate(
      () => performance.getEntriesByType("navigation").length,
    ),
    1,
  );
  assert.equal(
    new URL(page.url()).search,
    "?image=synthetic-ticket&repeat=a&repeat=b&q=blue+hair",
  );
  assert.deepEqual(
    await page.evaluate(async () => ({
      local: Object.keys(localStorage).sort(),
      session: Object.keys(sessionStorage),
      dbs: (await indexedDB.databases()).map((db) => db.name).sort(),
    })),
    {
      local: ["koma.chat.rail.v1", "koma.home.v1", "koma.prefs.v1", "koma.tag.categories.v1"],
      session: [],
      dbs: ["koma-ask", "koma-bridge", "koma-chat", "koma-handoff", "koma-home", "koma-image-favorites", "koma-slate"],
    },
  );
  await clean(result);
});

test("repeat activation and dialog cycles retain one listener set and release inactive UI listeners", async () => {
  const result = await open();
  const { page } = result;
  const cdp = await page.context().newCDPSession(page);
  async function listeners(expression) {
    const { result: object } = await cdp.send("Runtime.evaluate", {
      expression,
    });
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
      objectId: object.objectId,
    });
    await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
    return listeners
      .map((listener) => `${listener.type}:${listener.useCapture}`)
      .sort();
  }
  for (const id of ["chat", "tags", "image"]) await switchTo(page, id);
  // Compare repeated use after the lazy singleton has been created once.
  await page.evaluate(() => { location.hash = "#/image/settings/connections"; });
  await page.waitForSelector("#settingsPanel[open]");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#settingsPanel[open]", { state: "hidden" });
  const initialWindow = await listeners("window");
  const initialViewport = await listeners("visualViewport");
  const initialDocument = await listeners("document");
  const initialPrompt = await listeners("document.querySelector('#prompt')");
  for (let i = 0; i < 12; i++) {
    for (const id of ["chat", "tags", "image"]) {
      await page.evaluate((id) => {
        location.hash = `#/${id}`;
      }, id);
      await page.waitForSelector(`[data-workspace-root='${id}']`);
    }
    for (const overlay of ["settings/connections", "editor"]) {
      await page.evaluate((overlay) => {
        location.hash = `#/image/${overlay}`;
      }, overlay);
      await page.waitForSelector(
        overlay.startsWith("settings")
          ? "#settingsPanel[open]"
          : "#imageEditor[data-active=true]",
      );
      if (overlay === "editor") await page.evaluate(() => { location.hash = "#/image"; });
      else await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    }
  }
  assert.deepEqual(await listeners("window"), initialWindow);
  assert.deepEqual(await listeners("visualViewport"), initialViewport);
  assert.deepEqual(await listeners("document"), initialDocument);
  assert.deepEqual(
    await listeners("document.querySelector('#prompt')"),
    initialPrompt,
  );
  assert.equal(await page.locator("#gallery").count(), 1);
  assert.equal(await page.locator("[data-workspace-root]:visible").count(), 1);
  assert.equal(await page.locator("dialog").count(), 6);
  await cdp.detach();
  await clean(result);
});

test("neutral HTML redirects preserve tickets and work under a static subpath", async () => {
  for (const prefix of ["/", "/repo/"]) {
    for (const [file, route, selector] of [
      ["chat.html", "chat", "#chatPrompt"],
      ["tags.html", "tags", "#tagSearch"],
      ["transfer.html", "image/settings/backup", "#settingsPanel[open]"],
    ]) {
      const result = await open(
        `${prefix}${file}?q=blue%20hair&page=2&image=synthetic-ticket`,
      );
      await result.page.waitForSelector(selector);
      assert.equal(new URL(result.page.url()).pathname, `${prefix}index.html`);
      assert.equal(new URL(result.page.url()).hash, `#/${route}`);
      assert.equal(
        new URL(result.page.url()).searchParams.get("image"),
        "synthetic-ticket",
      );
      assert.equal(
        new URL(result.page.url()).searchParams.get("q"),
        "blue hair",
      );
      if (file === "tags.html")
        assert.equal(
          await result.page.locator("#tagSearch").inputValue(),
          "blue hair",
        );
      if (file !== "transfer.html") {
        await result.page.evaluate(route => { location.hash = `#/${route}/settings/connections`; }, route);
        await result.page.waitForSelector("#settingsPanel[open]");
      }
      const href = `${prefix}assets/icons.svg#i-swap`;
      await result.page.waitForFunction(href => {
        const value = document.querySelector(".conn-empty .connection-avatar use")?.getAttribute("href");
        return value && new URL(value, location.href).pathname + new URL(value, location.href).hash === href;
      }, href, { timeout: 8000 });
      const sprite = await result.page.request.get(`${origin}${prefix}assets/icons.svg`);
      assert.equal(sprite.ok(), true);
      assert.match(await sprite.text(), /id="i-swap"/);
      await clean(result);
    }
  }
});

test('deferred panels stay cold at startup; late settings loading respects navigation and reuses its dialog', async () => {
  const result = await open('/repo/#/home');
  const { page, context, scripts } = result;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requested;
  const loading = new Promise(resolve => { requested = resolve; });
  try {
    assert.equal(scripts.some(path => /\/(SettingsOverlay|PhotopeaPanel|SlatePanel)-/.test(path)), false);
    await context.route('**/SettingsOverlay-*.js', async route => {
      requested(); await held; await route.continue();
    });
    await page.evaluate(() => { location.hash = '#/home/settings/connections'; });
    await loading;
    await page.evaluate(() => { location.hash = '#/image'; });
    release();
    await page.waitForSelector('#prompt');
    await page.waitForSelector('#settingsPanel', { state: 'attached' });
    assert.equal(await page.locator('#settingsPanel').evaluate(dialog => dialog.open), false);
    const dialog = await page.locator('#settingsPanel').elementHandle();
    await page.locator('.switcher:visible').click();
    await page.locator('.switch-menu:popover-open').getByRole('button', { name: /^设置/ }).click();
    await page.waitForSelector('#settingsPanel[open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#settingsPanel[open]', { state: 'hidden' });
    await page.locator('.switcher:visible').click();
    await page.locator('.switch-menu:popover-open').getByRole('button', { name: /^设置/ }).click();
    await page.waitForSelector('#settingsPanel[open]');
    assert.equal(await dialog.evaluate(node => node === document.querySelector('#settingsPanel')), true);
    assert.equal(scripts.filter(path => /\/SettingsOverlay-/.test(path)).length, 1);
    assert.equal(scripts.some(path => /\/(PhotopeaPanel|SlatePanel)-/.test(path)), false);
  } finally { release(); await clean(result); }
});
