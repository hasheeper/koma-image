import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, hosts, addImage, askSettings, toolReply, textReply, submitAsk, seedAskChat, proposal } from './helpers/ask-fixture.mjs';
useAskFixture();

async function imageReplies(page) {
  const b64=await page.evaluate(async()=>{const c=new OffscreenCanvas(256,384);const g=c.getContext('2d');g.fillStyle='#6688aa';g.fillRect(0,0,256,384);g.fillStyle='#ccaa88';g.fillRect(50,80,80,120);return btoa(String.fromCharCode(...new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer())));});
  let count=0;
  await page.route(/\/images\/(?:edits|generations)$/,route=>{count++;return route.fulfill({json:{data:[{b64_json:b64}]}});});
  return ()=>count;
}
async function organize(f,nodes,edges=[],scope="current") {
  f.llm.push(toolReply('read','get_recipe_clusters',{scope}),toolReply('graph','show_retrospect',{retrospect_title:'工作区演进',nodes,edges}),textReply('已整理。'));
  await f.page.evaluate(()=>ask.show({question:'请整理当前版本演进'}));await submitAsk(f.page);
  await f.page.waitForFunction(()=>!ask.running.value&&ask.retrospects.records.value.length>0);
}

test('evolution images survive automatic history eviction, restore and finalize; explicit deletion still wins',async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false}),standard:true});
 try {
  await bind(f.page);await addImage(f.page,'original recipe');await addImage(f.page,'second recipe');
  await f.page.evaluate(async()=>{const {DEFAULTS}=await import('/src/domain/drawing.ts');for(const r of drawing.snapshot().history)r.params={...structuredClone(DEFAULTS),boardId:drawing.snapshot().activeBoardId,basePrompt:r.params.basePrompt,baseNegative:'',localCharacters:[]};});
  await organize(f,[{id:'v1',label:'起点',image_ids:['#h1']},{id:'v2',label:'修改',image_ids:['#h2']}],[{from:'v1',to:'v2',summary:'修改'}]);
  const oldUrl=await f.page.evaluate(()=>{const r=ask.retrospects.records.value.at(-1);return ask.pictureInfo('#h1',r.pictureRefs).url;});
  for(let i=0;i<35;i++)await addImage(f.page,`later ${i}`);
  const state=await f.page.evaluate(async()=>{
   const r=ask.retrospects.records.value.at(-1),info=ask.pictureInfo('#h1',r.pictureRefs);
   await ask.restoreRetrospect(r.value.nodes[0],r.pictureRefs,r.id);
   return {length:drawing.snapshot().history.length,url:info.url,bytes:(await(await fetch(info.url)).blob()).size,prompt:drawing.snapshot().form.prompt,navigations:performance.getEntriesByType('navigation').length};
  });
  assert.equal(state.length,37);assert.equal(state.url,oldUrl);assert.ok(state.bytes>0);assert.equal(state.prompt,'original recipe');assert.equal(state.navigations,1);
  f.llm.push(toolReply('old','get_meta',{id:'#h1'}),textReply('旧图参数仍可读。'));
  await f.page.evaluate(()=>ask.show({question:'查看 #h1 参数'}));await submitAsk(f.page);await f.page.waitForFunction(()=>!ask.running.value);
  assert.match(f.calls.at(-1).body.messages.filter(m=>m.role==='tool').at(-1).content,/original recipe/);
  await f.page.evaluate(async()=>{const r=ask.retrospects.records.value.at(-1);await ask.finalizeEvolution(r.id,r.value.nodes[0]);});
  assert.equal(await f.page.evaluate(()=>drawing.snapshot().favorites[0].params.basePrompt),'original recipe');
  await f.page.evaluate(()=>{const r=ask.retrospects.records.value.at(-1);drawing.remove(r.pictureRefs['#h2'].record_id);});
  const removed=await f.page.evaluate(async()=>{const r=ask.retrospects.records.value.at(-1);let error='';try{await ask.restoreRetrospect(r.value.nodes[1],r.pictureRefs,r.id);}catch(e){error=e.message;}return {info:ask.pictureInfo('#h2',r.pictureRefs),error};});
  assert.equal(removed.info?.parametersUnavailable,true,'same bytes may be previewed through another surviving record, never used as the deleted recipe');
  assert.match(removed.error,/原记录已失效/);
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('ordinary ASK references keep recipes and previews but do not pin old IMAGE originals',async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false})});
 try {
  await bind(f.page);await addImage(f.page,'referenced');
  f.llm.push(toolReply('old','get_meta',{id:'#h1'}),textReply('请保留 #h1 的方向。'));
  await f.page.evaluate(()=>ask.show({question:'查看 #h1'}));await submitAsk(f.page);await f.page.waitForFunction(()=>!ask.running.value);
  const held=await f.page.evaluate(()=>({id:drawing.snapshot().history[0].id,url:drawing.url(drawing.snapshot().history[0]),conversation:ask.conversationId.value}));
  await f.page.evaluate(()=>drawing.patch({historyLimit:1}));
  await addImage(f.page,'newer');
  const info=await f.page.evaluate(()=>ask.pictureInfo('#h1'));
  assert.equal(info.thumbnailOnly,true);assert.ok(info.url);
  assert.equal(await f.page.evaluate(id=>!!drawing.original(id),held.id),false);
  assert.equal(await f.page.evaluate(async url=>{try{await fetch(url);return true;}catch{return false;}},held.url),false);
  f.llm.push(proposal([{kind:'chat_handoff',images:['#h1'],options:{},text:'continue'}],'交接旧图'),textReply('该图只保留缩略图与配方。'));
  await f.page.evaluate(()=>ask.show({question:'将 #h1 交接到 CHAT'}));await submitAsk(f.page);
  await f.page.waitForFunction(()=>!ask.running.value);
  assert.equal(await f.page.evaluate(()=>ask.draftPlan.value),null);
  assert.match(f.calls.at(-1).body.messages.filter(m=>m.role==='tool').at(-1).content,/原图已释放/);
  await f.page.evaluate(id=>ask.deleteConversation(id),held.conversation);
  assert.equal(await f.page.evaluate(()=>ask.pictureInfo('#h1')?.thumbnailOnly),true,'history belongs to drawing, not the ASK conversation');
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('EDIT referenced versions survive its history limit and still allow explicit removal',async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false})});
 try {
  await bind(f.page);const source=await addImage(f.page,'source');await imageReplies(f.page);
  await f.page.evaluate(async id=>{const r=drawing.snapshot().history.find(r=>r.id===id);await editor.open('image',r.blob,'source.png',{sourceId:`record:${r.id}`,settings:r.params});editor.setModel('gpt-image-1.5');editor.patch({prompt:'retained edit'});await editor.run();},source);
  f.llm.push(toolReply('meta','get_meta',{id:'#e1.2'}),textReply('保留 #e1.2。'));
  await f.page.evaluate(()=>ask.show({question:'读取 #e1.2'}));await submitAsk(f.page);await f.page.waitForFunction(()=>!ask.running.value);
  await f.page.evaluate(async()=>{drawing.patch({editorHistoryLimit:3});for(let i=0;i<5;i++){editor.patch({prompt:`other ${i}`});await editor.run();}});
  assert.ok(await f.page.evaluate(()=>ask.pictureInfo('#e1.2')));
  const ids=await f.page.evaluate(()=>editor.session.versions.map(v=>v.id));assert.ok(ids.includes(2));assert.ok(!ids.includes(3));
  await f.page.evaluate(()=>editor.remove(2));
  assert.equal(await f.page.evaluate(()=>ask.pictureInfo('#e1.2')),null);
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});


