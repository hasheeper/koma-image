import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
let server,browser,origin;
before(async()=>{await mkdir('.local/ea',{recursive:true});server=await createServer({server:{host:'127.0.0.1',port:0,open:false,hmr:false}});await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
const wireState=body=>JSON.parse(body.messages.flatMap(m=>typeof m.content==='string'?[m.content]:(m.content??[]).flatMap(b=>b.text??[])).filter(t=>t.includes('<workspace_state>\n')).at(-1).split('<workspace_state>\n')[1].split('\n</workspace_state>')[0]);
const response=(body,steps)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:'已整理修改，等待确认。',...(steps?{tool_calls:[{index:0,id:'draft',type:'function',function:{name:'propose_draft',arguments:JSON.stringify({base_hash:wireState(body).base_hash,draft_title:'调整编辑配置',steps})}}]}:{})},finish_reason:steps?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n';
async function setup(t) {
 const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>ctx.close());
 const page=await ctx.newPage(),requests=[],errors=[],queue=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await ctx.addInitScript(()=>{
   if(localStorage.getItem('koma.routing.v1'))return;
   localStorage.setItem('koma.prefs.v1',JSON.stringify({tagSuggest:false}));
   const c=(id,url,profileId)=>({id,name:id,baseUrl:url,profileId,credentialRef:id+'-key',revision:'r1'});
   localStorage.setItem('koma.routing.v1',JSON.stringify({version:1,connections:{nai:c('nai','https://image.novelai.net','nai-official-v1'),reason:c('reason','https://reason.example.test/v1','openai-chat-v1'),chat:c('chat','https://image.example.test/v1','openai-images-v1')},links:{}}));
   localStorage.setItem('koma.ask.v1',JSON.stringify({version:1,connectionId:'reason',model:'test',models:{reason:['test']},images:true}));
   sessionStorage.setItem('koma.session.keys',JSON.stringify({'nai-key':'synthetic','reason-key':'synthetic','chat-key':'synthetic'}));
 });
 await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin===origin)return route.continue();
   requests.push(u.href);
   if(u.pathname==='/user/subscription')return route.fulfill({json:{active:true,tier:3,usage:{isNegative:false},trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}});
   if(u.pathname==='/v1/models')return route.fulfill({json:{data:[{id:u.hostname.startsWith('reason')?'test':'gpt-image-1.5'}]}});
   if(u.pathname==='/v1/chat/completions'){const b=req.postDataJSON();calls.push(b);return route.fulfill({contentType:'text/event-stream',body:(()=>{const next=queue.shift();return typeof next==='function'?next(b):response(b,next);})()});}
   errors.push('unexpected '+u.href);return route.abort();
 });
 await page.goto(origin+'/#/image');
 await page.waitForSelector('#prompt');
 await page.evaluate(async()=>{
   const p=document.body.__vue_app__._instance.provides;
   for(const n of ['ask','drawing','editor','chat','home','slate','bridge','app-shell'])window[n.replaceAll('-','_')]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===n)];
   await ask.restored;
   window.makeImage=async(color='#446688',w=512,h=512)=>{const c=new OffscreenCanvas(w,h),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c.convertToBlob({type:'image/png'});};
 });
 await page.waitForFunction(()=>drawing.snapshot().models.some(m=>m.id==='nai-diffusion-4-5-full'));
 await page.evaluate(async()=>{
   await drawing.patch({model:'nai-diffusion-4-5-full',prompt:'1girl, blue hair'});
   window.source=await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing,home},await makeImage(),{width:512,height:512},{model:'nai-diffusion-4-5-full',prompt:'1girl, blue hair',seed:7},null);
   await editor.open('image',source.blob,'source.png',{sourceId:'record:'+source.id,settings:source.params});
   window.originalBoard=editor.session.id;
 });
 await page.waitForTimeout(650);
 return {page,requests,errors,queue,calls};
}
async function askDraft(t,steps) {
 t.queue.push(steps);
 await t.page.evaluate(()=>{ask.show();ask.input.value='请按当前状态准备修改';});
 await t.page.evaluate(()=>ask.send());
 await t.page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value,{},{timeout:30000});
 const issues=await t.page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue));
 assert.deepEqual(issues,[]);
}
test('EA0–EA2 actual ASK turn freezes EDIT, counts tokens, applies/undoes presets without requests or base/mask changes', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 await page.evaluate(async()=>{editor.setMode('inpaint');const c=new OffscreenCanvas(512,512),x=c.getContext('2d');x.fillStyle='white';x.fillRect(64,64,64,64);x.fillRect(320,320,32,32);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');editor.setMode('img2img');});
 await page.waitForTimeout(650);const start=f.requests.length;
 await askDraft(f,[{kind:'params_patch',params:{editMode:'inpaint',inpaintKind:'focused',strength:1,focusRect:{x:0,y:0,w:.75,h:.75}}},{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'detailed hands'},{kind:'director_patch',tool:'emotion',emotion:'smug',defry:3}]);
 const state=wireState(f.calls[0]);assert.equal(state.workspace,'edit');assert.equal(state.edit.mask.region_count,2);assert.equal(state.edit.input_budget.status,'ready');assert.ok(state.edit.source_version.id.startsWith('#e'));assert.equal(state.image.input_budget.status,'ready');assert.doesNotMatch(JSON.stringify(state),/synthetic|base64|blob:/);
 const before=await page.evaluate(()=>({mask:JSON.stringify(editor.session.mask),base:editor.session.baseId,prompt:drawing.snapshot().form.prompt,config:editor.askSnapshot().config}));
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.deepEqual(await page.evaluate(()=>[editor.session.mode,editor.session.fields.prompt,editor.snapshot().directorOpen]),['inpaint','detailed hands',true]);
 const id=await page.evaluate(()=>ask.undoId.value);
 await page.evaluate(id=>ask.undoDraft(id),id);
 const after=await page.evaluate(()=>({mask:JSON.stringify(editor.session.mask),base:editor.session.baseId,prompt:drawing.snapshot().form.prompt,config:editor.askSnapshot().config}));
 assert.deepEqual(after,before);
 await page.evaluate(id=>ask.restoreDraft(id),id);
 for(const width of [320,390,768,1440]) {
   await page.setViewportSize({width,height:900});await page.evaluate(()=>ask.show());await page.waitForTimeout(120);
   assert.equal(await page.locator('#askDrawer').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;}),true);
   await page.screenshot({path:'.local/ea/ask-edit-'+width+'.png'});
 }
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);
 await page.evaluate(()=>{window.token=editor.beginExternalEdit();});
 assert.equal(await page.evaluate(()=>ask.visible.value),false);
 await page.keyboard.press('Control+j');assert.equal(await page.evaluate(()=>ask.visible.value),false);
 await page.evaluate(()=>editor.cancelExternalEdit(token.id));
 assert.deepEqual(f.errors,[]);
});
test('EA3 handoff creates without navigation, preserves identity, removes untouched board on undo and redoes safely', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 await page.evaluate(async()=>{
   window.second=await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing,home},await makeImage('#884466',513,512),{width:513,height:512},{model:'nai-diffusion-4-5-full',prompt:'a cabin',seed:9},null);
   app_shell.router.switchWorkspace('image');
 });
 await page.waitForTimeout(650);const start=f.requests.length;
 await askDraft(f,[{kind:'edit_handoff',image:'#h2',mode:'inpaint',prompt:'local repair'}]);
 assert.match(await page.evaluate(()=>ask.draftPlan.value.steps.map(r=>r.after).join(' ')),/需先调整/);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.match(page.url(),/#\/image$/);
 const target=await page.evaluate(()=>editor.boards().find(b=>b.id!==originalBoard&&b.versions.length)?.id);
 assert.ok(target);
 assert.deepEqual(await page.evaluate(id=>{const s=editor.askSnapshot(id);return [s.config.fields.prompt,s.source.width,s.source.recordId,editor.records().find(r=>r.id===s.source.recordId).entity_key===second.entity_key];},target),['local repair',513,await page.evaluate(()=>second.id),true]);
 const checkpoint=await page.evaluate(()=>ask.undoId.value);
 await page.evaluate(id=>ask.undoDraft(id),checkpoint);assert.equal(await page.evaluate(id=>!!editor.askSnapshot(id),target),false);
 await page.evaluate(id=>ask.restoreDraft(id),checkpoint);assert.equal(await page.evaluate(id=>!!editor.askSnapshot(id),target),true);
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);
 await page.evaluate(id=>ask.goEdit(id),target);await page.waitForURL('**/#/edit');
 assert.equal(await page.evaluate(()=>editor.session.fields.prompt),'local repair');
 assert.deepEqual(f.errors,[]);
});
test('EA3 #e handoff to CHAT keeps bytes/lineage after reload; existing edit board is reused without changing its base', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const old=await page.evaluate(()=>({base:editor.session.baseId,count:editor.boards().length}));
 await askDraft(f,[{kind:'edit_handoff',image:'#h1',mode:'img2img',prompt:'reused board'}]);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.deepEqual(await page.evaluate(()=>({base:editor.session.baseId,count:editor.boards().length})),old);
 assert.equal(await page.evaluate(()=>editor.session.fields.prompt),'reused board');
 const id=await page.evaluate(()=>ask.undoId.value);
 await page.evaluate(async()=>{window.token=editor.beginExternalEdit();editor.cancelExternalEdit(token.id,false);});
 await page.evaluate(id=>ask.undoDraft(id),id);
 assert.equal(await page.evaluate(()=>editor.session.fields.prompt),'1girl, blue hair');
 await page.evaluate(()=>chat.start());
 await page.waitForFunction(()=>!!chat.snapshot().model);
 await askDraft(f,[{kind:'chat_handoff',images:['#e1'],options:{},text:'从这张图制作表情差分'}]);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 await page.waitForURL('**/#/chat');
 const saved=await page.evaluate(()=>[...chat.assets.assets.values()].filter(a=>a.lineage?.parent_ref?.tag==='#e1').map(a=>({id:a.id,entity:a.entity_key,parent:a.lineage.parent_entity_key,ref:a.lineage.parent_ref,bytes:a.blob.size})));
 assert.equal(saved.length,1);assert.equal(saved[0].entity,saved[0].parent);assert.equal(saved[0].ref.scope.kind,'page');
 await page.reload();await page.waitForSelector('#chatPrompt');
 await page.evaluate(async()=>{const p=document.body.__vue_app__._instance.provides;window.chat=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='chat')];await chat.start();});
 const restored=await page.evaluate(id=>{const a=chat.assets.get(id);return {entity:a.entity_key??'sha256:'+a.id,lineage:a.lineage,bytes:a.blob.size};},saved[0].id);
 assert.equal(restored.entity,saved[0].entity);assert.equal(restored.bytes,saved[0].bytes);assert.deepEqual(restored.lineage.parent_ref,saved[0].ref);
 assert.deepEqual(f.errors,[]);
});

