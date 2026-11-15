import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, route } from './helpers/ask-fixture.mjs';
useAskFixture();

const layouts = { image: 'canvas', edit: 'editCanvas', chat: 'chatCanvas' };
const state = (page, workspace) => page.evaluate(key => {
  const layout = ask_presentation[key];
  return { panel: layout.panel.value, detent: layout.detent.value };
}, layouts[workspace]);

async function settled(page) {
  await page.locator('.canvas-sheet-tray:visible').evaluateAll(nodes =>
    Promise.all(nodes.flatMap(node => node.getAnimations().map(animation => animation.finished.catch(() => {})))));
}

// Browser-dispatched touch produces implicit pointer capture on the original grip, unlike mouse or
// dispatchEvent. Measure only to place the finger; assertions concern the panel state and preserved input.
async function pull(page, client, grip, delta, beforeRelease, cancel = false) {
  await settled(page);
  await grip.tap({ trial: true });
  const box = await grip.boundingBox();
  assert.ok(box, 'the grip is available for touch');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + delta * i / 10 }] });
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await beforeRelease?.();
  // Hold before letting go: settle by position, not a fling from the last move.
  await new Promise(resolve => setTimeout(resolve, 120));
  await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await settled(page);
}

test('[core] phone sheets keep touch capture until release and recover from cancellation across workspaces', async t => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, chatModel: true, touch: true, motion: 'no-preference', width: 390, ask: askSettings({ images: false }) });
  t.after(() => f.context.close());
  const p = f.page;
  await bind(p);
  await p.evaluate(() => { ask_presentation.canvas.setEnabled(true); ask.setInput('keep the same question'); });
  const client = await f.context.newCDPSession(p);
  const height = p.viewportSize().height;
  for (const workspace of ['image', 'chat', 'edit']) {
    await route(p, `#/${workspace}`);
    await p.waitForFunction(workspace => app_shell.router.route.value.workspace === workspace, workspace);
    const root = p.locator('[data-workspace-root="' + workspace + '"]');
    const tray = root.locator('.canvas-sheet-tray');
    await tray.waitFor({ state: 'hidden' });
    const closedGrip = root.locator('[data-sheet-grip]:visible');
    await pull(p, client, closedGrip, -height * .34, async () => {
      assert.deepEqual(await state(p, workspace), { panel: 'ask', detent: 'half' });
    });
    assert.deepEqual(await state(p, workspace), { panel: 'ask', detent: 'half' });

    await pull(p, client, tray.locator('[data-sheet-grip]'), -height * .36, async () => {
      assert.equal((await state(p, workspace)).detent, 'half', 'capture transfer must not settle before finger release');
    });
    assert.deepEqual(await state(p, workspace), { panel: 'ask', detent: 'full' });
    assert.equal(await p.locator('#askPrompt').inputValue(), 'keep the same question');

    await pull(p, client, tray.locator('[data-sheet-grip]'), height * .4);
    assert.equal((await state(p, workspace)).detent, 'half', `${workspace}: pulling down from full returns to half`);
    await pull(p, client, tray.locator('[data-sheet-grip]'), height * .43);
    await tray.waitFor({ state: 'hidden' });
    assert.equal((await state(p, workspace)).panel, null);

    await pull(p, client, closedGrip, -height * .34, undefined, true);
    await tray.waitFor({ state: 'hidden' });
    assert.equal((await state(p, workspace)).panel, null, 'a cancelled opening restores the canvas');
    await closedGrip.tap();
    await tray.waitFor();
    assert.deepEqual(await state(p, workspace), { panel: 'ask', detent: 'half' }, 'a fresh tap still opens after cancellation');

    await pull(p, client, tray.locator('[data-sheet-grip]'), -height * .36, undefined, true);
    assert.deepEqual(await state(p, workspace), { panel: 'ask', detent: 'half' }, 'cancellation restores the original detent');
    // Tapping through the form/context, ASK and back to the canvas must remain responsive, including
    // the empty CHAT logo state that previously fed the overlap spacer back into its own size.
    await tray.locator('[data-value="context"]').tap();
    assert.equal((await state(p, workspace)).panel, 'context');
    await tray.locator('[data-sheet-grip]').tap();
    assert.equal((await state(p, workspace)).detent, 'full');
    await tray.locator('[data-value="ask"]').tap();
    assert.equal(await p.locator('#askPrompt').inputValue(), 'keep the same question');
    await tray.locator('[data-value="ask"]').tap();
    await tray.waitFor({ state: 'hidden' });
  }
  assert.deepEqual(f.errors, []);
});
