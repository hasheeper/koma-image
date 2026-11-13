import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, toolReply, textReply, submitAsk, hosts, proposal } from './helpers/ask-fixture.mjs';
useAskFixture();
const graph = { retrospect_title: '并行探路', nodes: [{ id: 'v1', label: '基底阶段', image_ids: ['#h1','#h2'], primary_id: '#h2' }], edges: [] };
const branch = (label, text, extra = []) => ({ base_image_id: '#h1', label, description: '从早期样本尝试新的构图与互动', steps: [ { kind: 'prompt_patch', target: 'image.prompt', mode: 'rewrite', text }, ...extra ] });
async function seed(page) {
  await bind(page);
  await page.waitForFunction(() => drawing.snapshot().models.some(m => m.id === 'nai-diffusion-5-full'));
  return page.evaluate(async () => {
    const { DEFAULTS } = await import('/src/domain/drawing.ts'), { seedHistory } = await import('/tests/helpers/drawing-history.mjs');
    const c = new OffscreenCanvas(128,192), g = c.getContext('2d');
    for (let i = 1; i <= 2; i++) {
      g.fillStyle = i === 1 ? '#557b9c' : '#97784f'; g.fillRect(0,0,128,192); g.fillStyle = '#d5bd9d'; g.beginPath();g.arc(64,70,24,0,Math.PI*2);g.fill();g.fillRect(42,98,44,65);
      const roles = [{ id: 'c3', on: false, prompt: 'unused', negative: '', centers: [] }, { id: 'c12', on: true, prompt: i === 1 ? 'black hair' : 'silver hair', negative: '', centers: [] }];
      await seedHistory({ drawing, home }, await c.convertToBlob(), { width:128,height:192 }, { ...structuredClone(DEFAULTS), boardId:drawing.snapshot().activeBoardId, basePrompt:i===1?'blue dress, soft light':'red dress, dark light', baseNegative:'lowres', localCharacters: roles });
    }
    await drawing.patch({prompt:'CURRENT FORM',seed:'456',batchCount:1});
    return [...new Uint8Array(await (await c.convertToBlob()).arrayBuffer())];
  });
}
async function stage(f, replies) {
  f.llm.push(toolReply('read','get_recipe_clusters',{}),toolReply('tree','show_retrospect',graph),...replies);
  await f.page.evaluate(()=>ask.show({question:'从第一张准备几个不同方向的演进分支'})); await submitAsk(f.page);
  await f.page.waitForFunction(()=>!ask.running.value);
}

