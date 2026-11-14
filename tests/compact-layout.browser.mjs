import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, route, stored } from './helpers/ask-fixture.mjs';
useAskFixture();

test('Traditional layout: narrow workspaces suggest BETA once, preserve work and switch only on confirmation', async t => {
  for (const workspace of ['image', 'edit', 'chat']) await t.test(workspace, async () => {
    const f = await open(`/#/${workspace}`, { ready: `[data-workspace-root="${workspace}"]`, width: 390, touch: true, standard: true, ask: askSettings({ images: false }) });
    try {
      const p = f.page; await bind(p);
      const notice = p.getByRole('dialog', { name: '当前窗口较窄', exact: true });
      await notice.waitFor();
      assert.equal(await p.evaluate(() => ask_presentation.canvas.enabled.value), false);
      await p.evaluate(async () => {
        await drawing.patch({ prompt: 'keep my drawing draft' });
        ask.setInput('keep my ASK question');
        window.originalAsk = document.getElementById('askDrawer');
      });
      await notice.getByRole('button', { name: '继续桌面布局', exact: true }).click();
      await notice.waitFor({ state: 'hidden' });
      for (const destination of ['image', 'edit', 'chat']) {
        await route(p, `#/${destination}`);
        await p.waitForFunction(destination => app_shell.router.route.value.workspace === destination, destination);
        assert.equal(await notice.isVisible(), false, 'dismissing the suggestion does not repeat it on every page');
      }
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.waitForFunction(() => !ask_presentation.canvas.compact.value);
      await p.setViewportSize({ width: 390, height: 900 });
      await notice.waitFor();
      await notice.getByRole('button', { name: '切换到 BETA', exact: true }).click();
      await p.waitForFunction(() => ask_presentation.chatCanvas.active.value && !ask_presentation.chatCanvas.panel.value);
      await notice.waitFor({ state: 'hidden' });
      assert.deepEqual(await p.evaluate(() => ({ prompt: drawing.snapshot().form.prompt, question: ask.input.value, sameAsk: originalAsk === document.getElementById('askDrawer') })), { prompt: 'keep my drawing draft', question: 'keep my ASK question', sameAsk: true });
      assert.equal((await stored(p, 'koma.image.layout.v1')).enabled, true);
      await p.reload(); await p.locator('.chat-collaboration').waitFor();
      assert.equal(await notice.isVisible(), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
});

test('Traditional layout: settings stay usable and returning to a wide window dismisses the suggestion', async () => {
  const f = await open('/#/image/settings/general', { width: 900, ask: askSettings({ images: false }) });
  try {
    const p = f.page; await bind(p);
    const notice = p.getByRole('dialog', { name: '当前窗口较窄', exact: true });
    assert.equal(await notice.isVisible(), false);
    await route(p, '#/image'); await notice.waitFor();
    await p.setViewportSize({ width: 1440, height: 900 });
    await notice.waitFor({ state: 'hidden' });
    assert.equal(await p.evaluate(() => ask_presentation.canvas.enabled.value), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});
