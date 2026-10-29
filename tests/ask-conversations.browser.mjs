import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, submitAsk, open, openai, text, end, anthropic, askSettings, generation, bind, addImage, drawer, openMore, openDebug, patchStep, askDraft, form, applyDraft, reverted, undoCheckpoint, restoreCheckpoint, seedAskChat, islandMode, openConversations, heading, askText, editQuestion } from "./helpers/ask-fixture.mjs";

useAskFixture();

test('ASK W2: new, switch and delete keep input, drafts and calls apart; the menu locks while running', async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);
    await addImage(page,'adult woman, red eyes');
    await page.evaluate(()=>drawing.patch({prompt:'adult woman, red eyes',negative:'low quality'}));
    const initial=await form(page);
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'第一段对话\n第二行');
    assert.equal(await heading(page),'第一段对话');

    let menu=await openConversations(page);
    assert.equal(await menu.getByRole('menuitemradio').count(),1);
    assert.match(await menu.textContent(),/收藏保留，其余刷新后清空/);
    await menu.getByRole('menuitem',{name:'新对话'}).click();
    await page.waitForFunction(()=>document.activeElement?.id==='askPrompt');
    assert.equal(await heading(page),'新对话');
    assert.equal(await page.locator('.ask-start').isVisible(),true);
    assert.equal(await page.locator('.ask-draft').count(),0,'a pending draft shows only in its own conversation');
    await page.locator('#askPrompt').fill('B 的输入');
    await drawer(page).getByRole('button',{name:'更多',exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.deepEqual(await form(page),initial,'Tab does not apply another conversation\'s draft');

    menu=await openConversations(page);
    await menu.getByRole('menuitem',{name:'新对话'}).click();
    menu=await openConversations(page);
    assert.deepEqual(await menu.getByRole('menuitemradio').allTextContents(),['新对话','第一段对话'],'the empty conversation is reused; newest first');
    assert.equal(await menu.getByRole('menuitemradio',{name:'新对话'}).getAttribute('aria-checked'),'true');
    await menu.getByRole('menuitemradio',{name:'第一段对话'}).click();
    await page.locator('.ask-draft[data-status="pending"]').waitFor();
    assert.equal(await page.locator('#askPrompt').inputValue(),'');
    assert.equal(await drawer(page).locator('.ask-turn').count(),1);

    menu=await openConversations(page);
    await menu.getByRole('menuitemradio',{name:'新对话'}).click();
    assert.equal(await page.locator('#askPrompt').inputValue(),'B 的输入');
    let release;
    llm.push({wait:new Promise(done=>release=done),body:openai(text('B 的回答'),end())});
    await submitAsk(page);
    await page.waitForFunction(()=>ask.running.value);
    assert.equal(await heading(page),'B 的输入');
    menu=await openConversations(page);
    assert.equal(await menu.getByRole('menuitem',{name:'新对话'}).isDisabled(),true);
    assert.equal(await menu.getByRole('menuitemradio',{name:'第一段对话'}).isDisabled(),true);
    await page.keyboard.press('Escape');
    await menu.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>ask.running.value),true,'Esc closed the menu first');
    release();
    await page.waitForFunction(()=>!ask.running.value);

    await openDebug(page);
    assert.equal(await page.locator('#askDebug .debug-count').textContent(),'1 次记录');
    assert.match(await page.locator('#askDebugCall').textContent(),/B 的输入/);
    await page.locator('#askDebug').getByRole('button',{name:'关闭调用上下文'}).click();
    const usage=await page.evaluate(()=>({...ask.usage.value}));
    assert.equal(usage.input,3600);

    menu=await openConversations(page);
    const first=menu.locator('.ask-conv-row',{hasText:'第一段对话'});
    await first.hover();
    await first.getByRole('button',{name:'删除 第一段对话'}).click();
    await first.getByRole('button',{name:'确认删除 第一段对话'}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await first.getByRole('button',{name:'删除 第一段对话'}).count(),1,'Esc cancels the confirmation');
    assert.equal(await menu.isVisible(),true,'and keeps the menu open');
    await first.getByRole('button',{name:'删除 第一段对话'}).click();
    await first.getByRole('button',{name:'确认删除 第一段对话'}).click();
    assert.deepEqual(await menu.getByRole('menuitemradio').allTextContents(),['B 的输入']);
    assert.equal(await heading(page),'B 的输入','deleting another conversation keeps the current one');
    const current=menu.locator('.ask-conv-row').first();
    await current.getByRole('button',{name:'删除 B 的输入'}).click();
    await current.getByRole('button',{name:'确认删除 B 的输入'}).click();
    assert.deepEqual(await menu.getByRole('menuitemradio').allTextContents(),['新对话'],'the last deletion leaves a new empty conversation');
    await page.keyboard.press('Escape');
    await menu.waitFor({state:'detached'});
    assert.equal(await page.locator('.ask-start').isVisible(),true);
    assert.deepEqual(await page.evaluate(()=>({...ask.usage.value})),usage,'page usage keeps deleted conversations');
    assert.deepEqual(await form(page),initial,'deleting never reverts or writes');
    assert.equal(calls.length,2);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      menu=await openConversations(page);
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test("ASK W3: checkpoints undo in order, one restore and native shortcut guards", async () => {
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes',negative:'original'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'调整眼睛','把红眼睛调整为蓝色并保持其余所有人物特征和画风');
    await applyDraft(page);
    await askDraft(page,llm,[patchStep('append','',', soft lighting')],'调整光照','增加柔和光线');
    await applyDraft(page);
    const cps=page.locator('.ask-checkpoint');
    assert.equal(await cps.count(),2);
    assert.equal(await cps.first().getByRole('button',{name:'回退',exact:true}).count(),0);
    assert.equal(await cps.last().getByRole('button',{name:'回退',exact:true}).count(),1);
    assert.equal(await page.locator('.ask-draft').count(),0);
    assert.equal(await page.locator('.ask-action').count(),0);
    assert.deepEqual(await page.evaluate(()=>ask.entries.value.filter(e=>e.type==='turn').map(e=>e.turn.committed)),[1,2]);
    // The ASK input and unrelated workspaces retain native undo.
    await page.locator('#askPrompt').focus();
    assert.equal(await page.locator('#askPrompt').evaluate(el=>!el.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))),false);
    assert.equal((await form(page)).prompt,'blue eyes, soft lighting');
    await page.locator('#prompt').focus(); await page.keyboard.press('Control+z'); await reverted(page);
    assert.equal((await form(page)).prompt,'blue eyes');
    assert.equal(await cps.first().getByRole('button',{name:'回退',exact:true}).count(),1);
    assert.equal(await cps.last().getByRole('button',{name:'恢复',exact:true}).count(),1);
    assert.equal(await page.locator('.ask-draft').count(),0,'undo never reopens the old draft');
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await cps.last().scrollIntoViewIfNeeded();
    }
    await undoCheckpoint(page); assert.equal((await form(page)).prompt,'red eyes');
    assert.equal(await cps.last().getByRole('button',{name:'恢复',exact:true}).count(),0);
    await restoreCheckpoint(page); assert.equal((await form(page)).prompt,'blue eyes');
    assert.equal(await cps.first().getAttribute('data-state'),'applied');
    assert.equal(await cps.last().getAttribute('data-state'),'reverted');
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W3: only the owning conversation can undo; deleting a conversation drops history without reverting content', async () => {
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes',negative:'original'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'A 的草稿'); await applyDraft(page);
    const a=await page.evaluate(()=>ask.conversationId.value);
    await (await openConversations(page)).getByRole('menuitem',{name:'新对话'}).click();
    await askDraft(page,llm,[patchStep('rewrite','','bad quality','image.negative')],'B 的草稿'); await applyDraft(page);
    const b=await page.evaluate(()=>ask.conversationId.value);
    await (await openConversations(page)).getByRole('menuitemradio',{name:'A 的草稿'}).click();
    assert.equal(await page.locator('.ask-checkpoint button').count(),0);
    assert.equal(await page.evaluate(()=>{document.activeElement?.blur();const e=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),false);
    assert.equal((await form(page)).prompt,'blue eyes');
    await page.evaluate(id=>ask.selectConversation(id),b);
    await undoCheckpoint(page); assert.equal((await form(page)).negative,'original');
    await page.evaluate(id=>ask.selectConversation(id),a);
    assert.equal(await page.locator('.ask-checkpoint').getByRole('button',{name:'回退',exact:true}).count(),1);
    await page.evaluate(id=>ask.selectConversation(id),b);
    await restoreCheckpoint(page);
    // Delete B via the existing inline confirmation, keep its written Negative.
    const menu=await openConversations(page), row=menu.locator('.ask-conv-row',{hasText:'B 的草稿'});
    await row.hover(); await row.getByRole('button',{name:'删除 B 的草稿'}).click();
    await row.getByRole('button',{name:'确认删除 B 的草稿'}).click(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>ask.conversationId.value),a);
    assert.equal((await form(page)).negative,'bad quality');
    await undoCheckpoint(page); assert.equal((await form(page)).prompt,'red eyes'); assert.equal((await form(page)).negative,'bad quality');
    await page.evaluate(id=>ask.deleteConversation(id),a);
    assert.equal(await page.evaluate(()=>ask.redoId.value),null);
    assert.equal(await page.locator('.ask-checkpoint').count(),0);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W3: failed writes keep checkpoints, and running inference locks undo and restore', async () => {
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]); await applyDraft(page);
    await page.evaluate(()=>{
      const p=document.body.__vue_app__._context.provides;
      const s=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')];
      window.w3Preferences=s.preferences;window.w3Set=s.preferences.set;
      s.preferences.set=async()=>{throw new Error('synthetic save failure');};
    });
    await page.locator('.ask-checkpoint').getByRole('button',{name:'回退',exact:true}).click();
    await page.waitForFunction(()=>!ask.writingDraft.value && ask.notice.value.includes('回退失败'));
    assert.equal((await form(page)).prompt,'blue eyes');
    assert.equal(await page.locator('.ask-checkpoint').getAttribute('data-state'),'applied');
    assert.equal(await page.evaluate(()=>ask.redoId.value),null);
    await page.evaluate(()=>w3Preferences.set=w3Set); await undoCheckpoint(page);
    await page.evaluate(()=>w3Preferences.set=async()=>{throw new Error('synthetic redo failure');});
    await page.locator('.ask-checkpoint').getByRole('button',{name:'恢复',exact:true}).click();
    await page.waitForFunction(()=>!ask.writingDraft.value && ask.notice.value.includes('恢复失败'));
    assert.equal((await form(page)).prompt,'red eyes');
    assert.equal(await page.locator('.ask-checkpoint').getAttribute('data-state'),'reverted');
    await page.evaluate(()=>w3Preferences.set=w3Set);
    let release; llm.push({wait:new Promise(done=>release=done),body:openai(text('只读回复'),end())});
    await page.locator('#askPrompt').fill('继续解释'); await submitAsk(page);
    await page.waitForFunction(()=>ask.running.value);
    assert.equal(await page.locator('.ask-checkpoint').getByRole('button',{name:'恢复',exact:true}).isDisabled(),true);
    const restore=await page.evaluate(()=>ask.redoId.value);
    await page.evaluate(id=>ask.restoreDraft(id),restore); assert.equal((await form(page)).prompt,'red eyes');
    release(); await page.waitForFunction(()=>!ask.running.value);
    await restoreCheckpoint(page); assert.equal((await form(page)).prompt,'blue eyes');
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W3: real CHAT branch receipts support successive rollback and restore with no sends', async () => {
  const {page,context,llm,requests,errors}=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings()});
  try {
    await bind(page); await seedAskChat(page);
    const initial=await page.evaluate(()=>chat.snapshot().current);
    await askDraft(page,llm,[{kind:'chat_distill_branch',source:'#c1.1',exclude:['#c2.1'],text:'第一份分支输入'}],'第一份分支');
    await applyDraft(page);
    await askDraft(page,llm,[patchStep('append','','，补充构图','chat.composer')],'补充描述'); await applyDraft(page);
    await askDraft(page,llm,[{kind:'chat_distill_branch',source:'#c1.1',exclude:[],text:'第二份分支输入'}],'第二份分支');
    await applyDraft(page); await undoCheckpoint(page); await restoreCheckpoint(page); await undoCheckpoint(page);
    assert.equal(await page.locator('#chatPrompt').inputValue(),'第一份分支输入，补充构图');
    await undoCheckpoint(page); assert.equal(await page.locator('#chatPrompt').inputValue(),'第一份分支输入');
    await undoCheckpoint(page);
    const undone=await page.evaluate(()=>chat.snapshot().current);
    for(const key of ['headId','mainId','skipTurnIds','baseFollows','prompt']) assert.deepEqual(undone[key],initial[key]);
    await restoreCheckpoint(page); assert.equal(await page.locator('#chatPrompt').inputValue(),'第一份分支输入');
    await page.evaluate(()=>chat.addConversation());
    await page.locator('.ask-checkpoint').getByRole('button',{name:'回退',exact:true}).click();
    assert.match(await page.locator('.ask-notice').textContent(),/回退失败：对话已切换/);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W3: a later reply replaces the write pill, undo conflicts report from the window and the result can close', async () => {
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]); await applyDraft(page);
    let release; llm.push({wait:new Promise(done=>release=done),body:openai(text('这是后续的普通回复。'),end())});
    await page.locator('#askPrompt').fill('继续解释'); await submitAsk(page);
    await page.waitForFunction(()=>ask.running.value);
    assert.equal(await page.locator('.ask-checkpoint').getByRole('button',{name:'回退',exact:true}).isDisabled(),true);
    await page.locator('#prompt').focus();
    assert.equal(await page.locator('#prompt').evaluate(el=>!el.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))),false);
    await drawer(page).getByRole('button',{name:'收起 ASK',exact:true}).click();
    await islandMode(page,'run'); release(); await islandMode(page,'ready');
    assert.match(await page.locator('.ask-summary').textContent(),/后续的普通回复/);
    // A conflict keeps the written record and reports through the common toast.
    await page.evaluate(()=>drawing.patch({prompt:'manual'}));
    assert.equal(await page.locator('.ask-ready .ask-undo').count(),0,'undo lives in the window');
    await page.locator('.ask-ready').getByRole('button',{name:'收起 ASK 结果'}).click();
    await islandMode(page,'idle');
    await page.locator('#askLauncher').click();
    await page.locator('.ask-checkpoint').getByRole('button',{name:'回退',exact:true}).click();
    await page.waitForFunction(()=>ask.notice.value.includes('回退失败：Prompt'));
    assert.equal((await form(page)).prompt,'manual');
    await page.evaluate(()=>drawing.patch({prompt:'blue eyes'}));
    // Ignoring another pending draft dismisses its compact result, keeps A's undo.
    await askDraft(page,llm,[patchStep('append','',', sunlight')]);
    await drawer(page).getByRole('button',{name:'收起 ASK',exact:true}).click(); await islandMode(page,'ready');
    await page.locator('#askCompactDraft').getByRole('button',{name:'放弃草稿',exact:true}).click(); await islandMode(page,'idle');
    assert.notEqual(await page.evaluate(()=>ask.undoId.value),null);
    await page.locator('#askLauncher').click();
    await undoCheckpoint(page); assert.equal((await form(page)).prompt,'red eyes');
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W4: editing rolls back the entire suffix, preserves prefix, anchor and composer, and clears pending/redo', async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes',negative:'low quality'}));
    await addImage(page,'red eyes');
    await askText(page,llm,'保留这一轮','前文回答');
    await page.evaluate(()=>ask.show({anchor:'#h1'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'第一次修改'); await applyDraft(page);
    await askDraft(page,llm,[patchStep('replace','low quality','blurry','image.negative')],'第二次修改'); await applyDraft(page);
    await askDraft(page,llm,[patchStep('append','','，等待确认')],'未决草稿');
    await page.evaluate(()=>{ ask.clearAnchor(); ask.setInput('修改后的问题'); });
    const editor=await editQuestion(page,1); await editor.fill('修改后的问题');
    llm.push({body:openai(text('编辑后的新回答'),end())});
    await editor.press('Enter'); await drawer(page).getByText('编辑后的新回答',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>ask.entries.value.filter(e=>e.type==='turn').map(e=>e.turn.question)),['保留这一轮','修改后的问题']);
    assert.equal((await form(page)).prompt,'red eyes'); assert.equal((await form(page)).negative,'low quality');
    assert.equal(await page.locator('.ask-checkpoint').count(),0); assert.equal(await page.locator('.ask-draft').count(),0);
    assert.equal(await page.evaluate(()=>ask.redoId.value),null); assert.equal(await page.locator('#askPrompt').inputValue(),'修改后的问题');
    assert.equal(await page.evaluate(()=>ask.entries.value.at(-1).turn.anchor),'#h1');
    assert.deepEqual(calls.at(-1).body.messages.slice(0,-1),calls[1].body.messages.slice(0,-1));
    assert.doesNotMatch(calls.at(-1).raw,/第一次修改|第二次修改|未决草稿/);
    assert.match(await page.locator('body').textContent(),/已撤回 2 份草稿/);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test("ASK W4: editor keys, Esc layers and long-question scroll keep the edit visible", async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askText(page,llm,'旧问题','很长的回答。\n'.repeat(45));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'带未决草稿的末轮');
    const editor=await editQuestion(page);
    await editor.fill('编辑中的问题'); await editor.press('Shift+Enter');
    assert.equal(await editor.inputValue(),'编辑中的问题\n');
    await editor.dispatchEvent('keydown',{key:'Enter',isComposing:true});
    await editor.dispatchEvent('keydown',{key:'Escape',isComposing:true});
    assert.equal(calls.length,2); assert.equal(await editor.count(),1);
    await openMore(page); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#askMoreMenu').count(),0); assert.equal(await editor.count(),1);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await editor.focus();
      await editor.evaluate(el=>el.closest('.ask-edit').scrollIntoView({block:'nearest'}));
    }
    await page.keyboard.press('Escape'); assert.equal(await editor.count(),0);
    assert.equal(await page.locator('.ask-draft').count(),1); assert.equal(await drawer(page).isVisible(),true);
    await page.locator('#askPrompt').focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('.ask-draft').count(),0);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W4: preflight conflicts and locked credentials preserve every turn, draft and editor', async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes',negative:'low quality'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'第一份'); await applyDraft(page);
    await askDraft(page,llm,[patchStep('replace','low quality','blurry','image.negative')],'第二份'); await applyDraft(page);
    await page.evaluate(()=>drawing.patch({prompt:'manual'}));
    const before=await page.evaluate(()=>ask.entries.value), editor=await editQuestion(page); await editor.fill('保留这段修改');
    await editor.press('Enter'); await page.waitForFunction(()=>ask.notice.value.includes('Prompt 已变化'));
    assert.deepEqual(await page.evaluate(()=>ask.entries.value),before); assert.equal((await form(page)).negative,'blurry');
    assert.equal(await editor.inputValue(),'保留这段修改'); assert.equal(calls.length,2);
    await page.evaluate(()=>{
      drawing.patch({prompt:'blue eyes'});
      const p=document.body.__vue_app__._context.provides;
      window.w4Services=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')];
      w4Services.connections.clearKey('chat-key');
    });
    await editor.press('Enter'); await page.waitForFunction(()=>ask.notice.value.includes('API Key'));
    assert.equal((await form(page)).prompt,'blue eyes'); assert.equal((await form(page)).negative,'blurry');
    assert.deepEqual(await page.evaluate(()=>ask.entries.value),before); assert.equal(calls.length,2);
    await page.evaluate(()=>w4Services.connections.supplyKey('chat-key','synthetic-chat'));
    // Another conversation's newer write cannot be skipped, even for independent fields.
    const source=await page.evaluate(()=>ask.conversationId.value);
    await page.evaluate(()=>ask.newConversation());
    await askDraft(page,llm,[patchStep('append','','，来自别的对话')],'别的对话'); await applyDraft(page);
    await page.evaluate(id=>ask.selectConversation(id),source);
    const again=await editQuestion(page); await again.fill('被夹层挡住'); await again.press('Enter');
    await page.waitForFunction(()=>ask.notice.value.includes('先回退较新的草稿'));
    assert.equal(calls.length,3); assert.equal(await again.inputValue(),'被夹层挡住');
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W4: a persistence failure halfway retains history and marks only successful rollback, then retry finishes', async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'第一份'); await applyDraft(page);
    await askDraft(page,llm,[patchStep('replace','blue eyes','green eyes')],'第二份'); await applyDraft(page);
    await page.evaluate(()=>{
      const original=drawing.writeDraft; let writes=0;
      window.w4Write=original;
      drawing.writeDraft=async (...args)=>{ if(++writes===2) throw new Error('synthetic second save failure'); return original(...args); };
    });
    const editor=await editQuestion(page); await editor.fill('新的提问'); await editor.press('Enter');
    await page.waitForFunction(()=>ask.notice.value.includes('synthetic second save failure'));
    assert.deepEqual(await page.locator('.ask-checkpoint').evaluateAll(els=>els.map(el=>el.dataset.state)),['applied','reverted']);
    assert.equal((await form(page)).prompt,'blue eyes'); assert.equal(calls.length,2); assert.equal(await editor.inputValue(),'新的提问');
    await page.evaluate(()=>drawing.writeDraft=w4Write); llm.push({body:openai(text('重新回答成功'),end())});
    await editor.press('Enter'); await drawer(page).getByText('重新回答成功',{exact:true}).waitFor();
    assert.equal((await form(page)).prompt,'red eyes'); assert.equal(await page.locator('.ask-turn').count(),1); assert.equal(await page.evaluate(()=>ask.redoId.value),null);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W4: editing can roll back real CHAT branches and composer writes together', async () => {
  const {page,context,llm,requests,errors}=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings()});
  try {
    await bind(page); await seedAskChat(page); const initial=await page.evaluate(()=>chat.snapshot().current);
    await askDraft(page,llm,[{kind:'chat_distill_branch',source:'#c1.1',exclude:['#c2.1'],text:'第一份分支输入'}],'第一份分支'); await applyDraft(page);
    await askDraft(page,llm,[patchStep('append','','，补充构图','chat.composer')],'补充描述'); await applyDraft(page);
    await askDraft(page,llm,[{kind:'chat_distill_branch',source:'#c1.1',exclude:[],text:'第二份分支输入'}],'第二份分支'); await applyDraft(page);
    const editor=await editQuestion(page); await editor.fill('从头讨论'); llm.push({body:openai(text('回退后回答'),end())});
    await editor.press('Enter'); await drawer(page).getByText('回退后回答',{exact:true}).waitFor();
    const restored=await page.evaluate(()=>chat.snapshot().current);
    for(const key of ['headId','mainId','skipTurnIds','baseFollows','prompt']) assert.deepEqual(restored[key],initial[key]);
    assert.equal(restored.turns.length,initial.turns.length); assert.equal(await page.locator('.ask-checkpoint').count(),0);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

for(const connectionId of ['chat','claude']) test(`ASK W4: ${connectionId} fork keeps exact prefix, zero usage, original anchor and independent ownership`, async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings({connectionId})});
  const answer = value => connectionId==='chat' ? openai(text(value),end()) : anthropic(
    {type:'message_start',message:{usage:{input_tokens:100}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:value}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:10}},
    {type:'message_stop'});
  const send=async question=>{llm.push({body:answer(`回答 ${question}`)});await page.locator('#askPrompt').fill(question);await submitAsk(page);await drawer(page).getByText(`回答 ${question}`,{exact:true}).waitFor();};
  try {
    await bind(page); await addImage(page,'fork anchor'); await page.evaluate(()=>ask.show({anchor:'#h1'}));
    await send('第一轮'); await send('第二轮'); await send('第三轮');
    const source=await page.evaluate(()=>({id:ask.conversationId.value,entries:ask.entries.value,usage:ask.usage.value}));
    await page.evaluate(()=>{ask.clearAnchor();ask.setInput('原对话未发送内容');});
    const target=drawer(page).locator('.ask-turn').nth(1); await target.hover(); await target.getByRole('button',{name:'从此处分支'}).click();
    await page.waitForFunction(()=>document.activeElement?.id==='askPrompt');
    const fork=await page.evaluate(()=>({id:ask.conversationId.value,entries:ask.entries.value,usage:ask.usage.value,local:ask.conversationUsage.value,anchor:ask.anchor.value}));
    assert.notEqual(fork.id,source.id); assert.equal(fork.entries.length,2); assert.equal(fork.anchor,'#h1');
    assert.deepEqual(fork.usage,source.usage); assert.deepEqual(fork.local,{input:0,output:0,cacheRead:0,cacheWrite:0});
    assert.equal(await page.locator('#askPrompt').inputValue(),''); assert.equal(await page.evaluate(()=>ask.heading.value.fork),true);
    assert.equal(await page.evaluate(()=>ask.undoId.value),null); assert.equal(await page.evaluate(()=>ask.redoId.value),null);
    if(connectionId==='chat') {
      const width = 1440;
      await page.setViewportSize({width,height:900}); await openConversations(page);
       await page.keyboard.press('Escape');
    }
    await send('分支问题');
    const previous=calls[2].body.messages, next=calls[3].body.messages;
    assert.deepEqual(next.slice(0,-1),previous.slice(0,-1),'the retained provider payload is an exact prefix');
    await page.evaluate(id=>ask.selectConversation(id),source.id);
    assert.deepEqual(await page.evaluate(()=>ask.entries.value),source.entries); assert.equal(await page.locator('#askPrompt').inputValue(),'原对话未发送内容');
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('ASK W4: fork drops checkpoints, notes and pending draft; source keeps them, limit and busy guards hold', async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  let release=()=>{};
  try {
    await bind(page); await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')],'已应用草稿'); await applyDraft(page);
    // External change during a successful turn creates a real note.
    llm.push({wait:new Promise(done=>release=done),body:openai(text('外部变动后的回答'),end())});
    await page.locator('#askPrompt').fill('观察变化'); await submitAsk(page); await page.waitForFunction(()=>ask.running.value);
    const first=await page.evaluate(()=>ask.entries.value.find(e=>e.type==='turn').id);
    assert.equal(await drawer(page).getByRole('button',{name:'从此处分支'}).first().isDisabled(),true);
    assert.equal(await page.evaluate(id=>ask.forkTurn(id),first),false);
    assert.equal(await page.evaluate(id=>ask.editTurn(id,'不应发送'),first),false);
    await page.evaluate(()=>drawing.patch({negative:'external'})); release(); await page.waitForFunction(()=>!ask.running.value);
    await askDraft(page,llm,[patchStep('append','','，未应用')],'待确认');
    const source=await page.evaluate(()=>({id:ask.conversationId.value,entries:ask.entries.value,plan:ask.draftPlan.value,undo:ask.undoId.value}));
    assert.ok(source.entries.some(e=>e.type==='note'));
    const last=await page.evaluate(()=>ask.entries.value.filter(e=>e.type==='turn').at(-1).id);
    assert.equal(await page.evaluate(id=>ask.forkTurn(id),last),true);
    assert.equal(await page.locator('.ask-draft').count(),0); assert.equal(await page.locator('.ask-checkpoint').count(),0); assert.equal(await page.locator('.ask-note').count(),0);
    assert.equal(await page.evaluate(()=>ask.undoId.value),null); assert.equal((await form(page)).prompt,'blue eyes');
    await page.evaluate(id=>ask.selectConversation(id),source.id);
    assert.deepEqual(await page.evaluate(()=>ask.entries.value),source.entries); assert.deepEqual(await page.evaluate(()=>ask.draftPlan.value),source.plan);
    assert.equal(await page.evaluate(()=>ask.undoId.value),source.undo);
    // Holding a real write keeps fork/edit disabled throughout persistence.
    await page.evaluate(()=>{
      window.w4OriginalWrite=drawing.writeDraft;
      drawing.writeDraft=async (...args)=>{await new Promise(done=>window.w4Release=done);return w4OriginalWrite(...args);};
      void ask.applyDraft(ask.draftPlan.value.fingerprint);
    });
    await page.waitForFunction(()=>ask.writingDraft.value);
    assert.equal(await page.evaluate(id=>ask.forkTurn(id),last),false); assert.equal(await page.evaluate(id=>ask.editTurn(id,'禁止'),first),false);
    await page.evaluate(()=>{w4Release();drawing.writeDraft=w4OriginalWrite;}); await page.waitForFunction(()=>!ask.writingDraft.value);
    await page.evaluate(id=>{while(ask.conversations.value.length<20)ask.forkTurn(id);},last);
    const count=calls.length, before=await page.evaluate(()=>ask.conversationId.value);
    assert.equal(await page.evaluate(id=>ask.forkTurn(id),last),'limit');
    assert.equal(await page.evaluate(()=>ask.conversationId.value),before); assert.equal(calls.length,count);
    assert.match(await page.locator('body').textContent(),/最多 20 个对话/);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { release(); await context.close(); }
});

test('ASK W4: editing failed and stopped questions truncates by committed count; ordinary retry keeps later turns', async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  let release=()=>{};
  try {
    await bind(page); await askText(page,llm,'成功前文');
    llm.push({status:500,type:'application/json',body:JSON.stringify({error:{message:'synthetic failure'}})});
    await page.locator('#askPrompt').fill('失败问题'); await submitAsk(page); await page.locator('.ask-turn[data-status="failed"]').waitFor();
    assert.equal(await page.locator('.ask-turn[data-status="failed"]').getByRole('button',{name:'从此处分支'}).count(),0);
    await askText(page,llm,'稍后成功');
    const failure=await page.evaluate(()=>ask.entries.value.find(e=>e.type==='turn'&&e.turn.status==='failed').id);
    llm.push({body:openai(text('普通重试结果'),end())}); await page.evaluate(id=>ask.retry(id,'plain'),failure); await page.waitForFunction(()=>!ask.running.value);
    assert.deepEqual(await page.evaluate(()=>ask.entries.value.filter(e=>e.type==='turn').map(e=>e.turn.question)),['成功前文','稍后成功','失败问题']);
    llm.push({wait:new Promise(done=>release=done),body:openai(text('不应被保留'),end())});
    await page.locator('#askPrompt').fill('停止问题'); await submitAsk(page); await page.waitForFunction(()=>ask.running.value); await page.evaluate(()=>ask.stop());
    release(); await page.locator('.ask-turn[data-status="stopped"]').waitFor();
    assert.equal(await page.locator('.ask-turn[data-status="stopped"]').getByRole('button',{name:'从此处分支'}).count(),0);
    await askText(page,llm,'停止之后的尾部');
    const edit=await editQuestion(page,3); await edit.fill('修改停止问题'); llm.push({body:openai(text('停止轮编辑成功'),end())});
    await edit.press('Enter'); await drawer(page).getByText('停止轮编辑成功',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>ask.entries.value.filter(e=>e.type==='turn').at(-1).turn.committed),4);
    assert.doesNotMatch(calls.at(-1).raw,/停止之后的尾部|不应被保留/);
    // A failed question between successful turns must also exclude its later committed tail.
    llm.push({status:500,type:'application/json',body:'{"error":{"message":"failure again"}}'});
    await page.locator('#askPrompt').fill('再次失败'); await submitAsk(page); await page.locator('.ask-turn[data-status="failed"]').waitFor();
    await askText(page,llm,'失败后的尾部');
    const again=await editQuestion(page,4); await again.fill('修改失败问题'); llm.push({body:openai(text('失败轮编辑成功'),end())});
    await again.press('Enter'); await drawer(page).getByText('失败轮编辑成功',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>ask.entries.value.at(-1).turn.committed),5); assert.doesNotMatch(calls.at(-1).raw,/再次失败|失败后的尾部/);
    assert.deepEqual(generation(requests),[]); assert.deepEqual(errors,[]);
  } finally { release(); await context.close(); }
});