test('staged branches: sequential failure isolation, exact Diff, load undo, sibling generation and original position', async () => {
  const f=await open('/#/image',{ready:'.switcher',standard:true,ask:askSettings({images:false})});
  try {
    const png=await seed(f.page);let generations=0;
    await f.page.route(`https://${hosts.image}/**`,route=>{
      if(!/\/(generate|generate-image)$/.test(new URL(route.request().url()).pathname))return route.fallback();
      generations++;return route.fulfill({contentType:'image/png',body:Buffer.from(png)});
    });
    await stage(f,[toolReply('A','stage_evolution_branch',branch('桌边交接','blue dress, desk', [{kind:'prompt_patch',target:'image.char.c12.prompt',mode:'replace',anchor:'black',text:'pink'}])),
      toolReply('bad','stage_evolution_branch',{...branch('雨夜同行',''),steps:[{kind:'prompt_patch',target:'image.prompt',mode:'replace',anchor:'missing anchor',text:'rain'}]}),
      toolReply('B','stage_evolution_branch',branch('雨夜同行','blue dress, umbrella, rain')),
      toolReply('C','stage_evolution_branch',branch('窗边剪影','blue dress, window')),
      textReply('三个方向已准备好，可以先对照配方再载入。')]);
    const initial=await f.page.evaluate(()=>({r:ask.retrospects.records.value[0],form:drawing.snapshot().form,boards:drawing.snapshot().boards.length}));
    assert.equal(initial.r.value.nodes.length,4);assert.equal(initial.form.prompt,'CURRENT FORM');assert.equal(generations,0);assert.equal(initial.boards,1);
    assert.deepEqual(initial.r.value.edges.map(e=>e.from),['v1','v1','v1']);
    assert.equal(await f.page.locator('.ask-turn[data-status="done"]').count(),1);
    assert.match(f.calls[4].body.messages.filter(m=>m.role==='tool').at(-1).content,/anchor_not_found/);
    assert.equal(initial.r.value.nodes[1].staged.form.characters[1].prompt,'pink hair');
    f.llm.push(proposal([{kind:'prompt_patch',target:'image.prompt',mode:'append',text:', ordinary proposal'}],'保留待确认草稿'));
    await f.page.evaluate(()=>ask.show({question:'单独准备一份普通修改草稿'}));await submitAsk(f.page);
    await f.page.waitForFunction(()=>!ask.running.value&&ask.draftPlan.value?.title==='保留待确认草稿');
    await f.page.evaluate(id=>ask.retrospects.open(id,'v2'),initial.r.id);
    const panel=f.page.getByRole('dialog',{name:graph.retrospect_title});await panel.waitFor();
    assert.equal(await panel.locator('.version-node[data-kind="staged"]').count(),3);
    assert.equal(await panel.getByRole('button',{name:'大图',exact:true}).isDisabled(),true);
    assert.doesNotMatch(await panel.locator('.recipe-inspector').textContent(),/原记录已失效/);
    assert.match(await panel.getByRole('button',{name:'选择对比基准'}).getAttribute('aria-description'),/#h1/);
    assert.match(await panel.locator('[data-field="prompt"] .del .text').textContent(),/soft light/);
    assert.match(await panel.locator('[data-field="prompt"] .ins .text').textContent(),/desk/);
    await panel.getByRole('button',{name:'关闭配方',exact:true}).click();
    await panel.getByRole('button',{name:'关系图适应全部',exact:true}).click();
    const beforeDrag=await f.page.evaluate(id=>structuredClone(ask.retrospects.get(id).nodeLayout),initial.r.id);
    const dragBox=await panel.locator('[data-node="v2"] .node-media').boundingBox();
    await f.page.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2);await f.page.mouse.down();
    await f.page.mouse.move(dragBox.x+dragBox.width/2+50,dragBox.y+dragBox.height/2+20,{steps:6});await f.page.mouse.up();
    await f.page.waitForFunction(before=>ask.retrospects.records.value[0].nodeLayout.v2.x!==before,beforeDrag.v2.x);
    assert.deepEqual(await f.page.evaluate(id=>ask.retrospects.get(id).nodeLayout.v3,initial.r.id),beforeDrag.v3,'dragging a pending node does not move its sibling');
    await panel.getByRole('button',{name:'配方',exact:true}).click();
    const oldLayout=await f.page.evaluate(id=>structuredClone(ask.retrospects.get(id).nodeLayout),initial.r.id);
    // Test user placement through the persisted arrangement API; geometry is not a style contract.
    await f.page.evaluate(id=>ask.retrospects.arrange(id,{...ask.retrospects.get(id).nodeLayout,v2:{x:500,cy:260,z:4}}),initial.r.id);
    await panel.getByRole('button',{name:'载入画板',exact:true}).click();
    await f.page.waitForFunction(()=>ask.retrospects.records.value[0].cursor.kind==='staged');
    assert.equal(await f.page.evaluate(()=>drawing.snapshot().form.prompt),'blue dress, desk');
    assert.equal(await f.page.evaluate(()=>drawing.snapshot().form.seed),'456');
    assert.equal(generations,0);assert.equal(await panel.locator('.continuation-frame').count(),0);
    assert.equal(await f.page.evaluate(()=>ask.draftPlan.value?.title),'保留待确认草稿');
    await panel.getByRole('button',{name:'撤销载入',exact:true}).click();
    await f.page.waitForFunction(()=>drawing.snapshot().form.prompt==='CURRENT FORM');
    await panel.getByRole('button',{name:'重做载入',exact:true}).click();
    await f.page.waitForFunction(()=>drawing.snapshot().form.prompt==='blue dress, desk');
    await panel.getByRole('button',{name:'关闭演进'}).click();
    await f.page.evaluate(async()=>{await drawing.patch({prompt:'blue dress, desk, warm light',batchCount:2});await drawing.run();});
    let r=await f.page.evaluate(id=>ask.retrospects.get(id),initial.r.id);
    assert.equal(generations,2);assert.equal(r.value.nodes.length,4);assert.equal(r.value.nodes[1].kind,'generated');
    assert.equal(r.value.nodes[1].image_ids.length,2);assert.equal(r.value.nodes[1].recipe.prompt,'blue dress, desk, warm light');
    assert.deepEqual(r.nodeLayout.v2,{x:500,cy:260,z:4});assert.deepEqual(r.nodeLayout.v1,oldLayout.v1);
    assert.equal(r.cursor.nodeId,'v2');
    await f.page.evaluate(id=>ask.retrospects.open(id,'v3'),initial.r.id);await panel.waitFor();
    await panel.getByRole('button',{name:'载入画板',exact:true}).click();
    await f.page.waitForFunction(()=>ask.retrospects.records.value[0].cursor.nodeId==='v3');
    await panel.getByRole('button',{name:'关闭演进'}).click();
    await f.page.evaluate(async()=>{await drawing.patch({batchCount:1});await drawing.run();});
    r=await f.page.evaluate(id=>ask.retrospects.get(id),initial.r.id);
    assert.equal(r.value.nodes[2].kind,'generated');assert.equal(r.cursor.nodeId,'v3');assert.equal(r.value.nodes[3].kind,'staged');
    await f.page.evaluate(async id=>{const r=ask.retrospects.get(id);await ask.finalizeEvolution(id,r.value.nodes[2]);},initial.r.id);
    r=await f.page.evaluate(id=>ask.retrospects.get(id),initial.r.id);assert.equal(r.status,'ended');assert.equal(r.value.nodes[3].kind,'staged');
    assert.equal(r.final.nodeId,'v3');assert.deepEqual(f.errors,[]);
  }finally{await f.context.close();}
});

