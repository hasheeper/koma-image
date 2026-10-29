import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from './helpers/vite.mjs';
import { chromium } from 'playwright';
import { createArchive } from '../src/storage/backup-archive.ts';
let server,browser,origin;
before(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0,open:false,hmr:false}});await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
async function setup(t,{official=true,two=false,credits=1000,secondCredits=1000}={}) {
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>context.close());
  const page=await context.newPage(),posts=[],errors=[],control={credits,secondCredits,delay:null,status:200,bad:false};page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({official,two})=>{
    if(!/^https?:/.test(location.protocol))return;
    const connection=(id,profileId,baseUrl)=>({id,name:'模拟 '+id,profileId,baseUrl,credentialRef:id+'-key',revision:'r1'});
    localStorage.setItem('koma.routing.v1',JSON.stringify({version:1,connections:{gateway:connection('gateway','koma-standard-v1','https://gateway.example.test'),...(official?{nai:connection('nai','nai-official-v1','https://image.novelai.net')}:{}),...(two?{second:connection('second','nai-official-v1','https://image.novelai.net')}: {})},order:['gateway','nai','second'].filter(id=>id==='gateway'||official&&id==='nai'||two&&id==='second'),links:{}}));
    sessionStorage.setItem('koma.session.keys',JSON.stringify({'gateway-key':'synthetic-gateway-only','nai-key':'synthetic-nai-only','second-key':'synthetic-second-only'}));
  },{official,two});
  await context.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url());if(u.origin===origin)return r.continue();
    if(u.hostname==='image.novelai.net'&&u.pathname==='/user/subscription')return r.fulfill({json:{active:true,tier:3,usage:{percent:0,purchasedPercent:0,isNegative:true},trainingStepsLeft:{fixedTrainingStepsLeft:req.headers().authorization?.includes('second')?control.secondCredits:control.credits,purchasedTrainingSteps:0}}});
    if(u.hostname==='gateway.example.test'){
      if(u.pathname.endsWith('/image/models'))return r.fulfill({json:{studio_features:{version:2,max_cost:true},models:{'nai-diffusion-5-full':{provider:'novelai',operations:['generate','edit'],tools:['img2img','inpaint','upscale']}}}});
      if(u.pathname.endsWith('/media/quota'))return r.fulfill({json:{credits:{remaining:1000}}});
      if(u.pathname.endsWith('/token_stats_data'))return r.fulfill({json:{}});
      if(u.pathname.endsWith('/estimate'))return r.fulfill({json:{cost:0}});
    }
    if(req.method()==='POST'&&u.hostname==='image.novelai.net'&&u.pathname==='/ai/augment-image'){
      const body=req.postDataJSON();posts.push({body,headers:req.headers()});
      if(control.delay)await control.delay;
      if(control.status!==200)return r.fulfill({status:control.status,json:{error:'Synthetic Director failure'}}).catch(()=>{});
      const data=await page.evaluate(async ({width,height,background})=>{
        const c=new OffscreenCanvas(width,height),x=c.getContext('2d');
        if(!background){x.fillStyle='#685096';x.fillRect(0,0,width,height);}
        x.fillStyle='#b3a1ff';x.fillRect(50,50,width/2,height/2);
        const b=await c.convertToBlob({type:'image/png'});return [...new Uint8Array(await b.arrayBuffer())];
      },{width:body.width,height:body.height,background:body.req_type==='bg-removal'}).catch(()=>[]);
      const blob=new Blob([Uint8Array.from(data)],{type:'image/png'});
      // Deliberately shuffled directory order, as an interoperability regression.
      const members=body.req_type==='bg-removal'&&!control.bad?[['image_2.png',blob],['image_0.png',blob],['image_1.png',blob]]:[['image_0.png',blob]];
      const zip=Buffer.from(await(await createArchive(members)).arrayBuffer());
      return r.fulfill({contentType:'application/zip',body:zip}).catch(()=>{});
    }
    errors.push('Unexpected external request: '+u.hostname+u.pathname);return r.abort();
  });
  await page.goto(origin+'/#/edit');await page.waitForSelector('#imageEditor');
  await page.evaluate(async()=>{
    const p=document.body.__vue_app__._instance.provides,a=document.body.__vue_app__._context.provides;
    for(const name of ['editor','drawing','ui','app-shell'])window[name.replace('-','_')]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===name)];
    window.services=a[Object.getOwnPropertySymbols(a).find(k=>k.description==='application-services')];
    window.makeImage=async(w=832,h=1216)=>{const c=new OffscreenCanvas(w,h),x=c.getContext('2d');x.fillStyle='#375460';x.fillRect(0,0,w,h);return c.convertToBlob({type:'image/png'});};
    await editor.open('image',await makeImage(),'synthetic.png',{settings:{model:'nai-diffusion-5-full',basePrompt:'original artist, landscape',seed:7,cfgRescale:.4},sourceId:'history:source'});
    window.owner=editor.session.id;
  });
  await page.waitForFunction(()=>!!editor.snapshot().model);
  return {page,posts,errors,control};
}
test("confirmed icon toolbar and strip panel with keyboard choices and unified upscale type", {timeout:60000}, async t=>{
  const {page,errors}=await setup(t);
  {
      const width = 1440;
    await page.setViewportSize({width,height:900});
    await page.locator('#editorDirector').click();
    const panel=page.locator('#editorDirectorPanel');await panel.waitFor({state:'visible'});
    for(const name of ['去背景','上色','表情']){
      await panel.getByRole('radio',{name,exact:true}).click();
      await page.mouse.move(0,0);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    await panel.locator('.editor-mini-chip[aria-label="表情"]').click();await page.locator('#editorDirectorChoices').getByRole('menuitemradio',{name:'俏皮',exact:true}).click();
    assert.equal(await page.evaluate(()=>editor.session.director.emotion.emotion),'playful');
    await page.keyboard.press('Escape');await page.locator('#editorUpscale').click();await page.locator('#editorUpscalePop').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
  }
  // Keeping an intrinsic-width panel open must also follow subsequent layout changes.
  await page.locator('#editorDirector').click();
  await page.locator('#editorDirectorPanel').getByRole('radio',{name:'去背景',exact:true}).click();
  {
      const width = 1440;
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
});
test('six API operations preserve source recipe; BG variants are grouped, alpha-safe and never submit on switching', {timeout:60000}, async t=>{
  const {page,posts,errors}=await setup(t);
  for(const tool of ['bg-removal','lineart','sketch','colorize','emotion','declutter']){
    await page.evaluate(async tool=>{editor.setDirectorTool(tool);if(tool==='colorize'||tool==='emotion')editor.patchDirector({prompt:'blue eyes',defry:4,emotion:'happy'});await editor.runDirector();},tool);
    const sent=posts.at(-1);assert.equal(sent.body.req_type,tool);assert.match(sent.headers.authorization,/nai-only/);
    for(const key of ['model','seed','scale','cfg','cfg_rescale','mask','max_cost','negative_prompt','characters'])assert.equal(sent.body[key],undefined);
    if(tool==='emotion'){assert.equal(sent.body.prompt,'happy;;blue eyes');assert.equal(sent.body.defry,4);}
  }
  assert.equal(posts.length,6);
  assert.deepEqual(await page.evaluate(()=>[editor.session.viewId,editor.session.baseId]),[1,1]);
  assert.equal(await page.locator('.editor-rail .tile').count(),7);
  assert.equal(await page.evaluate(()=>editor.session.versions.length),9);
  await page.locator('.editor-rail .tile').filter({has:page.locator('.director-badge use[href$="i-dt-background"]')}).click();
  const variants=page.getByRole('radiogroup',{name:'去背景结果',exact:true});
  for(const label of ['抠图','重建','混合']){await variants.locator('label').filter({hasText:label}).click();assert.equal(posts.length,6);}
  assert.deepEqual(await page.evaluate(()=>editor.session.versions.slice(1,4).map(v=>editor.label(v))),['#e2a','#e2b','#e2c']);
  assert.deepEqual(await page.evaluate(()=>editor.session.versions.slice(4).map(v=>editor.label(v))),['#e3','#e4','#e5','#e6','#e7']);
  const values=await page.evaluate(async()=>{
    const v=editor.snapshot().viewed,b=await createImageBitmap(v.blob),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);b.close();
    const {sourceRecipe}=await import('/src/domain/image-parameters.ts');
    return {variant:v.director.variant,alpha:x.getImageData(0,0,1,1).data[3],seed:v.params.seed,recipe:sourceRecipe(v.params),history:drawing.snapshot().history.length};
  });
  assert.equal(values.variant,'blend');assert.equal(values.alpha,0);assert.equal(values.seed,undefined);assert.equal(values.recipe.basePrompt,'original artist, landscape');assert.equal(values.recipe.seed,7);assert.equal(values.history,0);
  const urls=await page.evaluate(()=>{
    const group=editor.snapshot().viewed.director.group,urls=editor.session.versions.filter(v=>v.director?.group===group).map(v=>v.url);
    window.revoked=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=u=>{revoked.push(u);revoke(u);};editor.remove(editor.session.viewId);return urls;
  });
  assert.equal(await page.evaluate(urls=>urls.every(u=>revoked.includes(u)),urls),true);assert.equal(await page.locator('.editor-rail .tile').count(),6);
  assert.deepEqual(errors,[]);
});
test('EDIT retention counts physical images and preserves complete protected Director groups', {timeout:45000}, async t=>{
  const {page,posts,errors}=await setup(t);
  await page.evaluate(async()=>{
    await drawing.patch({editorHistoryLimit:0});
    editor.setDirectorTool('bg-removal');
    await editor.runDirector(); await editor.runDirector();
    window.firstGroup=editor.session.versions.slice(1,4).map(v=>v.id);
    window.secondGroup=editor.session.versions.slice(4).map(v=>v.id);
    editor.view(firstGroup[1]);
    await drawing.patch({editorHistoryLimit:4});
  });
  assert.equal(await page.evaluate(()=>editor.session.versions.length),7,'original, viewed group and newest result group stay intact');
  await page.evaluate(async()=>{
    editor.view(secondGroup[1]);
    await drawing.patch({editorHistoryLimit:3});
  });
  assert.deepEqual(await page.evaluate(()=>editor.session.versions.map(v=>v.id)),[1,5,6,7],'old group is removed as a unit; protected images can exceed a smaller target');
  assert.deepEqual(await page.evaluate(()=>editor.session.versions.slice(1).map(v=>editor.label(v))),['#e3a','#e3b','#e3c']);
  assert.equal(posts.length,2); assert.deepEqual(errors,[]);
});
test('Director output stays with its frozen board and source while another board is active', {timeout:45000}, async t=>{
  const {page,posts,errors,control}=await setup(t);let release;control.delay=new Promise(r=>release=r);
  await page.evaluate(()=>{editor.setDirectorTool('emotion');window.run=editor.runDirector();});await page.waitForFunction(()=>editor.snapshot().busy);
  await page.evaluate(async()=>{await editor.open('edit',await makeImage(513,777),'second.png',{sourceId:'history:second'});window.second=editor.session.id;});
  assert.notEqual(await page.evaluate(()=>editor.session.id),await page.evaluate(()=>owner));
  release();await page.evaluate(()=>window.run);
  assert.deepEqual(await page.evaluate(()=>[editor.session.id===second,editor.board(owner).versions.length,editor.session.versions.length,editor.board(owner).viewId]),[true,2,1,1]);
  await page.evaluate(async()=>{editor.setDirectorTool('lineart');await editor.runDirector();});
  assert.equal(posts.length,2);assert.ok(posts[1].body.width%64!==0||posts[1].body.height%64!==0);
  assert.equal(await page.evaluate(()=>editor.session.error),'');assert.deepEqual(errors,[]);
});
test('malformed result sets, errors and cancellation never partially commit or auto retry', {timeout:45000},async t=>{
  const {page,posts,control,errors}=await setup(t);
  control.bad=true;await page.evaluate(()=>editor.runDirector());assert.equal(await page.evaluate(()=>editor.session.versions.length),1);assert.match(await page.evaluate(()=>editor.session.error),/数量不符/);
  control.bad=false;control.status=500;await page.evaluate(()=>editor.runDirector());assert.match(await page.evaluate(()=>editor.session.error),/Synthetic Director failure/);assert.equal(posts.length,2);
  control.status=200;let release;control.delay=new Promise(r=>release=r);
  await page.evaluate(()=>{window.run=editor.runDirector();});await page.waitForFunction(()=>editor.snapshot().busy);
  await page.evaluate(()=>editor.cancel());await page.evaluate(()=>window.run);release();
  assert.equal(await page.evaluate(()=>editor.session.versions.length),1);assert.match(await page.evaluate(()=>editor.session.error),/停止等待/);assert.ok(posts.length<=3);
  assert.deepEqual(errors,[]);
});
test('insufficient Anlas advances only to another official source; gateways and V5 quota do not cover BG cost', {timeout:45000},async t=>{
  const {page,posts,control,errors}=await setup(t,{two:true,credits:0});
  await page.locator('#editorDirector').click();
  await page.waitForFunction(()=>editor.snapshot().director.quote?.cost===65&&editor.snapshot().accountModel.connection==='second');
  assert.equal(await page.locator('#imageEditor #meters').getAttribute('data-connection'),'second');
  assert.equal(await page.locator('#imageEditor .w-nai').count(),0);
  assert.match(await page.locator('#imageEditor .w-tier').innerText(),/Opus/);
  await page.evaluate(()=>editor.runDirector());assert.equal(posts.length,1);assert.match(posts[0].headers.authorization,/second-only/);
  control.secondCredits=0;await page.evaluate(()=>editor.runDirector());assert.equal(posts.length,1);assert.match(await page.evaluate(()=>editor.session.error),/额度均不足/);
  // Non-BG remains eligible under the independently assessed V3 subscription.
  await page.evaluate(async()=>{editor.setDirectorTool('lineart');await editor.runDirector();});assert.equal(posts.length,2);assert.match(posts[1].headers.authorization,/nai-only/);
  assert.deepEqual(errors,[]);
});
test('a standard gateway alone cannot expose or execute an undeclared Director protocol',async t=>{
  const {page,posts,errors}=await setup(t,{official:false});await page.locator('#editorDirector').click();
  assert.match(await page.locator('#editorDirectorPanel').innerText(),/请先配置 NovelAI 官方连接/);assert.equal(await page.locator('#editorDirectorRun').isEnabled(),false);
  await page.evaluate(()=>editor.runDirector());assert.equal(posts.length,0);assert.deepEqual(errors,[]);
});
