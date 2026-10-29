import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, submitAsk, open, openai, text, tool, end, askSettings, generation, bind, addImage, drawer, route, patchStep, proposal, askDraft, form, undoCheckpoint, islandMode } from "./helpers/ask-fixture.mjs";

useAskFixture();

test('ASK open/close and workspace switches preserve the input and isolate the active dialog', async () => {
  const { page, context, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await addImage(page, 'synthetic window layout');
    const launcher = page.locator('#askLauncher');
    {
      const [width, height] = [1440, 900];
      await page.setViewportSize({ width, height });
      await launcher.click();
      await page.locator('#askPrompt').fill('输入和会话会在收起后保留');
      if (width > 860) {
        await drawer(page).getByRole('button', { name: '放大 ASK 窗口' }).click();
        await drawer(page).getByRole('button', { name: '还原 ASK 窗口' }).click();
      } else {
        assert.equal(await drawer(page).getByRole('button', { name: /放大 ASK 窗口|还原 ASK 窗口/ }).count(), 0);
        assert.equal(await drawer(page).locator('[data-ask-grip]').count(), 0);
        assert.equal(await drawer(page).getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('[data-workspace-root="image"]').getAttribute('inert'), '');
      }
      await drawer(page).getByRole('button', { name: '收起 ASK', exact: true }).click();
      await drawer(page).waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-workspace-root="image"]').getAttribute('inert'), null);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await launcher.click();
    const identity = await page.locator('#askPrompt').elementHandle();
    for (const workspace of ['chat', 'edit', 'tags', 'home', 'image']) {
      await route(page, `#/${workspace}`);
      assert.equal(await identity.evaluate(el => el === document.querySelector('#askPrompt')), true);
      assert.equal(await page.locator('#askPrompt').inputValue(), '输入和会话会在收起后保留');
      assert.equal(await page.locator(workspace === 'home' ? '.home-shell' : `[data-workspace-root="${workspace}"]`).getAttribute('inert'), '');
    }
    await page.keyboard.press('Escape');
    await drawer(page).waitFor({state:'hidden'});
    await page.locator('#prompt').fill('selected prompt');
    await page.locator('#prompt').press('Control+k');
    assert.equal(await page.evaluate(() => ask.inline.value.text), 'selected prompt');
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#askDrawer.ask-inline').waitFor();
    await page.getByRole('button',{name:'展开',exact:true}).click();
    assert.equal(await drawer(page).getAttribute('aria-modal'), 'false');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK island: collapsed tools, reviewed draft, apply/undo, focus guards and timed idle use the real turn', async () => {
  const { page, context, llm, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await page.evaluate(() => drawing.patch({ prompt: 'red eyes' }));
    const initial = await form(page);
    await addImage(page, 'red eyes');
    await page.locator('#askLauncher').click();
    const draftNode = () => page.locator('.ask-draft');
    llm.push({ body: openai(tool('meta', 'get_meta', { id: '#h1' }), end('tool_calls')) });
    llm.push({ ...proposal([patchStep('replace', 'red eyes', 'blue eyes')]), delay: 700 });
    await page.locator('#askPrompt').fill('把红眼睛改成蓝色');
    await submitAsk(page);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'run');
    assert.match(await page.locator('.ask-activity').textContent(), /正在/);
    assert.equal(await page.locator('.ask-run button').count(), 1, 'the running island only opens the window');
    // Esc on the island never stops the turn: the draft still arrives.
    await page.keyboard.press('Escape');
    await islandMode(page, 'ready');
    assert.equal(await drawer(page).isVisible(), false);
    assert.equal(await page.locator('#askCompactDraft .ask-draft').isVisible(), true);
    assert.match(await page.locator('.ask-result-grip').textContent(), /2 项工具/);
    assert.equal(await page.locator('#askCompactDraft .draft-body').isVisible(), false);
    assert.equal(await page.locator('#askCompactDraft [aria-label="查看草稿修改"]').isVisible(), true);
    assert.deepEqual(await form(page), initial, 'collapsed completion never writes');
    const node = await draftNode().elementHandle();
    await page.locator('#askCompactDraft [aria-label="查看草稿修改"]').click();
    assert.equal(await page.locator('#askFullDraft .draft-toggle').getAttribute('aria-expanded'), 'true', 'reviewing opens the body');
    assert.match(await page.locator('#askFullDraft .draft-diff').textContent(), /red eyes.*blue eyes/);
    assert.equal(await node.evaluate(el => el === document.querySelector('#askFullDraft .ask-draft')), true, 'Teleport retains the reviewed card');
    await page.locator('#askPrompt').fill('保留输入');
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    // Workspace typing, IME and modals keep their own keys while the card floats.
    await page.locator('#prompt').focus();
    await page.keyboard.press('Tab');
    assert.deepEqual(await form(page), initial);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, bubbles: true })));
    assert.deepEqual(await form(page), initial);
    await route(page, '#/image/settings/ask');
    await page.locator('#settingsPanel[open]').waitFor();
    await page.keyboard.press('Tab');
    assert.deepEqual(await form(page), initial);
    await page.keyboard.press('Escape');
    await page.locator('#settingsPanel').waitFor({ state: 'hidden' });
    await page.locator('.ask-ready [aria-label="展开 ASK 对话"]').focus();
    await page.keyboard.press('Tab');
    await islandMode(page, 'done');
    assert.equal((await form(page)).prompt, 'blue eyes');
    // Undo lives in the window: the write pill only opens it.
    assert.equal(await page.locator('.ask-done button').count(), 1);
    await page.locator('.ask-done [aria-label="展开 ASK 对话"]').click();
    await undoCheckpoint(page);
    assert.deepEqual(await form(page), initial);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'idle');
    // A new pending draft still validates edits in compact mode.
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await page.locator('#askPrompt').fill('保留输入');
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page,'ready');
    await page.evaluate(() => drawing.patch({ prompt: 'green eyes' }));
    assert.equal(await page.locator('#askCompactDraft .ask-draft-apply').isDisabled(), true);
    assert.match(await page.locator('#askCompactDraft .draft-issue').textContent(), /锚点不唯一或已不存在/);
    await page.evaluate(() => drawing.patch({ prompt: 'red eyes' }));
    await page.locator('#askCompactDraft .ask-draft-apply').click();
    await islandMode(page, 'done');
    await islandMode(page, 'idle');
    assert.equal((await form(page)).prompt, 'blue eyes');
    await page.locator('#askLauncher').click();
    assert.equal(await page.locator('#askPrompt').inputValue(), '保留输入');
    llm.push({ body: openai(text('这是新一轮普通回复。'), end()) });
    await submitAsk(page);
    await page.locator('#askDrawer .ask-turn[data-status="done"]').nth(2).waitFor();
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.equal(await page.locator('#askCompactDraft .ask-draft').count(), 0, 'an earlier applied draft stays out of a new text answer');
    await page.locator('.ask-ready .ask-details').click();
    await undoCheckpoint(page);
    assert.deepEqual(await form(page), initial, 'undo remains available after the pill returns to idle');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK island: text, error and stop remain accessible from the collapsed result', async () => {
  const { page, context, llm, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await addImage(page, 'synthetic island');
    await page.locator('#askLauncher').click();
    llm.push({ body: openai(text('原因是 `crimson theme` 的色调。'), end()), delay: 300 });
    await page.locator('#askPrompt').fill('解释图片');
    await submitAsk(page);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.equal(await page.locator('.ask-summary code').textContent(), 'crimson theme');
    assert.equal(await page.locator('.ask-draft').count(), 0);
    await page.locator('.ask-ready [aria-label="收起 ASK 结果"]').click();
    await islandMode(page, 'idle');
    // Failure has a path to the existing explicit retry UI, with no auto retry.
    await page.locator('#askLauncher').click();
    llm.push({ status: 503, type: 'application/json', body: JSON.stringify({ error: { message: 'synthetic unavailable' } }), delay: 600 });
    await page.locator('#askPrompt').fill('失败示例');
    await submitAsk(page);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.match(await page.locator('.ask-summary').textContent(), /synthetic unavailable/);
    await page.locator('.ask-ready .ask-details').click();
    assert.equal(await page.locator('#askDrawer .ask-fail-actions button').first().isVisible(), true);
    llm.push({ body: openai(text('late reply'), end()), delay: 3000 });
    await page.locator('#askDrawer .ask-fail-actions button').first().click();
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'run');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => ask.running.value), true, 'Esc on the island never stops a turn');
    await page.locator('.ask-run [aria-label="展开 ASK 对话"]').click();
    await drawer(page).getByRole('button', { name: '停止', exact: true }).click();
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.match(await page.locator('.ask-summary').textContent(), /已停止/);
    await page.locator('.ask-ready [aria-label="展开 ASK 对话"]').focus();
    await page.keyboard.press('Escape');
    await islandMode(page, 'idle');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// W6: exercise the native/window boundary and transient UI cleanup, not a benchmark.
