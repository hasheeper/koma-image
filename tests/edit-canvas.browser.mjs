import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, route, stored, askDraft, applyDraft, hosts, textReply, submitAsk } from './helpers/ask-fixture.mjs';
useAskFixture();

async function setCanvas(page, enabled) {
  await route(page, '#/edit/settings/general');
  const toggle = page.getByRole('switch', { name: '画布协创 BETA', exact: true });
  if (await toggle.isChecked() !== enabled) await page.locator('.s-toggle[title="画布协创 BETA"]').click();
  await page.waitForFunction(value => ask_presentation.editCanvas.enabled.value === value, enabled);
  await route(page, '#/edit');
}
const switcher = page => page.getByRole('group', { name: '编辑侧栏内容', exact: true });

async function setup(t, options = {}) {
  const f = await open('/#/edit', { ready: '#imageEditor', standard: true, chatModel: true, editModels: true, ask: askSettings({ images: false }), ...options });
  t.after(() => f.context.close());
  const p = f.page; await bind(p);
  await p.evaluate(async () => {
    window.makeImage = async (color = '#446688', width = 512, height = 512) => {
      const c = new OffscreenCanvas(width, height), g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, width, height);
      return c.convertToBlob({ type: 'image/png' });
    };
    await editor.open('image', await makeImage(), 'source.png', { sourceId: 'canvas-source', settings: { model: 'nai-diffusion-4-5-full', prompt: 'original edit prompt', seed: 7 } });
    window.originalBoard = editor.session.id;
    window.originalForm = document.getElementById('editorForm'); window.originalCanvas = document.getElementById('editorMask'); window.originalAsk = document.getElementById('askDrawer');
  });
  await p.waitForFunction(() => editor.snapshot().model?.id === 'nai-diffusion-4-5-full');
  await setCanvas(p, true);
  return f;
}

test('EDIT canvas: locating a version uncovers the mask and preserves the ASK conversation', async t => {
  const f = await setup(t, { touch: true, width: 900 }), p = f.page;
  const target = await p.evaluate(async () => {
    const first = editor.session.versions[0];
    const token = editor.beginExternalEdit();
    await editor.applyExternalEdit(token.id, { mode: 'image', image: await makeImage('#665544') });
    editor.setMode('inpaint');
    return { id: first.id, label: editor.reference(first), base: editor.session.baseId };
  });
  await switcher(p).getByRole('button', { name: 'ASK', exact: true }).click();
  f.llm.push(textReply(`请检查 ${target.label}。`));
  await p.locator('#askPrompt').fill('查看原始版本'); await submitAsk(p);
  await p.locator('.ask-turn[data-status="done"]').waitFor();
  await p.locator('#askPrompt').fill('keep this followup');
  const conversation = await p.evaluate(() => ask.conversationId.value);
  await p.locator('.ask-turn').getByRole('button', { name: target.label, exact: true }).click();
  await p.locator('.edit-canvas-sidebar').waitFor({ state: 'hidden' });
  assert.deepEqual(await p.evaluate(() => [editor.session.viewId, editor.session.baseId]), [target.id, target.base]);
  await p.getByRole('button', { name: '设为底图', exact: true }).click();
  await p.locator('#editorMask').waitFor();
  // A real brush stroke verifies that the uncovered canvas is interactive again.
  const box = await p.locator('#editorMask').boundingBox();
  await p.mouse.move(box.x + box.width * .3, box.y + box.height * .4); await p.mouse.down();
  await p.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 8 }); await p.mouse.up();
  await p.waitForFunction(() => editor.session.mask.position > 0);
  await switcher(p).getByRole('button', { name: 'ASK', exact: true }).click();
  assert.equal(await p.locator('#askPrompt').inputValue(), 'keep this followup');
  assert.equal(await p.evaluate(() => ask.conversationId.value), conversation);
  assert.deepEqual(f.errors, []);
});

