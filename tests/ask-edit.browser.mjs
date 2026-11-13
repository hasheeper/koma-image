import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from './helpers/vite.mjs';
import { chromium } from 'playwright';
let server,browser,origin;
before(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0,open:false,hmr:false}});await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({headless:true});});
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
   localStorage.setItem('koma.routing.v1',JSON.stringify({version:1,connections:{nai:c('nai','https://image.novelai.net','nai-official-v1'),reason:c('reason','https://reason.example.test/v1','openai-chat-v1'),chat:c('chat','https://image.example.test/v1','openai-images-v1'),banana:c('banana','https://banana.example.test/v1beta','gemini-native-v1')},links:{}}));
   localStorage.setItem('koma.ask.v1',JSON.stringify({version:1,connectionId:'reason',model:'test',models:{reason:['test']},images:true}));
   sessionStorage.setItem('koma.session.keys',JSON.stringify({'nai-key':'synthetic','reason-key':'synthetic','chat-key':'synthetic','banana-key':'synthetic'}));
 });
 await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin===origin)return route.continue();
   requests.push(u.href);
   if(u.pathname==='/user/subscription')return route.fulfill({json:{active:true,tier:3,usage:{isNegative:false},trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}});
   if(u.pathname==='/v1/models')return route.fulfill({json:{data:(u.hostname.startsWith('reason')?['test']:['gpt-image-1.5','gpt-image-2']).map(id=>({id}))}});
   if(u.pathname==='/v1beta/models')return route.fulfill({json:{models:[{name:'models/gemini-3-pro-image',supportedGenerationMethods:['generateContent']}]}});
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
test('P4 project images freeze through directory replacement, saved pending drafts, CHAT/EDIT apply and undo', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const directory=()=>{
   FileSystemHandle.prototype.queryPermission=async()=> 'granted';FileSystemHandle.prototype.requestPermission=async()=> 'granted';
   window.showDirectoryPicker=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('project-a',{create:true});
   window.projectFile=async(path,value)=>{let root=await showDirectoryPicker();const parts=path.split('/'),name=parts.pop();for(const p of parts)root=await root.getDirectoryHandle(p,{create:true});const h=await root.getFileHandle(name,{create:value!==undefined});if(value===undefined)return h.getFile();const w=await h.createWritable();await w.write(value);await w.close();};
 };
 await page.context().addInitScript(directory);await page.evaluate(directory);
 await page.evaluate(async()=>{await bridge.restored;window.originalProjectImage=await makeImage('#cc3355',512,768);await projectFile('characters/hero/portrait.png',originalProjectImage);await bridge.mount();await chat.start();await ask.setImages(false);app_shell.router.switchWorkspace('image');});
 await page.waitForFunction(()=>chat.snapshot().model);
 await askDraft(f,[{kind:'chat_handoff',images:['characters/hero/portrait.png'],options:{},text:'expression study'}]);
 assert.equal(await page.evaluate(()=>ask.draftPlan.value.handoff.images[0].source),'project');
 const hash=await page.evaluate(async()=>{const {imageEntity}=await import('/src/domain/image-identity.ts');return imageEntity(originalProjectImage)});
 assert.equal(f.calls.flatMap(c=>c.messages).some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='image_url')),false,'local preparation does not send unseen image pixels');
 await page.evaluate(async()=>{await ask.toggleFavorite();await ask.flushFavorites();await projectFile('characters/hero/portrait.png',await makeImage('#116644',768,512));await bridge.unmount();});
 await page.reload();await page.waitForSelector('#prompt');
 await page.evaluate(async()=>{const p=document.body.__vue_app__._instance.provides;for(const n of ['ask','drawing','editor','chat','bridge','app-shell'])window[n.replaceAll('-','_')]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===n)];await ask.restored;await chat.start();});
 await page.waitForFunction(()=>ask.draftPlan.value?.handoff);
 assert.deepEqual(await page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue)),[]);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.equal(await page.evaluate(()=>chat.snapshot().current.prompt),'expression study');assert.equal(await page.evaluate(()=>chat.snapshot().current.turns.length),0);
 assert.equal(await page.evaluate(async()=>{const c=chat.snapshot().current,a=chat.assets.get(c.attachments[0]);return (await import('/src/domain/image-identity.ts')).imageEntity(a.blob)}),hash);
 assert.equal(await page.evaluate(()=>{const c=chat.snapshot().current;return chat.assets.get(c.attachments[0]).projectSource.path}),'characters/hero/portrait.png');
 await page.evaluate(()=>ask.undoDraft());await page.evaluate(()=>ask.restoreDraft(ask.redoId.value));assert.equal(await page.evaluate(()=>chat.snapshot().current.prompt),'expression study');
 await page.evaluate(async()=>{await bridge.mount();await ask.setImages(true);app_shell.router.switchWorkspace('image');});
 f.queue.push(()=> 'data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'read-project',type:'function',function:{name:'read_ref',arguments:JSON.stringify({path:'characters/hero/portrait.png'})}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');
 f.queue.push(body=>{
   const id=JSON.stringify(body.messages.filter(m=>m.role==='tool')).match(/#a\d+/)?.[0];assert.ok(id,'read_ref returns a usable attachment ID');
   return response(body,[{kind:'edit_handoff',image:id,prompt:'gentle rim light',mode:'img2img'}]);
 });
 await page.evaluate(()=>{ask.show();ask.input.value='读取企划立绘后准备 EDIT';return ask.send()});await page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value?.edit);
 assert.deepEqual(await page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue)),[]);
 const target=await page.evaluate(()=>ask.draftPlan.value.edit.id);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.equal(await page.evaluate(id=>editor.askSnapshot(id).config.fields.prompt,target),'gentle rim light');
 assert.deepEqual(await page.evaluate(id=>{const s=editor.askSnapshot(id);return[s.source.width,s.source.height]},target),[768,512]);
 assert.equal(await page.evaluate(id=>editor.record(editor.askSnapshot(id).source.recordId).params.projectSource.path,target),'characters/hero/portrait.png');
 await page.evaluate(()=>ask.undoDraft());assert.equal(await page.evaluate(id=>!!editor.askSnapshot(id),target),false);
 await page.evaluate(()=>bridge.openProject());
 const panel=page.getByRole('dialog',{name:'企划集'});await panel.waitFor();await panel.getByRole('button',{name:'资料操作',exact:true}).click();await page.getByRole('menuitem',{name:'在 EDIT 打开',exact:true}).click();
 await page.waitForFunction(()=>editor.askSnapshot()?.source?.width===768);
 assert.equal(await page.evaluate(()=>editor.record(editor.askSnapshot().source.recordId).params.projectSource.path),'characters/hero/portrait.png','the direct panel import preserves the same project provenance');
 assert.equal(f.requests.some(url=>/\/images\/(generations|edits)|\/ai\/generate|:generateContent/.test(url)),false);assert.deepEqual(f.errors,[]);
});
test('ASK describes generic EDIT parameters without NAI budgets and only applies a prompt draft',async t=>{
 const f=await setup(t),{page}=f;
 await page.waitForFunction(()=>editor.snapshot().models.some(m=>m.id==='gpt-image-1.5'));
 await page.evaluate(()=>{editor.setModel('gpt-image-1.5');editor.session.enhance.on=true;editor.session.focus.on=true;});
 await askDraft(f,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'make the eyes softer'}]);
 const state=wireState(f.calls[0]);assert.equal(state.edit.input_budget.status,'not_applicable');
 assert.equal(state.edit.capabilities.api_mask,false);assert.equal(state.edit.capabilities.local_mask_composition,true);
 for(const field of ['sampler','steps','scale','strength','enhance','negative'])assert.equal(state.edit.form[field],undefined,field);
 const before=await page.evaluate(()=>editor.askSnapshot().config);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.equal(await page.evaluate(()=>editor.session.fields.prompt),'make the eyes softer');
 await page.evaluate(()=>ask.undoDraft(ask.undoId.value));assert.deepEqual(await page.evaluate(()=>editor.askSnapshot().config),before);
 const issue=await page.evaluate(async()=>{const {configureEdit}=await import('/src/ask/draft/edit.ts');try{configureEdit(editor.askSnapshot(),{strength:.5});return '';}catch(e){return e.message;}});
 assert.match(issue,/NAI 参数/);assert.deepEqual(f.errors,[]);
});
for(const [model,values] of [['gpt-image-2',{quality:'low',size:'1024x1024'}],['gemini-3-pro-image',{image_size:'1K',aspect_ratio:'1:1'}]])
test(`ASK generic EDIT ${model} source options apply and undo without generation`,async t=>{
 const f=await setup(t),{page}=f;
 await page.waitForFunction(id=>editor.snapshot().models.some(m=>m.id===id),model);
 await page.evaluate(id=>editor.setModel(id),model);
 await page.evaluate(async()=>{
   const p=document.body.__vue_app__._instance.provides,a=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='annotations')],v=editor.snapshot().base;
   await a.open({workspace:'edit',inline:true,blob:v.blob,name:v.name,recordId:v.recordId,tag:editor.reference(v),edit:{boardId:editor.session.id,versionId:v.id}});
   a.update([{key:'point',shape:'point',bbox:{x:.3,y:.4,w:0,h:0},comment:'检查眉毛'}]);a.close();
 });
 const before=await page.evaluate(()=>editor.askSnapshot().config), start=f.requests.length;
 await askDraft(f,[{kind:'params_patch',params:{image_options:values}},{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'只修改眉毛，保持原图构图与线条'}]);
 const state=wireState(f.calls[0]).edit;
 assert.equal(state.form.model,model);assert.equal(state.source.upstream_id,model);
 assert.ok(state.capabilities.draft_fields.includes('image_options'));assert.ok(Object.keys(state.effective.image_options).length);
 assert.equal(state.input_budget.status,'not_applicable');assert.ok(state.image_edit.settings.edges);
 assert.deepEqual(state.image_edit.annotations.regions[0],{n:1,shape:'point',x:.3,y:.4,comment:'检查眉毛'});
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.deepEqual(await page.evaluate(id=>editor.session.options[id],model),values);
 assert.equal(await page.evaluate(()=>editor.session.fields.prompt),'只修改眉毛，保持原图构图与线条');
 await page.evaluate(()=>ask.undoDraft(ask.undoId.value));
 assert.deepEqual(await page.evaluate(()=>editor.askSnapshot().config),before);
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);
 assert.deepEqual(f.errors,[]);
});
test('EA0–EA2 actual ASK turn freezes EDIT, counts tokens, applies/undoes presets without requests or base/mask changes', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 await page.evaluate(async()=>{editor.setMode('inpaint');const c=new OffscreenCanvas(512,512),x=c.getContext('2d');x.fillStyle='white';x.fillRect(64,64,64,64);x.fillRect(320,320,32,32);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');editor.setMode('img2img');});
 await page.waitForTimeout(650);const start=f.requests.length;
 await askDraft(f,[{kind:'params_patch',params:{editMode:'inpaint',inpaintKind:'focused',strength:1,focusRect:{x:0,y:0,w:.75,h:.75}}},{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'detailed hands'},{kind:'director_patch',tool:'emotion',emotion:'smug',defry:3}]);
 const state=wireState(f.calls[0]);assert.equal(state.workspace,'edit');assert.equal(state.edit.mask.region_count,2);assert.equal(state.edit.input_budget.status,'ready');assert.ok(state.edit.source_version.id.startsWith('#e'));assert.equal(state.image.input_budget,undefined);assert.equal(state.image.form,undefined);assert.equal(state.edit.capabilities.emotions,undefined);assert.equal(state.edit.capabilities.models,undefined);assert.doesNotMatch(JSON.stringify(state),/synthetic|base64|blob:/);
 const before=await page.evaluate(()=>({mask:JSON.stringify(editor.session.mask),base:editor.session.baseId,prompt:drawing.snapshot().form.prompt,config:editor.askSnapshot().config}));
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.deepEqual(await page.evaluate(()=>[editor.session.mode,editor.session.fields.prompt,editor.snapshot().directorOpen]),['inpaint','detailed hands',true]);
 const id=await page.evaluate(()=>ask.undoId.value);
 await page.evaluate(id=>ask.undoDraft(id),id);
 const after=await page.evaluate(()=>({mask:JSON.stringify(editor.session.mask),base:editor.session.baseId,prompt:drawing.snapshot().form.prompt,config:editor.askSnapshot().config}));
 assert.deepEqual(after,before);
 await page.evaluate(id=>ask.restoreDraft(id),id);
 {
      const width = 1440;
   await page.setViewportSize({width,height:900});await page.evaluate(()=>ask.show());await page.waitForTimeout(120);
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

const toolReply = (calls, content) => 'data: '+JSON.stringify({choices:[{index:0,delta:{...(content?{content}:{}),tool_calls:calls.map(([id,name,input],index)=>({index,id,type:'function',function:{name,arguments:JSON.stringify(input)}}))},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n';
const reportOf = message => JSON.parse(message.content.match(/<data>\n([\s\S]*?)\n<\/data>/)[1]);
test('ASK can view the current EDIT version directly with an empty IMAGE history', async t=>{
 const f=await setup(t),{page}=f;
 const expected=await page.evaluate(async()=>{
   drawing.remove(source.id);
   const original=editor.session.baseId, token=editor.beginExternalEdit();
   await editor.applyExternalEdit(token.id,{mode:'image',image:await makeImage('#884466')});
   const latest=editor.session.viewId;
   editor.setBase(original);editor.view(latest);
   editor.patch({prompt:'完整编辑说明，保留当前构图',negative_prompt:'完整负面词文'});
   return {viewing:editor.reference(editor.snapshot().viewed),source:editor.reference(editor.snapshot().base),form:editor.askSnapshot().config.fields};
 });
 await page.waitForTimeout(650);
 const start=f.requests.length;
 f.queue.push(b=>toolReply([['look','view_image',{id:wireState(b).edit.viewing_version.id,spec:'look'}]]),b=>response(b));
 await page.evaluate(()=>{ask.show();ask.input.value='说说当前图的画面';});await page.evaluate(()=>ask.send());
 await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.at(-1)?.turn.status==='done');
 assert.equal(f.calls.length,2);
 const state=wireState(f.calls[0]);
 assert.equal(state.workspace,'edit');assert.equal(state.anchor,null);
 assert.equal(state.image.current,null);assert.equal(state.image.history.latest_id,null);
 assert.equal(state.edit.viewing_version.id,expected.viewing);assert.equal(state.edit.source_version.id,expected.source);
 assert.notEqual(expected.viewing,expected.source,'viewing a result does not mean viewing the base');
 assert.equal(state.edit.form.prompt,expected.form.prompt);assert.equal(state.edit.form.negative,expected.form.negative_prompt);
 const look=reportOf(f.calls[1].messages.find(m=>m.role==='tool'));
 assert.equal(look.id,expected.viewing);assert.equal(look.spec,'look');assert.ok(look.bytes>0);
 const pictures=f.calls[1].messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='image_url');
 assert.equal(pictures.length,1);
 const pixel=await page.evaluate(async url=>{
   const bitmap=await createImageBitmap(await(await fetch(url)).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),x=canvas.getContext('2d');
   x.drawImage(bitmap,0,0);bitmap.close();return [...x.getImageData(50,50,1,1).data];
 },pictures[0].image_url.url);
 assert.ok(pixel[0]>pixel[1]&&pixel[0]>pixel[2],'visual output is the red EDIT result, not the blue original');
 const tools=f.calls[1].messages.flatMap(m=>m.tool_calls??[]).map(c=>c.function.name);
 assert.deepEqual(tools,['view_image']);
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);assert.deepEqual(f.errors,[]);
});

test('EA0 proposing a draft automatically counts the complete frozen input without writes or a separate tool', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const before=await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),nextId=await page.evaluate(()=>editor.session.nextCharacterId),start=f.requests.length;
 f.queue.push(b=>toolReply([['draft','propose_draft',{base_hash:wireState(b).base_hash,draft_title:'候选修改',steps:[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'blue sky'},{kind:'character_edit',op:'add',prompt:'1girl, white hair'}]}]]));
 f.queue.push(b=>response(b));
 await page.evaluate(()=>{ask.show();ask.input.value='准备修改';});await page.evaluate(()=>ask.send());
 await page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
 assert.equal(f.calls.length,2);
 assert.ok(f.calls.every(b=>b.tools.every(t=>t.function.name!=='check_nai_input')));
 const checked=reportOf(f.calls.at(-1).messages.filter(m=>m.role==='tool').at(-1));
 assert.equal(checked.ok,true);assert.equal(checked.input_budget.status,'ready');assert.equal(checked.input_budget.positive.used,9);assert.equal(checked.input_budget.negative.used,2);
 assert.equal(checked.input_budget.positive.remaining,503);assert.equal(checked.capabilities,undefined);
 assert.equal(await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),before);assert.equal(await page.evaluate(()=>editor.session.nextCharacterId),nextId);
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);assert.deepEqual(f.errors,[]);
});

