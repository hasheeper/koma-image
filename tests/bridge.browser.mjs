import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from './helpers/vite.mjs';
import { chromium } from 'playwright';
let server,browser,origin;
before(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
const draft=(id,steps,extra={})=>({schema:'koma.bridge.draft.v1',draft_id:id,draft_title:`外部建议 ${id}`,source_label:'测试助手',steps,...extra});
const patch=text=>({kind:'prompt_patch',target:'image.prompt',mode:'append',text});
const params=value=>({kind:'params_patch',params:value});
async function poll(page, predicate, arg) {
  const until=Date.now()+12000;
  while(Date.now()<until){if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(60);}
  throw new Error('Timed out polling async state');
}
async function bind(page){await page.waitForSelector('#prompt');await page.evaluate(async()=>{
  const p=document.body.__vue_app__._instance.provides;
  for(const name of ['ask','drawing','chat','bridge','slate']) window[name]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===name)];
  const root=document.body.__vue_app__._context.provides;window.services=root[Object.getOwnPropertySymbols(root).find(k=>k.description==='application-services')];
  await bridge.restored;
});}
async function setup({llm=false,directory=true,protocol="openai-chat-v1",respond}={}){
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}), errors=[],requests=[];
  let release,seen;
  const blocked=new Promise(r=>release=r),started=new Promise(r=>seen=r);
  await context.addInitScript(({llm,directory,protocol})=>{
    if(!localStorage.getItem('koma.routing.v1')) {
      localStorage.setItem('koma.routing.v1',JSON.stringify({version:1,links:{},connections:{image:{id:'image',name:'模拟图像',baseUrl:'https://bridge-image.example.test',profileId:'koma-standard-v1',credentialRef:'image-key',revision:'r1'},...(llm?{text:{id:'text',name:'模拟文本',baseUrl:'https://bridge-text.example.test/v1',profileId:protocol,credentialRef:'text-key',revision:'r1'}}:{})}}));
      sessionStorage.setItem('koma.session.keys',JSON.stringify({'image-key':'synthetic',...(llm?{'text-key':'synthetic'}:{})}));
      localStorage.setItem('koma.prefs.v1',JSON.stringify({tagSuggest:false}));
      if(llm)localStorage.setItem('koma.ask.v1',JSON.stringify({version:1,connectionId:'text',model:'test-model',models:{text:['test-model']},images:false}));
    }
    window.permission=sessionStorage.getItem('bridge-test-permission')??'granted';window.permissionRequests=0;
    // Real browser OPFS handles/writes/structured cloning, scripted chooser and permission outcomes.
    FileSystemHandle.prototype.queryPermission=async()=>window.permission;
    FileSystemHandle.prototype.requestPermission=async()=>{window.permissionRequests++;return window.permission;};
    window.showDirectoryPicker=async()=>{const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('bridge-test',{create:true});};
    window.directoryFile=async(path,text)=>{let dir=await window.showDirectoryPicker();const parts=path.split('/'),name=parts.pop();for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const f=await dir.getFileHandle(name,{create:text!==undefined});if(text!==undefined){const w=await f.createWritable();await w.write(text);await w.close();}else return(await f.getFile()).text();};
    if(!directory)window.showDirectoryPicker=undefined;
    const convert=OffscreenCanvas.prototype.convertToBlob;window.encodes=0;
    OffscreenCanvas.prototype.convertToBlob=function(...args){if(args[0]?.type==='image/webp')window.encodes++;return convert.apply(this,args);};
  },{llm,directory,protocol});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin===origin)return route.continue();
    requests.push(url.pathname);
    if(url.hostname==='bridge-image.example.test') {
      if(url.pathname.endsWith('/image/models'))return route.fulfill({json:{studio_features:{version:2,max_cost:true},valid_samplers:['k_euler_ancestral','k_euler'],models:{'nai-diffusion-5-full':{name:'NAI V5',provider:'novelai',max_resolution:2200000,quota_group:'novelai'},'nai-diffusion-4-5-full':{name:'NAI 4.5',provider:'novelai',max_resolution:1048576,quota_group:'novelai'}}}});
      if(url.pathname.endsWith('/token_stats_data'))return route.fulfill({json:{}});
      if(url.pathname.endsWith('/media/quota'))return route.fulfill({json:{credits:{remaining:100},images:{novelai:{used:0,remaining:100,limit:100}}}});
      if(url.pathname.includes('cost')||url.pathname.endsWith('/image/estimate'))return route.fulfill({json:{cost:1}});
    }
    if(url.hostname==='bridge-text.example.test') {
      if(url.pathname.endsWith('/models'))return route.fulfill({json:{data:[{id:'test-model'}]}});
      if(respond && (url.pathname.endsWith('/chat/completions') || url.pathname.endsWith('/messages')))return route.fulfill({contentType:'text/event-stream',body:await respond(route.request().postDataJSON())});
      if(url.pathname.endsWith('/chat/completions')){seen();await blocked;return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{index:0,delta:{content:'已整理'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});}
    }
    errors.push(`Unexpected upstream ${url}`);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await page.goto(origin+'/#/image');await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length>0);await page.waitForTimeout(900);requests.length=0;
  return {page,context,errors,requests,release,started};
}
const receive=(page,value)=>page.evaluate(value=>bridge.importFile(new File([JSON.stringify(value)],'draft.inbox.json',{type:'application/json'})),value);
const apply=page=>page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
const waitReceipt=(page,id,status)=>poll(page,async({id,status})=>{try{const r=JSON.parse(await directoryFile('state.live.json')).last_inbox_receipt;return r?.draft_id===id&&r.status===status}catch{return false}},{id,status});

