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
      () => document.querySelector(".conn-card .st")?.dataset.s === "ok",
    );
    assert.equal(
      await p.getByRole("button", { name: "添加连接", exact: true }).count(),
      0,
    );
    assert.equal(
      await p.getByRole("button", { name: "更多操作", exact: true }).count(),
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
      () => document.querySelector(".conn-card .st")?.dataset.s === "ok",
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
    // This fixture deliberately has no server-side reasoning credentials.
    await route(p, "#/image/settings/ask");
    await p.locator("#settingsPanel").getByText("请在服务端配置 ASK 推理连接后重启", { exact: true }).waitFor();
    assert.equal(await p.locator("#askConnection, #askAdult").count(), 0);
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

test('ASK A4 production local: both inference protocols stream tools and drafts through subpath proxy, readonly secrets and zero generation',async()=>{
 const calls=[],browserRequests=[],errors=[];
 const secrets={openai:'synthetic-local-openai-only',anthropic:'synthetic-local-anthropic-only'};
 const rounds=new Map();
 const upstream=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const url=new URL(req.url,'http://localhost'),payload=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
  calls.push({path:url.pathname,headers:req.headers,payload,query:url.search});
  if(url.pathname==='/v1/models')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data:[{id:'local-test-model'}]}));
  if(!['/v1/chat/completions','/v1/messages'].includes(url.pathname))return res.writeHead(404).end();
  const n=(rounds.get(url.pathname)||0)+1;rounds.set(url.pathname,n);
  if(payload.tool_choice==='none'||payload.tool_choice?.type==='none'){
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   if(url.pathname.endsWith('/chat/completions'))res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'已将红眼睛改为蓝色，草稿请核对。'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
   else for(const e of [{type:'message_start',message:{usage:{input_tokens:100}}},{type:'content_block_start',index:0,content_block:{type:'text',text:'已将红眼睛改为蓝色，草稿请核对。'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:20}},{type:'message_stop'}])res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
   return res.end();
  }
  const all=payload.messages.map(m=>typeof m.content==='string'?m.content:(m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')).join('\n');
  const state=JSON.parse(all.match(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/)[1]);
  const name=n%2?'get_state':'propose_draft',input=n%2?{}:{base_hash:state.base_hash,draft_title:'本地草稿',steps:[{kind:'prompt_patch',target:'image.prompt',mode:'replace',anchor:'red eyes',text:'blue eyes'}]};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(url.pathname.endsWith('/chat/completions')){
   res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:`call_${n}`,type:'function',function:{name,arguments:JSON.stringify(input)}}]}}]})}\n\n`);
   res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  }else{
   const events=[{type:'message_start',message:{id:`m_${n}`,role:'assistant',usage:{input_tokens:100,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:`call_${n}`,name,input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:20}},{type:'message_stop'}];
   for(const e of events)res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);res.end();
  }
 });
 const upstreamUrl=await listen(upstream);
 const local=createLocalServer({env:{KOMA_BASE_PATH:'/app/',KOMA_ASK_OPENAI_URL:upstreamUrl+'/v1',KOMA_ASK_OPENAI_KEY:secrets.openai,KOMA_ASK_ANTHROPIC_URL:upstreamUrl,KOMA_ASK_ANTHROPIC_KEY:secrets.anthropic}});
 const origin=await listen(local),context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),p=await context.newPage();p.setDefaultTimeout(12000);
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>browserRequests.push({url:r.url(),headers:r.headers(),body:r.postData()}));
 await context.addInitScript(()=>localStorage.setItem('koma.prefs.v1',JSON.stringify({tagSuggest:false})));
 await context.route('https://tagsuggest.zeabur.app/**',r=>r.fulfill({json:{results:[]}}));
 try{
  await p.goto(origin+'/app/#/image/settings/ask');await p.locator('#askConnection').waitFor();
  assert.equal(await p.locator('#askConnection option').count(),3);
  for(const protocol of ['openai','anthropic']){
   await route(p,'#/image/settings/ask');await p.locator('#askConnection').selectOption(`local-ask-${protocol}`);
   await p.getByRole('button',{name:'获取',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('#askModelIds option').length===1);
   await p.locator('#askModel').fill('local-test-model');await p.locator('#askModel').blur();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('koma.ask.v1')).model==='local-test-model');
   await route(p,'#/image');await p.locator('#settingsPanel').waitFor({state:'hidden'});await p.locator('#prompt').fill('red eyes');
   await p.locator('#prompt').press('Control+k');await p.locator('#askDrawer.ask-inline').waitFor();await p.locator('#askPrompt').fill('读取当前状态，把红眼睛改为蓝色');await p.locator('#askPrompt').press('Enter');
   await p.locator('.ask-draft[data-status="pending"]').waitFor();assert.equal(await p.locator('#prompt').inputValue(),'red eyes');
   await p.locator('.ask-draft-apply').click();
   const checkpoint=p.locator('.ask-checkpoint').last();
   await checkpoint.getByRole('button',{name:'回退',exact:true}).waitFor();
   assert.equal(await checkpoint.getAttribute('data-state'),'applied');
   assert.equal(await p.locator('#prompt').inputValue(),'blue eyes');
   await p.locator('.ask-draft').waitFor({state:'detached'});
   await checkpoint.getByRole('button',{name:'回退',exact:true}).click();
   await checkpoint.getByRole('button',{name:'恢复',exact:true}).waitFor();
   assert.equal(await checkpoint.getAttribute('data-state'),'reverted');
   assert.equal(await p.locator('#prompt').inputValue(),'red eyes');
   assert.equal(await p.locator('.ask-draft').count(),0,'W3 rollback keeps its checkpoint and does not reopen the old card');
   await p.locator('#askPrompt').focus();await p.keyboard.press('Escape');await p.locator('#askDrawer').waitFor({state:'hidden'});
  }
  assert.equal(rounds.get('/v1/chat/completions'),3);assert.equal(rounds.get('/v1/messages'),3);
  for(const path of ['/v1/chat/completions','/v1/messages']){
   const last=calls.filter(c=>c.path===path).at(-1).payload;
   assert.deepEqual(last.tool_choice,path.endsWith('/messages')?{type:'none'}:'none');
  }
  assert.ok(calls.every(c=>['/v1/models','/v1/chat/completions','/v1/messages'].includes(c.path)));
  assert.equal(calls.find(c=>c.path==='/v1/chat/completions').headers.authorization,`Bearer ${secrets.openai}`);
  const a=calls.find(c=>c.path==='/v1/messages');assert.equal(a.headers['x-api-key'],secrets.anthropic);assert.equal(a.headers['anthropic-dangerous-direct-browser-access'],undefined);assert.ok(calls.every(c=>!c.headers['x-koma-local-token']));
  const stored=await p.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));const html=await p.content();
  for(const secret of [...Object.values(secrets),upstreamUrl])for(const text of [stored,html,JSON.stringify(browserRequests)])assert.equal(text.includes(secret),false);
  assert.equal(await p.evaluate(()=>localStorage.getItem('koma.routing.v1')),null);assert.ok(browserRequests.every(r=>new URL(r.url).origin===origin));
  const proxied=browserRequests.filter(r=>new URL(r.url).pathname.startsWith('/app/api/'));assert.ok(proxied.length>=6);assert.ok(proxied.every(r=>r.headers['x-koma-local-token']&&!r.headers.authorization&&!r.headers['x-api-key']));
  assert.deepEqual(errors,[]);
 }finally{await context.close();await close(local);await close(upstream);}
});
