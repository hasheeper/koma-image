import { readFileSync } from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "./helpers/vite.mjs";
import { bind } from "./helpers/native-fixture.mjs";
import { routing, config, complete, adjustableConfig, controlledConfig, nodeInfo } from "./helpers/comfy-fixture.mjs";

let server, browser, origin;
before(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
async function open(configured = true) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), calls = [], systemCalls = [], errors = [], state = { hold: false, failure: false, count: 0, systemStats: { system: { ram_total:64*1024**3,ram_free:48*1024**3,comfyui_version:"0.31.0" }, devices: [{name:"Mock RTX 4090",type:"cuda",index:0,vram_total:24*1024**3,vram_free:6*1024**3}] } };
  page.setDefaultTimeout(12000); page.on("pageerror", e => errors.push(e.message));
  await page.goto("about:blank");
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 320; c.height = 192;
    c.getContext("2d").fillRect(0, 0, 320, 192); return c.toDataURL().split(",")[1];
  }), "base64");
  await context.addInitScript(({ routing, configured }) => {
    if (!/^https?:/.test(location.protocol)) return;
    if (configured && !localStorage.getItem("koma.routing.v1")) localStorage.setItem("koma.routing.v1", JSON.stringify(routing));
    if (!localStorage.getItem("koma.prefs.v1")) localStorage.setItem("koma.prefs.v1", JSON.stringify({ model: "comfyui:gpu", tagSuggest: false, prompt: "  exact words  ", seed: "0", width: 0, qualityPreset: "best", naiMode: "furry" }));
  }, { routing, configured });
  await context.route("https://comfy.example.test/**", async route => {
    const req = route.request(), url = new URL(req.url());
    (url.pathname.endsWith("/system_stats") ? systemCalls : calls).push({ path: url.pathname, search: url.searchParams, body: req.postDataJSON(), headers: req.headers() });
    if (url.pathname.endsWith("/system_stats")) { await state.systemWait; return state.systemFailure ? route.fulfill({status:503,json:{error:"mock offline"}}) : route.fulfill({ json: state.systemStats }); }
    if (url.pathname.includes("/object_info/")) {
      await state.infoWait;
      const type = decodeURIComponent(url.pathname.split('/').at(-1));
      return state.infoFailure ? route.fulfill({ status: 503, json: { error: 'mock unavailable' } }) : route.fulfill({ json: (state.nodeInfo ?? nodeInfo)(type) });
    }
    if (url.pathname.endsWith("/prompt")) { state.count++; return route.fulfill({ json: { prompt_id: `job${state.count}` } }); }
    if (url.pathname.includes("/history/")) return route.fulfill({ json: state.hold ? {} : state.failure ? { [url.pathname.split("/").at(-1)]: { status: { status_str: "error" }, outputs: {} } } : complete(url.pathname.split("/").at(-1)) });
    if (url.pathname.endsWith("/view")) return route.fulfill({ contentType: "image/png", body: png });
    if (url.pathname.endsWith("/queue")) return route.fulfill({ json: {} });
    errors.push(`unexpected request ${url.pathname}`); return route.abort();
  });
  await page.goto(origin + (configured ? "/#/image" : "/#/image/settings/connections")); await bind(page);
  if (configured) await page.waitForFunction(() => drawing.snapshot().model?.profileId === "comfyui-workflow");
  return { page, context, calls, systemCalls, errors, state, png, close: async () => { await context.close(); assert.deepEqual(errors, []); } };
}
const submissions = t => t.calls.filter(c => c.path.endsWith("/prompt"));