test('EA0 candidate tool counts the frozen whole input without creating a draft or spending requests', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const before=await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),nextId=await page.evaluate(()=>editor.session.nextCharacterId),start=f.requests.length;
 f.queue.push(b=>'data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'check',type:'function',function:{name:'check_nai_input',arguments:JSON.stringify({base_hash:wireState(b).base_hash,steps:[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'blue sky'},{kind:'character_edit',op:'add',prompt:'1girl, white hair'}]})}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');
 f.queue.push(b=>response(b));
 await page.evaluate(()=>{ask.show();ask.input.value='检查候选输入';});await page.evaluate(()=>ask.send());
 await page.waitForFunction(()=>!ask.running.value);
 const result=f.calls.at(-1).messages.filter(m=>m.role==='tool').at(-1).content;
 const checked=JSON.parse(result.replace(/^<data>\n/, '').replace(/\n<\/data>$/, ''));
 assert.equal(checked.input_budget.status,'ready');assert.equal(checked.input_budget.positive.used,9);assert.equal(checked.input_budget.negative.used,2);
 assert.equal(await page.evaluate(()=>!!ask.draftPlan.value),false);
 assert.equal(await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),before);assert.equal(await page.evaluate(()=>editor.session.nextCharacterId),nextId);
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);assert.deepEqual(f.errors,[]);
});

