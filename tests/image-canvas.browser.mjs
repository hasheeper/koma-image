import test from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, addImage, route, stored, toolReply, textReply, submitAsk, hosts, askDraft, applyDraft } from './helpers/ask-fixture.mjs';
useAskFixture();

async function setCanvas(page, enabled) {
  await route(page, '#/image/settings/general');
  const toggle = page.getByRole('switch', { name: '画布协创 BETA', exact: true });
  if (await toggle.isChecked() !== enabled) await page.locator('.s-toggle[title="画布协创 BETA"]').click();
  await page.waitForFunction(value => ask_presentation.canvas.enabled.value === value, enabled);
  await route(page, '#/image');
}
const panelSwitch = page => page.getByRole('group', { name: '侧栏内容', exact: true });
async function openImagePanel(page, label) {
  const grip = page.getByRole('button', { name: '展开创作面板', exact: true });
  if (await grip.isVisible()) await grip.click();
  const button = panelSwitch(page).getByRole('button', { name: label, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
}

async function enter(page) {
  await bind(page);
  await setCanvas(page, true);
  await page.locator('.canvas-ask #askDrawer').waitFor();
}

test('[core] IMAGE canvas: picture references uncover the canvas and reopen the same ASK conversation', async t => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, touch: true, width: 390, ask: askSettings({ images: false }) });
  t.after(() => f.context.close());
  const p = f.page; await bind(p); await setCanvas(p, true);
  const first = await addImage(p, 'first picture'), second = await addImage(p, 'second picture');
  await openImagePanel(p, 'ASK');
  f.llm.push(textReply('请看 #h1。'));
  await p.locator('#askPrompt').fill('查看第一张'); await submitAsk(p);
  await p.locator('.ask-turn[data-status="done"]').waitFor();
  await p.locator('#askPrompt').fill('unfinished followup');
  const conversation = await p.evaluate(() => ask.conversationId.value);
  for (const width of [390, 900, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    await p.evaluate(id => drawing.show(drawing.snapshot().history.find(item => item.id === id), true), second);
    await p.locator('.ask-turn').getByRole('button', { name: '#h1', exact: true }).click();
    await p.waitForFunction(id => drawing.snapshot().current?.id === id, first);
    if (width < 1080) {
      await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' });
      await p.getByRole('button', { name: '浏览历史与收藏', exact: true }).click();
      await p.getByRole('dialog', { name: '历史与收藏', exact: true }).waitFor();
      await p.keyboard.press('Escape');
      await openImagePanel(p, 'ASK');
    }
    await p.locator('#askPrompt').waitFor();
    assert.equal(await p.locator('#askPrompt').inputValue(), 'unfinished followup');
    assert.equal(await p.evaluate(() => ask.conversationId.value), conversation);
  }
  assert.deepEqual(f.errors, []);
});