test("Comfy UI: configure anonymous API workflow, reject canvas JSON, persist and update bindings", async () => {
  const t = await open(false), p = t.page;
  try {
    await p.getByRole("button", { name: "配置供应商", exact: true }).first().click();
    await p.locator("#connectionProtocol").selectOption("comfyui-workflow");
    await p.getByRole("button", { name: "下一步", exact: true }).click();
    await p.getByRole("alert").filter({ hasText: "请填写供应商名称" }).waitFor();
    await p.locator("#connectionName").fill("Studio workflow"); await p.locator("#connectionUrl").fill("https://comfy.example.test/prefix");
    assert.equal(await p.locator("#supplier-page-workflow").isVisible(), false);
    await p.getByRole("button", { name: "下一步", exact: true }).click();
    assert.equal(await p.locator("#connectionName").isVisible(), false);
    assert.equal(await p.getByRole("radio", { name: "上传文件", exact: true }).isChecked(), true);
    await p.getByText("粘贴 JSON", { exact: true }).click();
    await p.locator("#comfyWorkflow").fill('{"nodes":[]}');
    await p.getByRole("alert").filter({ hasText: "请导出 API 格式 JSON" }).waitFor();
    await p.locator("#comfyWorkflow").fill(JSON.stringify(config.workflow));
    await p.locator("#comfyPrompt").selectOption(JSON.stringify(["6", "prompt_text"]));
    assert.deepEqual(await p.locator("#comfySeed").evaluate(e => [...e.selectedOptions].map(o => JSON.parse(o.value))), [["3", "seed"], ["3", "noise_seed"]]);
    await p.getByRole("button", { name: "上一页", exact: true }).click();
    assert.equal(await p.locator("#connectionName").inputValue(), "Studio workflow");
    assert.equal(await p.evaluate(() => Object.keys(services.connections.configuration.connections).length), 0);
    await p.getByRole("button", { name: "下一步", exact: true }).click();
    assert.equal(await p.locator("#comfyPrompt").inputValue(), JSON.stringify(["6", "prompt_text"]));
    assert.equal(await p.locator("#comfyWorkflow").inputValue(), JSON.stringify(config.workflow));
    await p.locator(".supplier-form").getByRole("button", { name: "保存", exact: true }).click();
    await p.locator(".supplier-form").waitFor({ state: "hidden" });
    assert.equal(t.calls.length, 0, "configuration performs no Comfy request");
    const saved = await p.evaluate(() => Object.values(services.connections.configuration.connections)[0]);
    assert.equal(saved.authMode, "none"); assert.deepEqual(saved.comfyWorkflows[0].bindings, config.bindings);
    let finishCheck;
    t.state.systemWait = new Promise(resolve => { finishCheck = resolve; });
    await p.getByRole("button", { name: "测试连接", exact: true }).click();
    assert.equal(await p.getByRole("button", { name: "测试连接", exact: true }).getAttribute("aria-busy"), "true");
    assert.match(await p.getByRole("button", { name: "测试连接", exact: true }).textContent(), /测试中/);
    finishCheck();
    await p.waitForFunction(() => document.querySelector(".conn-card .st")?.textContent.includes("ComfyUI 可达"));
    assert.equal(t.systemCalls.length, 1);
    await p.locator(".conn-models").click();
    assert.equal(await p.getByRole("tab", { name: "工作流", exact: true }).getAttribute("aria-selected"), "true");
    await p.getByText("粘贴 JSON", { exact: true }).click();
    const changed = structuredClone(config.workflow); changed["4"].inputs.strength_model = 0.8;
    await p.locator("#comfyWorkflow").fill(JSON.stringify(changed));
    assert.equal(await p.locator("#comfyPrompt").inputValue(), JSON.stringify(["6", "prompt_text"]));
    changed["6"].class_type = "DifferentPrompt";
    await p.locator("#comfyWorkflow").fill(JSON.stringify(changed));
    assert.equal(await p.locator("#comfyPrompt").inputValue(), "");
    await p.locator(".supplier-form").getByRole("button", { name: "取消", exact: true }).click();
    await p.evaluate(() => location.hash = "#/image");
    await p.waitForFunction(() => drawing.snapshot().models.some(m => m.name === "工作流 1"));
    await p.reload(); await bind(p);
    assert.equal(await p.evaluate(() => Object.values(services.connections.configuration.connections)[0].authMode), "none");
    assert.equal(submissions(t).length, 0);
  } finally { await t.close(); }
});

test("Comfy UI: upload/paste share a workflow, pages retain Key, cancelled file reads cannot overwrite a reopened form", async () => {
  const t = await open(false), p = t.page;
  const upload = async (name, value) => {
    await p.locator("#comfyWorkflowFile").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(value) });
    if (name !== "slow.json") await p.locator('.comfy-fields[aria-busy="false"]').waitFor();
  };
  try {
    await p.getByRole("button", { name: "配置供应商", exact: true }).first().click();
    await p.locator("#connectionProtocol").selectOption("comfyui-workflow");
    await p.locator("#connectionName").fill("Uploaded workflow");
    await p.locator("#connectionUrl").fill("https://comfy.example.test/prefix");
    await p.locator("#connectionKey").fill("synthetic-upload-key");
    await p.getByRole("button", { name: "下一步", exact: true }).click();
    await p.evaluate(() => {
      const read = File.prototype.text;
      File.prototype.text = function () {
        return this.name === "slow.json" ? new Promise(resolve => { window.finishComfyRead = () => read.call(this).then(resolve); }) : read.call(this);
      };
    });
    await upload("slow.json", "\uFEFF" + JSON.stringify(config.workflow));
    assert.equal(await p.locator(".comfy-fields").getAttribute("aria-busy"), "true");
    assert.equal(await p.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
    await p.getByRole("button", { name: "上一页", exact: true }).click();
    assert.equal(await p.locator("#connectionKey").inputValue(), "synthetic-upload-key");
    await p.getByRole("tab", { name: "工作流", exact: true }).click();
    await p.evaluate(() => window.finishComfyRead());
    await p.locator("#comfyPrompt").selectOption(JSON.stringify(["6", "prompt_text"]));
    await upload("canvas.json", '{"nodes":[]}');
    await p.getByRole("alert").filter({ hasText: "请导出 API 格式 JSON" }).first().waitFor();
    await p.getByRole("button", { name: "保存", exact: true }).click();
    assert.equal(await p.evaluate(() => Object.keys(services.connections.configuration.connections).length), 0);
    await upload("workflow_api.json", JSON.stringify(config.workflow));
    await p.getByText("粘贴 JSON", { exact: true }).click();
    assert.deepEqual(JSON.parse(await p.locator("#comfyWorkflow").inputValue()), config.workflow);
    assert.equal(await p.locator("#comfyPrompt").inputValue(), JSON.stringify(["6", "prompt_text"]));
    await p.getByRole("button", { name: "保存", exact: true }).click();
    await p.locator(".supplier-form").waitFor({ state: "hidden" });
    const saved = await p.evaluate(() => {
      const c = Object.values(services.connections.configuration.connections)[0];
      return { authMode: c.authMode, key: services.vault.key(c.credentialRef), config: {workflow:c.comfyWorkflows[0].workflow,bindings:c.comfyWorkflows[0].bindings} };
    });
    assert.equal(saved.authMode, "bearer"); assert.equal(saved.key, "synthetic-upload-key"); assert.deepEqual(saved.config, config);
    await p.locator(".conn-models").click();
    await upload("slow.json", JSON.stringify({ "20": { class_type: "CancelledUpload", inputs: {} } }));
    await p.locator(".supplier-form").getByRole("button", { name: "取消", exact: true }).click();
    await p.locator(".conn-models").click();
    await p.evaluate(() => window.finishComfyRead());
    await p.getByText("粘贴 JSON", { exact: true }).click();
    assert.deepEqual(JSON.parse(await p.locator("#comfyWorkflow").inputValue()), config.workflow);
    await p.locator(".supplier-form").getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(t.calls.length, 0, "importing files and changing pages never calls ComfyUI");
  } finally { await t.close(); }
});