test('ASK automatic NAI validation rejects Text overflow, permits correction after eight reads and completes the answer', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const before=await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),start=f.requests.length;
 const candidate=(b,text)=>({base_hash:wireState(b).base_hash,draft_title:'调整词文',steps:[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text}]});
 f.queue.push(
   ()=>toolReply(Array.from({length:8},(_,i)=>['state'+i,'get_state',{}]),'先读当前状态。'),
   b=>toolReply([['bad','propose_draft',candidate(b,'Text: '+'x'.repeat(119))]]),
   b=>toolReply([['fixed','propose_draft',candidate(b,'blue sky, Text: Hello')]]),
   b=>response(b),
 );
 await page.evaluate(()=>{ask.show();ask.input.value='请调整词文并说明改动';});await page.evaluate(()=>ask.send());
 await page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value,{},{timeout:30000});
 assert.equal(f.calls.length,4);
 assert.deepEqual(wireState(f.calls[0]).conversation_history,{archived_through:null,retained_verbatim:[]});
 assert.equal(f.calls.at(-1).tool_choice,'none');
 const rejected=reportOf(f.calls[2].messages.filter(m=>m.role==='tool').at(-1));
 assert.equal(rejected.ok,false);assert.equal(rejected.input_budget.text.used,119);assert.equal(rejected.input_budget.text.limit,118);
 assert.equal(typeof rejected.input_budget.positive.used,'number');
 const accepted=reportOf(f.calls[3].messages.filter(m=>m.role==='tool').at(-1));assert.equal(accepted.ok,true);assert.equal(accepted.input_budget.text.used,5);
 assert.match(await page.locator('.ask-turn').last().textContent(),/已整理修改，等待确认/);
 assert.equal(await page.evaluate(()=>JSON.stringify(editor.askSnapshot().config)),before);
 assert.deepEqual(f.requests.slice(start).filter(u=>!u.includes('/chat/completions')),[]);assert.deepEqual(f.errors,[]);
});