test('IMAGE canvas: settings entry, shared sidebar, width preference and responsive panels', async () => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    const p = f.page;
    await bind(p);
    await p.evaluate(async () => { await drawing.patch({ prompt: 'my current prompt' }); ask.setInput('unfinished question'); window.originalForm = document.getElementById('form'); window.originalAsk = document.getElementById('askDrawer'); });
    await enter(p);
    assert.equal(await p.locator('#prompt').isVisible(), false);
    assert.equal(await p.locator('#goBtn').isVisible(), true);
    await p.getByRole('button', { name: '表单', exact: true }).click();
    await p.locator('#prompt').fill('edited from sidebar');
    assert.equal(await p.locator('#askPrompt').isVisible(), false);
    assert.equal(await p.locator('.canvas-form-drawer').count(), 0);
    await p.locator('#parametersToggle').click();
    await p.locator('#seed').fill('678');
    await p.locator('#seed').press('Tab');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('#prompt').isVisible(), true, 'Escape first closes the form parameters');
    assert.equal(await p.evaluate(() => drawing.snapshot().form.seed), '678');
    await p.keyboard.press('Control+j');
    await p.waitForFunction(() => document.activeElement?.id === 'askPrompt');
    assert.equal(await p.locator('#askPrompt').inputValue(), 'unfinished question');
    await p.locator('#askPrompt').fill('ASK stays usable');
    await panelSwitch(p).getByRole('button', { name: '表单', exact: true }).click();
    assert.equal(await p.locator('dialog:modal').count(), 0);
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).click();
    assert.equal(await p.locator('#prompt').isVisible(), false);
    await p.getByRole('button', { name: '调整型号与画幅' }).click();
    await p.locator('#width').fill('768'); await p.locator('#width').press('Tab');
    await p.keyboard.press('Escape');
    const split = p.getByRole('separator', { name: '调整侧栏宽度' });
    await split.focus(); await split.press('ArrowLeft');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('koma.image.layout.v1')).ratio === .41);
    for (let step = 0; step < 8; step++) await split.press('Shift+ArrowRight');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('koma.image.layout.v1')).ratio === .25);
    await split.press('ArrowRight');
    assert.equal((await stored(p, 'koma.image.layout.v1')).ratio, .25);
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).click();
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    assert.equal(await split.isVisible(), false);
    assert.equal(await panelSwitch(p).locator('[aria-pressed="true"]').count(), 0);
    assert.equal(await p.locator('#goBtn').isVisible(), true);
    await route(p, '#/chat'); await route(p, '#/image');
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    await panelSwitch(p).getByRole('button', { name: '表单', exact: true }).click();
    await p.locator('#prompt').waitFor();
    assert.equal((await stored(p, 'koma.image.layout.v1')).ratio, .25);
    await panelSwitch(p).getByRole('button', { name: '表单', exact: true }).click();
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    assert.equal(await panelSwitch(p).locator('[aria-pressed="true"]').count(), 0);
    await p.keyboard.press('Control+j'); await p.locator('#askPrompt').waitFor();
    for (const destination of ['home', 'chat', 'tags', 'edit']) {
      await route(p, `#/${destination}`);
      await p.waitForFunction(() => !ask_presentation.canvas.active.value);
      assert.equal(await p.locator('#askIsland[data-collaboration]').count(), destination === 'edit' || destination === 'chat' ? 1 : 0, 'EDIT and CHAT dock ASK in their own trays');
      await route(p, '#/image'); await p.locator('.canvas-ask #askDrawer').waitFor();
    }
    await p.setViewportSize({ width: 900, height: 900 });
    await p.waitForFunction(() => ask_presentation.canvas.active.value && ask_presentation.canvas.compact.value);
    assert.equal(await split.isVisible(), false);
    assert.equal(await p.locator('#askPrompt').isVisible(), true);
    await p.setViewportSize({ width: 1080, height: 900 });
    await p.locator('.canvas-ask #askDrawer').waitFor();
    assert.deepEqual(await p.evaluate(() => ({ form: originalForm === document.getElementById('form'), ask: originalAsk === document.getElementById('askDrawer'), prompt: drawing.snapshot().form.prompt, width: drawing.snapshot().form.width, question: ask.input.value })), { form: true, ask: true, prompt: 'edited from sidebar', width: 768, question: 'ASK stays usable' });
    await setCanvas(p, false);
    await p.locator('.shell:not(.canvas-layout) #form').waitFor();
    assert.equal(await p.locator('#prompt').inputValue(), 'edited from sidebar');
    await enter(p);
    await p.reload(); await p.locator('.canvas-ask #askDrawer').waitFor();
    assert.deepEqual(await stored(p, 'koma.image.layout.v1'), { enabled: true, ratio: .25, filmstripOpen: true });
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('IMAGE canvas: long history scrolls independently in the board and node preview', async t => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  t.after(() => f.context.close());
  const p = f.page; await enter(p);
  const ids = [];
  for (let i = 0; i < 16; i++) ids.push(await addImage(p, `picture ${i + 1}`));
  await p.evaluate(async () => { await drawing.patch({ prompt: 'keep this form', seed: '456' }); });
  const original = await p.evaluate(() => ({ prompt: drawing.snapshot().form.prompt, seed: drawing.snapshot().form.seed }));
  const tray = p.locator('.canvas-history .tray');
  async function scrollHistory() {
    await tray.evaluate(el => { el.scrollTop = 0; });
    const current = await p.evaluate(() => drawing.snapshot().current?.id);
    await tray.hover();
    await p.mouse.wheel(0, 2400);
    await p.waitForFunction(() => document.querySelector('.canvas-history .tray').scrollTop > 0);
    assert.equal(await p.evaluate(() => drawing.snapshot().current?.id), current, 'scrolling does not switch the preview');
    await tray.locator(`.tile[data-id="${ids[0]}"]`).click();
    await p.waitForFunction(id => drawing.snapshot().current?.id === id, ids[0]);
    assert.deepEqual(await p.evaluate(() => ({ prompt: drawing.snapshot().form.prompt, seed: drawing.snapshot().form.seed })), original);
  }
  await scrollHistory();
  f.llm.push(toolReply('read', 'get_recipe_clusters', {}), toolReply('tree', 'show_retrospect', {
    retrospect_title: '历史浏览', nodes: [{ id: 'v1', label: '预览阶段', image_ids: ['#h1', '#h16'], primary_id: '#h16' }], edges: [],
  }), textReply('已整理。'));
  await p.locator('#askPrompt').fill('整理历史'); await submitAsk(p);
  const panel = p.locator('.canvas-graph .stage-panel[open]'); await panel.waitFor();
  await p.waitForFunction(() => !ask.running.value);
  await panel.locator('[data-node="v1"] .node-media').dblclick();
  await p.waitForFunction(() => ask_presentation.canvas.view.value === 'node');
  await scrollHistory();
  assert.equal(await p.evaluate(() => ask_presentation.canvas.view.value), 'image');
  assert.deepEqual(f.errors, []);
});