test("Comfy IMAGE: original bytes, actual recipe, favorite persistence, download and history lifetime", async () => {
  const t = await open(), p = t.page;
  try {
    assert.equal(t.calls.length, 0);
    assert.equal(await p.locator("#width").count(), 0);
    await p.locator("#tab-negative").click(); assert.equal(await p.locator("#negative").getAttribute("readonly"), "");
    await p.locator("#goBtn").click();
    await p.waitForFunction(() => !drawing.snapshot().busy && !!drawing.snapshot().current);
    const record = await p.evaluate(() => ({ params: drawing.snapshot().current.params, size: drawing.snapshot().current.size }));
    assert.deepEqual(record.size, { width: 320, height: 192 }); assert.equal(record.params.seed, 0);
    assert.equal(record.params.prompt, "  exact words  "); assert.equal(record.params.steps, undefined); assert.equal(record.params.negative_prompt, undefined);
    assert.deepEqual(record.params.comfyWorkflow.workflow, config.workflow);
    const req = submissions(t)[0]; assert.equal(req.headers.authorization, undefined);
    assert.equal(req.body.prompt["6"].inputs.prompt_text, "  exact words  "); assert.equal(req.body.prompt["3"].inputs.noise_seed, 0);
    await p.locator("#favoriteBtn").click(); await p.waitForFunction(() => drawing.snapshot().favorites.length === 1);
    const [download] = await Promise.all([p.waitForEvent("download"), p.locator("#saveBtn").click()]);
    const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), t.png);
    const restored = await p.evaluate(async () => {
      const exported = await services.backup.export(); const checked = await services.backup.read(exported.blob);
      await drawing.toggleFavorite(); await services.backup.import(checked);
      return checked.favorites[0].params.comfyWorkflow;
    });
    assert.deepEqual(restored.workflow, config.workflow);
    await p.waitForFunction(() => drawing.snapshot().favorites.length === 1);
    await p.locator("#editBtn").click();
    await p.waitForFunction(() => !!editor.snapshot().session);
    assert.ok(await p.evaluate(() => JSON.stringify(editor.snapshot().session).includes('comfyWorkflow')));
    await t.context.route("https://chat.example.test/**", route => route.fulfill({ json: { data: [{ id: "gpt-image-1.5" }] } }));
    await p.evaluate(async () => {
      const next = structuredClone(services.connections.configuration);
      next.connections.chat = { id: "chat", name: "CHAT mock", baseUrl: "https://chat.example.test", profileId: "openai-images-v1", credentialRef: "chat-key", revision: "chat-v1" };
      await services.connections.save(next); await services.vault.setKey("chat-key", "synthetic-chat-key", false);
      location.hash = "#/image";
    });
    await p.locator("#chatBtn").click();
    await p.waitForFunction(() => chat.snapshot().current.attachments.length === 1);
    assert.equal(await p.evaluate(() => chat.snapshot().current.turns.length), 0);
    await p.reload(); await bind(p); await p.waitForFunction(() => drawing.snapshot().favorites.length === 1);
    assert.equal(await p.evaluate(() => drawing.snapshot().history.length), 0);
    assert.deepEqual(await p.evaluate(() => drawing.snapshot().favorites[0].params.comfyWorkflow.workflow), config.workflow);
    assert.equal(submissions(t).length, 1);
  } finally { await t.close(); }
});

test("Comfy batch: frozen workflow and source board, global lock, uint32 rollover and cancellation", async () => {
  const t = await open(), p = t.page;
  try {
    t.state.hold = true;
    await p.evaluate(() => drawing.patch({ seed: "4294967295", batchCount: 2 }));
    const source = await p.evaluate(() => drawing.snapshot().activeBoardId);
    await p.locator("#goBtn").click();
    await p.waitForFunction(() => drawing.snapshot().busy);
    assert.equal(await p.locator('[data-layer="busy"]').getAttribute("aria-busy"), "true");
    assert.match(await p.locator(".skeleton-note").textContent(), /等待工作流出图/);
    while (!submissions(t).length) await p.waitForTimeout(10);
    const busy = await p.evaluate(async () => {
      const result = await services.runTask({ id: "competing", workspace: "chat", snapshot: {} }, () => { throw new Error("must stay locked"); });
      const c = structuredClone(services.connections.configuration); c.connections.gpu.comfyWorkflow.workflow["4"].inputs.strength_model = 0.9;
      await services.connections.save(c); await drawing.createBoard(); return result.status;
    });
    assert.equal(busy, "busy"); t.state.hold = false;
    await p.waitForFunction(() => !drawing.snapshot().busy && drawing.snapshot().history.length === 2);
    assert.deepEqual(submissions(t).map(r => r.body.prompt["3"].inputs.seed), [4294967295, 0]);
    assert.ok(submissions(t).every(r => r.body.prompt["4"].inputs.strength_model === 0.75));
    assert.ok(await p.evaluate(id => drawing.snapshot().history.every(r => r.params.boardId === id), source));
    t.state.hold = true;
    await p.evaluate(async id => { await drawing.switchBoard(id); await drawing.patch({ batchCount: 3 }); }, source);
    await p.locator("#goBtn").click(); while (submissions(t).length < 3) await p.waitForTimeout(10);
    await p.locator("#cancelBtn").click(); await p.waitForFunction(() => !drawing.snapshot().busy);
    await p.waitForTimeout(100);
    assert.equal(submissions(t).length, 3);
    assert.deepEqual(t.calls.find(c => c.path.endsWith("/queue")).body, { delete: ["job3"] });
    assert.equal(await p.evaluate(() => drawing.snapshot().history.length), 2);
  } finally { await t.close(); }
});

