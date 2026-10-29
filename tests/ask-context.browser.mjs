import { test } from "node:test";
import assert from "node:assert/strict";

import { constitution } from "../src/ask/prompts/constitution.ts";
import { useAskFixture, submitAsk, reasoning, open, openai, text, tool, end, anthropic, askSettings, generation, bind, addImage, drawer, toolReply, textReply, patchStep, form, openConversations, attachText, scripted, wireStates } from "./helpers/ask-fixture.mjs";

useAskFixture();

for (const connectionId of ['chat','claude']) test(`ASK retrieval: ${connectionId} raw state, multiword history, online batch verification and picks`, async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings({connectionId,images:false})});
  const queries=[];
  const answer=(name,input)=>connectionId==='chat'
    ? openai(name?tool('retrieval',name,input):text('已核验，请选择目标图片。'),end(name?'tool_calls':'stop'))
    : anthropic(
      {type:'message_start',message:{usage:{input_tokens:50}}},
      {type:'content_block_start',index:0,content_block:name?{type:'tool_use',id:'retrieval',name,input:{}}:{type:'text',text:'已核验，请选择目标图片。'}},
      ...(name?[{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}}]:[]),
      {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:name?'tool_use':'end_turn'},usage:{output_tokens:10}},
      {type:'message_stop'},
    );
  try {
    await context.route('https://tagsuggest.zeabur.app/api/tags/suggest?*',async route=>{
      const request=route.request(),q=new URL(request.url()).searchParams.get('q');queries.push(q);
      assert.equal(request.headers().authorization,undefined);
      if(q==='错误')return route.fulfill({status:503,json:{error:'synthetic unavailable'}});
      return route.fulfill({json:{results:[
        {name:'loose_socks_variant',cn_name:'变体',count:50000,category:0},
        {name:'loose_socks',cn_name:'泡泡袜',count:100,category:0},
      ]}});
    });
    await bind(page);
    for(let i=0;i<4;i++)await addImage(page,`white_hair, coffee, variant ${i}`);
    await page.locator('#prompt').fill('artist:a, {blue eyes}, Keep this sentence as written.');
    const before=await page.locator('#prompt').inputValue();
    await page.evaluate(()=>ask.show());
    assert.deepEqual(queries,[],'opening ASK does not query the dictionary');
    llm.push({body:answer('get_state',{})},{body:answer('search_history',{query:'coffee AND hair white'})},
      {body:answer('search_tags',{queries:['loose socks','泡泡袜','错误'],limit_per_query:1})},{body:answer()});
    await page.locator('#askPrompt').fill('查找之前的图片，并核对这几个词');await submitAsk(page);
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length,4);assert.equal(queries.length,3);
    assert.equal(calls[0].raw.includes('prompt_sections'),false);
    const final=JSON.stringify(calls.at(-1).body);
    assert.match(final,/total_matched/);assert.match(final,/matched_snippet/);
    assert.match(final,/loose_socks/);assert.match(final,/泡泡袜/);assert.match(final,/503/);
    const content=connectionId==='chat'?calls.at(-1).body.messages.filter(m=>m.role==='tool').map(m=>m.content):calls.at(-1).body.messages.flatMap(m=>m.content).filter(b=>b?.type==='tool_result').flatMap(b=>b.content).map(b=>b.text);
    const tags=content.map(t=>t?.startsWith('<data>')?JSON.parse(t.slice(7,-8)):null).find(v=>v?.results);
    assert.deepEqual(tags.results.map(r=>r.status),['ok','ok','error']);
    assert.equal(tags.results[0].matches[0].tag,'loose_socks');
    assert.equal(tags.results[0].matches[0].post_count,100);
    assert.match(await drawer(page).locator('.ask-tool').last().textContent(),/3 个查询.*1 失败/);
    const picks=drawer(page).getByRole('group',{name:'选择要分析的图片'});
    assert.equal(await picks.getByRole('button').count(),4);

    await page.locator('#askPrompt').fill('保留输入');
    await picks.getByRole('button',{name:'选择 #h1 继续提问',exact:true}).click();
    assert.equal(await page.locator('#askPrompt').inputValue(),'保留输入');assert.equal(calls.length,4);
    assert.equal(await page.locator('#prompt').inputValue(),before);
    const debug=await page.evaluate(()=>ask.debug.value.calls.map(c=>ask.debugCall(c.id).body));
    assert.deepEqual(debug,calls.map(c=>c.raw));
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('ASK retrieval: stopping a pending dictionary batch rolls back the turn and discards late results',async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  let release;const pending=new Promise(resolve=>{release=resolve;});let count=0;
  try {
    await bind(page);
    await context.route('https://tagsuggest.zeabur.app/api/tags/suggest?*',async route=>{
      count++;await pending;
      try{await route.fulfill({json:{results:[{name:'late_word',cn_name:'迟到结果',category:0,count:1}]}});}catch{}
    });
    llm.push({body:openai(tool('batch','search_tags',{queries:['词一','词二','词三']}),end('tool_calls'))});
    await page.evaluate(()=>ask.show());
    await page.locator('#askPrompt').fill('这轮查词应该被取消');await submitAsk(page);
    await page.waitForFunction(()=>document.querySelector('.ask-tool[data-state="run"]')?.textContent.includes('词典'));
    await page.waitForTimeout(50);assert.equal(count,3);
    await page.evaluate(()=>ask.stop());await page.locator('.ask-turn[data-status="stopped"]').waitFor();
    release();
    llm.push({body:openai(text('下一轮正常。'),end())});
    await page.locator('#askPrompt').fill('下一轮');await submitAsk(page);
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length,2);assert.doesNotMatch(calls[1].raw,/这轮查词应该被取消|late_word|迟到结果/);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {release();await context.close();}
});

