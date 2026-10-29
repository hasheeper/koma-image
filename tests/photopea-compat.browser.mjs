// Production bundle + actual Photopea UI. Explicit opt-in; uses synthetic pixels, no providers.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium, webkit } from 'playwright';
const live=process.env.KOMA_PHOTOPEA_LIVE==='1';
const engines=(process.env.KOMA_PHOTOPEA_ENGINES||'chromium').split(',');
let server,origin;
before(async()=>{if(!live)return;await mkdir('.local/pe3',{recursive:true});server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});origin=`http://127.0.0.1:${server.httpServer.address().port}`;});
after(async()=>{await new Promise(r=>server?server.httpServer.close(r):r());});
async function canvasBounds(frame){
 // Brush cursors also use tiny canvases; the last canvas is not always the document.
 const index=await frame.locator('canvas').evaluateAll(xs=>xs.map((x,i)=>({i,area:x.clientWidth*x.clientHeight})).sort((a,b)=>b.area-a.area)[0]?.i);
 assert.notEqual(index,undefined);
 return frame.locator('canvas').nth(index).boundingBox();
}
async function bounded(promise,label,ms=15000){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]);}
 finally{clearTimeout(timer);}
}
for(const engine of engines)test(`PE3 static ${engine}: four widths, keyboard, real pointer editing and direct history`,{skip:!live,timeout:120000},async t=>{
 assert.ok(['chromium','edge','webkit'].includes(engine),'supported browser engine');
 const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,timeout:15000,...(engine==='edge'?{channel:'msedge'}:{})});
 let page;
 t.diagnostic(`Browser: ${browser.version()}`);
 t.signal.addEventListener('abort',()=>void browser.close(),{once:true});
 t.after(async()=>{await page?.screenshot({path:`.local/pe3/${engine}-final.png`,timeout:5000}).catch(()=>{});await bounded(browser.close(),'browser shutdown');});
 const context=await bounded(browser.newContext({viewport:{width:390,height:844},hasTouch:engine==='chromium'}),'browser context'),errors=[];
 await context.addInitScript(()=>{window.photopeaResizeWidths=[];addEventListener('resize',()=>photopeaResizeWidths.push(innerWidth));});
 page=await bounded(context.newPage(),'browser page');page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/image/editor');await page.waitForSelector('#imageEditor[data-active=true]');
 const png=Buffer.from(await page.evaluate(async()=>{const c=new OffscreenCanvas(384,256),x=c.getContext('2d');x.fillStyle='#224466';x.fillRect(0,0,384,256);x.fillStyle='#ee2244';x.fillRect(80,70,100,90);window.pe3OriginalPixels=x.getImageData(0,0,384,256).data;return [...new Uint8Array(await(await c.convertToBlob({type:'image/png'})).arrayBuffer())];}));
 await page.locator('#imageEditor input[type=file]').first().setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
 await page.locator('#editorPhotopea').click();
 const apply=page.getByRole('button',{name:'应用并返回',exact:true});
 await page.waitForFunction(()=>document.querySelector('.photopea-panel')&&!document.querySelector('.photopea-loading')&&!document.querySelector('.photopea-status'),null,{timeout:60000});
 await page.waitForFunction(()=>document.activeElement?.tagName==='IFRAME');
 const frame=page.frames().find(f=>f.url().startsWith('https://www.photopea.com'));
 await frame.waitForFunction(()=>photopeaResizeWidths.some((w,i)=>w===389&&photopeaResizeWidths[i+1]===390));
 await frame.getByTitle('矩形选框 (M)',{exact:true}).waitFor({timeout:20000});
 assert.equal(await frame.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(34, 37, 49)','Dark Blue is active');
 await frame.getByText('文件',{exact:true}).click();
 assert.equal(await frame.getByText('打印...', {exact:true}).count(),0);
 assert.equal(await frame.getByText('脚本...', {exact:true}).count(),0);
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('button',{name:/展开顶栏|折叠顶栏/}).count(),0);
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844});
  const crop=await page.locator('.photopea-frame').evaluate(e=>{e.scrollLeft=e.scrollWidth;const box=e.getBoundingClientRect(),f=e.querySelector('iframe').getBoundingClientRect();return {scroll:e.scrollLeft,left:f.left-box.left,top:f.top-box.top,gutter:f.width-box.width};});
  assert.equal(crop.scroll,0);assert.equal(crop.left,0);assert.equal(crop.top,0);assert.equal(crop.gutter,0);
  for(const title of ['历史记录','图层']){
   const control=frame.getByTitle(title,{exact:true}).last();await control.waitFor({state:'visible'});
   // The third-party layout updates asynchronously after the host viewport changes.
   await frame.waitForFunction(title=>{const e=[...document.querySelectorAll('[title]')].filter(x=>x.getAttribute('title')===title).at(-1),b=e?.getBoundingClientRect();return b&&b.width>0&&b.left>=0&&b.right<=innerWidth;},title);
   const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,`${title} stays inside the host at ${width}px`);
  }
  await page.locator('.photopea-choice').focus();await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitemradio');
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await page.locator('.photopea-choice').getAttribute('aria-label'),'回传方式：仅蒙版');
  const bounds=await page.locator('.photopea-bar').evaluate(x=>({scroll:x.scrollWidth,width:x.clientWidth,brand:x.querySelector('strong').getBoundingClientRect().right,apply:x.querySelector('.photopea-apply').getBoundingClientRect().left}));
  assert.ok(bounds.scroll<=bounds.width);assert.ok(bounds.brand<=bounds.apply);
  await page.locator('.photopea-choice').click();const menu=await page.locator('#photopea-return-menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=width);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.photopea-choice').getAttribute('aria-expanded'),'false');
  const height=await page.locator('.photopea-bar').evaluate(e=>e.getBoundingClientRect().height);assert.equal(height,engine==='chromium'?34:30);
  const compact=await page.locator('.photopea-bar').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(compact.scroll<=compact.width);
  await page.screenshot({path:`.local/pe3/${engine}-compact-${width}.png`});
  if(width===1440){
   await frame.getByTitle('图层',{exact:true}).last().click();await frame.getByText('原图',{exact:true}).waitFor({state:'visible'});
   await page.screenshot({path:`.local/pe3/${engine}-layers-1440.png`});await frame.getByTitle('图层',{exact:true}).last().click();
  }
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('.photopea-choice').click();await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitemradio');await page.keyboard.press('Home');await page.keyboard.press('Enter');assert.equal(await page.locator('.photopea-choice').getAttribute('aria-label'),'回传方式：自动');
 if(engine==='chromium'){
  // Native browser touch input in the embedded editor; no script paints pixels.
  await frame.getByTitle('画笔 (B)',{exact:true}).tap();
  const c=await canvasBounds(frame);
  await page.touchscreen.tap(c.x+c.width/2,c.y+c.height/2);

 }else{
  await frame.getByTitle('画笔 (B)',{exact:true}).click();const c=await canvasBounds(frame);await page.mouse.click(c.x+c.width/2,c.y+c.height/2);
 }
 await frame.getByTitle('矩形选框 (M)',{exact:true}).click();const canvas=await canvasBounds(frame);
 await page.mouse.move(canvas.x+canvas.width/2-35,canvas.y+canvas.height/2-25);await page.mouse.down();
 await page.mouse.move(canvas.x+canvas.width/2+35,canvas.y+canvas.height/2+25,{steps:8});await page.mouse.up();
 // Read the actual UI result using the public script API only; no scripted selection creation.
 const state=await page.evaluate(()=>new Promise((resolve,reject)=>{const f=document.querySelector('.photopea-frame iframe');const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error('Photopea selection read timed out'));},8000);function listener(e){if(e.source===f.contentWindow&&e.origin==='https://www.photopea.com'&&typeof e.data==='string'&&e.data.startsWith('PE3:')){clearTimeout(timer);window.removeEventListener('message',listener);resolve(JSON.parse(e.data.slice(4)));}}window.addEventListener('message',listener);f.contentWindow.postMessage('var d=app.activeDocument,b=d.selection.bounds;app.echoToOE("PE3:"+JSON.stringify({bounds:[b[0].value,b[1].value,b[2].value,b[3].value],history:d.historyStates.length}));','https://www.photopea.com');}));
 assert.ok(state.bounds[2]>state.bounds[0]&&state.bounds[3]>state.bounds[1]);
 if(engine==='edge'){
  await frame.getByText('文件',{exact:true}).click();await frame.getByText('保存',{exact:true}).click();
 }else await apply.click();
 await page.waitForSelector('.photopea-panel',{state:'hidden',timeout:15000});
 await page.waitForFunction(()=>document.activeElement?.id==='editorPhotopea');
 assert.match(await page.locator('#imageEditor').innerText(),/手动编辑/);
 // Keep proof in the native mask canvas and direct IMAGE history, without provider setup.
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await page.waitForSelector('#imageEditor:not([open])',{state:'attached'});assert.equal(await page.getByAltText('手动编辑结果',{exact:true}).count(),1);
 if(engine==='chromium'){const changed=await page.getByAltText('手动编辑结果',{exact:true}).evaluate(async img=>{const b=await createImageBitmap(await(await fetch(img.src)).blob()),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);b.close();return x.getImageData(0,0,c.width,c.height).data.some((v,i)=>v!==window.pe3OriginalPixels[i]);});assert.equal(changed,true,'touch brush changes source pixels');}

 assert.deepEqual(errors,[]);
});
