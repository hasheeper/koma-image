import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, origin, reasoning, open, openai, text, anthropic, askSettings, generation, bind, drawer, openMore, openDebug, patchStep, askDraft, applyDraft, editQuestion, scripted, wireStates, savedAsk, reloadAsk, cp2Reply, cp2Send, cp2History, cp2Result, cp2Marks, cp2Plain, cp2Context, cp3HasMemory, cp3Threshold, cp3Manual } from "./helpers/ask-fixture.mjs";

useAskFixture();

for (const connectionId of ['chat', 'claude']) test(`ASK CP4: ${connectionId} second automatic compaction, frozen prefix and full paged recall after reload`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  try {
    await cp2History(page, llm, connectionId); await cp3Manual(page, llm, connectionId, '第一份边界备忘录。');
    const first = (await savedAsk(page))[0].session.memory;
    for (let i = 7; i <= 10; i++) {
      llm.push(cp2Reply(connectionId, `新增回答 ${i}。`, 64_001)); await cp2Send(page, `新增提问 ${i}`);
      assert.equal((await savedAsk(page))[0].session.memory.text, first.text);
    }
    assert.equal(calls.length, 11, 'four new successful turns are required even above the high water');
    const before = calls.at(-1).body;
    llm.push(cp2Reply(connectionId, '<memo>第二份边界备忘录。</memo>', 70_000), cp2Reply(connectionId, '接续第二次压缩。'));
    await cp2Send(page, '第二次压缩后的新问题');
    const compact = calls[11], normal = calls[12], saved = (await savedAsk(page))[0];
    assert.equal(calls.length, 13); assert.equal(saved.session.memory.through, 'T7');
    assert.equal(saved.session.archive.length, 7); assert.equal(saved.session.turns.length, 4);
    assert.equal(saved.session.ledger.length, 11); assert.equal(saved.session.nextTurnId, 12);
    assert.equal(saved.session.lastInputTokens, 2400, 'compaction usage does not become the next trigger');
    assert.deepEqual(cp2Plain(compact.body.messages.slice(0, before.messages.length)), cp2Plain(before.messages));
    assert.deepEqual(normal.body.tools, before.tools); assert.deepEqual(normal.body.system, before.system);
    assert.deepEqual(compact.body.tools, before.tools); assert.deepEqual(compact.body.system, before.system);
    assert.match(compact.raw, /第一份边界备忘录/); assert.doesNotMatch(compact.raw, /第二次压缩后的新问题/);
    assert.match(normal.raw, /第二份边界备忘录/); assert.doesNotMatch(normal.raw, /第一份边界备忘录|甲甲甲甲/);
    assert.equal(cp2Marks(compact.body), connectionId === 'claude' ? 4 : 0);
    assert.equal(cp2Marks(normal.body), connectionId === 'claude' ? 4 : 0);
    assert.equal(compact.body.max_tokens, connectionId === 'claude' ? 8192 : undefined);
    const logs = await page.evaluate(() => ask.debug.value.calls);
    assert.equal(logs[11].purpose, 'compaction'); assert.equal(logs[12].afterCompaction, true);
    for (const i of [11, 12]) {
      const exported = JSON.parse(await page.evaluate(id => ask.exportDebug(id), logs[i].id)).calls[0];
      assert.equal(exported.body, calls[i].raw); assert.equal(exported.usage.input, i === 11 ? 70_000 : 2400);
    }
    await reloadAsk(page);
    assert.equal(calls.length, 13, 'reload never dispatches inference');
    assert.equal(await page.evaluate(() => ask.debug.value.calls.length), 0);
    assert.equal((await savedAsk(page))[0].session.memory.text, saved.session.memory.text);
    const pages = [];
    // Six tool calls in the first turn, then one in the next: retain the normal tool budget.
    for (const offsets of [[0, 8000, 16000, 24000, 32000, 40000], [48000]]) {
      const start = calls.length;
      for (const offset of offsets) llm.push({ body: scripted(connectionId, 'get_turn', {
        attachments: ['text-1'], offset, ...(offset === 0 ? { turns: ['T1'], include: 'full' } : {}),
      }) });
      llm.push(cp2Reply(connectionId, '已读完本批附件片段。'));
      await cp2Send(page, `按偏移继续读取 ${offsets[0]}`);
      for (let i = 0; i < offsets.length; i++) {
        const result = cp2Result(calls[start + i + 1]), chunk = result.attachments[0];
        assert.equal(chunk.offset, offsets[i]); assert.equal(chunk.total_chars, 50_000);
        assert.equal(chunk.next_offset, offsets[i] === 48000 ? null : offsets[i] + 8000);
        assert.ok(chunk.text.length <= 8000); pages.push(chunk.text);
        if (offsets[i] === 0) {
          assert.match(JSON.stringify(result.turns[0]), /CP2 originally sent state/);
          assert.doesNotMatch(JSON.stringify(result.turns[0]), /甲甲甲甲|"base":/);
        }
      }
    }
    assert.equal(pages.join(''), '甲'.repeat(50_000));
    assert.equal((await savedAsk(page))[0].session.ledger.length, 13);
    await page.evaluate(() => ask.toggleFavorite());
    assert.equal((await savedAsk(page)).length, 0); assert.ok(await page.evaluate(() => ask.memory.value));
    await reloadAsk(page);
    assert.equal(await page.evaluate(() => ask.memory.value), null); assert.equal(await page.locator('.ask-turn').count(), 0);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP4: ${connectionId} archived/retained forks isolate future attachments and survive source deletion`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  try {
    await cp2History(page, llm, connectionId);
    await page.evaluate(() => ask.addPastedText('only-in-source-future-attachment'));
    llm.push(cp2Reply(connectionId, '未来轮次。')); await cp2Send(page, '只有来源会话的未来设定');
    await cp3Manual(page, llm, connectionId);
    await cp3Threshold(page, 200_000);
    const source = (await savedAsk(page))[0], branches = [];
    for (const [turnId, hasMemory] of [['T2', false], ['T5', true]]) {
      await page.evaluate(id => ask.selectConversation(id), source.id);
      assert.equal(await page.evaluate(turnId => ask.forkTurn(ask.entries.value.find(e => e.type === 'turn' && e.turn.turnId === turnId).id), turnId), true);
      assert.equal(!!await page.evaluate(() => ask.memory.value), hasMemory);
      const start = calls.length;
      llm.push({ body: scripted(connectionId, 'get_turn', { attachments: ['text-2'] }) },
        { body: scripted(connectionId, 'get_turn', { turns: ['T7'] }) },
        { body: scripted(connectionId, 'get_turn', { turns: ['T1'], attachments: ['text-1'], offset: 48_000 }) },
        cp2Reply(connectionId, '只读取本分支前缀。'));
      await cp2Send(page, '核对本分支可访问的原文');
      assert.equal(calls.length, start + 4);
      assert.equal(cp3HasMemory(calls[start].body), hasMemory);
      assert.doesNotMatch(calls[start].raw, /only-in-source-future-attachment|只有来源会话的未来设定/);
      assert.match(calls[start + 1].raw, /text-2.*不在本会话/);
      assert.match(calls[start + 2].raw, /T7.*不在本会话/);
      assert.equal(cp2Result(calls[start + 3]).attachments[0].text, '甲'.repeat(2000));
      await page.evaluate(() => ask.toggleFavorite()); branches.push(await page.evaluate(() => ask.conversationId.value));
    }
    assert.deepEqual((await savedAsk(page)).find(r => r.id === source.id).session, source.session);
    await page.evaluate(id => ask.deleteConversation(id), source.id);
    await reloadAsk(page);
    assert.equal((await savedAsk(page)).length, 2);
    for (const id of branches) {
      await page.evaluate(id => ask.selectConversation(id), id);
      assert.equal(await page.evaluate(() => ask.attachmentText('text-1').length), 50_000);
      assert.equal(await page.evaluate(() => ask.attachmentText('text-2')), null);
      assert.equal((await savedAsk(page)).find(r => r.id === id).session.ledger.at(-1).turnId, 'T8');
    }
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK CP4: threshold sync/backup round trip excludes compacted favorites and preserves local recall', async () => {
  const { page, context, llm, calls, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await cp2History(page, llm, 'chat'); await cp3Manual(page, llm, 'chat', 'local-only-compacted-memo');
    const saved = (await savedAsk(page))[0];
    const second = await context.newPage(); await second.goto(origin + '/#/image/settings/ask'); await second.waitForSelector('#askCompactionTokens');
    await cp3Threshold(page, 96_000);
    await second.waitForFunction(() => document.querySelector('#askCompactionTokens').value === '96000');
    await second.close();
    const backup = await page.evaluate(async () => {
      const p = document.body.__vue_app__._context.provides;
      window.cp4Services = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
      const { blob, counts } = await cp4Services.backup.export();
      window.cp4Backup = await cp4Services.backup.read(blob);
      return { counts, checked: cp4Backup };
    });
    assert.equal(backup.counts.conversations, 0);
    assert.equal(JSON.parse(backup.checked.preferences.ask).compaction.highWaterTokens, 96_000);
    assert.doesNotMatch(JSON.stringify(backup), /local-only-compacted-memo|cp2-long|成功提问|甲甲甲甲|session_memory/);
    await cp3Threshold(page, 32_000);
    await page.evaluate(() => cp4Services.backup.import(cp4Backup));
    assert.equal(await page.evaluate(() => ask.settings.value.compaction.highWaterTokens), 96_000);
    assert.deepEqual((await savedAsk(page))[0].session, saved.session);
    await reloadAsk(page);
    assert.equal(await page.evaluate(() => ask.settings.value.compaction.highWaterTokens), 96_000);
    assert.equal(await page.evaluate(() => ask.attachmentText('text-1').length), 50_000);
    assert.equal(await page.evaluate(() => ask.memory.value.memo), 'local-only-compacted-memo');
    assert.equal(calls.length, 7); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP2: ${connectionId} durable compaction, exact debug, next request and archived attachment after reload`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  try {
    await cp2History(page, llm, connectionId);
    const previous = calls.at(-1).body, before = (await savedAsk(page))[0];
    assert.equal(before.session.lastInputTokens, 2406, 'normalized Anthropic input is not counted twice');
    await page.evaluate(async () => {
      await drawing.patch({ prompt: 'CP2 current unsent state' });
      await ask.addPastedText('CP2 pending attachment'); ask.setInput('CP2 pending question'); await ask.flushFavorites();
    });
    llm.push(cp2Reply(connectionId, '<memo>归档前三轮的合成备忘录。</memo>', 9000));
    assert.equal(await page.evaluate(() => ask.compactContext()), 'compacted');
    const compaction = calls.at(-1), saved = (await savedAsk(page))[0];
    assert.equal(calls.length, 7); assert.equal(saved.session.archive.length, 3); assert.equal(saved.session.turns.length, 3);
    assert.equal(saved.session.memory.through, 'T3'); assert.equal(saved.session.ledger.length, 6); assert.equal(saved.session.nextTurnId, 7);
    assert.equal(saved.session.lastInputTokens, 2406); assert.equal(saved.session.turnsSinceCompaction, 0);
    assert.equal(saved.session.usage.input, before.session.usage.input + 9000);
    assert.equal(saved.attachments.find(a => a.id === 'text-1').text.length, 50_000);
    assert.doesNotMatch(JSON.stringify(saved.session.archive), /甲甲甲甲|"base":/);
    assert.match(JSON.stringify(saved.session.archive[0]), /CP2 originally sent state|text-1/);
    assert.doesNotMatch(compaction.raw, /CP2 pending|CP2 current unsent state/);
    assert.deepEqual(compaction.body.tools, previous.tools); assert.deepEqual(compaction.body.system, previous.system);
    assert.deepEqual(cp2Plain(compaction.body.messages.slice(0, previous.messages.length)), cp2Plain(previous.messages));
    assert.equal(compaction.body.tool_choice, undefined);
    assert.equal(cp2Marks(compaction.body), connectionId === 'claude' ? 3 : 0);
    assert.equal(compaction.body.max_tokens, connectionId === 'claude' ? 8192 : undefined);
    assert.equal(compaction.body.max_completion_tokens, undefined);
    assert.equal(await page.locator('#askPrompt').inputValue(), 'CP2 pending question');
    assert.deepEqual(await page.evaluate(() => ask.tray.value.map(a => a.id)), ['text-2']);
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'CP2 current unsent state');
    const log = await page.evaluate(() => ask.debugCall(ask.debug.value.calls.at(-1).id));
    assert.equal(log.purpose, 'compaction'); assert.equal(log.body, compaction.raw); assert.equal(log.usage.input, 9000);
    assert.equal(JSON.parse(await page.evaluate(id => ask.exportDebug(id), log.id)).calls[0].body, compaction.raw);
    await openDebug(page); assert.equal(await page.locator('#askDebug option').filter({ hasText: '· 压缩 ·' }).count(), 1);
    await page.getByRole('button', { name: '关闭调用上下文', exact: true }).click();

    llm.push({ body: scripted(connectionId, 'get_turn', { turns: ['T1'], include: 'full', attachments: ['text-1'], offset: 48_000 }) },
      { body: scripted(connectionId, null) });
    await cp2Send(page, '接续并取回 T1');
    const first = calls[7];
    assert.match(first.raw, /session_memory/); assert.doesNotMatch(first.raw, /甲甲甲甲/);
    assert.equal(cp2Marks(first.body), connectionId === 'claude' ? 4 : 0);
    assert.equal(wireStates(first.body).at(-1).image.form.prompt, 'CP2 current unsent state');
    assert.equal(wireStates(first.body).at(-1).ask_turn_id, 'T7');
    const recalled = cp2Result(calls.at(-1));
    assert.match(JSON.stringify(recalled.turns[0]), /CP2 originally sent state/);
    assert.equal(recalled.attachments[0].text.length, 2000); assert.equal(recalled.attachments[0].next_offset, null);
    const logs = await page.evaluate(() => ask.debug.value.calls);
    assert.equal(logs.filter(c => c.afterCompaction).length, 1); assert.equal(logs[7].afterCompaction, true);
    assert.equal(logs[8].afterCompaction, undefined);
    await openDebug(page); assert.equal(await page.locator('#askDebug option').filter({ hasText: '· 压缩后首次 ·' }).count(), 1);
    await page.getByRole('button', { name: '关闭调用上下文', exact: true }).click();
    const after = (await savedAsk(page))[0];
    assert.equal(after.session.lastInputTokens, connectionId === 'chat' ? 1800 : 50);
    assert.doesNotMatch(JSON.stringify(after), /synthetic-chat|synthetic-claude|cache_control|purpose/);
    await reloadAsk(page);
    assert.equal(await page.evaluate(() => ask.debug.value.calls.length), 0);
    assert.equal(await page.evaluate(() => ask.attachmentText('text-1').length), 50_000);
    llm.push({ body: scripted(connectionId, 'get_turn', { attachments: ['text-1'], offset: 8000 }) }, { body: scripted(connectionId, null) });
    await cp2Send(page, '刷新后继续读取附件');
    assert.match(calls.at(-2).raw, /session_memory/);
    const continued = cp2Result(calls.at(-1)).attachments[0];
    assert.equal(continued.offset, 8000); assert.equal(continued.next_offset, 16000); assert.equal(continued.text, '甲'.repeat(8000));
    assert.equal((await savedAsk(page))[0].session.archive.length, 3);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP2: ${connectionId} network stop, save failure and queued/active-save stop preserve context and pending input`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  let release;
  try {
    await cp2History(page, llm, connectionId);
    await page.evaluate(async () => { await ask.addPastedText('未发附件保留'); ask.setInput('未发问题保留'); await ask.flushFavorites(); });
    const before = (await savedAsk(page))[0], count = calls.length;
    llm.push({ ...cp2Reply(connectionId, '<memo>迟到回复</memo>'), wait: new Promise(done => { release = done; }) });
    const dispatched = page.waitForRequest(r => reasoning.test(new URL(r.url()).pathname));
    await page.evaluate(() => { window.compactionJob = ask.compactContext(); }); await dispatched;
    const locked = await page.evaluate(async () => {
      const id = ask.conversationId.value, turn = ask.entries.value[0].id;
      ask.newConversation(); await ask.deleteConversation(id); await ask.toggleFavorite();
      const fork = ask.forkTurn(turn), edit = await ask.editTurn(turn, '禁止重答');
      await ask.send(); await ask.undoDraft();
      return { id: ask.conversationId.value, running: ask.running.value, compacting: ask.compacting.value, canManage: ask.canManage.value, fork, edit, favorite: ask.heading.value.favorite };
    });
    assert.deepEqual(locked, { id: before.id, running: true, compacting: true, canManage: false, fork: false, edit: false, favorite: true });
    await page.evaluate(() => ask.stop()); assert.equal(await page.evaluate(() => compactionJob), 'stopped'); release();
    assert.deepEqual(cp2Context((await savedAsk(page))[0].session), cp2Context(before.session));
    assert.equal(calls.length, count + 1); assert.equal(await page.evaluate(() => ask.debug.value.calls.at(-1).status), 'stopped');

    await page.evaluate(() => {
      const p = document.body.__vue_app__._context.provides;
      window.cp2Services = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
      const write = cp2Services.data.write;
      cp2Services.data.write = () => { cp2Services.data.write = write; return Promise.reject(new Error('synthetic compaction save failure')); };
    });
    llm.push(cp2Reply(connectionId, '<memo>不能保存的候选</memo>'));
    assert.equal(await page.evaluate(() => ask.compactContext()), 'failed');
    const failed = (await savedAsk(page))[0];
    assert.deepEqual(cp2Context(failed.session), cp2Context(before.session));
    assert.equal(failed.session.usage.input, before.session.usage.input + 2400);
    assert.match(await page.evaluate(() => ask.notice.value), /synthetic compaction save failure/);

    await page.evaluate(() => {
      const write = cp2Services.data.write; window.saveWaiting = false;
      cp2Services.data.write = async work => {
        cp2Services.data.write = write; window.saveWaiting = true;
        await new Promise(resolve => { window.releaseSave = resolve; });
        return write(work);
      };
    });
    llm.push(cp2Reply(connectionId, '<memo>保存前停止的候选</memo>'));
    await page.evaluate(() => { window.compactionJob = ask.compactContext(); });
    await page.waitForFunction(() => saveWaiting);
    assert.deepEqual(cp2Context((await savedAsk(page))[0].session), cp2Context(before.session));
    await page.evaluate(() => { ask.stop(); releaseSave(); });
    assert.equal(await page.evaluate(() => compactionJob), 'stopped');
    const stopped = (await savedAsk(page))[0];
    assert.deepEqual(cp2Context(stopped.session), cp2Context(before.session));
    assert.equal(stopped.input, '未发问题保留'); assert.deepEqual(stopped.tray, ['text-2']);
    assert.equal(stopped.session.usage.input, before.session.usage.input + 4800);
    await page.evaluate(() => {
      const transaction = cp2Services.databases.transaction;
      cp2Services.databases.transaction = (...args) => {
        const tx = transaction(...args);
        if (args[1] === 'conversations' && args[2] === 'readwrite') {
          cp2Services.databases.transaction = transaction;
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            const store = objectStore(name), put = store.put.bind(store);
            store.put = record => { const request = put(record); ask.stop(); return request; };
            return store;
          };
        }
        return tx;
      };
    });
    llm.push(cp2Reply(connectionId, '<memo>事务内停止的候选</memo>'));
    assert.equal(await page.evaluate(() => ask.compactContext()), 'stopped');
    const aborted = (await savedAsk(page))[0];
    assert.deepEqual(cp2Context(aborted.session), cp2Context(before.session));
    assert.equal(aborted.session.usage.input, before.session.usage.input + 7200);
    assert.equal(calls.length, count + 4, 'no automatic retry or normal send');
    await reloadAsk(page);
    assert.equal(await page.locator('#askPrompt').inputValue(), '未发问题保留');
    assert.equal(await page.evaluate(() => ask.attachmentText('text-1').length), 50_000);
    assert.equal(await page.evaluate(() => ask.running.value), false);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { release?.(); await context.close(); }
});

test("ASK CP3: threshold settings, invalid input, restore default, reload", async () => {
  const { page, context, calls, errors } = await open('/#/image/settings/ask', { ask: askSettings() });
  try {
     await bind(page);
    const section = page.getByRole('region', { name: '上下文与附件', exact: true }), field = page.locator('#askCompactionTokens');
    assert.equal(await field.inputValue(), '64000');
    await field.fill('96000'); await field.press('Enter');
    await page.waitForFunction(() => ask.settings.value.compaction.highWaterTokens === 96000);
    for (const invalid of ['0', '-1', '1.5', '']) {
      await field.fill(invalid); await field.press('Enter'); assert.equal(await field.inputValue(), '96000');
    }
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 }); await section.scrollIntoViewIfNeeded();
    }
    await page.reload(); await page.waitForSelector('#askCompactionTokens'); assert.equal(await field.inputValue(), '96000');
    await section.getByRole('button', { name: '恢复默认', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('koma.ask.v1')).compaction.highWaterTokens === 64000);
    assert.equal(await page.locator('#askTextChars').inputValue(), '50000'); assert.deepEqual(calls, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP3: ${connectionId} manual menu, memory boundary, original preview/reference`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  try {
     await bind(page); await page.evaluate(() => ask.show());
    let menu = await openMore(page);
    assert.equal(await menu.getByRole('menuitem', { name: '压缩上下文', exact: true }).isDisabled(), true);
    assert.match(await menu.getByRole('menuitem', { name: '压缩上下文', exact: true }).getAttribute('title'), /至少需要 4 轮/); await page.keyboard.press('Escape');
    await cp2History(page, llm, connectionId);
    const beforeEstimate = await page.evaluate(() => ask.estimate.value);
    const meter = drawer(page).getByRole('meter', { name: '上下文占用（按压缩阈值估算）', exact: true });
    assert.match(await meter.getAttribute('aria-valuetext'), /上下文约 .* tokens\n压缩阈值 64,000 tokens/);
    const contextTip = drawer(page).getByRole('tooltip');
    await meter.hover(); await contextTip.waitFor();
    assert.match(await contextTip.getAttribute('aria-label'), /上下文约 .* tokens\n压缩阈值 64,000 tokens · \d+%/);
    assert.equal(await contextTip.locator('.ask-context-label').textContent(), '上下文 · 估算');
    assert.match(await contextTip.locator('.ask-context-percent').textContent(), /^\d+%$/);
    assert.match(await contextTip.locator('.ask-context-numbers').textContent(), /^[\d,]+ \/ 64,000$/);
    await page.mouse.move(0, 0); await contextTip.waitFor({ state: 'hidden' });
    await meter.focus(); await contextTip.waitFor(); await page.keyboard.press('Escape');
    await contextTip.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => ask.visible.value), true, 'Esc dismisses context details before the ASK window');
    await page.locator('#askPrompt').focus();
    await page.evaluate(() => ask.setInput('待发的新设定。'.repeat(100)));
    assert.ok(await page.evaluate(() => ask.estimate.value) > beforeEstimate, 'pending text is included in context estimate');
    await page.evaluate(() => ask.setInput(''));
    await cp3Manual(page, llm, connectionId,
      '## 夜色与街灯\n主角是一位夜班邮差，穿深蓝雨衣。\n\n' + '画面以青灰为主，暖黄只用于灯光，背景保留电车轨道。\n'.repeat(12));
    const memory = page.locator('.ask-memory');
    assert.ok(await page.evaluate(() => ask.estimate.value) < beforeEstimate, 'compression releases the displayed context');
    assert.equal(Number(await meter.getAttribute('aria-valuenow')), await page.evaluate(() => Math.min(ask.estimate.value, ask.settings.value.compaction.highWaterTokens)));
    assert.match(await memory.locator('summary').textContent(), /已压缩前 3 轮.*约 .* tokens/);
    // The row stays where the compaction ran, below the last turn it saw, not up at the archive boundary.
    assert.equal(await memory.evaluate(el => el.previousElementSibling.querySelector('.ask-q').textContent), '成功提问 6');
    assert.equal(await memory.evaluate(el => el.nextElementSibling), null);
    await memory.locator('summary').click();
    assert.equal(await memory.getByRole('tab', { name: '记忆', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await memory.getByRole('button', { name: '查看 T1 原文', exact: true }).isVisible(), false);
    await memory.getByRole('button', { name: '展开全文', exact: true }).click();
    await memory.getByRole('button', { name: '收起全文', exact: true }).click();
    await memory.getByRole('tab', { name: '记忆', exact: true }).press('ArrowRight');
    assert.equal(await memory.getByRole('tab', { name: '轮次 3', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await memory.getByRole('button', { name: /查看 T\d 原文/ }).count(), 3);
    await memory.getByRole('tab', { name: '附件 1', exact: true }).click();
    assert.match(await memory.locator('.memory-file').getAttribute('title'), /text-1.*cp2-long.md/);
    await memory.getByRole('button', { name: /cp2-long.md.*50,000 字/ }).click();
    const attachment = memory.getByRole('region', { name: 'cp2-long.md', exact: true });
    assert.equal((await attachment.locator('pre').textContent()).length, 50_000);
    await page.keyboard.press('Escape');
    assert.equal(await memory.locator('.memory-file').evaluate(el => document.activeElement === el), true);
    await memory.getByRole('tab', { name: '轮次 3', exact: true }).click();
    const frozen = (await savedAsk(page))[0].session.memory.text;
    const boardId = await page.evaluate(() => drawing.snapshot().activeBoardId);
    await page.evaluate(id => drawing.renameBoard(id, '改名后的长画板名称 · 夜色与街灯中的人物设定'), boardId);
    assert.match(await memory.locator('.memory-turn').first().getAttribute('title'), /改名后的长画板名称/);
    assert.equal((await savedAsk(page))[0].session.memory.text, frozen, 'board names affect only the local ledger view');
    {
      const width = 1440;
      await page.setViewportSize({ width, height: 900 }); await memory.scrollIntoViewIfNeeded();
      await meter.hover(); await contextTip.waitFor();

      await page.mouse.move(0, 0); await contextTip.waitFor({ state: 'hidden' });
      await memory.getByRole('tab', { name: '记忆', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.memory-tab[aria-selected="true"]')?.textContent === '记忆');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      await memory.getByRole('tab', { name: '轮次 3', exact: true }).click();
    }
    await memory.getByRole('button', { name: '查看 T1 原文', exact: true }).click();
    const preview = memory.getByRole('region', { name: 'T1 · 原文', exact: true }); await preview.waitFor();
    assert.match(await preview.locator('pre').textContent(), /成功提问 1/);
    assert.match(await preview.locator('pre').textContent(), /CP2 originally sent state/);
    assert.doesNotMatch(await preview.locator('pre').textContent(), /甲甲甲甲/);
    await preview.getByRole('button', { name: '引用到输入框', exact: true }).click();
    await page.waitForFunction(() => ask.tray.value.some(a => a.name === 'T1-原文.txt'));
    assert.equal(await page.locator('#askPrompt').evaluate(el => document.activeElement === el), true);
    assert.equal(calls.length, 7, 'preview/reference never calls the model');
    await page.evaluate(async id => { await drawing.createBoard(); await drawing.removeBoard(id); }, boardId);
    assert.match(await memory.locator('.memory-turn').first().getAttribute('title'), /已删除的画板/);
    assert.equal((await savedAsk(page))[0].session.memory.text, frozen);
    await cp3Threshold(page, 1000);
    assert.equal(await meter.getAttribute('aria-valuemax'), '1000');
    assert.equal(await meter.getAttribute('aria-valuenow'), '1000', 'meter caps at the configured threshold');
    llm.push(cp2Reply(connectionId, '仍保留最近轮次。')); await cp2Send(page, '引用这个原文继续');
    assert.equal(calls.length, 8, 'manual compaction resets the four-new-turn interval');
    assert.match(calls.at(-1).raw, /T1-原文.txt/);
    await reloadAsk(page); assert.equal(await page.locator('.ask-memory').count(), 1);
    await page.locator('.ask-memory summary').click();
    await page.getByRole('tab', { name: '轮次 3', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '查看 T1 原文', exact: true }).count(), 1);
    await page.getByRole('button', { name: '查看 T1 原文', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: '查看 T1 原文', exact: true }).evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Escape');
    assert.equal(await memory.evaluate(el => el.open), false);
    assert.equal(await memory.locator('summary').evaluate(el => document.activeElement === el), true);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP3: ${connectionId} automatic compaction precedes consumption, uses latest board and stops the whole send`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  let release;
  const begin = async memo => {
    llm.push({ ...cp2Reply(connectionId, `<memo>${memo}</memo>`), wait: new Promise(done => { release = done; }) });
    const dispatched = page.waitForRequest(r => reasoning.test(new URL(r.url()).pathname));
    await page.evaluate(() => { window.cp3Send = ask.send(); }); await dispatched;
  };
  try {
    await cp2History(page, llm, connectionId); await cp3Threshold(page, 2000);
    await page.evaluate(async () => { await ask.addPastedText('待发的全新附件'); ask.setInput('待发的新问题'); });
    const before = (await savedAsk(page))[0].session;
    await begin('停止的压缩');
    assert.match(await page.locator('.ask-organizing').textContent(), /正在压缩上下文/);
    assert.equal(await page.locator('#askPrompt').inputValue(), '待发的新问题');
    assert.equal(await page.evaluate(() => ask.tray.value.length), 1);
    assert.doesNotMatch(calls.at(-1).raw, /待发的新问题|待发的全新附件/);
    await drawer(page).getByRole('button', { name: '停止', exact: true }).click();
    await page.evaluate(() => cp3Send); release();
    assert.equal(calls.length, 7); assert.equal(await page.evaluate(() => ask.entries.value.filter(e => e.type === 'turn').length), 6);
    assert.deepEqual(cp2Context((await savedAsk(page))[0].session), cp2Context(before));
    assert.equal(await page.locator('#askPrompt').inputValue(), '待发的新问题');
    await page.evaluate(() => {
      window.busyEdges = []; window.busyObserver = new MutationObserver(records => {
        for (const record of records) busyEdges.push(record.target.getAttribute('aria-busy') === 'true');
      });
      busyObserver.observe(document.querySelector('.ask-composer'), { attributes: true, attributeFilter: ['aria-busy'] });
    });
    await begin('成功的压缩'); llm.push(cp2Reply(connectionId, '已按最新表单续答。'));
    await page.evaluate(() => drawing.patch({ prompt: 'CP3 changed during compaction' }));
    release(); await page.evaluate(() => cp3Send);
    assert.equal(calls.length, 9); assert.equal(wireStates(calls.at(-1).body).at(-1).image.form.prompt, 'CP3 changed during compaction');
    assert.equal(cp3HasMemory(calls.at(-1).body), true); assert.match(calls.at(-1).raw, /待发的全新附件/);
    assert.equal(await page.locator('#askPrompt').inputValue(), ''); assert.equal(await page.evaluate(() => ask.tray.value.length), 0);
    assert.deepEqual(await page.evaluate(() => { busyObserver.disconnect(); return busyEdges; }), [true, false]);
    const saved = (await savedAsk(page))[0]; assert.equal(saved.session.turnsSinceCompaction, 1);
    assert.ok(saved.session.archive.length > 0); assert.equal(saved.session.ledger.length, 7);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { release?.(); await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP3: ${connectionId} automatic failure sends original history once; retry is explicit and unknown usage does not auto-compact`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  try {
    await cp2History(page, llm, connectionId); await cp3Threshold(page, 2000);
    llm.push(cp2Reply(connectionId, '缺少 memo 标签'), cp2Reply(connectionId, '未压缩也可回答。'));
    await cp2Send(page, '压缩失败后继续');
    assert.equal(calls.length, 8); assert.equal(cp3HasMemory(calls.at(-1).body), false);
    assert.match(calls.at(-1).raw, /成功提问 1/); assert.equal((await savedAsk(page))[0].session.archive.length, 0);
    assert.equal(await page.getByRole('button', { name: '重试压缩', exact: true }).count(), 1);
    await page.locator('.ask-compaction-failure summary').click();
    assert.equal(await page.locator('.ask-compaction-failure p').isVisible(), true);
    assert.match(await page.locator('.ask-compaction-failure p').textContent(), /压缩失败/);
    llm.push(cp2Reply(connectionId, '<memo>手动重试成功。</memo>'));
    await page.getByRole('button', { name: '重试压缩', exact: true }).click();
    await page.waitForFunction(() => !ask.running.value && !!ask.memory.value);
    assert.equal(calls.length, 9);
    // Complete four new turns but let the last completed request report no usage.
    for (let i = 0; i < 4; i++) {
      llm.push({ body: connectionId === 'chat'
        ? openai(text('没有 usage 的回答'), { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
        : anthropic({ type: 'message_start', message: {} }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '没有 usage 的回答' } },
          { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }) });
      await cp2Send(page, `未知测量 ${i}`);
    }
    assert.equal((await savedAsk(page))[0].session.lastInputTokens, null);
    llm.push(cp2Reply(connectionId, '只发正常请求')); await cp2Send(page, '未知时继续');
    assert.equal(calls.length, 14); assert.doesNotMatch(calls.at(-1).raw, /<archive_boundary>/);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const connectionId of ['chat', 'claude']) test(`ASK CP3: ${connectionId} archived edit stop preserves editor/tray; retry and archive fork rebuild once, retained edits keep memory`, async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId }) });
  let release;
  try {
    await cp2History(page, llm, connectionId); await cp3Manual(page, llm, connectionId);
    const source = await page.evaluate(() => ask.conversationId.value), original = (await savedAsk(page))[0];
    await cp3Threshold(page, 10000);
    const secondId = await page.evaluate(() => ask.entries.value[1].id);
    assert.equal(await page.evaluate(id => ask.forkTurn(id), secondId), true);
    llm.push(cp2Reply(connectionId, '<memo>分支压缩。</memo>'), cp2Reply(connectionId, '分支新回复。'));
    const count = calls.length; await cp2Send(page, '分支续聊');
    assert.equal(calls.length, count + 2, 'archive rebuild can compact fewer than four successful turns');
    assert.match(calls[count].raw, /甲甲甲甲/); assert.equal(wireStates(calls.at(-1).body).at(-1).ask_turn_id, 'T7');
    await page.evaluate(source => ask.selectConversation(source), source);
    assert.equal((await savedAsk(page))[0].session.memory.text, original.session.memory.text);
    await page.evaluate(async () => { await ask.addPastedText('底部未发附件'); ask.setInput('底部未发文字'); });
    const editor = await editQuestion(page, 2); await editor.fill('归档区重新提问');
    llm.push({ ...cp2Reply(connectionId, '<memo>不提交的压缩。</memo>'), wait: new Promise(done => { release = done; }) });
    const dispatched = page.waitForRequest(r => reasoning.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: '重新回答', exact: true }).click(); await dispatched;
    assert.equal(await editor.inputValue(), '归档区重新提问');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !ask.running.value); release();
    assert.equal(await editor.inputValue(), '归档区重新提问');
    assert.equal(await editor.evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator('#askPrompt').inputValue(), '底部未发文字');
    assert.equal(await page.evaluate(() => ask.tray.value.length), 1);
    const stopped = (await savedAsk(page))[0];
    assert.equal(stopped.session.memory, null); assert.equal(stopped.session.lastInputTokens, null); assert.equal(stopped.session.archiveRebuild, true);
    llm.push(cp2Reply(connectionId, '<memo>重答压缩。</memo>'), cp2Reply(connectionId, '重答完成。'));
    await page.getByRole('button', { name: '重新回答', exact: true }).click();
    await page.waitForFunction(() => !ask.running.value && ask.entries.value.at(-1)?.turn?.status === 'done');
    const edited = (await savedAsk(page))[0];
    assert.equal(edited.session.archiveRebuild, false); assert.equal(edited.session.turns.at(-1).turnId, 'T7');
    assert.equal(await page.locator('#askPrompt').inputValue(), '底部未发文字');
    await cp3Threshold(page, 64000);
    const keptMemory = edited.session.memory.text, normalCalls = calls.length;
    const last = await page.evaluate(() => ask.entries.value.at(-1).id);
    llm.push(cp2Reply(connectionId, '保留区重答。')); await page.evaluate(id => ask.editTurn(id, '只改保留区'), last);
    await page.waitForFunction(() => !ask.running.value && ask.entries.value.at(-1)?.turn?.status === 'done');
    assert.equal(calls.length, normalCalls + 1); assert.equal((await savedAsk(page))[0].session.memory.text, keptMemory);
    assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { release?.(); await context.close(); }
});

