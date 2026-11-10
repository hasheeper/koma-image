import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, addImage, askSettings, toolReply, textReply, submitAsk, seedAskChat } from './helpers/ask-fixture.mjs';
useAskFixture();

async function imageReplies(page) {
  const b64=await page.evaluate(async()=>{const c=new OffscreenCanvas(256,384);const g=c.getContext('2d');g.fillStyle='#6688aa';g.fillRect(0,0,256,384);g.fillStyle='#ccaa88';g.fillRect(50,80,80,120);return btoa(String.fromCharCode(...new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer())));});
  let count=0;
  await page.route(/\/images\/(?:edits|generations)$/,route=>{count++;return route.fulfill({json:{data:[{b64_json:b64}]}});});
  return ()=>count;
}
async function organize(f,nodes,edges=[]) {
  f.llm.push(toolReply('read','get_recipe_clusters',{}),toolReply('graph','show_retrospect',{retrospect_title:'工作区演进',nodes,edges}),textReply('已整理。'));
  await f.page.evaluate(()=>ask.show({question:'请整理当前版本演进'}));await submitAsk(f.page);
  await f.page.waitForFunction(()=>!ask.running.value&&ask.retrospects.records.value.length>0);
}

test('EDIT evolution reads raw input, follows actual branches, restores through ASK with undo, and finalizes without generation',async()=>{
  const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false})});
  try {
    await bind(f.page);const source=await addImage(f.page,'original');const generations=await imageReplies(f.page);
    await f.page.evaluate(async id=>{const r=drawing.snapshot().history.find(r=>r.id===id);await editor.open('image',r.blob,'source.png',{sourceId:`record:${r.id}`,settings:r.params});editor.setModel('gpt-image-1.5');},source);
    await organize(f,[{id:'v1',label:'起点',image_ids:['#e1.1']}]);
    await f.page.evaluate(async()=>{editor.session.fields.prompt='soft light';editor.changed();await editor.run();});
    let r=await f.page.evaluate(()=>ask.retrospects.records.value.at(-1));
    assert.equal(r.value.nodes.length,2);assert.equal(r.value.nodes[1].recipe.prompt,'soft light');assert.equal(r.value.nodes[1].recipe.input.base.id,source);
    await f.page.evaluate(()=>{editor.session.fields.prompt='another direction';editor.changed();});
    await f.page.evaluate(()=>editor.run());
    r=await f.page.evaluate(()=>ask.retrospects.records.value.at(-1));
    assert.deepEqual(r.value.edges.map(e=>[e.from,e.to]),[['v1','v2'],['v1','v3']]);
    f.llm.push({body:body=>{const state=JSON.parse([...body.messages].reverse().find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('<workspace_state>')).content.match(/<workspace_state>\n([\s\S]+?)\n<\/workspace_state>/)[1]);return toolReply('draft','propose_draft',{base_hash:state.base_hash,base_image_id:'#e1.2',draft_title:'回退旧版修改',steps:[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'restored light'}]}).body;}});
    await f.page.evaluate(()=>ask.show({question:'退回第二版修改'}));await submitAsk(f.page);
    await f.page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
    const before=await f.page.evaluate(()=>({base:editor.session.baseId,prompt:editor.session.fields.prompt}));
    assert.deepEqual(await f.page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue)),[]);
    await f.page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
    assert.equal(await f.page.evaluate(()=>editor.session.baseId),2);
    assert.equal(await f.page.evaluate(()=>ask.retrospects.records.value.at(-1).cursor.nodeId),'v2');
    await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));
    assert.deepEqual(await f.page.evaluate(()=>({base:editor.session.baseId,prompt:editor.session.fields.prompt})),before);
    await f.page.evaluate(()=>ask.restoreDraft(ask.redoId.value));
    assert.equal(await f.page.evaluate(()=>editor.session.baseId),2);
    await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));
    await f.page.evaluate(async()=>{const r=ask.retrospects.records.value.at(-1);await ask.restoreRetrospect(r.value.nodes[1],r.pictureRefs,r.id);});
    assert.equal(await f.page.evaluate(()=>editor.session.baseId),2);
    await f.page.evaluate(async()=>{const r=ask.retrospects.records.value.at(-1);await ask.finalizeEvolution(r.id,r.value.nodes[1]);});
    assert.equal(await f.page.evaluate(()=>ask.retrospects.records.value.at(-1).status),'ended');assert.equal(generations(),2);
    assert.deepEqual(f.errors,[]);
  } finally {await f.context.close();}
});

