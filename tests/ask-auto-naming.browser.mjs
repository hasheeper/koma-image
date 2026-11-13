import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, textReply, submitAsk, askText } from './helpers/ask-fixture.mjs';

useAskFixture();
async function configure(page, patch) {
  await page.evaluate(async patch => {
    const p = document.body.__vue_app__._context.provides;
    const services = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
    await services.preferences.set('koma.ask.v1', { ...ask.settings.value, ...patch });
  }, patch);
}
async function sendAsk(page, question) {
  await page.evaluate(() => ask.show());
  await page.locator('#askPrompt').fill(question);
  await submitAsk(page);
  await page.waitForFunction(() => !ask.running.value && ask.entries.value.at(-1)?.type === 'turn');
}
const names = page => page.evaluate(() => ask.debug.value.calls.filter(c => c.promptVersion === 'naming-2').length);
async function mockImages(page, wait = Promise.resolve()) {
  const bytes = await page.evaluate(async () => {
    const c = new OffscreenCanvas(64, 64); c.getContext('2d').fillRect(0, 0, 64, 64);
    return btoa(String.fromCharCode(...new Uint8Array(await (await c.convertToBlob()).arrayBuffer())));
  });
  await page.route(/\/images\/(?:generations|edits)$/, async route => {
    await wait;
    await route.fulfill({ json: { data: [{ b64_json: bytes }] } });
  });
}