test('get_state automatically counts other IMAGE and EDIT boards and latest state without changing the frozen draft target', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const ids=await page.evaluate(async()=>{
   const original=drawing.snapshot().activeBoardId,board=await drawing.createBoard(false);
   await drawing.patch({model:'nai-diffusion-4-5-full',prompt:'blue sky'});await drawing.switchBoard(original);
   await editor.open('edit',await makeImage('#884466'),'other.png',{sourceId:'state-other'});const edit=editor.session.id;editor.switchBoard(originalBoard);
   return {board,edit,originalEdit:originalBoard};
 });
 await page.waitForTimeout(650);const start=f.requests.length;
 f.queue.push(()=>toolReply([['board','get_state',{board_id:ids.board}],['edit','get_state',{edit_board_id:ids.edit}],['latest','get_state',{scope:'latest'}]]),b=>response(b));
 await page.evaluate(()=>{ask.show();ask.input.value='比较画板状态';});await page.evaluate(()=>ask.send());await page.waitForFunction(()=>!ask.running.value);
 const results=f.calls.at(-1).messages.filter(m=>m.role==='tool'),board=JSON.parse(results[0].content),edit=JSON.parse(results[1].content).edit,latest=JSON.parse(results[2].content.match(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/)[1]);
 for(const state of [board,edit,latest.edit]){assert.equal(state.input_budget.status,'ready');assert.equal(typeof state.input_budget.positive.used,'number');assert.ok(state.capabilities);}
 for(const state of [wireState(f.calls[0]),latest]) {
   assert.equal(state.workspace,'edit');
   assert.deepEqual(Object.keys(state.image).sort(),['active_board_id','boards','current','favorites','history']);
   assert.equal(state.edit.form.prompt,'1girl, blue hair');
   assert.equal(state.edit.capabilities.models,undefined);assert.equal(state.edit.capabilities.emotions,undefined);
 }
 assert.equal(board.form.prompt,'blue sky');assert.equal(board.draft_base_hash,wireState(f.calls[0]).base_hash);
 assert.equal(latest.edit.active_board_id,ids.originalEdit);assert.equal(await page.evaluate(()=>!!ask.draftPlan.value),false);
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

test('ASK attachment handoff restores pending multi-image drafts, pins the chosen base and preserves original bytes', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const expected=await page.evaluate(async()=>{
   await chat.start();await ask.setImages(false);app_shell.router.switchWorkspace('image');
   const red=await makeImage('#bb3344',1800,1200),green=await makeImage('#228855',512,768);
   await ask.addFiles([new File([red],'red.png',{type:'image/png'}),new File([green],'green.png',{type:'image/png'})]);
   const {imageEntity}=await import('/src/domain/image-identity.ts');return [await imageEntity(green),await imageEntity(red)];
 });
 await page.waitForFunction(()=>chat.snapshot().model);
 const before=await page.evaluate(()=>JSON.stringify(chat.snapshot().current));
 await askDraft(f,[{kind:'chat_handoff',images:['#a1','#a2'],base_image:'#a2',options:{},text:'修改 #a2，颜色参考 #a1'}]);
 assert.equal(await page.evaluate(()=>JSON.stringify(chat.snapshot().current)),before,'proposing never mutates CHAT');
 assert.deepEqual(await page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.id.startsWith('0:image:')).map(s=>[s.label,s.after,s.locked])),[['底图','#a2',true],['参考图 1','#a1',true]]);
 await page.locator('.draft-toggle[aria-expanded="false"]').click();
 await page.locator('[data-step="0:image:0"] .draft-key').filter({hasText:'底图'}).waitFor();
 assert.equal(f.calls.flatMap(c=>c.messages).some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='image_url')),false);
 await page.evaluate(async()=>{await ask.toggleFavorite();await ask.flushFavorites();});
 await page.reload();await page.waitForSelector('#prompt');
 await page.evaluate(async()=>{const p=document.body.__vue_app__._instance.provides;for(const n of ['ask','drawing','editor','chat','app-shell'])window[n.replaceAll('-','_')]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===n)];await ask.restored;await chat.start();});
 await page.waitForFunction(()=>ask.draftPlan.value?.handoff);
 assert.deepEqual(await page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue)),[]);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 const check=()=>page.evaluate(async()=>{const s=chat.snapshot(),{imageEntity}=await import('/src/domain/image-identity.ts');return {id:s.current.id,main:s.current.mainId,images:s.context.imageIds,hashes:await Promise.all(s.context.imageIds.map(id=>imageEntity(chat.assets.get(id).blob))),sizes:s.context.imageIds.map(id=>{const a=chat.assets.get(id);return[a.width,a.height]}),turns:s.current.turns.length,text:s.current.prompt};});
 let applied=await check();assert.deepEqual(applied.hashes,expected);assert.deepEqual(applied.sizes,[[512,768],[1800,1200]]);assert.equal(applied.main,applied.images[0]);assert.equal(applied.turns,0);assert.match(applied.text,/修改 第 1 张图，颜色参考 第 2 张图/);
 await page.evaluate(()=>ask.undoDraft());await page.evaluate(()=>ask.restoreDraft(ask.redoId.value));assert.deepEqual((await check()).hashes,expected);
 await page.evaluate(()=>ask.deleteConversation(ask.conversationId.value));assert.deepEqual((await check()).hashes,expected,'CHAT owns imported bytes after deleting ASK');
 assert.equal(f.requests.some(url=>/\/images\/(generations|edits)|\/ai\/generate|:generateContent/.test(url)),false);assert.deepEqual(f.errors,[]);
});

