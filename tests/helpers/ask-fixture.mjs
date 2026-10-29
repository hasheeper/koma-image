import { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "./vite.mjs";
import { chromium } from "playwright";

let server, browser, origin;

// Enter accepts an open picture candidate; these tests exercise sending an already composed question.
async function submitAsk(page) {
  if (await page.locator('#askPictureSuggestions').isVisible()) await page.locator('#askPrompt').press('Escape');
  await page.locator('#askPrompt').press('Enter');
}

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

const drawer = (page) => page.locator("#askDrawer");

/** The compact 更多 menu holds compaction and call debugging. */
async function openMore(page) {
  await drawer(page).getByRole("button", { name: "更多", exact: true }).click();
  return page.locator("#askMoreMenu");
}

async function openDebug(page) {
  await (await openMore(page)).getByRole("menuitem", { name: /调用调试/ }).click();
}

/** The full draft body starts collapsed and stays as the user left it. */
async function openDraft(page) {
  const toggle = page.locator('#askFullDraft .draft-toggle[aria-expanded="false"]');
  if (await toggle.count()) await toggle.click();
}

async function openApplyMenu(page) {
  await page.locator('#askFullDraft').getByRole('button', { name: '选择应用方式', exact: true }).click();
  return page.locator('.draft-apply-menu:popover-open');
}

const route = (page, hash) => page.evaluate((hash) => (location.hash = hash), hash);

const stored = (page, key) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);

async function addScene(page, variant = 0) {
  return page.evaluate(async (variant) => {
    const canvas = new OffscreenCanvas(1024, 768), g = canvas.getContext('2d');
    g.fillStyle = '#17243a'; g.fillRect(0, 0, 1024, 768);
    g.fillStyle = variant ? '#df8054' : '#5699ce';
    g.fillRect(300, 180, 160, 120); g.fillRect(550, 180, 160, 120);
    g.fillStyle = '#334a3e'; g.fillRect(0, 550, 1024, 218);
    const blob = await canvas.convertToBlob({type:'image/png'});
    const record = await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, blob, {width:1024,height:768}, {
      model:'gpt-image-1.5', modelName:'GPT Image', seed:variant,
      prompt:variant ? 'landscape, warm light, blue details' : 'landscape, blue details',
      basePrompt:variant ? 'landscape, warm light, blue details' : 'landscape, blue details',
      scale:variant ? 7 : 5,
    }, null);
    return record.id;
  }, variant);
}

const toolReply = (id, name, input) => ({body:openai(tool(id,name,input),end('tool_calls'))});

const textReply = (value) => ({body:openai(text(value),end())});

const imageBlocks = (body) => body.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'image_url') : []);

// A2 exercises the actual provider → tool → preview → user confirmation path.
const patchStep = (mode, anchor, text, target = 'image.prompt') => ({kind:'prompt_patch',target,mode,anchor,text});

const proposal = (steps, title = '调整提示词') => ({body: request => {
  const content=[...request.messages].reverse().find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('<workspace_state>')).content;
  const state=JSON.parse(content.match(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/)[1]);
  return openai(text('保留已有特征，只调整指定部分。'),tool('draft_1','propose_draft',{base_hash:state.base_hash,draft_title:title,steps}),end('tool_calls'));
}});

async function askDraft(page,llm,steps,question='把红眼睛改为蓝眼睛',title) {
  llm.push(proposal(steps,title));
  await page.evaluate(()=>ask.show());
  await page.locator('#askPrompt').fill(question);
  await submitAsk(page);
  await page.locator('.ask-draft[data-status="pending"]').waitFor();
  await openDraft(page);
}

const form = page => page.evaluate(()=>({...drawing.snapshot().form}));

const applyDraft = async page => {await page.locator('.ask-draft-apply').click();await page.waitForFunction(()=>!ask.writingDraft.value && !ask.draftPlan.value && ask.appliedDraft.value);};

const reverted = page => page.waitForFunction(()=>!ask.writingDraft.value && ask.redoId.value !== null);

const undoCheckpoint = async page => {await page.locator('.ask-checkpoint').getByRole('button',{name:'回退',exact:true}).click();await reverted(page);};

const restoreCheckpoint = async page => {await page.locator('.ask-checkpoint').getByRole('button',{name:'恢复',exact:true}).click();await page.waitForFunction(()=>!ask.writingDraft.value && ask.redoId.value === null);};

const billing=list=>list.filter(r=>/\/(estimate|media\/quota|token_stats_data)$/.test(r.path));

const handoffStep=(images,text,options={size:'1536x1024'})=>({kind:'chat_handoff',images,options,text});

