import { before, after, test } from 'node:test';
import {photopeaProject} from './helpers/photopea-project.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
let server,browser,origin;
before(async()=>{await mkdir('.local/pe2',{recursive:true});server=await createServer({server:{host:'127.0.0.1',port:0,open:false,hmr:false}});await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
const stub=String.raw`<!doctype html><html lang="zh"><body style="margin:0;background:#282828;color:#ccc">Photopea test double<button id="right-control" style="position:absolute;right:8px;top:48px">Properties</button><script>
const config=JSON.parse(decodeURIComponent(location.hash.slice(1))),session=JSON.parse(config.environment.customIO.save.match(/koma:("[^"]+")/)[1]);
let image,mask,source,incoming,width=256,height=384;
window.save=()=>parent.postMessage(JSON.stringify({koma:session,event:'save',source}),'*');
window.delay=0;window.fail='';window.resizeWidths=[];addEventListener('resize',()=>resizeWidths.push(innerWidth));
async function blank(white=false){const c=new OffscreenCanvas(width,height),x=c.getContext('2d');if(white){x.fillStyle='white';x.fillRect(0,0,width,height);}return (await c.convertToBlob({type:'image/png'})).arrayBuffer();}
addEventListener('message',async e=>{
 const send=data=>parent.postMessage(data,e.origin);
 if(e.data instanceof ArrayBuffer){incoming=e.data;send('done');return;}
 if(typeof e.data!=='string')return;
 const command=Number(e.data.match(/command:(\d+)/)?.[1]);
 const reply=(event,detail)=>send(JSON.stringify({koma:session,command,event,detail}));reply('start');
 if(e.data.includes('while(app.documents.length)')){image=mask=undefined;source=undefined;}
 const match=e.data.match(/d.source=("[^"]+")/);if(match)source=JSON.parse(match[1]);
 if(e.data.includes('var base=d.activeLayer')){image=incoming;const b=await createImageBitmap(new Blob([image],{type:'image/png'}));width=b.width;height=b.height;b.close();}
 if(e.data.includes('next.move(base'))image=incoming;
 if(e.data.includes('var name=mask.name'))mask=e.data.includes('if(!incoming)')?incoming:undefined;
 if(e.data.includes('reply("state"'))reply('state',{baseId:1,scratchId:2,maskId:3,carrierId:4,layers:[3,2,1,4],visible:[2,1],width,height,selection:null,maskIndex:0,carrierIndex:3});
 if(e.data.includes('reply("project")')){reply('document',source);reply('project');send(__PROJECT__);}
 if(e.data.includes('reply("image")')){
   if(delay)await new Promise(r=>setTimeout(r,delay));if(fail){reply('error',fail);send('done');return;}
   reply('document',source);reply('image');send(image.slice(0));reply('selection');send(await blank());reply('mask');send(mask?.slice(0)||await blank());reply('carrier');send(await blank(true));
 }
 reply('complete');send('done');
});parent.postMessage('done','*');
</script></body></html>`.replace('__PROJECT__',`(${photopeaProject.toString()})()`);
async function setup(t){
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],network=[];
 t.after(()=>context.close());page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{window.messageListeners=new Set();window.leaveListeners=new Set();const add=window.addEventListener,remove=window.removeEventListener;window.addEventListener=function(type,fn,...args){if(type==='message')messageListeners.add(fn);if(type==='beforeunload')leaveListeners.add(fn);return add.call(this,type,fn,...args)};window.removeEventListener=function(type,fn,...args){if(type==='message')messageListeners.delete(fn);if(type==='beforeunload')leaveListeners.delete(fn);return remove.call(this,type,fn,...args)};});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();network.push(url.origin);if(url.origin==='https://www.photopea.com')return route.fulfill({contentType:'text/html',body:stub});return route.abort();});
 await page.goto(origin + "/#/image");await page.waitForSelector('#prompt',{state:'attached'});
 await page.evaluate(async()=>{const p=document.body.__vue_app__._instance.provides;for(const n of ['editor','drawing'])window[n]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===n)];const c=new OffscreenCanvas(256,384),x=c.getContext('2d');x.fillStyle='#bbaa33';x.fillRect(0,0,256,384);window.input=await c.convertToBlob({type:'image/png'});await editor.open('image',input,'synthetic.png');});
 return {page,errors,network};
}
async function open(page){await page.locator('#editorPhotopea').click();await page.waitForFunction(()=>document.querySelector('.photopea-panel')&&!document.querySelector('.photopea-loading')&&!document.querySelector('.photopea-status'));}
async function settled(page){
 const child=page.frames().find(f=>f.url().startsWith('https://www.photopea.com')),full=await page.locator('.photopea-frame').evaluate(e=>e.clientWidth);
 await child.waitForFunction(width=>resizeWidths.some((x,i)=>x===width-1&&resizeWidths[i+1]===width),full,{timeout:5000});
 await page.waitForFunction(()=>!document.querySelector('.photopea-frame iframe').style.width);
}

