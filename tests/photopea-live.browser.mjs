// Explicit opt-in: real Photopea, synthetic images, no generation endpoints or credentials.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from './helpers/vite.mjs';
import { chromium } from 'playwright';
const enabled=process.env.KOMA_PHOTOPEA_LIVE==='1';
let server,browser,origin;
before(async()=>{if(!enabled)return;server=await createServer({server:{host:'127.0.0.1',port:0,open:false,hmr:false}});await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
async function setup(t){
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
 t.after(()=>context.close());page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin + "/#/image");await page.waitForSelector('#prompt',{state:'attached'});
 await page.evaluate(async()=>{
  const p=document.body.__vue_app__._instance.provides;
  for(const name of ['editor','drawing'])window[name]=p[Object.getOwnPropertySymbols(p).find(k=>k.description===name)];
  window.make=async(color='#224466',w=384,h=256)=>{const c=new OffscreenCanvas(w,h),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c.convertToBlob({type:'image/png'});};
  window.source=await make();await editor.open('image',source,'synthetic.png',{settings:{seed:7,prompt:'synthetic',basePrompt:'source recipe'}});
  const m=new OffscreenCanvas(384,256),mx=m.getContext('2d');mx.fillStyle='white';mx.fillRect(96,64,64,64);mx.clearRect(112,80,16,16);window.mask=await m.convertToBlob({type:'image/png'});
  window.ppBuffers=[];window.ppLog=[];addEventListener('message',e=>{if(e.origin==='https://www.photopea.com'){ppLog.push(typeof e.data==='string'?e.data:'PNG');if(e.data instanceof ArrayBuffer)ppBuffers.push(e.data);}});
  window.probe=body=>new Promise((resolve,reject)=>{
   const f=document.querySelector('.photopea-frame iframe'),o='https://www.photopea.com';
   const timer=setTimeout(()=>{removeEventListener('message',on);reject(new Error('Photopea probe timeout'));},10000);
   function on(e){if(e.origin!==o||e.source!==f.contentWindow||typeof e.data!=='string'||!e.data.startsWith('PROBE:'))return;clearTimeout(timer);removeEventListener('message',on);resolve(JSON.parse(e.data.slice(6)));}
   addEventListener('message',on);f.contentWindow.postMessage('(function(){try{'+body+'}catch(e){app.echoToOE("PROBE:"+JSON.stringify({error:String(e.message||e)}));}})();',o);
  });
 });
 return {page,errors};
}
async function open(page){await page.locator('#editorPhotopea').click();await page.waitForFunction(()=>{const p=document.querySelector('.photopea-panel');return p&&(!p.querySelector('.photopea-loading')&&!p.querySelector('.photopea-status')||p.querySelector('[role=alert]'));},null,{timeout:60000});if(await page.locator('.photopea-error').count())throw new Error(await page.locator('.photopea-panel').innerText()+'\n'+JSON.stringify(await page.evaluate(()=>ppLog)));}
async function choose(page,label){await page.locator('.photopea-choice').click();await page.getByRole('menuitemradio',{name:label,exact:true}).click();}
async function apply(page){
 await page.getByRole('button',{name:'应用并返回',exact:true}).click();
 await Promise.race([page.locator('.photopea-panel').waitFor({state:'hidden',timeout:35000}),page.locator('.photopea-panel [role=alert]').waitFor({state:'visible',timeout:35000})]);
 if(await page.locator('.photopea-panel').isVisible()){
  const stats=await page.evaluate(async()=>{const out=[];for(const buf of ppBuffers.slice(-4)){const b=await createImageBitmap(new Blob([buf],{type:'image/png'})),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);b.close();const data=x.getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<data.length;i+=4)if(data[i]>32)count++;out.push({width:c.width,height:c.height,count});}return out;});
  throw new Error(await page.locator('.photopea-panel').innerText()+'\n'+JSON.stringify(stats)+'\n'+JSON.stringify(await page.evaluate(()=>ppLog.slice(-30))));
 }
}
async function back(page){await page.getByRole('button',{name:'返回 EDIT',exact:true}).click();await page.getByRole('button',{name:'暂不应用',exact:true}).click();await page.waitForSelector('.photopea-panel',{state:'hidden'});}
async function inspect(page){
 const result=await page.evaluate(()=>probe('var d=app.activeDocument,ls=[],b=null;try{var a=d.selection.bounds;b=[a[0].value,a[1].value,a[2].value,a[3].value];}catch(e){}for(var i=0;i<d.layers.length;i++){var l=d.layers[i];ls.push({id:l.id,name:l.name,visible:l.visible,opacity:l.opacity,bounds:[l.bounds[0].value,l.bounds[1].value,l.bounds[2].value,l.bounds[3].value]});}app.echoToOE("PROBE:"+JSON.stringify({layers:ls,active:d.activeLayer.id,selection:b,history:d.historyStates.length,documents:app.documents.length,width:Number(d.width),height:Number(d.height)}));'));
 assert.equal(result.error,undefined,JSON.stringify(result));return result;
}
async function bits(page){return page.evaluate(async()=>{const {maskStateBitmap}=await import('/src/native/photopea-input.ts');return [...(await maskStateBitmap(editor.session.mask)).bits];});}