test('IMAGE canvas: history, favorites, reference and confirmed draft generate through the original form', async () => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    const p = f.page; await enter(p);
    const id = await addImage(p, 'a red house');
    await p.evaluate(async () => { const item = drawing.snapshot().history[0]; drawing.show(item, true); await drawing.toggleFavorite(); await drawing.patch({ prompt: 'current form', model: 'nai-diffusion-5-full' }); });
    await p.getByRole('tab', { name: /^收藏，/ }).click();
    await p.setViewportSize({ width: 1080, height: 900 });
    await p.getByRole('button', { name: '图片历史选项', exact: true }).click();
    await p.getByRole('menuitemradio', { name: /^历史，/ }).click();
    await p.getByRole('button', { name: '图片历史选项', exact: true }).click();
    await p.getByRole('menuitemradio', { name: /^收藏，/ }).click();
    await p.locator(`.canvas-history .tile[data-id="${id}"]`).click();
    assert.equal(await p.evaluate(() => drawing.snapshot().form.prompt), 'current form');
    await p.getByRole('button', { name: '图片参数', exact: true }).click();
    const parameters = p.getByRole('dialog', { name: '图片参数', exact: true });
    await parameters.waitFor();
    assert.match(await parameters.getByRole('button', { name: '复制 Seed', exact: true }).textContent(), /7/);
    await p.getByRole('button', { name: '图片参数', exact: true }).click();
    assert.equal(await parameters.isVisible(), false);
    await p.getByRole('button', { name: '图片历史选项', exact: true }).click();
    await p.getByRole('menuitem', { name: '收起图片栏', exact: true }).click();
    assert.equal(await p.locator('.canvas-history .tile').first().isVisible(), false);
    await p.getByRole('button', { name: '图片历史选项', exact: true }).click();
    await p.getByRole('menuitem', { name: '展开图片栏', exact: true }).click();
    await panelSwitch(p).getByRole('button', { name: '表单', exact: true }).click();
    await p.getByRole('button', { name: 'Ask 这张图', exact: true }).click();
    await p.locator('#askPrompt').waitFor();
    await p.waitForFunction(() => /#h\d/.test(ask.anchor.value ?? ''));
    await askDraft(p, f.llm, [{ kind: 'prompt_patch', target: 'image.prompt', mode: 'rewrite', text: 'blue house' }], '改为蓝色房子');
    let generations = 0;
    const png = await p.evaluate(async () => { const c = new OffscreenCanvas(64,64); c.getContext('2d').fillRect(0,0,64,64); return [...new Uint8Array(await (await c.convertToBlob()).arrayBuffer())]; });
    await p.route(`https://${hosts.image}/**`, r => {
      if (!/\/(generate|generate-image)$/.test(new URL(r.request().url()).pathname)) return r.fallback();
      generations++; return r.fulfill({ contentType: 'image/png', body: Buffer.from(png) });
    });
    await applyDraft(p);
    assert.equal(generations, 0);
    assert.equal(await p.locator('#prompt').isVisible(), false);
    await p.locator('#goBtn').click();
    await p.waitForFunction(() => !drawing.snapshot().busy && drawing.snapshot().history.length === 2);
    assert.equal(generations, 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('IMAGE canvas: embedded evolution, inspect/back, staged load and manual generation preserve view and target', async () => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  try {
    const p = f.page; await enter(p);
    await p.waitForFunction(() => drawing.snapshot().models.some(m => m.id === 'nai-diffusion-5-full'));
    const png = await p.evaluate(async () => {
      const { DEFAULTS } = await import('/src/domain/drawing.ts'), { seedHistory } = await import('/tests/helpers/drawing-history.mjs');
      const c = new OffscreenCanvas(128,192), g = c.getContext('2d'); g.fillStyle = '#557b9c'; g.fillRect(0,0,128,192);
      const blob = await c.convertToBlob();
      for (const prompt of ['blue dress', 'red dress']) await seedHistory({ drawing, home }, blob, { width:128,height:192 }, { ...structuredClone(DEFAULTS), boardId: drawing.snapshot().activeBoardId, basePrompt: prompt, baseNegative:'lowres', localCharacters:[] });
      await drawing.patch({ model:'nai-diffusion-5-full', prompt:'CURRENT FORM', seed:'456', batchCount:1 });
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    const graph = { retrospect_title:'协创演进', nodes:[{ id:'v1', label:'基底阶段', image_ids:['#h1','#h2'], primary_id:'#h2' }], edges:[] };
    const branch = (label, text) => ({ base_image_id:'#h1', label, description:'从基底尝试新的构图', steps:[{kind:'prompt_patch',target:'image.prompt',mode:'rewrite',text}] });
    f.llm.push(toolReply('read','get_recipe_clusters',{}), toolReply('tree','show_retrospect',graph), toolReply('branch','stage_evolution_branch',branch('窗边','blue dress, window')), textReply('预设已准备好。'));
    await p.locator('#askPrompt').fill('整理演进并准备一个窗边分支'); await submitAsk(p);
    await p.waitForFunction(() => !ask.running.value && ask.entries.value.length);
    await p.waitForFunction(() => ask.retrospects.records.value[0]?.value.nodes.length === 2);
    const panel = p.locator('.canvas-graph .stage-panel[open]'); await panel.waitFor();
    assert.equal(await p.locator('dialog:modal').count(), 0);
    await p.locator('#askPrompt').fill('继续写问题');
    const initial = await p.evaluate(() => { window.originalGraph = document.querySelector('.stage-panel'); return { board: drawing.snapshot().activeBoardId, tree: ask.retrospects.records.value[0].id, cursor: ask.retrospects.records.value[0].cursor }; });
    await panel.locator('[data-node="v1"] .node-media').dblclick();
    await p.waitForFunction(() => ask_presentation.canvas.view.value === 'node');
    assert.equal(await p.locator('.canvas-filmstrip .gallery').isVisible(), true);
    assert.equal(await p.evaluate(() => drawing.snapshot().form.prompt), 'CURRENT FORM');
    await p.getByRole('button', { name: '返回演进', exact: true }).click();
    await panel.locator('[data-node="v2"] .node-media').click();
    const recipe = p.locator('#canvasRecipe .recipe-inspector');
    await recipe.waitFor();
    assert.equal(await p.locator('#askPrompt').isVisible(), false);
    assert.equal(await p.getByRole('button', { name: '调整型号与画幅' }).isVisible(), false);
    await recipe.evaluate(el => { window.originalRecipe = el; });
    await panelSwitch(p).getByRole('button', { name: '配方', exact: true }).click();
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    assert.equal(await panelSwitch(p).locator('[aria-pressed="true"]').count(), 0);
    await panelSwitch(p).getByRole('button', { name: '配方', exact: true }).click();
    await recipe.waitFor();
    await p.getByRole('group', { name: '画布视图', exact: true }).getByRole('button', { name: '画板', exact: true }).click();
    await p.locator('#canvasForm #prompt').waitFor();
    assert.equal(await recipe.isVisible(), false);
    await p.getByRole('group', { name: '画布视图', exact: true }).getByRole('button', { name: '演进', exact: true }).click();
    await recipe.waitFor();
    assert.equal(await p.evaluate(() => originalRecipe === document.querySelector('#canvasRecipe .recipe-inspector')), true);
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).click();
    assert.equal(await p.locator('#askPrompt').inputValue(), '继续写问题');
    await panelSwitch(p).getByRole('button', { name: '配方', exact: true }).click();
    await recipe.getByRole('button', { name: '关闭配方', exact: true }).focus();
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.activeElement?.id === 'canvasContextToggle');
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    await panelSwitch(p).getByRole('button', { name: '配方', exact: true }).click();
    await recipe.getByRole('button', { name: '载入画板', exact: true }).click();
    assert.equal(await p.evaluate(() => drawing.snapshot().form.prompt), 'blue dress, window');
    assert.equal(await p.locator('#prompt').isVisible(), false);
    let generations = 0;
    await p.route(`https://${hosts.image}/**`, r => {
      if (!/\/(generate|generate-image)$/.test(new URL(r.request().url()).pathname)) return r.fallback();
      generations++; return r.fulfill({ contentType:'image/png', body: Buffer.from(png) });
    });
    assert.equal(generations, 0);
    await p.locator('#goBtn').click();
    await p.waitForFunction(() => !drawing.snapshot().busy && ask.retrospects.records.value[0].value.nodes[1].kind !== 'staged');
    assert.equal(generations, 1);
    assert.equal(await p.evaluate(() => ask_presentation.canvas.view.value), 'graph');
    await recipe.getByRole('button', { name: '关闭配方', exact: true }).click();
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).click();
    await p.locator('#askPrompt').waitFor();
    await panel.locator('[data-node="v2"] .node-media').dblclick();
    await p.waitForFunction(() => ask_presentation.canvas.view.value === 'node');
    f.llm.push(toolReply('read-again','get_recipe_clusters',{}),toolReply('next','stage_evolution_branch',branch('雨夜','blue dress, rain')), textReply('另一个预设已准备。'));
    await p.locator('#askPrompt').fill('再挂一个雨夜分支'); await submitAsk(p);
    await p.waitForFunction(() => !ask.running.value && ask.retrospects.records.value[0].value.nodes.length === 3);
    assert.equal(await p.evaluate(() => ask_presentation.canvas.view.value), 'node', 'streaming branches do not steal image inspection');
    await route(p, '#/chat'); await p.waitForFunction(() => !ask_presentation.canvas.active.value);
    assert.equal(await p.locator('dialog:modal').count(), 0);
    await route(p, '#/image'); await panel.waitFor();
    assert.equal(await p.evaluate(() => originalGraph === document.querySelector('.stage-panel')), true);
    assert.equal(await p.evaluate(() => drawing.snapshot().activeBoardId), initial.board);
    await p.setViewportSize({ width: 390, height: 844 });
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).click();
    await p.getByRole('button', { name: '返回演进', exact: true }).click();
    assert.equal(await p.locator('.canvas-bottom').getByRole('button', { name: '配方', exact: true }).count(), 0);
    await panel.locator('[data-node="v3"] .node-media').click();
    await recipe.waitFor();
    await recipe.getByRole('button', { name: '载入画板', exact: true }).click();
    // The phone recipe sheet keeps Generate available after loading the staged branch.
    await p.locator('#goBtn').waitFor();
    await p.locator('#goBtn').click();
    await p.waitForFunction(() => !drawing.snapshot().busy && ask.retrospects.records.value[0].value.nodes[2].kind !== 'staged');
    assert.equal(generations, 2);
    await panel.waitFor();
    await p.setViewportSize({ width: 1440, height: 900 });
    await setCanvas(p, false);
    await p.evaluate(id => ask.retrospects.open(id), initial.tree);
    await p.locator('.stage-panel:modal').waitFor();
    await p.getByRole('button', { name:'关闭演进', exact:true }).click();
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('IMAGE canvas: switching the sidebar keeps ASK running and explicitly invoking ASK reveals the same conversation', async () => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, ask: askSettings({ images: false }) });
  let complete;
  try {
    const p = f.page; await enter(p);
    const pending = new Promise(resolve => { complete = resolve; });
    f.llm.push({ ...textReply('保留这条回复。'), wait: pending });
    await p.locator('#askPrompt').fill('请检查当前画板'); await submitAsk(p);
    await p.waitForFunction(() => ask.running.value);
    const conversation = await p.evaluate(() => ask.conversationId.value);
    await panelSwitch(p).getByRole('button', { name: '表单', exact: true }).click();
    await p.locator('#prompt').fill('working while ASK replies');
    assert.equal(await p.evaluate(() => ask.running.value), true);
    complete();
    await p.waitForFunction(() => !ask.running.value && ask.entries.value.some(e => e.type === 'turn'));
    assert.equal(await p.locator('#prompt').isVisible(), true, 'finishing a reply must not steal the sidebar');
    await p.locator('#prompt').press('Control+k');
    await p.waitForFunction(() => document.activeElement?.id === 'askPrompt');
    assert.equal(await p.evaluate(() => ask.conversationId.value), conversation);
    assert.equal(await p.evaluate(() => ask.inline.value.text), 'working while ASK replies');
    await panelSwitch(p).getByRole('button', { name: '表单', exact: true }).click();
    await p.evaluate(() => ask.show({ question: '接着讨论' }));
    await p.locator('#askPrompt').waitFor();
    assert.equal(await p.locator('#askPrompt').inputValue(), '接着讨论');
    assert.match(await p.locator('#askDrawer').textContent(), /保留这条回复/);
    assert.deepEqual(f.errors, []);
  } finally { complete?.(); await f.context.close(); }
});