async function enableParameters(page) {
  await page.evaluate(async config => {
    const next = structuredClone(services.connections.configuration); next.connections.gpu.comfyWorkflow = config;
    await services.connections.save(next);
  }, adjustableConfig);
  await page.waitForFunction(() => drawing.snapshot().model?.comfyParameters?.defaults.width === 1000);
}

test('Comfy parameters UI: optional binding page, duplicate rejection and workflow defaults', async () => {
  const t = await open(), p=t.page;
  try {
    await p.evaluate(() => { location.hash='#/image/settings/connections'; });
    await p.locator('.conn-models').click();
    await p.getByText('粘贴 JSON', {exact:true}).click();
    await p.locator('#comfyWorkflow').fill(JSON.stringify(adjustableConfig.workflow));
    await p.locator('.comfy-basic summary').click();
    for (const key of ['width','height','steps','cfg']) assert.equal(await p.locator(`#comfyBinding-${key}`).inputValue(),'');
    for (const [key,b] of Object.entries(adjustableConfig.bindings.parameters)) await p.locator(`#comfyBinding-${key}`).selectOption(JSON.stringify([b.nodeId,b.field]));
    await p.locator('#comfyBinding-height').selectOption(JSON.stringify(['5','width']));
    await p.locator('.supplier-form').getByRole('button',{name:'保存',exact:true}).click();
    await p.getByRole('alert').filter({hasText:'字段绑定重复'}).waitFor();
    await p.locator('#comfyBinding-height').selectOption(JSON.stringify(['5','height']));
    await p.locator('.supplier-form').getByRole('button',{name:'保存',exact:true}).click();
    await p.locator('.supplier-form').waitFor({state:'hidden'});
    await p.evaluate(() => { location.hash='#/image'; });
    await p.locator('#width').waitFor();
    assert.equal(await p.locator('#width').inputValue(),'1000');
    assert.equal(await p.locator('#height').inputValue(),'750');
    await p.locator('#tiers label').filter({hasText:'中幅'}).click();
    await p.locator('.size-direction').filter({hasText:'方形'}).click();
    assert.equal(await p.locator('#width').inputValue(),'1024');
    assert.equal(await p.locator('#height').inputValue(),'1024');
    await p.locator('#parametersToggle').click();
    assert.equal(await p.locator('#comfyValue-steps').inputValue(),'20');
    assert.equal(await p.locator('#comfyValue-cfg').inputValue(),'6.5');
    await p.locator('#comfyValue-steps').fill('75'); await p.locator('#comfyValue-steps').press('Tab');
    await p.locator('#comfyValue-cfg').fill('4.25'); await p.locator('#comfyValue-cfg').press('Tab');
    await p.locator('#width').fill('3001'); await p.locator('#width').press('Tab');
    await p.locator('#swapSize').click();
    assert.equal(await p.locator('#height').inputValue(),'3001');
    await p.locator('#swapSize').click();
    assert.deepEqual(await p.evaluate(()=>[drawing.snapshot().form.width,drawing.snapshot().form.steps,drawing.snapshot().form.scale]),[3001,75,4.25]);
    assert.equal(t.calls.length,0);
    await p.evaluate(async()=>{
      const next=structuredClone(services.connections.configuration);delete next.connections.gpu.comfyWorkflows[0].bindings.parameters.height;
      await services.connections.save(next);
    });
    await p.waitForFunction(()=>document.querySelector('#height')?.disabled);
    assert.equal(await p.locator('#height').inputValue(),'');
    assert.equal(await p.locator('#swapSize').isDisabled(),true);
  } finally { await t.close(); }
});

test('Comfy parameters: frozen batch, separate input/output recipe, reuse, backup and board persistence', async () => {
  const t=await open(),p=t.page;
  try {
    await enableParameters(p);
    await p.evaluate(()=>drawing.patch({width:3001,height:777,steps:75,scale:4.25,batchCount:2}));
    t.state.hold=true;
    await p.locator('#goBtn').click();
    await p.waitForFunction(()=>drawing.snapshot().busy);
    while(!submissions(t).length) await p.waitForTimeout(10);
    const source=await p.evaluate(async()=> {
      const source=drawing.snapshot().activeBoardId;
      await drawing.patch({width:500,steps:10,scale:1});
      const next=structuredClone(services.connections.configuration); next.connections.gpu.comfyWorkflow.workflow['3'].inputs.cfg=8;
      await services.connections.save(next); await drawing.createBoard(true);
      await drawing.patch({width:900}); return source;
    });
    t.state.hold=false;
    await p.waitForFunction(()=>!drawing.snapshot().busy && drawing.snapshot().history.length===2);
    for(const r of submissions(t)) {
      assert.equal(r.body.prompt['5'].inputs.width,3001); assert.equal(r.body.prompt['3'].inputs.steps,75); assert.equal(r.body.prompt['3'].inputs.cfg,4.25);
      assert.deepEqual(r.body.prompt['11'],adjustableConfig.workflow['11']);
    }
    const recipe=await p.evaluate(()=>{ drawing.show(drawing.snapshot().history[0],true); return drawing.snapshot().current.params; });
    assert.equal(recipe.width,320); assert.equal(recipe.height,192);
    assert.deepEqual(recipe.comfyParameters,{width:3001,height:777,steps:75,cfg:4.25});
    await p.locator('#favoriteBtn').click(); await p.waitForFunction(()=>drawing.snapshot().favorites.length===1);
    const backup=await p.evaluate(async()=>{const saved=await services.backup.export();return (await services.backup.read(saved.blob)).favorites[0].params.comfyParameters;});
    assert.deepEqual(backup,recipe.comfyParameters);
    await p.evaluate(async id=> {
      const {reuseFields}=await import('/src/domain/drawing.ts');
      await drawing.switchBoard(id); drawing.apply(reuseFields(drawing.snapshot().current));
    },source);
    assert.equal(await p.locator('#width').inputValue(),'3001');
    await p.waitForFunction(()=>JSON.parse(localStorage.getItem('koma.prefs.v1')).boards.items.find(b=>b.id===drawing.snapshot().activeBoardId).form.width===3001);
    await p.reload();await bind(p);await p.waitForFunction(()=>drawing.snapshot().model?.comfyParameters?.defaults.cfg===8);
    assert.equal(await p.locator('#width').inputValue(),'3001');
    assert.equal(await p.evaluate(()=>drawing.snapshot().form.scale),4.25);
    const other=await p.evaluate(id=>drawing.snapshot().boards.find(b=>b.id!==id).id,source);
    await p.evaluate(id=>drawing.switchBoard(id),other);assert.equal(await p.locator('#width').inputValue(),'900');
    assert.equal(submissions(t).length,2);
  } finally {await t.close();}
});