test('ASK current CHAT drafts add references, change the base, guard stale context and undo consecutive changes', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 await page.evaluate(async()=>{await chat.start();await ask.setImages(false);app_shell.router.switchWorkspace('image');await ask.addFiles([new File([await makeImage('#aa2244')],'first.png',{type:'image/png'})]);});
 await page.waitForFunction(()=>chat.snapshot().model);
 await askDraft(f,[{kind:'chat_handoff',images:['#a1'],options:{},text:'first draft'}]);await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 const original=await page.evaluate(()=>({id:chat.snapshot().current.id,asset:chat.snapshot().current.mainId,count:chat.snapshot().conversations.length,checkpoint:ask.undoId.value}));
 await page.evaluate(async()=>{await ask.addFiles([new File([await makeImage('#3377bb')],'second.png',{type:'image/png'})]);});
 f.queue.push(body=>{
   const state=wireState(body),base=state.chat.input_images.find(i=>i.role==='base').id;
   assert.match(base,/^#c\d+:r\d+$/);
   return response(body,[{kind:'chat_handoff',destination:'current',images:[base,'#a2'],base_image:'#a2',options:{},text:`修改 #a2，参考 ${base}`}]);
 });
 await page.evaluate(()=>{ask.input.value='保持当前对话，加入新参考并切换底图';return ask.send();});await page.waitForFunction(()=>!ask.running.value&&ask.draftPlan.value?.handoff?.current);
 assert.equal(await page.evaluate(()=>chat.snapshot().current.mainId),original.asset);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.deepEqual(await page.evaluate(()=>[chat.snapshot().current.id,chat.snapshot().conversations.length,chat.snapshot().context.imageIds.length,chat.snapshot().current.turns.length]),[original.id,original.count,2,0]);
 const next=await page.evaluate(()=>({base:chat.snapshot().current.mainId,text:chat.snapshot().current.prompt}));assert.notEqual(next.base,original.asset);
 await askDraft(f,[{kind:'chat_handoff',destination:'current',images:['#a2'],options:{},text:'only the second image'}]);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.deepEqual(await page.evaluate(()=>chat.snapshot().context.imageIds),[next.base]);
 assert.equal(await page.evaluate(id=>chat.assets.assets.has(id),original.asset),true,'the discarded reference remains available for undo');
 await page.evaluate(()=>ask.undoDraft());
 assert.equal(await page.evaluate(()=>chat.snapshot().context.imageIds.length),2);
 await page.evaluate(()=>ask.undoDraft());assert.deepEqual(await page.evaluate(()=>[chat.snapshot().current.mainId,chat.snapshot().current.prompt]),[original.asset,'first draft']);
 await page.evaluate(()=>ask.restoreDraft(ask.redoId.value));assert.deepEqual(await page.evaluate(()=>[chat.snapshot().current.mainId,chat.snapshot().current.prompt]),[next.base,next.text]);
 await page.evaluate(()=>ask.undoDraft());assert.equal(await page.evaluate(()=>ask.undoId.value),original.checkpoint);await page.evaluate(()=>ask.undoDraft());
 assert.equal(await page.evaluate(()=>chat.snapshot().current.prompt),'');
 await page.evaluate(()=>ask.restoreDraft(ask.redoId.value));
 await askDraft(f,[{kind:'chat_handoff',destination:'current',images:['#a2'],options:{},text:'replace the input set'}]);
 const fingerprint=await page.evaluate(()=>ask.draftPlan.value.fingerprint);
 await page.evaluate(()=>chat.setPrompt('manual edit after proposal'));
 await page.evaluate(fingerprint=>ask.applyDraft(fingerprint),fingerprint);
 assert.deepEqual(await page.evaluate(()=>[chat.snapshot().current.mainId,chat.snapshot().current.prompt]),[original.asset,'manual edit after proposal'],'stale drafts preserve manual changes');
 await askDraft(f,[{kind:'chat_handoff',destination:'current',images:['#a2'],options:{},text:'confirmed replacement'}]);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
 assert.equal(await page.evaluate(id=>chat.assets.assets.has(id),original.asset),true);
 await page.evaluate(()=>ask.deleteConversation(ask.conversationId.value));
 assert.deepEqual(await page.evaluate(id=>[chat.assets.assets.has(id),chat.snapshot().current.mainId,chat.assets.assets.has(chat.snapshot().current.mainId)],original.asset),[false,next.base,true],'forgetting undo releases old inputs but preserves the official CHAT image');
 assert.equal(f.requests.some(url=>/\/images\/(generations|edits)|\/ai\/generate|:generateContent/.test(url)),false);assert.deepEqual(f.errors,[]);
});

