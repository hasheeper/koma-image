import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

let server, browser, origin;
const output = resolve(".local/m1");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
before(async () => {
  await mkdir(output, { recursive: true });
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

async function open(path = "/") {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [],
    external = [];
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
  return { page, context, errors, external };
}
async function switchTo(page, id) {
  await page.locator(".switcher").click();
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
  await page.locator(".switcher").click();
  await page
    .locator(".switch-menu:popover-open")
    .getByRole("button", { name: /^设置/ })
    .click();
  await page.waitForSelector("#settingsPanel[open]");
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  assert.match(page.url(), /#\/tags\/settings\/backup$/);
  assert.equal(await page.locator("#settingsPanel").count(), 1);
  assert.equal(await page.locator("#imageEditor").count(), 1);
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
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      dbs: (await indexedDB.databases()).map((db) => db.name).sort(),
    })),
    {
      local: ["koma.tag.categories.v1", "koma.prefs.v1", "koma.chat.rail.v1"],
      session: [],
      dbs: ["koma-chat", "koma-handoff", "koma-image-favorites"],
    },
  );
  await clean(result);
});

test("four viewports: layout, gallery identity across Teleport, and workspace CSS isolation", async () => {
  const result = await open();
  const { page } = result;
  const gallery = await page.locator("#gallery").elementHandle();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const workspace of ["image", "chat", "tags"]) {
      await switchTo(page, workspace);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        headers: [...document.querySelectorAll(".topbar")].filter(
          (node) => node.getBoundingClientRect().height > 0,
        ).length,
        root: document
          .querySelector("[data-workspace-root]")
          .getBoundingClientRect()
          .toJSON(),
      }));
      assert.ok(
        layout.scroll <= width + 1,
        `${workspace} at ${width}: no horizontal overflow`,
      );
      assert.equal(layout.headers, 1);
      assert.ok(layout.root.width > 0);
      if (workspace === "image") {
        assert.equal(
          await gallery.evaluate(
            (node) => node === document.querySelector("#gallery"),
          ),
          true,
        );
        assert.equal(
          await page
            .locator("#gallery")
            .evaluate((node) => node.parentElement.className),
          width <= 860 ? "topbar-history-slot" : "shell",
        );
        assert.equal(await page.locator("body > .topbar").count(), 1);
        if (width > 860) {
          const rail = await page.locator("#gallery").boundingBox();
          const bar = await page.locator("body > .topbar").boundingBox();
          assert.equal(rail.y, 0);
          assert.ok(Math.abs(bar.width + rail.width - width) <= 1);
        }
      }
      if (workspace === "chat") {
        assert.equal(
          await page.locator("#style-image").getAttribute("media"),
          "not all",
        );
        const parent = await page
          .getByRole("button", {
            name: "API Key",
            exact: true,
            includeHidden: true,
          })
          .evaluate((node) => node.parentElement.className);
        assert.equal(parent, width <= 860 ? "topbar-end" : "topbar-account");
      }
      if (
        (width === 1440 && workspace === "image") ||
        (width === 768 && workspace === "chat") ||
        (width === 390 && workspace === "tags")
      )
        await page.screenshot({ path: `${output}/${workspace}-${width}.png` });
    }
    await page.evaluate(() => {
      location.hash = "#/tags/settings/backup";
    });
    await page.waitForSelector("#settingsPanel[open]");
    const dialog = await page.locator("#settingsPanel").boundingBox();
    assert.equal(dialog.width, width);
    if (width === 320)
      await page.screenshot({ path: `${output}/settings-${width}.png` });
    await page.keyboard.press("Escape");
  }
  await clean(result);
});

test("cached document scroll is restored before/after a full-height chat workspace", async () => {
  const result = await open();
  const { page } = result;
  await page.setViewportSize({ width: 390, height: 520 });
  await page.waitForFunction(() => {
    const viewport = document.querySelector("#viewport");
    return (
      Math.abs(
        viewport.getBoundingClientRect().height -
          parseFloat(viewport.style.getPropertyValue("--vp-h")),
      ) < 1
    );
  });
  await page.locator("#prompt").fill("移动端滚动保留");
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const previous = await page.evaluate(() => scrollY);
  assert.ok(previous > 0);
  // Change route without scrolling the sticky header into view.
  await page.evaluate(() => {
    location.hash = "#/chat";
  });
  await page.waitForSelector("#chatPrompt");
  await page.evaluate(() => {
    location.hash = "#/image";
  });
  await page.waitForSelector("#prompt");
  await page.waitForFunction(
    (expected) => Math.abs(scrollY - expected) < 2,
    previous,
  );
  assert.equal(await page.locator("#prompt").inputValue(), "移动端滚动保留");
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
          : "#imageEditor[open]",
      );
      await page.keyboard.press("Escape");
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
  assert.equal(await page.locator("[data-workspace-root]").count(), 1);
  assert.equal(await page.locator("dialog").count(), 7);
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
      const avatarLoaded = await result.page
        .locator("img[alt='默认头像']")
        .evaluate((img) => img.complete && img.naturalWidth === 64);
      assert.equal(avatarLoaded, true);
      await clean(result);
    }
  }
});