test('CHAT evolution includes old branches, keeps exact samples after renumbering and restores/finalizes a concrete image',async()=>{
  const f=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings({images:false})});
  try {
    await bind(f.page);await seedAskChat(f.page);const generations=await imageReplies(f.page);
    await f.page.evaluate(()=>chat.mutate(c=>{const t=c.turns[0];t.versions.push({...structuredClone(t.versions[0]),id:'alternate-version'});t.selectedVersion=1;}));
    await organize(f,[{id:'v1',label:'起点',image_ids:['#c1.1']},{id:'v2',label:'尝试',image_ids:['#c2.1']},{id:'v3',label:'推进',image_ids:['#c3.1']}],[{from:'v1',to:'v2',summary:'调整'},{from:'v2',to:'v3',summary:'继续'}]);
    const root=await f.page.evaluate(()=>{const r=ask.retrospects.records.value.at(-1);return r.pictureRefs[r.value.nodes[0].cover].record_id;});
    await f.page.evaluate(async()=>{const r=ask.retrospects.records.value.at(-1);await ask.restoreRetrospect(r.value.nodes[0],r.pictureRefs,r.id);});
    assert.equal(await f.page.evaluate(()=>chat.snapshot().current.turns[0].selectedVersion),0);
    await f.page.evaluate(async()=>{chat.mutate(c=>c.baseFollows=false,true);chat.setPrompt('new branch');await chat.execute();});
    const r=await f.page.evaluate(()=>ask.retrospects.records.value.at(-1));
    assert.equal(r.value.nodes.length,4);assert.equal(r.value.edges.at(-1).from,'v1');
    assert.equal(r.cursor.nodeId,'v1','held CHAT base remains the evolution source after generation');
    assert.equal(r.pictureRefs[r.value.nodes[0].cover].record_id,root);
    assert.equal(new Set(r.value.nodes.flatMap(n=>n.image_ids.map(id=>r.pictureRefs[id].record_id))).size,4);
    await f.page.evaluate(async()=>{const r=ask.retrospects.records.value.at(-1);await ask.restoreRetrospect(r.value.nodes[1],r.pictureRefs,r.id);await ask.finalizeEvolution(r.id,r.value.nodes[1]);});
    assert.equal(await f.page.evaluate(()=>ask.retrospects.records.value.at(-1).status),'ended');assert.equal(generations(),1);
    assert.deepEqual(f.errors,[]);
  } finally {await f.context.close();}
});

test('IMAGE handoff continues in EDIT and records the exact frozen mask and explicit local composition',async()=>{
  const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false})});
  try {
    await bind(f.page);const source=await addImage(f.page,'source');const generations=await imageReplies(f.page);
    await organize(f,[{id:'v1',label:'起点',image_ids:['#h1']}]);
    const id=await f.page.evaluate(()=>ask.retrospects.records.value.at(-1).id);
    await f.page.evaluate(async source=>{const r=drawing.snapshot().history.find(r=>r.id===source);await editor.open('image',r.blob,'source.png',{sourceId:`record:${r.id}`,settings:r.params});editor.setModel('gpt-image-1.5');editor.setMode('inpaint');editor.patch({prompt:'adjust boundary'});
      const v=editor.snapshot().viewed,c=new OffscreenCanvas(v.width,v.height),g=c.getContext('2d');g.fillStyle='white';g.fillRect(v.width/4,v.height/4,v.width/2,v.height/2);await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');
    },source);
    assert.match(await f.page.evaluate(id=>ask.retrospects.get(id).boardId,id),/^edit:/);
    await f.page.evaluate(()=>editor.run());
    const evidence=await f.page.evaluate(async id=>{const raw=editor.snapshot().viewed;const merged=await editor.applyComparison(editor.session.id,raw.id,false),input=merged.params.evolutionInput;return {nodes:ask.retrospects.get(id).value.nodes.length,raw:raw.params.evolutionInput,input,rawId:raw.recordId,base:editor.session.baseId};},id);
    assert.ok(evidence.raw.mask.hash);assert.equal(evidence.raw.base.id,source);
    assert.equal(evidence.input.operation,'composite');assert.equal(evidence.input.base.id,evidence.rawId);assert.equal(evidence.input.references[0].id,source);
    assert.equal(evidence.input.mask.hash,evidence.raw.mask.hash);assert.equal(evidence.input.params.colorMatch,false);assert.equal(evidence.nodes,3);
    assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).cursor.nodeId,id),'v1','previewing or compositing does not replace the native EDIT base');
    assert.equal(evidence.base,1);assert.equal(generations(),1);assert.deepEqual(f.errors,[]);
  } finally {await f.context.close();}
});