test('real Photopea workstack: alpha layer + selection union, clean no-op, history/redo preserved, erase-to-empty', {skip:!enabled,timeout:150000},async t=>{
 const {page,errors}=await setup(t);
 await page.evaluate(async()=>{editor.setMode('inpaint');await editor.importMask(mask,'alpha');});const before=await bits(page);
 await open(page);let initial=await inspect(page);
 assert.deepEqual(initial.layers.map(l=>l.name),['Koma 蒙版','涂鸦与修补','原图','Koma 选区辅助']);assert.equal(initial.selection,null);
 assert.equal(initial.active,initial.layers[0].id);assert.ok(Math.abs(initial.layers[0].opacity-55)<.2);assert.equal(initial.layers[3].visible,false);
 // Existing coverage must not have an additional live selection that would undo erasing.
 await apply(page);assert.deepEqual(await bits(page),before);assert.deepEqual(await page.evaluate(()=>[editor.session.versions.length,drawing.snapshot().history.length]),[1,0]);
 await open(page);assert.deepEqual((await inspect(page)).layers,initial.layers);
 // Change preview only, add a selection disjoint from the layer, and keep a redo branch.
 const modified=await page.evaluate(()=>probe('var d=app.activeDocument;d.layers[0].name="区域";d.layers[0].opacity=0;d.layers[0].fillOpacity=0;d.layers[0].visible=false;d.layers[0].move(d.layers[1],ElementPlacement.PLACEAFTER);d.selection.select([[192,64],[224,64],[224,96],[192,96]]);var l=d.artLayers.add();l.name="Redo sentinel";d.activeHistoryState=d.historyStates[d.historyStates.length-2];app.echoToOE("PROBE:"+JSON.stringify({ok:true}));'));
 assert.equal(modified.error,undefined);const prior=await inspect(page);
 await apply(page);const merged=await bits(page);assert.notDeepEqual(merged,before);assert.equal(merged.reduce((n,b)=>n+b.toString(2).replaceAll('0','').length,0),4864);
 await open(page);const after=await inspect(page);assert.deepEqual(after,prior,'export must preserve the work document and redo branch');
 const redo=await page.evaluate(()=>probe('var d=app.activeDocument;d.activeHistoryState=d.historyStates[d.historyStates.length-1];app.echoToOE("PROBE:"+JSON.stringify({name:d.activeLayer.name}));'));assert.equal(redo.name,'Redo sentinel');
 // Erase the renamed mask layer; empty is an explicit clear, not an absent response.
 await page.evaluate(()=>probe('var d=app.activeDocument;for(var i=0;i<d.layers.length;i++)if(d.layers[i].name==="区域")d.activeLayer=d.layers[i];d.selection.selectAll();d.selection.clear();d.selection.deselect();app.echoToOE("PROBE:{}");'));
 await apply(page);assert.equal((await bits(page)).some(n=>n!==0),false);assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
 assert.deepEqual(errors,[]);
});