async function trunk(f) {
 await bind(f.page);const source=await addImage(f.page,'1.35::artist::, 2girls, gothic office');
 await f.page.evaluate(async()=>{const {DEFAULTS}=await import('/src/domain/drawing.ts');const r=drawing.snapshot().history[0];r.params={...structuredClone(DEFAULTS),boardId:drawing.snapshot().activeBoardId,basePrompt:'1.35::artist::, 2girls, gothic office',baseNegative:'lowres',localCharacters:[]};});
 const png=await f.page.evaluate(async()=>[...new Uint8Array(await drawing.snapshot().history[0].blob.arrayBuffer())]);let generated=0;
 await f.page.route(`https://${hosts.image}/**`,route=>{if(!/\/(generate|generate-image|tools\/run)$/.test(new URL(route.request().url()).pathname))return route.fallback();generated++;return route.fulfill({contentType:'image/png',body:Buffer.from(png)});});
 await organize(f,[{id:'v1',label:'原始构图',image_ids:['#h1']}]);
 return {source,id:await f.page.evaluate(()=>ask.retrospects.records.value.at(-1).id),count:()=>generated};
}
test('IMAGE main stage with EDIT workshop delivery, append, next, exact native locate and shared undo',async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false}),standard:true,chatModel:true});
 try{
  const {source,id,count}=await trunk(f);
  await f.page.evaluate(async source=>{const r=drawing.snapshot().history.find(r=>r.id===source);await editor.open('image',r.blob,'source.png',{sourceId:`record:${r.id}`,settings:r.params});editor.setModel('gpt-image-2');editor.patch({prompt:'soften eyes'});},source);
  let tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.workshops.length,1);assert.equal(tree.value.nodes.length,1);assert.ok(!tree.boardId.startsWith('edit:'));
  await f.page.evaluate(id=>{ask.hide();ask.retrospects.open(id);},id);const panel=f.page.getByRole('dialog',{name:'工作区演进'});await panel.waitFor();
  assert.equal(await panel.locator('[data-kind="workshop"]').count(),1);assert.match(await panel.locator('[data-kind="workshop"]').textContent(),/EDIT.*待交付/s);
  await panel.getByRole('button',{name:'打开工坊',exact:true}).click();await panel.waitFor({state:'hidden'});
  await f.page.evaluate(()=>editor.run());tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.value.nodes.length,1);assert.equal(tree.workshops[0].results.length,1);
  await f.page.getByRole('button',{name:'记入演进',exact:true}).click();await f.page.getByRole('menuitem',{name:'阶段成品',exact:true}).click();
  await f.page.waitForFunction(id=>ask.retrospects.get(id).value.nodes.length===2,id);tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);const first=tree.value.nodes[1].cover;assert.equal(tree.cursor.nodeId,'v1');
  const editBoard=await f.page.evaluate(()=>editor.session.id),ticketId=tree.workshops[0].id;
  await f.page.evaluate(id=>ask.retrospects.open(id),id);await panel.waitFor();
  assert.equal(await panel.locator('[data-kind="workshop"]').count(),0,'delivery removes the pending marker');
  const settled=await f.page.evaluate(async id=>{
   const t=ask.retrospects.get(id).workshops[0],before=editor.session.viewId;
   try{await ask.openWorkshop(id,t.id);return {error:'',before,after:editor.session.viewId};}
   catch(e){return {error:e.message,before,after:editor.session.viewId};}
  },id);
  assert.match(settled.error,/当前没有待交付结果/);assert.equal(settled.after,settled.before,'settled entry cannot open a historical result');
  await f.page.evaluate(()=>ask.retrospects.close());
  assert.equal(await f.page.getByRole('button',{name:'已记入 v2',exact:true}).count(),1);
  await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).value.nodes.length,id),1);await f.page.evaluate(()=>ask.restoreDraft(ask.redoId.value));
  await f.page.evaluate(async()=>{editor.patch({prompt:'repair logo'});await editor.run();});assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).value.nodes.length,id),2);
  tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);
  assert.equal(tree.workshops.length,1);assert.equal(tree.workshops[0].id,ticketId);
  const pendingResult=tree.workshops[0].results.at(-1);
  await f.page.evaluate(id=>{
   const r=ask.retrospects.get(id),old=r.value.nodes[1].cover;
   editor.locate(r.pictureRefs[old].record_id);ask.retrospects.open(id);
  },id);
  await panel.waitFor();assert.equal(await panel.locator('[data-kind="workshop"]').count(),1);
  await panel.getByRole('button',{name:'打开工坊',exact:true}).click();await panel.waitFor({state:'hidden'});
  assert.equal(await f.page.evaluate(()=>editor.session.id),editBoard,'continuing work reuses the same EDIT board');
  assert.equal(await f.page.evaluate(()=>editor.session.versions.find(v=>v.id===editor.session.viewId).recordId),pendingResult,'pending entry overrides the selected historical view with the exact new result');
  await f.page.getByRole('button',{name:'记入演进',exact:true}).click();await f.page.getByRole('menuitem',{name:'追加到本阶段 v2'}).click();await f.page.waitForFunction(id=>ask.retrospects.get(id).value.nodes[1].image_ids.length===2,id);
  tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.value.nodes[1].image_ids[0],first);assert.notEqual(tree.value.nodes[1].cover,first);
  await f.page.evaluate(async()=>{editor.patch({prompt:'cool rim'});await editor.run();});await f.page.getByRole('button',{name:'记入演进',exact:true}).click();await f.page.getByRole('menuitem',{name:'作为下一步',exact:true}).click();
  await f.page.waitForFunction(id=>ask.retrospects.get(id).value.nodes.length===3,id);tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.deepEqual(tree.value.edges.map(e=>[e.from,e.to]),[['v1','v2'],['v2','v3']]);assert.equal(tree.cursor.nodeId,'v1');
  await f.page.evaluate(id=>ask.retrospects.open(id,'v3'),id);await panel.waitFor();assert.equal(await panel.locator('.recipe-review .change-hunk').count(),0);
  assert.match(await panel.locator('.recipe-review').textContent(),/原始输入与操作/);
  const oldBase=await f.page.evaluate(()=>editor.session.baseId);await f.page.evaluate(async id=>{const r=ask.retrospects.get(id);await ask.restoreRetrospect(r.value.nodes[1],r.pictureRefs,id);},id);assert.equal(await f.page.evaluate(()=>editor.session.baseId),oldBase);
  await f.page.evaluate(async id=>{const r=ask.retrospects.get(id);await ask.restoreRetrospect(r.value.nodes[0],r.pictureRefs,id);},id);assert.equal(await f.page.evaluate(()=>location.hash),'#/image');assert.equal(await f.page.evaluate(()=>drawing.snapshot().form.prompt),'1.35::artist::, 2girls, gothic office');assert.equal(count(),3);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('CHAT exact records and repeated identical pixels support delivery and EDIT relay without IMAGE cursor takeover',async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false}),standard:true,chatModel:true});
 try{
  const {source,id}=await trunk(f);
  await f.page.evaluate(async source=>{const r=drawing.snapshot().history.find(r=>r.id===source);await chat.writeHandoffDraft({model:'gpt-image-2',options:{},text:'add gold logo',images:[{blob:r.blob,name:'source.png',lineage:{via:'image',parent_record_id:r.id}}]});location.hash='#/chat';await chat.execute();},source);
  let tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.value.nodes.length,1);assert.equal(tree.workshops[0].results.length,1);const first=tree.workshops[0].results[0];
  await f.page.evaluate(async({id,first})=>{const r=ask.retrospects.get(id);await ask.deliverEvolution(id,r.workshops[0].id,first,'append');chat.setPrompt('refine gold');await chat.execute();},{id,first});
  tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.value.nodes.length,2);assert.equal(tree.workshops[0].results.length,2);assert.notEqual(tree.workshops[0].results[1],first);
  const second=tree.workshops[0].results[1];
  await f.page.evaluate(async({id,second})=>{const c=chat.snapshot().current,t=c.turns.at(-1),v=t.versions[t.selectedVersion],a=v.blocks.find(b=>b.type==='image').assetId;await editor.open('chat',chat.assets.get(a).blob,'second.png',{conversationId:c.id,sourceId:`record:${second}`});},{id,second});
  tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.value.nodes[1].image_ids.length,2);assert.equal(tree.workshops.length,2);assert.equal(tree.workshops[1].sourceRecordId,second);assert.equal(tree.cursor.nodeId,'v1');
  await f.page.evaluate(async()=>{editor.setModel('gpt-image-2');editor.patch({prompt:'eye polish'});await editor.run();});
  tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.workshops[1].results.length,1);assert.equal(tree.value.nodes.length,2);
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('ASK handoff writes and undoes workshop association with the native target; EDIT local rollback needs no tree',async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false}),standard:true,chatModel:true});
 try{
  const {id}=await trunk(f);
  f.llm.push(proposal([{kind:'chat_handoff',images:['#h1'],model:'gpt-image-2',options:{},text:'add title'}],'交接成品'));
  await f.page.evaluate(()=>ask.show({question:'将 #h1 交接 CHAT'}));await submitAsk(f.page);await f.page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
  await f.page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));
  assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).workshops.length,id),1);
  await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).workshops.length,id),0);
  await f.page.evaluate(()=>ask.restoreDraft(ask.redoId.value));assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).workshops.length,id),1);
  await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));
  await f.page.evaluate(async id=>{ask.retrospects.setStatus(id,'ended');const r=drawing.snapshot().history[0];await editor.open('image',r.blob,'source.png',{sourceId:`record:${r.id}`,settings:r.params});editor.setModel('gpt-image-2');editor.patch({prompt:'first polish'});await editor.run();editor.patch({prompt:'later manual draft'});},id);
  f.llm.push({body:body=>{const state=JSON.parse([...body.messages].reverse().find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('<workspace_state>')).content.match(/<workspace_state>\n([\s\S]+?)\n<\/workspace_state>/)[1]);return toolReply('rollback','propose_draft',{base_hash:state.base_hash,base_image_id:'#e1.2',draft_title:'回退后调整',steps:[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'return to polish'}]}).body;}});
  await f.page.evaluate(()=>ask.show({question:'回退 #e1.2 修改'}));await submitAsk(f.page);await f.page.waitForFunction(()=>!ask.running.value&&!!ask.draftPlan.value);
  assert.deepEqual(await f.page.evaluate(()=>ask.draftPlan.value.steps.filter(s=>s.issue).map(s=>s.issue)),[]);
  const before=await f.page.evaluate(()=>({base:editor.session.baseId,prompt:editor.session.fields.prompt}));
  await f.page.evaluate(()=>ask.applyDraft(ask.draftPlan.value.fingerprint));assert.equal(await f.page.evaluate(()=>editor.session.baseId),2);assert.equal(await f.page.evaluate(()=>editor.session.fields.prompt),'return to polish');
  await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));assert.deepEqual(await f.page.evaluate(()=>({base:editor.session.baseId,prompt:editor.session.fields.prompt})),before);
  assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).workshops.length,id),0);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('workshop finalization waits for favorite success, preserves native result, and shared undo reopens the ticket',async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false}),standard:true,chatModel:true});
 try{
  const {source,id}=await trunk(f);
  await f.page.evaluate(async source=>{const r=drawing.snapshot().history.find(r=>r.id===source);await editor.open('image',r.blob,'source.png',{sourceId:`record:${r.id}`,settings:r.params});editor.setModel('gpt-image-2');editor.patch({prompt:'final polish'});await editor.run();},source);
  const state=await f.page.evaluate(async id=>{const r=ask.retrospects.get(id),t=r.workshops[0],image=t.results[0],original=drawing.ensureFavorite;drawing.ensureFavorite=async()=>{throw new Error('test storage failed');};let error='';try{await ask.deliverEvolution(id,t.id,image,'append','final');}catch(e){error=e.message;}finally{drawing.ensureFavorite=original;}return {error,nodes:ask.retrospects.get(id).value.nodes.length,status:ask.retrospects.get(id).status};},id);
  assert.match(state.error,/storage failed/);assert.equal(state.nodes,1);assert.equal(state.status,'active');
  await f.page.evaluate(async id=>{const r=ask.retrospects.get(id),t=r.workshops[0];await ask.deliverEvolution(id,t.id,t.results[0],'append','final');},id);
  assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).status,id),'ended');assert.equal(await f.page.evaluate(()=>drawing.snapshot().favorites.length),1);
  await f.page.evaluate(()=>ask.undoDraft(ask.undoId.value));assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).status,id),'active');assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).value.nodes.length,id),1);assert.equal(await f.page.evaluate(()=>editor.session.versions.length),2);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('native IMAGE transfer and CHAT → EDIT → original CHAT relay preserve accepted sources and unavailable tickets can be cleared',{timeout:30000},async()=>{
 const f=await open('/#/image',{ready:'#prompt',ask:askSettings({images:false}),standard:true,chatModel:true});
 try{
  const {source,id}=await trunk(f);
  await f.page.evaluate(source=>{ask.hide();drawing.show(drawing.snapshot().history.find(r=>r.id===source),true);},source);
  await f.page.getByRole('button',{name:'在对话中改这张图',exact:true}).click();
  await f.page.waitForFunction(id=>ask.retrospects.get(id).workshops.length===1,id);
  await f.page.evaluate(async()=>{chat.setModel('gpt-image-2');chat.setPrompt('poster title');await chat.execute();});
  const first=await f.page.evaluate(id=>ask.retrospects.get(id).workshops[0].results[0],id);assert.ok(first);
  await f.page.evaluate(async first=>{const c=chat.snapshot().current,t=c.turns.at(-1),v=t.versions[t.selectedVersion],a=v.blocks.find(b=>b.type==='image').assetId;await editor.open('chat',chat.assets.get(a).blob,'poster.png',{conversationId:c.id,sourceId:`record:${first}`});editor.setModel('gpt-image-2');editor.patch({prompt:'repair text'});await editor.run();},first);
  let tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.value.nodes.length,2);const edited=tree.workshops[1].results[0];assert.ok(edited);
  const main=await f.page.evaluate(()=>chat.snapshot().current.mainId);
  await f.page.evaluate(()=>editor.useResult());
  tree=await f.page.evaluate(id=>ask.retrospects.get(id),id);assert.equal(tree.value.nodes.length,3);assert.equal(tree.workshops.length,3);assert.equal(tree.workshops[2].sourceRecordId,edited);assert.equal(tree.cursor.nodeId,'v1');assert.deepEqual(tree.value.edges.map(e=>[e.from,e.to]),[['v1','v2'],['v2','v3']]);
  assert.equal(await f.page.evaluate(()=>chat.snapshot().current.mainId),main,'returning an EDIT result retains CHAT base selection');
  await f.page.evaluate(async()=>{chat.setPrompt('finish texture');await chat.execute();});
  assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).workshops[2].results.length,id),1);
  const ticket=tree.workshops[2].id;
  await f.page.evaluate(()=>{const s=chat.snapshot();window.removeNativeChat=chat.remove(s.conversations.find(c=>c.id===s.current.id));});
  await f.page.getByRole('dialog',{name:/删除/}).getByRole('button',{name:'删除',exact:true}).click();
  await f.page.evaluate(()=>window.removeNativeChat);
  await f.page.evaluate(id=>ask.retrospects.open(id),id);
  const panel=f.page.getByRole('dialog',{name:'工作区演进'}),pending=panel.locator(`[data-node="${ticket}"]`);
  await pending.waitFor();assert.match(await pending.textContent(),/目标已失效/);assert.equal(await pending.getByRole('button',{name:'打开工坊'}).isDisabled(),true);
  await pending.getByRole('button',{name:'取消挂靠'}).click();await f.page.waitForFunction(({id,ticket})=>!ask.retrospects.get(id).workshops.some(t=>t.id===ticket),{id,ticket});
  assert.equal(await f.page.evaluate(id=>ask.retrospects.get(id).value.nodes.length,id),3);assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});
