import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, route, stored, askSettings, submitAsk, openai, text, tool, end, generation } from './helpers/ask-fixture.mjs';

useAskFixture();
const dialog = page => page.getByRole('dialog', { name: '模型参数', exact: true });
const gear = (page, model) => page.getByRole('button', { name: `设置 ${model} 的参数`, exact: true });
const parameter = async (page, name, value) => {
  const toggle = dialog(page).getByRole('switch', { name: `启用 ${name}`, exact: true });
  if (!await toggle.isChecked()) await toggle.locator('..').click();
  await dialog(page).getByRole('spinbutton', { name, exact: true }).fill(value);
};
const save = async page => {
  await dialog(page).getByRole('button', { name: '保存参数', exact: true }).click();
  await dialog(page).waitFor({ state: 'hidden' });
};
const customParameter = async (page, name, type, value) => {
  await dialog(page).getByRole('button', { name: '添加参数', exact: true }).click();
  const row = dialog(page).locator('.mp-field').last();
  await row.getByLabel('字段名', { exact: true }).fill(name);
  await row.getByRole('radiogroup', { name: '类型', exact: true }).locator('label').filter({ hasText: type }).click();
  await row.getByRole('switch', { name: `启用 ${name}`, exact: true }).locator('..').click();
  if (type === '开关') await row.getByLabel('默认值', { exact: true }).selectOption(value);
  else await row.getByLabel('默认值', { exact: true }).fill(value);
};

test('ASK model parameters: gear does not select, values persist, cancel/validation/reset work, tool turns freeze overrides', async () => {
  const t = await open('/#/image/settings/ask', { ask: askSettings({ models: { chat: ['reasoning-a', 'reasoning-b'] } }) });
  const { page, context, calls, llm } = t;
  let release;
  try {
    await gear(page, 'reasoning-b').click();
    assert.equal((await stored(page, 'koma.ask.v1')).model, 'reasoning-a');
    for (const label of ['max_completion_tokens', 'temperature', 'top_p']) {
      assert.equal(await dialog(page).getByRole('spinbutton', { name: label, exact: true }).inputValue(), '');
      assert.equal(await dialog(page).getByRole('switch', { name: `启用 ${label}`, exact: true }).isChecked(), false);
    }
    await parameter(page, 'max_completion_tokens', '32768');
    await parameter(page, 'temperature', '0');
    await parameter(page, 'top_p', '0.8');
    await save(page);
    assert.deepEqual((await stored(page, 'koma.ask.v1')).parameters.chat['reasoning-b'], { maxOutputTokens: 32768, temperature: 0, topP: .8 });
    await gear(page, 'reasoning-a').click();
    assert.equal(await dialog(page).getByRole('spinbutton', { name: 'max_completion_tokens', exact: true }).inputValue(), '');
    await parameter(page, 'max_completion_tokens', '100');
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
    await page.reload();
    await gear(page, 'reasoning-b').click();
    assert.equal(await dialog(page).getByRole('spinbutton', { name: 'max_completion_tokens', exact: true }).inputValue(), '32768');
    await parameter(page, 'top_p', '2');
    await dialog(page).getByRole('button', { name: '保存参数', exact: true }).click();
    assert.equal(await dialog(page).isVisible(), true);
    assert.equal((await stored(page, 'koma.ask.v1')).parameters.chat['reasoning-b'].topP, .8);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settingsPanel').evaluate(el => el.open), true);
    await page.getByRole('list', { name: '已选模型', exact: true }).getByRole('button', { name: 'reasoning-b', exact: true }).click();
    await route(page, '#/image'); await bind(page); await page.evaluate(() => ask.show());
    const waiting = new Promise(resolve => { release = resolve; });
    llm.push({ body: openai(tool('read', 'get_state'), end('tool_calls')), wait: waiting }, { body: openai(text('工具轮次完成。'), end()) });
    await page.locator('#askPrompt').fill('读取当前工作台'); await submitAsk(page);
    await page.waitForFunction(() => ask.debug.value.calls.length === 1);
    await page.evaluate(async () => {
      const p = document.body.__vue_app__._context.provides, s = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
      await s.preferences.set('koma.ask.v1', { ...ask.settings.value, parameters: undefined });
    });
    release();
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length, 2);
    for (const { body } of calls) {
      assert.equal(body.model, 'reasoning-b'); assert.equal(body.max_completion_tokens, 32768);
      assert.equal(body.temperature, 0); assert.equal(body.top_p, .8);
    }
    llm.push({ body: openai(text('恢复默认。'), end()) });
    await page.locator('#askPrompt').fill('继续'); await submitAsk(page);
    await page.waitForFunction(() => ask.debug.value.calls.length === 3 && !ask.running.value);
    for (const key of ['max_tokens', 'max_completion_tokens', 'temperature', 'top_p']) assert.equal(Object.hasOwn(calls[2].body, key), false);
    await route(page, '#/image/settings/ask');
    await gear(page, 'reasoning-b').click();
    await parameter(page, 'max_completion_tokens', '9000');
    await parameter(page, 'temperature', '0');
    await dialog(page).getByRole('switch', { name: '启用 temperature', exact: true }).locator('..').click(); await save(page);
    assert.deepEqual((await stored(page, 'koma.ask.v1')).parameters.chat['reasoning-b'], { maxOutputTokens: 9000 });
    await gear(page, 'reasoning-b').click();
    await dialog(page).getByRole('button', { name: '恢复默认', exact: true }).click(); await save(page);
    assert.equal((await stored(page, 'koma.ask.v1')).parameters, undefined);
    assert.deepEqual(t.errors, []); assert.deepEqual(generation(t.requests), []);
  } finally { release?.(); await context.close(); }
});

