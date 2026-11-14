import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from './helpers/vite.mjs';
let server,browser,origin;
before(async()=>{server=await createServer();await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
const catalog={studio_features:{version:2,max_cost:true,max_context_images:3},valid_samplers:['k_euler_ancestral'],models:{
 'gpt-image-2':{name:'GPT Image 2',provider:'openai',editor_family:'gpt',operations:['generate','edit'],tools:['image-edit'],image_capabilities:{fields:{size:{options:['1024x1024'],default:'1024x1024'}}}},
 'gemini-3.1-flash-lite-image':{name:'Single image',provider:'gemini',operations:['generate','edit'],tools:['image-edit']},
 'nai-diffusion-4-5-full':{name:'NAI',provider:'novelai',operations:['generate','edit'],tools:['img2img','inpaint']}
}};
async function bind(page){await page.waitForFunction(()=>!!document.body.__vue_app__?._instance);await page.evaluate(async()=>{
 const p=document.body.__vue_app__._instance.provides,a=document.body.__vue_app__._context.provides;
 for(const name of ['annotations','ask','chat','editor','drawing','ui','app-shell'])window[name.replace('-','_')]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===name)];
 window.services=a[Object.getOwnPropertySymbols(a).find(k=>k.description==='application-services')];
 window.makeImage=async(w=256,h=256,color='#a12942')=>{const c=new OffscreenCanvas(w,h),g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,w,h);return c.convertToBlob({type:'image/png'});};
 window.readPixels=async(blob)=>{const b=await createImageBitmap(blob),c=new OffscreenCanvas(b.width,b.height),g=c.getContext('2d');g.drawImage(b,0,0);b.close();return g.getImageData(0,0,c.width,c.height);};
 window.makeSnapshot=async(blob)=>{const {imageEntity}=await import('/src/domain/image-identity.ts');const b=await createImageBitmap(blob),v={image:{tag:'#h1',entity_key:await imageEntity(blob),record_id:'synthetic',scope:{kind:'page',id:'test'}},width:b.width,height:b.height,regions:[{key:'r1',shape:'rect',bbox:{x:.25,y:.25,w:.25,h:.25},comment:'change eye'}],edges:{dilate:.006,feather:.003}};b.close();return v;};
});}
// EDIT keeps one send capsule beside the ASK launcher; destinations live in its menu by name.
async function send(page,target){await page.locator('#editorSend').click();await page.getByRole('menuitem',{name:target==='ask'?/^问 ASK/:target==='new'?'CHAT 改图 · 新对话':/^CHAT 改图 · 来源对话 /}).click();}
async function sendItems(page){await page.locator('#editorSend').click();const items=await page.locator('#editorSendMenu [role=menuitem]').evaluateAll(n=>n.map(e=>e.getAttribute('aria-label')||e.textContent.trim()));await page.keyboard.press('Escape');return items;}
async function addPoint(page,text,x=.5){const b=await page.locator('#editorStage').boundingBox();await page.mouse.click(b.x+b.width*x,b.y+b.height*.5);const c=page.getByPlaceholder('添加批注…');await c.fill(text);await c.press('Enter');}
async function setup(outputSize = [128, 128], maxContextImages = 3, { canvas = false } = {}){
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
 await page.goto('about:blank');
 const output=await page.evaluate(([w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#2580ec';g.fillRect(0,0,w,h);return c.toDataURL().split(',')[1];},outputSize);
 await context.addInitScript(()=>{if(!location.protocol.startsWith('http')||localStorage.getItem('koma.routing.v1'))return;localStorage.setItem('koma.routing.v1',JSON.stringify({version:1,connections:{test:{id:'test',name:'Synthetic',baseUrl:'https://gateway.example.test',profileId:'koma-standard-v1',credentialRef:'key',revision:'one'}},links:{}}));sessionStorage.setItem('koma.session.keys',JSON.stringify({key:'synthetic-only-key'}));});
 // Compact EDIT tools (one comparison menu) exist only in the canvas collaboration layout.
 if(canvas)await context.addInitScript(()=>{if(location.protocol.startsWith('http')&&!localStorage.getItem('koma.image.layout.v1'))localStorage.setItem('koma.image.layout.v1',JSON.stringify({enabled:true,ratio:.4,filmstripOpen:true}));});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();if(u.hostname!=='gateway.example.test')return route.abort();if(u.pathname.endsWith('/image/models'))return route.fulfill({json:{...catalog,studio_features:{...catalog.studio_features,max_context_images:maxContextImages}}});if(u.pathname.endsWith('/media/quota'))return route.fulfill({json:{credits:{remaining:1000}}});if(u.pathname.endsWith('/estimate'))return route.fulfill({json:{cost:0}});if(u.pathname.endsWith('/token_stats_data'))return route.fulfill({json:{temp_limits:{is_temp:false}}});posts.push(route.request().postDataJSON());return route.fulfill({json:{data:[{b64_json:output}]}});});
 await page.goto(origin+'/#/chat');await page.waitForFunction(()=>!!document.body.__vue_app__?._instance);await bind(page);await page.waitForFunction(()=>chat.snapshot().ready);await page.evaluate(()=>chat.setModel('gpt-image-2'));
 return {context,page,posts,errors};
}

test('boundary matching is optional, cached by settings, preserves raw and creates distinct explicit composites',async()=>{
 const t=await setup();try{
  const values=await t.page.evaluate(async()=>{
   await editor.open('image',await makeImage(),'color-source.png');editor.setModel('gpt-image-2');editor.setMode('inpaint');editor.patch({prompt:'adjust boundary'});
   const c=new OffscreenCanvas(256,256),x=c.getContext('2d');x.fillStyle='white';x.fillRect(64,64,128,128);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');
   await editor.run();const raw=editor.snapshot().viewed,board=editor.session.id,bytes=[...new Uint8Array(await raw.blob.arrayBuffer())];
   const on=await editor.previewComparison(board,raw.id,undefined,true),off=await editor.previewComparison(board,raw.id,undefined,false);
   const a=await readPixels(on),b=await readPixels(off),at=(64*256+90)*4;
   const first=await editor.applyComparison(board,raw.id,true),again=await editor.applyComparison(board,raw.id,true),second=await editor.applyComparison(board,raw.id,false);
   return {different:a.data.some((v,i)=>v!==b.data[i]),outside:[...a.data.slice(0,4)],edgeOn:[...a.data.slice(at,at+4)],edgeOff:[...b.data.slice(at,at+4)],same:first.id===again.id,distinct:first.id!==second.id,retained:editor.session.versions.includes(first),rawUnchanged:bytes.join() === [...new Uint8Array(await raw.blob.arrayBuffer())].join()};
  });
  assert.equal(values.different,true);assert.deepEqual(values.outside,[161,41,66,255]);assert.equal(values.same,true);assert.equal(values.distinct,true);assert.equal(values.retained,true);assert.equal(values.rawUnchanged,true);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('CHAT fusion launch returns a formal composite, persists settings and rejects stale reviews',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{const source=await makeImage(),snapshot=await makeSnapshot(source),{annotationPreview}=await import('/src/native/annotation-canvas.ts');await chat.prepareAnnotations(source,await annotationPreview(source,snapshot),snapshot);await chat.execute();});
  await t.page.waitForFunction(()=>!chat.snapshot().busy&&chat.snapshot().current.turns[0]?.versions[0]?.status==='done');
  const target=await t.page.evaluate(()=>{const c=chat.snapshot().current,t=c.turns.at(-1),v=t.versions.at(-1),raw=v.blocks.find(b=>b.type==='image').assetId;annotations.chatReview(c.id,t.id,v.id,raw);return {c:c.id,t:t.id,v:v.id,raw};});
  await t.page.getByRole('button',{name:'融合精修',exact:true}).click();
  const state=await t.page.evaluate(async target=>{
   const p=document.body.__vue_app__._instance.provides,photopea=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='photopea')],task=photopea.task.value;
   const valid=task.fusion.valid();await task.fusion.apply(await makeImage(256,256,'#667788'));photopea.close(task.id);await chat.flush();
   const c=chat.snapshot().current,v=c.turns.find(t=>t.id===target.t).versions.find(v=>v.id===target.v);
   const stale=chat.annotationReview(c.id,target.t,target.v,target.raw);chat.addConversation();let rejected=false;try{await stale.apply(await makeImage());}catch{rejected=true;}
   return {valid,composite:!!v.composites[target.raw],raw:v.blocks.some(b=>b.type==='image'&&b.assetId===target.raw),settings:v.compositeSettings[target.raw],rejected};
  },target);
  assert.equal(state.valid,true);assert.equal(state.composite,true);assert.equal(state.raw,true);assert.deepEqual(state.settings,{colorMatch:true,method:'photopea',boundaryColorVersion:1});assert.equal(state.rejected,true);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('compact fusion tools share the comparison menu, keep apply explicit and launch the frozen Photopea task',async()=>{
 const t=await setup(undefined,undefined,{canvas:true});try{
  await t.page.setViewportSize({width:390,height:844});
  await t.page.evaluate(async()=>{
   await editor.open('image',await makeImage(),'compact.png');editor.setModel('gpt-image-2');editor.setMode('inpaint');editor.patch({prompt:'adjust boundary'});
   const c=new OffscreenCanvas(256,256),x=c.getContext('2d');x.fillStyle='white';x.fillRect(64,64,128,128);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');await editor.run();
  });
  const menu=t.page.getByRole('button',{name:'选择比较图片',exact:true});
  await menu.click();await t.page.getByRole('menuitemradio',{name:'原图',exact:true}).click();
  assert.equal(await t.page.evaluate(()=>editor.askSnapshot().imageEditing.comparison.display.mode),'source');
  await menu.click();await t.page.getByRole('menuitemcheckbox',{name:'色彩对齐',exact:true}).click();
  assert.equal(await t.page.getByRole('menuitemcheckbox',{name:'色彩对齐',exact:true}).getAttribute('aria-checked'),'false');
  await t.page.getByRole('menuitemradio',{name:'蒙版替换',exact:true}).click();
  await t.page.getByRole('button',{name:'应用蒙版',exact:true}).click();await t.page.waitForFunction(()=>!!editor.snapshot().viewed?.params?.localComposite);
  assert.equal(await t.page.evaluate(()=>editor.snapshot().viewed.comparison.colorMatch),false);
  await menu.click();await t.page.getByRole('button',{name:'融合精修',exact:true}).click();
  const task=await t.page.evaluate(()=>{const p=document.body.__vue_app__._instance.provides,s=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='photopea')],t=s.task.value;const result={fusion:!!t?.fusion,color:t?.fusion.options.colorMatch,valid:t?.fusion.valid()};s.close(t.id);return result;});
  assert.deepEqual(task,{fusion:true,color:false,valid:true});assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT fusion commits full-coverage raw as a composite and rejects cancelled, duplicate and wrong-size returns',async()=>{
 const t=await setup();try{
  const result=await t.page.evaluate(async()=>{
   await editor.open('image',await makeImage(),'full-coverage.png');
   const sourceId=editor.snapshot().viewed.id,token=editor.beginExternalEdit();
   const raw=await editor.applyExternalEdit(token.id,{mode:'image',image:await makeImage(256,256,'#667788')});
   const bits=new Uint8Array(256*256/8);bits.fill(255);
   raw.comparison={sourceId,rawId:raw.id,mask:{width:256,height:256,bits},edges:{dilate:0,feather:0}};
   const board=editor.session.id,count=editor.session.versions.length;
   const cancelled=editor.beginComparisonFusion(board,raw.id,false);cancelled.fusion.cancel(false);
   let stale=false;try{await cancelled.fusion.apply(raw.blob);}catch{stale=true;}
   const task=editor.beginComparisonFusion(board,raw.id,false);
   let wrongSize=false;try{await task.fusion.apply(await makeImage(128,128));}catch{wrongSize=true;}
   const unchanged=editor.session.versions.length===count;await task.fusion.apply(raw.blob);
   let duplicate=false;try{await task.fusion.apply(raw.blob);}catch{duplicate=true;}
   return {stale,wrongSize,unchanged,duplicate,added:editor.session.versions.length-count,kind:editor.snapshot().viewed.kind,
    formal:raw.comparison.compositeId===editor.snapshot().viewed.id,raw:editor.session.versions.includes(raw)};
  });
  assert.deepEqual(result,{stale:true,wrongSize:true,unchanged:true,duplicate:true,added:1,kind:'manual',formal:true,raw:true});assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('focused fusion maps crop coordinates and transports feathered alpha without binary thresholding',async()=>{
 const t=await setup();try{
  const result=await t.page.evaluate(async()=>{
   const {prepareMaskedResult}=await import('/src/native/inpaint-result.ts'),{photopeaSoftMask}=await import('/src/native/photopea-input.ts');
   const {inpaintFocusPlan}=await import('/src/domain/inpaint-focus.ts');
   const bits=new Uint8Array(512*512/8);for(let y=160;y<352;y++)for(let x=160;x<352;x++){const p=y*512+x;bits[p>>3]|=1<<(p&7);}
   const focus=inpaintFocusPlan({width:512,height:512},{x:128,y:128,width:256,height:256});
   const prepared=await prepareMaskedResult(await makeImage(512,512,'#224466'),await makeImage(1024,1024,'#aa7755'),{width:512,height:512,bits},{dilate:.006,feather:.01},{focus,colorMatch:false});
   const image=await readPixels(prepared.composite),alpha=await readPixels(await photopeaSoftMask(prepared.softMask));
   const at=(x,y)=>[...image.data.slice((y*512+x)*4,(y*512+x)*4+4)];
   return {outside:at(0,0),context:at(140,140),inside:at(256,256),soft:alpha.data.some((v,i)=>i%4===3&&v>0&&v<255),transparent:alpha.data[3]===0};
  });
  assert.deepEqual(result.outside,[34,68,102,255]);assert.deepEqual(result.context,[34,68,102,255]);assert.deepEqual(result.inside,[170,119,85,255]);assert.equal(result.soft,true);assert.equal(result.transparent,true);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('local fusion overlays transparent AI pixels without punching holes in the frozen source',async()=>{
 const t=await setup();try{
  const pixels=await t.page.evaluate(async()=>{
   const {prepareMaskedResult}=await import('/src/native/inpaint-result.ts');
   const c=new OffscreenCanvas(256,256),x=c.getContext('2d');x.fillStyle='rgba(200,100,50,0.5)';x.fillRect(128,0,128,256);
   const raw=await c.convertToBlob({type:'image/png'}),bits=new Uint8Array(256*256/8);bits.fill(255);
   const prepared=await prepareMaskedResult(await makeImage(256,256,'#224466'),raw,{width:256,height:256,bits},{dilate:0,feather:0},{colorMatch:false});
   const p=await readPixels(prepared.composite);return {clear:[...p.data.slice(0,4)],half:[...p.data.slice(128*4,128*4+4)]};
  });
  assert.deepEqual(pixels.clear,[34,68,102,255]);assert.equal(pixels.half[3],255);assert.ok(Math.abs(pixels.half[0]-117)<=1);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});
test('IMAGE annotation entries reuse EDIT, select the requested image and restore its comments',async()=>{
 const t=await setup();try{
  const recordId=await t.page.evaluate(async()=>{
   const {seedHistory}=await import('/tests/helpers/drawing-history.mjs');
   const r=await seedHistory({drawing},await makeImage(512,512),{width:512,height:512},{model:'nai-diffusion-4-5-full',prompt:'source instructions',seed:0});
   app_shell.router.switchWorkspace('image');return r.id;
  });
  await t.page.getByRole('button',{name:'批注这张图',exact:true}).click();
  await t.page.locator('#editorStage .annotation-svg').waitFor();
  assert.equal(await t.page.locator('dialog.region-annotator').count(),0);
  assert.equal(await t.page.evaluate(()=>app_shell.router.route.value.workspace),'edit');
  const before=await t.page.evaluate(()=>({board:editor.session.id,version:editor.session.viewId,source:editor.snapshot().viewed.sourceId,prompt:editor.session.fields.prompt,upscale:editor.snapshot().upscaleOpen}));
  assert.equal(before.source,`record:${recordId}`);assert.equal(before.prompt,'source instructions');assert.equal(before.upscale,false);
  const b=await t.page.locator('#editorStage').boundingBox();await t.page.mouse.click(b.x+b.width*.3,b.y+b.height*.3);
  await t.page.getByPlaceholder('添加批注…').fill('remember this point');await t.page.getByPlaceholder('添加批注…').press('Enter');
  await t.page.evaluate(async()=>{
   annotations.close();const token=editor.beginExternalEdit();await editor.applyExternalEdit(token.id,{mode:'image',image:await makeImage(512,512,'#2580ec')});
   app_shell.router.switchWorkspace('image');
  });
  await t.page.locator('#image').click();await t.page.locator('#lightbox').getByRole('button',{name:'批注',exact:true}).click();
  await t.page.locator('#editorStage .annotation-svg').waitFor();
  assert.deepEqual(await t.page.evaluate(()=>({board:editor.session.id,version:editor.session.viewId})),{board:before.board,version:before.version});
  assert.equal(await t.page.evaluate(()=>annotations.active.value.snapshot.regions[0].comment),'remember this point');
  assert.equal(await t.page.locator('#lightbox').isVisible(),false);assert.equal(t.posts.length,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('CHAT image annotation enters EDIT and returns the guide to the same conversation without sending',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{chat.setPrompt('synthetic image');await chat.execute();await chat.flush();});
  // Rows stored before image identities (or restored from a backup) have no entity_key; the content id still identifies them.
  await t.page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('koma-chat');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const tx=open.result.transaction('assets','readwrite'),store=tx.objectStore('assets'),all=store.getAll();all.onsuccess=()=>{for(const row of all.result){delete row.entity_key;store.put(row);}};tx.oncomplete=()=>{open.result.close();resolve();};tx.onerror=()=>reject(tx.error);};}));
  await t.page.reload();await bind(t.page);await t.page.waitForFunction(()=>chat.snapshot().ready);
  assert.ok(await t.page.evaluate(()=>[...chat.assets.assets.values()].every(a=>a.entity_key===`sha256:${a.id}`)));
  const before=await t.page.evaluate(()=>({conversation:chat.snapshot().current.id,turns:chat.snapshot().current.turns.length,asset:chat.snapshot().current.turns[0].versions[0].blocks.find(b=>b.type==='image').assetId}));
  await t.page.locator('.chat-art img').click();await t.page.locator('.chat-lightbox').getByRole('button',{name:'批注',exact:true}).click();
  await t.page.locator('#editorStage .annotation-svg').waitFor();
  const target=await t.page.evaluate(()=>({workspace:app_shell.router.route.value.workspace,origin:editor.session.origin,chat:annotations.active.value.target.chat}));
  assert.equal(target.workspace,'edit');assert.equal(target.origin,'chat');assert.equal(target.chat.assetId,before.asset);
  assert.equal(await t.page.locator('.chat-lightbox').isVisible(),false);assert.equal(await t.page.locator('dialog.region-annotator').count(),0);
  const b=await t.page.locator('#editorStage').boundingBox();await t.page.mouse.click(b.x+b.width*.5,b.y+b.height*.5);
  await t.page.getByPlaceholder('添加批注…').fill('edit this point');await send(t.page,'source');
  await t.page.waitForFunction(()=>!!chat.snapshot().current.pendingAnnotation);
  const result=await t.page.evaluate(()=>({conversation:chat.snapshot().current.id,turns:chat.snapshot().current.turns.length,comment:chat.snapshot().current.pendingAnnotation.snapshot.regions[0].comment}));
  assert.equal(result.conversation,before.conversation);assert.equal(result.turns,before.turns);assert.equal(result.comment,'edit this point');assert.equal(t.posts.length,1);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('CHAT-origin EDIT boards return to their own conversation from every entry and only open a new one on request',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{chat.setPrompt('synthetic image');await chat.execute();});
  const source=await t.page.evaluate(()=>{const c=chat.snapshot().current;return {id:c.id,title:c.title,turn:c.turns[0].id,asset:c.turns[0].versions[0].blocks.find(b=>b.type==='image').assetId};});
  const state=()=>t.page.evaluate(()=>{const s=chat.snapshot(),c=s.current;return {workspace:app_shell.router.route.value.workspace,conversation:c.id,count:s.conversations.length,turns:c.turns.length,head:c.headId,regions:c.pendingAnnotation?.snapshot.regions.map(r=>r.comment)??[]};});
  const kept=()=>t.page.evaluate(id=>chat.snapshot().conversations.find(c=>c.id===id).keepIds,source.id);
  // Entered from a result tool, not from 批注: the board still knows its conversation.
  await t.page.evaluate(async()=>{const c=chat.snapshot().current,v=c.turns[0].versions[0],a=chat.assets.assets.get(v.blocks.find(b=>b.type==='image').assetId);await editor.open('chat',a.blob,a.name,{conversationId:c.id});});
  await t.page.locator('#imageEditor[data-active=true]').waitFor();
  assert.deepEqual(await sendItems(t.page),['问 ASK',`CHAT 改图 · 来源对话 ${source.title}`,'CHAT 改图 · 新对话']);
  await t.page.locator('#editorAnnotate').click();await t.page.locator('#editorStage .annotation-svg').waitFor();
  assert.equal(await t.page.evaluate(()=>annotations.active.value.target.chat.turnId),source.turn);
  await addPoint(t.page,'first',.3);
  // Leaving and re-entering annotation, then switching CHAT elsewhere, keeps the destination.
  await t.page.getByRole('button',{name:'完成批注',exact:true}).click();await t.page.locator('#editorStage .annotation-svg').waitFor({state:'hidden'});
  await t.page.locator('#editorAnnotate').click();await t.page.locator('#editorStage .annotation-svg').waitFor();
  await addPoint(t.page,'second',.7);
  await t.page.evaluate(()=>{chat.addConversation();chat.setPrompt('other draft');});
  await send(t.page,'source');await t.page.waitForFunction(()=>app_shell.router.route.value.workspace==='chat'&&!!chat.snapshot().current.pendingAnnotation);
  assert.deepEqual(await state(),{workspace:'chat',conversation:source.id,count:2,turns:1,head:source.turn,regions:['first','second']});
  assert.equal(await t.page.evaluate(()=>chat.snapshot().conversations.find(c=>c.prompt==='other draft')?.pendingAnnotation),undefined);
  // A clean picture joins the source conversation as a reference instead of opening another.
  await t.page.evaluate(()=>chat.clearAnnotations());assert.equal((await kept()).includes(source.asset),false);
  await t.page.evaluate(()=>{chat.switchConversation(chat.snapshot().conversations.find(c=>c.prompt==='other draft'));app_shell.router.switchWorkspace('edit');});await t.page.locator('#imageEditor[data-active=true]').waitFor();
  await send(t.page,'source');await t.page.waitForFunction(()=>app_shell.router.route.value.workspace==='chat');
  assert.deepEqual(await state(),{workspace:'chat',conversation:source.id,count:2,turns:1,head:source.turn,regions:[]});assert.equal((await kept()).includes(source.asset),true);
  // 新对话 is explicit and leaves the source conversation untouched.
  await t.page.evaluate(()=>app_shell.router.switchWorkspace('edit'));await t.page.locator('#imageEditor[data-active=true]').waitFor();
  await t.page.locator('#editorAnnotate').click();await t.page.locator('#editorStage .annotation-svg').waitFor();
  await t.page.evaluate(()=>annotations.update([]));await addPoint(t.page,'fresh');
  await send(t.page,'new');await t.page.waitForFunction(()=>app_shell.router.route.value.workspace==='chat'&&!!chat.snapshot().current.pendingAnnotation);
  const fresh=await state();assert.notEqual(fresh.conversation,source.id);assert.equal(fresh.turns,0);assert.deepEqual(fresh.regions,['fresh']);
  assert.equal(await t.page.evaluate(id=>chat.snapshot().conversations.find(c=>c.id===id).pendingAnnotation,source.id),undefined);
  assert.equal(await t.page.locator('#imageEditor').getByRole('button',{name:'添加为参考图',exact:true}).count(),0);
  assert.equal(t.posts.length,1);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('local composition uses source resolution, real shapes, finite Gaussian alpha, and preserves every exterior pixel',async()=>{
 const t=await setup();try{const result=await t.page.evaluate(async()=>{
 const {composeAnnotatedResult}=await import('/src/native/inpaint-result.ts'),{annotationMask,annotationAlpha,annotationPreview}=await import('/src/native/annotation-canvas.ts');
 const source=await makeImage(256,384),raw=await makeImage(128,192,'#2580ec'),snapshot=await makeSnapshot(source);
 snapshot.regions=[{key:'e',shape:'ellipse',bbox:{x:.2,y:.2,w:.2,h:.2},comment:'eye'},{key:'p',shape:'polygon',bbox:{x:.6,y:.6,w:.2,h:.2},points:[{x:.6,y:.6},{x:.8,y:.6},{x:.6,y:.8}],comment:'mouth'}];
 const mask=annotationMask(snapshot),alpha=annotationAlpha(mask,snapshot.edges),merged=await composeAnnotatedResult(source,raw,snapshot),original=await readPixels(source),pixels=await readPixels(merged);
 let unchanged=0,wrong=0,soft=0;for(let p=0;p<alpha.length;p++){if(!alpha[p]){unchanged++;for(let c=0;c<4;c++)if(original.data[p*4+c]!==pixels.data[p*4+c])wrong++;}else if(alpha[p]<255)soft++;}
 const marked=await readPixels(await annotationPreview(source,snapshot));let rejects=false;try{await composeAnnotatedResult(source,await makeImage(256,256),snapshot);}catch{rejects=true;}
 return {width:pixels.width,height:pixels.height,unchanged,wrong,soft,rejects,guideChanged:marked.data.some((v,i)=>v!==original.data[i]),rawUnchanged:(await readPixels(raw)).data[0]===37,ellipseCorner:alpha[Math.floor(.2*384)*256+Math.floor(.2*256)]};
 });assert.equal(result.width,256);assert.equal(result.height,384);assert.equal(result.wrong,0);assert.ok(result.unchanged>70000);assert.ok(result.soft>0,JSON.stringify(result));assert.equal(result.ellipseCorner,0);assert.equal(result.rejects,true);assert.equal(result.guideChanged,true);assert.equal(result.rawUnchanged,true);assert.deepEqual(t.errors,[]);}finally{await t.context.close();}
});
test('drawing and ASK preparation use normalized geometry and clean-attachment coordinates without sending',async()=>{
 const t=await setup();try{
 await t.page.evaluate(async()=>{const blob=await makeImage(512,384);await annotations.open({blob,name:'synthetic.png',recordId:'test',workspace:'image'});});
 await t.page.locator('#editorViewport').press('r');const image=t.page.locator('#editorStage');await image.waitFor();await t.page.locator('#editorStage .annotation-svg').waitFor();await t.page.waitForFunction(()=>document.querySelector('#editorImage')?.complete);await t.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const box=await image.boundingBox();
 await t.page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await t.page.mouse.down();await t.page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:5});await t.page.mouse.up();
 await t.page.getByPlaceholder('添加批注…').fill('检查眼睛');await t.page.getByPlaceholder('添加批注…').press('Enter');
 await t.page.locator('#editorViewport').press('c');await t.page.mouse.click(box.x+box.width*.75,box.y+box.height*.75);await t.page.getByPlaceholder('添加批注…').fill('嘴巴');await t.page.getByPlaceholder('添加批注…').press('Enter');
 const regions=await t.page.evaluate(()=>annotations.active.value.snapshot.regions);assert.equal(regions.length,2);assert.ok(Math.abs(regions[0].bbox.w-.3)<.01);assert.equal(regions[1].shape,'point');assert.deepEqual(regions[1].bbox,{x:.75,y:.75,w:0,h:0});
 await send(t.page,'ask');await t.page.waitForFunction(()=>!annotations.active.value);
 const prepared=await t.page.evaluate(()=>({input:ask.input.value,entries:ask.entries.value.length,tray:ask.tray.value}));assert.equal(prepared.entries,0);assert.equal(prepared.tray.length,2);assert.equal(prepared.input,'');assert.deepEqual(prepared.tray[0].annotations.snapshot.regions,regions);assert.equal(prepared.tray[0].annotations.guideId,prepared.tray[1].id);assert.equal(await t.page.getByRole('region',{name:'批注附件'}).count(),1);assert.equal(t.posts.length,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});
test('annotation polygon vertices, comment edits and clear support local undo and redo',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await annotations.open({blob:await makeImage(512,512),name:'polygon.png',recordId:'polygon',workspace:'image'});});
  await t.page.getByRole('button',{name:'多边形 · P',exact:true}).click();
  const b=await t.page.locator('#editorStage').boundingBox(),at=(x,y)=>[b.x+b.width*x,b.y+b.height*y];
  for(const p of [[.2,.2],[.7,.2],[.7,.7]])await t.page.mouse.click(...at(...p));
  await t.page.getByRole('button',{name:'撤销顶点',exact:true}).click();
  assert.equal(await t.page.getByRole('button',{name:'闭合多边形',exact:true}).isEnabled(),false);
  await t.page.mouse.click(...at(.7,.7));await t.page.getByRole('button',{name:'闭合多边形',exact:true}).click();
  const c=t.page.getByPlaceholder('添加批注…');await c.fill('原批注');await c.press('Enter');
  const read=()=>t.page.evaluate(()=>structuredClone(annotations.active.value.snapshot.regions));
  const original=await read();assert.equal(original[0].points.length,3);
  await t.page.locator('[data-midpoint="0"] circle').click();assert.equal((await read())[0].points.length,4);
  await t.page.getByRole('button',{name:'删除顶点',exact:true}).click();assert.deepEqual(await read(),original);
  // The comment/vertex toolbar can refit the image after the polygon was drawn.
  const vertex=t.page.locator('[data-vertex="1"]');await vertex.click({trial:true});
  const v=await vertex.boundingBox(),image=await t.page.locator('#editorStage').boundingBox();
  await t.page.mouse.move(v.x+v.width/2,v.y+v.height/2);await t.page.mouse.down();await t.page.mouse.move(image.x+image.width*.8,image.y+image.height*.3,{steps:4});await t.page.mouse.up();
  const moved=await read();assert.equal(moved[0].key,original[0].key);assert.ok(Math.abs(moved[0].points[1].x-.8)<.01);
  await t.page.getByRole('button',{name:'撤销批注',exact:true}).click();assert.deepEqual(await read(),original);
  await t.page.getByRole('button',{name:'重做批注',exact:true}).click();assert.deepEqual(await read(),moved);
  await t.page.getByRole('button',{name:'清空批注',exact:true}).click();assert.deepEqual(await read(),[]);
  await t.page.getByRole('button',{name:'撤销批注',exact:true}).click();assert.deepEqual(await read(),moved);
  await t.page.locator('[data-region] .annotation-number').click();await t.page.getByRole('button',{name:'编辑批注',exact:true}).click();await c.fill('修改后的批注');await c.press('Enter');
  await t.page.locator('#editorViewport').press('ControlOrMeta+z');assert.deepEqual(await read(),moved);
  assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});
test('pinch zoom cancels an unfinished annotation instead of committing a spurious point',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await annotations.open({blob:await makeImage(512,512),name:'pinch.png',recordId:'pinch',workspace:'image'});});
  const b=await t.page.locator('#editorStage').boundingBox(),cdp=await t.context.newCDPSession(t.page);
  const p=(x,y,id)=>({x:b.x+b.width*x,y:b.y+b.height*y,id,radiusX:1,radiusY:1});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(.3,.4,1)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(.3,.4,1),p(.6,.4,2)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p(.2,.4,1),p(.7,.4,2)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.deepEqual(await t.page.evaluate(()=>annotations.active.value.snapshot.regions),[]);
  assert.equal(await t.page.getByPlaceholder('添加批注…').count(),0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});
test('CHAT double-image requests freeze annotations, keep raw until manual apply and survive reload without guide reuse',async()=>{
 const t=await setup();try{
 const before=await t.page.evaluate(async()=>{const source=await makeImage(),snapshot=await makeSnapshot(source),{annotationPreview}=await import('/src/native/annotation-canvas.ts');await chat.prepareAnnotations(source,await annotationPreview(source,snapshot),snapshot);return {base:chat.snapshot().current.mainId,guide:chat.snapshot().current.pendingAnnotation.guideAssetId};});
 await t.page.evaluate(()=>chat.execute());await t.page.waitForFunction(()=>!chat.snapshot().busy&&chat.snapshot().current.turns[0]?.versions[0]?.status==='done');
 assert.equal(t.posts.length,1);assert.ok(t.posts[0].init_image);assert.equal(t.posts[0].additional_images.length,1);assert.equal(t.posts[0].mask_image,undefined);
 let state=await t.page.evaluate(()=>{const s=chat.snapshot(),c=s.current;return {main:c.mainId,keep:c.keepIds,images:s.context.imageIds,assets:[...chat.assets.assets.keys()],snapshot:c.turns[0].snapshot};});assert.equal(state.main,before.base);assert.ok(!state.keep.includes(before.guide));assert.ok(!state.images.includes(before.guide));assert.ok(state.assets.includes(before.guide));assert.equal(state.snapshot.imageIds[1],before.guide);
 await t.page.getByRole('button',{name:'审核并应用蒙版',exact:true}).click();await t.page.getByRole('button',{name:'蒙版替换',exact:true}).click();await t.page.getByRole('button',{name:'应用蒙版',exact:true}).click();await t.page.waitForFunction(()=>!annotations.review.value);
 const saved=await t.page.evaluate(async()=>{await chat.flush();const c=chat.snapshot().current,t=c.turns[0],v=t.versions[0],raw=v.blocks.find(b=>b.type==='image').assetId,merged=v.composites[raw];const p=await readPixels(chat.assets.get(merged).blob);return {id:c.id,base:c.mainId,raw,merged,width:p.width,outside:Array.from(p.data.slice(0,4)),inside:Array.from(p.data.slice((90*256+90)*4,(90*256+90)*4+4))};});
 assert.equal(saved.base,saved.merged);assert.notEqual(saved.raw,saved.merged);assert.equal(saved.width,256);assert.deepEqual(saved.outside,[161,41,66,255]);assert.deepEqual(saved.inside,[37,128,236,255]);
 await t.page.getByRole('button',{name:'查看模型直出',exact:true}).click();assert.equal(await t.page.evaluate(()=>chat.snapshot().current.mainId),saved.base);
 await t.page.reload();await bind(t.page);await t.page.waitForFunction(()=>chat.snapshot().ready);
 const restored=await t.page.evaluate(()=>{const c=chat.snapshot().current;return {id:c.id,base:c.mainId,ids:[...chat.assets.assets.keys()],images:chat.snapshot().context.imageIds,composites:c.turns[0].versions[0].composites};});
 assert.equal(restored.id,saved.id);assert.equal(restored.base,saved.merged);assert.ok(restored.ids.includes(saved.raw));assert.ok(!restored.images.includes(before.guide));assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});
test('single-image sources block guide truncation; explicit positional fallback is allowed',async()=>{
 const t=await setup();try{
 await t.page.evaluate(async()=>{const source=await makeImage(),snapshot=await makeSnapshot(source),{annotationPreview}=await import('/src/native/annotation-canvas.ts');await chat.prepareAnnotations(source,await annotationPreview(source,snapshot),snapshot);chat.setModel('gemini-3.1-flash-lite-image');await chat.execute();});assert.equal(t.posts.length,0);
 await t.page.evaluate(async()=>{chat.annotationTextOnly(true);await chat.execute();});assert.equal(t.posts.length,1);assert.equal(t.posts[0].additional_images.length,0);assert.match(t.posts[0].prompt,/原点在左上角/);assert.equal(await t.page.evaluate(()=>chat.snapshot().current.attachments.length),0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('annotation ZIP restores clean/guide/raw/composite assets and pending edits after clearing, including conflict copies',async()=>{
 const t=await setup();try{
  const saved=await t.page.evaluate(async()=>{
   const {annotationPreview}=await import('/src/native/annotation-canvas.ts');
   const {composeAnnotatedResult}=await import('/src/native/inpaint-result.ts');
   const source=await makeImage(),snapshot=await makeSnapshot(source);
   await chat.prepareAnnotations(source,await annotationPreview(source,snapshot),snapshot);
   await chat.execute();
   const c=chat.snapshot().current,turn=c.turns[0],version=turn.versions[0];
   const raw=version.blocks.find(b=>b.type==='image').assetId;
   const review=chat.annotationReview(c.id,turn.id,version.id,raw);
   await review.apply(await composeAnnotatedResult(review.source,review.raw,review.snapshot));
   const merged=version.composites[raw];
   const pendingSource=await makeImage(320,320,'#e2b969'),pendingSnapshot=await makeSnapshot(pendingSource);
   pendingSnapshot.regions[0].comment='下一处尚未发送';
   await chat.prepareAnnotations(pendingSource,await annotationPreview(pendingSource,pendingSnapshot),pendingSnapshot);
   window.annotationZip=(await services.backup.export()).blob;
   window.annotationBackup=await services.backup.read(annotationZip);
   window.annotationExpected=structuredClone(annotationBackup.conversations);
   return {
    completedId:c.id,pendingId:chat.snapshot().current.id,raw,merged,
    annotation:turn.snapshot.annotation,conversations:annotationExpected,
    assets:annotationBackup.assets.map(a=>({id:a.id,width:a.width,height:a.height})),
    signature:Array.from(new Uint8Array(await annotationZip.slice(0,4).arrayBuffer()))
   };
  });
  assert.deepEqual(saved.signature,[80,75,3,4]);assert.equal(saved.conversations.length,2);
  assert.notEqual(saved.raw,saved.merged);assert.equal(t.posts.length,1);
  const required=[saved.annotation.sourceAssetId,saved.annotation.inputAssetId,saved.annotation.guideAssetId,saved.raw,saved.merged];
  for(const id of required)assert.ok(saved.assets.some(a=>a.id===id),id);
  // Clear the synthetic browser's stores under the same maintenance lease used by import.
  const cleared=await t.page.evaluate(async()=>{
   const {names}=await import('/src/storage/names.ts'),{transactionDone}=await import('/src/storage/databases.ts');
   await services.data.import(async()=>{
    const tx=services.databases.transaction(names.databases.chat,['conversations','assets'],'readwrite'),done=transactionDone(tx);
    tx.objectStore('conversations').clear();tx.objectStore('assets').clear();await done;
   });
   return {assets:chat.assets.assets.size,old:chat.snapshot().conversations.some(c=>annotationExpected.some(e=>e.id===c.id))};
  });
  assert.deepEqual(cleared,{assets:0,old:false});
  const restored=await t.page.evaluate(async()=>{
   const counts=await services.backup.import(await services.backup.read(annotationZip));
   const {hashImage}=await import('/src/services/backup.ts');
   return {
    counts,current:chat.snapshot().current.id,
    conversations:annotationExpected.map(e=>structuredClone(chat.snapshot().conversations.find(c=>c.id===e.id))),
    assets:await Promise.all([...chat.assets.assets.values()].map(async a=>{
     const pixels=await readPixels(a.blob);return {id:a.id,hash:await hashImage(a.blob),entity:a.entity_key,width:pixels.width,height:pixels.height};
    }))
   };
  });
  assert.deepEqual(restored.counts,{favorites:0,conversations:2});assert.equal(restored.current,saved.pendingId);
  assert.deepEqual(restored.conversations,saved.conversations);
  assert.equal(restored.assets.length,saved.assets.length);
  for(const expected of saved.assets){
   const actual=restored.assets.find(a=>a.id===expected.id);assert.ok(actual,expected.id);
   assert.equal(actual.hash,expected.id);assert.equal(actual.entity,`sha256:${expected.id}`);
   assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);
  }
  // Importing over changed local drafts must preserve them and remap the imported copies.
  const conflicts=await t.page.evaluate(async()=>{
   for(const expected of annotationExpected){chat.switchConversation(chat.snapshot().conversations.find(c=>c.id===expected.id));chat.setPrompt(`本机保留 ${expected.id}`);}
   await chat.flush();const counts=await services.backup.import(annotationBackup),again=await services.backup.import(annotationBackup);
   return {counts,again,rows:annotationExpected.map(e=>({
    original:structuredClone(chat.snapshot().conversations.find(c=>c.id===e.id)),
    copy:structuredClone(chat.snapshot().conversations.find(c=>c.id===`import-${annotationBackup.id}-${e.id}`))
   }))};
  });
  assert.deepEqual(conflicts.counts,{favorites:0,conversations:2});assert.deepEqual(conflicts.again,{favorites:0,conversations:0});
  for(const expected of saved.conversations){
   const {original,copy}=conflicts.rows.find(r=>r.original.id===expected.id);
   assert.equal(original.prompt,`本机保留 ${expected.id}`);assert.equal(copy.title,`${expected.title}（导入）`);
   assert.equal(copy.prompt,expected.prompt);assert.deepEqual(copy.pendingAnnotation,expected.pendingAnnotation);
   assert.deepEqual(copy.keepIds,expected.keepIds);assert.deepEqual(copy.attachments,expected.attachments);
   assert.equal(copy.mainId,expected.mainId);
   if(expected.turns.length){
    assert.notEqual(copy.turns[0].id,expected.turns[0].id);assert.equal(copy.headId,copy.turns[0].id);
    assert.notEqual(copy.turns[0].versions[0].id,expected.turns[0].versions[0].id);
    assert.deepEqual(copy.turns[0].snapshot,expected.turns[0].snapshot);
    assert.deepEqual(copy.turns[0].versions[0].composites,expected.turns[0].versions[0].composites);
   }
  }
  const completedCopy=conflicts.rows.find(r=>r.original.id===saved.completedId).copy;
  const followup=await t.page.evaluate(async({id,raw,merged})=>{
   const {composeAnnotatedResult}=await import('/src/native/inpaint-result.ts'),{hashImage}=await import('/src/services/backup.ts');
   const c=chat.snapshot().conversations.find(c=>c.id===id),turn=c.turns[0],version=turn.versions[0];chat.switchConversation(c);
   const review=chat.annotationReview(c.id,turn.id,version.id,raw),composed=await hashImage(await composeAnnotatedResult(review.source,review.raw,review.snapshot));
   chat.setPrompt('普通后续改图');await chat.execute();await chat.flush();
   return {composed,merged,keep:c.keepIds,snapshot:structuredClone(c.turns.at(-1).snapshot)};
  },{id:completedCopy.id,raw:saved.raw,merged:saved.merged});
  assert.equal(followup.composed,saved.merged);assert.equal(followup.snapshot.annotation,undefined);
  assert.ok(!followup.keep.includes(saved.annotation.guideAssetId));assert.ok(!followup.snapshot.imageIds.includes(saved.annotation.guideAssetId));
  assert.ok(!followup.snapshot.text.includes('图 2 是同尺寸的定位图'));assert.equal(t.posts.length,2);assert.equal(t.posts[1].additional_images.length,0);
  const reexported=await t.page.evaluate(async()=>{
   const checked=await services.backup.read((await services.backup.export()).blob);
   return {ids:checked.conversations.map(c=>c.id),assets:checked.assets.map(a=>a.id)};
  });
  assert.ok(reexported.ids.includes(completedCopy.id));for(const id of required)assert.ok(reexported.assets.includes(id));
  assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('polygon double-click closure, resize and deletion preserve keys and sequential labels',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>annotations.open({blob:await makeImage(512,512),name:'shape.png',recordId:'shapes',workspace:'image'}));
  await t.page.locator('#editorStage .annotation-svg').waitFor();await t.page.waitForFunction(()=>document.querySelector('#editorImage')?.complete);await t.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await t.page.locator('#editorViewport').press('r');const b=await t.page.locator('#editorStage').boundingBox();
  await t.page.mouse.move(b.x+b.width*.1,b.y+b.height*.1);await t.page.mouse.down();await t.page.mouse.move(b.x+b.width*.3,b.y+b.height*.3,{steps:5});await t.page.mouse.up();await t.page.getByPlaceholder('添加批注…').waitFor({state:'visible'});await t.page.getByPlaceholder('添加批注…').press('Enter');await t.page.getByPlaceholder('添加批注…').waitFor({state:'hidden'});
  const before=await t.page.evaluate(()=>structuredClone(annotations.active.value.snapshot.regions[0]));
  const handle=await t.page.locator('.annotation-svg [data-corner="se"]').boundingBox();await t.page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await t.page.mouse.down();await t.page.mouse.move(handle.x+handle.width/2+40,handle.y+handle.height/2+40,{steps:4});await t.page.mouse.up();
  const resized=await t.page.evaluate(()=>annotations.active.value.snapshot.regions[0]);assert.equal(resized.key,before.key);assert.ok(resized.bbox.w>before.bbox.w);
  await t.page.getByRole('button',{name:'多边形 · P',exact:true}).click();for(const [x,y] of [[.6,.6],[.8,.6]])await t.page.mouse.click(b.x+b.width*x,b.y+b.height*y);await t.page.mouse.dblclick(b.x+b.width*.7,b.y+b.height*.85);await t.page.getByPlaceholder('添加批注…').fill('polygon');await t.page.getByPlaceholder('添加批注…').press('Enter');
  let shapes=await t.page.evaluate(()=>annotations.active.value.snapshot.regions);assert.equal(shapes.length,2);assert.equal(shapes[1].shape,'polygon');assert.equal(shapes[1].points.length,3);
  await t.page.getByRole('button',{name:'选择 · V',exact:true}).click();await t.page.locator(`[data-region="${before.key}"] .annotation-shape`).click();await t.page.locator('#editorViewport').press('Delete');
  shapes=await t.page.evaluate(()=>annotations.active.value.snapshot.regions);assert.equal(shapes.length,1);assert.equal(shapes[0].comment,'polygon');assert.equal(await t.page.locator('[data-region] .annotation-number text').textContent(),'1');assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('click annotation creates a movable point without a selection or resize handles; comments, viewport resize and pan preserve it',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>annotations.open({blob:await makeImage(512,512),name:'comment.png',recordId:'comments',workspace:'image'}));
  await t.page.locator('#editorStage .annotation-svg').waitFor();await t.page.waitForFunction(()=>document.querySelector('#editorImage')?.complete);
  await t.page.locator('#editorViewport').press('c');
  await t.page.locator('#editorStage').click({position:{x:160,y:160},trial:true});
  const image=await t.page.locator('#editorStage').boundingBox();await t.page.mouse.click(image.x+160,image.y+160);
  const comment=t.page.getByPlaceholder('添加批注…');
  await comment.waitFor({state:'visible'});await comment.fill('保留线稿');await comment.press('Enter');await comment.waitFor({state:'hidden'});
  await t.page.getByRole('button',{name:'编辑批注',exact:true}).click();
  await comment.waitFor({state:'visible'});await comment.fill('柔和光影');await comment.press('h');assert.equal(await t.page.locator('.annotation-stage').getAttribute('data-tool'),'point');
  await comment.fill('柔和光影');await t.page.getByRole('button',{name:'完成',exact:true}).click();
  const placed=await t.page.evaluate(()=>structuredClone(annotations.active.value.snapshot.regions));
  assert.equal(placed.length,1);assert.equal(placed[0].shape,'point');assert.equal(placed[0].bbox.w,0);assert.equal(placed[0].bbox.h,0);
  assert.ok(Math.abs(placed[0].bbox.x-160/image.width)<.002);assert.ok(Math.abs(placed[0].bbox.y-160/image.height)<.002);
  assert.equal(await t.page.locator('[data-region] .annotation-shape').count(),0);assert.equal(await t.page.locator('.annotation-svg [data-corner]').count(),0);
  // Layout can refit after comments/toolbars appear. Each gesture uses its current image size.
  await t.page.setViewportSize({width:1200,height:800});
  const point=t.page.locator('[data-region] .annotation-number rect');await point.click({trial:true});
  assert.deepEqual(await t.page.evaluate(()=>annotations.active.value.snapshot.regions),placed);
  const dragImage=await t.page.locator('#editorStage').boundingBox(),marker=await point.boundingBox();
  await t.page.mouse.move(marker.x+marker.width/2,marker.y+marker.height/2);await t.page.mouse.down();await t.page.mouse.move(marker.x+marker.width/2+40,marker.y+marker.height/2+20,{steps:4});await t.page.mouse.up();
  const before=await t.page.evaluate(()=>structuredClone(annotations.active.value.snapshot.regions));
  assert.equal(before[0].key,placed[0].key);assert.equal(before[0].comment,'柔和光影');assert.ok(Math.abs(before[0].bbox.x-placed[0].bbox.x-40/dragImage.width)<.002);assert.ok(Math.abs(before[0].bbox.y-placed[0].bbox.y-20/dragImage.height)<.002);assert.equal(before[0].bbox.w,0);
  await t.page.locator('#editorViewport').press('h');assert.equal(await t.page.locator('.annotation-stage').getAttribute('data-tool'),'hand');
  await t.page.mouse.move(dragImage.x+300,dragImage.y+300);await t.page.mouse.down();await t.page.mouse.move(dragImage.x+340,dragImage.y+330,{steps:4});await t.page.mouse.up();
  assert.deepEqual(await t.page.evaluate(()=>annotations.active.value.snapshot.regions),before);
  await t.page.getByRole('button',{name:'编辑批注',exact:true}).click();await comment.waitFor({state:'visible'});assert.equal(await comment.inputValue(),'柔和光影');
  await comment.press('Escape');await comment.waitFor({state:'hidden'});
  await t.page.locator('#editorViewport').press('Escape');await t.page.locator('#editorViewport').press('Escape');await t.page.locator('.annotation-inline').waitFor({state:'hidden'});assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('point guide changes only its numbered marker; point and mixed annotations cannot become masks',async()=>{
 const t=await setup();try{
  const result=await t.page.evaluate(async()=>{
   const source=await makeImage(512,512),snapshot=await makeSnapshot(source),area=structuredClone(snapshot.regions[0]);
   snapshot.regions=[{key:'p',shape:'point',bbox:{x:.5,y:.5,w:0,h:0},comment:'检查这里'}];
   const {annotationPreview,annotationMask}=await import('/src/native/annotation-canvas.ts'),{composeAnnotatedResult}=await import('/src/native/inpaint-result.ts');
   const original=await readPixels(source),guide=await readPixels(await annotationPreview(source,snapshot));let marker=0,outside=0;
   for(let y=0;y<512;y++)for(let x=0;x<512;x++){const at=(y*512+x)*4;if(guide.data.slice(at,at+4).some((v,i)=>v!==original.data[at+i])){if(Math.abs(x-256)>28||y<195||y>272)outside++;else marker++;}}
   const rejected=[];for(const regions of [snapshot.regions,[...snapshot.regions,area]]){try{annotationMask({...snapshot,regions});}catch(e){rejected.push(e.message);}}
   let merge='';try{await composeAnnotatedResult(source,source,snapshot);}catch(e){merge=e.message;}
   return {marker,outside,rejected,merge};
  });
  assert.ok(result.marker>0);assert.equal(result.outside,0);assert.equal(result.rejected.length,2);assert.ok(result.rejected.every(e=>e.includes('点批注')));assert.match(result.merge,/点批注/);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT click and shape tools stay distinct; point handoff persists in CHAT without a mask action',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await editor.open('image',await makeImage(512,512),'point.png');app_shell.router.switchWorkspace('edit');});
  await t.page.getByRole('button',{name:'选择批注方式',exact:true}).click();await t.page.getByRole('menuitemradio',{name:'矩形选区',exact:true}).click();
  await t.page.waitForFunction(()=>!!annotations.active.value);
  const b=await t.page.locator('#editorStage').boundingBox();await t.page.mouse.click(b.x+b.width*.4,b.y+b.height*.4);
  assert.equal(await t.page.evaluate(()=>annotations.active.value.snapshot.regions.length),0);
  await t.page.getByRole('button',{name:'点 · C',exact:true}).click();
  await t.page.mouse.click(b.x+b.width*.4,b.y+b.height*.4);const comment=t.page.getByPlaceholder('添加批注…');await comment.waitFor({state:'visible'});await comment.fill('只标出眼睛位置');await comment.press('Enter');
  assert.equal(await t.page.locator('#editorStage [data-region] .annotation-shape').count(),0);assert.equal(await t.page.locator('#editorStage [data-region] [data-corner]').count(),0);
  const point=await t.page.evaluate(()=>structuredClone(annotations.active.value.snapshot.regions[0]));assert.equal(point.shape,'point');assert.equal(point.bbox.w,0);
  await send(t.page,'new');await t.page.waitForFunction(()=>app_shell.router.route.value.workspace==='chat'&&!!chat.snapshot().current.pendingAnnotation);
  assert.equal(t.posts.length,0);assert.deepEqual(await t.page.evaluate(()=>chat.snapshot().current.pendingAnnotation.snapshot.regions),[point]);
  await t.page.evaluate(()=>chat.execute());await t.page.waitForFunction(()=>!chat.snapshot().busy&&chat.snapshot().current.turns[0]?.versions[0]?.status==='done');
  assert.equal(t.posts.length,1);assert.equal(t.posts[0].additional_images.length,1);assert.match(t.posts[0].prompt,/位置点/);assert.equal(t.posts[0].mask_image,undefined);
  assert.equal(await t.page.getByRole('button',{name:'审核并应用蒙版',exact:true}).count(),0);
  await t.page.evaluate(()=>chat.flush());await t.page.reload();await bind(t.page);await t.page.waitForFunction(()=>chat.snapshot().ready);
  assert.deepEqual(await t.page.evaluate(()=>chat.snapshot().current.turns[0].snapshot.annotation.snapshot.regions),[point]);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT selects on its own canvas and hands off without changing inpaint',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await editor.open('image',await makeImage(512,512),'selection.png');app_shell.router.switchWorkspace('edit');});
  await t.page.getByRole('button',{name:'打开 Koma ASK',exact:true}).waitFor({state:'visible'});
  await t.page.getByRole('button',{name:'选择批注方式',exact:true}).click();await t.page.getByRole('menuitemradio',{name:'矩形选区',exact:true}).click();
  await t.page.locator('#editorStage .annotation-svg').waitFor();
  assert.equal(await t.page.locator('dialog.region-annotator').count(),0);
  const before=await t.page.evaluate(()=>({mask:editor.session.maskRevision,mode:editor.session.mode,base:editor.session.baseId,versions:editor.session.versions.length}));
  const b=await t.page.locator('#editorStage').boundingBox();
  await t.page.mouse.move(b.x+b.width*.25,b.y+b.height*.25);await t.page.mouse.down();await t.page.mouse.move(b.x+b.width*.5,b.y+b.height*.5,{steps:5});await t.page.mouse.up();
  await t.page.getByPlaceholder('添加批注…').fill('检查这个区域');await t.page.getByRole('button',{name:'完成',exact:true}).click();
  const regions=await t.page.evaluate(()=>structuredClone(annotations.active.value.snapshot.regions));assert.equal(regions.length,1);assert.ok(Math.abs(regions[0].bbox.w-.25)<.01);
  await t.page.locator('#editorViewport').press('+');
  assert.deepEqual(await t.page.evaluate(()=>annotations.active.value.snapshot.regions),regions);
  await t.page.getByRole('button',{name:'完成批注',exact:true}).click();await t.page.locator('#editorStage .annotation-svg').waitFor({state:'hidden'});
  await t.page.getByRole('button',{name:'选择批注方式',exact:true}).click();await t.page.getByRole('menuitemradio',{name:'椭圆选区',exact:true}).click();
  await t.page.locator('#editorStage .annotation-svg').waitFor();assert.deepEqual(await t.page.evaluate(()=>annotations.active.value.snapshot.regions),regions);
  await send(t.page,'ask');await t.page.waitForFunction(()=>!annotations.active.value);
  assert.deepEqual(await t.page.evaluate(()=>({mask:editor.session.maskRevision,mode:editor.session.mode,base:editor.session.baseId,versions:editor.session.versions.length})),before);
  assert.equal(await t.page.evaluate(()=>ask.tray.value.length),2);assert.equal(t.posts.length,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT send menu prepares a clean full image when no region is selected',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await editor.open('image',await makeImage(512,512),'whole.png');app_shell.router.switchWorkspace('edit');});
  // Pointer opening does not preselect an action; arrow keys can enter from either end.
  const trigger=t.page.locator('#editorSend'),menu=t.page.locator('#editorSendMenu');
  await trigger.click();await t.page.waitForFunction(()=>document.activeElement?.id==='editorSendMenu');
  await menu.press('ArrowUp');assert.equal(await t.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'CHAT 改图 · 新对话');
  await t.page.keyboard.press('Home');assert.equal(await t.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'问 ASK');
  await t.page.keyboard.press('End');assert.equal(await t.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'CHAT 改图 · 新对话');
  await t.page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await t.page.evaluate(()=>document.activeElement?.id),'editorSend');
  // Keyboard opening keeps first-item focus and normal menu navigation.
  await trigger.press('Enter');await t.page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='问 ASK');
  await t.page.keyboard.press('ArrowRight');assert.equal(await t.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'CHAT 改图 · 新对话');
  await t.page.keyboard.press('ArrowLeft');assert.equal(await t.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'问 ASK');
  await t.page.keyboard.press('Escape');
  await send(t.page,'ask');await t.page.waitForFunction(()=>ask.tray.value.length===1);
  assert.equal(await t.page.evaluate(()=>ask.entries.value.length),0);assert.equal(await t.page.locator('dialog.region-annotator').count(),0);
  await t.page.evaluate(()=>ask.hide());assert.deepEqual(await sendItems(t.page),['问 ASK','CHAT 改图 · 新对话']);await send(t.page,'new');
  await t.page.waitForFunction(()=>app_shell.router.route.value.workspace==='chat'&&chat.snapshot().context.imageIds.length===1);
  assert.equal(await t.page.evaluate(()=>chat.snapshot().current.turns.length),0);assert.equal(t.posts.length,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT switches to generic editing and compares original/raw/frozen-mask replacement in the existing canvas',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await editor.open('image',await makeImage(),'source.png');});
  await t.page.waitForFunction(()=>editor.snapshot().models.some(m=>m.id==='gpt-image-2'));
  await t.page.evaluate(async()=>{editor.setModel('gpt-image-2');editor.patch({prompt:'change eye',negative_prompt:'NAI only',steps:40,scale:8});editor.session.enhance.on=true;editor.session.focus.on=true;editor.setMode('inpaint');const c=new OffscreenCanvas(256,256),g=c.getContext('2d');g.fillStyle='white';g.fillRect(64,64,64,64);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');});
  assert.equal(await t.page.getByRole('textbox',{name:'修改说明',exact:true}).isVisible(),true);
  assert.equal(await t.page.locator('#editorStrength').count(),0);
  assert.equal(await t.page.evaluate(()=>editor.snapshot().focusing),false);
  await t.page.getByText('蒙版边缘',{exact:true}).click();
  const dilate=t.page.getByRole('spinbutton',{name:'蒙版外扩百分比',exact:true});
  await dilate.fill('1.2');await dilate.press('Enter');
  await t.page.getByRole('slider',{name:'蒙版羽化',exact:true}).press('ArrowRight');
  assert.deepEqual(await t.page.evaluate(()=>editor.session.imageEdit.edges),{dilate:.012,feather:.004});
  await dilate.fill('');await dilate.press('Tab');assert.equal(await dilate.inputValue(),'1.2');
  await t.page.waitForFunction(()=>editor.snapshot().edit.canRun);
  const before=await t.page.evaluate(()=>({base:editor.session.baseId,mask:JSON.stringify(editor.session.mask)}));
  await t.page.locator('#editorRun').click();await t.page.waitForFunction(()=>!editor.snapshot().busy&&!!editor.snapshot().viewed?.comparison);
  assert.equal(t.posts.length,1);assert.equal(t.posts[0].tool,'image-edit');assert.equal(t.posts[0].additional_images.length,1);
  for(const key of ['mask_image','negative_prompt','steps','scale','sampler','strength','noise','enhance','characters'])assert.equal(t.posts[0][key],undefined,key);
  assert.deepEqual(await t.page.evaluate(()=>({base:editor.session.baseId,mask:JSON.stringify(editor.session.mask)})),before);
  const raw=await t.page.evaluate(()=>editor.session.viewId);
  await dilate.fill('2');await dilate.press('Enter');
  assert.deepEqual(await t.page.evaluate(()=>editor.snapshot().viewed.comparison.edges),{dilate:.012,feather:.004});
  const awareness=await t.page.evaluate(()=>editor.askSnapshot().imageEditing);
  assert.equal(awareness.comparison.status,'awaiting_review');assert.equal(awareness.comparison.compatible,true);
  assert.deepEqual(awareness.comparison.frozen_edges,{dilate:.012,feather:.004});assert.equal(awareness.settings.edges.dilate,.02);
  assert.equal(awareness.comparison.source_size.width,256);assert.equal(awareness.comparison.raw_size.width,128);
  await t.page.getByRole('button',{name:'原图',exact:true}).click();
  assert.equal(await t.page.locator('#editorImage').getAttribute('src'),await t.page.evaluate(()=>editor.snapshot().base.url));
  assert.equal(await t.page.evaluate(()=>editor.session.viewId),raw);
  assert.equal(await t.page.evaluate(()=>editor.askSnapshot().imageEditing.comparison.display.mode),'source');
  await t.page.evaluate(async()=>{editor.view(editor.session.baseId);const c=new OffscreenCanvas(256,256),g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,16,16);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');});
  await t.page.evaluate(id=>editor.view(id),raw);
  assert.equal(await t.page.getByRole('button',{name:'色彩对齐',exact:true}).getAttribute('aria-pressed'),'true');
  await t.page.getByRole('button',{name:'色彩对齐',exact:true}).click();
  await t.page.getByRole('button',{name:'蒙版替换',exact:true}).click();await t.page.getByRole('button',{name:'应用蒙版',exact:true}).waitFor();
  assert.equal(await t.page.evaluate(()=>editor.session.versions.length),2);
  assert.deepEqual(await t.page.evaluate(()=>editor.askSnapshot().imageEditing.comparison.display),{mode:'composite',preview:'ready'});
  await t.page.getByRole('button',{name:'应用蒙版',exact:true}).click();await t.page.waitForFunction(()=>!!editor.snapshot().viewed?.params?.localComposite);
  assert.equal(await t.page.evaluate(()=>editor.askSnapshot().imageEditing.comparison.status),'applied');
  const result=await t.page.evaluate(async()=>{const s=editor.session,v=editor.snapshot().viewed,p=await readPixels(v.blob);return {base:s.baseId,width:v.width,raw:s.versions.find(v=>v.id===v.comparison?.rawId)?.width,count:s.versions.length,outside:Array.from(p.data.slice(0,4)),inside:Array.from(p.data.slice((90*256+90)*4,(90*256+90)*4+4))};});
  assert.equal(result.base,before.base);assert.equal(result.width,256);assert.equal(result.raw,128);assert.equal(result.count,3);assert.deepEqual(result.outside,[161,41,66,255]);assert.deepEqual(result.inside,[37,128,236,255]);
  await t.page.getByRole('button',{name:'AI 生成',exact:true}).click();assert.equal(await t.page.locator('#editorImage').getAttribute('src'),await t.page.evaluate(id=>editor.session.versions.find(v=>v.id===id).url,raw));
  assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT uses the shared plain prompt control and treats an empty instruction as incomplete input',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await editor.open('image',await makeImage(),'source.png');});
  await t.page.waitForFunction(()=>editor.snapshot().models.some(m=>m.id==='gpt-image-2'));
  await t.page.evaluate(()=>{editor.setModel('gpt-image-2');editor.patch({prompt:''});});
  assert.equal(await t.page.locator('#editorRun').isEnabled(),false);
  assert.equal(await t.page.evaluate(()=>editor.snapshot().edit.error),'');
  const text='只改 [右眼]，保持 {发型} 与 <衣领> 原样。';
  await t.page.getByRole('textbox',{name:'修改说明',exact:true}).fill(text);
  assert.equal(await t.page.locator('#editorImagePromptBox .hl-mirror .w').count(),0);
  await t.page.waitForFunction(()=>editor.snapshot().edit.canRun);
  assert.equal(await t.page.evaluate(()=>editor.session.fields.prompt),text);
  await t.page.evaluate(()=>editor.setModel('nai-diffusion-4-5-full'));
  assert.equal(await t.page.locator('#editorPrompt').inputValue(),text);
  assert.ok(await t.page.locator('#editorPromptBox .hl-mirror [data-w]').count());
  await t.page.evaluate(()=>editor.setModel('gpt-image-2'));
  assert.equal(await t.page.getByRole('textbox',{name:'修改说明',exact:true}).inputValue(),text);
  assert.equal(await t.page.locator('#editorImagePromptBox .hl-mirror .w').count(),0);
  await t.page.getByRole('textbox',{name:'修改说明',exact:true}).fill('');
  await t.page.evaluate(()=>editor.retry('edit',true));
  assert.equal(await t.page.locator('#editorRun').isEnabled(),false);
  assert.equal(await t.page.evaluate(()=>editor.snapshot().edit.error),'');
  assert.equal(t.posts.length,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT single-image sources require explicit positional fallback and point comments do not create a mask',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{await editor.open('image',await makeImage(),'point.png');});
  await t.page.waitForFunction(()=>editor.snapshot().models.some(m=>m.id==='gemini-3.1-flash-lite-image'));
  await t.page.evaluate(async()=>{editor.setModel('gemini-3.1-flash-lite-image');const v=editor.snapshot().base;await annotations.open({blob:v.blob,name:v.name,recordId:v.recordId,workspace:'edit',inline:true,edit:{boardId:editor.session.id,versionId:v.id}});annotations.update([{key:'p',shape:'point',bbox:{x:.5,y:.5,w:0,h:0},comment:'change expression'}]);annotations.close();editor.patch({prompt:'change expression'});});
  await t.page.waitForFunction(()=>editor.snapshot().edit.error.includes('仅支持单图'));
  await t.page.evaluate(()=>editor.run());assert.equal(t.posts.length,0);
  await t.page.getByText('仅方位文字',{exact:true}).click();await t.page.waitForFunction(()=>editor.snapshot().edit.canRun);
  await t.page.locator('#editorRun').click();await t.page.waitForFunction(()=>!editor.snapshot().busy&&!!editor.snapshot().viewed?.comparison);
  assert.equal(t.posts.length,1);assert.equal(t.posts[0].additional_images.length,0);assert.match(t.posts[0].prompt,/位置点/);
  assert.equal(await t.page.getByRole('button',{name:'蒙版替换',exact:true}).isEnabled(),false);assert.deepEqual(t.errors,[]);
  await t.page.evaluate(()=>editor.setModel('gpt-image-2'));await t.page.waitForFunction(()=>editor.snapshot().edit.canRun);
  await t.page.locator('#editorRun').click();await t.page.waitForFunction(()=>!editor.snapshot().busy&&editor.session.versions.length===3);
  assert.equal(t.posts.length,2);assert.equal(t.posts[1].additional_images.length,1);
 }finally{await t.context.close();}
});

test('EDIT rejects incompatible aspect ratios while retaining raw output and original mask',async()=>{
 const t=await setup([256,128]);try{
  await t.page.evaluate(async()=>{await editor.open('image',await makeImage(),'source.png');});
  await t.page.waitForFunction(()=>editor.snapshot().models.some(m=>m.id==='gpt-image-2'));
  await t.page.evaluate(async()=>{editor.setModel('gpt-image-2');editor.patch({prompt:'change color'});editor.setMode('inpaint');const c=new OffscreenCanvas(256,256),g=c.getContext('2d');g.fillStyle='white';g.fillRect(64,64,64,64);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');});
  await t.page.waitForFunction(()=>editor.snapshot().edit.canRun);await t.page.locator('#editorRun').click();await t.page.waitForFunction(()=>!editor.snapshot().busy&&!!editor.snapshot().viewed?.comparison);
  assert.equal(await t.page.getByRole('button',{name:'蒙版替换',exact:true}).isEnabled(),false);
  assert.equal(await t.page.evaluate(()=>editor.askSnapshot().imageEditing.comparison.status),'incompatible');
  const result=await t.page.evaluate(async()=>{try{await editor.applyComparison(editor.session.id,editor.session.viewId);return 'unexpected';}catch(e){return e.message;}});assert.match(result,/宽高比/);
  assert.equal(await t.page.evaluate(()=>editor.session.versions.length),2);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT submits an open comment once, re-estimates it, and keeps the result on its originating board',async()=>{
 const t=await setup(),gate=Promise.withResolvers(),started=Promise.withResolvers();let estimates=0;
 try{
  await t.context.route('**/estimate',async route=>{estimates++;await route.fallback();});
  await t.context.route('**/image/tools/run',async route=>{started.resolve();await gate.promise;await route.fallback();});
  const board=await t.page.evaluate(async()=>{await editor.open('image',await makeImage(512,512),'comments.png');return editor.session.id;});
  await t.page.waitForFunction(()=>editor.snapshot().models.some(m=>m.id==='gpt-image-2'));
  await t.page.evaluate(()=>{editor.setModel('gpt-image-2');editor.patch({prompt:'keep the layout'});});
  await t.page.getByRole('button',{name:'选择批注方式',exact:true}).click();await t.page.getByRole('menuitemradio',{name:'矩形选区',exact:true}).click();
  await t.page.waitForFunction(()=>!!annotations.active.value);
  const box=await t.page.locator('#editorStage').boundingBox();
  await t.page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await t.page.mouse.down();await t.page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:4});await t.page.mouse.up();
  await t.page.getByPlaceholder('添加批注…').fill('only soften this eye');
  await t.page.waitForFunction(()=>editor.snapshot().edit.canRun);const before=estimates;
  await t.page.locator('#editorRun').click();await started.promise;
  const other=await t.page.evaluate(()=>editor.createBoard());assert.notEqual(other,board);
  gate.resolve();await t.page.waitForFunction(()=>!editor.snapshot().runningBoardId);
  assert.equal(t.posts.length,1);assert.match(t.posts[0].prompt,/only soften this eye/);assert.ok(estimates>before);
  assert.equal(await t.page.evaluate(()=>editor.session.id),other);assert.equal(await t.page.evaluate(()=>editor.session.versions.length),0);
  await t.page.evaluate(id=>editor.switchBoard(id),board);
  assert.equal(await t.page.evaluate(()=>editor.session.versions.length),2);assert.equal(await t.page.evaluate(()=>!!editor.snapshot().viewed.comparison.mask),true);
  assert.deepEqual(t.errors,[]);
 }finally{gate.resolve();await t.context.close();}
});


test('EDIT annotation upload links its reference and the input area only lists it without changing the base',async()=>{
 const t=await setup();try {
  const base=await t.page.evaluate(async()=>{await editor.open('image',await makeImage(256,256),'base.png');editor.setModel('gpt-image-2');editor.patch({prompt:'replace badge'});return editor.session.baseId;});
  const bytes=await t.page.evaluate(async()=>[...new Uint8Array(await (await makeImage(128,96,'#22bbaa')).arrayBuffer())]);
  await t.page.evaluate(async()=>{const v=editor.snapshot().viewed;await annotations.open({blob:v.blob,name:v.name,recordId:v.recordId,workspace:'edit',inline:true,edit:{boardId:editor.session.id,versionId:v.id}});});
  const bounds=await t.page.locator('#editorStage').boundingBox();await t.page.mouse.click(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);
  await t.page.getByPlaceholder('添加批注…').fill('替换徽章');
  await t.page.getByRole('button',{name:'批注参考图',exact:true}).click();
  const choose=t.page.waitForEvent('filechooser');await t.page.getByRole('menuitem',{name:'上传参考图',exact:false}).click();
  await (await choose).setFiles({name:'badge.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await t.page.getByRole('button',{name:'查看参考图 R1',exact:true}).waitFor();
  assert.equal(await t.page.evaluate(()=>editor.session.baseId),base);
  assert.equal(await t.page.getByRole('menuitemcheckbox',{name:'批注参考 R1'}).getAttribute('aria-checked'),'true');
  await t.page.getByRole('menuitemcheckbox',{name:'批注参考 R1'}).press('Escape');
  assert.equal(await t.page.getByRole('menu',{name:'批注参考图'}).count(),0);
  assert.match(await t.page.getByRole('button',{name:'批注参考图',exact:true}).getAttribute('title'),/已关联 R1/);
  assert.equal(await t.page.getByPlaceholder('添加批注…').inputValue(),'替换徽章');
  await t.page.getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(await t.page.locator('#editorImagePromptBox input[type=file]').count(),0);
  assert.equal(await t.page.getByRole('button',{name:'添加参考图',exact:true}).count(),0);
  await t.page.getByRole('button',{name:'查看参考图 R1',exact:true}).click();await t.page.getByLabel('参考图用途').fill('只参考徽章');await t.page.getByLabel('参考图用途').press('Tab');await t.page.getByRole('button',{name:'关闭参考图'}).click();
  assert.equal(await t.page.evaluate(()=>editor.session.references[0].usage),'只参考徽章');
  const frozen=await t.page.evaluate(()=>({ref:editor.session.references[0].id,regions:annotations.active.value.snapshot.regions}));assert.deepEqual(frozen.regions[0].referenceIds,[frozen.ref]);
  await t.page.evaluate(()=>editor.run());
  assert.equal(t.posts.length,1);assert.equal(t.posts[0].additional_images.length,2);assert.match(t.posts[0].prompt,/R1 = 第 3 张图：只参考徽章/);assert.match(t.posts[0].prompt,/批注 1 参考：R1/);
  const recorded=await t.page.evaluate(()=>{const v=editor.snapshot().viewed;editor.setReferences([]);return {input:v.params.evolutionInput,config:v.configuration.references,kept:!!editor.record(v.configuration.references[0].id)};});
  assert.equal(recorded.input.references[0].id,frozen.ref);assert.equal(recorded.kept,true);assert.equal(recorded.config[0].usage,'只参考徽章');assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT annotations accept dropped and pasted references while the input area remains a reference list',async()=>{
 const t=await setup([128,128],4);try {
  const base=await t.page.evaluate(async()=>{await editor.open('image',await makeImage(256,256),'base.png');editor.setModel('gpt-image-2');editor.patch({prompt:'keep this instruction'});return editor.session.baseId;});
  await t.page.evaluate(async()=>{const v=editor.snapshot().viewed;await annotations.open({blob:v.blob,name:v.name,recordId:v.recordId,workspace:'edit',inline:true,edit:{boardId:editor.session.id,versionId:v.id}});});
  const bounds=await t.page.locator('#editorStage').boundingBox();await t.page.mouse.click(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);
  await t.page.getByPlaceholder('添加批注…').fill('替换领口');
  await t.page.evaluate(async()=>{
   const data=new DataTransfer();data.items.add(new File([await makeImage(80,90,'#22bbaa')],'drop.png',{type:'image/png'}));
   const root=document.querySelector('#imageEditor'),prompt=document.querySelector('.annotation-comment textarea');
   root.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:data}));
   prompt.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:data}));
   prompt.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));
   prompt.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
  });
  await t.page.getByRole('button',{name:'查看参考图 R1',exact:true}).waitFor();
  await t.page.evaluate(async()=>{
   const data=new DataTransfer();data.items.add(new File([await makeImage(90,80,'#aa2244')],'paste.png',{type:'image/png'}));
   document.querySelector('.annotation-comment textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  await t.page.getByRole('button',{name:'查看参考图 R2',exact:true}).waitFor();
  assert.equal(await t.page.evaluate(()=>annotations.active.value.snapshot.regions[0].referenceIds.length),2);
  await t.page.evaluate(async()=>{
   const data=new DataTransfer();data.items.add(new File([await makeImage(20,20)],'wrong-area.png',{type:'image/png'}));
   document.querySelector('#editorImagePrompt').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  await t.page.getByRole('button',{name:'查看参考图 R2',exact:true}).press('Alt+ArrowLeft');
  const result=await t.page.evaluate(()=>({base:editor.session.baseId,boards:editor.boards().length,prompt:editor.session.fields.prompt,labels:editor.session.references.map(r=>r.label)}));
  assert.deepEqual(result,{base,boards:1,prompt:'keep this instruction',labels:['R2','R1']});assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('annotation reference decoding rejects a removed target without keeping an orphan upload',async()=>{
 const t=await setup();try{
  await t.page.evaluate(async()=>{
   await editor.open('image',await makeImage(256,256),'base.png');editor.setModel('gpt-image-2');
   const v=editor.snapshot().viewed;await annotations.open({blob:v.blob,name:v.name,recordId:v.recordId,workspace:'edit',inline:true,edit:{boardId:editor.session.id,versionId:v.id}});
   annotations.update([{key:'upload-target',shape:'point',bbox:{x:.5,y:.5,w:0,h:0},comment:'upload here'}]);
  });
  await t.page.getByRole('button',{name:'批注 1：upload here',exact:true}).press('Enter');
  await t.page.evaluate(async()=>{
   const data=new DataTransfer();data.items.add(new File([await makeImage(80,90)],'stale.png',{type:'image/png'}));
   document.querySelector('.annotation-comment textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
   annotations.update([]);
  });
  await t.page.getByText('上传目标已变化，请重新上传',{exact:true}).waitFor();
  assert.equal(await t.page.evaluate(()=>editor.session.references.length),0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('reference transport switches between guide/native without changing labels; CHAT/ASK freeze associations',async()=>{
 const t=await setup();try {
  const result=await t.page.evaluate(async()=>{
   const {prepareEditorImageEdit,imageEditSettings}=await import('/src/services/editor-image-edit.ts');
   const {validateConversation}=await import('/src/storage/backup-schema.ts');
   const {contextSnapshot}=await import('/src/domain/conversation.ts');
   const {serializeAnnotations}=await import('/src/domain/region-annotation.ts');
   await editor.open('image',await makeImage(),'base.png');editor.setModel('gpt-image-2');
   await editor.addReferences([new File([await makeImage(80,90,'#1122aa')],'first.png',{type:'image/png'}),new File([await makeImage(80,90,'#ddaa22')],'second.png',{type:'image/png'})]);
   editor.setReferences([...editor.session.references].reverse());const refs=editor.referenceImages(),v=editor.snapshot().viewed,snapshot=await makeSnapshot(v.blob);snapshot.image.record_id=v.recordId;snapshot.references=refs.map(({blob,...r})=>r);snapshot.regions[0].referenceIds=[refs[1].id];
   const m={...editor.snapshot().model,maxImages:4,markupEligible:true},settings=imageEditSettings();
   const dual=await prepareEditorImageEdit(v,m,'badge',{},settings,undefined,snapshot,refs),native=await prepareEditorImageEdit(v,m,'badge',{}, {...settings,markup:true},undefined,snapshot,refs);
   let overflow='';try {await prepareEditorImageEdit(v,{...m,maxImages:2},'badge',{},settings,undefined,snapshot,refs);}catch(e){overflow=e.message;}
   const {annotationPreview}=await import('/src/native/annotation-canvas.ts');await chat.prepareAnnotations(v.blob,await annotationPreview(v.blob,snapshot),snapshot,undefined,refs);const c=chat.snapshot().current,dualContext=contextSnapshot(c,'modify',4);validateConversation(c);
   const saved=JSON.parse(JSON.stringify(c));validateConversation(saved);c.pendingAnnotation.markup={inputAssetId:c.pendingAnnotation.inputAssetId,overlayAssetId:c.pendingAnnotation.guideAssetId};const nativeContext=contextSnapshot(c,'modify',3);delete c.pendingAnnotation.markup;
   let askLimit='';try{await ask.prepareAnnotations(v.blob,v.blob,snapshot,[...refs,{...refs[0],id:'third',label:'R9'}]);}catch(e){askLimit=e.message;}
   await ask.prepareAnnotations(v.blob,v.blob,snapshot,refs);
   const source=ask.annotationSource(ask.tray.value[0].id);const xml=serializeAnnotations(source.snapshot,ask.tray.value[0].id,ask.tray.value[1].id);
   return {labels:refs.map(r=>r.label),dual:dual.request,native:native.request,overflow,dualContext,nativeContext,askLimit,xml,count:ask.tray.value.length,saved};
  });
  assert.deepEqual(result.labels,['R2','R1']);assert.equal(result.dual.additional_images.length,3);assert.equal(result.native.additional_images.length,2);assert.ok(result.native.markup_image);
  assert.match(result.dual.prompt,/R2 = 第 3 张图/);assert.match(result.native.prompt,/R2 = 第 2 张图/);assert.match(result.native.prompt,/批注 1 参考：R1/);assert.ok(result.overflow);
  assert.match(result.dualContext.text,/R1 = 第 4 张图/);assert.match(result.nativeContext.text,/R1 = 第 3 张图/);
  assert.match(result.askLimit,/4 张/);assert.equal(result.count,4);assert.match(result.xml,/R1 \(#a4\)/);
  await t.page.evaluate(()=>app_shell.router.switchWorkspace('chat'));await t.page.reload();await bind(t.page);await t.page.waitForFunction(()=>chat.snapshot().ready);assert.equal(await t.page.evaluate(()=>chat.snapshot().current.pendingAnnotation.referenceAssets.length),2);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT reference draft apply/undo/redo owns originals and rejects changed configuration',async()=>{
 const t=await setup();try {
  const result=await t.page.evaluate(async()=>{
   const {parseDraft,validateDraft,stateHash}=await import('/src/ask/draft/validate.ts');
   const {createDraftWriter}=await import('/src/ask/draft/apply.ts');const {createDraftStack}=await import('/src/ask/draft/stack.ts');
   const {editPictures}=await import('/src/ask/edit-context.ts');
   await editor.open('image',await makeImage(),'base.png');editor.setModel('gpt-image-2');editor.patch({prompt:'badge'});
   await editor.addReferences([new File([await makeImage(60,60,'#11aa11')],'badge.png',{type:'image/png'})]);
   const d=drawing.snapshot(),base={workspace:'edit',form:d.form,models:d.models,samplers:d.samplers,composer:'',conversationId:chat.snapshot().current.id,edit:editor.askSnapshot()},refs=editPictures(editor,{label:()=>null});
   const draft=parseDraft({base_hash:stateHash(base),draft_title:'移除参考',steps:[{kind:'edit_references',references:[]}]},base,refs),plan=validateDraft(draft,base,{off:new Set()});
   const writer=createDraftWriter(drawing,chat,app_shell.router,undefined,undefined,editor),stack=createDraftStack(writer),item=stack.create(draft,'test',1),id=editor.session.references[0].id;
   await stack.apply(item,plan);editor.retainRecords(writer.retainedRecords());const removed=editor.session.references.length,retained=!!editor.record(id);
   await stack.undo(item.id);const undone=editor.session.references.map(r=>r.id);await stack.restore(item.id);const redone=editor.session.references.length;
   editor.patch({prompt:'changed'});const conflict=writer.conflict(plan,'after');return {removed,retained,undone,redone,id,conflict};
  });assert.equal(result.removed,0);assert.equal(result.retained,true);assert.deepEqual(result.undone,[result.id]);assert.equal(result.redone,0);assert.match(result.conflict,/配置已变化/);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('ASK multi-image EDIT handoff imports scoped originals, keeps the base separate and supports board undo/redo',async()=>{
 const t=await setup();try {
  const result=await t.page.evaluate(async()=>{
   const {parseDraft,stateHash,validateDraft}=await import('/src/ask/draft/validate.ts');
   const {createDraftWriter}=await import('/src/ask/draft/apply.ts');const {createDraftStack}=await import('/src/ask/draft/stack.ts');
   const {createAttachments,prepareAttachment,attachmentPictures}=await import('/src/ask/attachments.ts');const {createHandoffImages}=await import('/src/ask/handoff-images.ts');
   await editor.open('image',await makeImage(),'existing.png');editor.setModel('gpt-image-2');
   const pool=createAttachments(),images=createHandoffImages(scope=>scope==='test-scope'?pool:undefined),records=[];
   for(const [name,color]of [['base','#bbaa44'],['reference','#44aabb']])records.push(pool.add(await prepareAttachment(new File([await makeImage(300,400,color)],name+'.png',{type:'image/png'}))));
   const d=drawing.snapshot(),base={workspace:'image',form:d.form,models:editor.snapshot().models,samplers:d.samplers,composer:'',conversationId:chat.snapshot().current.id,edit:editor.askSnapshot(),editBoards:editor.boards().map(b=>editor.askSnapshot(b.id))};
   const library=attachmentPictures(pool.read(records.map(r=>r.id)),'test-scope');
   const draft=parseDraft({base_hash:stateHash(base),draft_title:'徽章参考改图',steps:[{kind:'edit_handoff',image:'#a1',params:{model:'gpt-image-2'},prompt:'参考徽章',references:[{image:'#a2',usage:'只参考徽章'}]}]},base,library);
   const plan=validateDraft(draft,base,{off:new Set(),has:i=>!!images.get(i.ref)});
   if(plan.steps.some(r=>r.issue))throw new Error(JSON.stringify(plan.steps));
   const writer=createDraftWriter(drawing,chat,app_shell.router,undefined,undefined,editor,undefined,images),stack=createDraftStack(writer),item=stack.create(draft,'test',1);
   await stack.apply(item,plan);editor.retainRecords(writer.retainedRecords());
   const target=editor.board(plan.edit.id),reference=target.references[0],original=records[1].blob;
   const applied={count:target.versions.length,baseBytes:[...new Uint8Array(await target.versions[0].blob.arrayBuffer())].join(),refBytes:[...new Uint8Array(await editor.record(reference.id).blob.arrayBuffer())].join(),label:reference.label,usage:reference.usage};
   pool.release(records.map(r=>r.id));await stack.undo(item.id);const removed=!editor.board(plan.edit.id);await stack.restore(item.id);
   return {applied,expectedBase:[...new Uint8Array(await records[0].blob.arrayBuffer())].join(),expectedRef:[...new Uint8Array(await original.arrayBuffer())].join(),removed,restored:editor.board(plan.edit.id).references[0].id===reference.id};
  });
  assert.equal(result.applied.count,1);assert.equal(result.applied.baseBytes,result.expectedBase);assert.equal(result.applied.refBytes,result.expectedRef);assert.equal(result.applied.label,'R1');assert.equal(result.applied.usage,'只参考徽章');assert.equal(result.removed,true);assert.equal(result.restored,true);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('ASK annotation return restores reference bytes and region associations after the original EDIT board closes',async()=>{
 const t=await setup();try{
  const before=await t.page.evaluate(async()=>{
   await editor.open('image',await makeImage(),'return-source.png');editor.setModel('gpt-image-2');
   await editor.addReferences([new File([await makeImage(120,90,'#13aacc')],'badge.png',{type:'image/png'})]);
   const v=editor.snapshot().viewed,ref=editor.session.references[0];editor.setReferences([{...ref,usage:'只参考徽章'}]);
   await annotations.open({blob:v.blob,name:v.name,recordId:v.recordId,workspace:'edit',inline:true,edit:{boardId:editor.session.id,versionId:v.id}});
   annotations.update([{key:'badge-region',shape:'rect',bbox:{x:.2,y:.2,w:.3,h:.3},comment:'替换徽章',referenceIds:[ref.id]}]);
   const bytes=[...new Uint8Array(await editor.referenceImages()[0].blob.arrayBuffer())].join();await annotations.act('ask');
   if(!editor.removeBoard(editor.session.id))throw new Error('cannot close board');return {bytes,oldRef:ref.id};
  });
  await t.page.getByRole('button',{name:'展开或收起批注列表'}).click();await t.page.getByRole('button',{name:'回到 EDIT',exact:true}).click();
  await t.page.waitForFunction(()=>!!annotations.active.value);
  const restored=await t.page.evaluate(async()=>{
   const a=annotations.active.value.snapshot,r=editor.referenceImages()[0];return {ref:r.id,usage:r.usage,links:a.regions[0].referenceIds,comment:a.regions[0].comment,bytes:[...new Uint8Array(await r.blob.arrayBuffer())].join()};
  });
  assert.notEqual(restored.ref,before.oldRef);assert.equal(restored.bytes,before.bytes);assert.deepEqual(restored.links,[restored.ref]);assert.equal(restored.usage,'只参考徽章');assert.equal(restored.comment,'替换徽章');assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('EDIT clean image handoff includes references for ASK and CHAT without replacing another conversation draft',async()=>{
 const t=await setup();try{
  const ids=await t.page.evaluate(async()=>{
   const source=chat.snapshot().current.id;chat.setPrompt('来源草稿');chat.addConversation();chat.setPrompt('其他草稿');const other=chat.snapshot().current.id;
   await editor.open('image',await makeImage(),'clean-source.png');editor.setModel('gpt-image-2');editor.patch({prompt:'参考 R1 的徽章'});
   await editor.addReferences([new File([await makeImage(120,90,'#11cc44')],'badge.png',{type:'image/png'})]);
   const ref=editor.session.references[0];editor.setReferences([{...ref,usage:'只参考徽章'}]);return {source,other};
  });
  await send(t.page,'ask');await t.page.waitForFunction(()=>ask.tray.value.length===2);await t.page.evaluate(()=>ask.hide());
  const result=await t.page.evaluate(async({source,other})=>{
   const v=editor.snapshot().viewed;await chat.prepareEditorImages(v,editor.referenceImages(),editor.session.fields.prompt,source);
   const c=chat.snapshot().current,{contextSnapshot}=await import('/src/domain/conversation.ts');const snapshot=contextSnapshot(c);
   const all=chat.snapshot().conversations;return {id:c.id,text:c.prompt,images:snapshot.imageIds.length,other:all.find(c=>c.id===other).prompt,turns:c.turns.length};
  },ids);
  assert.equal(result.id,ids.source);assert.equal(result.images,2);assert.match(result.text,/来源草稿/);assert.match(result.text,/R1 = 第 2 张图：只参考徽章/);assert.equal(result.other,'其他草稿');assert.equal(result.turns,0);assert.equal(t.posts.length,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});

test('reference upload rejects a board or model change during decoding without partial writes',async()=>{
 const t=await setup();try{
  const result=await t.page.evaluate(async()=>{
   await editor.open('image',await makeImage(),'race-source.png');editor.setModel('gpt-image-2');const board=editor.session.id;
   const file=new File([await makeImage(80,90,'#44aaff')],'reference.png',{type:'image/png'});
   const first=editor.addReferences([file]).then(()=>'',e=>e.message);editor.createBoard();const switched=await first;
   const counts=[editor.board(board).references.length,editor.session.references.length];editor.switchBoard(board);
   const second=editor.addReferences([file]).then(()=>'',e=>e.message);editor.setModel('nai-diffusion-4-5-full');const downgraded=await second;
   return {switched,downgraded,counts,final:editor.session.references.length};
  });
  assert.match(result.switched,/画板.*变化/);assert.match(result.downgraded,/模型.*变化/);assert.deepEqual(result.counts,[0,0]);assert.equal(result.final,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});