test('EDIT canvas: one form, ASK and canvas survive sidebar toggles, resize and workspace changes', async t => {
  const f = await setup(t), p = f.page;
  await p.locator('.edit-canvas-ask #askDrawer').waitFor();
  await p.locator('#askPrompt').fill('keep my question');
  assert.equal(await p.locator('#editorRun').isVisible(), true);
  await switcher(p).getByRole('button', { name: '表单', exact: true }).click();
  await p.locator('#editorPrompt').fill('edited from right sidebar');
  await p.locator('#editorPrompt').press('Tab');
  assert.equal(await p.locator('#askPrompt').isVisible(), false);
  assert.equal(await p.locator('#editorForm #editorRun').count(), 0);
  await p.evaluate(() => editor.setModel('gpt-image-2'));
  await p.locator('.edit-form-side #editorImagePrompt').waitFor();
  assert.equal(await p.locator('#editorImagePrompt').inputValue(), 'edited from right sidebar');
  await p.evaluate(() => editor.setModel('nai-diffusion-4-5-full'));
  await p.locator('#editorPrompt').waitFor();
  await p.keyboard.press('Control+j'); await p.locator('#askPrompt').waitFor();
  assert.equal(await p.locator('#askPrompt').inputValue(), 'keep my question');
  const split = p.getByRole('separator', { name: '调整编辑侧栏宽度' });
  await split.focus(); for (let i = 0; i < 8; i++) await split.press('Shift+ArrowRight');
  await p.waitForFunction(() => ask_presentation.editCanvas.ratio.value === .25);
  assert.equal((await stored(p, 'koma.image.layout.v1')).ratio, .25);
  await switcher(p).getByRole('button', { name: 'ASK', exact: true }).click();
  await p.locator('.edit-canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
  assert.equal(await switcher(p).locator('[aria-pressed="true"]').count(), 0);
  await route(p, '#/image'); await p.locator('.canvas-ask #askDrawer').waitFor();
  assert.equal(await p.evaluate(() => ask_presentation.canvas.ratio.value), .25);
  await route(p, '#/edit');
  await p.locator('.edit-canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
  await p.getByRole('button', { name: '调整编辑模型与参数' }).click();
  await p.locator('#editorPrompt').waitFor();
  await setCanvas(p, false); await p.locator('.edit-form-home #editorForm').waitFor();
  assert.equal(await p.locator('#editorForm #editorRun').count(), 1);
  await setCanvas(p, true); await p.locator('.edit-form-side #editorForm').waitFor();
  assert.deepEqual(await p.evaluate(() => ({ board: editor.session.id === originalBoard, form: originalForm === document.getElementById('editorForm'), canvas: originalCanvas === document.getElementById('editorMask'), ask: originalAsk === document.getElementById('askDrawer'), prompt: editor.session.fields.prompt, question: ask.input.value })), { board: true, form: true, canvas: true, ask: true, prompt: 'edited from right sidebar', question: 'keep my question' });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator('.edit-sidebar-head').waitFor();
  // The covered canvas stays behind the pane, receded and inert, with its drivers paused.
  assert.deepEqual(await p.locator('#editorCanvas').evaluate(el => [el.hasAttribute('data-receded'), el.inert]), [true, true]);
  await p.locator('#editorRun').waitFor({ state: 'hidden' });
  await p.getByRole('button', { name: '收起编辑面板' }).click();
  await p.locator('#editorRun').waitFor(); // returns with the canvas on the next frame
  assert.equal(await p.locator('#editorCanvas').evaluate(el => el.hasAttribute('data-receded') || el.inert), false);
  assert.equal(await p.locator('#editorFullscreen').count(), 0);
  await switcher(p).getByRole('button', { name: 'ASK', exact: true }).click();
  await p.locator('#askPrompt').waitFor();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.locator('#editorCanvas').waitFor();
  assert.equal(await p.locator('#askPrompt').inputValue(), 'keep my question');
  assert.deepEqual(f.errors, []);
});

test('EDIT canvas: phone version browser and panel switches keep the mask, base, fields and zoom', async t => {
  const f = await setup(t, { touch: true, width: 390 }), p = f.page;
  await p.evaluate(async () => {
    for (const color of ['#663355', '#336655']) { const token = editor.beginExternalEdit(); await editor.applyExternalEdit(token.id, { mode: 'image', image: await makeImage(color) }); }
    editor.setMode('inpaint');
    window.baseId = editor.session.baseId; window.originalVersions = document.querySelector('.editor-rail');
  });
  const mask = p.locator('#editorMask'); await mask.waitFor();
  // Coordinates only feed a real brush stroke; no layout measurements are asserted.
  const box = await mask.boundingBox();
  await p.mouse.move(box.x + box.width * .3, box.y + box.height * .4); await p.mouse.down();
  await p.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 8 }); await p.mouse.up();
  await p.waitForFunction(() => editor.session.mask.position > 0);
  await p.getByRole('button', { name: '缩放到 100%', exact: true }).click();
  const painted = await p.evaluate(() => JSON.stringify(editor.session.mask)), zoom = await p.locator('#editorZoomValue').innerText();
  await switcher(p).getByRole('button', { name: '表单', exact: true }).click(); await p.locator('#editorPrompt').fill('still editing');
  await switcher(p).getByRole('button', { name: 'ASK', exact: true }).click(); await p.locator('#askPrompt').fill('review this mask');
  await switcher(p).getByRole('button', { name: 'ASK', exact: true }).click(); await mask.waitFor();
  await p.locator('#editorZoomValue').waitFor(); // the receded tools return on the next frame
  assert.equal(await p.locator('#editorZoomValue').innerText(), zoom);
  assert.equal(await p.evaluate(() => JSON.stringify(editor.session.mask)), painted);
  await p.getByRole('button', { name: '浏览编辑版本' }).click();
  const browser = p.getByRole('dialog', { name: '编辑版本', exact: true }); await browser.waitFor();
  assert.equal(await browser.locator('.tile').count(), 3);
  await browser.locator('.tile[data-version-id="1"]').click();
  await browser.waitFor({ state: 'hidden' });
  assert.deepEqual(await p.evaluate(() => [editor.session.viewId, editor.session.baseId === baseId, editor.session.fields.prompt, JSON.stringify(editor.session.mask)]), [1, true, 'still editing', painted]);
  await p.getByRole('button', { name: '浏览编辑版本' }).click(); await browser.waitFor();
  await p.keyboard.press('Escape'); await browser.waitFor({ state: 'hidden' });
  await p.setViewportSize({ width: 1440, height: 900 }); await p.locator('.edit-version-slot .tile').first().waitFor();
  assert.equal(await p.evaluate(() => originalVersions === document.querySelector('.edit-version-slot .editor-rail')), true);
  assert.equal(await p.evaluate(() => originalCanvas === document.getElementById('editorMask')), true);
  assert.deepEqual(f.errors, []);
});