test('ASK CP3: ledger follows archived undo without rewriting memory; pending draft survives manual compaction and stop', async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  let release;
  try {
    await bind(page); await page.evaluate(() => drawing.patch({ prompt: 'red eyes' }));
    await askDraft(page, llm, [patchStep('replace', 'red eyes', 'blue eyes')]); await applyDraft(page);
    for (let i = 2; i <= 4; i++) { llm.push(cp2Reply('chat', `后续回答 ${i}`)); await cp2Send(page, `后续提问 ${i}`); }
    await page.evaluate(() => ask.toggleFavorite()); await cp3Manual(page, llm, 'chat');
    const frozen = (await savedAsk(page))[0].session.memory.text;
    await page.locator('.ask-memory summary').click();
    await page.getByRole('tab', { name: /^轮次 / }).click();
    assert.match(await page.locator('.memory-ledger').textContent(), /已应用/);
    await page.evaluate(() => ask.undoDraft());
    assert.match(await page.locator('.memory-ledger').textContent(), /已回退/);
    assert.equal((await savedAsk(page))[0].session.memory.text, frozen);
    await askDraft(page, llm, [patchStep('replace', 'red eyes', 'green eyes')], '保留待确认草稿');
    await page.waitForFunction(() => !ask.running.value);
    const title = await page.evaluate(() => ask.draftPlan.value.title);
    llm.push({ ...cp2Reply('chat', '<memo>停止的手动压缩</memo>'), wait: new Promise(done => { release = done; }) });
    const dispatched = page.waitForRequest(r => reasoning.test(new URL(r.url()).pathname));
    await (await openMore(page)).getByRole('menuitem', { name: '压缩上下文', exact: true }).click(); await dispatched;
    assert.equal(await drawer(page).getByRole('button', { name: '忽略', exact: true }).isDisabled(), true);
    await page.evaluate(() => ask.hide());
    assert.match(await page.locator('.ask-run .ask-activity').textContent(), /正在压缩上下文/);
    assert.ok(await page.locator('.ask-run .ask-progress').evaluate(el => el.classList.contains('empty')));
    await page.evaluate(() => ask.show());
    await page.evaluate(() => { ask.ignoreDraft(); ask.toggleDraftStep('0'); });
    assert.equal(await page.evaluate(() => ask.draftPlan.value.title), title);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !ask.running.value); release();
    assert.equal(await page.evaluate(() => ask.draftPlan.value.title), title);
    await cp3Manual(page, llm, 'chat', '同步回退后的账本');
    const final = (await savedAsk(page))[0];
    assert.equal(final.session.ledger[0].draft.status, 'reverted');
    assert.match(final.session.memory.text, /"status":"reverted"/);
    assert.equal(final.session.turns.at(-1).draft.status, 'pending');
    assert.equal(final.session.archive.some(t => t.draft?.status === 'pending'), false);
    assert.equal(await page.evaluate(() => ask.draftPlan.value.title), title);
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'red eyes');
    assert.equal(calls.length, 8);
    await applyDraft(page); await reloadAsk(page);
    const restored = (await savedAsk(page))[0];
    assert.equal(await page.locator('.ask-checkpoint button').count(), 0);
    assert.equal(await page.evaluate(() => ask.editTurn(ask.entries.value.find(e => e.type === 'turn').id, '不能跨过只读检查点重答')), false);
    assert.deepEqual((await savedAsk(page))[0].session, restored.session, 'archive editing cannot bypass a restored read-only checkpoint');
    assert.equal(await page.evaluate(() => drawing.snapshot().form.prompt), 'green eyes');
    assert.equal(calls.length, 8); assert.deepEqual(generation(requests), []); assert.deepEqual(errors, []);
  } finally { release?.(); await context.close(); }
});
