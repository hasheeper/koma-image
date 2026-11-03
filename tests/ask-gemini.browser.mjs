import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, submitAsk, route, generation } from './helpers/ask-fixture.mjs';

useAskFixture();
const model = 'vendor/香蕉文字 ?v=1';
const nativeParts = [{ text: '先读取工作台。' }, { functionCall: { name: 'get_state', args: {} }, thoughtSignature: 'synthetic-signature' }];
const answer = (parts, usage = {}) => `data: ${JSON.stringify({ candidates: [{ index: 0, content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, ...usage } })}\n\n`;

test('Gemini native: enable ASK on an existing image connection, select any ID, run signed tools, persist and disable either use', async () => {
  const t = await open('/#/image/settings/connections'), { page, context } = t;
  const calls = [], requests = [], replies = [answer(nativeParts), answer([{ text: '已经读取工作台。' }])];
  try {
    await context.route('https://gemini.example.test/**', async route => {
      const req = route.request(), url = new URL(req.url());
      requests.push({ path: url.pathname, method: req.method(), headers: req.headers() });
      if (req.method() === 'GET' && url.pathname === '/v1beta/models')
        return route.fulfill({ json: { models: [{ name: 'models/gemini-text', displayName: '文字模型' }, { name: 'models/gemini-image', displayName: '图像模型' }] } });
      if (req.method() === 'POST' && url.pathname === `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent` && url.search === '?alt=sse') {
        calls.push(req.postDataJSON());
        return route.fulfill({ contentType: 'text/event-stream', body: replies.shift() ?? answer([{ text: '继续完成。' }]) });
      }
      t.errors.push(`Unexpected Gemini request: ${req.method()} ${url.pathname}`);
      return route.abort();
    });
    await bind(page);
    await page.evaluate(async () => {
      const p = document.body.__vue_app__._context.provides;
      window.services = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
      const next = structuredClone(services.connections.configuration);
      next.connections.gemini = { id: 'gemini', name: 'Gemini 双入口', profileId: 'gemini-native-v1', baseUrl: 'https://gemini.example.test', credentialRef: 'gemini-key', revision: '1' };
      next.links.gemini = { 'gemini-3-pro-image': { id: 'gemini-image', manual: true, on: true } };
      await services.connections.save(next);
      await services.vault.setKey('gemini-key', 'synthetic-gemini', false);
    });
    const card = page.locator('.conn-card[data-connection="gemini"]');
    const entry = kind => card.locator(`.conn-models[data-kind="${kind}"]`);
    const edit = async () => {
      await card.getByRole('button', { name: /更多/ }).click();
      await page.getByRole('menuitem', { name: '配置供应商', exact: true }).click();
      assert.equal(await page.locator('#connectionProtocol').inputValue(), 'gemini');
    };
    const save = async () => { await page.locator('.supplier-form').getByRole('button', { name: '保存', exact: true }).click(); await page.locator('.supplier-form').waitFor({ state: 'hidden' }); };
    await edit();
    assert.equal(await page.getByRole('checkbox', { name: '文字 · ASK', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: '文字 · ASK', exact: true }).check();
    await save();
    await entry('llm').waitFor();
    assert.equal(await card.count(), 1);
    assert.equal(await entry('image').count(), 1);
    assert.match(await entry('llm').textContent(), /文字模型/);
    assert.match(await entry('image').textContent(), /图像模型/);
    assert.equal(await page.evaluate(() => services.connections.context('gemini').key()), 'synthetic-gemini');
    await entry('llm').click();
    const list = page.locator('#askModelDialog');
    await list.getByRole('button', { name: '选用 gemini-text', exact: true }).waitFor();
    await list.getByRole('searchbox', { name: '搜索或填写模型 ID' }).fill(model);
    await list.getByRole('button', { name: `选用 ${model}`, exact: true }).click();
    await list.getByRole('button', { name: '关闭', exact: true }).click();
    await route(page, '#/image');
    await page.evaluate(() => ask.show());
    await page.locator("#askDrawer .ask-model").click();
    await page.locator("#askModelMenu").getByRole("menuitemradio", { name: model, exact: true }).click();
    await page.locator('#askPrompt').fill('读取当前工作台');
    await submitAsk(page);
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].contents.find(c => c.role === 'model').parts, nativeParts);
    assert.ok(calls[1].contents.some(c => c.parts.some(p => p.functionResponse?.name === 'get_state')));
    assert.ok(calls.every(c => c.generationConfig.responseModalities.join() === 'TEXT'));
    assert.ok(requests.every(r => r.headers['x-goog-api-key'] === 'synthetic-gemini'));
    assert.equal(await page.evaluate(() => ask.debug.value.calls.at(-1).protocol), 'gemini-native');
    await route(page, '#/image/settings/connections');
    await edit();
    await page.getByRole('checkbox', { name: '图像 · 生图与编辑', exact: true }).uncheck();
    await save();
    assert.equal(await entry('image').count(), 0);
    await page.reload();
    await entry('llm').waitFor();
    await edit();
    assert.equal(await page.getByRole('checkbox', { name: '图像 · 生图与编辑', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: '图像 · 生图与编辑', exact: true }).check();
    await page.getByRole('checkbox', { name: '文字 · ASK', exact: true }).uncheck();
    await save();
    assert.equal(await entry('llm').count(), 0);
    assert.equal(await entry('image').count(), 1);
    const routing = await page.evaluate(() => JSON.parse(localStorage.getItem('koma.routing.v1')));
    assert.equal(routing.connections.gemini.profileId, 'gemini-native-v1');
    assert.equal(routing.links.gemini['gemini-3-pro-image'].id, 'gemini-image');
    assert.deepEqual(generation(t.requests), []);
    assert.deepEqual(t.errors, []);
  } finally { await context.close(); }
});