test('Automatic ASK naming: first successful reply only, independent model, favorite reload and manual titles', async () => {
  const f = await open('/#/image', { ready: '#prompt', ask: askSettings({ autoNaming: true, naming: { connectionId: 'chat', model: 'title-model' } }) });
  const { page, llm, calls } = f;
  try {
    await bind(page);
    llm.push(textReply('可以用暖光衬托雨夜。'), textReply('雨夜车站'));
    await sendAsk(page, '画一张雨夜车站');
    await page.waitForFunction(() => !ask.naming.value && ask.heading.value.title === '雨夜车站');
    assert.equal(calls[0].body.model, 'reasoning-a');
    assert.equal(calls[1].body.model, 'title-model');
    assert.match(calls[1].raw, /画一张雨夜车站/); assert.match(calls[1].raw, /暖光/);
    assert.doesNotMatch(calls[1].raw, /workspace_state|propose_draft|image_url/);
    await askText(page, llm, '继续微调');
    assert.equal(await names(page), 1);
    await page.evaluate(() => ask.toggleFavorite());
    await page.reload(); await page.waitForSelector('#prompt'); await bind(page);
    await page.waitForFunction(() => ask.heading.value.title === '雨夜车站');
    await askText(page, llm, '恢复后继续');
    assert.equal(await names(page), 0, 'restored conversations never receive another automatic title');
    await page.evaluate(() => { ask.newConversation(); ask.renameConversation(ask.conversationId.value, '我的手动标题'); });
    await askText(page, llm, '生成手动标题的内容');
    assert.equal(await names(page), 0); assert.equal(await page.evaluate(() => ask.heading.value.title), '我的手动标题');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('Automatic ASK naming: failed replies do not trigger, naming failures are not retried and late names respect manual edits', async () => {
  const f = await open('/#/image', { ready: '#prompt', ask: askSettings({ autoNaming: true }) });
  const { page, llm } = f;
  let release;
  try {
    await bind(page);
    llm.push({ status: 503, type: 'application/json', body: '{"error":{"message":"synthetic failure"}}' });
    await sendAsk(page, '第一次请求失败');
    assert.equal(await names(page), 0);
    llm.push(textReply('成功回复'), { status: 503, type: 'application/json', body: '{"error":{"message":"synthetic naming failure"}}' });
    await sendAsk(page, '成功后尝试命名');
    await page.waitForFunction(() => !ask.naming.value);
    const original = await page.evaluate(() => ask.heading.value.title);
    await askText(page, llm, '再问一次');
    assert.equal(await names(page), 1); assert.equal(await page.evaluate(() => ask.heading.value.title), original);
    await page.evaluate(() => ask.newConversation());
    llm.push(textReply('完成'), { ...textReply('迟到标题'), wait: new Promise(r => { release = r; }) });
    await sendAsk(page, '手动接管名称');
    await page.waitForFunction(() => !!ask.naming.value);
    await page.evaluate(() => ask.renameConversation(ask.conversationId.value, ask.heading.value.title));
    release(); await page.waitForFunction(() => !ask.naming.value);
    assert.equal(await page.evaluate(() => ask.heading.value.title), '手动接管名称', 'even a manual save of the same text takes ownership');
    assert.deepEqual(f.errors, []);
  } finally { release?.(); await f.context.close(); }
});

test('CHAT naming: first send runs before image completion, one attempt, menu action and persistence', async () => {
  const f = await open('/#/chat', { ready: '#chatPrompt', ask: askSettings({ autoNaming: true }) });
  const { page, llm, calls } = f;
  let release;
  try {
    await bind(page); await mockImages(page, new Promise(r => { release = r; }));
    await page.waitForFunction(() => chat.snapshot().models.length > 0);
    await page.evaluate(() => chat.setPrompt('森林里的玻璃小屋'));
    assert.equal(calls.length, 0, 'typing / preparing a request does not name it');
    llm.push(textReply('林间玻璃屋'));
    await page.evaluate(() => { void chat.execute(); });
    await page.waitForFunction(() => chat.snapshot().current.title === '林间玻璃屋' && !ask.naming.value);
    assert.ok(await page.evaluate(() => !!chat.snapshot().busy), 'naming finishes while generation is still pending');
    assert.match(calls[0].raw, /森林里的玻璃小屋/);
    assert.doesNotMatch(calls[0].raw, /workspace_state|propose_draft|image_url|quality|selectionRevision/);
    release(); await page.waitForFunction(() => !chat.snapshot().busy);
    await page.evaluate(async () => { chat.setPrompt('屋檐增加灯光'); await chat.execute(); await chat.execute(chat.snapshot().current.turns[0]); });
    assert.equal(await names(page), 1, 'later turns and regeneration do not rename');
    llm.push(textReply('林间灯火'));
    await page.locator('.conversation-more').first().click();
    await page.getByRole('menuitem', { name: 'AI 命名', exact: true }).click();
    await page.waitForFunction(() => !ask.naming.value && chat.snapshot().current.title === '林间灯火');
    await page.reload(); await page.waitForSelector('#chatPrompt'); await bind(page);
    await page.waitForFunction(() => chat.snapshot().current.title === '林间灯火');
    assert.deepEqual(f.errors, []);
  } finally { release?.(); await f.context.close(); }
});

test('Naming queue: CHAT send waits behind manual naming, stays with its owner and disabling cancels automatic work', async () => {
  const f = await open('/#/chat', { ready: '#chatPrompt', ask: askSettings({ autoNaming: true }) });
  const { page, llm } = f;
  let release, releaseAuto;
  try {
    await bind(page); await mockImages(page);
    await page.waitForFunction(() => chat.snapshot().models.length > 0);
    await page.evaluate(() => drawing.patch({ prompt: 'board-only' }));
    llm.push({ ...textReply('画板名'), wait: new Promise(r => { release = r; }) }, textReply('夜色海湾'));
    await page.evaluate(() => { void ask.generateName({ kind: 'board', id: drawing.snapshot().activeBoardId }); });
    await page.waitForFunction(() => !!ask.naming.value);
    await page.evaluate(async () => { chat.setPrompt('夜色海湾的远景'); await chat.execute(); window.namedChat = chat.snapshot().current.id; chat.addConversation(); });
    release(); await page.waitForFunction(() => !ask.naming.value && chat.snapshot().conversations.some(c => c.id === namedChat && c.title === '夜色海湾'));
    assert.equal(await page.evaluate(() => chat.snapshot().current.title), '新对话');
    llm.push({ ...textReply('不应写回'), wait: new Promise(r => { releaseAuto = r; }) });
    await page.evaluate(() => { chat.setPrompt('关闭自动命名前的请求'); void chat.execute(); });
    await page.waitForFunction(() => ask.naming.value?.kind === 'chat');
    await configure(page, { autoNaming: false });
    await page.waitForFunction(() => !ask.naming.value);
    releaseAuto(); await page.waitForFunction(() => !chat.snapshot().busy);
    assert.equal(await page.evaluate(() => chat.snapshot().current.title), '关闭自动命名前的请求');
    await configure(page, { autoNaming: true });
    const before = await names(page);
    await page.evaluate(async () => { chat.setPrompt('继续请求'); await chat.execute(); });
    assert.equal(await names(page), before, 're-enabling never retries a consumed first-send event');
    assert.deepEqual(f.errors, []);
  } finally { release?.(); releaseAuto?.(); await f.context.close(); }
});

test('CHAT naming protects manual titles before and during a request and rolls back failed persistence', async () => {
  const f = await open('/#/chat', { ready: '#chatPrompt', ask: askSettings({ autoNaming: true }) });
  const { page, llm } = f;
  let release;
  try {
    await bind(page); await mockImages(page);
    await page.waitForFunction(() => chat.snapshot().models.length > 0);
    await page.evaluate(async () => {
      chat.rename(chat.snapshot().conversations.find(c => c.id === chat.snapshot().current.id), '事先指定的名称');
      chat.setPrompt('first request'); await chat.execute();
    });
    assert.equal(await names(page), 0);
    assert.equal(await page.evaluate(() => chat.snapshot().current.title), '事先指定的名称');
    await page.evaluate(() => chat.addConversation());
    llm.push({ ...textReply('迟到名称'), wait: new Promise(r => { release = r; }) });
    await page.evaluate(async () => { chat.setPrompt('首发需求'); await chat.execute(); });
    await page.waitForFunction(() => !!ask.naming.value);
    await page.evaluate(async () => {
      const c = chat.snapshot().conversations.find(c => c.id === chat.snapshot().current.id);
      chat.rename(c, c.title); await chat.flush();
    });
    release(); await page.waitForFunction(() => !ask.naming.value);
    assert.equal(await page.evaluate(() => chat.snapshot().current.title), '首发需求');
    llm.push(textReply('无法落盘的新标题'));
    await page.evaluate(async () => {
      const p = document.body.__vue_app__._context.provides;
      const services = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
      const write = services.data.write;
      services.data.write = async () => { throw new Error('synthetic naming write failure'); };
      try { await ask.generateName({ kind: 'chat', id: chat.snapshot().current.id }); }
      finally { services.data.write = write; }
      await chat.flush();
    });
    assert.equal(await page.evaluate(() => chat.snapshot().current.title), '首发需求');
    assert.deepEqual(f.errors, []);
  } finally { release?.(); await f.context.close(); }
});