test('real Photopea retains custom layers after return, refreshes only external mask, swaps baked descendant base without double overlay', {skip:!enabled,timeout:150000},async t=>{
 const {page,errors}=await setup(t);await page.evaluate(async()=>{editor.setMode('inpaint');await editor.importMask(mask,'alpha');});await open(page);
 await page.evaluate(()=>probe('var d=app.activeDocument;d.activeLayer=d.layers[1];d.selection.select([[16,16],[64,16],[64,64],[16,64]]);var c=new SolidColor();c.rgb.hexValue="ff0000";d.selection.fill(c);d.selection.deselect();var g=d.layerSets.add();g.name="Custom group";var l=g.artLayers.add();l.name="User layer";d.activeLayer=l;d.selection.select([[180,140],[220,140],[220,180],[180,180]]);d.selection.fill(c);d.selection.deselect();app.echoToOE("PROBE:{}");'));
 const original=await inspect(page);await apply(page);const manual=await page.evaluate(()=>editor.snapshot().base);assert.equal(manual.kind,'manual');assert.deepEqual(await page.evaluate(async()=>{const b=await createImageBitmap(editor.snapshot().base.blob),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);b.close();return [...x.getImageData(190,150,1,1).data];}),[255,0,0,255],'custom group pixels survive clean image export');
 await open(page);assert.deepEqual(await inspect(page),original,'manual PNG must not replace the layered document');await back(page);
 await page.evaluate(async()=>{const c=new OffscreenCanvas(384,256),x=c.getContext('2d');x.fillStyle='white';x.fillRect(240,32,40,40);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');});
 await open(page);const refreshed=await inspect(page);assert.deepEqual(refreshed.layers.filter(l=>l.name!=='Koma 蒙版'),original.layers.filter(l=>l.name!=='Koma 蒙版'));assert.deepEqual(refreshed.layers.find(l=>l.name==='Koma 蒙版').bounds,[240,32,280,72]);assert.equal(refreshed.selection,null);await back(page);
 // A synthetic same-size descendant stands in for a returned NAI image; no provider is called.
 await page.evaluate(async()=>{const token=editor.beginExternalEdit();await editor.applyExternalEdit(token.id,{mode:'image',image:await make('#335588')});});const native=await bits(page);
 await open(page);const swapped=await inspect(page);
 assert.equal(swapped.width,384);assert.equal(swapped.height,256);assert.equal(swapped.layers.find(l=>l.name==='Custom group').visible,false);
 assert.equal(swapped.layers.find(l=>l.id===original.layers.find(x=>x.name==='涂鸦与修补').id).visible,false);
 assert.ok(swapped.layers.some(l=>l.name==='涂鸦与修补'&&l.visible));
 await choose(page,'仅蒙版');await apply(page);assert.deepEqual(await bits(page),native,'mask-only validates the current A2 pixels');
 assert.equal(await page.evaluate(()=>editor.session.versions.length),3);
 await open(page);const damaged=await page.evaluate(()=>probe('var d=app.activeDocument;for(var i=0;i<d.layers.length;i++)if(d.layers[i].name==="Koma 蒙版")d.layers[i].remove();app.echoToOE("PROBE:{}");'));
 assert.equal(damaged.error,undefined);await choose(page,'仅图像');await page.getByRole('button',{name:'应用并返回',exact:true}).click();await page.locator('.photopea-panel [role=alert]').waitFor();assert.match(await page.locator('.photopea-panel').innerText(),/结构已变化/,JSON.stringify(await page.evaluate(()=>ppLog.slice(-20))));assert.equal(await page.evaluate(()=>editor.session.versions.length),3);
 assert.deepEqual(errors,[]);
});

test('real Photopea transparent image, image-only retains native coverage, crop returns aligned mask and size change rebuilds stack', {skip:!enabled,timeout:150000},async t=>{
 const {page,errors}=await setup(t);
 await page.evaluate(async()=>{const c=new OffscreenCanvas(384,256),x=c.getContext('2d');x.fillStyle='#229977';x.fillRect(80,60,100,80);await editor.open('image',await c.convertToBlob({type:'image/png'}),'transparent.png');editor.setMode('inpaint');await editor.importMask(mask,'alpha');});
 const before=await bits(page);await open(page);
 await page.evaluate(()=>probe('var d=app.activeDocument;d.activeLayer=d.layers[1];d.selection.select([[180,140],[220,140],[220,180],[180,180]]);var c=new SolidColor();c.rgb.hexValue="4455aa";d.selection.fill(c);d.selection.deselect();d.activeLayer=d.layers[0];d.selection.selectAll();d.selection.clear();d.selection.deselect();app.echoToOE("PROBE:{}");'));
 await choose(page,'仅图像');await apply(page);assert.deepEqual(await bits(page),before,'same-size image-only return retains the native session mask');
 await open(page);assert.deepEqual((await inspect(page)).layers.find(l=>l.name==='Koma 蒙版').bounds,[96,64,160,128]);
 const cropped=await page.evaluate(()=>probe('var d=app.activeDocument;d.crop([32,16,352,240]);app.echoToOE("PROBE:"+JSON.stringify({width:Number(d.width),height:Number(d.height)}));'));
 assert.deepEqual(cropped,{width:320,height:224});await apply(page);
 assert.deepEqual(await page.evaluate(()=>[editor.snapshot().base.width,editor.snapshot().base.height,editor.session.mask.width,editor.session.mask.height]),[320,224,320,224]);
 await open(page);assert.equal((await inspect(page)).layers.length,4);await back(page);
 // A differently sized native source creates a fresh standard stack in the same iframe.
 await page.evaluate(async()=>editor.addSource(await make('#335588',256,256),'other-size.png'));
 await open(page);const rebuilt=await inspect(page);assert.deepEqual(rebuilt.layers.map(l=>l.name),['Koma 蒙版','涂鸦与修补','原图','Koma 选区辅助']);assert.deepEqual([rebuilt.width,rebuilt.height],[256,256]);assert.equal(rebuilt.documents,1);
 await apply(page);assert.equal((await bits(page)).some(n=>n!==0),false);assert.deepEqual(errors,[]);
});

test('real Photopea rejects an attached raster mask on the dedicated layer without changing Koma', {skip:!enabled,timeout:90000},async t=>{
 const {page,errors}=await setup(t);await page.evaluate(()=>editor.setMode('inpaint'));await open(page);
 const made=await page.evaluate(()=>probe('var a=new ActionDescriptor();a.putClass(charIDToTypeID("Nw  "),charIDToTypeID("Chnl"));var r=new ActionReference();r.putEnumerated(charIDToTypeID("Chnl"),charIDToTypeID("Chnl"),charIDToTypeID("Msk "));a.putReference(charIDToTypeID("At  "),r);a.putEnumerated(charIDToTypeID("Usng"),charIDToTypeID("UsrM"),charIDToTypeID("RvlA"));executeAction(charIDToTypeID("Mk  "),a,DialogModes.NO);app.echoToOE("PROBE:{}");'));
 assert.equal(made.error,undefined);await page.getByRole('button',{name:'应用并返回',exact:true}).click();await page.getByRole('alert').filter({hasText:'附加蒙版'}).waitFor({timeout:35000});assert.equal(await page.evaluate(()=>editor.session.versions.length),1);assert.deepEqual(errors,[]);
});

test('real Photopea keeps separate layered documents through EDIT board and workspace switches', {skip:!enabled,timeout:150000}, async t => {
  const {page,errors}=await setup(t);
  const a=await page.evaluate(()=>editor.session.id);
  await open(page);
  await page.evaluate(()=>probe('var d=app.activeDocument,l=d.artLayers.add();l.name="Board A custom";app.echoToOE("PROBE:{}");'));
  const initial=await inspect(page);
  await back(page);
  const frame=await page.locator('.photopea-frame iframe').elementHandle();
  await page.evaluate(async()=>{
    const p=document.body.__vue_app__._instance.provides;
    const shell=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='app-shell')];
    shell.router.switchWorkspace('home'); await new Promise(r=>setTimeout(r,100));
    shell.router.switchWorkspace('edit'); await new Promise(r=>setTimeout(r,100));
    await editor.open('edit',await make('#557733'),'Board B.png');
  });
  const b=await page.evaluate(()=>editor.session.id);
  assert.notEqual(a,b); await open(page);
  const second=await inspect(page);
  assert.equal(second.documents,2); assert.ok(!second.layers.some(l=>l.name==='Board A custom'));
  await page.evaluate(()=>probe('var d=app.activeDocument,l=d.artLayers.add();l.name="Board B custom";app.echoToOE("PROBE:{}");'));
  await back(page); await page.evaluate(id=>editor.switchBoard(id),a); await open(page);
  const returned=await inspect(page);
  assert.deepEqual(returned.layers,initial.layers); assert.equal(returned.history,initial.history);
  assert.equal(returned.documents,2);
  assert.ok(await frame.evaluate(n=>n===document.querySelector('.photopea-frame iframe')));
  await back(page); await page.evaluate(id=>editor.removeBoard(id),b);
  await open(page); assert.equal((await inspect(page)).documents,1);
  assert.deepEqual(errors,[]);
});
