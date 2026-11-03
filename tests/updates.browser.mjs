import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "./helpers/vite.mjs";

let browser, server, origin;
before(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, open: false } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

test("updates: read the bundled release history, return within settings and persist read state across tabs", async () => {
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const context = await browser.newContext();
  const errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    const page = await context.newPage();
    const other = await context.newPage();
    for (const tab of [page, other]) {
      await tab.goto(`${origin}/#/home/settings/general`);
      await tab.getByRole("img", { name: "有未读更新" }).waitFor();
    }
    assert.ok((await page.getByRole("group", { name: "关于", exact: true }).innerText()).includes(`v${version}`));
    await page.getByRole("button", { name: "更新日志" }).click();
    await page.getByRole("region", { name: "更新日志", exact: true }).waitFor();
    assert.match(page.url(), /#\/home\/settings\/updates$/);
    const current = page.locator("details").filter({ has: page.getByText(`v${version}`, { exact: true }) });
    assert.equal(await current.getAttribute("open"), "");
    const older = page.locator("details").filter({ has: page.getByText("v0.3.3", { exact: true }) });
    assert.equal(await older.getAttribute("open"), null);
    await page.getByText("v0.3.3", { exact: true }).click();
    assert.equal(await older.getAttribute("open"), "");
    await page.waitForFunction(version => JSON.parse(localStorage.getItem("koma.release.seen.v1")) === version, version);
    await other.getByRole("img", { name: "有未读更新" }).waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "更新日志" }).waitFor();
    assert.match(page.url(), /#\/home\/settings\/general$/);
    assert.equal(await page.locator("#settingsPanel").isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "releaseNotesButton");
    await page.getByRole("button", { name: "更新日志" }).click();
    await page.getByRole("region", { name: "更新日志", exact: true }).waitFor();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.getByRole("button", { name: "更新日志" }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "更新日志" }).waitFor();
    assert.equal(await page.getByRole("img", { name: "有未读更新" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