test('Comfy parameters ASK writer: validate, apply, undo and reject unbound/invalid writes', async()=>{
  const t=await open(),p=t.page;
  try {
    await enableParameters(p);
    const result=await p.evaluate(async()=>{
      const {parseDraft,validateDraft,stateHash}=await import('/src/ask/draft/validate.ts');
      const {createDraftWriter}=await import('/src/ask/draft/apply.ts');
      const d=drawing.snapshot(),base={boardId:d.activeBoardId,boardPresent:true,form:structuredClone(d.form),models:d.models,samplers:d.samplers,composer:'',conversationId:'mock'};
      const draft=parseDraft({title:'parameters',base_hash:stateHash(base),steps:[{kind:'params_patch',params:{width:3001,steps:75,scale:4.25}}]},base,[]);
      const plan=validateDraft(draft,base,{off:new Set()});
      const writer=createDraftWriter(drawing,chat,{route:{value:{workspace:'image'}},switchWorkspace(){}});
      await writer.apply(plan); const applied=[drawing.snapshot().form.width,drawing.snapshot().form.steps,drawing.snapshot().form.scale];
      await writer.undo(plan);const undone=[drawing.snapshot().form.width,drawing.snapshot().form.steps,drawing.snapshot().form.scale];
      const errors=[];
      for(const values of [{sampler:'anything'},{width:0},{scale:Infinity}])try{await drawing.writeDraft(values,{});}catch(e){errors.push(e.message);}
      await writer.apply(plan);
      const next=structuredClone(services.connections.configuration);next.connections.gpu.comfyWorkflow.workflow['4'].inputs.strength_model=0.9;
      await services.connections.save(next);
      let stale='';try{await writer.undo(plan);}catch(e){stale=e.message;}
      return {applied,undone,errors,stale};
    });
    assert.deepEqual(result.applied,[3001,75,4.25]);assert.deepEqual(result.undone,[1000,20,6.5]);assert.equal(result.errors.length,3);
    assert.match(result.stale,/工作流配置已变化/);
    assert.equal(submissions(t).length,0);
  } finally {await t.close();}
});

async function enableControls(t, wait = true) {
  await t.page.evaluate(async config => {
    const next = structuredClone(services.connections.configuration); next.connections.gpu.comfyWorkflow = config;
    await services.connections.save(next);
  }, controlledConfig);
  await t.page.waitForFunction(() => drawing.snapshot().model?.comfyControls?.loras.length === 2);
  if (wait) await t.page.waitForFunction(() => !drawing.snapshot().comfyOptions.loading && !!drawing.snapshot().comfyOptions.info.LoraLoader);
}
const infoCalls = t => t.calls.filter(c => c.path.includes('/object_info/'));

test('Comfy controls configuration: split sampling nodes, standard LoRA fields and custom zero confirmation', async () => {
  const t = await open(), p = t.page;
  try {
    await p.evaluate(() => { location.hash = '#/image/settings/connections'; });
    await p.locator('.conn-models').click();
    await p.getByText('粘贴 JSON', {exact:true}).click();
    const workflow = structuredClone(controlledConfig.workflow);
    workflow['15'] = {class_type:'CustomLoRA', inputs:{file:'example.safetensors',weight:1}};
    await p.locator('#comfyWorkflow').fill(JSON.stringify(workflow));
    await p.locator('.comfy-basic summary').click();
    for (const key of ['sampler','scheduler']) {
      const b = controlledConfig.bindings.controls[key];
      await p.locator(`#comfyBinding-${key}`).selectOption(JSON.stringify([b.nodeId,b.field]));
    }
    await p.locator('.comfy-lora-bindings summary').click();
    for (const [index,id] of ['4','14','15'].entries()) {
      await p.getByRole('button',{name:'绑定 LoRA 位置',exact:true}).click();
      await p.locator(`#comfyLoraNode-${index}`).selectOption(id);
    }
    assert.equal(await p.locator('#comfyLora-0-clipField').inputValue(),'strength_clip');
    assert.equal(await p.locator('#comfyLora-1-clipField').inputValue(),'');
    await p.locator('#comfyLora-0-clipField').selectOption('');
    await p.locator('#comfyLora-2-nameField').selectOption('file');
    await p.locator('#comfyLora-2-modelField').selectOption('weight');
    await p.getByRole('button',{name:'保存',exact:true}).click();
    await p.getByRole('alert').filter({hasText:'标准 LoRA 节点需绑定完整'}).waitFor();
    await p.locator('#comfyLora-0-clipField').selectOption('strength_clip');
    await p.getByRole('button',{name:'保存',exact:true}).click();
    await p.getByRole('alert').filter({hasText:'尚未确认归零停用规则'}).waitFor();
    await p.getByText('此节点的全部 LoRA 强度已绑定，归零即可停用',{exact:true}).click();
    await p.getByRole('button',{name:'保存',exact:true}).click();
    await p.locator('.supplier-form').waitFor({state:'hidden'});
    const saved = await p.evaluate(() => services.connections.configuration.connections.gpu.comfyWorkflows[0].bindings.controls);
    assert.deepEqual(saved.loras.slice(0,2),controlledConfig.bindings.controls.loras);
    assert.deepEqual(saved.loras[2],{nodeId:'15',nameField:'file',modelField:'weight',zeroDisables:true});
    await p.locator('.conn-models').click();
    await p.getByText('粘贴 JSON',{exact:true}).click();
    workflow['4'].class_type='ReplacedLoRA';
    await p.locator('#comfyWorkflow').fill(JSON.stringify(workflow));
    await p.locator('.comfy-lora-bindings summary').click();
    assert.equal(await p.locator('#comfyLoraNode-0').inputValue(),'14','changed node class drops the old binding');
    assert.equal(await p.locator('.comfy-lora-binding').count(),2);
    await p.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(submissions(t).length,0);
  } finally {await t.close();}
});