for (const connectionId of ["chat", "claude"]) test(`ASK prompts: ${connectionId} adult gate changes next turn; manuals append only as tool results`, async () => {
  const { page, context, llm, calls, requests, errors } = await open("/#/image", {ready:".switcher",ask:askSettings({connectionId,images:false})});
  let release;
  const answer = (manual = false) => connectionId === "chat"
    ? openai(manual ? tool("manual_1", "get_model_manual", {id:"nai5-comics"}) : text("已核对。"), end(manual ? "tool_calls" : "stop"))
    : anthropic(
      {type:"message_start",message:{id:"synthetic",usage:{input_tokens:50,output_tokens:0}}},
      {type:"content_block_start",index:0,content_block:manual ? {type:"tool_use",id:"manual_1",name:"get_model_manual",input:{}} : {type:"text",text:"已核对。"}},
      ...(manual ? [{type:"content_block_delta",index:0,delta:{type:"input_json_delta",partial_json:JSON.stringify({id:"nai5-comics"})}}] : []),
      {type:"content_block_stop",index:0},
      {type:"message_delta",delta:{stop_reason:manual ? "tool_use" : "end_turn"},usage:{output_tokens:10}},
      {type:"message_stop"},
    );
  const system = call => connectionId === "chat" ? call.body.messages[0].content : call.body.system.map(b=>b.text).join("\n\n");
  const setAdult = value => page.evaluate(value => {
    localStorage.setItem("koma.ask.adult.v1",String(value));
    window.dispatchEvent(new StorageEvent("storage",{key:"koma.ask.adult.v1"}));
  }, value);
  try {
    await bind(page);await page.keyboard.press("Control+j");await drawer(page).waitFor();
    const send = async question => {await page.locator("#askPrompt").fill(question);await submitAsk(page);};
    // Hold the first HTTP response while the setting changes: the whole tool loop must stay neutral.
    llm.push({body:answer(true),wait:new Promise(resolve=>{release=resolve;})},{body:answer()});
    const dispatched=page.waitForRequest(request=>reasoning.test(new URL(request.url()).pathname));
    await send("请查阅漫画手册");await dispatched;
    await setAdult(true);await page.waitForFunction(()=>ask.adult.value===true);release();
    await drawer(page).locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length,2);assert.equal(system(calls[0]),system(calls[1]));
    assert.equal(system(calls[0]).includes(constitution.adult),false);
    assert.doesNotMatch(calls[0].raw,/分格逐一描述地点/);
    assert.match(calls[1].raw,/分格逐一描述地点/);
    assert.match(await drawer(page).locator(".ask-tool").textContent(),/已查阅\s*NAI 多格漫画与画中文字/);

    llm.push({body:answer()});await send("继续讨论构图");
    await drawer(page).locator('.ask-turn[data-status="done"]').nth(1).waitFor();
    assert.equal(system(calls[2]).includes(constitution.adult),true);
    assert.equal(system(calls[2]).split(constitution.adult).length,2);
    await setAdult(false);await page.waitForFunction(()=>ask.adult.value===false);
    llm.push({body:answer()});await send("再看一下");
    await drawer(page).locator('.ask-turn[data-status="done"]').nth(2).waitFor();
    assert.equal(system(calls[3]),system(calls[0]));
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {release?.();await context.close();}
});