test('Photopea settled open resizes the retained child viewport by 1px and restores full width; hidden visits cancel pending reflow',async t=>{
 const {page,errors,network}=await setup(t);
 await open(page);
 const child=page.frames().find(f=>f.url().startsWith('https://www.photopea.com'));
 await page.evaluate(()=>{window.retainedFrame=document.querySelector('.photopea-frame iframe');window.retainedWindow=retainedFrame.contentWindow;window.retainedUrl=retainedFrame.src;});
 const full=await page.locator('.photopea-frame').evaluate(e=>e.clientWidth);
 for(let visit=0;visit<3;visit++){
  if(visit){await open(page);}
  await child.waitForFunction(width=>resizeWidths.some((x,i)=>x===width-1&&resizeWidths[i+1]===width),full,{timeout:5000}).catch(async error=>{throw new Error(`${error.message}; visit=${visit}; full=${full}; widths=${await child.evaluate(()=>JSON.stringify(resizeWidths))}`);});
  assert.equal(await page.locator('.photopea-frame iframe').evaluate(e=>e.style.width),'');
  assert.equal(await page.locator('.photopea-frame iframe').evaluate(e=>e.getBoundingClientRect().width),full);
  assert.equal(await page.evaluate(()=>retainedFrame===document.querySelector('.photopea-frame iframe')&&retainedWindow===retainedFrame.contentWindow&&retainedFrame.src===retainedUrl),true);
  await child.evaluate(()=>resizeWidths.length=0);
  await page.getByRole('button',{name:'返回 EDIT',exact:true}).click();await page.getByRole('button',{name:'暂不应用',exact:true}).click();await page.waitForSelector('.photopea-panel',{state:'hidden'});
 }
 // Closing synchronously after done prevents the delayed nudge from touching a hidden frame.
 await open(page);await child.evaluate(()=>resizeWidths.length=0);
 await page.evaluate(()=>editor.cancelExternalEdit(editor.snapshot().externalId, true));
 await page.waitForSelector('.photopea-panel',{state:'hidden'});await page.waitForTimeout(220);
 assert.equal(await page.locator('.photopea-frame iframe').evaluate(e=>e.style.width),'');
 assert.equal(await child.evaluate(width=>resizeWidths.includes(width-1),full),false);
 assert.deepEqual(errors,[]);assert.deepEqual(network,['https://www.photopea.com']);
});