test('EA2 frozen target survives a board switch, and changed masks/Photopea block stale applications', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 await askDraft(f,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'frozen original board'}]);
 await page.evaluate(async()=>{await editor.open('edit',await makeImage('#996655'),'second.png',{sourceId:'other'});});
 const active=await page.evaluate(()=>editor.session.id);assert.notEqual(active,await page.evaluate(()=>originalBoard));
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.equal(await page.evaluate(()=>editor.session.id),active);assert.equal(await page.evaluate(()=>editor.askSnapshot(originalBoard).config.fields.prompt),'frozen original board');
 await page.evaluate(()=>{editor.switchBoard(originalBoard);});
 await askDraft(f,[{kind:'params_patch',params:{editMode:'inpaint',inpaintKind:'focused',focusRect:{x:0,y:0,w:.5,h:.5}}}]);
 await page.evaluate(async()=>{const c=new OffscreenCanvas(512,512),x=c.getContext('2d');x.fillStyle='white';x.fillRect(400,400,40,40);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');await editor.prepareAsk();});
 assert.match(await page.evaluate(()=>ask.draftPlan.value.steps.map(s=>s.issue).join(' ')),/完整包含/);
 await page.evaluate(()=>ask.ignoreDraft());
 await askDraft(f,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'blocked while Photopea'}]);
 const old=await page.evaluate(()=>editor.session.fields.prompt);
 await page.evaluate(()=>{window.photopeaTest=editor.beginExternalEdit();});
 assert.match(await page.evaluate(()=>ask.draftPlan.value.steps.map(s=>s.issue).join(' ')),/高级编辑/);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));assert.equal(await page.evaluate(()=>editor.session.fields.prompt),old);
 await page.evaluate(()=>editor.cancelExternalEdit(photopeaTest.id));assert.deepEqual(f.errors,[]);
});

