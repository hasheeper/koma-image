import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, addImage, askSettings, toolReply, textReply, submitAsk, proposal } from './helpers/ask-fixture.mjs';
useAskFixture();

test('unread old IMAGE history is discoverable after release, supports evolution and recipe restore, and clearly limits original actions', async () => {
  const f = await open('/#/image', {ready:'#prompt', ask:askSettings({images:false}), standard:true});
  try {
    await bind(f.page);
    const first = await addImage(f.page,'first handwritten recipe','#334455');
    const fullUrl = await f.page.evaluate(id => drawing.url(drawing.snapshot().history.find(r=>r.id===id)),first);
    await addImage(f.page,'second handwritten recipe','#665544');
    await addImage(f.page,'third handwritten recipe','#445566');
    await f.page.evaluate(async () => {
      const {DEFAULTS}=await import('/src/domain/drawing.ts');
      for (const r of drawing.snapshot().history) r.params={...structuredClone(DEFAULTS), boardId:drawing.snapshot().activeBoardId, basePrompt:r.params.basePrompt, baseNegative:'', localCharacters:[]};
      await drawing.patch({historyLimit:1});
    });
    assert.deepEqual(await f.page.evaluate(()=>drawing.snapshot().history.map(r=>!!r.blob)),[true,false,false]);
    assert.equal(await f.page.evaluate(async url=>{try{await fetch(url);return true;}catch{return false;}},fullUrl),false);
    f.llm.push(toolReply('read','get_recipe_clusters',{}),toolReply('tree','show_retrospect',{retrospect_title:'完整历史',nodes:[1,2,3].map(n=>({id:`v${n}`,label:['初始','调整','推进'][n-1],image_ids:[`#h${n}`]})),edges:[{from:'v1',to:'v2',summary:'修改'},{from:'v2',to:'v3',summary:'继续'}]}),textReply('已整理完整演进。'));
    await f.page.evaluate(()=>ask.show({question:'整理当前画板的完整演进'}));await submitAsk(f.page);
    await f.page.waitForFunction(()=>!ask.running.value&&ask.retrospects.records.value.length>0);
    const evidence=f.calls.at(-1).body.messages.filter(m=>m.role==='tool').map(m=>m.content).join('\n');
    assert.match(evidence,/first handwritten recipe/);assert.match(evidence,/thumbnail_only/);assert.doesNotMatch(evidence,/不在本轮/);
    const restored=await f.page.evaluate(async()=>{const r=ask.retrospects.records.value[0];await ask.restoreRetrospect(r.value.nodes[0],r.pictureRefs,r.id);let error='';try{await ask.finalizeEvolution(r.id,r.value.nodes[0]);}catch(e){error=e.message;}return {prompt:drawing.snapshot().form.prompt,error};});
    assert.equal(restored.prompt,'first handwritten recipe');assert.match(restored.error,/原图已释放/);
    f.llm.push({body:body=>{
      const state=JSON.parse([...body.messages].reverse().find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('<workspace_state>')).content.match(/<workspace_state>\n([\s\S]+?)\n<\/workspace_state>/)[1]);
      return toolReply('rollback','propose_draft',{base_hash:state.base_hash,base_image_id:'#h1',draft_title:'旧配方分叉',steps:[{kind:'prompt_patch',target:'image.prompt',mode:'append',text:', gentle light'}]}).body;
    }});
    await f.page.evaluate(()=>ask.show({question:'以 #h1 为基底回退修改'}));await submitAsk(f.page);
    await f.page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
    assert.deepEqual(await f.page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue)),[]);
    await f.page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
    assert.equal(await f.page.evaluate(()=>drawing.snapshot().form.prompt),'first handwritten recipe, gentle light');
    await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));
    await addImage(f.page,'new after evolution','#773355');
    assert.deepEqual(await f.page.evaluate(()=>drawing.snapshot().history.map(r=>!!r.blob)),[true,true,false,false],'new evolution reference retains its original, existing thumbnails do not pretend to regain pixels');
    await f.page.evaluate(id=>{ask.hide();drawing.show(drawing.snapshot().history.find(r=>r.id===id),true);},first);
    for (const id of ['editBtn','annotateBtn','chatBtn','favoriteBtn','saveBtn']) assert.equal(await f.page.locator(`#${id}`).isDisabled(),true);
    assert.match(await f.page.locator('#stageSub').textContent(),/仅缩略图/);
    assert.equal(await f.page.getByRole('button',{name:'Ask 这张图',exact:true}).isEnabled(),true);
    if(await f.page.locator('#histToggle').getAttribute('aria-expanded')==='false')await f.page.locator('#histToggle').click();
    assert.match(await f.page.locator('.library-ask-id').allTextContents().then(t=>t.join(' ')),/缩略图/);
    await f.page.evaluate(()=>drawing.patch({historyLimit:0}));
    assert.equal(await f.page.evaluate(id=>drawing.original(id)===undefined,first),true);
    await f.page.evaluate(id=>drawing.remove(id),first);assert.equal(await f.page.evaluate(()=>ask.pictureInfo('#h1')),null);
    assert.deepEqual(f.errors,[]);
  } finally {await f.context.close();}
});

