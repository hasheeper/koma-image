import { before, after } from "node:test";

import { createServer } from "./vite.mjs";
import { chromium } from "playwright";
import { createArchive } from "../../src/storage/backup-archive.ts";

let server, browser, origin;

async function open(profile, seed = true, customId = "", account = { status: 200, body: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 100 } } }, baseUrl = "", withGateway = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), requests = [], errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("about:blank");
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
    const c = canvas.getContext("2d"); c.fillStyle = "#50417c"; c.fillRect(0,0,512,512);
    c.fillStyle = "#c4b6ff"; c.fillRect(50,70,220,180);
    return canvas.toDataURL().split(",")[1];
  }), "base64");
  const zip = Buffer.from(await (await createArchive([["image_0.png", new Blob([png], { type: "image/png" })]])).arrayBuffer());
  if (seed) await context.addInitScript(({ profile, baseUrl, withGateway }) => {
    if (!/^https?:/.test(location.protocol) || localStorage.getItem("koma.routing.v1")) return;
    localStorage.setItem("koma.routing.v1", JSON.stringify({ version: 1, connections: {
      ...(withGateway ? { primary: { id: "primary", name: "模拟网关", baseUrl: "https://gateway.example.test/primary", profileId: "koma-standard-v1", credentialRef: "primary-key", revision: "rev1" } } : {}),
      test: { id: "test", name: "模拟协议", baseUrl: baseUrl || (profile === "nai-official-v1" ? "https://image.novelai.net" : "https://gateway.example.test/service"), profileId: profile, credentialRef: "test-key", revision: "rev1" } }, links: {} }));
    sessionStorage.setItem("koma.session.keys", JSON.stringify({ "test-key": "synthetic-native-only", ...(withGateway ? { "primary-key": "synthetic-primary-only" } : {}) }));
  }, { profile, baseUrl, withGateway });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (!["gateway.example.test", "image.novelai.net", "api.openai.com", "sample.openai.azure.com", "sample.services.ai.azure.com", "generativelanguage.googleapis.com", "aiplatform.googleapis.com", "us-central1-aiplatform.googleapis.com"].includes(url.hostname)) {
      errors.push(`unexpected external origin: ${url.origin}`); return route.abort();
    }
    const record = { url: url.href, path: url.pathname, method: request.method(), headers: request.headers(), body: request.postData() };
    requests.push(record);
    if (url.pathname.startsWith("/primary/")) {
      if (url.pathname.endsWith("/image/models")) return route.fulfill({ json: { studio_features: { version: 2, max_cost: true }, valid_samplers: account.mediumEditor ? ["k_euler_ancestral", "k_euler"] : undefined, models: {
        ...Object.fromEntries(["nai-diffusion-5-full", "nai-diffusion-5-curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated", ...(account.mediumEditor ? ["nai-diffusion-5-full-medium"] : [])].map(id => [id, { provider: "novelai", operations: ["generate", "edit"], tools: ["img2img", "inpaint", "upscale"], quota_group: "novelai-v5" }])),
        "gpt-image-1.5": { editor_family: "gpt", operations: ["generate", "edit"], tools: ["image-edit"], quota_group: "openai" },
      } } });
      if (url.pathname.endsWith("/media/quota")) return route.fulfill({ json: { credits: { remaining: 5000 }, images: { "novelai-v5": { remaining: 174, limit: 250 }, openai: { remaining: 50, limit: 100 } } } });
      if (url.pathname.endsWith("/token_stats_data")) return route.fulfill({ json: { temp_limits: { is_temp: false } } });
      if (url.pathname.endsWith("/estimate")) return route.fulfill({ json: { cost: account.quoteCost ?? 0 } });
      if (url.pathname.endsWith("/ai/generate-image")) return route.fulfill({ contentType: "application/zip", body: zip });
      if (url.pathname.endsWith("/tools/run") || url.pathname.endsWith("/studio/image/generate")) return route.fulfill({ json: { data: [{ b64_json: png.toString("base64") }] } });
    }
    if (url.pathname.endsWith("/models")) return url.pathname.endsWith("/v1beta/models")
      ? route.fulfill({ json: { models: [{ name: "models/" + (customId || "gemini-2.5-flash-image") }], nextPageToken: "repeated-token" } })
      : route.fulfill({ json: { data: [{ id: customId || "gpt-image-1.5" }] } });
    if (url.hostname === "image.novelai.net" && url.pathname === "/user/subscription") return route.fulfill({ status: account.status, json: account.body });
    if (request.method() === "POST" && /\/images\/(generations|edits)$/.test(url.pathname))
      return route.fulfill({ json: { data: [{ b64_json: png.toString("base64") }] } });
    if (request.method() === "POST" && url.pathname.endsWith(":generateContent"))
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "模拟结果" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] } });
    if (request.method() === "POST" && url.pathname === "/ai/encode-vibe") {
      await account.onEncode?.(record);
      return route.fulfill({status:account.encodingStatus || 200,contentType:"application/octet-stream",body:Buffer.from([0,1,254,255])});
    }
    if (request.method() === "POST" && ["/ai/generate-image", "/ai/upscale"].includes(url.pathname)) {
      await account.onGenerate?.(record);
      if (account.generationStatus) return route.fulfill({ status: account.generationStatus, json: { error: "Synthetic generation failure" } });
      const image = url.pathname === '/ai/upscale' ? account.upscaleImage : account.generatedImage;
      if (image && account.bareImage) return route.fulfill({contentType:'image/png',body:image});
      const body = image ? Buffer.from(await (await createArchive([['image_0.png',new Blob([image],{type:'image/png'})]])).arrayBuffer()) : zip;
      return route.fulfill({ contentType: "application/zip", body });
    }
    errors.push(`unexpected endpoint: ${url.pathname}`); return route.fulfill({ status: 404, json: { error: "Unexpected protocol request" } });
  });
  const workspace = profile === "nai-official-v1" ? "image" : "chat";
  await page.goto(origin + `/#/${workspace}${seed ? "" : "/settings/connections"}`);
  await page.waitForFunction(() => !!document.body.__vue_app__?._instance);
  await bind(page);
  return { page, context, requests, errors, png };
}