test('Photopea iframe is lazy, retained across visits, fully visible at four widths and suspends active listeners',async t=>{
 const {page,errors,network}=await setup(t);assert.deepEqual(network,[]);const listeners=await page.evaluate(()=>messageListeners.size),leaves=await page.evaluate(()=>leaveListeners.size);
 const leaveBaseline=await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await open(page);await settled(page);
  await page.waitForFunction(()=>document.activeElement?.tagName==='IFRAME');
  assert.equal(await page.getByRole('button',{name:/展开顶栏|折叠顶栏/}).count(),0);
  assert.equal(await page.locator('.photopea-bar').evaluate(e=>e.getBoundingClientRect().height),30);
  assert.equal(await page.evaluate(()=>leaveListeners.size),leaves+1);
  assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),true);
  await page.locator('.photopea-choice').focus();await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitemradio');
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await page.locator('.photopea-choice').getAttribute('aria-label'),'回传方式：仅蒙版');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('Escape');
  assert.equal(await page.locator('.photopea-choice').getAttribute('aria-expanded'),'false');
  const box=await page.locator('.photopea-panel').boundingBox(),frame=await page.locator('.photopea-frame iframe').boundingBox();
  assert.ok(box.width>=width-2);assert.ok(frame.height>=840);assert.ok(frame.width>=width-2);
  const crop=await page.locator('.photopea-frame').evaluate(e=>{const box=e.getBoundingClientRect(),f=e.querySelector('iframe').getBoundingClientRect();return {width:e.clientWidth,overflow:getComputedStyle(e).overflow,frame:f.width,left:f.left-box.left,top:f.top-box.top};});
  assert.equal(crop.overflow,'clip');assert.equal(crop.frame-crop.width,0);
  assert.equal(crop.left,0);assert.equal(crop.top,0);
  const dimensions=await page.evaluate(()=>({vw:innerWidth,scroll:document.querySelector('.photopea-bar').scrollWidth,width:document.querySelector('.photopea-bar').clientWidth,hidden:document.querySelector('.editor-shell').hidden,inert:document.querySelector('.editor-shell').inert}));
  assert.ok(dimensions.scroll<=dimensions.width);assert.equal(dimensions.hidden,true);assert.equal(dimensions.inert,true);
  const embedded=page.frames().find(f=>f.url().startsWith('https://www.photopea.com'));
  await embedded.evaluate(()=>window.editMarker='unchanged');
  const overflow=await page.locator('.photopea-bar').evaluate(e=>e.scrollWidth>e.clientWidth);assert.equal(overflow,false);
  await page.locator('.photopea-choice').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('.photopea-choice').getAttribute('aria-expanded'),'false');
  await page.screenshot({path:`.local/pe2/panel-compact-${width}.png`});
  assert.equal(await embedded.evaluate(()=>window.editMarker),'unchanged');
  await page.evaluate(()=>{window.retainedFrame??=document.querySelector('.photopea-frame iframe');window.retainedWindow??=retainedFrame.contentWindow;});
  assert.equal(await page.evaluate(()=>retainedFrame===document.querySelector('.photopea-frame iframe')&&retainedWindow===retainedFrame.contentWindow),true);
  await page.getByRole('button',{name:'返回 EDIT',exact:true}).click();await page.getByRole('button',{name:'暂不应用',exact:true}).click();await page.waitForSelector('.photopea-panel',{state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.id==='editorPhotopea');assert.equal(await page.evaluate(()=>messageListeners.size),listeners+1);
  assert.equal(await page.evaluate(()=>leaveListeners.size),leaves);
  assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),leaveBaseline);
  await embedded.evaluate(()=>save());await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);
 }
 assert.equal(await page.evaluate(()=>editor.session.versions.length),1);assert.deepEqual(errors,[]);assert.deepEqual(network,['https://www.photopea.com']);
});

test('PE2 unchanged auto return creates no manual result or history',async t=>{
 const {page,errors,network}=await setup(t);await open(page);
 assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);
 assert.equal(await page.getByRole('button',{name:/展开顶栏|折叠顶栏/}).count(),0);
 await page.getByRole('button',{name:'应用并返回',exact:true}).click();await page.waitForSelector('.photopea-panel',{state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>[editor.session.versions.length,drawing.snapshot().history.length,editor.snapshot().base.kind]),[1,0,'source']);
 assert.deepEqual(errors,[]);assert.ok(network.every(n=>n==='https://www.photopea.com'));
});