test('thumbnail visual views stay usable, do not reuse original cache entries or grant original crop access', async () => {
  const f=await open('/#/image',{ready:'#prompt',ask:askSettings()});
  try {
    await bind(f.page);await addImage(f.page,'first','#334455');await addImage(f.page,'second','#665544');
    const result=await f.page.evaluate(async()=>{
      const {createVision}=await import('/src/ask/vision.ts'), vision=createVision();
      const p=ask.externalSnapshot().library.find(p=>p.label==='#h1');
      const c={signal:new AbortController().signal,metadataOnly:false,budget:{calls:0,bytes:0,pixels:0},viewed:new Set()};
      try {
        await vision.image(p,'look',undefined,c);
        await drawing.patch({historyLimit:1});
        const thumbnail=ask.externalSnapshot().library.find(p=>p.label==='#h1');
        const looked=await vision.image(thumbnail,'look',undefined,c);
        let error='';try{await vision.image(thumbnail,'crop',[0,0,50,50],c);}catch(e){error=e.message;}
        const fresh={...c,budget:{calls:0,bytes:0,pixels:0},viewed:new Set()};
        await vision.image(thumbnail,'glance',undefined,fresh);
        return {thumbnail:thumbnail.thumbnailOnly,duplicate:!!looked.duplicate,bytes:looked.bytes,error,viewed:fresh.viewed.size};
      }finally{vision.dispose();}
    });
    assert.equal(result.thumbnail,true);assert.equal(result.duplicate,false);assert.ok(result.bytes>0);
    assert.match(result.error,/无法精细裁切/);assert.equal(result.viewed,0);
    assert.deepEqual(f.errors,[]);
  }finally{await f.context.close();}
});

test('favorite and current-view leases keep originals, last release downgrades, clearing and refresh discard page history', async () => {
  const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false})});
  try {
    await bind(f.page);const first=await addImage(f.page,'saved','#443322');
    await f.page.evaluate(()=>drawing.toggleFavorite());
    const second=await addImage(f.page,'current','#445566');
    await f.page.evaluate(()=>drawing.patch({historyLimit:1}));
    assert.ok(await f.page.evaluate(id=>!!drawing.original(id),first));
    await f.page.evaluate(id=>drawing.show(drawing.snapshot().history.find(r=>r.id===id)),first);
    await f.page.evaluate(()=>drawing.toggleFavorite());
    assert.ok(await f.page.evaluate(id=>!!drawing.original(id),first),'viewed original remains usable while on stage');
    await f.page.evaluate(id=>drawing.show(drawing.snapshot().history.find(r=>r.id===id)),second);
    assert.equal(await f.page.evaluate(id=>!!drawing.original(id),first),false);
    await f.page.evaluate(id=>drawing.show(drawing.snapshot().history.find(r=>r.id===id)),first);
    assert.equal(await f.page.locator('#saveBtn').isDisabled(),true);
    await f.page.getByRole('button',{name:'撤销',exact:true}).click();
    await f.page.waitForFunction(id=>!!drawing.original(id),first);
    assert.equal(await f.page.locator('#saveBtn').isEnabled(),true,'restored original replaces the currently viewed thumbnail');
    assert.equal(await f.page.evaluate(()=>ask.pictureInfo('#h1').thumbnailOnly),false,'undo restores from the real favorite original');
    await f.page.evaluate(()=>{void drawing.clear();});
    await f.page.getByRole('button',{name:'清空',exact:true}).click();
    await f.page.waitForFunction(()=>drawing.snapshot().history.length===0);
    assert.equal(await f.page.evaluate(()=>drawing.snapshot().favorites.length),1);
    await f.page.reload();await f.page.waitForSelector('#prompt');await bind(f.page);
    await f.page.waitForFunction(()=>!drawing.snapshot().favoritesLoading);
    assert.equal(await f.page.evaluate(()=>drawing.snapshot().history.length),0);
    assert.equal(await f.page.evaluate(()=>drawing.snapshot().favorites.length),1);
    assert.deepEqual(f.errors,[]);
  } finally {await f.context.close();}
});

test('a pending CHAT handoff temporarily protects its source and releases it when discarded', async () => {
  const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false})});
  try {
    await bind(f.page);const first=await addImage(f.page,'pending source','#443355');
    f.llm.push(proposal([{kind:'chat_handoff',images:['#h1'],options:{},text:'continue source'}],'准备交接'));
    await f.page.evaluate(()=>ask.show({question:'把 #h1 送到 CHAT'}));await submitAsk(f.page);
    await f.page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
    await f.page.evaluate(()=>drawing.patch({historyLimit:1}));await addImage(f.page,'newest','#778899');
    assert.ok(await f.page.evaluate(id=>!!drawing.original(id),first));
    await f.page.evaluate(()=>ask.ignoreDraft());
    assert.equal(await f.page.evaluate(id=>!!drawing.original(id),first),false);
    assert.equal(await f.page.evaluate(()=>ask.pictureInfo('#h1').thumbnailOnly),true);
    assert.deepEqual(f.errors,[]);
  } finally {await f.context.close();}
});