test('EDIT canvas: ASK draft writes the original form and the docked action generates only on click', async t => {
  const f = await setup(t), p = f.page;
  const png = await p.evaluate(async () => [...new Uint8Array(await (await makeImage('#335588')).arrayBuffer())]);
  const generations = [];
  await p.route(`https://${hosts.image}/**/image/tools/run`, r => {
    generations.push(r.request().postDataJSON()); return r.fulfill({ contentType: 'image/png', body: Buffer.from(png) });
  });
  await askDraft(p, f.llm, [{ kind: 'prompt_patch', target: 'edit.prompt', mode: 'rewrite', text: 'gentle evening light' }], '把编辑描述改为傍晚柔光');
  await applyDraft(p);
  assert.equal(generations.length, 0);
  assert.equal(await p.evaluate(() => editor.session.fields.prompt), 'gentle evening light');
  assert.equal(await p.locator('#editorPrompt').isVisible(), false);
  await p.locator('#editorRun').click();
  await p.waitForFunction(() => !editor.snapshot().busy && editor.session.versions.length === 2);
  assert.equal(generations.length, 1);
  assert.equal(generations[0].prompt, 'gentle evening light');
  assert.equal(await p.locator('.edit-version-slot .tile').count(), 2);
  f.llm.push({ ...textReply('继续保留蒙版和底图。'), delay: 400 });
  await p.locator('#askPrompt').fill('继续检查'); await submitAsk(p);
  await p.waitForFunction(() => ask.running.value);
  await switcher(p).getByRole('button', { name: '表单', exact: true }).click();
  await p.waitForFunction(() => !ask.running.value);
  assert.equal(await p.evaluate(() => ask.entries.value.at(-1).turn.status), 'done');
  assert.equal(generations.length, 1);
  assert.deepEqual(f.errors, []);
});