test('Photopea focus inside the extended iframe cannot scroll away the left toolbar',async t=>{
 const {page,errors}=await setup(t);await open(page);
 await settled(page);
 // Stress the clipping boundary with an oversized embed to retain the original regression.
 await page.locator('.photopea-frame iframe').evaluate(e=>e.style.width='calc(100% + 320px)');
 const embedded=page.frames().find(f=>f.url().startsWith('https://www.photopea.com'));
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});
  // Focus a control at Photopea's far right, as keyboard navigation or internal menus do.
  await embedded.locator('#right-control').focus();
  const position=await page.locator('.photopea-frame').evaluate(e=>({scroll:e.scrollLeft,left:e.querySelector('iframe').getBoundingClientRect().left-e.getBoundingClientRect().left}));
  assert.deepEqual(position,{scroll:0,left:0},`left edge after in-frame focus at ${width}px`);
  await page.locator('.photopea-choice').click();await page.keyboard.press('Escape');
 }
 assert.deepEqual(errors,[]);
});

test('PE2 cancel an in-flight export and switch source: late reply never enters another session',async t=>{
 const {page,errors}=await setup(t);await open(page);const frame=page.frames().find(f=>f.url().startsWith('https://www.photopea.com'));await frame.evaluate(()=>window.delay=500);
 await page.getByRole('button',{name:'应用并返回',exact:true}).click();
 assert.equal(await page.locator('.photopea-frame iframe').getAttribute('inert'),'');
 await page.getByRole('button',{name:'返回 EDIT',exact:true}).click();await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);await page.getByRole('button',{name:'暂不应用',exact:true}).click();
 await page.waitForSelector('.photopea-panel',{state:'hidden'});await page.waitForTimeout(600);
 assert.equal(await page.evaluate(()=>editor.session.versions.length),1);assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);
 await open(page);await page.evaluate(()=>editor.open('image',input,'other.png'));
 assert.equal(await page.locator('.photopea-panel').isVisible(),true,'an active external transaction blocks implicit source replacement');
 await page.evaluate(()=>editor.cancelExternalEdit(editor.snapshot().externalId,true));await page.waitForSelector('.photopea-panel',{state:'hidden'});
 assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);assert.deepEqual(errors,[]);
});

test('Photopea reuses the transport for a different image after a cancelled export; Save uses the new source',async t=>{
 const {page,errors,network}=await setup(t);await open(page);
 await page.evaluate(()=>window.retainedFrame=document.querySelector('.photopea-frame iframe'));
 const frame=page.frames().find(f=>f.url().startsWith('https://www.photopea.com'));await frame.evaluate(()=>window.delay=750);
 await page.getByRole('button',{name:'应用并返回',exact:true}).click();
 await page.getByRole('button',{name:'返回 EDIT',exact:true}).click();await page.getByRole('button',{name:'暂不应用',exact:true}).click();await page.waitForSelector('.photopea-panel',{state:'hidden'});
 await page.evaluate(async()=>{const c=new OffscreenCanvas(448,256),x=c.getContext('2d');x.fillStyle='#3366cc';x.fillRect(0,0,448,256);await editor.addSource(await c.convertToBlob({type:'image/png'}),'second.png');});
 await open(page);assert.equal(await page.evaluate(()=>retainedFrame===document.querySelector('.photopea-frame iframe')),true);
 assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);
 await frame.evaluate(()=>save());await page.waitForSelector('.photopea-panel',{state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>{const v=editor.snapshot().base;return [v.width,v.height,v.kind,drawing.snapshot().history.length];}),[448,256,'source',0]);
 assert.deepEqual(network,['https://www.photopea.com']);assert.deepEqual(errors,[]);
});