test('ASK Gemini parameters: default native request has no output cap; per-model overrides also reach naming', async () => {
  const t = await open('/#/image/settings/ask', { ask: askSettings() });
  const { page, context } = t, calls = [];
  try {
    await context.route('https://gemini.example.test/**', async route => {
      const req = route.request();
      if (req.method() === 'GET') return route.fulfill({ json: { models: [{ name: 'models/gemini-custom' }] } });
      calls.push(req.postDataJSON());
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '合成回复' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } })}\n\n` });
    });
    await bind(page);
    await page.evaluate(async () => {
      const p = document.body.__vue_app__._context.provides, s = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
      const next = structuredClone(s.connections.configuration);
      next.connections.gemini = { id: 'gemini', name: '合成 Gemini', profileId: 'gemini-chat-v1', baseUrl: 'https://gemini.example.test', credentialRef: 'gemini-key', revision: '1' };
      await s.connections.save(next); await s.vault.setKey('gemini-key', 'synthetic-gemini', false);
      await s.preferences.set('koma.ask.v1', { ...ask.settings.value, connectionId: 'gemini', model: 'gemini-custom', models: { gemini: ['gemini-custom'] } });
    });
    await route(page, '#/image'); await page.evaluate(() => ask.show());
    await page.locator('#askPrompt').fill('先回答'); await submitAsk(page);
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    assert.deepEqual(calls[0].generationConfig, { responseModalities: ['TEXT'] });
    await route(page, '#/image/settings/ask');
    await gear(page, 'gemini-custom').click();
    assert.equal(await dialog(page).getByLabel('输出字段', { exact: true }).count(), 0);
    await parameter(page, 'maxOutputTokens', '32768');
    await parameter(page, 'temperature', '0');
    await parameter(page, 'topP', '0.9');
    await customParameter(page, 'thinkingConfig.thinkingBudget', '数字', '-1');
    await customParameter(page, 'thinkingConfig.includeThoughts', '开关', 'false');
    await customParameter(page, 'topK', '数字', '0');
    await dialog(page).getByRole('button', { name: '添加参数', exact: true }).click();
    const invalid = dialog(page).locator('.mp-field').last();
    await invalid.getByLabel('字段名', { exact: true }).fill('temperature');
    assert.equal(await dialog(page).getByRole('button', { name: '保存参数', exact: true }).isDisabled(), true);
    await invalid.getByLabel('字段名', { exact: true }).fill('thinkingConfig');
    assert.equal(await dialog(page).getByRole('button', { name: '保存参数', exact: true }).isDisabled(), true);
    await invalid.getByRole('button', { name: '移除参数', exact: true }).click();
    await save(page);
    await page.reload();
    await gear(page, 'gemini-custom').click();
    assert.equal(await dialog(page).getByRole('group', { name: 'thinkingConfig.thinkingBudget', exact: true }).getByLabel('默认值', { exact: true }).inputValue(), '-1');
    assert.equal(await dialog(page).getByRole('group', { name: 'thinkingConfig.includeThoughts', exact: true }).getByLabel('默认值', { exact: true }).inputValue(), 'false');
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
    await bind(page);
    await route(page, '#/image'); await page.evaluate(() => ask.show());
    await page.locator('#askPrompt').fill('继续回答'); await submitAsk(page);
    await page.waitForFunction(() => ask.debug.value.calls.length === 1 && !ask.running.value);
    assert.deepEqual(calls[1].generationConfig, { responseModalities: ['TEXT'], maxOutputTokens: 32768, temperature: 0, topP: .9,
      thinkingConfig: { thinkingBudget: -1, includeThoughts: false }, topK: 0 });
    await page.evaluate(() => ask.generateName({ kind: 'conversation', id: ask.conversationId.value }));
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2].generationConfig, calls[1].generationConfig);
    assert.deepEqual(t.errors, []); assert.deepEqual(generation(t.requests), []);
  } finally { await context.close(); }
});