test('staged branches survive inference failure, release generation guard and cannot steal a later cursor',async()=>{
 const f=await open('/#/image',{ready:'.switcher',standard:true,ask:askSettings({images:false})});
 let release;
 try {
  const png=await seed(f.page);
  await stage(f,[toolReply('A','stage_evolution_branch',branch('分支甲','blue dress, A')),toolReply('B','stage_evolution_branch',branch('分支乙','blue dress, B')),{status:500,body:JSON.stringify({error:{message:'synthetic failure'}}),type:'application/json'}]);
  let r=await f.page.evaluate(()=>ask.retrospects.records.value[0]);assert.equal(r.value.nodes.length,3);
  assert.match(await f.page.locator('.ask-turn').textContent(),/已保留 2 个预设/);
  const wait=new Promise(resolve=>release=resolve);let arrived;const started=new Promise(resolve=>arrived=resolve);
  await f.page.route(`https://${hosts.image}/**`,async route=>{
   if(!/\/(generate|generate-image)$/.test(new URL(route.request().url()).pathname))return route.fallback();
   arrived();await wait;return route.fulfill({contentType:'image/png',body:Buffer.from(png)});
  });
  await f.page.evaluate(async id=>{await ask.loadEvolutionBranch(id,'v2');window.stagedRun=drawing.run();},r.id);await started;
  assert.deepEqual(await f.page.evaluate(id=>[...ask.retrospects.generatingNodes(id)],r.id),['v2']);
  assert.match(await f.page.evaluate(id=>{try{ask.removeEvolutionBranch(id,'v2');return '';}catch(e){return e.message;}},r.id),/正在生成/);
  await f.page.evaluate(id=>ask.loadEvolutionBranch(id,'v3'),r.id);
  release();await f.page.evaluate(()=>window.stagedRun);
  assert.deepEqual(await f.page.evaluate(id=>[...ask.retrospects.generatingNodes(id)],r.id),[]);
  r=await f.page.evaluate(id=>ask.retrospects.get(id),r.id);assert.equal(r.cursor.nodeId,'v3');assert.equal(r.cursor.kind,'staged');assert.equal(r.value.nodes[1].kind,'generated');
  await f.page.unroute(`https://${hosts.image}/**`);
  await f.page.route(`https://${hosts.image}/**`,route=>/\/(generate|generate-image)$/.test(new URL(route.request().url()).pathname)?route.fulfill({status:500,json:{error:'synthetic generation failure'}}):route.fallback());
  await f.page.evaluate(()=>drawing.run());
  const form=await f.page.evaluate(()=>drawing.snapshot().form.prompt);
  await f.page.evaluate(id=>ask.removeEvolutionBranch(id,'v3'),r.id);
  r=await f.page.evaluate(id=>ask.retrospects.get(id),r.id);assert.equal(r.cursor.nodeId,'v1');assert.equal(await f.page.evaluate(()=>drawing.snapshot().form.prompt),form);
  assert.equal(r.value.nodes.length,2);assert.deepEqual(f.errors,[]);
 }finally{release?.();await f.context.close();}
});