test('EA3 converted CHAT reference receives a new entity and preserves the original source', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const result=await page.evaluate(async()=>{
   await chat.start();
   const png=await makeImage(),large=new Blob([png,new Uint8Array(8*1024*1024)],{type:'image/png'});
   const {imageEntity}=await import('/src/domain/image-identity.ts');const parent=await imageEntity(large);
   await chat.writeHandoffDraft({model:chat.snapshot().model.id,options:{},text:'converted',images:[{blob:large,name:'large.png',lineage:{via:'chat',parent_entity_key:parent,parent_record_id:'edit-source'}}]});
   const image=[...chat.assets.assets.values()].find(a=>a.lineage?.parent_record_id==='edit-source');
   return {parent,entity:image.entity_key,lineage:image.lineage,size:image.blob.size,type:image.blob.type};
 });
 assert.notEqual(result.parent,result.entity);assert.equal(result.lineage.parent_entity_key,result.parent);assert.equal(result.lineage.tool_detail,'reference-fit');assert.ok(result.size<8*1024*1024);assert.equal(result.type,'image/jpeg');assert.deepEqual(f.errors,[]);
});

test('EA2 composite EDIT and Slate failures roll back configuration and remain reviewable; retry and undo stay request-free', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const before=await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),start=f.requests.length;
 await askDraft(f,[
   {kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'finished expression'},
   {kind:'slate_edit',op:'create',slate_title:'Expression studies',golden_recipe:{capture_current:true},todos:[{op:'add',todo_title:'Review expression',image_required:false}]}
 ]);
 const slateId=await page.evaluate(()=>ask.draftPlan.value.slate.id);
 await page.evaluate(()=>{
   window.originalPut=IDBObjectStore.prototype.put;window.failSlate=true;
   IDBObjectStore.prototype.put=function(value,...args){
     if(this.transaction.db.name==='koma-slate'&&this.name==='state'&&args[0]==='workspace'&&!value.journal&&window.failSlate){window.failSlate=false;throw new DOMException('synthetic quota','QuotaExceededError');}
     return originalPut.call(this,value,...args);
   };
 });
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.equal(await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),before);
 assert.equal(await page.evaluate(id=>slate.get(id),slateId),null);
 assert.equal(await page.evaluate(()=>!!ask.draftPlan.value),true);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=originalPut;});
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.equal(await page.evaluate(()=>editor.session.fields.prompt),'finished expression');
 assert.equal(await page.evaluate(id=>slate.get(id).golden_recipe.form.prompt,slateId),'finished expression');
 const checkpoint=await page.evaluate(()=>ask.undoId.value);
 await page.evaluate(id=>ask.undoDraft(id),checkpoint);
 assert.equal(await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),before);
 assert.equal(await page.evaluate(id=>slate.get(id),slateId),null);
 await page.waitForTimeout(650);
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);
 assert.deepEqual(f.errors,[]);
});