test('Comfy controls UI: loading, tab navigation, refreshed options, failures and missing files', async () => {
  const t = await open(), p = t.page;
  let release;
  try {
    t.state.infoWait = new Promise(resolve => {release=resolve;});
    await enableControls(t,false);
    await p.locator('#tab-prompt').focus(); await p.locator('#tab-prompt').press('End');
    assert.equal(await p.locator('#tab-lora').getAttribute('aria-selected'),'true');
    assert.equal(await p.locator('#paneLora').getByRole('button',{name:'读取中…',exact:true}).isDisabled(),true);
    assert.equal(await p.locator('#comfyLoraName-4').isDisabled(),true);
    release();
    await p.waitForFunction(() => !drawing.snapshot().comfyOptions.loading);
    assert.equal(infoCalls(t).length,4,'one request per unique node class');
    await p.locator('#comfyLoraName-4').selectOption('style/new.safetensors');
    await p.locator('#comfyLora-4-strengthModel').fill('-0.7'); await p.locator('#comfyLora-4-strengthModel').press('Tab');
    await p.locator('#comfyLora-4-strengthClip').fill('0.4'); await p.locator('#comfyLora-4-strengthClip').press('Tab');
    await p.locator('#comfyLora-4-strengthModel').fill(''); await p.locator('#comfyLora-4-strengthModel').press('Tab');
    assert.equal(await p.locator('#comfyLora-4-strengthModel').inputValue(),'-0.7');
    await p.locator('[data-lora-slot="4"] .check').click();
    assert.equal(await p.getByLabel('启用 LoRA 4',{exact:true}).isChecked(),false);
    assert.equal(await p.locator('#comfyLora-4-strengthClip').inputValue(),'0.4');
    await p.locator('#tab-lora').press('ArrowLeft');
    assert.equal(await p.locator('#tab-negative').getAttribute('aria-selected'),'true');
    await p.locator('#tab-negative').press('Home');
    assert.equal(await p.locator('#prompt').inputValue(),'  exact words  ');
    await p.locator('#parametersToggle').click();
    await p.locator('#comfyValue-sampler').selectOption('dpmpp_2m');
    await p.locator('#comfyValue-scheduler').selectOption('karras');
    await p.locator('#parametersToggle').click();
    await p.locator('#tab-lora').click();
    assert.equal(infoCalls(t).length,4,'tab switches use cache');
    const before = await p.evaluate(() => structuredClone(drawing.snapshot().comfyControls));
    t.state.infoFailure=true;
    await p.locator('#paneLora').getByRole('button',{name:'刷新服务选项',exact:true}).click();
    await p.waitForFunction(() => !!drawing.snapshot().comfyOptions.error && !drawing.snapshot().comfyOptions.loading);
    assert.deepEqual(await p.evaluate(() => drawing.snapshot().comfyControls),before);
    assert.equal(await p.locator('#comfyLoraName-4').isDisabled(),true);
    t.state.infoFailure=false;
    t.state.nodeInfo = type => {
      const info=nodeInfo(type);
      if (info[type].input.required.lora_name) info[type].input.required.lora_name[0]=['example.safetensors','detail.safetensors'];
      return info;
    };
    await p.locator('#paneLora').getByRole('button',{name:'刷新服务选项',exact:true}).click();
    await p.waitForFunction(() => !drawing.snapshot().comfyOptions.loading && !drawing.snapshot().comfyOptions.error);
    assert.match(await p.locator('#comfyLoraName-4 option:checked').textContent(),/不在当前列表/);
    await p.locator('#goBtn').click();
    await p.getByText(/选项已不可用：style\/new.safetensors/).waitFor();
    assert.equal(submissions(t).length,0);
    await p.locator('#comfyLoraName-4').selectOption('example.safetensors');
    await p.locator('[data-lora-slot="4"] .check').click();
    assert.equal(await p.getByLabel('启用 LoRA 4',{exact:true}).isChecked(),true);
    assert.equal(await p.locator('#comfyLora-4-strengthModel').inputValue(),'-0.7');
    assert.equal(await p.evaluate(() => drawing.snapshot().form.negative),'');
    t.state.nodeInfo=type => {
      const info=nodeInfo(type);
      if(info[type].input.required.lora_name) info[type].input.required.lora_name=['STRING',{}];
      return info;
    };
    await p.locator('#paneLora').getByRole('button',{name:'刷新服务选项',exact:true}).click();
    await p.locator('input#comfyLoraName-4').waitFor();
    await p.locator('#comfyLoraName-4').fill('');await p.locator('#comfyLoraName-4').press('Tab');
    assert.equal(await p.locator('#comfyLoraName-4').inputValue(),'example.safetensors','rejected free-text edits restore the submitted value');
    await p.locator('#comfyLoraName-4').fill('custom.safetensors');await p.locator('#comfyLoraName-4').press('Tab');
    assert.equal(await p.evaluate(() => drawing.snapshot().comfyControls.loras[0].name),'custom.safetensors');
  } finally {release?.();await t.close();}
});