async function seedAskChat(page) {
  await page.evaluate(async()=>{
    const d=await import('/src/domain/conversation.ts');
    const canvas=new OffscreenCanvas(64,64),g=canvas.getContext('2d');
    const assets=[];
    for(let i=0;i<3;i++){g.fillStyle=['#4b638b','#866152','#746085'][i];g.fillRect(0,0,64,64);assets.push((await chat.assets.add(await canvas.convertToBlob({type:'image/png'}),`synthetic${i}`,{width:64,height:64})).id);}
    chat.mutate(c=>{for(let i=0;i<3;i++){const {turn,version}=d.beginTurn(c,d.contextSnapshot(c),`第 ${i+1} 轮描述`,{});d.completeVersion(c,turn,version,[{type:'image',assetId:assets[i]}],null,c.selectionRevision);}c.prompt='原来的下一轮';});
    await chat.flush();
  });
}

const islandMode = (page, mode) => page.locator(`#askIsland[data-mode="${mode}"]`).waitFor();

// W2: conversations live in page memory; each keeps its own input, draft and calls.
const openConversations = async (page) => {
  await drawer(page).locator('.ask-conv').click();
  return page.locator('#askConvMenu');
};

const heading = (page) => drawer(page).locator('.ask-conv-title').textContent();

async function askText(page, llm, question, answer = '模拟回答') {
  llm.push({body: openai(text(answer), end())});
  await page.evaluate(() => ask.show());
  await page.locator('#askPrompt').fill(question); await submitAsk(page);
  await page.waitForFunction(() => !ask.running.value && ask.entries.value.at(-1)?.type === 'turn');
}

async function editQuestion(page, index = 0) {
  const turn = drawer(page).locator('.ask-turn').nth(index);
  await turn.locator('.ask-u').hover();
  await turn.getByRole('button', {name:'编辑提问',exact:true}).click();
  await page.getByRole('textbox', {name:'编辑提问',exact:true}).waitFor();
  return page.getByRole('textbox', {name:'编辑提问',exact:true});
}

// W5: synthetic files only, isolated profiles and scripted inference.
async function attachImage(page, {width=256,height=384,name='参考.png',type='image/png'}={}) {
  const bytes=await page.evaluate(async ({width,height,type})=>{
    const c=new OffscreenCanvas(width,height),g=c.getContext('2d');
    g.fillStyle='#8365b3';g.fillRect(0,0,width,height);g.fillStyle='#eed29a';g.fillRect(width/4,height/4,width/2,height/2);
    return [...new Uint8Array(await (await c.convertToBlob({type})).arrayBuffer())];
  },{width,height,type});
  await drawer(page).locator('input[type=file]').setInputFiles({name,mimeType:type,buffer:Buffer.from(bytes)});
  await page.waitForFunction(()=>ask.preparing.value===0);
  return Buffer.from(bytes);
}

async function attachText(page,text='角色设定：蓝色外套',name='角色设定.md') {
  await drawer(page).locator('input[type=file]').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});
  await page.waitForFunction(()=>ask.preparing.value===0);
}

const attachedImages=body=>body.messages.filter(m=>m.role==='user').flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>['image','image_url'].includes(b.type));

const scripted=(connection,name,input)=>connection==='chat'?openai(name?tool('a',name,input):text('附件已核对。'),end(name?'tool_calls':'stop')):anthropic(
  {type:'message_start',message:{usage:{input_tokens:50}}},
  {type:'content_block_start',index:0,content_block:name?{type:'tool_use',id:'a',name,input:{}}:{type:'text',text:'附件已核对。'}},
  ...(name?[{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}}]:[]),
  {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:name?'tool_use':'end_turn'},usage:{output_tokens:10}},{type:'message_stop'});

// Deliver actual bubbling events: ASK must stop them before workspace listeners.
async function pasteSynthetic(page,selector,{text='',file=false}={}) {
  await page.locator(selector).focus();
  return page.locator(selector).evaluate(async(el,{text,file})=>{
    const data=new DataTransfer();if(text)data.setData('text/plain',text);
    if(file){const c=new OffscreenCanvas(32,48),g=c.getContext('2d');window.attachmentSequence=(window.attachmentSequence??0)+1;g.fillStyle=`rgb(${window.attachmentSequence*40},50,90)`;g.fillRect(0,0,32,48);data.items.add(new File([await c.convertToBlob({type:'image/png'})],'粘贴.png',{type:'image/png'}));}
    const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});el.dispatchEvent(event);return event.defaultPrevented;
  },{text,file});
}

async function dragSynthetic(page,selector,type,{history='',file=true}={}) {
  await page.locator(selector).evaluate(async(el,{type,history,file})=>{
    const data=new DataTransfer();if(history)data.setData('application/x-koma-history',history);
    if(file){const c=new OffscreenCanvas(32,48);c.getContext('2d');data.items.add(new File([await c.convertToBlob({type:'image/png'})],'拖入.png',{type:'image/png'}));}
    el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));
  },{type,history,file});
}

// Context isolation: old workspace text is fetched only when the turn asks for it.
const wireStates = body => body.messages.filter(m=>m.role==='user'||m.role==='tool').flatMap(m=>typeof m.content==='string'?[m.content]:(m.content??[]).flatMap(b=>b.type==='text'?[b.text]:b.type==='tool_result'?(b.content??[]).filter(p=>p.type==='text').map(p=>p.text):[])).flatMap(t=>[...t.matchAll(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/g)].map(m=>JSON.parse(m[1])));

