import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, askSettings, bind, route, scripted, cp2Send, savedAsk, reloadAsk, generation,
  openai, text, end, anthropic, wireStates, patchStep, form, applyDraft } from './helpers/ask-fixture.mjs';

useAskFixture();

for (const connectionId of ['chat', 'claude']) {
  test(`ASK tool prose ${connectionId}: toggle, ordinary UI, favorite reload and protocol switch`, async () => {
    const { page, context, llm, calls, requests, errors } = await open('/#/image/settings/ask', { ask: askSettings({ connectionId }) });
    try {
      const toggle = page.getByRole('region', { name: '创作', exact: true }).getByRole('switch', { name: '工具正文模式', exact: true });
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await page.getByRole('region', { name: '创作', exact: true }).locator('label[for="askResponseMode"]').isVisible(), true);
      await page.locator('label[for="askResponseMode"]').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('koma.ask.v1')).responseMode === 'tool');
      await route(page, '#/image');
      await page.locator('#settingsPanel').waitFor({ state: 'hidden' });
      await bind(page);
      await page.waitForFunction(() => ask.favoritesReady.value);
      await page.evaluate(() => ask.show());
      const prose = '**正文标题**\n\n这是通过信封接收的正文，收藏后继续使用。';
      llm.push({ body: scripted(connectionId, 'submit_response', { content: prose }) });
      await cp2Send(page, '给我一段正文');
      assert.equal(calls.length, 1);
      assert.match(await page.locator('.ask-turn').innerText(), /正文标题/);
      assert.equal(await page.locator('.ask-turn').getByText('submit_response').count(), 0);
      assert.equal(await page.evaluate(() => ask.entries.value[0].turn.items.some(i => i.kind === 'tools')), false);
      await page.evaluate(() => ask.toggleFavorite());
      const saved = (await savedAsk(page))[0];
      assert.doesNotMatch(JSON.stringify(saved), /submit_response|accepted/);
      assert.equal(saved.session.turns[0].messages.at(-1).content[0].text, prose);

      await route(page, '#/image/settings/ask');
      await page.locator('#settingsPanel[open]').waitFor();
      await page.locator('label[for="askResponseMode"]').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('koma.ask.v1')).responseMode === 'text');
      await route(page, '#/image');
      await reloadAsk(page);
      assert.match(await page.locator('.ask-turn').innerText(), /正文标题/);
      const nextConnection = connectionId === 'chat' ? 'claude' : 'chat';
      await page.evaluate(async connectionId => {
        const p = document.body.__vue_app__._context.provides;
        const services = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'application-services')];
        await services.preferences.set('koma.ask.v1', { ...ask.settings.value, connectionId, model: 'reasoning-a', models: { ...ask.settings.value.models, [connectionId]: ['reasoning-a'] } });
      }, nextConnection);
      await page.waitForFunction(id => ask.settings.value.connectionId === id, nextConnection);
      llm.push({ body: scripted(nextConnection) });
      await cp2Send(page, '换协议后继续');
      assert.equal(calls.length, 2);
      assert.doesNotMatch(calls.at(-1).raw, /submit_response/);
      assert.match(calls.at(-1).raw, /收藏后继续使用/);
      assert.deepEqual(generation(requests), []);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test(`ASK tool prose ${connectionId}: draft and envelope together skip extra prose request`, async () => {
    const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings({ connectionId, responseMode: 'tool' }) });
    try {
      await bind(page);
      await page.evaluate(async () => { await drawing.patch({ prompt: 'red eyes' }); ask.show(); });
      llm.push({ body: body => {
        const calls = [
          { name: 'propose_draft', input: { base_hash: wireStates(body).at(-1).base_hash, draft_title: '改为蓝眼睛', steps: [patchStep('replace', 'red eyes', 'blue eyes')] } },
          { name: 'submit_response', input: { content: '已准备蓝眼睛草稿，请核对。' } },
        ];
        return connectionId === 'chat' ? openai(text('不重复显示的普通前言'),
          { choices: [{ delta: { tool_calls: calls.map((c, index) => ({ index, id: `c${index}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } }] }, end('tool_calls'))
          : anthropic({ type: 'message_start', message: { usage: { input_tokens: 50 } } },
            ...calls.flatMap((c, index) => [
              { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `c${index}`, name: c.name, input: {} } },
              { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } },
              { type: 'content_block_stop', index },
            ]), { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }, { type: 'message_stop' });
      } });
      await cp2Send(page, '把红眼睛改成蓝眼睛');
      assert.equal(calls.length, 1);
      assert.equal((await form(page)).prompt, 'red eyes');
      assert.equal(await page.evaluate(() => ask.draftPlan.value.title), '改为蓝眼睛');
      assert.match(await page.locator('.ask-turn').innerText(), /已准备蓝眼睛草稿/);
      assert.doesNotMatch(await page.locator('.ask-turn').innerText(), /submit_response|不重复显示的普通前言/);
      await applyDraft(page);
      assert.equal((await form(page)).prompt, 'blue eyes');
      assert.equal(calls.length, 1);
      assert.deepEqual(generation(requests), []);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
