import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, submitAsk, hosts, open, openai, text, tool, end, askSettings, generation, bind, addImage, drawer, openDraft, openApplyMenu, route, patchStep, proposal, askDraft, form, applyDraft, reverted, undoCheckpoint, restoreCheckpoint, billing, handoffStep, seedAskChat, islandMode, scripted, wireStates } from "./helpers/ask-fixture.mjs";

useAskFixture();

test('ASK text replacements: actual wire uses B; streamed reply, confirmed draft, form and undo keep A', async () => {
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings({replacements:[{from:'red coat',to:'azure dress'}]})});
  try {
    await bind(page);
    await page.evaluate(() => {
      drawing.patch({prompt:'red coat, standing'});
      localStorage.setItem('koma.ask.adult.v1','true');
      window.dispatchEvent(new StorageEvent('storage',{key:'koma.ask.adult.v1'}));
    });
    await page.waitForFunction(()=>ask.adult.value===true);
    assert.equal(await page.evaluate(()=>ask.codecActive.value),false,'explicit pairs do not require the automatic alias switch');
    llm.push({body:request=>{
      const state=JSON.parse(request.messages.at(-1).content.match(/<workspace_state>([\s\S]*?)<\/workspace_state>/)[1]);
      return openai(text('保留 azure dr'),text('ess，补充柔光。'),tool('replacement_draft','propose_draft',{
        base_hash:state.base_hash,draft_title:'保留 azure dress',steps:[patchStep('replace','azure dress','azure dress, soft light')],
      }),end('tool_calls'));
    }});
    await page.evaluate(()=>ask.show());
    await page.locator('#askPrompt').fill('保留 red coat，增加柔光');
    await submitAsk(page);
    await page.locator('.ask-draft[data-status="pending"]').waitFor();
    await openDraft(page);
    assert.match(calls[0].body.messages.at(-1).content,/保留 azure dress，增加柔光/);
    assert.match(calls[0].body.messages[0].content,/<codebook>/);
    assert.match(await drawer(page).locator('.ask-markdown').textContent(),/保留 red coat，补充柔光/);
    assert.match(await page.locator('#askFullDraft').textContent(),/red coat/);
    assert.equal((await page.locator('#askFullDraft').textContent()).includes('azure dress'),false);
    assert.equal((await form(page)).prompt,'red coat, standing','proposing does not write');
    await applyDraft(page);
    assert.equal((await form(page)).prompt,'red coat, soft light, standing');
    await undoCheckpoint(page);
    assert.equal((await form(page)).prompt,'red coat, standing');
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test("[core] ASK A2: confirmation, step withdrawal, apply and single-action undo preserve original tags",async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await addImage(page,'adult woman, red eyes, large breasts, nude');
    const prompt='adult woman, red eyes, large breasts, nude';
    await page.evaluate(prompt=>drawing.patch({prompt,negative:'low quality'}),prompt);
    const initial=await form(page);
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes'),patchStep('append','',', soft lighting')]);
    assert.equal(await page.locator('#askFullDraft .draft-title strong').textContent(), '调整提示词');
    // The finished draft keeps its trace line above the card instead of blinking out.
    assert.equal((await drawer(page).locator('.ask-tools-summary').last().textContent()).trim(),'已整理 草稿');
    assert.deepEqual(await form(page),initial);assert.equal(calls.length,1);
    const steps=page.locator('.draft-step');
    await steps.nth(1).getByRole('button',{name:'撤回 Prompt',exact:true}).click();
    assert.equal(await steps.nth(1).getAttribute('class').then(c=>c.includes('off')),true);
    await steps.nth(0).getByRole('button',{name:'撤回 Prompt',exact:true}).click();
    assert.equal(await page.locator('.ask-draft-apply').isDisabled(),true);
    await steps.nth(0).getByRole('button',{name:'恢复 Prompt',exact:true}).click();
    await steps.nth(1).getByRole('button',{name:'恢复 Prompt',exact:true}).click();
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.waitForTimeout(80);
      assert.ok(await page.locator('.ask-draft-apply').isVisible());
    }
    await applyDraft(page);
    assert.equal((await form(page)).prompt,'adult woman, blue eyes, large breasts, nude, soft lighting');
    await page.waitForFunction(()=>document.activeElement?.id==='prompt');
    assert.match(await page.locator('#askIsland [aria-live="polite"]').textContent(),/已应用草稿/);
    await page.keyboard.press('Control+z');
    await reverted(page);
    assert.deepEqual(await form(page),initial);
    assert.equal(await page.locator('.ask-draft').count(),0);
    await restoreCheckpoint(page);
    await page.evaluate(()=>drawing.patch({negative:'manual negative'}));
    await undoCheckpoint(page);
    assert.equal((await form(page)).negative,'manual negative');assert.equal((await form(page)).prompt,prompt);
    await restoreCheckpoint(page);
    await page.evaluate(()=>drawing.patch({prompt:'later manual prompt'}));
    await page.locator('.ask-checkpoint').getByRole('button',{name:'回退',exact:true}).click();
    assert.match(await page.locator('.ask-notice').textContent(),/回退失败：Prompt 已变化/);
    assert.equal((await form(page)).prompt,'later manual prompt');
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: rewrite shows a tag-level diff and the full text, and renders model HTML as text',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);
    const prompt='adult woman, nude, large breasts, blue eyes';
    await page.evaluate(prompt=>drawing.patch({prompt}),prompt);
    await askDraft(page,llm,[patchStep('rewrite','','BLUE EYES, adult woman, nude, large breasts, <img src=x onerror=alert(1)>')],'保留原有特征，整理顺序');
    const html='<img src=x onerror=alert(1)>';
    assert.deepEqual(await page.locator('.draft-line.ins .draft-text').allTextContents(),['BLUE EYES',html]);
    assert.deepEqual(await page.locator('.draft-line.del .draft-text').allTextContents(),['blue eyes']);
    assert.equal(await page.locator('.ask-draft img').count(),0);
    assert.match(await page.locator('.draft-stat').textContent(),/\+2\s*−1/);
    await page.getByRole('button',{name:'全文',exact:true}).click();
    assert.equal(await page.locator('.draft-full').textContent(),`BLUE EYES, adult woman, nude, large breasts, blue eyes, ${html}`);
    assert.deepEqual(await page.locator('.draft-full del').allTextContents(),['blue eyes']);
    assert.deepEqual(await page.locator('.draft-full ins').allTextContents(),['BLUE EYES',html]);
    await page.getByRole('button',{name:'改动',exact:true}).click();

    assert.equal((await form(page)).prompt,prompt);
    await applyDraft(page);assert.match((await form(page)).prompt,/nude, large breasts/);
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: changes while thinking realign unique anchors; stale preview fingerprint and stale rewrite refuse writes',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await page.evaluate(()=>drawing.patch({prompt:'red eyes, user tags'}));
    llm.push({...proposal([patchStep('replace','red eyes','blue eyes'),patchStep('rewrite','','replacement','image.negative')]),delay:250});
    await page.evaluate(()=>ask.show());await page.locator('#askPrompt').fill('调整眼睛');await submitAsk(page);
    await page.waitForFunction(()=>ask.running.value);
    await page.evaluate(()=>drawing.patch({prompt:'user prefix, red eyes, user tags',negative:'manual negative'}));
    await page.locator('.ask-draft').waitFor();
    assert.match(await page.locator('.draft-aligned').textContent(),/按当前内容对齐/);
    assert.match(await page.locator('.ask-note').last().textContent(),/外部修改/);
    assert.match(await page.locator('.draft-step.invalid').textContent(),/原文已变化/);
    const fingerprint=await page.locator('.ask-draft-apply').getAttribute('data-fingerprint');
    await page.evaluate(async fp=>{await drawing.patch({prompt:'new prefix, red eyes, user tags'});await ask.applyDraft(fp);},fingerprint);
    assert.match((await form(page)).prompt,/red eyes/);assert.match(await page.locator('.ask-notice').textContent(),/核对/);
    await applyDraft(page);assert.equal((await form(page)).prompt,'new prefix, blue eyes, user tags');assert.equal((await form(page)).negative,'manual negative');
    await undoCheckpoint(page);
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await page.evaluate(()=>drawing.patch({prompt:'anchor removed'}));
    assert.equal(await page.locator('.ask-draft-apply').isDisabled(),true);
    llm.push(proposal([patchStep('append','',', new detail')]));
    await page.getByRole('button',{name:'基于当前内容重新提议',exact:true}).click();
    await page.waitForFunction(()=>!ask.running.value&&ask.draftPlan.value?.steps[0]?.after===', new detail');
    assert.equal(await page.locator('.draft-step.invalid').count(),0);
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: Tab focus/selection/IME guards, Esc draft layer and stopped pacing never publish a draft',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await page.locator('#askPrompt').focus();await page.keyboard.press('Tab');assert.equal((await form(page)).prompt,'red eyes');
    await page.locator('#prompt').focus();await page.keyboard.press('Tab');assert.equal((await form(page)).prompt,'red eyes');
    await page.evaluate(()=>{document.activeElement.blur();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',isComposing:true,bubbles:true,cancelable:true}));});
    assert.equal((await form(page)).prompt,'red eyes');
    await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.draft-text'));getSelection().removeAllRanges();getSelection().addRange(range);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));});
    assert.equal((await form(page)).prompt,'red eyes');
    await page.evaluate(()=>getSelection().removeAllRanges());await page.keyboard.press('Tab');
    await page.locator('.ask-checkpoint[data-state="applied"]').waitFor();assert.equal((await form(page)).prompt,'blue eyes');
    await page.keyboard.press('Control+z');await reverted(page);
    await askDraft(page,llm,[patchStep('append','',', pending detail')]);
    await page.locator('#askPrompt').focus();await page.keyboard.press('Escape');await page.locator('.ask-draft').waitFor({state:'hidden'});assert.equal(await drawer(page).isVisible(),true);
    llm.push(proposal([patchStep('append','',', new detail')]));await page.locator('#askPrompt').fill('追加细节');await submitAsk(page);
    await page.waitForFunction(()=>ask.live.value?.items.some(i=>i.kind==='tools'));
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!ask.running.value);
    assert.equal(await page.locator('.ask-draft').count(),0);assert.equal((await form(page)).prompt,'red eyes');
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: cross-workspace application reveals destination, chat composer stays unsent and undo preserves identity',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await route(page,'#/chat');await page.waitForFunction(()=>location.hash==='#/chat');
    assert.match(await page.locator('.ask-draft-apply').textContent(),/切回绘图并应用/);
    await applyDraft(page);assert.equal(await page.evaluate(()=>location.hash),'#/image');
    await page.evaluate(()=>chat.setPrompt('original chat text'));
    // Asked outside CHAT, a composer patch is redirected to chat_handoff; propose it in CHAT, apply from IMAGE.
    await route(page,'#/chat');await page.locator('#chatPrompt').waitFor();
    await askDraft(page,llm,[patchStep('rewrite','','composed description','chat.composer')],'整理对话输入');
    await route(page,'#/image');await page.waitForFunction(()=>location.hash==='#/image');
    assert.match(await page.locator('.ask-draft-apply').textContent(),/切回对话并应用/);
    await applyDraft(page);assert.equal(await page.evaluate(()=>location.hash),'#/chat');
    await page.waitForFunction(()=>document.activeElement?.id==='chatPrompt');
    assert.equal(await page.locator('#chatPrompt').inputValue(),'composed description');
    await page.keyboard.press('Control+z');await reverted(page);
    assert.equal(await page.locator('#chatPrompt').inputValue(),'original chat text');
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK H0: HOME restores local CHAT only; ASK warming issues no quote or quota; opening CHAT resumes them',{timeout:45000},async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings(),standard:true,chatModel:true});
  try {
    await bind(page);await page.waitForFunction(()=>chat.snapshot().ready);
    await page.locator('#chatPrompt').fill('stored text');
    await page.waitForFunction(()=>chat.snapshot().quote);
    await page.evaluate(()=>chat.flush());
    await page.evaluate(()=>{location.hash='#/image';});await page.reload();await page.waitForSelector('.switcher');
    await bind(page);await page.evaluate(()=>home.ready);await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');
    // HOME reads stored lines even before CHAT opens; remote catalog and billing stay cold.
    assert.deepEqual(await page.evaluate(()=>{
      const s=chat.snapshot();return {loaded:s.loaded,ready:s.ready,models:s.models.length,quote:s.quote,quota:s.quota,prompt:s.current.prompt};
    }),{loaded:true,ready:false,models:0,quote:null,quota:null,prompt:'stored text'});
    const start=requests.length;
    llm.push({body:openai(tool('ctx','get_chat_context'),end('tool_calls'))},{body:openai(text('输入框里已有内容。'),end())});
    await page.evaluate(()=>ask.show());await page.locator('#askPrompt').fill('对话输入框写了什么？');await submitAsk(page);
    await page.waitForFunction(()=>!ask.running.value&&chat.snapshot().ready);
    assert.match(JSON.stringify(calls[1].body.messages.at(-1)),/stored text/);
    await page.waitForTimeout(800);
    assert.deepEqual(billing(requests.slice(start)),[]);assert.equal(await page.evaluate(()=>location.hash),'#/image');
    await route(page,'#/chat');await page.locator('#chatPrompt').waitFor();
    assert.equal(await page.locator('#chatPrompt').inputValue(),'stored text');
    await page.waitForFunction(()=>chat.snapshot().quote);
    assert.ok(billing(requests.slice(start)).some(r=>r.path.endsWith('/estimate')));
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK H3: IMAGE handoff opens a new CHAT conversation with #h, size and text; no quote until the user edits; undo removes it, redo reopens it',{timeout:60000},async()=>{
  const {page,context,llm,requests,errors}=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings(),standard:true,chatModel:true});
  try {
    await bind(page);await page.waitForFunction(()=>chat.snapshot().ready);
    await page.locator('#chatPrompt').fill('old chat text');await page.waitForFunction(()=>chat.snapshot().quote);
    await page.evaluate(()=>chat.flush());
    await page.evaluate(()=>{location.hash='#/image';});await page.reload();await page.waitForSelector('.switcher');
    await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length===2);
    await addImage(page,'adult woman, red coat');
    // IMAGE quotes its own form; let that settle so only ASK and CHAT are measured.
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');await page.waitForTimeout(150);
    const settings=await page.evaluate(()=>localStorage.getItem('koma.chat.settings.v1')),start=requests.length;
    await askDraft(page,llm,[handoffStep(['#h1'],'改为两人脸贴脸的横版特写')],'把 #h1 交给对话改横版','交给对话');
    const plan=await page.evaluate(()=>{const p=ask.draftPlan.value;return {ids:p.steps.map(s=>s.id),issues:p.steps.filter(s=>s.issue),handoff:p.handoff};});
    assert.deepEqual(plan.ids,['0:new','0:image:0','0:option:size','0:text']);assert.deepEqual(plan.issues,[]);
    assert.deepEqual(plan.handoff.images.map(i=>[i.label,i.source]),[['#h1','history']]);
    const source=await page.evaluate(()=>chat.snapshot().current.id);
    await applyDraft(page);assert.equal(await page.evaluate(()=>location.hash),'#/chat');
    await page.waitForFunction(()=>document.activeElement?.id==='chatPrompt');
    assert.equal(await page.locator('#chatPrompt').inputValue(),'改为两人脸贴脸的横版特写');
    const opened=await page.evaluate(()=>{const s=chat.snapshot(),c=s.current;return {id:c.id,count:s.conversations.length,attachments:c.attachments.length,options:c.settings.options,origin:chat.assets.assets.get(c.attachments[0])?.origin};});
    assert.notEqual(opened.id,source);assert.equal(opened.count,2);assert.equal(opened.attachments,1);assert.equal(opened.origin,'image');
    assert.deepEqual(opened.options,{quality:'auto',size:'1536x1024'});
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>chat.snapshot().quote),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('koma.chat.settings.v1')),settings);
    await page.keyboard.press('Control+z');await reverted(page);
    const back=await page.evaluate(()=>{const s=chat.snapshot();return {id:s.current.id,count:s.conversations.length};});
    assert.deepEqual(back,{id:source,count:1});assert.equal(await page.locator('#chatPrompt').inputValue(),'old chat text');
    await restoreCheckpoint(page);
    assert.equal(await page.locator('#chatPrompt').inputValue(),'改为两人脸贴脸的横版特写');
    assert.equal(await page.evaluate(()=>chat.snapshot().conversations.length),2);
    await page.waitForTimeout(1200);
    assert.deepEqual(billing(requests.slice(start)),[]);
    assert.deepEqual(requests.slice(start).filter(r=>r.host===hosts.image&&!r.path.endsWith('/image/models')),[]);
    await page.locator('#chatPrompt').press('End');await page.keyboard.type('，柔光');
    await page.waitForFunction(()=>chat.snapshot().quote);
    assert.equal(await page.evaluate(()=>ask.canUndoDraft.value),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK H3: CHAT handoff reuses the blank conversation, references #c2.1.2 without copying, and undo empties it again',{timeout:60000},async()=>{
  const {page,context,llm,requests,errors}=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings(),standard:true,chatModel:true});
  try {
    await bind(page);await page.waitForFunction(()=>chat.snapshot().ready);
    const ids=await page.evaluate(async()=>{
      const d=await import('/src/domain/conversation.ts');
      const canvas=new OffscreenCanvas(64,64),g=canvas.getContext('2d'),ids=[];
      for(let i=0;i<3;i++){g.fillStyle=['#4b638b','#866152','#746085'][i];g.fillRect(0,0,64,64);ids.push((await chat.assets.add(await canvas.convertToBlob({type:'image/png'}),`synthetic${i}`,{width:64,height:64})).id);}
      chat.mutate(c=>{
        let r=d.beginTurn(c,d.contextSnapshot(c),'第 1 轮描述',{});d.completeVersion(c,r.turn,r.version,[{type:'image',assetId:ids[0]}],null,c.selectionRevision);
        r=d.beginTurn(c,d.contextSnapshot(c),'第 2 轮描述',{});d.completeVersion(c,r.turn,r.version,[{type:'image',assetId:ids[1]},{type:'image',assetId:ids[2]}],null,c.selectionRevision);
        c.prompt='原来的下一轮';
      });
      const seeded=chat.snapshot().current;
      chat.addConversation();chat.switchConversation(chat.snapshot().conversations.find(c=>c.id===seeded.id));
      await chat.flush();
      return ids;
    });
    const before=await page.evaluate(()=>{const s=chat.snapshot();return {current:s.current.id,count:s.conversations.length,blank:s.conversations.find(c=>!c.turns.length&&!c.prompt).id};});
    assert.equal(before.count,2);
    await page.waitForTimeout(900);const start=requests.length;
    await askDraft(page,llm,[handoffStep(['#c2.1.2'],'只保留第二张的构图')],'用 #c2.1.2 新开对话','交给新对话');
    assert.equal(await page.locator('#askFullDraft .ask-draft-apply').textContent(),'新开对话并应用');
    assert.deepEqual(await page.locator('#askFullDraft .draft-ref .ask-id').allTextContents(),['#c2.1.2']);
    await applyDraft(page);
    const opened=await page.evaluate(()=>{const s=chat.snapshot();return {current:s.current.id,count:s.conversations.length,attachments:[...s.current.attachments],prompt:s.current.prompt};});
    assert.deepEqual(opened,{current:before.blank,count:2,attachments:[ids[2]],prompt:'只保留第二张的构图'});
    await undoCheckpoint(page);
    const back=await page.evaluate((blank)=>{const s=chat.snapshot(),c=s.conversations.find(c=>c.id===blank);return {current:s.current.id,count:s.conversations.length,blank:!!c&&!c.prompt&&!c.attachments.length};},before.blank);
    assert.deepEqual(back,{current:before.current,count:2,blank:true});
    assert.equal(await page.locator('#chatPrompt').inputValue(),'原来的下一轮');
    await page.waitForTimeout(1200);
    assert.deepEqual(billing(requests.slice(start)),[]);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("ASK H4: handoff card names the new conversation, shows reference rows and verbatim input at; a removed image marks only its row",{timeout:60000},async()=>{
  const {page,context,llm,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings(),standard:true,chatModel:true});
  try {
    await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length===2);
    const first=await addImage(page,'adult woman, red coat');await addImage(page,'two adult women, cheek to cheek');
    const text='参考 #h1 的人物和 #h2 的构图，改成横版特写\n保持红色外套';
    await askDraft(page,llm,[handoffStep(['#h1','#h2'],text)],'把两张交给对话','交给对话改横版');
    const card=page.locator('#askFullDraft .ask-draft'),model=await page.evaluate(()=>chat.snapshot().model.name);
    assert.equal(await card.locator('.draft-destination').textContent(),`新对话·${model}`);
    assert.equal(await card.locator('.ask-draft-apply').textContent(),'切到对话并新开');
    assert.match(await card.locator('.ask-draft-apply').getAttribute('title'),/^新开对话写入参考图、画幅和输入框，不会发送 · Tab$/);
    assert.equal(await card.locator('[data-step="0:new"]').count(),0);
    assert.deepEqual(await card.locator('.draft-ref .ask-id').allTextContents(),['#h1','#h2']);
    await page.waitForFunction(()=>{const images=[...document.querySelectorAll('#askFullDraft .draft-thumb img')];return images.length===2&&images.every(i=>i.complete&&i.naturalWidth>0);});
    assert.deepEqual(await card.locator('.draft-ref .draft-dim').allTextContents(),['256×384','256×384']);
    assert.equal(await card.locator('[data-field="composer"] .draft-text').textContent(),text);
    assert.equal(await card.locator('[data-field="composer"] .draft-seg').count(),0);
    assert.match(await card.locator('[data-step="0:option:size"] .draft-value').textContent(),/横向$/);
    {
      const width = 1440;
      await page.setViewportSize({width,height:width>860?900:844});await page.waitForTimeout(150);
      await page.evaluate(()=>ask.hide());
      const island=page.locator('#askIsland .ask-draft.compact');await island.waitFor();
      assert.equal(await island.locator('.draft-destination').textContent(),`新对话·${model}`);
      assert.equal(await island.locator('.ask-draft-apply').textContent(),'切到对话并新开');
      assert.equal(await island.locator('.draft-apply-more').count(),0);
      await page.evaluate(()=>ask.show());await card.waitFor();
    }
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(id=>drawing.remove(id),first);
    await page.locator('#askFullDraft [data-step="0:image:0"] .draft-thumb.gone').waitFor();
    assert.equal(await card.locator('[data-step="0:image:0"] .draft-issue').textContent(),'图片已移除');
    assert.ok(await card.locator('[data-step="0:image:0"] .ask-id').isDisabled());
    assert.equal(await card.locator('[data-step="0:image:1"] .draft-issue').count(),0);
    assert.equal(await card.locator('.ask-draft-apply').isEnabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: restore checklist reuses import rules; apply/undo issue zero quotes or quota calls; manual edit resumes quote',async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings(),standard:true});
  try {
    await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length===2);
    await page.evaluate(async()=>{
      await drawing.patch({prompt:'adult woman, nude',model:'nai-diffusion-5-full',scale:5,seed:'42',width:832,height:1216});
      const c=new OffscreenCanvas(256,384);c.getContext('2d').fillRect(0,0,256,384);
      await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, await c.convertToBlob({type:'image/png'}),{width:256,height:384},{basePrompt:'adult woman, nude',model:'nai-diffusion-4-5-full',width:512,height:512,scale:7.3,seed:0,sampler:'k_euler',steps:99},null);
    });
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');await page.waitForTimeout(150);
    const initial=await form(page),start=requests.length;
    await askDraft(page,llm,[{kind:'restore_partial',source:'#h1',fields:['model','sampler','width','height','scale','seed','steps']}],'恢复 #h1 参数','从 #h1 恢复');
    assert.deepEqual(await form(page),initial);
    assert.match(await page.locator('[data-step="0:scale"]').textContent(),/7.3/);
    await page.locator('[data-step="0:steps"] button').click();

    await applyDraft(page);let current=await form(page);
    assert.equal(current.model,'nai-diffusion-4-5-full');assert.equal(current.scale,7.3);assert.equal(current.seed,'0');assert.equal(current.steps,initial.steps);assert.equal(current.width,512);assert.equal(current.sampler,'k_euler');
    await page.waitForTimeout(700);assert.equal(generation(requests.slice(start)).length,0,JSON.stringify(generation(requests.slice(start))));
    await undoCheckpoint(page);
    assert.deepEqual(await form(page),initial);await page.waitForTimeout(700);assert.equal(generation(requests.slice(start)).length,0,JSON.stringify(generation(requests.slice(start))));
    await page.locator('#prompt').fill('manual edit resumes quotation');
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');
    assert.ok(requests.slice(start).some(r=>r.path.endsWith('/estimate')));
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A2: failed persistence rolls back the draft; later manual edits survive; chat identity blocks stale writes',{timeout:45000},async()=>{
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);
    await page.evaluate(()=>{
      const p=document.body.__vue_app__._context.provides;
      window.services=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')];
    });
    await page.evaluate(()=>drawing.patch({prompt:'red eyes'}));
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await page.evaluate(()=>{window.savedSet=services.preferences.set;window.savedWrite=services.data.write;services.preferences.set=async()=>{throw new Error('synthetic persistence failure');};});
    await page.locator('.ask-draft-apply').click();
    await page.waitForFunction(()=>!ask.writingDraft.value&&ask.notice.value.includes('synthetic persistence failure'));
    assert.equal((await form(page)).prompt,'red eyes');assert.equal(await page.locator('.ask-draft').getAttribute('data-status'),'pending');
    // An edit arriving while the write is unresolved must survive its rejection.
    await page.evaluate(()=>{services.preferences.set=()=>new Promise((resolve,reject)=>{window.rejectDraftWrite=reject;});});
    await page.locator('.ask-draft-apply').click();await page.waitForFunction(()=>ask.writingDraft.value&&window.rejectDraftWrite);
    await page.evaluate(async()=>{const reject=window.rejectDraftWrite;services.preferences.set=window.savedSet;await drawing.patch({prompt:'later manual text'});reject(new Error('synthetic late failure'));});
    await page.waitForFunction(()=>!ask.writingDraft.value);assert.equal((await form(page)).prompt,'later manual text');
    await page.evaluate(()=>ask.ignoreDraft());
    await route(page,'#/chat');await page.locator('#chatPrompt').waitFor();
    await page.evaluate(()=>chat.setPrompt('old conversation text'));await page.evaluate(()=>chat.flush());
    await askDraft(page,llm,[patchStep('rewrite','','new composer text','chat.composer')],'整理输入框');
    await page.evaluate(()=>{services.data.write=async()=>{throw new Error('synthetic chat failure');};});
    await page.locator('.ask-draft-apply').click();await page.waitForFunction(()=>!ask.writingDraft.value&&ask.notice.value.includes('synthetic chat failure'));
    assert.equal(await page.locator('#chatPrompt').inputValue(),'old conversation text');
    await page.evaluate(()=>{services.data.write=window.savedWrite;chat.addConversation();});
    await page.waitForFunction(()=>ask.draftPlan.value.steps[0].issue==='当前对话已切换');
    assert.equal(await page.locator('.ask-draft-apply').isDisabled(),true);
    assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('ASK A3 S6: read locked CHAT context, review branch/skip/composer, apply with zero sends and undo restores one action',async()=>{
 const {page,context,llm,calls,requests,errors}=await open('/#/chat',{ready:'#chatPrompt',ask:askSettings()});
 try{
  await bind(page);await seedAskChat(page);
  const before=await page.evaluate(()=>chat.snapshot().current);
  llm.push({body:openai(tool('ctx','get_chat_context'),end('tool_calls'))});
  llm.push({body:r=>{
   const first=r.messages.find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('<workspace_state>'));
   const base_hash=JSON.parse(first.content.match(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/)[1]).base_hash;
   return openai(text('从第一轮继续，保留原图并提纯描述。'),tool('draft','propose_draft',{base_hash,title:'提纯并准备新分支',steps:[{kind:'chat_distill_branch',source:'#c1.1',exclude:['#c2.1','#c3.1'],text:'保留轮廓和蓝色背景，增强清晰度'}]}),end('tool_calls'));
  }});
  await page.evaluate(()=>ask.show());await page.locator('#askPrompt').fill('为什么越改越糊？从第一轮整理新分支');await submitAsk(page);
  await page.locator('.ask-draft[data-status="pending"]').waitFor();await openDraft(page);
  assert.deepEqual(await page.evaluate(()=>chat.snapshot().current),before);
  assert.match(calls[1].body.messages.at(-1).content,/actual_text/);assert.equal(await page.locator('[data-step="0:source"] button').count(),0);
  await page.locator('[data-step="0:exclude"] button').click();await page.locator('[data-step="0:exclude"] button').click();

  await applyDraft(page);const after=await page.evaluate(()=>chat.snapshot().current);
  assert.equal(after.turns.length,3);assert.equal(after.headId,before.turns[0].id);assert.equal(after.skipTurnIds.length,2);assert.equal(after.prompt,'保留轮廓和蓝色背景，增强清晰度');
  await page.keyboard.press('Control+z');await reverted(page);
  const undone=await page.evaluate(()=>chat.snapshot().current);for(const key of ['headId','mainId','skipTurnIds','prompt'])assert.deepEqual(undone[key],before[key]);
  assert.equal(await page.locator('.ask-draft').count(),0);
  await page.evaluate(()=>chat.mutate(c=>{c.baseFollows=!c.baseFollows;},true));
  await page.locator('.ask-checkpoint').getByRole('button',{name:'恢复',exact:true}).click();
  assert.match(await page.locator('.ask-notice').textContent(),/恢复失败：对话分支已变化/);
  assert.equal(generation(requests).length,0);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test("ASK A4 inline: selected text, confirmation, undo, expand and native focus guards",async()=>{
 const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);await page.evaluate(()=>drawing.patch({prompt:'adult woman, red eyes, blue hair'}));
  const initial=await form(page),source=page.locator('#prompt');
  await source.focus();await source.evaluate(el=>el.setSelectionRange(13,21));
  await source.dispatchEvent('keydown',{key:'k',ctrlKey:true,isComposing:true});assert.equal(await drawer(page).isVisible(),false);
  await source.press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='askPrompt');
  assert.equal(calls.length,0);assert.deepEqual(await page.evaluate(()=>ask.inline.value),{target:'image.prompt',text:'red eyes'});
  llm.push(proposal([patchStep('replace','red eyes','blue eyes')]));
  await page.locator('#askPrompt').fill('把选中的眼睛颜色改成蓝色');await submitAsk(page);await page.locator('.ask-draft[data-status="pending"]').waitFor();
  const dynamic=calls[0].body.messages.at(-1).content;
  assert.match(dynamic,/"inline_selection":\{"target":"image.prompt","text":"red eyes"\}/);assert.deepEqual(await form(page),initial);

  await source.focus();await source.press('Tab');assert.deepEqual(await form(page),initial);
  await page.locator('#askPrompt').fill('保留这条未发送的问题');
  await drawer(page).getByRole('button',{name:'展开',exact:true}).click();
  assert.equal(await drawer(page).getAttribute('class').then(c=>c.includes('ask-inline')),false);
  assert.equal(await page.locator('#askPrompt').inputValue(),'保留这条未发送的问题');assert.equal(await page.locator('.ask-draft[data-status="pending"]').count(),1);
  await applyDraft(page);assert.match((await form(page)).prompt,/blue eyes/);
  await source.focus();await source.press('Control+z');await reverted(page);assert.deepEqual(await form(page),initial);
  assert.equal(await page.locator('.ask-draft').count(),0);
  await page.locator('#askPrompt').focus();await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});assert.equal(await source.evaluate(el=>document.activeElement===el),true);
  await source.press('Meta+k');await page.locator('#askDrawer.ask-inline').waitFor();await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});
  await route(page,'#/image/settings/ask');await page.locator('#askPreference').focus();await page.locator('#askPreference').press('Control+k');assert.equal(await drawer(page).isVisible(),false);
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('ASK A4 inline: autocomplete retains Tab/Esc and IME; K dismisses suggestions without selecting, supports Negative and CHAT',async()=>{
 const {page,context,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
 try{
  await bind(page);
  await context.route('https://tagsuggest.zeabur.app/**',r=>r.fulfill({json:{results:[{name:'blue_hair',cn_name:'蓝发',category:0,count:100}]}}));
  await page.evaluate(async()=>{const p=document.body.__vue_app__._instance.provides;const {servicesKey}=await import('/src/app/services.ts');const s=p[servicesKey];await s.preferences.set('koma.prefs.v1',{...s.preferences.get('koma.prefs.v1',{}),tagSuggest:true});});
  const source=page.locator('#prompt');await source.fill('blue');await page.locator('.tag-suggest:not([hidden]) .tag-suggest-option').waitFor();
  await source.press('Tab');assert.match(await source.inputValue(),/blue hair/);assert.equal(await drawer(page).isVisible(),false);
  await source.fill('blue');await page.locator('.tag-suggest:not([hidden]) .tag-suggest-option').waitFor();await source.press('Escape');assert.equal(await source.getAttribute('aria-expanded'),'false');assert.equal(await source.inputValue(),'blue');
  await source.fill('blu');await source.dispatchEvent('compositionstart');await source.dispatchEvent('keydown',{key:'k',metaKey:true,isComposing:true});assert.equal(await drawer(page).isVisible(),false);await source.dispatchEvent('compositionend');
  await source.fill('blue');await page.locator('.tag-suggest:not([hidden]) .tag-suggest-option').waitFor();await source.press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();
  assert.equal(await source.getAttribute('aria-expanded'),'false');assert.equal(await source.inputValue(),'blue');
  await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});
  await page.locator('#tab-negative').click();await page.locator('#negative').fill('low quality');await page.locator('#negative').press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();assert.equal(await page.evaluate(()=>ask.inline.value.target),'image.negative');
  await page.keyboard.press('Escape');await drawer(page).waitFor({state:'hidden'});
  await route(page,'#/chat');await page.locator('#chatPrompt').fill('保留当前风格');await page.locator('#chatPrompt').press('Control+k');await page.locator('#askDrawer.ask-inline').waitFor();
  assert.deepEqual(await page.evaluate(()=>ask.inline.value),{target:'chat.composer',text:'保留当前风格'});
  await page.locator('#askPrompt').press('Control+k');assert.equal(await page.evaluate(()=>ask.inline.value.target),'chat.composer');
  assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

for (const connectionId of ['chat','claude']) test(`C4 boards/characters: ${connectionId} frozen state, grouped draft, source board and new-board checkpoint`, async()=>{
  const {page,context,llm,calls,requests,errors}=await open('/#/image',{ready:'.switcher',standard:true,ask:askSettings({connectionId,images:false})});
  try {
    await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length===2);
    await page.evaluate(async()=>{
      await drawing.patch({prompt:'2people, park',characters:[{id:'c1',on:true,prompt:'girl, red hair',negative:'blue hair',centers:[{x:.2,y:.5}]},{id:'c2',on:true,prompt:'boy, blue hair',negative:'',centers:[{x:.8,y:.5}]}],placement:'manual'});
      window.sourceBoard=drawing.snapshot().activeBoardId;
      window.otherBoard=await drawing.createBoard(false);await drawing.patch({prompt:'inactive_secret'});await drawing.switchBoard(sourceBoard);ask.show();
    });
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');requests.length=0;
    const response=(name,input)=>scripted(connectionId==='chat'?'chat':'claude',name,input);
    llm.push({body:body=>response('get_state',{board_id:wireStates(body)[0].image.boards.find(b=>b.id!==wireStates(body)[0].image.active_board_id).id})},
      {body:body=>response('propose_draft',{base_hash:wireStates(body)[0].base_hash,draft_title:'调整角色二',steps:[
        {kind:'prompt_patch',target:'image.char.c2.prompt',mode:'replace',anchor:'blue hair',text:'green hair'},
        {kind:'character_edit',op:'set_enabled',id:'c2',on:false},
        {kind:'character_edit',op:'set_position',id:'c2',x:.7,y:.4},
        {kind:'character_edit',op:'add',prompt:'girl, blonde hair',negative:'red hair',x:.3,y:.6},
      ]})}, {body:response(null)});
    await page.locator('#askPrompt').fill('修改角色二，另一个画板仅供比较');await submitAsk(page);
    await page.locator('.ask-draft[data-status=pending]').waitFor();await page.waitForFunction(()=>!ask.running.value);
    const initial=wireStates(calls[0].body)[0];assert.equal(initial.image.form.prompt,'2people, park');assert.equal(initial.image.form.characters[1].prompt,'boy, blue hair');assert.doesNotMatch(calls[0].raw,/inactive_secret/);assert.match(calls[1].raw,/inactive_secret/);
    await openDraft(page);assert.equal(await page.locator('#askFullDraft .draft-field').count(),2);assert.equal(await page.locator('#askFullDraft .draft-field[data-field="character:c2"] .draft-step').count(),3);
    await page.evaluate(()=>drawing.switchBoard(otherBoard));await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready');requests.length=0;
    assert.match(await page.locator('#askFullDraft .ask-draft-apply').textContent(),/切回画板 1并应用/);
    await page.evaluate(()=>{
      const p=document.body.__vue_app__._context.provides,s=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')],set=s.preferences.set;
      s.preferences.set=async()=>{s.preferences.set=set;throw new Error('synthetic new-board save failure');};
    });
    await (await openApplyMenu(page)).getByRole('menuitem',{name:'应用到新画板',exact:true}).click();
    await page.waitForFunction(()=>!ask.writingDraft.value&&ask.notice.value.includes('synthetic new-board save failure'));
    assert.equal(await page.evaluate(()=>drawing.snapshot().boards.length),2);
    assert.equal(await page.evaluate(()=>drawing.snapshot().activeBoardId),await page.evaluate(()=>otherBoard));
    assert.equal(await page.evaluate(()=>ask.undoId.value),null);
    await (await openApplyMenu(page)).getByRole('menuitem',{name:'应用到新画板',exact:true}).click();
    await page.waitForFunction(()=>!ask.writingDraft.value&&drawing.snapshot().boards.length===3);
    const result=await page.evaluate(()=>({id:drawing.snapshot().activeBoardId,characters:drawing.snapshot().form.characters,source:drawing.board(sourceBoard).form.characters,prompt:drawing.board(otherBoard).form.prompt}));
    assert.equal(result.characters[1].prompt,'boy, green hair');assert.equal(result.characters[1].on,false);assert.equal(result.source[1].prompt,'boy, blue hair');assert.equal(result.prompt,'inactive_secret');
    assert.equal(result.characters[2].id,'c3');assert.equal(result.characters[2].negative,'red hair');
    assert.equal(await page.evaluate(()=>drawing.board(drawing.snapshot().activeBoardId).nextCharacterId),4);
    const checkpoint=await page.evaluate(()=>ask.undoId.value);await page.evaluate(id=>ask.undoDraft(id),checkpoint);assert.equal(await page.evaluate(()=>drawing.snapshot().boards.length),2);
    await page.evaluate(id=>ask.restoreDraft(id),checkpoint);assert.equal(await page.evaluate(()=>drawing.snapshot().activeBoardId),result.id);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

for (const connectionId of ['chat', 'claude']) test(`ASK named board: ${connectionId} locked destination, ordinary split menu, compact apply and checkpoint`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ connectionId, images: false }) });
  try {

    await bind(page);
    await page.waitForFunction(() => drawing.snapshot().models.length === 2);
    const source = await page.evaluate(async () => { await drawing.patch({ prompt: 'red eyes', seed: '7' }); return drawing.snapshot().activeBoardId; });
    const other = await page.evaluate(async () => { const id = await drawing.createBoard(false); await drawing.patch({ prompt: 'other board' }); return id; });
    await page.evaluate(id => { void drawing.switchBoard(id); ask.show(); }, source);
    const propose = async (name, mode = 'rewrite', text = 'night train, blue eyes') => {
      llm.push({ body: body => scripted(connectionId, 'propose_draft', {
        base_hash: wireStates(body).at(-1).base_hash, draft_title: '整理夜景构图', new_board_name: name,
        steps: [patchStep(mode, '', text)],
      }) }, { body: scripted(connectionId, null) });
      await page.locator('#askPrompt').fill(name ? '保留原画板，在新画板尝试雨夜电车' : '给这份提示词补充晨光');
      await submitAsk(page);
      await page.locator('.ask-draft[data-status=pending]').waitFor();
      await page.waitForFunction(() => !ask.running.value);
    };
    await propose('雨夜电车');
    assert.equal(await page.evaluate(() => drawing.snapshot().boards.length), 2, 'model proposal only previews a destination');
    assert.equal(await page.locator('.draft-destination').textContent(), '新画板·雨夜电车');
    assert.equal(await page.locator('.draft-title strong').textContent(), '整理夜景构图');
    assert.match(await page.locator('.ask-draft-apply').textContent(), /新建并应用/);
    const tools = calls[0].body.tools;
    const schema = connectionId === 'chat' ? tools.find(t => t.function.name === 'propose_draft').function.parameters : tools.find(t => t.name === 'propose_draft').input_schema;
    assert.equal(schema.properties.new_board_name.maxLength, 80);
    await page.evaluate(id => drawing.switchBoard(id), other);
    await page.waitForFunction(()=>drawing.snapshot().quote.status==='ready'); requests.length = 0;
    assert.match(await page.locator('.ask-draft-apply').textContent(), /新建并应用/);
    await openDraft(page);
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('.draft-apply-more, .draft-apply-menu').count(), 0, 'named destination has no alternative write target');
      assert.equal(await page.evaluate(() => drawing.snapshot().boards.length), 2);
    }
    await page.evaluate(() => {
      const p = document.body.__vue_app__._context.provides, services = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')], set = services.preferences.set;
      services.preferences.set = async () => { services.preferences.set = set; throw new Error('named board save failure'); };
    });
    await page.locator('.ask-draft-apply').click();
    await page.waitForFunction(() => !ask.writingDraft.value && ask.notice.value.includes('named board save failure'));
    assert.equal(await page.evaluate(() => drawing.snapshot().boards.length), 2);
    assert.equal(await page.evaluate(() => drawing.snapshot().activeBoardId), other);
    assert.equal(await page.evaluate(() => ask.undoId.value), null);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.match(await page.locator('#askCompactDraft .draft-destination').textContent(), /雨夜电车/);
    assert.equal(await page.locator('#askCompactDraft .draft-apply-more').count(), 0);
    const callCount = calls.length;
    if (connectionId === 'chat') await page.locator('#askCompactDraft .ask-draft-apply').click();
    else { await page.locator('.ask-ready [aria-label="展开 ASK 对话"]').focus(); await page.keyboard.press('Tab'); }
    await page.waitForFunction(() => !ask.writingDraft.value && !ask.draftPlan.value && drawing.snapshot().boards.length === 3);
    const created = await page.evaluate(() => ({ id: drawing.snapshot().activeBoardId, name: drawing.board(drawing.snapshot().activeBoardId).name, prompt: drawing.snapshot().form.prompt }));
    assert.equal(created.name, '雨夜电车'); assert.equal(created.prompt, 'night train, blue eyes');
    assert.equal(await page.evaluate(id => drawing.board(id).form.prompt, source), 'red eyes');
    assert.equal(await page.evaluate(id => drawing.board(id).form.prompt, other), 'other board');
    assert.equal(calls.length, callCount, 'application never calls the naming model');
    const checkpoint = await page.evaluate(() => ask.undoId.value);
    await page.evaluate(id => ask.undoDraft(id), checkpoint);
    assert.equal(await page.evaluate(id => !!drawing.board(id), created.id), false);
    await page.evaluate(id => ask.restoreDraft(id), checkpoint);
    assert.equal(await page.evaluate(() => drawing.snapshot().activeBoardId), created.id);
    assert.equal(await page.evaluate(id => drawing.board(id).name, created.id), '雨夜电车');
    await page.evaluate(() => ask.show());
    await propose('第二个试验', 'append', ', moonlight');
    await route(page, '/chat');
    await page.waitForFunction(() => ask.draftApplyLabel.value === '切回绘图并新建');
    assert.equal(await page.locator('.draft-apply-more, .draft-apply-menu').count(), 0);
    await page.evaluate(() => ask.applyDraft(ask.draftPlan.value.fingerprint, false));
    await page.waitForFunction(() => !ask.writingDraft.value && !ask.draftPlan.value);
    assert.equal(await page.evaluate(() => drawing.snapshot().boards.length), 4, 'legacy false argument cannot redirect a named new-board draft to its source');
    assert.equal(await page.evaluate(() => drawing.board(drawing.snapshot().activeBoardId).name), '第二个试验');
    assert.equal(await page.evaluate(id => drawing.board(id).form.prompt, created.id), 'night train, blue eyes');
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'night train, blue eyes, moonlight');
    assert.equal(await page.evaluate(() => location.hash), '#/image');
    await propose(undefined, 'append', ', dawn');
    assert.equal(await page.locator('.draft-destination').count(), 0);
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 });
      const menu = await openApplyMenu(page);
      assert.equal(await menu.getByRole('menuitem', { name: '应用到来源画板', exact: true }).count(), 1);
      assert.equal(await menu.getByRole('menuitem', { name: '应用到新画板', exact: true }).count(), 1);
      assert.equal((await menu.textContent()).replace(/\s+/g, ''), '应用到来源画板应用到新画板附加画板配方附加创作备忘录');
      assert.equal(await menu.locator('small').count(), 0);
      await page.locator('.ask-stream').evaluate(el => el.dispatchEvent(new Event('scroll')));
      assert.equal(await menu.count(), 1, 'message stream scrolling does not dismiss the stationary menu');

      await page.keyboard.press(width === 320 ? 'Tab' : 'Escape');
      assert.equal(await menu.count(), 0);
      assert.equal(await page.locator('.draft-apply-more').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => drawing.snapshot().boards.length), 4);
    }
    await (await openApplyMenu(page)).getByRole('menuitem', { name: /应用到来源画板/ }).click();
    await page.waitForFunction(() => !ask.writingDraft.value && !ask.draftPlan.value);
    assert.equal(await page.evaluate(() => drawing.snapshot().boards.length), 4);
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'night train, blue eyes, moonlight, dawn');
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('C4 atomic writes: failed new board leaves no copy; delayed source save never rolls back another board',async()=>{
  const {page,context,errors}=await open('/#/image',{ready:'.switcher',standard:true,ask:askSettings()});
  try {
    await bind(page);await page.waitForFunction(()=>drawing.snapshot().models.length===2);
    const result=await page.evaluate(async()=>{
      const p=document.body.__vue_app__._context.provides,s=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='application-services')];
      await drawing.patch({prompt:'A'});const a=drawing.snapshot().activeBoardId,b=await drawing.createBoard(false);await drawing.patch({prompt:'B'});
      const {boardForm}=await import('/src/domain/drawing.ts'), source=drawing.board(a), fresh={...structuredClone(source),id:'new-failed',form:{...boardForm(drawing.snapshot().form),prompt:'new'}};
      const set=s.preferences.set;s.preferences.set=async()=>{throw new Error('synthetic save failure');};
      let failed=false;try{await drawing.insertBoardDraft(fresh,a);}catch{failed=true;}s.preferences.set=set;
      const copyCount=drawing.snapshot().boards.length;
      let reject; s.preferences.set=()=>new Promise((_,r)=>reject=r);
      const pending=drawing.writeDraft({prompt:'ASK A'},{prompt:'A'},a).catch(()=>{});s.preferences.set=set;
      await drawing.switchBoard(b);await drawing.patch({prompt:'manual B'});reject(new Error('late failure'));await pending;
      s.preferences.set=()=>new Promise((_,r)=>reject=r);
      const inserting=drawing.insertBoardDraft(fresh,a).catch(()=>{});s.preferences.set=set;
      await drawing.switchBoard(b);await drawing.patch({prompt:'later B'});reject(new Error('late insert failure'));await inserting;
      const afterInsert={count:drawing.snapshot().boards.length,prompt:drawing.snapshot().form.prompt};
      await drawing.insertBoardDraft(fresh,a);
      s.preferences.set=()=>new Promise((_,r)=>reject=r);
      const removing=drawing.removeBoardDraft(fresh.id,fresh,a).catch(()=>{});s.preferences.set=set;
      await drawing.switchBoard(b);await drawing.patch({prompt:'latest B'});reject(new Error('late remove failure'));await removing;
      const afterRemove={count:drawing.snapshot().boards.length,prompt:drawing.snapshot().form.prompt,restored:drawing.board(fresh.id).form.prompt};
      return {failed,copyCount,current:drawing.snapshot().form.prompt,source:drawing.board(a).form.prompt,afterInsert,afterRemove};
    });
    assert.deepEqual(result,{failed:true,copyCount:2,current:'latest B',source:'A',afterInsert:{count:2,prompt:'later B'},afterRemove:{count:3,prompt:'latest B',restored:'new'}});assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