test('P2 project switches do not adopt local tasks; captured pending creates cannot land in the next directory',async()=>{
  const {page,context,errors}=await setup();
  try {
    const old=await createSlate(page,'本机旧任务');await page.evaluate(()=>bridge.mount());
    assert.equal(await page.evaluate(()=>bridge.slateMappings.value.length),0);
    const a=await createSlate(page,'A 的任务');
    await receive(page,draft('waiting-a',[createSlateStep('延迟确认 A')]));
    await page.evaluate(async()=>{window.showDirectoryPicker=async()=>{const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('project-b',{create:true});};await bridge.mount();});
    assert.equal(await page.evaluate(()=>bridge.slateMappings.value.length),0);
    assert.match(await page.evaluate(()=>ask.draftPlan.value.steps.map(s=>s.issue).join(' ')),/目录/);
    await apply(page);assert.equal(await page.evaluate(()=>slate.list.value.length),2);await page.evaluate(()=>ask.ignoreDraft());
    const b=await createSlate(page,'B 的任务');assert.notEqual(a.id,b.id);
    assert.equal(await page.evaluate(id=>bridge.slateMappings.value.some(m=>m.id===id),a.id),false);
    assert.equal(await page.evaluate(id=>bridge.slateMappings.value.some(m=>m.id===id),old.id),false);
    await page.evaluate(id=>bridge.mapSlate(id),old.id);
    assert.equal(JSON.parse(await page.evaluate(id=>directoryFile(`slates/${id}.slate.json`),old.id)).slate.title,'本机旧任务');
    await page.evaluate(async()=>{window.showDirectoryPicker=async()=>{const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('bridge-test',{create:true});};await bridge.mount();});
    assert.deepEqual(await page.evaluate(()=>bridge.slateMappings.value.map(m=>m.id)),[a.id]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('P5 project panel reads roles and long lore, applies one outfit once, groups delivered files, and prepares ASK references',async()=>{
  const {page,context,errors,requests}=await setup();
  try {
    await page.evaluate(async()=>{
      await directoryFile('project.json',JSON.stringify({title:'合成企划',description:'角色与场景资料'}));
      await directoryFile('characters/hero/char.json',JSON.stringify({name:'守卫',brief:'银发，夜间巡逻',tags:{prompt:'silver hair',negative:'bad hands',outfits:[{id:'uniform',label:'制服',prompt:'red cape'},{id:'casual',label:'便服',prompt:'white shirt'}]}}));
      await directoryFile('characters/hero/profile.md','# 原始人设\n\n<hero>\n  **银发守卫**\n</hero>');
      await directoryFile('lore/world.md','WORLD '.repeat(3000)+'END_OF_FILE');
      await directoryFile('lore/plans/scene.md','# 原文场景\n\n保留缩进与标记');
      const c=new OffscreenCanvas(120,180);c.getContext('2d').fillRect(0,0,120,180);const image=await c.convertToBlob({type:'image/png'});
      await directoryFile('characters/hero/portrait.png',image);await directoryFile('characters/hero/refs/detail.png',image);await directoryFile('assets/result.png',image);await directoryFile('assets/result.png.json','{}');await directoryFile('assets/result.png.txt','silver hair');
      await directoryFile('references/scenes/scene.png',image);await directoryFile('references/references.json',JSON.stringify({items:[{file:'scenes/scene.png',title:'scene',description:'**冷暖光参考**\n保留原始说明'}]}));await directoryFile('refs/lighting.md','# 光影备忘\n原始内容');await bridge.mount();bridge.openProject();
    });
    const panel=page.getByRole('dialog',{name:'企划集'});await panel.waitFor();
    await panel.getByRole('group',{name:'角色服装',exact:true}).getByText('制服',{exact:true}).click();
    assert.match(await panel.locator('.tag-well').textContent(),/silver hair, red cape/);assert.doesNotMatch(await panel.locator('.tag-well').textContent(),/white shirt/);
    await panel.getByRole('group',{name:'角色资料',exact:true}).getByText('人设',{exact:true}).click();
    assert.equal(await panel.getByRole('region',{name:'人设原文',exact:true}).textContent(),'# 原始人设\n\n<hero>\n  **银发守卫**\n</hero>');
    assert.equal(await panel.getByRole('group',{name:'角色服装',exact:true}).count(),0);
    await panel.getByRole('group',{name:'角色资料',exact:true}).getByText('TAG',{exact:true}).click();
    await panel.getByRole('button',{name:'查看detail',exact:true}).click();
    await panel.getByRole('button',{name:'查看当前图片大图',exact:true}).click();
    const viewer=page.getByRole('dialog',{name:'角色大图',exact:true});await viewer.waitFor();
    assert.match(await viewer.textContent(),/detail/);
    await viewer.getByRole('button',{name:'关闭大图',exact:true}).click();
    await panel.getByRole('button',{name:'查看主立绘',exact:true}).click();
    await page.evaluate(async()=>{await directoryFile('project.json',JSON.stringify({title:'合成企划',description:'已更新场景资料'}));await bridge.refreshProject();});
    assert.equal(await panel.getByRole('group',{name:'角色服装',exact:true}).getByRole('radio',{name:'制服',exact:true}).isChecked(),true,'unrelated metadata refresh preserves selected outfit');
    await panel.getByRole('button',{name:'填入角色栏',exact:true}).click();await page.getByRole('menuitem',{name:'新增角色槽',exact:true}).click();
    await page.waitForFunction(()=>drawing.snapshot().form.characters.length===1);
    assert.deepEqual(await page.evaluate(()=>{const c=drawing.snapshot().form.characters[0];return[c.id,c.prompt,c.negative]}),['c1','silver hair, red cape','bad hands']);
    await page.evaluate(async()=>{await directoryFile('characters/hero/tags.txt','external changed');await directoryFile('characters/hero/char.json',JSON.stringify({name:'守卫',tags_file:'tags.txt'}));await bridge.refreshProject();});
    await page.waitForFunction(()=>document.querySelector('.tag-well')?.textContent.includes('external changed'));
    await page.evaluate(async()=>{await directoryFile('characters/hero/tags.txt','external latest tags');await bridge.refreshProject();});
    await page.waitForFunction(()=>document.querySelector('.tag-well')?.textContent.includes('external latest tags'));
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.characters[0].prompt),'silver hair, red cape');
    await panel.getByRole('button',{name:'设定',exact:true}).click();
    await panel.getByRole('region',{name:'资料原文',exact:true}).waitFor();
    await panel.getByRole('treeitem',{name:'world.md',exact:true}).click();
    assert.match(await panel.getByRole('region',{name:'资料原文',exact:true}).textContent(),/END_OF_FILE/);
    const plans=panel.getByRole('treeitem',{name:'plans',exact:true}),scene=panel.getByRole('treeitem',{name:'scene.md',exact:true});
    await plans.click();assert.equal(await scene.count(),0);
    await panel.getByLabel('查找企划资料',{exact:true}).fill('scene');await scene.waitFor();
    await plans.focus();await plans.press('ArrowRight');
    assert.equal(await scene.evaluate(element=>document.activeElement===element),true,'right arrow enters the expanded folder');
    await page.keyboard.press('Enter');
    assert.equal(await panel.getByRole('region',{name:'资料原文',exact:true}).textContent(),'# 原文场景\n\n保留缩进与标记');
    await panel.getByLabel('查找企划资料',{exact:true}).fill('');
    assert.equal(await plans.getAttribute('aria-expanded'),'false','clearing search restores the original collapsed folder');
    assert.equal(await scene.count(),0);
    await panel.getByRole('button',{name:'参考',exact:true}).click();
    const references=panel.getByRole('treeitem',{name:'scenes',exact:true}),reference=panel.getByRole('treeitem',{name:'scene.png',exact:true});
    await references.click();assert.equal(await reference.count(),0);
    await references.click();await reference.click();
    assert.equal(await panel.getByRole('heading',{name:'scene',exact:true}).count(),1);
    await page.waitForFunction(()=>document.querySelector('.image-meta')?.textContent.includes('120 × 180'));
    await panel.getByRole('button',{name:'资料操作',exact:true}).click();
    await page.getByRole('menuitem',{name:'文件信息与说明',exact:true}).click();
    const information=panel.getByRole('region',{name:'文件信息与说明',exact:true});
    assert.match(await information.textContent(),/references\/scenes\/scene.png/);
    assert.match(await information.textContent(),/\*\*冷暖光参考\*\*\n保留原始说明/);
    await panel.getByRole('button',{name:'收起文件信息',exact:true}).click();assert.equal(await information.count(),0);
    const [download]=await Promise.all([page.waitForEvent('download'),panel.getByRole('button',{name:'下载原图',exact:true}).click()]);
    assert.equal(download.suggestedFilename(),'scene.png');
    assert.equal((await readFile(await download.path())).subarray(1,4).toString(),'PNG');
    await panel.getByRole('button',{name:'ASK',exact:true}).click();assert.equal(await panel.count(),0);
    assert.match(await page.evaluate(()=>ask.input.value),/references\/scenes\/scene.png/);
    await page.evaluate(()=>bridge.openProject());await panel.waitFor();
    await panel.getByRole('button',{name:'成果',exact:true}).click();
    assert.equal(await panel.getByRole('tree').count(),0,'results use an image gallery rather than a file tree');
    const resultImage=panel.getByRole('navigation',{name:'成果图片'}).getByRole('button',{name:'result.png',exact:true});
    await resultImage.waitFor();
    for(const [name,mode] of [['行对齐','rows'],['列对齐','cols'],['拼图','mosaic']]) {
      const choice=panel.getByRole('group',{name:'成果排列'}).getByRole('button',{name,exact:true});
      await choice.click();assert.equal(await choice.getAttribute('aria-pressed'),'true');
      assert.equal(await panel.getByRole('navigation',{name:'成果图片'}).getAttribute('data-layout'),mode);
      assert.equal(await resultImage.count(),1,'layout changes preserve the same image entry');
    }
    assert.equal(await panel.getByRole('button',{name:'result.png.json',exact:true}).count(),0,'companion recipe remains grouped with its image');
    await panel.getByRole('button',{name:'lighting.md',exact:true}).click();
    assert.equal(await panel.getByRole('region',{name:'资料原文',exact:true}).textContent(),'# 光影备忘\n原始内容');
    await panel.getByRole('button',{name:'返回成果',exact:true}).click();
    await resultImage.click();
    assert.equal(await panel.getByRole('button',{name:'返回成果',exact:true}).evaluate(element=>document.activeElement===element),true,'opening a result moves focus into its detail');
    await panel.getByLabel('成果文件').selectOption('assets/result.png.txt');assert.equal(await panel.locator('pre').textContent(),'silver hair');
    await panel.getByRole('button',{name:'返回成果',exact:true}).click();
    assert.equal(await resultImage.evaluate(element=>document.activeElement===element),true,'returning to the gallery restores the selected image focus');
    assert.equal(await panel.getByRole('navigation',{name:'成果图片'}).getAttribute('data-layout'),'mosaic','the selected layout survives opening a result');
    await resultImage.press('Enter');await panel.getByLabel('成果文件').selectOption('assets/result.png.txt');
    await panel.getByRole('button',{name:'ASK',exact:true}).click();assert.equal(await panel.count(),0);assert.match(await page.evaluate(()=>ask.input.value),/assets\/result.png.txt/);
    assert.equal(requests.filter(p=>/generate|completions|messages|encode/.test(p)).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('[core] B1 manual JSON, no ASK key, parameter diff, queue ownership, dedup, apply/undo/new board and responsive UI',async()=>{
  const {page,context,requests,errors}=await setup({directory:false});
  try {
    assert.equal(await page.evaluate(()=>bridge.supported),false);
    await page.evaluate(()=>ask.show());
    const first=draft('manual-a',[patch(', warm light'),params({width:1216,height:832,seed:'0',cfgRescale:.2})]);
    await receive(page,first);await page.waitForFunction(()=>ask.draftPlan.value);
    assert.equal(await page.evaluate(()=>ask.ready.value),'connection');
    assert.equal(await page.evaluate(()=>ask.draftPlan.value.changes.find(c=>c.field==='seed').after),'0');
    await receive(page,first);assert.equal(await page.locator('.ask-external').count(),1);
    await receive(page,{...first,draft_title:'篡改同 ID'});assert.match(await page.evaluate(()=>bridge.error.value),/新 ID/);
    await receive(page,draft('manual-b',[params({scale:6})]));assert.equal(await page.evaluate(()=>ask.externalWaiting.value.length),1);
    const owner=await page.evaluate(()=>ask.conversationId.value);
    await page.evaluate(()=>ask.newConversation());assert.equal(await page.evaluate(()=>ask.draftPlan.value),null);
    await page.evaluate(owner=>ask.selectConversation(owner),owner);await apply(page);
    await page.waitForFunction(()=>ask.draftPlan.value?.title==='外部建议 manual-b');
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.seed),'0');
    assert.equal(await page.evaluate(()=>bridge.receipt.value.draft_id),'manual-b');
    await page.evaluate(()=>ask.ignoreDraft());await page.evaluate(()=>ask.undoDraft());
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.seed),'');
    const base=await page.evaluate(()=>drawing.snapshot().activeBoardId);
    await receive(page,draft('manual-new',[patch(', moon')],{new_board_name:'月光试验'}));await apply(page);
    assert.notEqual(await page.evaluate(()=>drawing.snapshot().activeBoardId),base);
    await page.evaluate(()=>ask.undoDraft());assert.equal(await page.evaluate(()=>drawing.snapshot().boards.length),1);
    await receive(page,draft('manual-ui',[patch(', quiet night')]));
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.locator('.ask-head').getByRole('button',{name:'更多',exact:true}).click();
      assert.deepEqual(await page.locator('#askMoreMenu [role=menuitem]').allTextContents(),['压缩上下文','调用调试']);
      await page.keyboard.press('Escape');
    }
    const downloading=page.waitForEvent('download');await page.evaluate(()=>bridge.exportState());const file=await downloading;
    const state=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(state.schema,'koma.bridge.live.v1');assert.equal(state.selected_image,null);
    const bad={...draft('stale',[patch()]),base_hash:'not-known'};await receive(page,bad);assert.equal(await page.evaluate(()=>bridge.receipt.value.status),'invalid');
    assert.deepEqual(requests,[],'bridge receipt/apply/undo/export never requests upstream');assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B1 malformed inbox recovery, permission restore, failed IO pause and preview ownership',async()=>{
  const {page,context,errors}=await setup();
  try {
    await page.evaluate(()=>bridge.mount());
    const first=draft('recover-a',[patch(', sunset')]);
    await page.evaluate(value=>directoryFile('draft.inbox.json',JSON.stringify(value)),first);await waitReceipt(page,'recover-a','pending');
    await page.evaluate(()=>directoryFile('draft.inbox.json','[]'));
    await page.waitForFunction(()=>bridge.error.value.includes('须为对象'));
    assert.equal(await page.evaluate(()=>bridge.phase.value),'active');
    assert.equal(await page.evaluate(()=>bridge.receipt.value.draft_id),'recover-a');
    await page.evaluate(value=>directoryFile('draft.inbox.json',JSON.stringify(value)),{...first,draft_title:'改动同 ID'});
    await page.waitForFunction(()=>bridge.error.value.includes('新 ID'));
    await page.evaluate(value=>directoryFile('draft.inbox.json',JSON.stringify(value)),draft('recover-b',[{kind:'slate_edit'}]));await waitReceipt(page,'recover-b','invalid');
    await page.evaluate(()=>ask.ignoreDraft());
    await page.evaluate(value=>directoryFile('draft.inbox.json',JSON.stringify(value)),draft('recover-c',[params({seed:'0'})]));await waitReceipt(page,'recover-c','pending');
    assert.equal(await page.evaluate(()=>bridge.error.value),'');
    await page.evaluate(()=>ask.ignoreDraft());await waitReceipt(page,'recover-c','dismissed');

    await page.evaluate(async()=>{
      await bridge.unmount();
      window.foreignPreview=`live/${crypto.randomUUID()}.webp`;
      await directoryFile(foreignPreview,'user-owned-file');
      const state=JSON.parse(await directoryFile('state.live.json'));
      state.selected_image={id:'external',preview:foreignPreview};
      await directoryFile('state.live.json',JSON.stringify(state));
      await bridge.mount();
    });
    assert.equal(await page.evaluate(()=>directoryFile(foreignPreview)),'user-owned-file','external JSON cannot grant file deletion ownership');

    await page.evaluate(()=>{
      window.readFileOriginal=FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile=function(){if(this.name==='draft.inbox.json')throw new DOMException('permission lost','NotAllowedError');return readFileOriginal.call(this);};
    });
    await page.waitForFunction(()=>bridge.phase.value==='permission');
    assert.equal(await page.evaluate(async()=>(await navigator.locks.query()).held.some(l=>l.name.startsWith('koma-bridge-writer-v1:'))),false);
    await page.evaluate(()=>{FileSystemFileHandle.prototype.getFile=readFileOriginal;window.permission='granted';return bridge.resume();});
    await page.waitForFunction(()=>bridge.phase.value==='active');
    await page.evaluate(()=>sessionStorage.setItem('bridge-test-permission','prompt'));
    await page.reload();await bind(page);
    assert.equal(await page.evaluate(()=>bridge.phase.value),'permission');
    assert.equal(await page.evaluate(()=>permissionRequests),0,'restore never opens permission prompt automatically');
    await page.evaluate(()=>{window.permission='denied';return bridge.resume();});
    assert.equal(await page.evaluate(()=>bridge.phase.value),'permission');
    await page.evaluate(()=>{window.permission='granted';return bridge.resume();});
    await page.waitForFunction(()=>bridge.phase.value==='active');
    await waitReceipt(page,'recover-c','dismissed');
    await page.evaluate(()=>services.data.import(async()=>{}));
    await page.waitForFunction(()=>bridge.phase.value==='active'&&!bridge.busy.value);
    await page.evaluate(()=>drawing.writeDraft({prompt:'after maintenance'},{prompt:drawing.snapshot().form.prompt}));
    await poll(page,async()=>JSON.parse(await directoryFile('state.live.json')).form.prompt==='after maintenance');
    await page.evaluate(()=>bridge.unmount());
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B1 directory sync, preview cache, receipt ordering, half-write recovery, persisted dedup and writer exclusion',async()=>{
  const {page,context,errors}=await setup();
  try {
    await page.evaluate(async()=>{
      const canvas=new OffscreenCanvas(128,192),ctx=canvas.getContext('2d');ctx.fillStyle='#aabbcc';ctx.fillRect(0,0,128,192);
      const blob=await canvas.convertToBlob({type:'image/png'});
      for(let n=0;n<4;n++)await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, blob,{width:128,height:192},{prompt:`synthetic ${n}`,seed:n,model:'nai-diffusion-5-full'},null);
      window.encodes=0;await bridge.mount();
    });
    await poll(page,async()=>{try{return JSON.parse(await directoryFile('state.live.json')).recent_history.length===3}catch{return false}});
    const encoded=await page.evaluate(()=>encodes);assert.equal(encoded,3);
    await page.evaluate(()=>drawing.writeDraft({prompt:'blue sky'},{prompt:drawing.snapshot().form.prompt}));
    await poll(page,async()=>JSON.parse(await directoryFile('state.live.json')).form.prompt==='blue sky');
    assert.equal(await page.evaluate(()=>encodes),encoded,'text edits must not re-encode previews');
    await page.evaluate(()=>directoryFile('draft.inbox.json','{"schema":'));
    await page.waitForFunction(()=>bridge.error.value.includes('草稿读取失败'));
    await page.evaluate(value=>directoryFile('draft.inbox.json',JSON.stringify(value)),draft('dir-a',[patch(', warm light')]));await waitReceipt(page,'dir-a','pending');
    await page.evaluate(value=>directoryFile('draft.inbox.json',JSON.stringify(value)),draft('dir-b',[params({scale:7})]));await waitReceipt(page,'dir-b','pending');
    await apply(page);await page.waitForFunction(()=>ask.draftPlan.value?.title==='外部建议 dir-b');
    assert.equal(await page.evaluate(()=>bridge.receipt.value.draft_id),'dir-b');
    await page.evaluate(()=>ask.ignoreDraft());await waitReceipt(page,'dir-b','dismissed');
    await page.reload();await bind(page);await page.waitForFunction(()=>bridge.phase.value==='active');
    assert.equal(await page.evaluate(()=>ask.entries.value.filter(e=>e.external).length),0,'terminal inbox does not replay after reload');
    await waitReceipt(page,'dir-b','dismissed');
    const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(origin+'/#/image');await bind(second);
    assert.equal(await second.evaluate(()=>bridge.phase.value),'occupied');
    await receive(second,draft('occupied-manual',[patch(', blocked')]));
    assert.match(await second.evaluate(()=>bridge.error.value),/其他页面同步/);
    assert.equal(await second.evaluate(()=>ask.entries.value.filter(e=>e.external).length),0);
    await second.close();await page.bringToFront();
    await page.evaluate(value=>directoryFile('draft.inbox.json',JSON.stringify(value)),draft('pending-refresh',[patch(', blue')]));await waitReceipt(page,'pending-refresh','pending');
    await page.reload();await bind(page);await waitReceipt(page,'pending-refresh','invalid');
    assert.equal(await page.evaluate(()=>ask.draftPlan.value),null);
    await page.evaluate(()=>bridge.unmount());assert.equal(await page.evaluate(()=>bridge.phase.value),'off');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B1 running ASK queues external drafts; saved queue restores; failed writes keep pending review',async()=>{
  const {page,context,errors,release,started}=await setup({llm:true});
  try {
    await page.evaluate(()=>{ask.show();ask.setInput('请整理文字');void ask.send();});await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(new Error("ASK did not start")),5000))]);
    await receive(page,draft('while-running',[patch(', moon')]));assert.equal(await page.evaluate(()=>ask.draftPlan.value),null);assert.equal(await page.evaluate(()=>ask.externalWaiting.value.length),1);
    release();await page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
    await receive(page,draft('saved-queue',[params({seed:'12'})]));
    await page.evaluate(async()=>{await ask.toggleFavorite();await ask.flushFavorites();});
    await page.reload();await bind(page);
    assert.equal(await page.evaluate(()=>ask.draftPlan.value.title),'外部建议 while-running');assert.equal(await page.evaluate(()=>ask.externalWaiting.value.length),1);
    await page.evaluate(()=>{window.originalWrite=services.data.write;services.data.write=async()=>{throw new Error('simulated write failure')};});
    await apply(page);assert.ok(await page.evaluate(()=>ask.draftPlan.value));assert.doesNotMatch(await page.evaluate(()=>drawing.snapshot().form.prompt),/moon/);
    await page.evaluate(()=>{services.data.write=originalWrite});await apply(page);await page.waitForFunction(()=>ask.draftPlan.value?.title==='外部建议 saved-queue');
    await page.evaluate(()=>ask.ignoreDraft());assert.deepEqual(errors,[]);
  }finally{release();await context.close();}
});