test('Comfy controls execution: frozen batch, zero all disabled strengths, history, backup and board persistence', async () => {
  const t = await open(), p = t.page;
  try {
    await enableControls(t);
    const source = await p.evaluate(async () => {
      const controls=structuredClone(drawing.snapshot().comfyControls);
      controls.sampler='dpmpp_2m';controls.scheduler='karras';
      controls.loras[0]={...controls.loras[0],name:'style/new.safetensors',enabled:false,strengthModel:0.9,strengthClip:0.3};
      await drawing.patchComfyControls(controls);await drawing.patch({batchCount:2});
      return drawing.snapshot().activeBoardId;
    });
    t.state.hold=true;await p.locator('#goBtn').click();
    while(!submissions(t).length) await p.waitForTimeout(10);
    await p.evaluate(async () => {
      const values=structuredClone(drawing.snapshot().comfyControls);values.sampler='euler';values.loras[0].enabled=true;
      await drawing.patchComfyControls(values);await drawing.createBoard(true);
      await drawing.patchComfyControls({...drawing.snapshot().comfyControls,scheduler:'normal'});
    });
    t.state.hold=false;
    await p.waitForFunction(() => !drawing.snapshot().busy && drawing.snapshot().history.length===2);
    for(const {body:{prompt}} of submissions(t)) {
      assert.equal(prompt['12'].inputs.sampler_name,'dpmpp_2m');assert.equal(prompt['13'].inputs.scheduler,'karras');
      assert.equal(prompt['4'].inputs.lora_name,'style/new.safetensors');
      assert.equal(prompt['4'].inputs.strength_model,0);assert.equal(prompt['4'].inputs.strength_clip,0);
      assert.equal(prompt['14'].inputs.strength_model,-0.2);assert.deepEqual(prompt['14'].inputs.model,['4',0]);
      assert.deepEqual(prompt['11'],controlledConfig.workflow['11']);
    }
    const recipe = await p.evaluate(() => {drawing.show(drawing.snapshot().history[0],true);return drawing.snapshot().current.params.comfyControls;});
    assert.equal(recipe.loras[0].enabled,false);assert.equal(recipe.loras[0].strengthClip,0.3);
    await p.locator('#favoriteBtn').click();await p.waitForFunction(() => drawing.snapshot().favorites.length===1);
    const backup=await p.evaluate(async () => {const b=await services.backup.export();return (await services.backup.read(b.blob)).favorites[0].params.comfyControls;});
    assert.deepEqual(backup,recipe);
    await p.locator('#editBtn').click();await p.waitForFunction(() => !!editor.snapshot().session);
    assert.ok(await p.evaluate(() => JSON.stringify(editor.snapshot().session).includes('style/new.safetensors')));
    await p.evaluate(async id => {location.hash='#/image';await drawing.switchBoard(id);},source);
    await p.locator('#tab-prompt').click();
    await p.locator('.tile[data-id]').first().dragTo(p.locator('#prompt'));
    await p.locator('#importSheet:not([hidden])').waitFor();
    await p.getByText('采样／调度／LoRA',{exact:true}).waitFor();
    await p.locator('#importApply').click();
    await p.waitForFunction(() => drawing.snapshot().comfyControls.sampler==='dpmpp_2m');
    assert.deepEqual(await p.evaluate(() => drawing.snapshot().comfyControls),recipe);
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('koma.prefs.v1')).boards.items.find(b=>b.id===drawing.snapshot().activeBoardId).form.comfyControlMemory['comfyui:gpu']?.values.sampler==='dpmpp_2m');
    await p.reload();await bind(p);await p.waitForFunction(() => !!drawing.snapshot().model?.comfyControls);
    assert.deepEqual(await p.evaluate(() => drawing.snapshot().comfyControls),recipe);
    const other=await p.evaluate(id => drawing.snapshot().boards.find(b=>b.id!==id).id,source);
    await p.evaluate(id => drawing.switchBoard(id),other);
    assert.equal(await p.evaluate(() => drawing.snapshot().comfyControls.scheduler),'normal');
    await p.locator('#parametersToggle').click();
    await p.getByRole('button',{name:'恢复默认',exact:true}).click();
    assert.equal(await p.evaluate(() => drawing.snapshot().comfyControls.loras[0].name),'example.safetensors');
    assert.equal(submissions(t).length,2);
  } finally {await t.close();}
});


