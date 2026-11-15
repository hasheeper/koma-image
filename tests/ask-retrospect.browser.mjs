import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, toolReply, textReply, submitAsk, form, reloadAsk, hosts, openai, tool, end, applyDraft, undoCheckpoint, restoreCheckpoint } from './helpers/ask-fixture.mjs';

useAskFixture();
const graph = { retrospect_title: '海边人物 · 光线与机位', nodes: [
  { id: 'v1', label: '冷光基底', image_ids: ['#h2', '#h3'] },
  { id: 'v2', label: '压暗环境光', image_ids: ['#h4'] },
  { id: 'v3', label: '低机位尝试', image_ids: ['#h5'] },
], edges: [{ from: 'v1', to: 'v2', summary: '压暗环境光' }, { from: 'v1', to: 'v3', summary: '回到基底，改用仰视' }] };

async function seed(page, micro = false) {
  await bind(page);
  await page.waitForFunction(() => drawing.snapshot().models.some(m => m.id === 'nai-diffusion-5-full'));
  return page.evaluate(async micro => {
    const { seedHistory } = await import('/tests/helpers/drawing-history.mjs');
    const { DEFAULTS } = await import('/src/domain/drawing.ts');
    const canvas = new OffscreenCanvas(128, 192), ctx = canvas.getContext('2d'), ids = [];
    for (let i = 0; i < 5; i++) {
      const size = micro && i === 3 ? { width: 384, height: 192 } : micro && i === 4 ? { width: 192, height: 448 } : { width: 128, height: 192 };
      canvas.width = size.width; canvas.height = size.height; ctx.scale(size.width / 128, size.height / 192);
      ctx.fillStyle = ['#674f3a', '#557c9c', '#658baa', '#233d5a', '#647dab'][i]; ctx.fillRect(0, 0, 128, 192);
      ctx.fillStyle = '#cfbdae'; ctx.beginPath(); ctx.arc(64, 66, 25, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(42, 95, 44, 70);
      const prompt = ['old subject, city', 'blue dress, soft light', 'blue dress, soft light', 'blue dress, dark light', 'blue dress, soft light, low angle'][i];
      const role = { id: `c${i + 1}`, on: true, prompt: i === 4 ? 'silver hair' : 'black hair', negative: '', centers: micro ? [{ x: .7, y: i === 4 ? .65 : .6 }] : [] };
      const p = { ...structuredClone(DEFAULTS), ...(micro ? size : {}), boardId: drawing.snapshot().activeBoardId, basePrompt: prompt, baseNegative: 'lowres', prompt: `${prompt}, HIDDEN_SENT_PRESET`, negative_prompt: 'HIDDEN_SENT_NEGATIVE', localCharacters: [role], characters: [role], seed: i, steps: i === 3 ? 30 : 25 };
      if (micro && i === 2) {
        p.basePrompt += ', {rim light}'; p.steps = 26;
        p.localCharacters = [{ ...role, id: 'c30', prompt: ' \n', negative: '\t' }, { ...role, id: 'c31', on: false, prompt: 'DORMANT_ROLE' }, role];
      }
      const record = await seedHistory({ drawing, home: window.home }, await canvas.convertToBlob(), size, p);
      ids.push(record.id);
    }
    await drawing.patch({ prompt: 'working draft', negative: '', seed: '456', batchCount: 3 });
    return ids;
  }, micro);
}

test('mixed stage samples drive both sides of Diff, exact restore and ASK; a missing chosen sample never falls back', async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  const mixed = { retrospect_title: '同阶段微调', nodes: [
    { id: 'v1', label: '基底打磨', image_ids: ['#h2', '#h3'] },
    { id: 'v2', label: '光影与机位', description: '压暗环境光，尝试低机位并调整角色位置。', image_ids: ['#h4', '#h5'] },
  ], edges: [{ from: 'v1', to: 'v2', summary: '尝试另一种光线与机位' }] };
  try {
    const ids = await seed(page, true);
    await page.evaluate(() => ask.show({ question: '梳理这几版的演进，同阶段微调放一起' }));
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', mixed), textReply('已整理两个阶段。'));
    await submitAsk(page); await page.locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length, 3, 'one candidate read supplies all evidence');
    const evidence = calls[1].body.messages.find(m => m.role === 'tool').content;
    assert.match(evidence, /previous_id/); assert.match(evidence, /rim light/); assert.match(evidence, /#h5/);
    await page.getByRole('button', { name: /^打开演进 / }).click();
    const panel = page.getByRole('dialog', { name: mixed.retrospect_title });
    await panel.waitFor();
    assert.equal(await panel.locator('.meta-description').textContent(), mixed.nodes[1].description);
    const roleDiff = panel.getByRole('region', { name: '角色 1', exact: true });
    assert.doesNotMatch(await roleDiff.textContent(), /\{"x"|启用/);
    assert.equal(await roleDiff.locator('.position-axis del').textContent(), '0.6');
    assert.equal(await roleDiff.locator('.position-axis ins').textContent(), '0.65');
    await roleDiff.locator('.same-fields summary').click();
    assert.equal(await roleDiff.locator('[data-field="c0:negative"]').textContent(), 'Negative空');
    assert.equal(await panel.locator('.version-node').count(), 2);
    assert.equal(await panel.locator('.continuation-frame').count(),0);
    await page.evaluate(() => { const r=ask.retrospects.get(ask.retrospects.opened.value.id); ask.retrospects.commitMove(ask.retrospects.prepareNext(r.boardId, 'ask')); });
    const continuation = panel.locator('.continuation-frame');
    assert.equal(await continuation.getAttribute('data-origin'), 'v2');
    assert.equal(await continuation.getAttribute('data-origin-sample'), '#h5');
    assert.equal(await panel.locator('[data-node="v2"]').getAttribute('data-sample'), '#h5');
    assert.match(await panel.locator('[data-field="prompt"] .del .text').textContent(), /rim light/);
    assert.equal(await panel.getByRole('region', { name: '角色 2', exact: true }).count(), 0);
    assert.doesNotMatch(await panel.locator('.recipe-review').textContent(), /DORMANT_ROLE/);
    const pin = panel.getByRole('button', { name: '从 v1 开始（恢复到画板）', exact: true });
    await panel.locator('[data-node="v1"]').hover();
    await pin.click();
    await page.waitForFunction(() => ask.retrospects.records.value[0].cursor.imageId === '#h3');
    assert.equal(await continuation.count(),0);
    await page.evaluate(() => { const r=ask.retrospects.get(ask.retrospects.opened.value.id); ask.retrospects.commitMove(ask.retrospects.prepareNext(r.boardId, 'ask')); });
    assert.equal(await continuation.getAttribute('data-origin'), 'v1');
    assert.equal(await continuation.getAttribute('data-origin-sample'), '#h3');
    assert.equal((await form(page)).prompt, 'blue dress, soft light, {rim light}');
    assert.match(await panel.locator('[data-field="prompt"] .ins .text').textContent(), /low angle/, 'pinning a different node preserves the B comparison');
    assert.equal(await pin.getAttribute('aria-pressed'), 'true');
    await panel.locator('[data-node="v1"]').hover();
    await panel.getByRole('button', { name: 'v1 上一张样本', exact: true }).click();
    assert.equal(await continuation.getAttribute('data-origin-sample'), '#h3', 'browsing a sample does not change the pinned preview');
    assert.equal(await pin.getAttribute('aria-pressed'), 'false', 'origin state belongs to one concrete sample');
    await pin.click();
    await page.waitForFunction(() => ask.retrospects.records.value[0].cursor.imageId === '#h2');
    await page.evaluate(() => { const r=ask.retrospects.get(ask.retrospects.opened.value.id); ask.retrospects.commitMove(ask.retrospects.prepareNext(r.boardId, 'ask')); });
    assert.equal(await continuation.getAttribute('data-origin-sample'), '#h2');
    assert.equal((await form(page)).prompt, 'blue dress, soft light');
    assert.equal((await form(page)).steps, 25);
    assert.equal(await panel.getByRole('textbox', { name: '批注内容' }).count(), 0);
    assert.equal(requests.some(r => /generate|img2img|inpaint|upscale/.test(r.path)), false, 'pin restores without generation');
    assert.equal(await panel.locator('[data-field="prompt"] .del').count(), 0, 'baseline sample changes the actual Diff');
    await panel.getByRole('button', { name: 'v1 下一张样本', exact: true }).click();
    await panel.locator('[data-node="v2"]').hover();
    await panel.getByRole('button', { name: 'v2 上一张样本', exact: true }).click();
    assert.match(await panel.locator('[data-field="prompt"] .ins .text').textContent(), /dark/);
    await panel.getByRole('button', { name: '恢复到画板', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: /已恢复 IMAGE 配方/ }).waitFor();
    let restored = await form(page);
    assert.equal(restored.prompt, 'blue dress, dark light'); assert.equal(restored.steps, 30);
    assert.deepEqual([restored.width, restored.height], [384, 192], 'landscape sample restores its own dimensions');
    await panel.getByRole('button', { name: '关系图适应全部', exact: true }).click();
    await panel.getByRole('button', { name: 'v2 下一张样本', exact: true }).click();
    await panel.getByRole('button', { name: '恢复到画板', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: /已恢复 IMAGE 配方/ }).waitFor();
    restored = await form(page);
    assert.equal(restored.prompt, 'blue dress, soft light, low angle'); assert.equal(restored.steps, 25);
    assert.deepEqual([restored.width, restored.height], [192, 448], 'switching to the tall sample uses its actual recipe');
    assert.equal(restored.characters[0].prompt, 'silver hair'); assert.equal(restored.seed, '456');
    await panel.locator('[data-node="v1"] .node-image').click();
    await panel.getByRole('button', { name: '恢复到画板', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: /已恢复 IMAGE 配方/ }).waitFor();
    restored = await form(page);
    assert.equal(restored.prompt, 'blue dress, soft light, {rim light}'); assert.equal(restored.steps, 26);
    assert.equal(restored.characters.length, 3, 'restoration retains raw slots excluded from Diff');
    assert.equal(restored.characters[1].on, false); assert.equal(restored.characters[1].prompt, 'DORMANT_ROLE');
    await panel.locator('[data-node="v2"] .node-image').click();
    await panel.getByRole('button', { name: 'ASK', exact: true }).click();
    assert.match(await page.locator('#askPrompt').inputValue(), /v1（#h3[\s\S]*v2（#h5/);
    await page.locator('#askPrompt').fill('');
    await panel.getByRole('button', { name: 'ASK', exact: true }).click();
    await page.evaluate(id => drawing.remove(id), ids[4]);
    await panel.getByText('原记录已失效', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: '恢复到画板', exact: true }).isDisabled(), true);
    assert.equal(await panel.getByRole('button', { name: '从 v2 开始（恢复到画板）', exact: true }).isDisabled(), true);
    const rejected = await page.evaluate(async () => {
      const r = ask.retrospects.records.value[0], n = r.value.nodes.find(n => n.id === 'v2');
      try { await ask.restoreRetrospect(n, r.pictureRefs); return ''; } catch (error) { return error.message; }
    });
    assert.match(rejected, /失效/);
    await panel.getByRole('button', { name: 'ASK', exact: true }).click();
    assert.equal(await page.locator('#askPrompt').inputValue(), '', 'ASK cannot silently reference another recipe in the stage');
    await panel.getByRole('button', { name: 'ASK', exact: true }).click();
    await panel.locator('[data-node="v2"]').hover();
    await panel.getByRole('button', { name: 'v2 上一张样本', exact: true }).click();
    assert.equal(await panel.getByRole('button', { name: '恢复到画板', exact: true }).isDisabled(), false, 'other samples stay individually usable');
    await panel.getByRole('button', { name: '关闭演进' }).click();
    const owner = await page.evaluate(async () => { await ask.toggleFavorite(); return ask.conversationId.value; });
    await reloadAsk(page); await page.evaluate(owner => { ask.selectConversation(owner); ask.show(); }, owner);
    await page.getByRole('button', { name: /^打开演进 / }).click();
    await panel.locator('[data-node="v2"]').hover();
    await panel.getByRole('button', { name: 'v2 上一张样本', exact: true }).click();
    assert.match(await panel.locator('[data-field="prompt"] .ins .text').textContent(), /dark/);
    assert.equal(await panel.getByRole('button', { name: '恢复到画板', exact: true }).isDisabled(), true);
    assert.equal(await panel.locator('.meta-description').textContent(), mixed.nodes[1].description, 'saved ASK snapshot retains the independent description');
    assert.equal(calls.length, 3); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Diff renders long raw prompts, complete weighted context, precise Chinese edits and parameter type changes', async () => {
  const { page, context, llm, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    await bind(page);
    const originals = await page.evaluate(async () => {
      const { seedHistory } = await import('/tests/helpers/drawing-history.mjs');
      const { DEFAULTS } = await import('/src/domain/drawing.ts');
      const canvas = new OffscreenCanvas(128, 192), g = canvas.getContext('2d'), texts = [];
      for (let i = 0; i < 2; i++) {
        g.fillStyle = i ? '#486894' : '#756e9c'; g.fillRect(0, 0, 128, 192);
        const prompt = `${'unchanged artist style, '.repeat(200)}${i ? '1.5' : '1.3'}::blue eyes::, 柔和的月光从${i ? '右' : '左'}侧窗户照向站立的女孩。`;
        texts.push(prompt);
        await seedHistory({ drawing }, await canvas.convertToBlob(), { width: 128, height: 192 }, {
          ...structuredClone(DEFAULTS), basePrompt: prompt, baseNegative: '', localCharacters: [], boardId: drawing.snapshot().activeBoardId, scale: i ? '5' : 5,
        });
      }
      return texts;
    });
    await page.evaluate(() => ask.show({ question: '比较这两版' }));
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', {
      retrospect_title: '局部 Diff', nodes: [{ id: 'v1', label: '原文', image_ids: ['#h1'] }, { id: 'v2', label: '微调', image_ids: ['#h2'] }], edges: [{ from: 'v1', to: 'v2', summary: '权重和方向' }],
    }), textReply('已整理。'));
    await submitAsk(page); await page.locator('.ask-turn[data-status="done"]').waitFor();
    await page.getByRole('button', { name: /^打开演进 / }).click();
    const panel = page.getByRole('dialog', { name: '局部 Diff' }), prompt = panel.locator('[data-field="prompt"]');
    await panel.waitFor();
    assert.doesNotMatch(await prompt.textContent(), /unchanged artist style/);
    assert.match(await prompt.locator('.del .text').textContent(), /1\.3::blue eyes::/);
    assert.match(await prompt.locator('.ins .text').textContent(), /1\.5::blue eyes::/);
    assert.deepEqual(await prompt.locator('del').allTextContents(), ['1.3', '左']);
    assert.deepEqual(await prompt.locator('ins').allTextContents(), ['1.5', '右']);
    const scale = panel.locator('.parameter-row').filter({ has: page.locator('dt', { hasText: /^Guidance$/ }) });
    assert.equal(await scale.locator('del').textContent(), '5'); assert.equal(await scale.locator('b').textContent(), '"5"');
    await panel.getByRole('button', { name: '全文', exact: true }).click();
    assert.deepEqual(await prompt.locator('.full-row p').allTextContents(), originals);
    assert.deepEqual(await prompt.locator('del').allTextContents(), ['1.3', '左']);
    assert.deepEqual(await prompt.locator('ins').allTextContents(), ['1.5', '右']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('generation updates preserve a live node or empty-frame drag, and landing keeps every independent placement', async () => {
  const { page, context, llm, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  let release;
  try {
    await seed(page, true);
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', graph), textReply('已整理。'));
    await page.evaluate(() => ask.show({ question: '整理版本演进' })); await submitAsk(page);
    await page.waitForFunction(() => !ask.running.value && ask.retrospects.records.value.length === 1);
    await page.getByRole('button', { name: /^打开演进 / }).click();
    const panel = page.getByRole('dialog', { name: graph.retrospect_title });
    await panel.getByRole('button', { name: '关闭配方', exact: true }).click();
    const fit = () => panel.getByRole('button', { name: '关系图适应全部', exact: true }).click();
    const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
    const state = () => page.evaluate(() => structuredClone(ask.retrospects.records.value[0]));
    const beginDrag = async (locator) => {
      const box = await locator.boundingBox();
      const point = { x: box.x + box.width * .8, y: box.y + box.height * .25 };
      await page.mouse.move(point.x, point.y); await page.mouse.down();
      await page.mouse.move(point.x + 45, point.y + 30, { steps: 5 }); await frame();
    };
    await fit();
    await page.evaluate(() => { const r=ask.retrospects.get(ask.retrospects.opened.value.id); ask.retrospects.commitMove(ask.retrospects.prepareNext(r.boardId, 'ask')); });
    await fit();
    const before = await state();
    const png = await page.evaluate(async () => {
      await drawing.patch({ batchCount: 1 });
      return [...new Uint8Array(await drawing.snapshot().history[0].blob.arrayBuffer())];
    });
    let arrived;
    const started = new Promise(resolve => { arrived = resolve; }), waiting = new Promise(resolve => { release = resolve; });
    await page.route(`https://${hosts.image}/**`, async route => {
      if (!/\/(generate|generate-image)$/.test(new URL(route.request().url()).pathname)) return route.fallback();
      arrived(); await waiting; return route.fulfill({ contentType: 'image/png', body: Buffer.from(png) });
    });
    await page.evaluate(() => { window.canvasGeneration = drawing.run(); }); await started;
    const edge = panel.locator('[data-edge-from="v1"][data-edge-to="v2"] .edge-line');
    const beforePath = await edge.getAttribute('d');
    await beginDrag(panel.locator('[data-node="v2"] .node-media'));
    const draggedPath = await edge.getAttribute('d'); assert.notEqual(draggedPath, beforePath);
    // Drawing notifications also occur for progress, quotes and model refreshes while a request is pending.
    await page.evaluate(() => drawing.patch({ seed: '789' })); await frame();
    assert.equal(await panel.locator('[data-node="v2"].node-drag-active').count(), 1, 'metadata refresh does not cancel placement');
    assert.equal(await edge.getAttribute('d'), draggedPath, 'the edge keeps the live endpoint after Vue updates');
    await page.mouse.up(); await frame();
    const moved = await state(); assert.notDeepEqual(moved.nodeLayout.v2, before.nodeLayout.v2);
    assert.deepEqual(moved.nodeLayout.v1, before.nodeLayout.v1);
    assert.deepEqual(moved.nodeLayout.v3, before.nodeLayout.v3);
    assert.deepEqual(moved.continuationAnchor, before.continuationAnchor);

    await fit(); await beginDrag(panel.locator('.continuation-frame'));
    assert.equal(await panel.locator('.continuation-frame.node-drag-active').count(), 1, 'empty-frame drag has started');
    const blankPath = await panel.locator('.continuation-line').getAttribute('d');
    await page.evaluate(() => drawing.patch({ seed: '790' })); await frame();
    assert.equal(await panel.locator('.continuation-frame.node-drag-active').count(), 1);
    assert.equal(await panel.locator('.continuation-line').getAttribute('d'), blankPath);
    await page.mouse.up(); await frame();
    const blankMoved = await state(); assert.notDeepEqual(blankMoved.continuationAnchor, before.continuationAnchor);
    assert.deepEqual(blankMoved.nodeLayout, moved.nodeLayout, 'empty-frame placement never moves a real node');

    await fit(); await beginDrag(panel.locator('[data-node="v1"] .node-media'));
    release(); await page.evaluate(() => window.canvasGeneration); await frame();
    assert.equal(await panel.locator('[data-node="v1"].node-drag-active').count(), 1, 'a new result does not cancel an unrelated node drag');
    await page.mouse.up(); await frame();
    const landed = await state(), { x, cy, z } = blankMoved.continuationAnchor;
    assert.notDeepEqual(landed.nodeLayout.v1, moved.nodeLayout.v1);
    assert.deepEqual(landed.nodeLayout.v2, moved.nodeLayout.v2);
    assert.deepEqual(landed.nodeLayout.v3, moved.nodeLayout.v3);
    assert.deepEqual(landed.nodeLayout.v4, { x, cy, z }, 'the result replaces the exact independently placed empty frame');
    assert.equal(await panel.locator('.version-node').count(), 4);
    assert.equal(await panel.locator('.graph-edge').count(), 3);
    assert.equal(await panel.locator('.node-drag-active').count(), 0);
    assert.deepEqual(errors, []);
  } finally { release?.(); await context.close(); }
});

test('evolution camera pans freely and the continuation preview returns to editing without writing or generating', async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    await seed(page); await page.evaluate(() => ask.show({ question: '整理版本演进' }));
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', graph), textReply('已整理。'));
    await submitAsk(page); await page.waitForFunction(() => !ask.running.value && ask.retrospects.records.value.length === 1);
    await page.getByRole('button', { name: /^打开演进 / }).click();
    const panel = page.getByRole('dialog', { name: graph.retrospect_title }), world = panel.locator('.graph-world');
    const canvas = panel.locator('.graph-viewport'), preview = panel.locator('.continuation-frame');
    await page.evaluate(() => { const r=ask.retrospects.get(ask.retrospects.opened.value.id); ask.retrospects.commitMove(ask.retrospects.prepareNext(r.boardId, 'ask')); });
    await page.waitForFunction(() => !!ask.retrospects.records.value[0].continuationAnchor);
    const before = await form(page), record = await page.evaluate(() => structuredClone(ask.retrospects.records.value[0]));
    const fit = () => panel.getByRole('button', { name: '关系图适应全部', exact: true }).click();
    const camera = () => world.evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return [m.e, m.f, m.a]; });
    // Relative camera movement is the gesture outcome; no fixed styling geometry is asserted.
    const drag = async (start, button = 'left') => {
      await page.mouse.move(start.x, start.y); await page.mouse.down({ button });
      await page.mouse.move(start.x + 75, start.y + 42, { steps: 6 }); await page.mouse.up({ button });
    };
    await fit();
    const fitted = await camera();
    let area = await canvas.boundingBox(); await drag({ x: area.x + 10, y: area.y + 14 });
    assert.notDeepEqual(await camera(), fitted, 'even a fitted tree can move on blank-area drag');
    await fit(); assert.deepEqual(await camera(), fitted, 'fit remains an explicit way home');
    await panel.getByRole('button', { name: '平移工具', exact: true }).click();
    let image = await panel.locator('[data-node="v1"] .node-media').boundingBox();
    await drag({ x: image.x + image.width / 2, y: image.y + image.height / 2 });
    assert.notDeepEqual(await camera(), fitted, 'hand tool pans over a real node without selecting it');
    await fit(); await canvas.press('v');
    image = await panel.locator('[data-node="v1"] .node-media').boundingBox();
    await drag({ x: image.x + image.width / 2, y: image.y + image.height / 2 }, 'middle');
    assert.notDeepEqual(await camera(), fitted, 'middle mouse temporarily pans in selection mode');
    await fit();
    await panel.locator('[data-node="v1"] .node-image').focus(); await page.keyboard.down('Space');
    image = await panel.locator('[data-node="v1"] .node-media').boundingBox();
    await drag({ x: image.x + image.width / 2, y: image.y + image.height / 2 }); await page.keyboard.up('Space');
    assert.notDeepEqual(await camera(), fitted, 'space temporarily pans when an image has keyboard focus');
    await fit();
    await panel.locator('[data-node="v2"] .node-image').click();
    const edgeBefore = await panel.locator('[data-edge-from="v1"][data-edge-to="v3"] .edge-line').getAttribute('d');
    image = await panel.locator('[data-node="v3"] .node-media').boundingBox();
    await drag({ x: image.x + image.width / 2, y: image.y + image.height / 2 });
    await page.waitForFunction(() => !!ask.retrospects.records.value[0].nodeLayout.v3);
    const arranged = await page.evaluate(() => structuredClone(ask.retrospects.records.value[0].nodeLayout));
    assert.deepEqual(await page.evaluate(() => ask.retrospects.records.value[0].continuationAnchor), record.continuationAnchor, 'moving the creation base leaves the empty frame in place');
    assert.ok(arranged.v3.z > arranged.v2.z);
    assert.equal(await panel.locator('.version-node.selected').getAttribute('data-node'), 'v2', 'dragging the creation base does not select B');
    assert.notEqual(await panel.locator('[data-edge-from="v1"][data-edge-to="v3"] .edge-line').getAttribute('d'), edgeBefore, 'incident edge follows a moved node');
    assert.equal(await preview.getAttribute('data-origin'), 'v3');
    // Esc cancels an in-progress placement without changing the saved layout.
    image = await panel.locator('[data-node="v3"] .node-media').boundingBox();
    await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2); await page.mouse.down();
    await page.mouse.move(image.x + image.width / 2 - 45, image.y + image.height / 2 + 25, { steps: 4 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => ask.retrospects.records.value[0].nodeLayout), arranged);
    await fit();
    const blank = await preview.boundingBox();
    await page.mouse.move(blank.x + blank.width * .8, blank.y + blank.height * .25); await page.mouse.down();
    await page.mouse.move(blank.x + blank.width * .8, blank.y + blank.height * 1.25 + 120, { steps: 6 }); await page.mouse.up();
    const blankPlaced = await page.evaluate(() => structuredClone(ask.retrospects.records.value[0].continuationAnchor));
    assert.notDeepEqual(blankPlaced, record.continuationAnchor, 'empty frame can be moved independently');
    assert.deepEqual(await page.evaluate(() => ask.retrospects.records.value[0].nodeLayout), arranged, 'moving the empty frame leaves every real node in place');
    assert.equal(await panel.locator('.version-node.selected').getAttribute('data-node'), 'v2');
    await fit();
    await panel.getByRole('button', { name: '选择方式', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '框选', exact: true }).click();
    const ghost = await preview.boundingBox();
    await page.mouse.move(ghost.x - 5, ghost.y - 5); await page.mouse.down();
    await page.mouse.move(ghost.x + ghost.width + 5, ghost.y + ghost.height + 5, { steps: 6 }); await page.mouse.up();
    assert.equal(await panel.locator('.node-image[aria-pressed="true"]').count(), 0, 'marquee on the empty node does not invent a real version selection');
    assert.equal(await panel.locator('.graph-edge[aria-pressed="true"]').count(), 0);
    assert.match(await preview.getAttribute('aria-label'), /已选中/);
    assert.equal(await panel.getByRole('textbox', { name: '批注内容' }).count(), 0);
    await panel.getByRole('button', { name: '平移工具', exact: true }).click();
    area = await canvas.boundingBox();
    const at = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const initialCamera = await camera(), cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
    await touch('touchStart', [[1, at.x - 50, at.y]]);
    await touch('touchStart', [[1, at.x - 50, at.y], [2, at.x + 50, at.y]]);
    for (let i = 1; i <= 12; i++) await touch('touchMove', [[1, at.x - 50 - i, at.y + i], [2, at.x + 50 + i, at.y + i]]);
    await touch('touchEnd', []); await cdp.detach();
    const pinched = await camera();
    assert.ok(Math.abs(pinched[2] - Math.min(2, initialCamera[2] * 1.24)) < .0001, 'pinch retains the accumulated scale');
    // Closing before a wheel display callback must still save all of its input.
    await canvas.evaluate((el, at) => {
      for (let i = 0; i < 12; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: 5, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
      el.closest('dialog').querySelector('[aria-label="关闭演进"]').click();
    }, at);
    await panel.waitFor({ state: 'detached' });
    const savedCamera = await page.evaluate(() => ask.retrospects.records.value[0].graphCamera);
    assert.ok(Math.abs(savedCamera.scale - pinched[2] * Math.exp(-.12)) < .0001, 'pending wheel input is saved on close');
    await page.getByRole('button', { name: '打开画板演进，进行中', exact: true }).click(); await panel.waitFor();
    const positionedCamera = await camera();
    await panel.getByRole('button', { name: '大图', exact: true }).click();
    await panel.getByRole('button', { name: '演进图', exact: true }).click();
    assert.deepEqual(await camera(), positionedCamera, 'image viewing returns to the same canvas pan and zoom');
    await panel.getByRole('button', { name: '返回画板继续演进', exact: true }).click();
    await panel.waitFor({ state: 'detached' });
    assert.match(page.url(), /#\/image$/);
    assert.deepEqual(await form(page), before, 'plus preserves the current edited recipe');
    const after = await page.evaluate(() => ask.retrospects.records.value[0]);
    assert.deepEqual(after.cursor, record.cursor); assert.equal(after.revision, record.revision);
    assert.deepEqual(after.value, record.value);
    await page.getByRole('button', { name: '打开画板演进，进行中', exact: true }).click(); await panel.waitFor();
    assert.deepEqual(await camera(), positionedCamera, 'closing and reopening preserves the camera without fitting the new scene');
    assert.deepEqual(await page.evaluate(() => ask.retrospects.records.value[0].nodeLayout), arranged, 'placement survives closing and reopening');
    assert.deepEqual(await page.evaluate(() => ask.retrospects.records.value[0].continuationAnchor), blankPlaced, 'empty frame placement also survives reopening');
    await panel.getByRole('button', { name: '关闭演进', exact: true }).click();
    assert.equal(calls.length, 3); assert.equal(requests.some(r => /generate|img2img|inpaint|upscale/.test(r.path)), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('[core] ASK retrospective: semantic fork card, exact raw Diff, explicit restore and followup without generation', async () => {
  const { page, context, llm, calls, requests, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    await seed(page);
    const before = await form(page);
    await page.getByRole('button', { name: '历史更多选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '请 ASK 发起演进' }).click();
    assert.match(await page.locator('#askPrompt').inputValue(), /演进/);
    assert.equal(calls.length, 0, 'history entry only prefills');
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', graph), textReply('保留冷光基底，再检查机位。'));
    await submitAsk(page);
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    assert.equal(calls.length, 3);
    assert.deepEqual(await form(page), before, 'read-only tools cannot change the form');
    await page.getByRole('button', { name: /^打开演进 / }).click();
    const panel = page.getByRole('dialog', { name: graph.retrospect_title });
    await panel.waitFor();
    assert.equal(await panel.locator('.version-node').count(), 3);
    assert.doesNotMatch(await panel.textContent(), /HIDDEN_SENT|sent_prompt|old subject/);
    await panel.locator('[data-node="v2"] .node-image').click();
    assert.match(await panel.getByRole('button', { name: '选择对比基准', exact: true }).getAttribute('title'), /A · v1/);
    assert.match(await panel.locator('[data-field="prompt"] .del .text').textContent(), /soft/);
    assert.match(await panel.locator('[data-field="prompt"] .ins .text').textContent(), /dark/);
    await panel.locator('[data-node="v3"] .node-image').click({ modifiers: ['Shift'] });
    assert.match(await panel.getByRole('button', { name: '选择对比基准', exact: true }).getAttribute('title'), /A · v3/);
    assert.equal(calls.length, 3, 'comparisons are computed locally');
    await panel.getByRole('button', { name: '恢复到画板', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: /已恢复 IMAGE 配方/ }).waitFor();
    const restored = await form(page);
    assert.equal(restored.prompt, 'blue dress, dark light'); assert.equal(restored.negative, 'lowres'); assert.equal(restored.steps, 30);
    assert.equal(restored.seed, '456'); assert.equal(restored.batchCount, 3);
    await panel.getByRole('button', { name: '选择对比基准', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /v1/ }).click();
    await panel.getByRole('button', { name: 'ASK', exact: true }).click();
    assert.match(await page.locator('#askPrompt').inputValue(), /v1（#h3[\s\S]*v2（#h4[\s\S]*草稿/);
    assert.equal(calls.length, 3);
    assert.equal(requests.some(r => /generate|img2img|inpaint|upscale/.test(r.path)), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK retrospective: touch baseline selection and deleted sources retain Diff but cannot restore', async () => {
  const { page, context, llm, calls, errors } = await open('/#/image', { ready: '.switcher', standard: true, width: 390, touch: true, ask: askSettings({ images: false }) });
  try {
    await page.getByRole('button', { name: '继续桌面布局', exact: true }).click();
    const ids = await seed(page);
    await page.evaluate(() => ask.show({ question: '梳理这几版的演进' }));
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', graph), textReply('已整理。'));
    await submitAsk(page); await page.locator('.ask-turn[data-status="done"]').waitFor();
    await page.getByRole('button', { name: /^打开演进 / }).click();
    const panel = page.getByRole('dialog', { name: graph.retrospect_title });
    await panel.locator('[data-node="v2"] .node-image').click();
    await panel.getByRole('button', { name: '配方', exact: true }).click();
    await panel.getByRole('button', { name: '选择对比基准', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /v3/ }).click();
    assert.match(await panel.getByRole('button', { name: '选择对比基准', exact: true }).getAttribute('title'), /A · v3/);
    const before = await form(page);
    await page.evaluate(id => drawing.remove(id), ids[3]);
    await panel.getByText('原记录已失效', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: '恢复到画板', exact: true }).isDisabled(), true);
    assert.match(await panel.locator('[data-field="prompt"]').textContent(), /dark/);
    assert.deepEqual(await form(page), before); assert.equal(calls.length, 3);
    await panel.getByRole('button', { name: '关闭演进' }).click();
    const owner = await page.evaluate(async () => { await ask.toggleFavorite(); return ask.conversationId.value; });
    await reloadAsk(page);
    await page.getByRole('button', { name: '继续桌面布局', exact: true }).click();
    const newIds = await seed(page);
    await page.evaluate(async ({ owner, id }) => {
      // Same pixels in a new favorite may supply a preview, never the old recipe identity.
      await drawing.toggleFavorite(drawing.snapshot().history.find(r => r.id === id));
      ask.selectConversation(owner); ask.show();
    }, { owner, id: newIds[3] });
    await page.getByRole('button', { name: /^打开演进 / }).click();
    await panel.locator('[data-node="v2"] .node-image').click();
    await panel.getByRole('button', { name: '配方', exact: true }).click();
    assert.match(await panel.locator('[data-field="prompt"]').textContent(), /dark/);
    assert.equal(await panel.getByRole('button', { name: '恢复到画板', exact: true }).isDisabled(), true);
    assert.equal(calls.length, 3, 'saved card rendering does not call ASK');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('retrospect annotations: single/multiple/box selection, explicit save/delete, reopen and inline ASK', async () => {
  const { page, context, llm, calls, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    await seed(page);
    const before = await form(page);
    await page.evaluate(() => ask.show({ question: '梳理这几版的演进' }));
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', graph), textReply('已整理。'));
    await submitAsk(page); await page.locator('.ask-turn[data-status="done"]').waitFor();
    await page.getByRole('button', { name: /^打开演进 / }).click();
    const panel = page.getByRole('dialog', { name: graph.retrospect_title });
    const v1 = panel.locator('[data-node="v1"] .node-image'), v2 = panel.locator('[data-node="v2"] .node-image');
    await v1.click(); await v1.click(); assert.equal(await v1.getAttribute('aria-pressed'), 'false');
    await v1.click(); await panel.getByRole('button', { name: '批注工具', exact: true }).click();
    await panel.getByRole('textbox', { name: '批注内容' }).fill('保留冷光');
    await panel.getByRole('button', { name: '保存批注', exact: true }).click();
    assert.match(await v1.getAttribute('title'), /保留冷光/);
    await panel.getByRole('button', { name: '批注工具', exact: true }).click();
    assert.equal(await panel.getByRole('button', { name: '批注工具', exact: true }).getAttribute('aria-pressed'), 'false');
    await panel.getByRole('button', { name: '选择方式', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '多选', exact: true }).click();
    await v1.click(); await v2.click();
    await panel.getByRole('button', { name: '批注工具', exact: true }).click();
    await panel.getByRole('textbox', { name: '批注内容' }).fill('注意面部');
    await panel.getByRole('button', { name: '保存 2 项批注', exact: true }).click();
    assert.match(await v1.getAttribute('title'), /保留冷光\n注意面部/);
    assert.match(await v2.getAttribute('title'), /注意面部/);
    const edge = panel.getByRole('button', { name: 'v1 到 v2 连线', exact: true });
    await edge.press('Enter');
    await panel.getByRole('textbox', { name: '批注内容' }).fill('暗部过重');
    await panel.getByRole('button', { name: '保存批注', exact: true }).click();
    await panel.getByRole('button', { name: 'v1 到 v2 连线，有批注', exact: true }).press('Enter');
    await panel.getByRole('button', { name: '删除当前批注', exact: true }).click();
    assert.equal(await edge.count(), 1);
    await panel.getByRole('button', { name: '选择方式', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '框选', exact: true }).click();
    await panel.getByRole('button', { name: '关系图适应全部', exact: true }).click();
    // Geometry is used only to perform the real marquee input, never asserted as styling.
    const rect = await panel.locator('[data-node="v1"] .node-media').boundingBox();
    await page.mouse.move(rect.x - 6, rect.y - 18); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width + 6, rect.y + rect.height + 6, { steps: 8 }); await page.mouse.up();
    assert.equal(await v1.getAttribute('aria-pressed'), 'true');
    assert.equal(await v2.getAttribute('aria-pressed'), 'false');
    await panel.getByRole('button', { name: 'ASK', exact: true }).click();
    assert.equal(await panel.locator('#askIsland').count(), 1);
    assert.equal(await page.locator('#askIsland').count(), 1);
    assert.match(await page.locator('#askPrompt').inputValue(), /保留冷光[\s\S]*注意面部/);
    assert.equal(calls.length, 3, 'opening ASK only prefills');
    await panel.getByRole('button', { name: 'ASK', exact: true }).click();
    await panel.getByRole('button', { name: '关闭演进' }).click();
    await page.getByRole('button', { name: '打开画板演进，进行中' }).click();
    assert.match(await v1.getAttribute('title'), /保留冷光/);
    assert.deepEqual(await form(page), before);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('retrospect status: failed ASK turns keep activation; successful end hides shortcuts and keeps history', async () => {
  const { page, context, llm, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    await seed(page); await page.evaluate(() => ask.show({ question: '演进' }));
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', graph), textReply('已整理。'));
    await submitAsk(page); await page.locator('.ask-turn[data-status="done"]').waitFor();
    const id = await page.evaluate(() => ask.retrospects.records.value[0].id);
    await page.evaluate(() => ask.setInput('结束这次演进'));
    llm.push(toolReply('end-failed', 'set_retrospect_status', { retrospect_id: id, status: 'ended' }), { status: 500, body: 'mock failure' });
    await submitAsk(page); await page.locator('.ask-turn[data-status="failed"]').waitFor();
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).status, id), 'active');
    await page.evaluate(() => ask.setInput('结束这次演进'));
    llm.push(toolReply('end', 'set_retrospect_status', { retrospect_id: id, status: 'ended' }), textReply('已结束。'));
    await submitAsk(page); await page.waitForFunction(id => ask.retrospects.get(id).status === 'ended', id);
    assert.equal(await page.getByRole('button', { name: '打开画板演进，进行中' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '打开当前演进' }).count(), 0);
    await page.getByRole('button', { name: /^打开演进 .*已解除$/ }).click();
    const panel = page.getByRole('dialog', { name: graph.retrospect_title });
    assert.equal(await panel.getByRole('button', { name: '批注工具' }).isDisabled(), true);
    assert.equal(await panel.locator('.continuation-frame').count(), 0);
    await panel.getByRole('button', { name: '继续演进', exact: true }).click();
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).status, id), 'active');
    assert.equal(await panel.getByRole('button', { name: '批注工具' }).isDisabled(), false);
    assert.equal(await panel.locator('.continuation-frame').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('live evolution uses actual generated results, rollback drafts, same-tree updates and explicit finalization', async () => {
  const { page, context, llm, calls, errors } = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  let failed = false, generation = 0, pending = null, arrived = null;
  try {
    const ids = await seed(page, true);
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(128, 192), g = c.getContext('2d');
      g.fillStyle = '#435e89'; g.fillRect(0, 0, 128, 192);
      return [...new Uint8Array(await (await c.convertToBlob()).arrayBuffer())];
    });
    await page.route(`https://${hosts.image}/**`, async route => {
      if (!/\/(generate|generate-image)$/.test(new URL(route.request().url()).pathname)) return route.fallback();
      generation++;
      if (pending) { arrived(); await pending; }
      if (failed) return route.fulfill({ status: 500, json: { error: 'synthetic failure' } });
      return route.fulfill({ contentType: 'image/png', body: Buffer.from(png) });
    });
    await page.evaluate(() => ask.show({ question: '整理这张图的版本演进' }));
    llm.push(toolReply('clusters', 'get_recipe_clusters', {}), toolReply('graph', 'show_retrospect', graph), textReply('已整理。'));
    await submitAsk(page); await page.waitForFunction(() => !ask.running.value && ask.retrospects.records.value.length === 1);
    const id = await page.evaluate(() => ask.retrospects.records.value[0].id);
    await page.evaluate(id => ask.retrospects.open(id), id);
    const initialPanel = page.getByRole('dialog', { name: graph.retrospect_title }); await initialPanel.waitFor();
    assert.equal(await initialPanel.locator('.continuation-frame').count(),0);
    await page.evaluate(() => { const r=ask.retrospects.get(ask.retrospects.opened.value.id); ask.retrospects.commitMove(ask.retrospects.prepareNext(r.boardId, 'ask')); });
    assert.equal(await initialPanel.locator('.continuation-frame').getAttribute('data-origin'), 'v3');
    const movable = await initialPanel.locator('[data-node="v3"] .node-media').boundingBox();
    await page.mouse.move(movable.x + movable.width / 2, movable.y + movable.height / 2); await page.mouse.down();
    await page.mouse.move(movable.x + movable.width / 2 - 60, movable.y + movable.height / 2 + 30, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(() => !!ask.retrospects.records.value[0].nodeLayout.v3);
    const placedBase = await page.evaluate(() => structuredClone(ask.retrospects.records.value[0].nodeLayout.v3));
    assert.equal(await initialPanel.getByRole('img', { name: '新版本', exact: true }).count(), 3);
    await initialPanel.getByRole('button', { name: '关闭演进' }).click();
    await page.evaluate(id => ask.retrospects.open(id), id); await initialPanel.waitFor();
    assert.equal(await initialPanel.getByRole('img', { name: '新版本', exact: true }).count(), 0);
    await initialPanel.getByRole('button', { name: '关闭演进' }).click();
    await page.evaluate(async () => {
      const r = ask.retrospects.records.value[0];
      await ask.restoreRetrospect(r.value.nodes[2], r.pictureRefs, r.id);
      await drawing.patch({ seed: '7', batchCount: 1 }); await drawing.run();
    });
    let tree = await page.evaluate(id => ask.retrospects.get(id), id);
    assert.equal(tree.value.nodes.length, 3);
    assert.equal(tree.value.nodes[2].image_ids.length, 2, 'seed-only generation stays in the current stage');
    await page.evaluate(id => ask.retrospects.open(id), id); await initialPanel.waitFor();
    assert.equal(await initialPanel.locator('.continuation-frame').count(),0);
    await page.evaluate(() => { const r=ask.retrospects.get(ask.retrospects.opened.value.id); ask.retrospects.commitMove(ask.retrospects.prepareNext(r.boardId, 'ask')); });
    assert.equal(await initialPanel.locator('.continuation-frame').getAttribute('data-origin'), 'v3');
    assert.equal(await initialPanel.locator('.continuation-frame').getAttribute('data-origin-sample'), tree.cursor.imageId);
    await initialPanel.getByRole('button', { name: '关系图适应全部', exact: true }).click();
    const reserved = await initialPanel.locator('.continuation-frame').boundingBox();
    await page.mouse.move(reserved.x + reserved.width * .8, reserved.y + reserved.height * .25); await page.mouse.down();
    await page.mouse.move(reserved.x + reserved.width * .8 + 30, reserved.y + reserved.height * .25 + 45, { steps: 6 }); await page.mouse.up();
    const reservedAnchor = await page.evaluate(id => structuredClone(ask.retrospects.get(id).continuationAnchor), id);
    await initialPanel.getByRole('button', { name: '关闭演进' }).click();
    const savedView = await page.evaluate(id => structuredClone(ask.retrospects.get(id).graphCamera), id);
    await page.evaluate(async () => { await drawing.patch({ prompt: 'blue dress, soft light, low angle, rim light', batchCount: 2 }); await drawing.run(); });
    tree = await page.evaluate(id => ask.retrospects.get(id), id);
    assert.equal(tree.value.nodes.length, 4);
    assert.equal(tree.value.nodes[3].image_ids.length, 2);
    assert.equal(tree.value.edges.at(-1).from, 'v3');
    assert.deepEqual(tree.nodeLayout.v3, placedBase, 'appending a generated branch preserves manual placement');
    assert.deepEqual(tree.nodeLayout.v4, { x: reservedAnchor.x, cy: reservedAnchor.cy, z: reservedAnchor.z }, 'the generated version lands exactly where the empty node was placed');
    assert.deepEqual(tree.graphCamera, savedView, 'generation does not reset the saved canvas view');
    await page.evaluate(id => ask.retrospects.open(id), id); await initialPanel.waitFor();
    const restoredView = await initialPanel.locator('.graph-world').evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return [m.e, m.f, m.a]; });
    assert.ok(restoredView.every((n, i) => Math.abs(n - [savedView.x, savedView.y, savedView.scale][i]) <= Math.max(1, Math.abs(n)) * .00001), 'reopening renders the saved camera after new generation');
    assert.equal(await initialPanel.locator('.continuation-frame').count(),0,'fulfilled slots do not leave another blank frame');
    assert.equal(await initialPanel.getByRole('img', { name: '新版本', exact: true }).count(), 1);
    await initialPanel.getByRole('button', { name: '关闭演进' }).click();
    assert.equal(await page.evaluate(() => drawing.snapshot().history.some(p => p.params.isComparison)), true);
    assert.equal(tree.value.nodes.flatMap(n => n.image_ids).length, 7, 'comparison sheets do not join the evolution');
    failed = true;
    await page.evaluate(() => drawing.run());
    assert.equal((await page.evaluate(id => ask.retrospects.get(id), id)).revision, tree.revision);
    failed = false;
    // Ordinary starring an intermediate result must leave the live tree active.
    await page.evaluate(async source => { await drawing.toggleFavorite(drawing.snapshot().history.find(p => p.id === source)); }, ids[1]);
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).status, id), 'active');
    llm.push({ body: request => {
      const content = [...request.messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('<workspace_state>')).content;
      const state = JSON.parse(content.match(/<workspace_state>\n([\s\S]*?)\n<\/workspace_state>/)[1]);
      return openai(tool('rollback', 'propose_draft', { base_hash: state.base_hash, draft_title: '回到冷光基底，改用背光', base_image_id: '#h2', steps: [{ kind: 'prompt_patch', target: 'image.prompt', mode: 'append', text: ', backlight' }] }), end('tool_calls'));
    }});
    await page.evaluate(() => ask.show({ question: '退回 #h2 基底并加上背光' }));
    await submitAsk(page); await page.locator('.ask-draft[data-status="pending"]').waitFor();
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).cursor.nodeId, id), 'v4', 'proposing is read only');
    await applyDraft(page);
    assert.equal((await form(page)).prompt, 'blue dress, soft light, backlight');
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).cursor.nodeId, id), 'v1');
    await page.evaluate(() => drawing.run());
    tree = await page.evaluate(id => ask.retrospects.get(id), id);
    assert.equal(tree.value.edges.at(-1).from, 'v1');
    assert.equal(tree.value.nodes.length, 5);
    await page.evaluate(id => ask.retrospects.open(id, 'v5'), id); await initialPanel.waitFor();
    assert.equal(await initialPanel.getByRole('img', { name: '新版本', exact: true }).count(), 1);
    assert.match(await initialPanel.getByRole('button', { name: '选择对比基准' }).getAttribute('aria-description'), /#h2/);
    assert.equal(await initialPanel.locator('[data-node="v1"]').getAttribute('data-sample'), '#h2', 'reopening follows the actual rollback sample, not the mixed-stage cover #h3');
    assert.doesNotMatch(await initialPanel.locator('.recipe-review').textContent(), /rim light/);
    await initialPanel.locator('[data-node="v1"] .node-image').click();
    assert.equal(await initialPanel.locator('[data-node="v1"]').getAttribute('data-sample'), '#h2', 'selecting the displayed baseline as B must not jump to its stage cover');
    await initialPanel.locator('[data-node="v5"] .node-image').click();
    await initialPanel.getByRole('button', { name: '大图', exact: true }).click();
    await initialPanel.getByRole('button', { name: '查看 A 基准图' }).click();
    assert.match(await initialPanel.locator('.stage-pane:visible .stage-image img').getAttribute('alt'), /v1 #h2/);
    await initialPanel.getByRole('button', { name: 'ASK', exact: true }).click();
    assert.match(await page.locator('#askPrompt').inputValue(), /v1（#h2/);
    await page.locator('#askPrompt').fill('');
    await initialPanel.getByRole('button', { name: '关闭演进' }).click();
    await undoCheckpoint(page);
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).cursor.nodeId, id), 'v4');
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).value.nodes.length, id), 5);
    await restoreCheckpoint(page);
    // ASK may refine stage names on the same stable tree after more generation.
    const payload = { retrospect_title: '冷光与背光', nodes: tree.value.nodes.map(n => ({ id: n.id, label: n.label, image_ids: n.image_ids, primary_id: n.cover })), edges: tree.value.edges };
    llm.push(toolReply('reread', 'get_recipe_clusters', { retrospect_id: id }), toolReply('revise', 'show_retrospect', payload), textReply('已更新。'));
    await page.evaluate(() => ask.setInput('整理新分支的阶段名'));
    await submitAsk(page); await page.waitForFunction(() => !ask.running.value);
    assert.equal(await page.evaluate(() => ask.retrospects.records.value.length), 1);
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).value.title, id), payload.retrospect_title);
    assert.match(JSON.stringify(calls.at(-2).body), /expected_revision/);
    await page.evaluate(id => ask.retrospects.open(id, 'v5'), id);
    const panel = page.getByRole('dialog', { name: payload.retrospect_title }); await panel.waitFor();
    assert.match(await panel.getByRole('button', { name: '选择对比基准' }).getAttribute('aria-description'), /#h2/, 'ASK reorganization retains the generated sample provenance');
    await panel.getByRole('button', { name: '交换对比方向' }).click();
    await panel.getByRole('button', { name: '恢复到画板', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: /已恢复 IMAGE 配方/ }).waitFor();
    assert.equal((await form(page)).prompt, 'blue dress, soft light', 'swapping and restoring uses the exact A sample, not the node cover');
    await panel.getByRole('button', { name: '交换对比方向' }).click();
    assert.equal(await panel.getByRole('img', { name: '新版本', exact: true }).count(), 0, 'renaming the tree does not mark an already viewed stage new again');
    const finalSample = await page.evaluate(id => ask.retrospects.get(id).value.nodes.at(-1).cover, id);
    await page.evaluate(() => { window.originalEnsureFavorite = drawing.ensureFavorite; drawing.ensureFavorite = async () => { throw new Error('synthetic favorite failure'); }; });
    await panel.getByRole('button', { name: '设为定稿', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'synthetic favorite failure' }).waitFor();
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).status, id), 'active');
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).final, id), null);
    await page.evaluate(() => { drawing.ensureFavorite = window.originalEnsureFavorite; delete window.originalEnsureFavorite; });
    await panel.getByRole('button', { name: '设为定稿', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: '已设为定稿并收藏' }).waitFor();
    tree = await page.evaluate(id => ask.retrospects.get(id), id);
    assert.deepEqual(tree.final, { nodeId: 'v5', imageId: finalSample });
    assert.equal(tree.status, 'ended');
    assert.equal(await panel.locator('.continuation-frame').count(), 0);
    assert.equal(await panel.locator('.version-node.final-path').count(), 2);
    assert.equal(await page.evaluate(label => {
      const r = ask.retrospects.records.value[0]; return drawing.snapshot().favorites.some(p => p.id === r.pictureRefs[label].record_id);
    }, finalSample), true);
    await panel.getByRole('button', { name: '撤销演进操作', exact: true }).click();
    await page.waitForFunction(id => ask.retrospects.get(id).status === 'active', id);
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).final, id), null);
    await panel.getByRole('button', { name: '重做演进操作', exact: true }).click();
    await page.waitForFunction(id => ask.retrospects.get(id).status === 'ended', id);
    await panel.getByRole('button', { name: '关闭演进' }).click();
    assert.equal(await page.getByRole('button', { name: '打开画板演进，进行中' }).count(), 0);
    await page.evaluate(() => drawing.run());
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).value.nodes.length, id), 5);
    await page.evaluate(id => ask.setEvolutionStatus(id, 'active'), id);
    let release;
    pending = new Promise(resolve => { release = resolve; });
    const submitted = new Promise(resolve => { arrived = resolve; });
    await page.evaluate(async () => { await drawing.patch({ prompt: 'another attempt', batchCount: 1 }); window.evolutionPending = drawing.run(); });
    await submitted;
    await page.evaluate(() => drawing.createBoard());
    const detached = await page.evaluate(id => ask.retrospects.get(id).revision, id);
    release();
    await page.evaluate(() => window.evolutionPending);
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).revision, id), detached, 'an in-flight result cannot revive a detached tree');
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).value.nodes.length, id), 5);
    await page.evaluate(boardId => drawing.switchBoard(boardId), tree.boardId);
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).status, id), 'active');
    assert.equal(await page.evaluate(id => ask.retrospects.get(id).imageAttached, id), false, 'switching IMAGE boards detaches collection without ending workshops');
    assert.ok(generation >= 7);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
