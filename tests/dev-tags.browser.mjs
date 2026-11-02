import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createDevServer } from "../scripts/dev.mjs";

let server, browser, origin, cacheDir, png;
const requests = [];
const imagePath = "sample/ab/cd/sample-abcd0123456789abcdef0123456789ab.png";
const post = {
  id: 123456, rating: "g", image_width: 32, image_height: 48,
  tag_string_artist: "studio_artist", tag_string_character: "sample_character",
  tag_string_copyright: "sample_series", tag_string_general: "blue_hair",
  media_asset: { variants: [{ type: "360x360", url: `https://cdn.donmai.us/${imagePath}`, file_ext: "png", width: 32, height: 48 }] },
};

before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "koma-dev-tags-"));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  png = Buffer.from(await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(32, 48);
    canvas.getContext("2d").fillRect(0, 0, 32, 48);
    return [...new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())];
  }));
  await page.close();
  server = await createDevServer({
    cacheDir, envDir: false,
    base: "/app/", server: { host: "127.0.0.1", port: 0, open: false, hmr: false },
    optimizeDeps: { noDiscovery: true, include: ["vue", "marked", "entities", "@huggingface/tokenizers"] },
  }, { fetcher: async (url, options) => {
    requests.push({ url: String(url), options });
    return url.hostname === "cdn.donmai.us"
      ? new Response(png, { headers: { "Content-Type": "image/png" } })
      : Response.json(post);
  } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
});
after(async () => {
  try { await browser?.close(); await server?.close(); }
  finally { if (cacheDir) await rm(cacheDir, { recursive: true, force: true }); }
});

test("dev tags: runtime is independent of model connections and preserves the local read boundary", async () => {
  const html = await (await fetch(`${origin}/app/`)).text();
  const runtime = JSON.parse(/id="koma-tags-runtime"[^>]*>([^<]+)/.exec(html)[1]);
  assert.doesNotMatch(html, /id="koma-runtime"/);
  assert.doesNotMatch(await (await fetch(`${origin}/app/__ui`)).text(), /id="koma-(?:tags-)?runtime"/);
  const headers = { "X-Koma-Local-Token": runtime.token };
  const endpoint = `${origin}/app/api/danbooru/`;
  const before = requests.length;
  for (const [path, options, status] of [
    ["posts/123456.json", {}, 403],
    ["posts/123456.json", { headers: { ...headers, Origin: "https://elsewhere.example" } }, 403],
    ["posts/123456.json", { headers: { ...headers, "Sec-Fetch-Site": "cross-site" } }, 403],
    ["posts/123456.json", { method: "POST", headers }, 405],
    ["posts/123456.json?url=https://elsewhere.example", { headers }, 400],
    ["users.json", { headers }, 404],
    ["media/unrestricted.png", {}, 404],
  ]) assert.equal((await fetch(endpoint + path, options)).status, status, path);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(endpoint + "posts/123456.json", { headers: { ...headers, Host: "elsewhere.example" } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal(requests.length, before, "rejected requests never reach upstream");
  assert.deepEqual(await (await fetch(endpoint + "posts/123456.json", { headers: { ...headers, Authorization: "Bearer synthetic-browser-key", Cookie: "synthetic=1" } })).json(), post);
  assert.deepEqual(Buffer.from(await (await fetch(endpoint + "media/" + imagePath)).arrayBuffer()), png);
  for (const { options } of requests.slice(before)) {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "User-Agent"]);
  }
});

test("dev tags: pasted post loads categorized tags and decodes the image through the Vite middleware", async () => {
  const context = await browser.newContext();
  const page = await context.newPage(), errors = [], browserRequests = [];
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => browserRequests.push(request.url()));
  await context.route("https://tagsuggest.zeabur.app/**", route => route.fulfill({ json: { results: [] } }));
  await context.route(/https:\/\/(?:danbooru|cdn)\.donmai\.us\//, route => route.abort());
  try {
    await page.goto(`${origin}/app/#/tags`);
    await page.locator("#tagSearch").fill("https://danbooru.donmai.us/posts/123456?q=blue_hair");
    await page.locator('.tag-add[data-tag="blue_hair"]').waitFor();
    assert.equal(await page.locator(".tag-card").count(), 4);
    await page.waitForFunction(() => document.querySelector(".tag-post-thumb img")?.naturalWidth === 32);
    assert.ok(browserRequests.includes(`${origin}/app/api/danbooru/posts/123456.json`));
    assert.ok(browserRequests.some(url => url === `${origin}/app/api/danbooru/media/${imagePath}`));
    assert.ok(!browserRequests.some(url => /https:\/\/(?:danbooru|cdn)\.donmai\.us\//.test(url)));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