function refResponse(protocol, name, input={}, prose='资料已整理成备忘录。') {
  const chunks=protocol==='openai-chat-v1' ? [
    {choices:[{index:0,delta:name?{tool_calls:[{index:0,id:'ref-call',type:'function',function:{name,arguments:JSON.stringify(input)}}]}:{content:prose}}]},
    {choices:[{index:0,delta:{},finish_reason:name?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}},
  ] : [
    {type:'message_start',message:{usage:{input_tokens:100}}},
    {type:'content_block_start',index:0,content_block:name?{type:'tool_use',id:'ref-call',name,input:{}}:{type:'text',text:prose}},
    ...(name?[{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}}]:[]),
    {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:name?'tool_use':'end_turn'},usage:{output_tokens:20}},{type:'message_stop'},
  ];
  return chunks.map(c=>(protocol==='anthropic-messages-v1'?`event: ${c.type}\n`:'')+`data: ${JSON.stringify(c)}\n\n`).join('')+(protocol==='openai-chat-v1'?'data: [DONE]\n\n':'');
}
test(`B2 openai-chat-v1: metadata-only initial state, text/image tool reads, frozen contents, saved attachments and explicit memo export`,async()=>{
  const protocol = "openai-chat-v1";
  let finish;const finalReply=new Promise(resolve=>finish=resolve);
  const calls=[];let script=[['read_ref',{path:'brief.md'}],['read_ref',{path:'palette.png'}],[null,{}]];
  const {page,context,errors}=await setup({llm:true,protocol,async respond(body){calls.push(body);const [name,input]=script.shift()??[null,{}];if(!name)await finalReply;return refResponse(protocol,name,input)}});
  try {
    await page.evaluate(async()=>{
      await directoryFile('refs/brief.md','B2_ORIGINAL_BODY');
      const canvas=new OffscreenCanvas(120,80);canvas.getContext('2d').fillRect(0,0,120,80);await directoryFile('refs/palette.png',await canvas.convertToBlob({type:'image/png'}));
      await directoryFile('assets/do-not-read.md','PRIVATE_ASSET');await bridge.mount();await ask.setImages(true);ask.show();
      await ask.addFiles([new File(['用户补充原文'],'user-notes.txt',{type:'text/plain'})]);ask.setInput('请查看 brief.md 和 palette.png');void ask.send();
    });
    await page.waitForFunction(()=>ask.live.value?.attachments.length===3);
    assert.deepEqual(await page.locator('.ask-sent-att .ask-att-name').allTextContents(),['user-notes.txt'],'tool reads must not be presented as user uploads while streaming');
    assert.equal(await page.locator('.ask-sent-img').count(),0);
    assert.equal(await page.locator('.ask-tray').count(),0,'tool reads do not enter the pending input');
    finish();
    await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.some(e=>e.type==='turn'));
    assert.equal(await page.evaluate(()=>ask.entries.value.find(e=>e.type==='turn').turn.status),'done');assert.equal(calls.length,3);
    const initial=JSON.stringify(calls[0].messages);assert.match(initial,/refs_index/);assert.match(initial,/brief.md/);assert.doesNotMatch(initial,/B2_ORIGINAL_BODY|PRIVATE_ASSET/);
    const refs=await page.evaluate(async()=>JSON.parse(await directoryFile('state.live.json')).refs_index);assert.deepEqual(refs.lore.map(f=>f.path),['refs/brief.md']);assert.deepEqual(refs.references.map(f=>f.path),['refs/palette.png']);
    assert.match(JSON.stringify(calls[1].messages),/B2_ORIGINAL_BODY/);assert.match(JSON.stringify(calls[2].messages),/data:image\/webp;base64/);
    const captured=await page.evaluate(()=>ask.entries.value.find(e=>e.type==='turn').turn.attachments);assert.equal(captured.length,3);assert.equal(captured.filter(a=>a.toolRead&&a.origin.version).length,2);
    assert.deepEqual(await page.locator('.ask-sent-att .ask-att-name').allTextContents(),['user-notes.txt']);
    assert.match(await page.locator('.ask-tools-summary').textContent(),/refs\/brief\.md|brief\.md/,'tool activity remains visible');
    await page.evaluate(async()=>{await directoryFile('refs/brief.md','B2_REPLACED_BODY');await ask.toggleFavorite();await ask.flushFavorites();await bridge.unmount();});
    await page.reload();await bind(page);await page.evaluate(()=>ask.show());
    assert.equal(await page.evaluate(()=>ask.attachmentText(ask.entries.value.find(e=>e.type==='turn').turn.attachments.find(a=>a.toolRead&&a.kind==='text').id)),'B2_ORIGINAL_BODY');
    assert.equal(await page.evaluate(()=>ask.entries.value.find(e=>e.type==='turn').turn.attachments.find(a=>a.kind==='image').origin.path),'refs/palette.png');
    assert.deepEqual(await page.locator('.ask-sent-att .ask-att-name').allTextContents(),['user-notes.txt'],'favorite restore preserves attachment provenance');
    assert.equal(await page.locator('.ask-sent-img').count(),0);
    await page.getByRole('button',{name:'保存为备忘录',exact:true}).click();await page.locator('#askFullDraft .draft-toggle').click();await page.getByRole('button',{name:'创作备忘录 · 保存详情',exact:true}).click();assert.match(await page.locator('.file-prose').textContent(),/资料已整理成备忘录。/);
    const download=page.waitForEvent('download');await apply(page);const file=await download;assert.equal(await readFile(await file.path(),'utf8'),'资料已整理成备忘录。');
    assert.equal(calls.length,3,'export does not invoke inference');assert.deepEqual(errors,[]);
  } finally {finish();await context.close();}
});

