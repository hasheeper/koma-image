import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, submitAsk, open, askSettings, generation, bind, drawer, addScene, toolReply, textReply, imageBlocks, reloadAsk, wireStates } from './helpers/ask-fixture.mjs';
useAskFixture();
test('annotated ASK sends clean and marked images, crops clean #a coordinates immediately, and never generates',async()=>{
 const {page,context,errors,requests,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);await addScene(page);
  await page.evaluate(async()=>{
   const p=document.body.__vue_app__._instance.provides;window.annotations=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='annotations')];
   const r=drawing.snapshot().history[0];await annotations.open({blob:r.blob,name:'synthetic.png',recordId:r.id,workspace:'image'});
   annotations.update([{key:'region',shape:'ellipse',bbox:{x:.25,y:.25,w:.25,h:.25},comment:'检查这里'},{key:'point',shape:'point',bbox:{x:.75,y:.75,w:0,h:0},comment:'这个位置'}]);await annotations.act('ask');
  });
  llm.push(toolReply('region-crop','view_image',{id:'#a1',spec:'crop',annotation:1}),textReply('已核对选区。'));
  assert.equal(await page.locator('#askPrompt').inputValue(),'');
  assert.equal(await drawer(page).getByRole('region',{name:'批注附件'}).count(),1);
  await drawer(page).getByRole('button',{name:'展开或收起批注列表'}).click();
  await page.getByRole('dialog',{name:'批注列表'}).getByRole('textbox',{name:'批注 1',exact:true}).fill('检查眼睛');
  await page.getByRole('dialog',{name:'批注列表'}).getByRole('textbox',{name:'批注 1',exact:true}).press('Enter');
  await page.keyboard.press('Escape');
  await submitAsk(page);await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
  assert.equal(imageBlocks(calls[0].body).length,2);assert.equal(imageBlocks(calls[1].body).length,3);
  assert.match(JSON.stringify(calls[0].body),/image_annotations/);assert.match(JSON.stringify(calls[0].body),/x=\\"0\.250\\" y=\\"0\.250\\"/);
  assert.match(JSON.stringify(calls[0].body),/point n=\\"2\\" x=\\"0\.750\\" y=\\"0\.750\\"/);assert.match(JSON.stringify(calls[0].body),/点只标一个位置/);
  assert.match(JSON.stringify(calls[0].body),/检查眼睛/);assert.doesNotMatch(await drawer(page).innerText(),/<image_annotations/);
  assert.equal(await drawer(page).locator('.ask-turn[data-status="failed"]').count(),0);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK annotation cards restore pending metadata, retry the frozen comments and remove paired attachments together',async()=>{
 const {page,context,errors,requests,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);await addScene(page);
  await page.evaluate(async()=>{
   const p=document.body.__vue_app__._instance.provides,a=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='annotations')],r=drawing.snapshot().history[0];
   await a.open({blob:r.blob,name:'source.png',recordId:r.id,workspace:'image'});
   a.update([{key:'region',shape:'rect',bbox:{x:.2,y:.3,w:.3,h:.2},comment:'保存中的批注'}]);await a.act('ask');ask.setInput('保留我的提问');await ask.toggleFavorite();await ask.flushFavorites();
  });
  await reloadAsk(page);assert.equal(await page.locator('#askPrompt').inputValue(),'保留我的提问');
  assert.equal(await drawer(page).getByRole('region',{name:'批注附件'}).count(),1);
  assert.equal(await page.evaluate(()=>ask.tray.value[0].annotations.snapshot.regions[0].comment),'保存中的批注');
  await page.evaluate(()=>ask.updateAnnotationComment('#a1','region','发送时的批注'));
  llm.push({status:503,type:'application/json',body:JSON.stringify({error:{message:'synthetic unavailable'}})});await submitAsk(page);
  await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.at(-1)?.turn.status==='failed');
  assert.equal(await page.evaluate(()=>ask.entries.value.at(-1).turn.question),'保留我的提问');
  llm.push(textReply('已读取保存的批注。'));await page.evaluate(()=>ask.retry(ask.entries.value.at(-1).id,'plain'));
  await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.at(-1)?.turn.status==='done');
  for(const call of calls){assert.match(call.raw,/发送时的批注/);assert.equal(imageBlocks(call.body).length,2);}
  await page.evaluate(()=>ask.flushFavorites());await reloadAsk(page);
  assert.equal(await drawer(page).getByRole('region',{name:'批注附件'}).count(),1);assert.doesNotMatch(await drawer(page).innerText(),/<image_annotations/);
  await page.evaluate(async()=>{
   const value=ask.annotationSource('#a1'),guide=await(await fetch(ask.pictureInfo('#a2').url)).blob();
   await ask.prepareAnnotations(value.source,guide,value.snapshot);
  });
  assert.equal(await page.evaluate(()=>ask.tray.value.length),2);
  await drawer(page).getByRole('button',{name:'移除批注',exact:true}).click();
  assert.equal(await page.evaluate(()=>ask.tray.value.length),0);
  assert.equal(await page.evaluate(()=>ask.annotationSource('#a3')),null);
  assert.equal(await page.evaluate(()=>ask.pictureInfo('#a4')),null);
  assert.equal(await page.evaluate(()=>ask.entries.value.at(-1).turn.attachments.length),2);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('unsent EDIT base annotations require look before numbered crop even when a different version is visible',async()=>{
 const {page,context,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);await addScene(page);
  const expected=await page.evaluate(async()=>{
   const p=document.body.__vue_app__._instance.provides,a=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='annotations')],r=drawing.snapshot().history[0];
   await a.open({blob:r.blob,name:'source.png',recordId:r.id,workspace:'image'});
   a.update([{key:'region',shape:'ellipse',bbox:{x:.25,y:.25,w:.25,h:.25},comment:'底图上的批注'}]);a.close();
   const base=editor.session.baseId,token=editor.beginExternalEdit(),c=new OffscreenCanvas(512,512);c.getContext('2d').fillRect(0,0,512,512);
   await editor.applyExternalEdit(token.id,{mode:'image',image:await c.convertToBlob({type:'image/png'})});const view=editor.session.viewId;editor.setBase(base);editor.view(view);
   ask.show();ask.setInput('看看底图批注的细节');return {base:editor.reference(editor.snapshot().base),view:editor.reference(editor.snapshot().viewed)};
  });
  llm.push(toolReply('premature-crop','view_image',{id:expected.base,spec:'crop',annotation:1}),toolReply('base-look','view_image',{id:expected.base,spec:'look'}),toolReply('base-crop','view_image',{id:expected.base,spec:'crop',annotation:1}),textReply('已核验底图批注。'));
  await submitAsk(page);await page.waitForFunction(()=>!ask.running.value&&ask.entries.value.at(-1)?.turn.status==='done');
  const state=wireStates(calls[0].body).at(-1);
  assert.equal(state.edit.image_edit.annotations.image,expected.base);assert.equal(state.edit.viewing_version.id,expected.view);assert.notEqual(expected.base,expected.view);
  assert.match(calls[1].raw,/先用 glance 或 look/);assert.equal(imageBlocks(calls[1].body).length,0);
  assert.equal(imageBlocks(calls[2].body).length,1);assert.equal(imageBlocks(calls[3].body).length,2);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
