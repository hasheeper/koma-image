import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, origin, submitAsk, open, openai, text, end, askSettings, generation, bind, addImage, drawer, patchStep, askDraft, openConversations, heading, askText, scripted, wireStates, savedAsk, reloadAsk } from "./helpers/ask-fixture.mjs";

useAskFixture();

for (const connectionId of ['chat', 'claude']) test(`ASK favorites: ${connectionId} reload, exact context, attachments, auto-save, unstar and delete`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  try {

    await bind(page); await page.waitForFunction(() => ask.favoritesReady.value);
    await addImage(page, 'temporary history');
    await page.evaluate(async () => {
      const c = new OffscreenCanvas(40, 40); c.getContext('2d').fillRect(0, 0, 40, 40);
      const blob = await c.convertToBlob({ type: 'image/png' });
      await ask.addFiles([new File([blob], 'sample.png', { type: 'image/png' }), new File(['attachment-original'], 'notes.md', { type: 'text/plain' })]);
      ask.show();
    });
    llm.push({ body: scripted(connectionId, 'get_meta', { id: '#a1' }) }, { body: scripted(connectionId, null) });
    await page.locator('#askPrompt').fill('收藏样例 #h1 和 #a1'); await submitAsk(page);
    await page.waitForFunction(() => !ask.running.value && ask.entries.value.length === 1);
    const id = await page.evaluate(() => ask.conversationId.value);
    const initialMessages = calls[1].body.messages;
    let menu = await openConversations(page);
    await menu.getByRole('menuitemcheckbox', { name: '收藏会话', exact: true }).click();
    await page.waitForFunction(() => ask.heading.value.favorite && !ask.favoriteBusy.value);
    assert.equal((await savedAsk(page)).length, 1);
    const stored = (await savedAsk(page))[0];
    assert.equal(stored.attachments.length, 2);
    assert.equal(stored.attachments.some(a => 'url' in a), false);
    assert.doesNotMatch(JSON.stringify(stored), /blob:http|synthetic-chat|synthetic-claude|authorization/);

    await menu.getByRole('menuitem', { name: '新对话', exact: true }).click();
    llm.push({ body: scripted(connectionId, null) });
    await page.locator('#askPrompt').fill('临时对话不会保存'); await submitAsk(page);
    await page.waitForFunction(() => !ask.running.value && ask.entries.value.length === 1);
    assert.equal(await page.evaluate(() => ask.conversations.value[0].id), id, 'favorites precede temporary conversations');
    await reloadAsk(page);
    assert.equal(await page.evaluate(() => ask.conversations.value.length), 1);
    assert.equal(await page.evaluate(() => ask.conversationId.value), id);
    assert.equal(await heading(page), '收藏样例 #h1 和 #a1');
    assert.equal(await page.locator('.ask-turn').count(), 1);
    assert.equal(await page.evaluate(() => ask.attachmentText('text-1')), 'attachment-original');
    assert.equal(await page.evaluate(async () => (await fetch(ask.pictureInfo('#a1').url)).ok), true);
    const added = await addImage(page, 'new history after reload');
    assert.equal(await page.evaluate(id => ask.labelFor(id), added), '#h1', 'page history starts afresh after reload');
    assert.equal(await page.evaluate(() => ask.pictureInfo('#h1', ask.entries.value[0].turn.pictureRefs)), null, 'old history references never resolve to the new image');
    const nextCall = calls.length;
    llm.push({ body: scripted(connectionId, 'view_image', { id: '#a1' }) }, { body: scripted(connectionId, null) });
    await page.locator('#askPrompt').fill('继续查看附件'); await submitAsk(page);
    await page.waitForFunction(() => !ask.running.value && ask.entries.value.length === 2);
    await page.evaluate(() => ask.flushFavorites());
    const withoutCacheBoundary = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'cache_control' ? undefined : item));
    assert.deepEqual(withoutCacheBoundary(calls[nextCall].body.messages.slice(0, initialMessages.length)), withoutCacheBoundary(initialMessages), 'saved conversation preserves its message prefix; Anthropic moves the cache boundary to the newest turn');
    assert.match(calls[nextCall + 1].raw, /image/);
    assert.equal((await savedAsk(page))[0].entries.length, 2, 'new turns update the favorite');
    await page.evaluate(() => { ask.renameConversation(ask.conversationId.value, '改名后的收藏'); ask.setInput('保留未发送文字'); });
    await page.evaluate(() => ask.flushFavorites());
    await reloadAsk(page);
    assert.equal(await heading(page), '改名后的收藏');
    assert.equal(await page.locator('#askPrompt').inputValue(), '保留未发送文字');
    menu = await openConversations(page);
    await menu.getByRole('menuitemcheckbox', { name: '取消收藏', exact: true }).click();
    await page.waitForFunction(() => !ask.heading.value.favorite && !ask.favoriteBusy.value);
    assert.equal((await savedAsk(page)).length, 0);
    assert.equal(await page.locator('.ask-turn').count(), 2, 'unstar keeps the current page conversation');
    await menu.getByRole('menuitemcheckbox', { name: '收藏会话', exact: true }).click();
    await page.waitForFunction(() => ask.heading.value.favorite && !ask.favoriteBusy.value);
    await menu.getByRole('button', { name: '删除 改名后的收藏', exact: true }).click();
    await menu.getByRole('button', { name: '确认删除 改名后的收藏', exact: true }).click();
    await page.waitForFunction(() => ask.heading.value.title === '新对话');
    assert.equal((await savedAsk(page)).length, 0);
    await reloadAsk(page);
    assert.equal(await page.locator('.ask-turn').count(), 0);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK favorites: pending draft survives, applied checkpoints stay read-only after reload, failures keep the favorite', async () => {
  const { page, context, llm, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page); await page.waitForFunction(() => ask.favoritesReady.value);
    await page.evaluate(() => drawing.patch({ prompt: 'red eyes' }));
    await askDraft(page, llm, [patchStep('replace', 'red eyes', 'blue eyes')], '保存草稿');
    await page.evaluate(() => ask.toggleFavorite());
    await reloadAsk(page);
    assert.equal(await page.locator('.ask-draft').count(), 1);
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'red eyes');
    await page.locator('.ask-draft-apply').click();
    await page.waitForFunction(() => !ask.writingDraft.value && !ask.draftPlan.value);
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'blue eyes');
    await reloadAsk(page);
    assert.equal(await page.locator('.ask-draft').count(), 0);
    assert.equal(await page.locator('.ask-checkpoint[data-state=applied]').count(), 1);
    assert.equal(await page.locator('.ask-checkpoint button').count(), 0);
    await askDraft(page, llm, [patchStep('replace', 'blue eyes', 'green eyes')], '新一轮草稿');
    await page.locator('.ask-draft-apply').click();
    await page.waitForFunction(() => !ask.writingDraft.value && !ask.draftPlan.value);
    assert.equal(await page.locator('.ask-checkpoint').first().locator('button').count(), 0, 'old checkpoint cannot alias the new undo ID');
    assert.equal(await page.locator('.ask-checkpoint').last().getByRole('button', { name: '回退', exact: true }).count(), 1);
    await page.evaluate(() => {
      const p = document.body.__vue_app__._context.provides, s = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
      const write = s.data.write; s.data.write = () => { s.data.write = write; return Promise.reject(new Error('synthetic favorite save failure')); };
    });
    await page.evaluate(() => ask.toggleFavorite());
    assert.equal(await page.evaluate(() => ask.heading.value.favorite), true);
    assert.equal((await savedAsk(page)).length, 1);
    await page.evaluate(() => ask.toggleFavorite());
    assert.equal((await savedAsk(page)).length, 0);
    await reloadAsk(page);
    assert.equal(await page.locator('.ask-turn').count(), 0);
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'green eyes', 'removing a favorite never undoes workspace writes');
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK favorites: separate tabs retain both favorites and isolate repeated attachment/history labels', async () => {
  const { page, context, llm, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    const second = await context.newPage(); await second.goto(origin + '/#/image'); await second.waitForSelector('.switcher');
    const ids = [];
    for (const [target, value] of [[page, 'A'], [second, 'B']]) {
      await bind(target); await target.waitForFunction(() => ask.favoritesReady.value);
      await addImage(target, `history-${value}`);
      await target.evaluate(async value => {
        const canvas = new OffscreenCanvas(8, 8), g = canvas.getContext('2d');
        g.fillStyle = value === 'A' ? '#ff0000' : '#0000ff'; g.fillRect(0, 0, 8, 8);
        await ask.addFiles([new File([await canvas.convertToBlob()], `${value}.png`, { type: 'image/png' }), new File([`text-${value}`], `${value}.txt`, { type: 'text/plain' })]);
      }, value);
      await askText(target, llm, `收藏 ${value} #h1 #a1`);
      await target.evaluate(() => ask.toggleFavorite());
      ids.push(await target.evaluate(() => ask.conversationId.value));
    }
    assert.equal((await savedAsk(page)).length, 2, 'saving in another tab does not replace the first favorite');
    await second.close();
    await reloadAsk(page);
    for (const [id, value] of [[ids[0], 'A'], [ids[1], 'B']]) {
      await page.evaluate(id => ask.selectConversation(id), id);
      assert.equal(await page.evaluate(() => ask.attachmentText('text-1')), `text-${value}`);
      assert.equal(await page.evaluate(() => ask.entries.value[0].turn.attachments[0].name), `${value}.png`);
      assert.equal(await page.evaluate(() => ask.pictureInfo('#h1')), null);
      const pixel = await page.evaluate(async () => {
        const blob = await (await fetch(ask.pictureInfo('#a1').url)).blob(), bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(8, 8), g = canvas.getContext('2d'); g.drawImage(bitmap, 0, 0); bitmap.close();
        return [...g.getImageData(0, 0, 1, 1).data];
      });
      assert.deepEqual(pixel, value === 'A' ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    }
    await page.evaluate(id => ask.deleteConversation(id), ids[0]);
    await reloadAsk(page);
    assert.deepEqual(await page.evaluate(() => ask.conversations.value.map(c => c.id)), [ids[1]]);
    assert.equal(await page.evaluate(() => ask.attachmentText('text-1')), 'text-B');
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK favorites: new conversations in two tabs number attachments independently after a shared saved origin', async () => {
  const { page, context, llm, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page); await page.waitForFunction(() => ask.favoritesReady.value);
    await page.evaluate(() => ask.addPastedText('shared-text'));
    await askText(page, llm, '共享起点'); await page.evaluate(() => ask.toggleFavorite());
    await reloadAsk(page);
    const second = await context.newPage(); await second.goto(origin + '/#/image'); await second.waitForSelector('.switcher');
    await bind(second); await second.waitForFunction(() => ask.favoritesReady.value);
    const branches = [];
    for (const [target, value] of [[page, 'C'], [second, 'D']]) {
      await target.evaluate(async value => { ask.newConversation(); await ask.addPastedText(`new-${value}`); }, value);
      await askText(target, llm, `新收藏 ${value}`);
      await target.evaluate(() => ask.toggleFavorite());
      branches.push([await target.evaluate(() => ask.conversationId.value), value]);
    }
    await second.close();
    await reloadAsk(page);
    assert.equal((await savedAsk(page)).length, 3);
    for (const [id, value] of branches) {
      await page.evaluate(id => ask.selectConversation(id), id);
      assert.equal(await page.evaluate(() => ask.attachmentText('text-1')), `new-${value}`);
      assert.equal(await page.evaluate(() => ask.entries.value[0].turn.attachments[0].id), 'text-1');
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK favorites: interrupted request restores as stopped and never resumes automatically', async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  let release;
  try {
    await bind(page); await page.waitForFunction(() => ask.favoritesReady.value);
    await askText(page, llm, '已经完成的一轮');
    await page.evaluate(() => ask.toggleFavorite());
    llm.push({ wait: new Promise(done => release = done), body: openai(text('迟来的内容'), end()) });
    await page.locator('#askPrompt').fill('刷新前尚未完成的一轮'); await submitAsk(page);
    await page.waitForFunction(() => ask.running.value);
    await page.evaluate(() => ask.flushFavorites());
    const stored = (await savedAsk(page))[0];
    assert.equal(stored.entries.at(-1).turn.status, 'stopped');
    assert.equal(stored.session.turns.length, 1, 'only committed protocol messages persist');
    await reloadAsk(page);
    const count = calls.length;
    release();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.ask-turn[data-status=done]').count(), 1);
    assert.equal(await page.locator('.ask-turn[data-status=stopped]').count(), 1);
    assert.equal(await page.evaluate(() => ask.running.value), false);
    assert.equal(calls.length, count, 'reload never triggers inference');
    assert.equal(await page.locator('.ask-markdown').filter({ hasText: '迟来的内容' }).count(), 0);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { release?.(); await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP1: ${connectionId} stable turn recall, bounded attachment pages and favorite reload`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  const resultOf = call => {
    const m = call.body.messages.at(-1);
    const raw = typeof m.content === 'string' ? m.content : m.content.find(b => b.type === 'tool_result').content[0].text;
    return JSON.parse(raw.slice(7, -8));
  };
  const send = async (question, count) => {
    await page.locator('#askPrompt').fill(question); await submitAsk(page);
    await page.waitForFunction(n => !ask.running.value && ask.entries.value.filter(e => e.type === 'turn').length === n, count);
    assert.equal(await page.evaluate(() => ask.entries.value.at(-1).turn.status), 'done');
  };
  try {
    await bind(page); await page.waitForFunction(() => ask.favoritesReady.value);
    await page.evaluate(async () => {
      await drawing.patch({ prompt: 'CP1 originally sent board' });
      await ask.addFiles([new File(['甲'.repeat(50_000)], 'cp1.md', { type: 'text/plain' })]); ask.show();
    });
    llm.push({ body: scripted(connectionId, null) }); await send('请保留这个设定', 1);
    assert.equal(wireStates(calls[0].body).at(-1).ask_turn_id, 'T1');
    assert.equal(await page.evaluate(() => ask.entries.value[0].turn.turnId), 'T1');
    await page.evaluate(() => ask.toggleFavorite()); await reloadAsk(page);
    await page.evaluate(() => drawing.patch({ prompt: 'CP1 later unsent board' }));
    llm.push({ body: scripted(connectionId, 'get_turn', { turns: ['T1'], include: 'full' }) }, { body: scripted(connectionId, null) });
    await send('回顾 T1 的原文', 2);
    const recalled = resultOf(calls.at(-1));
    assert.equal(recalled.turns[0].question, '请保留这个设定');
    const full = JSON.stringify(recalled.turns[0]);
    assert.match(full, /CP1 originally sent board/); assert.doesNotMatch(full, /CP1 later unsent board|甲甲甲甲甲|"base":/);
    assert.match(full, /text-1/);
    llm.push({ body: scripted(connectionId, 'get_turn', { attachments: ['text-1'], offset: 48_000 }) }, { body: scripted(connectionId, null) });
    await send('继续读取设定末尾', 3);
    const pageResult = resultOf(calls.at(-1)).attachments[0];
    assert.equal(pageResult.text, '甲'.repeat(2000)); assert.equal(pageResult.total_chars, 50_000);
    assert.equal(pageResult.offset, 48_000); assert.equal(pageResult.next_offset, null);
    assert.deepEqual(await page.evaluate(() => ask.entries.value.filter(e => e.type === 'turn').map(e => e.turn.turnId)), ['T1', 'T2', 'T3']);
    assert.match(await drawer(page).textContent(), /已回顾/);
    await page.evaluate(() => ask.flushFavorites());
    const saved = (await savedAsk(page))[0];
    assert.equal(saved.session.nextTurnId, 4); assert.equal(saved.session.turns[0].attachments[0], 'text-1');
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