test(`B2 openai-chat-v1: save_ref tool creates a reviewable file draft and writes only after confirmation`,async()=>{
  const protocol = "openai-chat-v1";
  let call=0,hash='';
  const {page,context,errors,requests}=await setup({llm:true,protocol,respond(body){
    call++;
    return call===1 ? refResponse(protocol,'propose_draft',{base_hash:hash,draft_title:'保存创作笔记',steps:[{kind:'save_ref',document:'memo',document_title:'创作笔记',text:'稳定构图与冷色调。'}]}) : refResponse(protocol,null,{},'已备好创作笔记，等待确认。');
  }});
  try {
    hash=await page.evaluate(async()=>{await bridge.mount();const {stateHash}=await import('/src/ask/draft/validate.ts');return stateHash(ask.externalSnapshot().base);});
    await page.evaluate(()=>{ask.show();ask.setInput('请将创作笔记保存到协同目录');void ask.send();});
    await page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
    const filename=await page.evaluate(()=>ask.draftPlan.value.files[0].filename);
    assert.equal(await page.evaluate(async name=>{try{await directoryFile('refs/'+name);return true}catch{return false}},filename),false);
    await page.locator('#askFullDraft .ask-draft-apply').click();await page.waitForFunction(()=>!ask.writingDraft.value&&!ask.draftPlan.value);
    assert.equal(await page.evaluate(name=>directoryFile('refs/'+name),filename),'稳定构图与冷色调。');
    assert.equal(await page.locator('.receipt-checkpoint .ask-tools-line').textContent(),'已保存 创作备忘录');
    assert.equal(call,2);assert.ok(!requests.some(path=>/generate/.test(path)));assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B2 unified file drafts: native attachments, compact review, frozen destination, failure/undo and settings in the real ASK page',async()=>{
  const {page,context,errors,requests}=await setup();
  try {
    await page.evaluate(async()=>{await directoryFile('refs/design/brief.md','manual contents');await bridge.mount();ask.show();});
    await page.locator('.ask-cbar input[type=file]').setInputFiles({name:'manual.md',mimeType:'text/markdown',buffer:Buffer.from('manual contents')});
    await page.waitForFunction(()=>ask.tray.value.length===1&&!ask.preparing.value);
    assert.equal(await page.locator('.bridge-panel').count(),0);
    await receive(page,draft('b2-files',[patch(', unified')]));
    await page.getByRole('button',{name:'选择应用方式',exact:true}).click();await page.getByRole('menuitem',{name:'附加画板配方',exact:true}).click();
    const card=page.locator('#askFullDraft .ask-draft');await card.locator('.draft-toggle[aria-expanded=false]').click();
    assert.equal(await page.evaluate(()=>ask.draftPlan.value.changes.length),1);assert.equal(await card.locator('.file-row').count(),1);assert.equal(await card.locator('.file-drawer').count(),0);
    await page.getByRole('button',{name:'画板配方 · 保存详情',exact:true}).click();
    const filename=await page.evaluate(()=>ask.draftPlan.value.files[0].filename),payload=await page.evaluate(()=>ask.draftPlan.value.files[0].text);

    await page.evaluate(()=>bridge.unmount());await page.waitForFunction(()=>ask.draftPlan.value.steps.some(s=>s.issue));assert.equal(await card.locator('.ask-draft-apply').isDisabled(),true);
    await page.evaluate(()=>bridge.mount());await page.waitForFunction(()=>!ask.draftPlan.value.steps.some(s=>s.issue));
    await page.evaluate(name=>{window.originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=function(...args){if(this.name===name)throw new DOMException('write failure','NotAllowedError');return originalWritable.apply(this,args)}},filename);
    await apply(page);await page.waitForFunction(()=>!ask.writingDraft.value);assert.ok(await page.evaluate(()=>!!ask.draftPlan.value));assert.match(await page.evaluate(()=>ask.notice.value),/write failure/);assert.doesNotMatch(await page.evaluate(()=>drawing.snapshot().form.prompt),/unified/);
    await page.evaluate(()=>{FileSystemFileHandle.prototype.createWritable=originalWritable});await apply(page);await page.waitForFunction(()=>!ask.draftPlan.value);
    assert.equal(await page.evaluate(name=>directoryFile('refs/'+name),filename),payload);assert.match(await page.locator('.receipt-checkpoint .ask-tools-line').textContent(),/已应用 2 项更改/);
    await page.evaluate(()=>ask.undoDraft());assert.doesNotMatch(await page.evaluate(()=>drawing.snapshot().form.prompt),/unified/);assert.equal(await page.evaluate(async name=>{try{await directoryFile('refs/'+name);return true}catch{return false}},filename),false);
    const redo=await page.evaluate(()=>ask.redoId.value);await page.evaluate(id=>ask.restoreDraft(id),redo);assert.equal(await page.evaluate(name=>directoryFile('refs/'+name),filename),payload);
    await page.evaluate(name=>directoryFile('refs/'+name,'external edit'),filename);await page.evaluate(()=>ask.undoDraft());assert.match(await page.evaluate(()=>ask.notice.value),/已存在或被修改/);assert.match(await page.evaluate(()=>drawing.snapshot().form.prompt),/unified/);
    await page.evaluate(()=>ask.openSettings());await page.waitForSelector('#settingsPanel[open]');const section=page.getByRole('region',{name:'外部协同',exact:true});
    // Native settings section, inside the existing settings dialog, with only fallback actions.
    assert.equal(await page.locator('#settingsPanel section[aria-label="外部协同"]').count(),1);
    assert.equal(await page.locator('dialog[open]').count(),1);assert.equal(await page.getByRole('button',{name:'导出协同协议',exact:true}).count(),1);
    assert.equal(requests.filter(p=>/generate|completions|messages/.test(p)).length,0);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('B2 image readers share vision budgets, reject disabled pixels and release resources on failure',async()=>{
  const {page,context,errors}=await setup();
  try {
    const result=await page.evaluate(async()=>{
      const {createReferenceReader}=await import('/src/ask/read-ref.ts'),{createAttachments,attachmentPictures}=await import('/src/ask/attachments.ts'),{createVision}=await import('/src/ask/vision.ts'),{scanRefs,referenceSnapshot}=await import('/src/bridge/refs.ts');
      const canvas=new OffscreenCanvas(120,80),g=canvas.getContext('2d');
      for(let n=0;n<5;n++){g.fillStyle=`rgb(${n*40},30,60)`;g.fillRect(0,0,120,80);await directoryFile(`refs/${n}.png`,await canvas.convertToBlob({type:'image/png'}));}
      const root=await showDirectoryPicker(),abort=new AbortController(),source=referenceSnapshot(root,await scanRefs(root,abort.signal),abort.signal),vision=createVision(),pool=createAttachments(id=>vision.forget(id)),attached=[];
      const visual={signal:abort.signal,metadataOnly:false,budget:{calls:0,pixels:0,bytes:0},viewed:new Set()},deps={source,pool,attached,limits:{chars:50000,totalChars:100000},pageBytes:()=>pool.bytes,visual,vision,added(){}};
      const read=createReferenceReader(deps),fail=async(fn)=>{try{await fn();return ''}catch(e){return e.message}};
      const disabled=await fail(()=>createReferenceReader({...deps,visual:{...visual,metadataOnly:true}})({path:'0.png'}));
      const offset=await fail(()=>read({path:'0.png',offset:1}));
      await read({path:'0.png'});const repeat=await read({path:'0.png'});await read({path:'1.png'});await read({path:'2.png'});
      const afterRepeat=visual.budget.calls;
      await vision.image(attachmentPictures([attached[0]])[0],'glance',undefined,visual);
      const over=await fail(()=>read({path:'3.png'})),count=pool.size,calls=visual.budget.calls;
      const pixel=await fail(()=>createReferenceReader({...deps,attached:[],visual:{...visual,budget:{calls:0,pixels:1500000,bytes:0}}})({path:'4.png'}));
      const bytes=await fail(()=>createReferenceReader({...deps,attached:[],visual:{...visual,budget:{calls:0,pixels:0,bytes:400*1024}}})({path:'4.png'}));
      const final=pool.size;pool.dispose();vision.dispose();return{disabled,offset,over,count,calls,pixel,bytes,final,afterRepeat,repeat};
    });
    assert.match(result.disabled,/未启用/);assert.match(result.offset,/offset/);assert.match(result.over,/4 次/);assert.equal(result.count,3);assert.equal(result.calls,4);assert.equal(result.final,3);assert.match(result.pixel,/预算/);assert.match(result.bytes,/预算/);assert.deepEqual(errors,[]);
    assert.equal(result.afterRepeat,3);assert.equal(result.repeat.stat,'本轮已查看');assert.match(result.repeat.content[0].text,/already_viewed_this_turn/);assert.equal(result.repeat.content.some(c=>c.type==='image'),false);
  } finally {await context.close();}
});

test('B2 explicit retry re-reads a new file version without turning tool content into user attachments',async()=>{
  const calls=[];let count=0;
  const {page,context,errors}=await setup({llm:true,respond(body){
    calls.push(body);count++;
    if(count===1||count===3)return refResponse('openai-chat-v1','read_ref',{path:'retry.md'});
    if(count===2)return 'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'content_filter'}]})+'\n\ndata: [DONE]\n\n';
    return refResponse('openai-chat-v1',null);
  }});
  try {
    await page.evaluate(async()=>{await directoryFile('refs/retry.md','FIRST_VERSION');await bridge.mount();ask.show();ask.setInput('看一下 retry.md');void ask.send()});
    await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.some(e=>e.type==='turn'));
    const failed=await page.evaluate(()=>ask.entries.value.find(e=>e.type==='turn').turn);assert.equal(failed.status,'failed');assert.equal(failed.attachments.length,1);assert.equal(failed.attachments[0].toolRead,true);
    assert.equal(await page.locator('.ask-sent-att').count(),0,'a tool-only turn has no user attachment row');
    await page.evaluate(async id=>{await directoryFile('refs/retry.md','SECOND_VERSION');ask.retry(id,'plain')},failed.id);
    await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.some(e=>e.type==='turn'&&e.turn.status==='done'));
    assert.equal(calls.length,4);assert.doesNotMatch(JSON.stringify(calls[2].messages),/FIRST_VERSION|SECOND_VERSION/);assert.match(JSON.stringify(calls[3].messages),/SECOND_VERSION/);
    assert.equal(await page.evaluate(()=>ask.entries.value.find(e=>e.type==='turn').turn.attachments.length),1);
    assert.equal(await page.evaluate(id=>ask.attachmentText(id),failed.attachments[0].id),null,'replaced failed tool attachment is released');
    assert.equal(await page.evaluate(()=>ask.editTurn(ask.entries.value.find(e=>e.type==='turn').id,'')),false,'tool-only attachments do not authorize an empty edited question');
    await page.locator('.ask-turn .ask-u').hover();await page.getByRole('button',{name:'编辑提问',exact:true}).click();await page.getByRole('textbox',{name:'编辑提问',exact:true}).fill('');
    assert.equal(await page.locator('.ask-sent-att').count(),0,'editing does not reclassify tool reads as user uploads');
    assert.equal(await page.getByRole('button',{name:'重新回答',exact:true}).isDisabled(),true);assert.equal(calls.length,4);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

const createSlateStep = title => ({kind:'slate_edit',op:'create',slate_title:title,todos:[{op:'add',todo_title:'第一张',image_required:false}]});
async function createSlate(page,title='雨夜系列') { await receive(page,draft(`create-${Date.now()}`,[createSlateStep(title)]));await apply(page);return page.evaluate(()=>slate.snapshot()); }
const editSlate = (s,todos,extra={}) => ({kind:'slate_edit',op:'update',slate_id:s.id,expected_version:s.version,todos,...extra});
async function addSlateImage(page) {return page.evaluate(async()=>{
  const canvas=new OffscreenCanvas(128,192),ctx=canvas.getContext('2d');ctx.fillStyle='#6680aa';ctx.fillRect(0,0,128,192);const blob=await canvas.convertToBlob({type:'image/png'});
  await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, blob,{width:128,height:192},{basePrompt:'{blue sky}',prompt:'{blue sky}, quality',baseNegative:'bad',seed:0,cfgRescale:.25,naiMode:'furry',transparentBg:true,characters:[],localCharacters:[]},null);
  const p=ask.externalSnapshot().library.at(-1);return {id:p.id,label:p.label,scope:ask.externalSnapshot().pictureScope};
});}

test('B3 local tasks use an inline Todo list and a small overview, with native persistence and draft-only exports',async()=>{
  const {page,context,requests,errors}=await setup({directory:false});
  try {
    await page.getByRole('button',{name:'打开任务总览',exact:true}).click();await page.getByRole('button',{name:'任务总览选项',exact:true}).click();await page.getByRole('menuitem',{name:'新建清单',exact:true}).click();
    await page.getByRole('textbox',{name:'清单名称',exact:true}).fill('本机创作清单');await page.getByRole('button',{name:'创建',exact:true}).click();await page.waitForFunction(()=>slate.snapshot()?.title==='本机创作清单'&&!slate.busy.value);
    const base=await page.evaluate(()=>slate.snapshot());await receive(page,draft('local-task',[editSlate(base,[{op:'add',id:'CG01',todo_title:'完成构图',requirements:'远景构图，保持天空留白',image_required:false,status:'in_progress'}]) ]));await apply(page);
    const todoId=await page.evaluate(()=>slate.snapshot().todos[0].id);assert.notEqual(todoId,'CG01');
    const receipt=page.locator('.receipt-checkpoint').last();
    assert.equal(await page.locator('.ask-external').count(),0,'applied notes reuse the tool row without an external card');
    assert.equal(await receipt.locator('.ask-tools-line').textContent(),'已添加 完成构图');
    assert.equal(await receipt.locator('.tool-source').isVisible(),false);
    assert.equal(await receipt.locator('.tool-origin').textContent(),'来自外部');
    await receipt.locator('.ask-tools-line').click();assert.equal(await receipt.locator('.tool-source').textContent(),'来自 测试助手');await receipt.locator('.ask-tools-line').click();
    await page.getByRole('button',{name:'待办',exact:false}).filter({has:page.locator('.ico')}).first().click();
    assert.equal(await page.getByRole('button',{name:'添加任务',exact:true}).count(),0);assert.equal(await page.locator('.slate-editor').count(),0);
    await page.getByRole('checkbox',{name:'完成构图 · 进行中',exact:true}).click();await page.waitForFunction(()=>ask.activeSlate.value.todos[0].status==='done');

    await page.evaluate(()=>ask.proposeFile('slate'));const downloading=page.waitForEvent('download');await apply(page);const file=await downloading;assert.equal(JSON.parse(await readFile(await file.path(),'utf8')).slate.todos[0].status,'done');
    await page.reload();await bind(page);assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].status),'done');assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].id),todoId);
    await page.evaluate(()=>ask.openSlate(slate.snapshot().id));assert.equal(await page.locator('.ask-todos').count(),1);
    assert.ok(!requests.some(p=>p.includes('completions')||p.includes('generate')));assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 task menus detach persistently and propose reversible Todo changes without replacing pending drafts',async()=>{
  const {page,context,requests,errors,release,started}=await setup({directory:false,llm:true});
  try {
    const id=await page.evaluate(async()=>{
      const {parseSlateEdit}=await import('/src/slate/edit.ts');
      const change=parseSlateEdit({kind:'slate_edit',op:'create',slate_title:'菜单测试',todos:[{op:'add',todo_title:'整理构图',image_required:false}]},null,drawing.snapshot().form,[]).change;
      await slate.commit(change);await ask.openSlate(change.id);return change.id;
    });
    const owner=await page.evaluate(()=>ask.conversationId.value);
    await page.evaluate(()=>ask.newConversation());
    assert.notEqual(await page.evaluate(()=>ask.conversationId.value),owner,'an unspoken task conversation is not an empty conversation');
    assert.equal(await page.evaluate(()=>ask.activeSlate.value),null);
    await page.evaluate(async owner=>{ask.selectConversation(owner);await ask.toggleFavorite();},owner);
    await page.getByRole('button',{name:'待办清单选项',exact:true}).click();
    await page.getByRole('menuitem',{name:'从当前会话移除',exact:true}).click();
    assert.equal(await page.locator('.ask-todos').count(),0);
    assert.ok(await page.evaluate(id=>slate.get(id),id));
    await page.evaluate(()=>ask.flushFavorites());await page.reload();await bind(page);
    assert.equal(await page.evaluate(()=>ask.activeSlate.value),null,'the detached favorite remains detached after reload');
    await page.getByRole('button',{name:'打开任务总览',exact:true}).click();
    await page.locator('.overview-item').filter({hasText:'菜单测试'}).click();
    await page.locator('.todos-bar').click();
    const menu=page.getByRole('button',{name:'整理构图 · 任务选项',exact:true});
    await menu.click();await page.getByRole('menuitem',{name:'放弃任务',exact:true}).click();
    assert.equal(await page.evaluate(()=>ask.activeSlate.value.todos[0].status),'todo','menu choices wait for Apply');
    const pending=await page.evaluate(()=>ask.draftPlan.value.fingerprint);
    assert.equal(await page.evaluate(id=>ask.proposeSlateAction(id,'delete'),id),false);
    await page.evaluate(()=>ask.detachSlate());
    assert.equal(await page.evaluate(()=>ask.draftPlan.value.fingerprint),pending);
    assert.equal(await page.evaluate(()=>ask.activeSlate.value.id),id);
    await apply(page);assert.equal(await page.evaluate(()=>ask.activeSlate.value.todos[0].status),'abandoned');
    await menu.click();await page.getByRole('menuitem',{name:'重新打开任务',exact:true}).click();await apply(page);
    assert.equal(await page.evaluate(()=>ask.activeSlate.value.todos[0].status),'todo');
    await menu.click();await page.getByRole('menuitem',{name:'删除待办',exact:true}).click();await apply(page);
    assert.equal(await page.evaluate(()=>ask.activeSlate.value.todos.length),0);
    await page.evaluate(()=>ask.undoDraft());assert.equal(await page.evaluate(()=>ask.activeSlate.value.todos[0].title),'整理构图');
    await menu.click();await page.getByRole('menuitem',{name:'删除待办',exact:true}).click();
    await page.evaluate(async()=>{const s=slate.snapshot();await slate.commit({...ask.draftPlan.value.slate,before:s,after:{...s,title:'后来更新'}});});
    await apply(page);assert.equal(await page.evaluate(()=>ask.activeSlate.value.todos.length),1,'a stale deletion cannot remove updated tasks');
    assert.ok(await page.evaluate(()=>ask.draftPlan.value.steps.some(s=>s.issue)));
    await page.evaluate(()=>ask.ignoreDraft());
    assert.ok(!requests.some(p=>/generate|completions/.test(p)));
    await page.evaluate(()=>{ask.setInput('整理当前任务');void ask.send();});await started;
    assert.equal(await page.evaluate(()=>ask.canManageTasks.value),false);
    assert.equal(await page.evaluate(id=>ask.proposeSlateAction(id,'delete'),id),false);
    release();await page.waitForFunction(()=>!ask.running.value);
    assert.equal(await page.evaluate(()=>ask.canManageTasks.value),true,'task actions become available again after ASK finishes');
    assert.deepEqual(errors,[]);
  }finally{release();await context.close();}
});

