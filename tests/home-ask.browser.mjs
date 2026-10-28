import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
let server,browser,origin;
before(async()=>{await mkdir('.local/hm3',{recursive:true});server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
const hosts = { image: "gateway.example.test", chat: "chat.example.test", claude: "claude.example.test" };
const reasoning = /^\/v1\/(?:chat\/completions|messages)$/;
async function open(hash, { ready = "#settingsPanel[open]", ask = null, standard = false, chatModel = false, touch = false, motion = "reduce", width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: motion, hasTouch: touch });
  const page = await context.newPage(), requests = [], errors = [], llm = [], calls = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(({ hosts, ask, standard }) => {
    if (!/^https?:/.test(location.protocol) || localStorage.getItem("koma.routing.v1")) return;
    const c = (id, name, baseUrl, profileId) => ({ id, name, baseUrl, profileId, credentialRef: `${id}-key`, revision: "rev1" });
    localStorage.setItem("koma.routing.v1", JSON.stringify({ version: 1, links: {}, connections: {
      image: c("image", "图像连接", `https://${hosts.image}/service`, standard ? "koma-standard-v1" : "openai-images-v1"),
      chat: c("chat", "推理 Chat", `https://${hosts.chat}/v1`, "openai-chat-v1"),
      claude: c("claude", "推理 Messages", `https://${hosts.claude}`, "anthropic-messages-v1"),
    } }));
    if (ask) localStorage.setItem("koma.ask.v1", JSON.stringify(ask));
    sessionStorage.setItem("koma.session.keys", JSON.stringify({ "image-key": "synthetic-image", "chat-key": "synthetic-chat", "claude-key": "synthetic-claude" }));
      localStorage.setItem("koma.prefs.v1", JSON.stringify({ tagSuggest: false }));
  }, { hosts, ask, standard });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (!Object.values(hosts).includes(url.hostname)) {
      errors.push(`unexpected external origin: ${url.origin}`);
      return route.abort();
    }
    requests.push({ host: url.hostname, path: url.pathname, method: request.method(), headers: request.headers() });
    if (standard && url.hostname === hosts.image) {
      if (url.pathname.endsWith("/image/models")) return route.fulfill({ json: {
        studio_features: { version: 2, max_cost: true }, valid_samplers: ["k_euler_ancestral", "k_euler"],
        models: { "nai-diffusion-5-full": { name: "NAI V5", provider: "novelai", max_resolution: 2200000, quota_group: "novelai" }, "nai-diffusion-4-5-full": { name: "NAI V4.5", provider: "novelai", max_resolution: 1048576, quota_group: "novelai" },
          ...(chatModel ? { "gpt-image-2": { name: "GPT Image 2", provider: "openai", operations: ["generate", "edit"], tools: ["image-edit"], quota_group: "openai",
            image_capabilities: { fields: { quality: { options: ["auto", "low", "high"], default: "auto" }, size: { options: ["1024x1024", "1536x1024"], default: "1024x1024" } } } } } : {}) },
      } });
      if (url.pathname.endsWith("/media/quota")) return route.fulfill({json:{credits:{remaining:100},images:{novelai:{used:0,remaining:100,limit:100}}}});
      if (url.pathname.endsWith("/token_stats_data")) return route.fulfill({json:{temp_limits:{is_temp:false}}});
      if (url.pathname.endsWith("/estimate")) return route.fulfill({json:{cost:1}});
    }
    if (request.method() === "GET" && url.pathname.endsWith("/v1/models"))
      return route.fulfill({ json: { data: url.hostname === hosts.image ? [{ id: "gpt-image-1.5" }] : [{ id: "reasoning-b" }, { id: "reasoning-a" }] } });
    if (request.method() === "POST" && url.hostname !== hosts.image && reasoning.test(url.pathname)) {
      // A scripted model: each request takes the next reply in line.
      const reply = llm.shift() ?? { body: openai(text("（脚本已用完）"), end()) };
      calls.push({ host: url.hostname, path: url.pathname, headers: request.headers(), raw: request.postData(), body: JSON.parse(request.postData()) });
      if (reply.wait) await reply.wait;
      if (reply.delay) await new Promise((done) => setTimeout(done, reply.delay));
      try {
        await route.fulfill({ status: reply.status ?? 200, contentType: reply.type ?? "text/event-stream", body: typeof reply.body === "function" ? reply.body(calls.at(-1).body) : reply.body });
      } catch {
        // The page aborted the request first.
      }
      return;
    }
    errors.push(`unexpected endpoint: ${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 404, json: { error: "Unexpected request" } });
  });
  await page.goto(origin + hash);
  await page.waitForSelector(ready);
  return { page, context, requests, errors, llm, calls };
}
const openai = (...chunks) => [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
const text = (content) => ({ choices: [{ index: 0, delta: { content } }] });
const tool = (id, name, input = {}) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(input) } }] } }] });
const end = (finish_reason = "stop") => ({ choices: [{ index: 0, delta: {}, finish_reason }], usage: { prompt_tokens: 1800, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1500 } } });
const anthropic = (...events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const askSettings = (over = {}) => ({ version: 1, connectionId: "chat", model: "reasoning-a", images: true, preference: "", words: [], replacements: [], alwaysCodec: false, ...over });
/** Generation, edit, upscale, quote and balance endpoints: ASK must never reach them. */
const generation = (requests) => requests.filter((r) => r.host === hosts.image && !r.path.endsWith("/v1/models"));
async function bind(page) {
  await page.evaluate(() => {
    const p = document.body.__vue_app__._instance.provides;
    for (const name of ["ask", "drawing", "editor", "chat", "home", "bridge", "slate", "app-shell", "ask-presentation"])
      window[name.replaceAll("-", "_")] = p[Object.getOwnPropertySymbols(p).find((k) => k.description === name)];
  });
}
async function addImage(page, prompt) {
  return page.evaluate(async (prompt) => {
    const canvas = new OffscreenCanvas(256, 384);
    const g = canvas.getContext("2d");
    g.fillStyle = "#7b3446";
    g.fillRect(0, 0, 256, 384);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const record = await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, blob, { width: 256, height: 384 }, { boardId: drawing.snapshot().activeBoardId, prompt, basePrompt: prompt, model: "gpt-image-1.5", modelName: "GPT Image", seed: 7 }, null);
    return record.id;
  }, prompt);
}

async function setup(options={}) { const t=await open('/#/home',{ready:'.home-head',ask:askSettings(),...options});await bind(t.page);await t.page.evaluate(()=>Promise.all([home.ready,ask.restored]));return t; }
async function clean(t){assert.deepEqual(t.errors,[]);assert.equal(generation(t.requests).length,0);await t.context.close();}
async function receive(page,steps,extra={}) {
 await page.evaluate(({steps,extra})=>bridge.importFile(new File([JSON.stringify({schema:'koma.bridge.draft.v1',draft_id:crypto.randomUUID(),source_label:'测试 Agent',draft_title:'HOME 草稿',steps,...extra})],'draft.inbox.json',{type:'application/json'})),{steps,extra});
 await page.waitForFunction(()=>!!ask.draftPlan.value);
}

test('HOME dock keeps one ASK; viewport preference, focus, scroll and floating window are restored',async()=>{
 const t=await setup();const {page}=t;
 try {
  await page.locator('.home-ask textarea').fill('尚未发送的两行\n第二行');
  await page.getByRole('button',{name:'打开 ASK',exact:true}).click();await page.waitForSelector('#askIsland[data-home="half"]');
  assert.equal(await page.locator('#askPrompt').inputValue(),'尚未发送的两行\n第二行');
  const identity=await page.locator('#askPrompt').elementHandle();
  const box=await page.locator('#askIsland').boundingBox();assert.equal(box.x,967);assert.equal(box.width,461);assert.equal(box.y,12);assert.equal(box.height,876);
  assert.equal(await page.locator('.home-settings .directory-chip').count(),0);assert.equal(await page.locator('.home-entries button').count(),4);
  assert.equal(await page.locator('#askDrawer [data-ask-grip]').count(),0);
  await page.getByRole('button',{name:'放大 ASK 窗口'}).click();await page.waitForSelector('#askIsland[data-home="full"]');
  assert.equal(await page.locator('.home-shell').getAttribute('inert'),'');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
  await page.getByRole('button',{name:'还原 ASK 窗口'}).click();
  for(const width of [320,390,768,1279]){await page.setViewportSize({width,height:900});await page.waitForSelector('#askIsland[data-home="full"]');assert.equal(await page.getByRole('button',{name:'还原 ASK 窗口'}).count(),0);const r=await page.locator('#askIsland').boundingBox();assert.equal(r.width,width);assert.equal(r.x,0);await page.screenshot({path:`.local/hm3/dock-${width}.png`});}
  await page.setViewportSize({width:1440,height:900});await page.waitForSelector('#askIsland[data-home="half"]');
  await page.evaluate(()=>app_shell.router.switchWorkspace('tags'));await page.waitForFunction(()=>document.querySelector('#askIsland').dataset.home===undefined);
  assert.equal(await identity.evaluate(el=>el===document.querySelector('#askPrompt')),true);
  await page.evaluate(()=>app_shell.router.switchWorkspace('home'));await page.waitForSelector('#askIsland[data-home="half"]');
  await page.getByRole('button',{name:'收起 ASK',exact:true}).click();await page.waitForSelector('.home-ask textarea');
  assert.equal(await page.locator('.home-ask textarea').inputValue(),'尚未发送的两行\n第二行');assert.equal(await page.locator('#askIsland').isVisible(),false);
  assert.equal(await page.locator('.home-ask textarea').evaluate(el=>el===document.activeElement),true);
 } finally {await clean(t);}
});

test('HOME collapsed run and result obey the same viewed/dismiss/stop rules; digest carries only real metadata',async()=>{
 const t=await setup();const {page}=t;
 try {
  await page.evaluate(async()=>{await drawing.renameBoard(drawing.snapshot().activeBoardId,'试验画板');});
  const image=await addImage(page,'原图的历史内容');await page.evaluate(async id=>{await drawing.toggleFavorite(drawing.snapshot().history.find(r=>r.id===id));},image);
  let release;const wait=new Promise(r=>release=r);t.llm.push({body:openai(text('光线可以更柔和。第二句只作补充。'),end()),wait});
  await page.locator('.home-ask textarea').fill('比较当前画板');await page.getByRole('button',{name:'发送给 ASK'}).click();
  await page.waitForFunction(()=>ask.running.value);await page.getByRole('button',{name:'收起 ASK',exact:true}).click();await page.waitForSelector('.home-note');
  assert.match(await page.locator('.home-note').innerText(),/正在/);assert.equal(await page.locator('.home-ask .think').count(),1);
  await page.locator('.home-ask textarea').fill('保留的下一句');release();await page.waitForFunction(()=>!ask.running.value);
  assert.match(await page.locator('.home-note').innerText(),/已完成.*光线可以更柔和/s);
  const raw=JSON.stringify(t.calls[0].body);
  assert.match(raw,/"?home/);assert.match(raw,/#f1/);assert.match(raw,/试验画板/);
  const texts=t.calls[0].body.messages.flatMap(m=>typeof m.content==='string'?[m.content]:m.content.filter(b=>b.type==='text').map(b=>b.text));
  const sent=texts.find(text=>text.includes('<workspace_state>\n'));assert.ok(sent,JSON.stringify(texts).slice(-6000));
  const digest=JSON.parse(sent.split('<workspace_state>\n')[1].split('\n</workspace_state>')[0]);
  assert.equal(digest.workspace,'home');assert.equal(digest.home.finals.count,1);assert.equal(digest.home.finals.recent[0].id,'#f1');assert.ok(digest.chat);assert.ok(!JSON.stringify(digest.home).includes('blob:'));
  await page.locator('.home-note-open').click();await page.getByRole('button',{name:'收起 ASK',exact:true}).click();assert.equal(await page.locator('.home-note').count(),0);
  t.llm.push({body:openai(text('窗口中完成的结果。'),end())});await page.getByRole('button',{name:'打开 ASK',exact:true}).click();await page.locator('#askPrompt').fill('第二轮');await page.locator('#askDrawer').getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.filter(e=>e.type==='turn').length===2);
  await page.keyboard.press('Control+j');assert.match(await page.locator('.home-note').innerText(),/窗口中完成/);
  await page.locator('.home-note-open').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.home-note').count(),0);
  let unblock;const hold=new Promise(r=>unblock=r);t.llm.push({body:openai(text('不会完成'),end()),wait:hold});await page.locator('.home-ask textarea').fill('停止这一轮');await page.getByRole('button',{name:'发送给 ASK'}).click();await page.waitForFunction(()=>ask.running.value);await page.getByRole('button',{name:'收起 ASK',exact:true}).click();await page.getByRole('button',{name:'停止 ASK',exact:true}).click();unblock();await page.waitForFunction(()=>!ask.running.value);assert.match(await page.locator('.home-note').innerText(),/已停止/);
  await page.evaluate(()=>ask.newConversation());assert.equal(await page.locator('.home-note').count(),0);
 } finally {await clean(t);}
});

test('HOME external drafts review inside the same card; Slate stays HOME and image apply switches without generating',async()=>{
 const t=await setup();const {page}=t;
 try {
  await receive(page,[{kind:'slate_edit',op:'create',slate_title:'首页任务',todos:[{op:'add',todo_title:'整理配方',image_required:false}]}]);
  assert.match(await page.locator('.home-note').innerText(),/草稿待确认/);assert.equal(await page.locator('.home-note-x').count(),0);assert.equal(await page.locator('.home-note .ask-draft-apply').count(),0);
  await page.locator('.home-note-open').click();await page.locator('#askFullDraft .ask-draft-apply').click();await page.waitForFunction(()=>!ask.draftPlan.value);
  assert.match(page.url(),/#\/home$/);await page.getByRole('button',{name:'收起 ASK',exact:true}).click();assert.match(await page.locator('.home-note').innerText(),/已写入/);await page.waitForSelector('.home-note',{state:'detached',timeout:5000});
  await receive(page,[{kind:'prompt_patch',target:'image.prompt',mode:'rewrite',text:'quiet afternoon'}]);await page.locator('.home-note-open').click();
  assert.equal(await page.locator('#askFullDraft .ask-draft-apply').innerText(),'切到绘图并应用');
  await page.locator('#askFullDraft .ask-draft-apply').click();await page.waitForURL('**/#/image');assert.equal(await page.locator('#prompt').inputValue(),'quiet afternoon');
  await page.evaluate(()=>ask.undoDraft());assert.equal(await page.locator('#prompt').inputValue(),'');
 } finally {await clean(t);}
});

test('HOME transitions clean temporary names; disabled and reduced motion take the direct path',async()=>{
 const t=await setup({motion:'no-preference'});const {page}=t;
 try {
  await page.evaluate(()=>{window.vtSeen=[];const start=document.startViewTransition.bind(document);document.startViewTransition=(callback)=>{const t=start(callback);t.ready.then(()=>vtSeen.push({kind:document.documentElement.dataset.homeVt,names:[...document.querySelectorAll('[style*="view-transition-name"]')].map(e=>e.style.viewTransitionName)})).catch(e=>vtSeen.push({error:e.message}));return t;};});
  await page.locator('.home-ask textarea').fill('带回这段文字');await page.getByRole('button',{name:'打开 ASK',exact:true}).click();await page.waitForSelector('#askIsland[data-home="half"]');await page.waitForFunction(()=>!document.documentElement.dataset.homeVt);
  await page.screenshot({path:'.local/hm3/half-1440.png'});
  await page.getByRole('button',{name:'收起 ASK',exact:true}).click();await page.waitForSelector('.home-ask textarea');await page.waitForFunction(()=>!document.documentElement.dataset.homeVt);
  assert.equal(await page.locator('.home-ask textarea').inputValue(),'带回这段文字');assert.equal(await page.locator('[style*="view-transition-name"]').count(),0);
  const seen=await page.evaluate(()=>vtSeen);assert.ok(seen.some(v=>v.kind==='open'),JSON.stringify(seen));assert.ok(seen.some(v=>v.kind==='close'));assert.ok(!seen.some(v=>v.error),JSON.stringify(seen));
  await page.evaluate(()=>{ask.show();ask.hide();ask.show();});await page.waitForSelector('#askIsland[data-home="half"]');await page.waitForFunction(()=>!document.documentElement.dataset.homeVt);
  await page.getByRole('button',{name:'收起 ASK',exact:true}).click();await page.waitForFunction(()=>!document.documentElement.dataset.homeVt);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>vtSeen.length=0);await page.getByRole('button',{name:'打开 ASK',exact:true}).click();assert.equal(await page.evaluate(()=>vtSeen.length),0);await page.getByRole('button',{name:'收起 ASK',exact:true}).click();
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>document.startViewTransition=undefined);await page.getByRole('button',{name:'打开 ASK',exact:true}).click();await page.waitForSelector('#askIsland[data-home="half"]');
 } finally {await clean(t);}
});


test('HOME drops keep original attachments and preview caches display-only; full dock retains page scroll',async()=>{
 const t=await setup();const {page}=t;
 try {
  const id=await addImage(page,'用于附件的原图');await page.evaluate(async id=>{await drawing.toggleFavorite(drawing.snapshot().history.find(r=>r.id===id));},id);
  const drop=async(selector,values)=>page.locator(selector).evaluate((el,values)=>{const data=new DataTransfer();for(const [k,v] of Object.entries(values))data.setData(k,v);el.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:data}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));},values);
  await drop('.home-ask',{'application/x-koma-home-picture':JSON.stringify({kind:'favorite',recordId:id})});await page.waitForFunction(()=>ask.tray.value.length===1);
  assert.equal(await page.evaluate(()=>ask.tray.value[0].kind),'image');assert.equal(t.calls.length,0);assert.equal(await page.locator('#askDrawer').isVisible(),true);
  await page.getByRole('button',{name:'收起 ASK',exact:true}).click();
  await drop('.home-ask',{'application/x-koma-home-picture':JSON.stringify({kind:'preview',boardId:'fake'})});assert.equal(await page.evaluate(()=>ask.tray.value.length),1);
  await page.getByRole('button',{name:'收起 ASK',exact:true}).click();
  await page.locator('.home-ask').evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['a character reference'],'设定.txt',{type:'text/plain'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));});await page.waitForFunction(()=>ask.tray.value.length===2);assert.equal(t.calls.length,0);
  await page.getByRole('button',{name:'收起 ASK',exact:true}).click();
  await page.setViewportSize({width:1440,height:500});await page.evaluate(()=>scrollTo(0,200));
  await page.evaluate(()=>ask.show());await page.waitForSelector('#askIsland[data-home="half"]');const scroll=await page.evaluate(()=>scrollY);await page.getByRole('button',{name:'放大 ASK 窗口'}).click();await page.waitForSelector('#askIsland[data-home="full"]');await page.getByRole('button',{name:'还原 ASK 窗口'}).click();assert.equal(await page.evaluate(()=>scrollY),scroll);
 } finally {await clean(t);}
});

test('HOME projects only committed mask coverage and explicitly retained Photopea edits',async()=>{
 const t=await setup();const {page}=t;
 try {
  const id=await addImage(page,'测试蒙版');await page.evaluate(async id=>{const r=drawing.snapshot().history.find(r=>r.id===id);await editor.open('image',r.blob,'测试图',{sourceId:id,settings:r.params});},id);
  await page.evaluate(()=>{
    editor.writeMask(editor.session,{width:256,height:384,strokes:[{points:[{x:20,y:20}],diameter:30,erase:false,pointer:1}],position:1});
    app_shell.router.switchWorkspace('home');
  });await page.waitForFunction(()=>home.snapshot().current?.status==='蒙版未重绘');
  assert.equal(await page.evaluate(()=>home.snapshot().current.workspace),'edit');
  await page.evaluate(()=>editor.writeMask(editor.session,{width:256,height:384,strokes:[{clear:true}],position:1}));await page.waitForFunction(()=>home.snapshot().current?.status==='');
  await page.evaluate(async()=>{await editor.open('image');const start=editor.beginExternalEdit();editor.cancelExternalEdit(start.id,true);app_shell.router.switchWorkspace('home');});await page.waitForFunction(()=>home.snapshot().current?.status==='高级编辑未应用');
 } finally {await clean(t);}
});