test('IMAGE canvas: phone sheet switches panels, collapses back to the canvas and reuses generation and ASK', async () => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, touch: true, width: 390, ask: askSettings({ images: false }) });
  try {
    const p = f.page; await bind(p); await setCanvas(p, true);
    await p.getByRole('button', { name: '浏览历史与收藏', exact: true }).tap();
    const library = p.getByRole('dialog', { name: '历史与收藏', exact: true });
    await library.getByRole('tab', { name: /^收藏，/ }).tap();
    assert.equal(await library.getByText('暂无收藏', { exact: true }).isVisible(), true);
    await library.getByRole('tab', { name: /^历史，/ }).tap();
    assert.equal(await library.getByText('生成的图会排在这里', { exact: true }).isVisible(), true);
    await library.getByRole('button', { name: '收起历史与收藏', exact: true }).tap();
    await addImage(p, 'phone image');
    await p.evaluate(() => { window.phoneForm = document.getElementById('form'); window.phoneAsk = document.getElementById('askDrawer'); });
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    assert.equal(await p.locator('#goBtn').isVisible(), true);
    // The grip opens the last pane; the sheet's own switch selects form or ASK.
    await openImagePanel(p, '表单');
    await p.locator('#prompt').fill('edited on phone');
    await p.locator('#width').fill('768'); await p.locator('#width').press('Tab');
    assert.equal(await p.locator('#goBtn').isVisible(), true, 'the form pane keeps Generate on the bar above the sheet');
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).tap();
    assert.equal(await p.locator('.canvas-layout').getAttribute('inert'), null);
    await p.locator('#goBtn').waitFor({ state: 'hidden' }); // ASK has its own input: the bar fades away
    assert.equal(await p.locator('#askDrawer').getAttribute('aria-modal'), 'false');
    await p.locator('#askPrompt').fill('phone question');
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).tap();
    await p.locator('.canvas-sidebar').waitFor({ state: 'hidden' }); // the tray leaves before display:none
    await p.locator('#goBtn').waitFor();
    await openImagePanel(p, 'ASK');
    assert.equal(await p.locator('#askPrompt').inputValue(), 'phone question');
    for (const workspace of ['chat', 'edit', 'image', 'chat', 'edit', 'image']) {
      await route(p, `#/${workspace}`);
      await p.waitForFunction(workspace => app_shell.router.route.value.workspace === workspace, workspace);
      await p.locator('#askPrompt').waitFor({ state: 'hidden' });
      const panels = p.getByRole('group', { name: workspace === 'image' ? '侧栏内容' : workspace === 'edit' ? '编辑侧栏内容' : '对话侧栏内容', exact: true });
      assert.equal(await panels.locator('[aria-pressed="true"]').count(), 0, `${workspace} opens on its canvas after navigation`);
      if (workspace === 'image') await openImagePanel(p, 'ASK');
      else if (workspace === 'chat') await p.getByRole('button', { name: '打开 ASK', exact: true }).tap();
      else {
        await p.getByRole('button', { name: '展开创作面板', exact: true }).tap();
        const askButton = panels.getByRole('button', { name: 'ASK', exact: true });
        if (await askButton.getAttribute('aria-pressed') !== 'true') await askButton.tap();
      }
      assert.equal(await p.locator('#askPrompt').inputValue(), 'phone question', 'explicitly opening ASK restores the same unsent question');
    }
    await p.setViewportSize({ width: 844, height: 390 });
    await panelSwitch(p).getByRole('button', { name: '表单', exact: true }).tap();
    assert.equal(await p.locator('#prompt').inputValue(), 'edited on phone');
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.getByRole('separator', { name: '调整侧栏宽度' }).waitFor();
    assert.deepEqual(await p.evaluate(() => ({ form: phoneForm === document.getElementById('form'), ask: phoneAsk === document.getElementById('askDrawer'), width: drawing.snapshot().form.width })), { form: true, ask: true, width: 768 });
    await p.setViewportSize({ width: 390, height: 844 });
    await setCanvas(p, false);
    await p.locator('.shell:not(.canvas-layout) #form').waitFor();
    assert.equal(await p.evaluate(() => ask_presentation.canvas.enabled.value), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('IMAGE canvas: phone history browser shares pictures, selects without changing the form and restores desktop history', async () => {
  const f = await open('/#/image', { ready: '.switcher', standard: true, touch: true, width: 390, ask: askSettings({ images: false }) });
  try {
    const p = f.page; await bind(p); await setCanvas(p, true);
    const first = await addImage(p, 'first phone picture');
    await p.evaluate(async () => { drawing.show(drawing.snapshot().history[0], true); await drawing.toggleFavorite(); await drawing.patch({ prompt: 'keep this form', seed: '456' }); });
    const second = await addImage(p, 'second phone picture', '#437e8f');
    const original = await p.evaluate(() => { window.historyTray = document.getElementById('tray'); return { prompt: drawing.snapshot().form.prompt, seed: drawing.snapshot().form.seed }; });
    const toggle = p.getByRole('button', { name: '浏览历史与收藏', exact: true });
    const library = p.getByRole('dialog', { name: '历史与收藏', exact: true });
    await toggle.tap();
    await library.waitFor();
    assert.equal(await library.locator('.tile[data-id]').count(), 2);
    assert.equal(await p.evaluate(() => document.querySelector('.library-peek')?.hidden), true, 'touch browsing has no hover preview');
    await library.locator(`.tile[data-id="${first}"]`).tap();
    await p.waitForFunction(id => drawing.snapshot().current?.id === id && !document.querySelector('#mobileImageLibrary').open, first);
    assert.deepEqual(await p.evaluate(() => ({ prompt: drawing.snapshot().form.prompt, seed: drawing.snapshot().form.seed })), original);
    await toggle.tap();
    await library.getByRole('tab', { name: /^收藏，/ }).tap();
    assert.equal(await library.locator('.tile[data-id]').count(), 1);
    await library.locator('.tile[data-id]').tap();
    await toggle.tap();
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('#mobileImageLibrary').open);
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'canvasHistoryToggle');
    await toggle.tap();
    await library.getByRole('tab', { name: /^历史，/ }).tap();
    await p.setViewportSize({ width: 844, height: 390 });
    assert.equal(await library.isVisible(), true);
    await library.locator(`.tile[data-id="${second}"]`).tap();
    await toggle.tap();
    await p.evaluate(() => ask.show());
    await p.locator('#askPrompt').waitFor();
    assert.equal(await library.isVisible(), false);
    await panelSwitch(p).getByRole('button', { name: 'ASK', exact: true }).tap();
    await toggle.tap();
    await route(p, '#/chat'); await route(p, '#/image');
    assert.equal(await library.isVisible(), false);
    await toggle.tap();
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.locator('.canvas-history .tile[data-id]').first().waitFor();
    assert.equal(await library.isVisible(), false);
    assert.equal(await p.evaluate(() => historyTray === document.getElementById('tray')), true);
    assert.equal((await stored(p, 'koma.image.layout.v1')).filmstripOpen, true);
    await p.getByRole('button', { name: '图片历史选项', exact: true }).click();
    await p.getByRole('menuitem', { name: '收起图片栏', exact: true }).click();
    await p.setViewportSize({ width: 390, height: 844 });
    await toggle.tap();
    await library.getByRole('button', { name: '收起历史与收藏', exact: true }).tap();
    await p.setViewportSize({ width: 1440, height: 900 });
    assert.equal((await stored(p, 'koma.image.layout.v1')).filmstripOpen, false);
    assert.equal(await p.locator('.canvas-history').isVisible(), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});