test('ASK attachments go to EDIT after favorite reload with original geometry and isolated same-number attachments', {timeout:90000},async t=>{
 const f=await setup(t),{page}=f;
 const prepare=async color=>page.evaluate(async color=>{
   await ask.setImages(false);app_shell.router.switchWorkspace('image');
   const blob=await makeImage(color,1800,1200);await ask.addFiles([new File([blob],'original.png',{type:'image/png'})]);
   return (await import('/src/domain/image-identity.ts')).imageEntity(blob);
 },color);
 const red=await prepare('#bb2244');
 await askDraft(f,[{kind:'edit_handoff',image:'#a1',mode:'img2img',prompt:'repair red',params:{model:'gpt-image-1.5'}}]);
 const first=await page.evaluate(()=>ask.draftPlan.value.edit.id);assert.equal(await page.evaluate(id=>!!editor.askSnapshot(id),first),false);
 await page.evaluate(async()=>{await ask.toggleFavorite();await ask.flushFavorites();});
 await page.reload();await page.waitForSelector('#prompt');
 await page.evaluate(async()=>{
   const p=document.body.__vue_app__._instance.provides;
   for(const n of ['ask','drawing','editor','chat','app-shell'])window[n.replaceAll('-','_')]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===n)];
   await ask.restored;await chat.start();
   window.makeImage=async(color,w,h)=>{const c=new OffscreenCanvas(w,h),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c.convertToBlob({type:'image/png'});};
 });
 await page.waitForFunction(id=>ask.draftPlan.value?.edit?.id===id,first);
 assert.deepEqual(await page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue)),[]);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));assert.match(page.url(),/#\/image$/);
 assert.equal(await page.evaluate(id=>!!editor.askSnapshot(id),first),true,JSON.stringify(await page.evaluate(()=>({notice:ask.notice.value,issues:ask.draftPlan.value?.steps.filter(s=>s.issue).map(s=>s.issue)}))));
 const read=id=>page.evaluate(id=>{const s=editor.askSnapshot(id),r=editor.record(s.source.recordId);return [s.source.width,s.source.height,r.entity_key,r.params.projectSource??null,s.config.fields.prompt]},id);
 assert.deepEqual(await read(first),[1800,1200,red,null,'repair red']);
 await page.evaluate(()=>ask.undoDraft());assert.equal(await page.evaluate(id=>!!editor.askSnapshot(id),first),false);
 await page.evaluate(()=>ask.restoreDraft(ask.redoId.value));assert.deepEqual(await read(first),[1800,1200,red,null,'repair red']);
 await page.evaluate(()=>ask.newConversation());const blue=await prepare('#2255bb');
 assert.equal(await page.evaluate(()=>ask.tray.value[0].id),'#a1');
 await askDraft(f,[{kind:'edit_handoff',image:'#a1',mode:'img2img',prompt:'repair blue',params:{model:'gpt-image-1.5'}}]);
 const second=await page.evaluate(()=>ask.draftPlan.value.edit.id);assert.notEqual(second,first);
 await page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));assert.deepEqual(await read(second),[1800,1200,blue,null,'repair blue']);assert.deepEqual(await read(first),[1800,1200,red,null,'repair red']);
 await page.evaluate(()=>ask.deleteConversation(ask.conversationId.value));assert.deepEqual(await read(second),[1800,1200,blue,null,'repair blue']);
 assert.equal(f.requests.some(url=>/\/images\/(generations|edits)|\/ai\/generate|:generateContent/.test(url)),false);assert.deepEqual(f.errors,[]);
});
