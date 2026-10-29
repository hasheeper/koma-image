import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, submitAsk, open, anthropic, askSettings, generation, bind, drawer, addScene, toolReply, textReply, imageBlocks, scripted, seedAskChat } from "./helpers/ask-fixture.mjs";

useAskFixture();

test('ASK and IMAGE previews remain decodable across lookup, favorite reload and removal', async () => {
  const { page, context, errors, requests, llm } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    const id = await addScene(page);
    const preview = await page.evaluate(async () => {
      const record = drawing.snapshot().history[0];
      await drawing.toggleFavorite(record);
      const history = drawing.url(record, true);
      const askPreview = ask.pictureInfo('#h1').url;
      drawing.url(record, true);
      const decode = async url => { const img = new Image(); img.src = url; try { await img.decode(); return true; } catch { return false; } };
      return { history: await decode(history), ask: await decode(askPreview) };
    });
    assert.deepEqual(preview, { history: true, ask: true }, 'reading ASK must not revoke the history thumbnail, or vice versa');

    await addScene(page, 1);
    llm.push(toolReply('find', 'search_history', { query: 'landscape' }), textReply('找到 #h1。'));
    await page.evaluate(() => ask.show());
    await page.locator('#askPrompt').fill('查找 landscape');
    await submitAsk(page);
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    const candidates = drawer(page).getByRole('group', { name: '选择要分析的图片' });
    await candidates.locator('img').first().waitFor();
    await page.evaluate(async id => {
      window.thumbnailUrls = [document.querySelector(`#tray .tile[data-id="${id}"] img`).src, document.querySelector('.ask-pick button[aria-label="选择 #h1 继续提问"] img').src];
      drawing.show(drawing.snapshot().history.find(r => r.id === id), true);
      ask.pictureCandidates('#');
      drawing.remove(id);
      await drawing.reloadFavorites();
    }, id);
    const retained = await page.evaluate(async () => Promise.all(thumbnailUrls.map(async url => {
      const img = new Image(); img.src = url; try { await img.decode(); return true; } catch { return false; }
    })));
    assert.deepEqual(retained, [true, true], 'reloading unchanged favorites must not invalidate displayed URLs');
    await page.waitForFunction(() => [...document.querySelectorAll('#tray .tile img, .ask-pick img')].every(img => img.complete && img.naturalWidth > 0));

    await page.evaluate(id => drawing.remove(id), id);
    assert.equal(await page.evaluate(() => !!ask.pictureInfo('#f1')), true);
    await page.evaluate(async () => drawing.toggleFavorite(drawing.snapshot().favorites[0]));
    assert.equal(await page.evaluate(() => ask.pictureInfo('#f1')), null);
    await page.evaluate(id => drawing.remove(id), id);
    const released = await page.evaluate(async () => Promise.all(thumbnailUrls.map(async url => {
      try { await fetch(url); return false; } catch { return true; }
    })));
    assert.deepEqual(released, [true, true], 'the last owner removing the image still releases its preview');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK EDIT, CHAT and attachment previews survive IMAGE pruning and release with their owners', async () => {
  const { page, context, errors, requests } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await page.evaluate(() => chat.warm());
    await seedAskChat(page);
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(128, 192), g = canvas.getContext('2d');
      g.fillStyle = '#675390'; g.fillRect(0, 0, 128, 192);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      await editor.open('edit', blob, '合成编辑图.png');
      window.previewBoard = editor.session.id;
      await ask.addFiles([new File([blob], '合成附件.png', { type: 'image/png' })]);
      window.previewUrls = ['#e1', '#c1.1', '#a1'].map(label => ask.pictureInfo(label).url);
      ask.pictureCandidates('#');
      await drawing.patch({ prompt: 'only updates IMAGE' });
    });
    await addScene(page);
    const loaded = await page.evaluate(async () => Promise.all(previewUrls.map(async url => {
      const image = new Image(); image.src = url;
      try { await image.decode(); return true; } catch { return false; }
    })));
    assert.deepEqual(loaded, [true, true, true]);
    const removed = await page.evaluate(async () => {
      editor.removeBoard(previewBoard);
      ask.removeAttachment('#a1');
      return Promise.all([previewUrls[0], previewUrls[2]].map(async url => {
        try { await fetch(url); return false; } catch { return true; }
      }));
    });
    assert.deepEqual(removed, [true, true], 'removing EDIT/attachment resources releases their preview URLs');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// S1's pictures and model replies are synthetic; this verifies plumbing, not visual reasoning quality.