test('Comfy multi-workflow UI: import three groups, preserve independent drafts, select allowed models and persist recipes', async () => {
  const t = await open(), p = t.page;
  const bundle = JSON.parse(readFileSync(new URL('../examples/comfyui/three-workflows.json', import.meta.url)));
  t.state.nodeInfo = type => ({[type]:{input:{required:{sampler_name:[['euler','euler_ancestral']],scheduler:[['normal','simple']]}}}});
  try {
    await p.evaluate(() => {location.hash='#/image/settings/connections';});
    await p.locator('.conn-models').click();
    await p.locator('.comfy-workflow-actions input[type=file]').setInputFiles({name:'three-workflows.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
    await p.waitForFunction(() => document.querySelector('#comfyWorkflowSelect')?.value === 'flux');
    const current = () => p.locator('.comfy-workflow-editor:visible');
    await current().getByLabel('工作流名称',{exact:true}).fill('FLUX 工作流');
    await p.locator('#comfyWorkflowSelect').selectOption('sdxl');
    await current().getByLabel('显示名 · 可选',{exact:true}).nth(1).fill('NoobAI XL v1.1');
    await p.locator('#comfyWorkflowSelect').selectOption('flux');
    assert.equal(await current().getByLabel('工作流名称',{exact:true}).inputValue(),'FLUX 工作流');
    await p.locator('#comfyWorkflowSelect').selectOption('default');
    await p.getByRole('button',{name:'删除工作流',exact:true}).click();
    await p.getByRole('button',{name:'保存',exact:true}).click();
    await p.locator('.supplier-form').waitFor({state:'hidden'});
    const saved=await p.evaluate(()=>services.connections.configuration.connections.gpu);
    assert.equal(saved.comfyWorkflows.length,3);assert.equal(saved.comfyWorkflow,undefined);
    assert.deepEqual(saved.comfyWorkflows.map(w=>w.models.length),[1,2,1]);
    await p.evaluate(()=>{location.hash='#/image';});
    await p.waitForFunction(()=>drawing.snapshot().models.length===4);
    for (const [name,workflowId,file] of [
      ['FLUX.2 Klein 4B','flux','flux-2-klein-4b.safetensors'],
      ['Illustrious XL v2','sdxl','Illustrious-XL-v2.0.safetensors'],
      ['NoobAI XL v1.1','sdxl','NoobAI-XL-v1.1.safetensors'],
      ['Anima Turbo v1.1','anima','anima-turbo-v1.1.safetensors'],
    ]) {
      await p.locator('#model').click();
      await p.getByRole('menuitemradio',{name,exact:true}).click();
      await p.waitForFunction(()=>!drawing.snapshot().comfyOptions.loading);
      await p.locator('#width').fill('768');await p.locator('#width').press('Tab');
      const count=submissions(t).length;
      await p.locator('#goBtn').click();
      await p.waitForFunction(n=>!drawing.snapshot().busy && drawing.snapshot().history.length===n,count+1);
      const sent=submissions(t).at(-1).body.prompt;
      assert.equal(sent['1'].inputs[workflowId==='sdxl'?'ckpt_name':'unet_name'],file);
      assert.equal(sent['6'].inputs.width,768);
      if(workflowId==='flux')assert.equal(sent['13'].inputs.width,768);
      const recipe=await p.evaluate(()=>drawing.snapshot().current.params.comfyWorkflow);
      assert.equal(recipe.workflowId,workflowId);assert.equal(recipe.modelFile,file);
    }
    await p.reload();await bind(p);
    await p.waitForFunction(()=>drawing.snapshot().models.length===4);
    assert.equal(await p.locator('#model').getAttribute('aria-label'),'模型：Anima Turbo v1.1');
    assert.equal(await p.locator('#width').inputValue(),'768');
    assert.equal(submissions(t).length,4);
  } finally {await t.close();}
});


test('Comfy system UI: hardware replaces fees, refresh failures stay explicit and inactive views stop polling', async () => {
  const t=await open(),p=t.page;
  try {
    await p.waitForFunction(()=>document.querySelector('#comfySystemStatus')?.textContent.includes('75%'));
    assert.equal(await p.locator('#meters:visible').count(),0);
    await p.getByRole('button',{name:'Example workflow · GPU 运行状态',exact:true}).click();
    const panel=p.getByRole('dialog',{name:'ComfyUI 运行状态',exact:true});
    assert.match(await panel.textContent(),/Mock RTX 4090/);
    assert.match(await panel.textContent(),/18 \/ 24 GiB/);
    assert.match(await panel.textContent(),/16 \/ 64 GiB/);
    assert.equal(await panel.getByText('原生接口未提供',{exact:true}).count(),2);
    assert.doesNotMatch(await panel.textContent(),/费用|免费|积分/);
    t.state.systemFailure=true;
    await panel.getByRole('button',{name:'刷新运行状态',exact:true}).click();
    await panel.getByText('更新失败',{exact:true}).waitFor();
    assert.match(await panel.textContent(),/以下为上次读数/);
    t.state.systemFailure=false;t.state.systemStats.devices[0].vram_free=12*1024**3;
    await panel.getByRole('button',{name:'刷新运行状态',exact:true}).click();
    await p.waitForFunction(()=>document.querySelector('#comfySystemStatus')?.textContent.includes('50%'));
    await p.keyboard.press('Escape');
    await p.evaluate(()=>{location.hash='#/home';});
    await p.locator('#comfySystemStatus').waitFor({state:'hidden'});
    const before=t.systemCalls.length;
    await p.waitForTimeout(5200);assert.equal(t.systemCalls.length,before);
    await p.evaluate(()=>{location.hash='#/image';});
    await p.waitForFunction(()=>document.querySelector('#comfySystemStatus')?.textContent.includes('50%'));
    await p.waitForTimeout(150);assert.ok(t.systemCalls.length>before);
    await p.evaluate(()=>{location.hash='#/image/settings/connections';});
    const paused=t.systemCalls.length;await p.waitForTimeout(5200);assert.equal(t.systemCalls.length,paused);
    assert.equal(submissions(t).length,0);
    assert.ok(t.systemCalls.every(r=>r.path.endsWith('/system_stats')));
  } finally {await t.close();}
});