test('B3 deleting a task list clears shared conversation links, undo restores them and exported images survive',async()=>{
  const {page,context,requests,errors}=await setup();
  try {
    await page.evaluate(()=>bridge.mount());let s=await createSlate(page,'可删除清单');
    const image=await addSlateImage(page);
    await receive(page,draft('delete-bound-task',[editSlate(s,[{op:'update',id:s.todos[0].id,status:'done',bind:{source:image.label,caption_source:'base',caption_mode:'full'}}])],{picture_scope_id:image.scope}));await apply(page);
    s=await page.evaluate(()=>slate.snapshot());const owner=await page.evaluate(()=>ask.conversationId.value);
    await page.evaluate(async id=>{await ask.toggleFavorite();await ask.openSlate(id,true);await ask.toggleFavorite();},s.id);
    const second=await page.evaluate(()=>ask.conversationId.value);assert.notEqual(owner,second);
    await page.getByRole('button',{name:'打开任务总览',exact:true}).click();
    await page.getByRole('button',{name:'可删除清单 · 清单选项',exact:true}).click();
    await page.getByRole('menuitem',{name:'删除清单',exact:true}).click();
    assert.ok(await page.evaluate(id=>slate.get(id),s.id));
    await apply(page);
    assert.equal(await page.evaluate(id=>slate.get(id),s.id),null);
    assert.equal(await page.evaluate(()=>ask.activeSlate.value),null);
    await page.evaluate(id=>ask.selectConversation(id),owner);assert.equal(await page.evaluate(()=>ask.activeSlate.value),null);
    await page.evaluate(id=>ask.selectConversation(id),second);await page.evaluate(()=>ask.undoDraft());
    assert.equal(await page.evaluate(()=>ask.activeSlate.value.id),s.id);
    const redo=await page.evaluate(()=>ask.redoId.value);
    await page.evaluate(id=>ask.selectConversation(id),owner);assert.equal(await page.evaluate(()=>ask.activeSlate.value.id),s.id);
    await page.evaluate(id=>ask.selectConversation(id),second);await page.evaluate(id=>ask.restoreDraft(id),redo);
    assert.equal(JSON.parse(await page.evaluate(id=>directoryFile(`slates/${id}.slate.json`),s.id)).deleted,true);
    assert.ok(await page.evaluate(async binding=>!!await slate.asset(binding.assetId),s.todos[0].binding),'undo history retains the local asset');
    assert.ok(await page.evaluate(path=>directoryFile(path),s.todos[0].binding.target_path),'deleting a list preserves the exported original');
    await page.reload();await bind(page);
    for(const id of [owner,second]){await page.evaluate(id=>ask.selectConversation(id),id);assert.equal(await page.evaluate(()=>ask.activeSlate.value),null);}
    assert.equal(await page.locator('.ask-todos').count(),0);
    assert.ok(!requests.some(p=>/generate|completions/.test(p)));assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 inline image delivery requires an explicit caption source and persists the chosen image',async()=>{
  const {page,context,errors,requests}=await setup({directory:false});
  try {
    let s=await createSlate(page,'交付测试');const picture=await addSlateImage(page);
    await receive(page,draft('require-picture',[editSlate(s,[{op:'update',id:s.todos[0].id,image_required:true}])]));await apply(page);
    await page.evaluate(()=>ask.show());await page.locator('.todos-bar').click();
    await page.getByRole('checkbox',{name:'第一张 · 待办',exact:true}).click();
    const delivery=page.getByRole('dialog',{name:'交付成果',exact:true});await delivery.getByRole('button',{name:`选择 ${picture.label}`,exact:true}).click();
    const submit=delivery.getByRole('button',{name:'交付并完成',exact:true});assert.equal(await submit.isDisabled(),true);
    assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].binding),null);
    await delivery.getByRole('combobox',{name:'标注来源',exact:true}).selectOption('base');

    await submit.click();await page.waitForFunction(()=>slate.snapshot().todos[0].status==='done');
    s=await page.evaluate(()=>slate.snapshot());assert.equal(s.todos[0].binding.caption.source,'base');assert.equal(await delivery.count(),0);
    assert.equal(await page.evaluate(async id=>(await slate.asset(id)).params.basePrompt,s.todos[0].binding.assetId),'{blue sky}');
    assert.ok(!requests.some(path=>/generate|completions/.test(path)));assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 mounted creation maps automatically and task/recipe draft rows remain compact with separate readable details',async()=>{
  const {page,context,errors,requests}=await setup();
  try {
    await page.evaluate(()=>bridge.mount());const s=await createSlate(page,'挂载后创建'),path=`slates/${s.id}.slate.json`;
    assert.equal(JSON.parse(await page.evaluate(path=>directoryFile(path),path)).slate.title,s.title);
    await page.evaluate(()=>{drawing.patch({prompt:'long_recipe_marker, '+('calm coast, '.repeat(900))});ask.show();});
    await receive(page,draft('compact-recipe',[editSlate(s,[{op:'add',todo_title:'长描述任务',description:'详细要求 '.repeat(200),image_required:false}],{golden_recipe:{capture_current:true,locked:true},directory_required:true})]));
    const card=page.locator('#askFullDraft .ask-draft');await card.locator('.draft-toggle[aria-expanded=false]').click();
    const toggle=card.getByRole('button',{name:'配方修改详情',exact:true});assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await card.locator('.slate-row-title').count(),2);

    await toggle.click();assert.match(await card.locator('.recipe-values').textContent(),/long_recipe_marker/);await toggle.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await apply(page);await waitReceipt(page,'compact-recipe','applied');assert.equal(JSON.parse(await page.evaluate(path=>directoryFile(path),path)).slate.golden_recipe.form.prompt.includes('long_recipe_marker'),true);
    const next=await page.evaluate(()=>slate.snapshot());await receive(page,draft('compact-unlock',[editSlate(next,[],{golden_recipe:{capture_current:true,unlock:true,locked:false}})]));assert.equal(await toggle.getAttribute('aria-expanded'),'false');await page.evaluate(()=>ask.ignoreDraft());
    assert.ok(!requests.some(p=>p.includes('completions')||p.includes('generate')));assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 shared composite drafts bind real bytes, joint conflict checks, undo/redo, history deletion and reload',async()=>{
  const {page,context,errors}=await setup();
  try {
    let s=await createSlate(page);const image=await addSlateImage(page);
    const before=await page.evaluate(()=>drawing.snapshot().form.prompt);
    await receive(page,draft('bind-composite',[editSlate(s,[{op:'update',id:s.todos[0].id,status:'done',image_required:true,mutation:'接受局部裁切',bind:{source:image.label,caption_source:'base',caption_mode:'strip_syntax'}}]),patch(', next scene')],{picture_scope_id:image.scope}));
    await apply(page);s=await page.evaluate(()=>slate.snapshot());assert.equal(s.todos[0].status,'done');
    const assetId=s.todos[0].binding.assetId;
    const saved=await page.evaluate(async id=>{const a=await slate.asset(id);return {bytes:a.blob.size,sha:a.sha256,params:a.params,width:a.width};},assetId);
    assert.ok(saved.bytes>0);assert.match(saved.sha,/^[a-f0-9]{64}$/);assert.equal(saved.params.cfgRescale,.25);assert.equal(saved.width,128);
    await page.evaluate(()=>ask.undoDraft());assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].binding),null);assert.equal(await page.evaluate(()=>drawing.snapshot().form.prompt),before);
    await page.evaluate(()=>ask.restoreDraft(ask.entries.value.flatMap(e=>e.type==='note'&&e.checkpoint?.status==='reverted'?[e.checkpoint.id]:[]).at(-1)));assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].binding.assetId),assetId);
    // A concurrent version change blocks both task advancement and board edits.
    s=await page.evaluate(()=>slate.snapshot());await receive(page,draft('joint-conflict',[editSlate(s,[{op:'update',id:s.todos[0].id,mutation:'pending'}]),patch(', should not apply')]));
    await page.evaluate(async()=>{const s=slate.snapshot();await slate.commit({id:s.id,before:s,after:{...s,title:'用户改名'},bindings:[],directoryRequired:false});});
    assert.equal(await page.evaluate(()=>ask.draftPlan.value.slate),undefined);await apply(page);assert.doesNotMatch(await page.evaluate(()=>drawing.snapshot().form.prompt),/should not apply/);await page.evaluate(()=>ask.ignoreDraft());
    await page.evaluate(async()=>{await drawing.remove(drawing.snapshot().history[0].id);});
    await page.reload();await bind(page);assert.equal(await page.evaluate(async id=>(await slate.asset(id)).sha256,assetId),saved.sha);
    assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].binding.assetId),assetId);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 mounted tasks deliver originals and receipts; external changes are reviewed, new files map and unmount preserves tasks',async()=>{
  const {page,context,errors}=await setup();
  try {
    await page.evaluate(()=>bridge.mount());let s=await createSlate(page);
    const path=`slates/${s.id}.slate.json`;await poll(page,async path=>{try{return JSON.parse(await directoryFile(path)).slate.title==='雨夜系列'}catch{return false}},path);
    const image=await addSlateImage(page);
    await receive(page,draft('deliver',[editSlate(s,[{op:'update',id:s.todos[0].id,status:'done',image_required:true,bind:{source:image.label,caption_source:'sent',caption_mode:'full'}}],{directory_required:true})],{picture_scope_id:image.scope}));
    await apply(page);s=await page.evaluate(()=>slate.snapshot());assert.equal(s.todos[0].status,'done');
    const target=s.todos[0].binding.target_path;
    assert.equal(await page.evaluate(path=>directoryFile(path+'.txt'),target),'{blue sky}, quality');
    const receipt=JSON.parse(await page.evaluate(path=>directoryFile(path+'.json'),target));assert.equal(receipt.params.seed,0);assert.equal(receipt.params.cfgRescale,.25);
    assert.equal(await page.evaluate(()=>bridge.slateMappings.value[0].status),'synced');
    await page.evaluate(async path=>{const doc=JSON.parse(await directoryFile(path));doc.slate.todos[0].mutation='外部记录';await directoryFile(path,JSON.stringify(doc));},path);
    await page.waitForFunction(()=>ask.draftPlan.value?.title.startsWith('审阅任务文件'));
    assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].mutation),'');await apply(page);
    assert.equal(await page.evaluate(()=>ask.notice.value),'','Reviewed file delivery must not leave a false failure on the next draft');
    await poll(page,async path=>JSON.parse(await directoryFile(path)).slate.todos[0].mutation==='外部记录',path);
    assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].mutation),'外部记录');
    const other={schema:'koma.bridge.slate.v1',slate:{id:'external-new',title:'外部清单',version:1,golden_recipe:null,todos:[{id:'outside-todo',title:'新任务',status:'todo',image_required:false,description:'',requirements:'',mutation:'',bonus:false,binding:null}]}};
    await page.evaluate(value=>directoryFile('slates/external.slate.json',JSON.stringify(value)),other);
    await page.waitForFunction(()=>ask.draftPlan.value?.title.startsWith('审阅任务文件'));await apply(page);
    await poll(page,async()=>{const doc=JSON.parse(await directoryFile('slates/external.slate.json'));return doc.slate.id!=='external-new'&&doc.slate.title==='外部清单';});
    assert.equal(await page.evaluate(()=>bridge.slateMappings.value.length),2,'Reviewed external creation must reuse its original file mapping');
    assert.equal(await page.evaluate(async()=>{try{await directoryFile(`slates/${slate.snapshot().id}.slate.json`);return true}catch{return false}}),false,'Do not export a duplicate task file');
    assert.equal(await page.evaluate(()=>slate.list.value.length),2);
    await page.evaluate(()=>bridge.unmount());await page.reload();await bind(page);assert.equal(await page.evaluate(()=>slate.list.value.length),2);assert.equal(await page.evaluate(()=>bridge.phase.value),'off');assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 failed persistence compensates board; interrupted journal recovers and directory-required failures never apply half',async()=>{
  const {page,context,errors}=await setup();
  try {
    const s=await createSlate(page),before=await page.evaluate(()=>drawing.snapshot().form.prompt);
    await receive(page,draft('atomic-failure',[editSlate(s,[{op:'update',id:s.todos[0].id,status:'done'}]),patch(', atomic') ]));
    await page.evaluate(()=>{
      window.originalPut=IDBObjectStore.prototype.put;window.failSlate=true;
      IDBObjectStore.prototype.put=function(value,...args){if(this.transaction.db.name==='koma-slate'&&this.name==='state'&&args[0]==='workspace'&&!value.journal&&window.failSlate){window.failSlate=false;throw new DOMException('synthetic quota','QuotaExceededError');}return originalPut.call(this,value,...args);};
    });
    await apply(page);assert.equal(await page.evaluate(()=>drawing.snapshot().form.prompt),before);assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].status),'todo');assert.ok(await page.evaluate(()=>ask.draftPlan.value));
    await page.evaluate(()=>{IDBObjectStore.prototype.put=originalPut;});await apply(page);assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].status),'done');
    // Simulate process termination after the board persisted, before the local Slate commit.
    await page.evaluate(async()=>{
      const s=slate.snapshot(),id=drawing.snapshot().activeBoardId,old=drawing.snapshot().form.prompt;
      await drawing.writeDraft({prompt:old+', interrupted'},{prompt:old},id);
      await services.data.write(async()=>{const tx=services.databases.transaction('koma-slate','state','readwrite'),store=tx.objectStore('state');const state=await new Promise((r,j)=>{const q=store.get('workspace');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});state.journal={id:'interrupted',change:{id:s.id,before:s,after:{...s,title:'never committed'},bindings:[],directoryRequired:false},board:{id,before:{prompt:old},after:{prompt:old+', interrupted'}}};store.put(state,'workspace');await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=()=>j(tx.error);});});
    });
    await page.reload();await bind(page);assert.doesNotMatch(await page.evaluate(()=>drawing.snapshot().form.prompt),/interrupted/);assert.equal(await page.evaluate(()=>slate.recovery.value),false);
    const now=await page.evaluate(()=>slate.snapshot());await receive(page,draft('required-no-mount',[editSlate(now,[{op:'update',id:now.todos[0].id,mutation:'not delivered'}],{directory_required:true}),patch(', no directory')]));
    assert.equal(await page.evaluate(()=>bridge.receipt.value.status),'invalid');assert.match(await page.evaluate(()=>bridge.receipt.value.error),/目录/);assert.equal(await page.evaluate(()=>ask.draftPlan.value),null);assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].mutation),'');assert.doesNotMatch(await page.evaluate(()=>drawing.snapshot().form.prompt),/no directory/);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test(`B3 openai-chat-v1: ASK reads frozen Slate details and proposes compound advancement through the shared card`,async()=>{
  const protocol = "openai-chat-v1";
  const calls=[];let script=[];
  const {page,context,errors}=await setup({llm:true,directory:false,protocol,respond(body){calls.push(body);const [name,input]=script.shift()??[null,{}];return refResponse(protocol,name,input,'已整理下一步，等待你确认。');}});
  try {
    const s=await createSlate(page);
    const base=await page.evaluate(async()=>{const {stateHash}=await import('/src/ask/draft/validate.ts');return stateHash(ask.externalSnapshot().base);});
    script=[['get_state',{include_slate:true}],['propose_draft',{draft_title:'推进下一图',base_hash:base,steps:[editSlate(s,[{op:'update',id:s.todos[0].id,status:'done',mutation:'保留空白'},{op:'add',id:s.todos[0].id,todo_title:'第二张',bonus:true,image_required:false}]),patch(', next composition')]}],[null,{}]];
    await page.evaluate(()=>{ask.show();ask.setInput('完成第一项并准备下一张');void ask.send();});
    await page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
    assert.match(JSON.stringify(calls[0].messages),/active_slate/);assert.match(JSON.stringify(calls[1].messages),/golden_recipe/);assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].status),'todo');
    assert.equal(await page.evaluate(()=>bridge.supported),false);assert.equal(await page.locator('.ask-tool[data-state="error"]').count(),0);
    await apply(page);assert.equal(await page.evaluate(()=>slate.snapshot().todos[1].bonus),true);assert.notEqual(await page.evaluate(()=>slate.snapshot().todos[1].id),s.todos[0].id);assert.match(await page.evaluate(()=>drawing.snapshot().form.prompt),/next composition/);
    await page.evaluate(()=>ask.undoDraft());assert.equal(await page.evaluate(()=>slate.snapshot().todos.length),1);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 directory partial writes resume by verified bytes, foreign assets stay untouched, new tasks map and existing tasks opt in',async()=>{
  const {page,context,errors}=await setup();
  try {
    const old=await createSlate(page,'尚未映射的旧清单'),s=await createSlate(page);await page.evaluate(()=>bridge.mount());await page.evaluate(id=>bridge.mapSlate(id),s.id);const image=await addSlateImage(page);
    await page.evaluate(()=>{window.originalWritable=FileSystemFileHandle.prototype.createWritable;window.failReceipt=true;window.imageWrites=0;FileSystemFileHandle.prototype.createWritable=function(...args){if(this.name.endsWith('.png'))window.imageWrites++;if(this.name.endsWith('.png.json')&&window.failReceipt)throw new DOMException('synthetic receipt failure','NotAllowedError');return originalWritable.apply(this,args);};});
    await receive(page,draft('partial-delivery',[editSlate(s,[{op:'update',id:s.todos[0].id,status:'done',image_required:true,bind:{source:image.label,caption_source:'base',caption_mode:'full'}}])],{picture_scope_id:image.scope}));await apply(page);
    assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].status),'done');assert.equal(await page.evaluate(()=>bridge.slateMappings.value[0].status),'error');assert.match(await page.evaluate(()=>slate.error.value),/本机已保存/);
    await page.evaluate(()=>{window.failReceipt=false;});await page.waitForFunction(()=>bridge.slateMappings.value[0].status==='synced');assert.equal(await page.evaluate(()=>imageWrites),1,'resuming receipts must not rewrite original bytes');
    const current=await page.evaluate(()=>slate.snapshot()),target=current.todos[0].binding.target_path;
    await page.evaluate(path=>directoryFile(path,'FOREIGN EDIT'),target);
    const after=await page.evaluate(()=>slate.snapshot());await receive(page,draft('foreign-asset',[editSlate(after,[{op:'update',id:after.todos[0].id,mutation:'must wait'}],{directory_required:true}),patch(', blocked delivery')]));await apply(page);
    assert.equal(await page.evaluate(()=>slate.snapshot().todos[0].mutation),'');assert.equal(await page.evaluate(path=>directoryFile(path),target),'FOREIGN EDIT');assert.doesNotMatch(await page.evaluate(()=>drawing.snapshot().form.prompt),/blocked delivery/);await page.evaluate(()=>ask.ignoreDraft());
    await page.evaluate(()=>{FileSystemFileHandle.prototype.createWritable=originalWritable;});
    const second=await createSlate(page,'本机第二清单');assert.equal(await page.evaluate(id=>bridge.slateMappings.value.some(m=>m.id===id),second.id),true);
    assert.equal(JSON.parse(await page.evaluate(id=>directoryFile(`slates/${id}.slate.json`),second.id)).slate.title,'本机第二清单');
    await page.evaluate(id=>ask.openSlate(id),old.id);assert.equal(await page.evaluate(()=>slate.activeId.value),old.id);
    assert.equal(await page.evaluate(id=>bridge.slateMappings.value.some(m=>m.id===id),old.id),false);
    await page.getByRole('button',{name:'打开任务总览',exact:true}).click();await page.getByRole('button',{name:'任务总览选项',exact:true}).click();
    await page.getByRole('menuitem',{name:'同步到当前目录',exact:true}).click();await page.waitForFunction(id=>bridge.slateMappings.value.some(m=>m.id===id),old.id);
    await page.getByRole('button',{name:'关闭任务总览',exact:true}).click();
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 concurrent pages reject stale task versions, monotonic undo versions and asset ownership survives until undo eviction',async()=>{
  const {page,context,errors}=await setup();
  try {
    let s=await createSlate(page);const image=await addSlateImage(page);
    await receive(page,draft('owned-binding',[editSlate(s,[{op:'update',id:s.todos[0].id,status:'done',image_required:true,bind:{source:image.label,caption_source:'base',caption_mode:'full'}}])],{picture_scope_id:image.scope}));await apply(page);
    s=await page.evaluate(()=>slate.snapshot());const asset=s.todos[0].binding.assetId;
    await page.evaluate(()=>ask.undoDraft());await page.evaluate(()=>slate.cleanAssets());assert.equal(await page.evaluate(async id=>!!await slate.asset(id),asset),true);
    const peer=await context.newPage();await peer.goto(origin+'/#/image');await bind(peer);
    const stale=await peer.evaluate(()=>slate.snapshot());
    await page.evaluate(async()=>{const s=slate.snapshot();await slate.commit({id:s.id,before:s,after:{...s,title:'来自另一页'},bindings:[],directoryRequired:false});});
    const conflict=await peer.evaluate(async stale=>{try{await slate.commit({id:stale.id,before:stale,after:{...stale,title:'过期提交'},bindings:[],directoryRequired:false});return ''}catch(e){return e.message}},stale);
    assert.match(conflict,/变化/);await peer.close();
    // Explicit local deletion, followed by a new shared create/undo, must not reuse an earlier version.
    const version=await page.evaluate(()=>slate.snapshot().version);const latest=await page.evaluate(()=>slate.snapshot());await receive(page,draft('delete-slate',[{kind:'slate_edit',op:'delete',slate_id:latest.id,expected_version:latest.version}]));await apply(page);await page.evaluate(()=>ask.undoDraft());assert.ok(await page.evaluate(()=>slate.snapshot().version)>version);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('B3 task capability works without any configured connection, key or directory API',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:900}}),errors=[],requests=[];
  await context.addInitScript(()=>{window.showDirectoryPicker=undefined;localStorage.setItem('koma.prefs.v1',JSON.stringify({tagSuggest:false}));});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();requests.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  try {
    await page.goto(origin+'/#/image');await bind(page);
    assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.evaluate(()=>drawing.snapshot().models.length),0);const s=await createSlate(page,'无配置任务');assert.equal(s.title,'无配置任务');assert.equal(await page.evaluate(()=>ask.ready.value),'connection');
    await page.getByRole('button',{name:'打开菜单',exact:true}).click();
    await page.getByRole('button',{name:'打开任务总览',exact:true}).click();assert.match(await page.locator('.slate-panel').textContent(),/无配置任务/);await page.getByRole('button',{name:'关闭任务总览',exact:true}).click();
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