test('ASK A1 S1: metadata, full image, padded crop, stable snapshot, privacy retry and no generation', async () => {
  const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await addScene(page,1);
    await page.getByRole('button',{name:'Ask 这张图',exact:true}).click();
    await drawer(page).waitFor();
    assert.equal(calls.length,0,'entry only opens, never sends');
    llm.push(toolReply('m1','get_meta',{id:'#h1'}),toolReply('v1','view_image',{id:'#h1',spec:'look'}),toolReply('v2','view_image',{id:'#h1',spec:'crop',region:[25,15,50,30]}),textReply('**暖色光照影响了蓝色。** #h1 可先核对 `warm light`。'));
    await page.locator('#askPrompt').fill('为什么 #h1 的蓝色细节变成暖色？');
    await submitAsk(page);
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length,4);
    assert.equal(imageBlocks(calls[0].body).length,0);
    assert.equal(imageBlocks(calls[2].body).length,1);
    assert.equal(imageBlocks(calls[3].body).length,2);
    const images=imageBlocks(calls[3].body).map(x=>x.image_url.url);
    const sizes=await page.evaluate(async (urls)=>Promise.all(urls.map(async url=>{const img=new Image();img.src=url;await img.decode();return [img.naturalWidth,img.naturalHeight];})),images);
    assert.deepEqual(sizes[0],[768,576]);
    assert.ok(sizes[1][0]<=768 && sizes[1][1]<=768);
    assert.ok(images.every(url=>url.startsWith('data:image/webp;base64,')));
    const state=calls[0].body.messages.find(m=>m.role==='user').content;
    for(const call of calls.slice(1))assert.equal(call.body.messages.find(m=>m.role==='user').content,state);
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.prompt),'');
    const ref=drawer(page).locator('.ask-lead .ask-id').first();
    // A reply anchor remains an actual button and uses borrowed thumbnail URLs.
    const anyRef=drawer(page).locator('.ask-turn[data-status="done"] .ask-id').last();
    await anyRef.hover();await page.locator('.ask-preview').waitFor();
    await page.mouse.move(1,1);await page.locator('.ask-preview').waitFor({state:'hidden'});

    // Privacy retry must strip pixels from earlier successful turns as well.
    llm.push({status:403,type:'application/json',body:JSON.stringify({error:{message:'content_filter blocked'}})});
    await page.locator('#askPrompt').fill('再解释一次');await submitAsk(page);
    const failed=drawer(page).locator('.ask-turn[data-status="failed"]');await failed.waitFor();
    llm.push(toolReply('denied','view_image',{id:'#h1',spec:'look'}),textReply('本轮只能依据元数据。'));
    await failed.getByRole('button',{name:'仅发元数据重试',exact:true}).click();
    await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
    assert.equal(imageBlocks(calls.at(-1).body).length,0);
    assert.match(JSON.stringify(calls.at(-1).body),/本轮仅发送元数据/);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