async function bind(page) {
  await page.waitForFunction(() => !!document.body.__vue_app__?._instance);
  await page.evaluate(() => {
    const p = document.body.__vue_app__._instance.provides, a = document.body.__vue_app__._context.provides;
    for (const name of ["chat", "editor", "drawing", "ui"])
      window[name] = p[Object.getOwnPropertySymbols(p).find(k => k.description === name)];
    window.services = a[Object.getOwnPropertySymbols(a).find(k => k.description === "application-services")];
  });
}

async function chooseNai(page, id, value) {
  // Mode and Effort are always-visible segments; the rest are menus.
  if (id === "naiMode" || id === "effort") return page.locator(`#${id} label:has(input[value="${value}"])`).click();
  await page.locator(`#${id}`).click();
  await page.locator(`.nai-menu:popover-open [data-value="${value}"]`).click();
}

async function addReference(t, kind='vibe', count=1) {
  await chooseNai(t.page,'model','nai-diffusion-4-5-full');
  await t.page.getByRole('button',{name:kind==='vibe'?'Vibe Transfer':'Precise Reference',exact:true}).click();
  await t.page.locator('.bottom-reference-body input[type=file]').first().setInputFiles(Array.from({length:count},(_,i)=>({name:`synthetic-${i}.png`,mimeType:'image/png',buffer:t.png})));
  await t.page.waitForFunction(({kind,count})=>drawing.snapshot().form.naiReferences[kind].length===count,{kind,count});
}

const referencePosts=t=>t.requests.filter(r=>r.method==='POST' && ['/ai/encode-vibe','/ai/generate-image'].includes(r.path));

async function openEditorFixture(t, settings) {
  await t.page.evaluate(async ({ png, settings }) => {
    await editor.open('image', new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}),'synthetic.png',{ settings });
    ui.notices.value.forEach(n=>ui.dismissNotice(n.id));
  },{png:t.png.toString('base64'),settings});
  await t.page.locator('#imageEditor[data-active=true]').waitFor();
}

async function paintEditorMask(page) {
  await page.locator('#editorMask:not([hidden])').waitFor();
  const box=await page.locator('#editorMask').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
  await page.mouse.down();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5,{steps:3});await page.mouse.up();
  await page.waitForFunction(()=>editor.snapshot().edit.canRun);
}

async function solidPng(page,width,height,color='#e04050') {
  return Buffer.from(await page.evaluate(({width,height,color})=>{
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
    return c.toDataURL().split(',')[1];
  },{width,height,color}),'base64');
}

async function drawEditorFocus(page, from=[.25,.25], to=[.75,.75]) {
  if (await page.locator('#editorSelectFocus').getAttribute('aria-pressed') !== 'true') await page.locator('#editorSelectFocus').click();
  const b=await page.locator('#editorFocusRegion').boundingBox();
  await page.mouse.move(b.x+b.width*from[0],b.y+b.height*from[1]);await page.mouse.down();
  await page.mouse.move(b.x+b.width*to[0],b.y+b.height*to[1],{steps:12});await page.mouse.up();
  await page.getByRole('button',{name:'画笔',exact:true}).click();
}

async function chooseInpaint(page, focused) {
  await page.locator('#editorInpaintToggle').click();
  await page.getByRole('menuitemradio',{name:focused?'聚焦重绘':'普通重绘',exact:true}).click();
}

export function useNativeFixture() {
before(async () => {

  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
}

export { server, browser, origin, open, bind, chooseNai, addReference, referencePosts, openEditorFixture, paintEditorMask, solidPng, drawEditorFocus, chooseInpaint };
