import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, hosts, reasoning, open, openai, text, end, anthropic, askSettings, generation, bind, openDebug, stored, textReply, openConversations, askText } from "./helpers/ask-fixture.mjs";

useAskFixture();

test("AI naming: independent model settings, manual IDs", async () => {
  const {page,context,calls,errors}=await open('/#/image/settings/ask',{ask:askSettings()});
  try {

    const section=page.getByRole('group',{name:'命名模型',exact:true});
    // Following ASK needs no second value: the model sits right above.
    assert.equal(await page.locator('#askNamingConnection').inputValue(),'');
    assert.equal(await section.getByRole('button').count(),0);
    await page.locator('#askNamingConnection').selectOption('claude');
    await section.getByRole('button',{name:'选择模型',exact:true}).click();
    const dialog=page.locator('#askModelDialog');await dialog.waitFor();
    await dialog.getByRole('searchbox').fill('Claude Naming [provider]');
    await dialog.getByRole('searchbox').press('Enter');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('koma.ask.v1')).naming?.model==='Claude Naming [provider]');
    await dialog.getByRole('button',{name:'选用 reasoning-b',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('koma.ask.v1')).naming?.model==='reasoning-b');
    assert.equal(await dialog.locator('.lamp[data-s="on"]').count(),1);
    await page.keyboard.press('Escape');
    const config=await stored(page,'koma.ask.v1');assert.equal(config.connectionId,'chat');assert.equal(config.model,'reasoning-a');assert.deepEqual(config.models,{chat:['reasoning-a']});
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});await section.scrollIntoViewIfNeeded();
    }
    await page.reload();await page.waitForSelector('#settingsPanel[open]');
    assert.equal(await page.locator('#askNamingConnection').inputValue(),'claude');assert.match(await section.textContent(),/reasoning-b/);
    await page.locator('#askNamingConnection').selectOption('');
    await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('koma.ask.v1')).naming);
    assert.equal(await section.getByRole('button').count(),0);assert.deepEqual(calls,[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

for(const protocol of ['chat','claude']) test(`AI naming: ${protocol} scoped requests, board persistence, conversation rename and exact debug`,async()=>{
  const config=askSettings(protocol==='claude'?{naming:{connectionId:'claude',model:'Claude Naming [provider]'}}:{models:{chat:['reasoning-a','reasoning-b']}});
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:config,standard:true});
  const reply=title=>({body:protocol==='chat'?openai(text(title),end()):anthropic(
    {type:'message_start',message:{usage:{input_tokens:100,cache_read_input_tokens:80}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:title}},
    {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:8}},{type:'message_stop'})});
  try {
    await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length===2);
    await page.evaluate(async()=>{
      await drawing.patch({prompt:'rainy station, warm lights',negative:'negative-secret',characters:[{id:'c1',on:true,prompt:'girl, red coat',negative:'character-negative-secret',centers:[{x:.5,y:.5}]},{id:'c2',on:false,prompt:'disabled-secret',negative:'',centers:[{x:.2,y:.5}]}]});
      window.namedBoard=drawing.snapshot().activeBoardId;
      window.otherBoard=await drawing.createBoard(false);await drawing.patch({prompt:'inactive-secret'});await drawing.switchBoard(namedBoard);
      ask.show();
    });
    await askText(page,llm,'绘制雨夜的车站与候车女孩');
    if(protocol==='chat') await page.evaluate(()=>ask.useModel('chat','reasoning-b'));
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');requests.length=0;calls.length=0;
    llm.push(reply('“雨夜候车”'));
    await page.getByRole('button',{name:'AI 命名画板',exact:true}).click();
    await page.waitForFunction(()=>!ask.naming.value&&drawing.board(namedBoard).name==='雨夜候车');
    assert.match(await page.locator('.bd-name').textContent(),/雨夜候车/);
    const boardCall=calls[0];assert.equal(boardCall.host,hosts[protocol]);assert.equal(boardCall.body.model,protocol==='chat'?'reasoning-b':'Claude Naming [provider]');
    assert.match(boardCall.raw,/rainy station/);assert.match(boardCall.raw,/red coat/);assert.doesNotMatch(boardCall.raw,/negative-secret|inactive-secret|disabled-secret|workspace_state|image_url|propose_draft/);assert.equal(boardCall.body.tools,undefined);
    const storedBoards=(await stored(page,'koma.prefs.v1')).boards, namedBoard=await page.evaluate(()=>namedBoard);assert.equal(storedBoards.items.find(b=>b.id===namedBoard)?.name,'雨夜候车');
    llm.push(reply('雨夜车站构思'));
    await page.getByRole('button',{name:'AI 命名对话',exact:true}).click();
    await page.waitForFunction(()=>!ask.naming.value&&ask.heading.value.title==='雨夜车站构思');
    assert.match(calls[1].raw,/绘制雨夜/);assert.doesNotMatch(calls[1].raw,/rainy station|workspace_state|negative-secret|propose_draft/);
    const logs=await page.evaluate(()=>ask.debug.value.calls.filter(c=>c.promptVersion==='naming-1').map(c=>({raw:ask.debugCall(c.id).body,cache:c.cache,status:c.status})));
    assert.deepEqual(logs.map(c=>c.raw),calls.map(c=>c.raw));assert.ok(logs.every(c=>c.status==='done'&&c.cache.read>0));
    await openDebug(page);const debug=page.locator('#askDebug');
    await debug.locator('#askDebugCall').click();
    const boardItem=debug.locator('#askDebugCalls [role="menuitemradio"]').filter({hasText:'AI 命名 · 画板'});assert.equal(await boardItem.count(),1);
    await boardItem.click();
    assert.equal(await debug.locator('.debug-q').textContent(),'AI 命名 · 画板');
    assert.match(await debug.locator('.debug-facts').textContent(),/naming-1/);
    await debug.getByRole('button',{name:'关闭调用上下文'}).click();
    await openConversations(page);await page.getByRole('menuitem',{name:'重命名',exact:true}).click();await page.getByRole('textbox',{name:'对话名称',exact:true}).fill('手动命名的雨夜车站');await page.locator('#askConvMenu').getByRole('button',{name:'保存',exact:true}).click();
    assert.equal(await page.evaluate(()=>ask.heading.value.title),'手动命名的雨夜车站');
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('AI naming: cancel, failure, target switch/delete, manual rename and failed save preserve names',async()=>{
  const {page,context,llm,calls,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  let release;
  const pending=async(target,title='迟到名称')=>{
    const dispatched=page.waitForRequest(r=>reasoning.test(new URL(r.url()).pathname));
    llm.push({...textReply(title),wait:new Promise(resolve=>{release=resolve;})});
    await page.evaluate(target=>{void ask.generateName(target);},target);
    await dispatched;await page.waitForFunction(()=>!!ask.naming.value);
  };
  const finish=async()=>{release();await page.waitForFunction(()=>!ask.naming.value);};
  try {
    await bind(page);
    await page.evaluate(async()=>{await drawing.patch({prompt:'red forest'});window.a=drawing.snapshot().activeBoardId;window.b=await drawing.createBoard(false);await drawing.patch({prompt:'blue sea'});await drawing.switchBoard(a);});
    const a=await page.evaluate(()=>a),b=await page.evaluate(()=>b);
    await pending({kind:'board',id:a},'红林');await page.evaluate(b=>drawing.switchBoard(b),b);await finish();
    assert.deepEqual(await page.evaluate(()=>[drawing.board(a).name,drawing.board(b).name,drawing.snapshot().activeBoardId]),['红林','画板 2',b]);
    await pending({kind:'board',id:a});await page.evaluate(a=>drawing.renameBoard(a,'手动保留'),a);await finish();assert.equal(await page.evaluate(()=>drawing.board(a).name),'手动保留');
    await pending({kind:'board',id:b});await page.getByRole('button',{name:'取消命名',exact:true}).click();await page.waitForFunction(()=>!ask.naming.value);release();assert.equal(await page.evaluate(()=>drawing.board(b).name),'画板 2');
    assert.equal(await page.evaluate(()=>ask.debug.value.calls.at(-1).status),'stopped');
    await pending({kind:'board',id:a});await page.evaluate(a=>drawing.removeBoard(a),a);await finish();assert.equal(await page.evaluate(()=>drawing.snapshot().boards.length),1);
    for(const failure of [{status:503,type:'application/json',body:'{"error":{"message":"synthetic unavailable"}}'},textReply('一\n二'),{body:openai(text('半截名称'),end('length'))}]){
      const count=calls.length;llm.push(failure);await page.evaluate(b=>ask.generateName({kind:'board',id:b}),b);assert.equal(calls.length,count+1);assert.equal(await page.evaluate(()=>drawing.board(b).name),'画板 2');
    }
    llm.push(textReply('不能保存的名称'));
    await page.evaluate(async b=>{
      const p=document.body.__vue_app__._context.provides,s=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')],set=s.preferences.set;
      s.preferences.set=async()=>{throw new Error('synthetic naming save failure');};
      try {await ask.generateName({kind:'board',id:b});} finally{s.preferences.set=set;}
    },b);
    assert.equal(await page.evaluate(()=>drawing.board(b).name),'画板 2');
    await askText(page,llm,'为海边小屋构思');const c=await page.evaluate(()=>ask.conversationId.value);
    await pending({kind:'conversation',id:c},'海边小屋');await page.evaluate(()=>ask.newConversation());await finish();
    assert.equal(await page.evaluate(()=>ask.heading.value.title),'新对话');assert.equal(await page.evaluate(c=>ask.conversations.value.find(x=>x.id===c).title,c),'海边小屋');
    await pending({kind:'conversation',id:c});await page.evaluate(c=>ask.renameConversation(c,'保留手动名'),c);await finish();assert.equal(await page.evaluate(c=>ask.conversations.value.find(x=>x.id===c).title,c),'保留手动名');
    await pending({kind:'conversation',id:c});await page.evaluate(c=>ask.deleteConversation(c),c);await finish();assert.equal(await page.evaluate(()=>ask.conversations.value.length),1);
    const before=calls.length;await page.evaluate(()=>ask.generateName({kind:'conversation',id:ask.conversationId.value}));assert.equal(calls.length,before,'empty conversation never requests');
    assert.deepEqual(errors,[]);
  }finally{release?.();await context.close();}
});

test('AI naming: timeout, missing configuration and codec gate use the same provider boundary',async()=>{
  const {page,context,llm,calls,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings({replacements:[{from:'red coat',to:'azure dress'}]})});
  let release;
  try{
    await bind(page);await page.evaluate(async()=>{await drawing.patch({prompt:'girl, red coat'});window.board=drawing.snapshot().activeBoardId;});
    for(const adult of [false,true]){
      await page.evaluate(async adult=>{
        const p=document.body.__vue_app__._context.provides,s=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')];
        await s.preferences.set('koma.ask.adult.v1',adult);
      },adult);
      llm.push(textReply(adult?'azure dress':'red coat'));
      await page.evaluate(()=>ask.generateName({kind:'board',id:board}));
      assert.equal(await page.evaluate(()=>drawing.board(board).name),'red coat');
      const content=JSON.parse(calls.at(-1).body.messages.at(-1).content);assert.equal(content.content.prompt,adult?'girl, azure dress':'girl, red coat');
    }
    llm.push({...textReply('late'),wait:new Promise(resolve=>{release=resolve;})});
    await page.evaluate(async()=>{
      const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===60000?100:ms,...args);
      try {await ask.generateName({kind:'board',id:board});} finally{window.setTimeout=timer;}
    });
    release();assert.equal(await page.evaluate(()=>drawing.board(board).name),'red coat');assert.equal(await page.evaluate(()=>ask.debug.value.calls.at(-1).status),'failed');
    assert.ok(await page.getByText('命名失败：命名超时，请重试',{exact:true}).count());
    const count=calls.length;
    await page.evaluate(async()=>{
      const p=document.body.__vue_app__._context.provides,s=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')];
      await s.preferences.set('koma.ask.v1',{...ask.settings.value,naming:{connectionId:'gone',model:'namer'}});
      await ask.generateName({kind:'board',id:board});
    });
    assert.equal(calls.length,count,'explicit unavailable config never silently falls back');assert.deepEqual(errors,[]);
  }finally{release?.();await context.close();}
});