for (const connection of ['chat','claude']) test(`ASK clean context: ${connection} fresh conversations and shortcut have no implicit image; silent drafts complete with prose`, async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings({connectionId:connection})});
  try {
    await bind(page);
    for(const scene of ['old_tram_scene','old_laundry_scene','old_cafe_scene','old_elf_scene']) await addImage(page,scene);
    await page.evaluate(()=>drawing.patch({prompt:'artist:base, old_elf_scene, old_tram_scene',negative:'old_negative_text',seed:'123'}));
    const initial=await form(page);
    await page.evaluate(()=>ask.show({anchor:'#h4'}));
    assert.equal(await page.locator('.ask-capsule-id').textContent(),'#h4');
    llm.push({body:scripted(connection,null)});
    await page.locator('#askPrompt').fill('旧会话唯一标记');await submitAsk(page);
    await page.locator('.ask-turn[data-status=done]').waitFor();
    assert.equal(wireStates(calls[0].body)[0].image.history.mode,'A');
    await (await openConversations(page)).getByRole('menuitem',{name:'新对话',exact:true}).click();
    assert.equal(await page.locator('.ask-capsule').count(),0);
    // Even reusing the single empty conversation clears a deliberately selected anchor.
    await page.evaluate(()=>{ask.show({anchor:'#h4'});ask.newConversation();});
    assert.equal(await page.locator('.ask-capsule').count(),0);
    await page.evaluate(()=>{ask.show({anchor:'#h4'});ask.hide();});
    await page.keyboard.press('Control+j');await drawer(page).waitFor();
    assert.equal(await page.locator('.ask-capsule').count(),0);
    await attachText(page,'魔法少女绘奈：新角色，粉色短发，星形发饰，月光花园。','魔法少女绘奈.md');
    const rewritten='pink hair, star hair ornament, magical girl, moonlit garden';
    llm.push({body:body=>scripted(connection,'propose_draft',{base_hash:wireStates(body).at(-1).base_hash,draft_title:'绘奈的新画面',steps:[patchStep('rewrite','',rewritten)]})},
      {body:scripted(connection,null).replace('附件已核对。','已按绘奈的新设定起草，草稿请核对。')});
    await page.locator('#askPrompt').fill('按附件为新角色起草全新的画面');await submitAsk(page);
    await page.locator('.ask-draft[data-status=pending]').waitFor();
    assert.equal(calls.length,3);
    const state=wireStates(calls[1].body)[0];
    assert.equal(state.anchor,null);
    assert.deepEqual(state.image.history,{mode:'B',count:4,latest_id:'#h4'});
    assert.deepEqual(state.image.current,{id:'#h4'});
    assert.equal(state.image.form.text_included,true);
    assert.equal(state.image.form.prompt,initial.prompt);assert.equal(state.image.form.negative,initial.negative);
    assert.equal(state.image.form.seed,'123');
    assert.doesNotMatch(calls[1].raw,/old_laundry_scene|old_cafe_scene|旧会话唯一标记/);
    assert.match(calls[1].raw,/魔法少女绘奈|星形发饰/);
    assert.deepEqual(calls[2].body.tool_choice,connection==='chat'?'none':{type:'none'});
    assert.deepEqual(calls[2].body.tools,calls[1].body.tools);
    assert.match(await drawer(page).locator('.ask-markdown').textContent(),/已按绘奈的新设定起草/);
    assert.equal(await page.locator('.ask-turn').count(),1);
    assert.deepEqual(await form(page),initial,'a completed proposal still waits for explicit application');
    await page.evaluate(()=>ask.ignoreDraft());
    // Typed IDs are explicit anchors, even though ordinary opening was clean.
    llm.push({body:scripted(connection,null)});
    await page.locator('#askPrompt').fill('请看 #h2');await submitAsk(page);
    await page.locator('.ask-turn[data-status=done]').nth(1).waitFor();
    assert.equal(wireStates(calls[3].body).at(-1).anchor,'#h2');
    assert.equal(wireStates(calls[3].body).at(-1).image.history.mode,'A');
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('ASK clean context: on-demand initial form stays frozen; latest read appends external edits without changing draft base',async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  let release=()=>{};
  try {
    await bind(page);await addImage(page,'history_should_stay_hidden');
    await page.evaluate(()=>{drawing.patch({prompt:'initial_text_only',negative:'initial_negative'});ask.show();});
    llm.push({wait:new Promise(done=>release=done),body:openai(tool('s1','get_state'),end('tool_calls'))},
      {body:openai(tool('s2','get_state',{scope:'latest'}),end('tool_calls'))},textReply('已核对初始与最新原文。'));
    await page.locator('#askPrompt').fill('请读取原文');await submitAsk(page);
    await page.waitForFunction(()=>ask.running.value);await page.waitForTimeout(100);
    await page.evaluate(()=>drawing.patch({prompt:'externally_changed_text'}));release();
    await page.locator('.ask-turn[data-status=done]').waitFor();
    const states=wireStates(calls[2].body);
    assert.equal(states.length,3);
    assert.equal(states[0].image.form.prompt,'initial_text_only');
    assert.equal(states[1].image.form.prompt,'initial_text_only');
    assert.equal(states[2].image.form.prompt,'externally_changed_text');
    assert.equal(states[0].base_hash,states[1].base_hash);assert.notEqual(states[1].base_hash,states[2].base_hash);
    assert.ok(states.every(s=>s.image.history.mode==='B'&&s.image.current.id==='#h1'));
    assert.doesNotMatch(calls[2].raw,/history_should_stay_hidden/);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {release();await context.close();}
});

test('ASK clean context: a completed empty reply after inspection gets one prose continuation and accounts for each call',async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await addImage(page,'synthetic_scene');await page.evaluate(()=>ask.show());
    llm.push(toolReply('view','view_image',{id:'#h1',spec:'glance'}),{body:openai(end())},textReply('已查看 #h1，合成图呈单色背景。'));
    await page.locator('#askPrompt').fill('看看刚才的图');await submitAsk(page);
    await page.locator('.ask-turn[data-status=done]').waitFor();
    assert.equal(calls.length,3);assert.equal(calls[2].body.tool_choice,'none');
    assert.equal(await page.locator('.ask-tool').count(),1);
    assert.match(await page.locator('.ask-markdown').textContent(),/已查看 #h1/);
    assert.equal(await page.evaluate(()=>ask.usage.value.input),5400);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test("ASK tag failures: partial errors keep header labels together, details below and continued replies",async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  const unavailable=new Set(['hair_buns','two_buns','patting_head','head_pat','all_failed']);
  try {
    await context.route('https://tagsuggest.zeabur.app/api/tags/suggest?*',route=>{
      const q=new URL(route.request().url()).searchParams.get('q');
      if(q==='hair_buns')return route.fulfill({json:{results:[]}});
      if(unavailable.has(q))return route.fulfill({status:503,json:{error:'synthetic unavailable'}});
      return route.fulfill({json:{results:[{name:q,count:20,category:0}]}});
    });
    await context.route('https://danbooru.donmai.us/**',route=>route.abort('failed'));
    await bind(page);await page.evaluate(()=>ask.show());
    llm.push(toolReply('state','get_state'),toolReply('batch1','search_tags',{queries:['hair buns','soft light','blue eyes','red hair','white shirt']}),
      toolReply('batch2','search_tags',{queries:['two buns','patting head','head pat','rain','night']}),textReply('部分词条未完成核验，保留已有结果继续起草。'));
    await page.locator('#askPrompt').fill('核验这两批词条');await submitAsk(page);
    await page.locator('.ask-turn[data-status=done]').waitFor();
    const rows=drawer(page).locator('.ask-tool');
    assert.deepEqual(await rows.evaluateAll(els=>els.map(el=>el.dataset.state)),['done','done','done']);
    assert.match(await rows.nth(1).locator('.ask-tool-stat').textContent(),/5 个查询.*1 失败/);
    assert.match(await rows.nth(2).locator('.ask-tool-stat').textContent(),/5 个查询.*3 失败/);
    // Expand failed tools so their actual error messages can be read.
    if(await rows.nth(1).locator('.ask-tool-reason').isHidden())await drawer(page).locator('.ask-tools-line').click();

    assert.equal(calls.length,4);assert.match(await page.locator('.ask-markdown').textContent(),/保留已有结果继续/);
    llm.push(toolReply('all','search_tags',{queries:['all failed']}),textReply('词典暂不可用，这一项尚未核验。'));
    await page.locator('#askPrompt').fill('核验最后一项');await submitAsk(page);
    await page.locator('.ask-turn[data-status=done]').nth(1).waitFor();
    await page.locator('.ask-tool[data-state=error] .ask-tool-reason').waitFor();
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