for (const connection of ['chat', 'claude']) test(`ASK image retry modes: ordinary retry, visible privacy scope and explicit image recovery (${connection})`, async () => {
  const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings({connectionId:connection})});
  const refused=()=>({status:400,type:'application/json',body:JSON.stringify({error:{message:'content_filter blocked'}})});
  const unavailable=()=>({status:503,type:'application/json',body:JSON.stringify({error:{message:'temporarily unavailable'}})});
  const reply=(name,input)=>({body:scripted(connection,name,input)});
  const pixelCount=body=>{
    let count=0;
    function walk(value){
      if(!value||typeof value!=='object')return;
      if(value.type==='image'||value.type==='image_url')count++;
      for(const child of Object.values(value))if(Array.isArray(child))child.forEach(walk);else walk(child);
    }
    walk(body.messages);return count;
  };
  const stateInputs=body=>{
    const texts=[];
    function walk(value){
      if(typeof value==='string'){texts.push(value);return;}
      if(value&&typeof value==='object')for(const child of Object.values(value))walk(child);
    }
    walk(body.messages);
    return texts.flatMap(text=>[...text.matchAll(/<workspace_state>\s*([\s\S]*?)\s*<\/workspace_state>/g)].map(m=>JSON.parse(m[1]).image_input));
  };
  const submit=async question=>{await page.locator('#askPrompt').fill(question);await submitAsk(page);};
  const idle=()=>page.waitForFunction(()=>!ask.running.value);
  try {
    await bind(page);await addScene(page);
    await page.getByRole('button',{name:'Ask 这张图',exact:true}).click();
    const failed=drawer(page).locator('.ask-turn[data-status="failed"]');
    llm.push(refused());await submit('正常看图 #h1');await failed.waitFor();
    assert.equal(await failed.getByRole('button',{name:'重试',exact:true}).count(),1,'refusal still offers an ordinary retry');
    const first=calls[0].body;
    assert.equal(stateInputs(first).at(-1).enabled,true);
    llm.push(reply('view_image',{id:'#h1',spec:'look'}),reply());
    await failed.getByRole('button',{name:'重试',exact:true}).click();await idle();
    assert.equal(pixelCount(calls.at(-1).body),1,'ordinary retry can still send the requested image');
    assert.equal(await drawer(page).locator('.ask-image-mode').count(),0);

    // An explicit privacy retry strips previous pixels without changing the global switch.
    llm.push(refused());await submit('仅元数据测试');await failed.waitFor();
    assert.ok(pixelCount(calls.at(-1).body)>0,'the first attempt includes hot history pixels');
    const privacyStart=calls.length;
    llm.push(reply('get_state',{scope:'latest'}),reply('view_image',{id:'#h1',spec:'look'}),reply());
    await failed.getByRole('button',{name:'仅发元数据重试',exact:true}).click();await idle();
    assert.equal(await page.evaluate(()=>ask.settings.value.images),true);
    assert.equal(await drawer(page).locator('.ask-image-mode').textContent(),'仅元数据');
    for(const call of calls.slice(privacyStart)){
      assert.equal(pixelCount(call.body),0);
      const current=stateInputs(call.body).at(-1);
      assert.ok(current.enabled===false&&current.mode==='metadata_only','initial/latest state report the frozen image restriction');
      assert.deepEqual(call.body.tools,first.tools,'privacy mode preserves the static tool prefix');
    }
    assert.match(calls.at(-1).raw,/本轮仅发送元数据/,'even a model ignoring the state cannot bypass privacy');

    // A fresh question resumes normal image use; it does not inherit the prior restriction.
    llm.push(reply('view_image',{id:'#h1',spec:'look'}),reply());await submit('新问题继续看 #h1');await idle();
    assert.equal(stateInputs(calls.at(-1).body).at(-1).enabled,true);
    assert.ok(pixelCount(calls.at(-1).body)>0);

    // Repeated privacy retries stay private until the separately labelled image action.
    llm.push(refused());await submit('恢复图片测试');await failed.waitFor();
    llm.push(unavailable());await failed.getByRole('button',{name:'仅发元数据重试',exact:true}).click();await idle();
    assert.equal(await failed.locator('.ask-image-mode').textContent(),'仅元数据');
    assert.equal(pixelCount(calls.at(-1).body),0);
    llm.push(unavailable());await failed.getByRole('button',{name:'重试',exact:true}).click();await idle();
    assert.equal(pixelCount(calls.at(-1).body),0,'ordinary retry never silently re-enables a privacy-limited turn');
    await page.evaluate(()=>ask.setImages(false));
    assert.equal(await failed.getByRole('button',{name:'发送图片并重试',exact:true}).count(),0);
    const before=calls.length;
    await page.evaluate(()=>ask.retry(ask.entries.value.at(-1).id,'images'));
    assert.equal(calls.length,before,'explicit image recovery still respects the global image switch');
    await page.evaluate(()=>ask.setImages(true));
    await failed.getByRole('button',{name:'发送图片并重试',exact:true}).waitFor();

    llm.push(reply('view_image',{id:'#h1',spec:'look'}),reply());
    await failed.getByRole('button',{name:'发送图片并重试',exact:true}).click();await idle();
    assert.equal(await failed.count(),0);
    assert.ok(pixelCount(calls.at(-1).body)>0);
    assert.equal(stateInputs(calls.at(-1).body).at(-1).enabled,true);
    assert.equal(await drawer(page).locator('.ask-turn').last().locator('.ask-image-mode').count(),0);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A1 S2: explicit two-picture selection, parameter diff, contact sheet, candidates and locate',async()=>{
 const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);const first=await addScene(page),second=await addScene(page,1);
  await page.getByRole('button',{name:'对比',exact:true}).click();
  await page.getByRole('button',{name:'选择 #h1 对比',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Ask Diff',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'选择 #h2 对比',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.library-pick[aria-pressed="true"]').length===2);
  assert.equal(await page.evaluate(()=>drawing.snapshot().current.id),second,'selecting does not replace viewing');
  await page.waitForTimeout(100);

  await page.getByRole('button',{name:'Ask Diff',exact:true}).click();
  assert.match(await page.locator('#askPrompt').inputValue(),/#h1.*#h2/);
  assert.equal(calls.length,0);
  llm.push(toolReply('d1','diff_meta',{a:'#h1',b:'#h2'}),toolReply('s1','view_sheet',{ids:['#h1','#h2']}),textReply('**#h2 增加了暖色光。** Scale 也从 5 改为 7；#h1 保留了蓝色。'));
  await submitAsk(page);
  await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
  assert.match(JSON.stringify(calls[1].body),/warm light/);
  assert.equal(imageBlocks(calls.at(-1).body).length,1);

  await drawer(page).locator('.ask-turn[data-status="done"] .ask-id').last().click();
  assert.equal(await page.evaluate(()=>drawing.snapshot().current.id),first);

  llm.push(toolReply('find','search_history',{query:'landscape'}),textReply('找到两张，选一张继续。'));
  await page.locator('#askPrompt').fill('找一张之前的 landscape');await submitAsk(page);
  await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
  const candidates=drawer(page).getByRole('group',{name:'选择要分析的图片'});
  assert.equal(await candidates.getByRole('button').count(),2);
  const count=calls.length;
  await candidates.getByRole('button',{name:'选择 #h1 继续提问',exact:true}).click();
  assert.equal(calls.length,count);
  assert.equal(await page.locator('#askPrompt').inputValue(),'请分析 #h1');
  await page.evaluate(id=>drawing.remove(id),first);
  assert.equal(await candidates.getByRole('button',{name:'选择 #h1 继续提问',exact:true}).isDisabled(),true);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A1 crop failure: sheet does not unlock crop, the reason stays visible and later full-image views succeed', async () => {
  const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await addScene(page); await addScene(page,1);
    await page.locator('#askLauncher').click();
    llm.push(toolReply('first-look','view_image',{id:'#h1',spec:'look'}),textReply('已查看 #h1 全图。'));
    await page.locator('#askPrompt').fill('先查看 #h1'); await submitAsk(page);
    await page.waitForFunction(()=>!ask.running.value);
    llm.push(
      toolReply('sheet','view_sheet',{ids:['#h1','#h2']}),
      toolReply('diff','diff_meta',{a:'#h1',b:'#h2'}),
      toolReply('needs-full','view_image',{id:'#h2',spec:'crop',region:[25,15,50,30]}),
      toolReply('crop-first','view_image',{id:'#h1',spec:'crop',region:[25,15,50,30]}),
      toolReply('look-second','view_image',{id:'#h2',spec:'look'}),
      textReply('已补看 #h2 全图，继续依据实际返回的图片分析。'),
    );
    await page.locator('#askPrompt').fill('对比 #h1 和 #h2 的细节'); await submitAsk(page);
    await page.waitForFunction(()=>!ask.running.value);
    const comparison=drawer(page).locator('.ask-turn').nth(1), rows=comparison.locator('.ask-tool');
    assert.deepEqual(await rows.evaluateAll(nodes=>nodes.map(n=>n.dataset.state)),['done','done','error','done','done']);
    const reason='裁切 #h2 前请先用 glance 或 look 查看该图全图（拼图不计入单图查看）';
    assert.equal(await comparison.locator('.ask-tool-reason').textContent(),reason);
    assert.equal(await comparison.locator('.ask-tool-reason').isVisible(),true);
    assert.equal(calls[5].body.messages.find(m=>m.tool_call_id==='needs-full').content,reason,'the UI and model receive the same cause');
    assert.equal(imageBlocks(calls.at(-1).body).length,4,'the rejected crop adds no pixels');

    llm.push(toolReply('bad-region','view_image',{id:'#h2',spec:'crop',region:[90,0,20,20]}),textReply('裁切坐标超出图片，基于已有全图回答。'));
    await page.locator('#askPrompt').fill('再查看 #h2 的局部'); await submitAsk(page);
    await page.waitForFunction(()=>!ask.running.value);
    const invalid=drawer(page).locator('.ask-turn').nth(2).locator('.ask-tool-reason');
    assert.match(await invalid.textContent(),/裁切区域须为图内的 0–100 百分比/);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await invalid.scrollIntoViewIfNeeded();

    }
    assert.equal(calls.length,10,'there are only the explicitly scripted tool rounds');
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('ASK A1 vision: real resize/crop/cache, four-call and pixel/byte ceilings, disposal, zero model requests',async()=>{
 const {page,context,requests,errors,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  const results=await page.evaluate(async()=>{
   const {createVision}=await import('/src/ask/vision.ts');
   const canvas=new OffscreenCanvas(1600,1200),g=canvas.getContext('2d');
   g.fillStyle='#254568';g.fillRect(0,0,1600,1200);
   const blob=await canvas.convertToBlob({type:'image/png'});
   const nativeDecode=window.createImageBitmap;
   let decoded=0,closed=0;
   window.createImageBitmap=async(...args)=>{
    const bitmap=await nativeDecode(...args),close=bitmap.close.bind(bitmap);
    decoded++;bitmap.close=()=>{closed++;close();};return bitmap;
   };
   const p={id:'one',label:'#h1',aliases:['#h1'],createdAt:1,params:{},size:{width:1600,height:1200},blob};
   const v=createVision(), signal=new AbortController().signal;
   const context=()=>({signal,metadataOnly:false,budget:{calls:0,pixels:0,bytes:0},viewed:new Set()});
   const c=context(), failures=[];
   try{await v.image(p,'crop',[10,10,20,20],c);}catch(e){failures.push(e.message);}
   const a=await v.image(p,'glance',undefined,c), b=await v.image(p,'glance',undefined,c);
   await v.image(p,'crop',[10,10,20,20],c);const resent=await v.image(p,'glance',undefined,c,true);await v.image(p,'glance',undefined,c,true);
   try{await v.image(p,'glance',undefined,c,true);}catch(e){failures.push(e.message);}
   const pixels=context();await v.image(p,'look',undefined,pixels,true);await v.image(p,'look',undefined,pixels,true);await v.image(p,'look',undefined,pixels,true);
   try{await v.image(p,'look',undefined,pixels,true);}catch(e){failures.push(e.message);}
   const bytes=context();bytes.budget.bytes=399999;
   try{await v.image(p,'glance',undefined,bytes);}catch(e){failures.push(e.message);}
   const cancelled=context();const abort=new AbortController();abort.abort();cancelled.signal=abort.signal;
   try{await v.image(p,'glance',undefined,cancelled);}catch(e){failures.push(e.name);}
   // Eviction must release the cache's derived image and require a fresh decode.
   for(let n=0;n<17;n++)await v.image({...p,id:`evict-${n}`},'glance',undefined,context());
   const beforeDecode=decoded;
   await v.image(p,'glance',undefined,context());
   const evicted=decoded===beforeDecode+1;
   const during=context(),abortDuring=new AbortController();during.signal=abortDuring.signal;
   const pending=v.image({...p,id:'cancel-during-decode'},'look',undefined,during);
   abortDuring.abort();
   try{await pending;}catch(e){failures.push(e.name);}
   v.dispose();try{await v.image(p,'glance',undefined,context());}catch(e){failures.push(e.message);}
   window.createImageBitmap=nativeDecode;
   return {failures,calls:c.budget.calls,cache:a.image.data===resent.image.data,duplicate:b.duplicate,pixels:a.pixels,bytesUnchanged:bytes.budget.bytes,decoded,closed,evicted};
  });
  assert.match(results.failures[0],/先用 glance 或 look/);
  assert.match(results.failures[1],/4 次/);
  assert.match(results.failures[2],/预算/);assert.match(results.failures[3],/预算/);
  assert.equal(results.failures[4],'AbortError');assert.equal(results.failures[5],'AbortError');assert.match(results.failures[6],/已关闭/);
  assert.equal(results.decoded,results.closed,'every bitmap closes, including cancellation');assert.equal(results.evicted,true);
  assert.equal(results.calls,4);assert.equal(results.cache,true);assert.equal(results.duplicate,true);assert.equal(results.pixels,384*288);
  assert.equal(results.bytesUnchanged,399999);assert.equal(calls.length,0);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A1 Anthropic: streamed visual tool, WebP tool_result, cache boundaries and no generation',async()=>{
 const {page,context,requests,errors,llm,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings({connectionId:'claude'})});
 try{
  await bind(page);await addScene(page);
  llm.push({body:anthropic(
   {type:'message_start',message:{id:'v1',usage:{input_tokens:60,output_tokens:1}}},
   {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'view1',name:'view_image',input:{}}},
   {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"id":"#h1",'}},
   {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'"spec":"glance"}'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:20}},
   {type:'message_stop'},
  )},{body:anthropic(
   {type:'message_start',message:{id:'v2',usage:{input_tokens:180,cache_read_input_tokens:1200,output_tokens:1}}},
   {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
   {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'#h1 的蓝色块已查看。'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:18}},
   {type:'message_stop'},
  )});
  await page.getByRole('button',{name:'Ask 这张图',exact:true}).click();
  await page.locator('#askPrompt').fill('查看 #h1');await submitAsk(page);
  await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
  assert.equal(calls.length,2);
  const [first,second]=calls, result=second.body.messages.at(-1).content[0];
  assert.equal(second.headers['x-api-key'],'synthetic-claude');
  assert.equal(second.headers['anthropic-dangerous-direct-browser-access'],'true');
  assert.equal(result.type,'tool_result');assert.equal(result.tool_use_id,'view1');
  const picture=result.content.find(b=>b.type==='image');
  assert.equal(picture.source.media_type,'image/webp');assert.equal(picture.source.type,'base64');
  assert.equal(Buffer.from(picture.source.data,'base64').subarray(8,12).toString(),'WEBP');
  assert.deepEqual(second.body.system,first.body.system);assert.deepEqual(second.body.tools,first.body.tools);
  assert.equal(second.body.tools.at(-1).cache_control.type,'ephemeral');
  assert.equal(second.body.system.at(-1).cache_control.type,'ephemeral');
  assert.equal(result.cache_control.type,'ephemeral');
  assert.equal(JSON.stringify(second.body).includes('"viewed"'),false,'local provenance stays off wire');
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test("ASK A1 entries:, collapsed history, touch selection and Ask Why only prefills",async()=>{
 const {page,context,requests,errors,calls}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);await addScene(page);await addScene(page,1);
  {
      const width = 1440;
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(450);
   assert.equal(await page.getByRole('button',{name:'Ask 这张图',exact:true}).isVisible(),true);

   await page.getByRole('button',{name:'Ask 这张图',exact:true}).click();await drawer(page).waitFor();
   await drawer(page).getByRole('button',{name:'收起 ASK',exact:true}).click();await drawer(page).waitFor({state:'hidden'});
  }
  await page.locator('#histToggle').click();await page.waitForTimeout(400);
  await page.locator('#histToggle').click();
  await page.setViewportSize({width:390,height:900});
  await page.evaluate(()=>{
   const p=document.body.__vue_app__._instance.provides;
   p[Object.getOwnPropertySymbols(p).find(k=>k.description==='app-shell')].image.menuOpen=true;
  });
  await page.getByRole('button',{name:'对比',exact:true}).click();
  await page.getByRole('button',{name:'选择 #h1 对比',exact:true}).click();
  await page.getByRole('button',{name:'选择 #h2 对比',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.library-pick[aria-pressed="true"]').length===2);

  await page.setViewportSize({width:390,height:900});
  await page.waitForTimeout(450);

  await page.evaluate(async()=>{for(const item of drawing.snapshot().history)await drawing.toggleFavorite(item);});
  await page.locator('#favoritesTab').click();
  assert.equal(await page.locator('.library-compare').isVisible(),true,'favorites retain compare action when clear-history is hidden');
  assert.equal(await page.getByRole('button',{name:'Ask Diff',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Ask Diff',exact:true}).click();await drawer(page).waitFor();
  assert.equal(calls.length,0);
  await drawer(page).getByRole('button',{name:'收起 ASK',exact:true}).click();
  // Isolated UI state: never submit a generation to obtain an error card.
  await page.evaluate(()=>{document.body.dataset.state='error';document.querySelector('#errBody').textContent='synthetic 503';});
  await page.getByRole('button',{name:'Ask Why',exact:true}).click();await drawer(page).waitFor();
  assert.match(await page.locator('#askPrompt').inputValue(),/为什么这次生成失败/);
  assert.equal(calls.length,0);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