async function savedAsk(page) {
  return page.evaluate(async () => {
    const { names } = await import('/src/storage/names.ts'), { idbRequest } = await import('/src/storage/databases.ts');
    const p = document.body.__vue_app__._context.provides, s = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
    return idbRequest(s.databases.transaction(names.databases.ask, 'conversations').objectStore('conversations').getAll());
  });
}

async function reloadAsk(page) {
  await page.reload(); await page.waitForSelector('.switcher'); await bind(page);
  await page.waitForFunction(() => ask.favoritesReady.value);
  await page.evaluate(() => ask.show());
}

const cp2Reply = (connectionId, content, input = 2400) => ({ body: connectionId === 'chat'
  ? openai(text(content), { ...end(), usage: { prompt_tokens: input, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1200 } } })
  : anthropic({ type: 'message_start', message: { usage: { input_tokens: input - 1500, cache_read_input_tokens: 1200, cache_creation_input_tokens: 300 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: content } },
    { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } }, { type: 'message_stop' }) });

async function cp2Send(page, question) {
  await page.evaluate(async q => { ask.setInput(q); await ask.send(); }, question);
  assert.equal(await page.evaluate(() => ask.entries.value.at(-1).turn.status), 'done');
}

async function cp2History(page, llm, connectionId) {
  await bind(page); await page.waitForFunction(() => ask.favoritesReady.value);
  await page.evaluate(async () => {
    await drawing.patch({ prompt: 'CP2 originally sent state' });
    await ask.addFiles([new File(['甲'.repeat(50_000)], 'cp2-long.md', { type: 'text/plain' })]); ask.show();
  });
  for (let i = 1; i <= 6; i++) { llm.push(cp2Reply(connectionId, `回答 ${i}。`, 2400 + i)); await cp2Send(page, `成功提问 ${i}`); }
  await page.evaluate(() => ask.toggleFavorite());
}

const cp2Result = call => {
  const m = call.body.messages.at(-1), raw = typeof m.content === 'string' ? m.content : m.content.find(b => b.type === 'tool_result').content[0].text;
  return JSON.parse(raw.slice(7, -8));
};

const cp2Marks = body => (JSON.stringify(body).match(/"cache_control":/g) ?? []).length;

const cp2Plain = value => JSON.parse(JSON.stringify(value, (key, value) => key === 'cache_control' ? undefined : value));

const cp2Context = session => { const { usage, ...context } = session; return context; };

const cp3HasMemory = body => body.messages.some(m => m.role === 'user' && (typeof m.content === 'string'
  ? m.content.startsWith('<session_memory>') : m.content.some(b => b.type === 'text' && b.text.startsWith('<session_memory>'))));

async function cp3Threshold(page, highWaterTokens) {
  await page.evaluate(async highWaterTokens => {
    const p = document.body.__vue_app__._context.provides, s = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
    await s.preferences.set('koma.ask.v1', { ...ask.settings.value, compaction: { highWaterTokens } });
  }, highWaterTokens);
}

async function cp3Manual(page, llm, connectionId, memo = '边界内的合成备忘录。') {
  llm.push(cp2Reply(connectionId, `<memo>${memo}</memo>`));
  await (await openMore(page)).getByRole('menuitem', { name: '压缩上下文', exact: true }).click();
  await page.waitForFunction(() => !ask.running.value && !!ask.memory.value);
}

export function useAskFixture() {
before(async () => {
  await mkdir(".local/ask/window", { recursive: true });
  await mkdir(".local/ask/w5", { recursive: true });
  await mkdir(".local/ask/w6", { recursive: true });
  await mkdir(".local/ask/markdown", { recursive: true });
  await mkdir(".local/ask/island", { recursive: true });
  await mkdir(".local/ask/a4", { recursive: true });
  await mkdir(".local/ask/a3", { recursive: true });
  await mkdir(".local/ask/a2", { recursive: true });
  await mkdir(".local/ask/a1", { recursive: true });
  await mkdir(".local/ask/h4", { recursive: true });
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false, hmr: false } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
}

export { server, browser, origin, submitAsk, hosts, reasoning, open, openai, text, tool, end, anthropic, askSettings, generation, bind, addImage, drawer, openMore, openDebug, openDraft, openApplyMenu, route, stored, addScene, toolReply, textReply, imageBlocks, patchStep, proposal, askDraft, form, applyDraft, reverted, undoCheckpoint, restoreCheckpoint, billing, handoffStep, seedAskChat, islandMode, openConversations, heading, askText, editQuestion, attachImage, attachText, attachedImages, scripted, pasteSynthetic, dragSynthetic, wireStates, savedAsk, reloadAsk, cp2Reply, cp2Send, cp2History, cp2Result, cp2Marks, cp2Plain, cp2Context, cp3HasMemory, cp3Threshold, cp3Manual };
