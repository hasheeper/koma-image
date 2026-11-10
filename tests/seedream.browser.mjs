import test from 'node:test';
import assert from 'node:assert/strict';
import { useNativeFixture, open, bind } from './helpers/native-fixture.mjs';
import { SEEDREAM_LITE, SEEDREAM_PRO, SEEDREAM_55 } from '../src/domain/seedream.ts';
useNativeFixture();

test('Seedream CHAT: generate, edit with history, and persist the real model and unknown quote', async () => {
  const t = await open('seedream-v1', true, SEEDREAM_PRO), { page } = t;
  try {
    await page.waitForFunction(id => chat.snapshot().ready && chat.snapshot().model?.id === id, SEEDREAM_PRO);
    for (const [i, prompt] of ['紫色森林', '改成暖色的阳光'].entries()) {
      await page.locator('#chatPrompt').fill(prompt);
      await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
      await page.waitForFunction(n => !chat.snapshot().busy && chat.snapshot().current.turns.length === n && chat.snapshot().current.turns.every(t => t.versions[t.selectedVersion].status === 'done'), i + 1);
    }
    const posts = t.requests.filter(r => r.method === 'POST');
    assert.equal(posts.length, 2);
    assert.ok(posts.every(r => r.path === '/service/api/v3/images/generations'));
    const first = JSON.parse(posts[0].body), second = JSON.parse(posts[1].body);
    assert.equal(first.model, SEEDREAM_PRO); assert.equal(first.response_format, 'b64_json'); assert.equal(first.size, '2K');
    assert.equal(first.image, undefined); assert.match(second.image, /^data:image\//);
    assert.equal(first.quality, undefined); assert.equal(first.max_cost, undefined);
    assert.ok(t.requests.every(r => !/estimate|quota|token_stats/.test(r.path)));
    const saved = await page.evaluate(async () => {
      const archive = await services.backup.export(), checked = await services.backup.read(archive.blob);
      return { quotes: chat.snapshot().current.turns.map(t => t.versions[0].quote), conversations: checked.conversations.length };
    });
    assert.deepEqual(saved.quotes, [null, null]); assert.ok(saved.conversations > 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Seedream EDIT: local mask uses source plus guide, reviews raw result and applies original-size composition', async () => {
  const t = await open('seedream-v1', true, SEEDREAM_LITE), { page } = t;
  try {
    await page.waitForFunction(() => chat.snapshot().ready);
    await page.evaluate(async () => {
      const c = new OffscreenCanvas(256, 256), g = c.getContext('2d');
      g.fillStyle = '#b43050'; g.fillRect(0, 0, 256, 256);
      await editor.open('image', await c.convertToBlob({ type: 'image/png' }), 'synthetic-source.png');
    });
    await page.waitForFunction(id => editor.snapshot().models.some(m => m.id === id), SEEDREAM_LITE);
    await page.evaluate(async id => {
      editor.setModel(id); editor.patch({ prompt: 'change the selected area' }); editor.setMode('inpaint');
      const c = new OffscreenCanvas(256, 256), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(80, 80, 64, 64);
      await editor.importMask(await c.convertToBlob({ type: 'image/png' }), 'alpha');
      editor.setImageEdit({ edges: { dilate: 0, feather: 0 } });
    }, SEEDREAM_LITE);
    await page.waitForFunction(() => editor.snapshot().edit.canRun);
    await page.locator('#editorRun').click();
    await page.waitForFunction(() => !editor.snapshot().busy && !!editor.snapshot().viewed?.comparison);
    const posts = t.requests.filter(r => r.method === 'POST');
    assert.equal(posts.length, 1);
    const body = JSON.parse(posts[0].body);
    assert.equal(body.image.length, 2);
    assert.ok(body.image.every(i => /^data:image\//.test(i)));
    for (const key of ['mask_image', 'negative_prompt', 'steps', 'scale', 'sampler', 'strength', 'max_cost']) assert.equal(body[key], undefined);
    const result = await page.evaluate(async () => {
      const sourceId = editor.session.baseId, raw = editor.snapshot().viewed;
      const composite = await editor.applyComparison(editor.session.id, raw.id);
      const bitmap = await createImageBitmap(composite.blob), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d'); g.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: c.width, height: c.height, outside: [...g.getImageData(0, 0, 1, 1).data], local: !!composite.params.localComposite,
        rawRetained: editor.session.versions.some(v => v.id === raw.id), sourceRetained: editor.session.versions.some(v => v.id === sourceId) };
    });
    assert.deepEqual(result, { width: 256, height: 256, outside: [180, 48, 80, 255], local: true, rawRetained: true, sourceRetained: true });
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Standard gateway CHAT: declared Seedream controls and quote ceiling reach generation and editing', async () => {
  const studioModels = { [SEEDREAM_LITE]: { provider: 'seedream', editor_family: 'seedream', operations: ['generate', 'edit'], tools: ['image-edit'], image_capabilities: { fields: { size: { options: ['2K', '4K'], default: '2K' } } } } };
  const t = await open('koma-standard-v1', true, '', { studioModels, quoteCost: 3 }, 'https://gateway.example.test/service/v1'), { page } = t;
  try {
    await page.waitForFunction(() => chat.snapshot().ready);
    await page.evaluate(id => chat.setModel(id), SEEDREAM_LITE);
    await page.waitForFunction(id => chat.snapshot().model?.id === id, SEEDREAM_LITE);
    for (const [i, prompt] of ['green forest', 'add sunlight'].entries()) {
      await page.locator('#chatPrompt').fill(prompt);
      await page.waitForFunction(() => chat.snapshot().quote?.cost === 3);
      await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
      await page.waitForFunction(n => !chat.snapshot().busy && chat.snapshot().current.turns.length === n && chat.snapshot().current.turns.every(t => t.versions[t.selectedVersion].status === 'done'), i + 1);
    }
    const posts = t.requests.filter(r => r.method === 'POST' && !r.path.endsWith('/estimate'));
    assert.deepEqual(posts.map(r => r.path), ['/service/v1/studio/image/generate', '/service/v1/image/tools/run']);
    for (const post of posts) { const body = JSON.parse(post.body); assert.equal(body.max_cost, 3); assert.equal(body.model, SEEDREAM_LITE); assert.equal(body.image_options.size, '2K'); }
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Seedream settings: reuse model dialog for 5.5 and persist a manual upstream binding', async () => {
  const t = await open('seedream-v1', true, SEEDREAM_LITE), { page } = t;
  try {
    await page.evaluate(() => location.hash = '#/chat/settings/models');
    await page.getByRole('button', { name: '新增 Seedream 模型', exact: true }).click();
    await page.locator('#modelEntryName').fill('未来型号');
    await page.locator('#modelEntryTemplate').selectOption(SEEDREAM_55);
    assert.match(await page.locator('.model-entry-dialog').textContent(), /API 参数待核验/);
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    await page.locator('.model-entry-dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '展开 未来型号 的来源', exact: true }).click();
    await page.getByRole('button', { name: '为 未来型号 添加来源', exact: true }).click();
    await page.getByRole('combobox', { name: '未来型号 的上游 ID', exact: true }).fill('vendor/new-release');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.reload(); await bind(page);
    assert.equal(await page.evaluate(() => {
      const c = services.connections.configuration, m = c.models.find(m => m.name === '未来型号');
      return m.templateId === 'seedream-5.5' && c.links.test[m.id].id === 'vendor/new-release' && c.links.test[m.id].manual;
    }), true);
    assert.equal(t.requests.filter(r => r.method === 'POST').length, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});


test('Seedream CHAT: a manually bound model can generate when the model directory is blocked', async () => {
  const t = await open('seedream-v1', true, SEEDREAM_LITE), { page } = t;
  let blockedReads = 0;
  try {
    await t.context.route('**/service/api/v3/models', route => {
      blockedReads++;
      return route.abort('failed');
    });
    await page.evaluate(async id => {
      const next = structuredClone(services.connections.configuration);
      next.links.test = { [id]: { id, manual: true, on: true } };
      await services.connections.save(next);
    }, SEEDREAM_LITE);
    await page.reload(); await bind(page);
    await page.waitForFunction(() => chat.snapshot().ready);
    await page.evaluate(id => chat.setModel(id), SEEDREAM_LITE);
    await page.locator('#chatPrompt').fill('synthetic green forest');
    await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
    await page.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns.some(t => t.versions[t.selectedVersion].status === 'done'));
    const posts = t.requests.filter(r => r.method === 'POST');
    assert.ok(blockedReads > 0);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, '/service/api/v3/images/generations');
    assert.equal(JSON.parse(posts[0].body).model, SEEDREAM_LITE);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('connection selector: one gateway entry and a separate Seedream direct protocol', async () => {
  const t = await open('seedream-v1', false), { page } = t;
  try {
    await page.getByRole('button', { name: '配置供应商', exact: true }).click();
    const options = await page.locator('#connectionProtocol option').allTextContents();
    assert.deepEqual(options.filter(text => text.includes('网关')), ['Koma 标准网关']);
    assert.ok(options.includes('Seedream 原生'));
    assert.equal(await page.locator('#connectionProtocol').inputValue(), 'koma-standard-v1');
    assert.equal(t.requests.length, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Seedream connection card: directory limits, model setup and successful requests share one live status', async () => {
  const t = await open('seedream-v1', true, SEEDREAM_LITE), { page } = t;
  let directory = 'cors';
  try {
    await t.context.route('**/service/api/v3/models', route => {
      if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, body: '' });
      return directory === 'cors' ? route.abort('failed') : route.fulfill({ status: 401, json: { error: 'synthetic unauthorized' } });
    });
    await page.reload(); await bind(page);
    const status = page.locator('.conn-card[data-connection="test"] .st');
    const show = async () => {
      await page.evaluate(() => location.hash = '#/chat/settings/connections');
      await page.locator('#settingsPanel[open]').waitFor();
    };
    const expect = async (label, tone = 'wait') => {
      await page.waitForFunction(label => document.querySelector('.conn-card[data-connection="test"] .st')?.textContent.trim() === label, label);
      assert.equal(await status.getAttribute('data-s'), tone);
    };
    const mapping = (id = SEEDREAM_LITE, on = true) => page.evaluate(async ({ model, id, on }) => {
      const next = structuredClone(services.connections.configuration);
      next.links.test = { [model]: { id, manual: true, on } };
      await services.connections.save(next);
    }, { model: SEEDREAM_LITE, id, on });
    await show();
    await expect('等待配置');
    await mapping();
    await expect('已配置 · 1 个模型');
    assert.equal(await page.locator('.conn-model-count').textContent(), '1');
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect('已配置 · 1 个模型');
    assert.equal(t.requests.filter(r => r.method === 'POST').length, 0);
    await page.locator('#settingsPanel .set-back').click();
    await page.evaluate(id => chat.setModel(id), SEEDREAM_LITE);
    await page.locator('#chatPrompt').fill('synthetic forest');
    await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
    await page.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns.some(t => t.versions[t.selectedVersion].status === 'done'));
    await show();
    await expect('连接成功 · 1 个模型', 'ok');
    await mapping(SEEDREAM_LITE, false);
    await expect('等待配置');
    await mapping();
    await expect('连接成功 · 1 个模型', 'ok');
    await mapping('new-unverified-model');
    await expect('已配置 · 1 个模型');
    await mapping();
    await expect('连接成功 · 1 个模型', 'ok');
    await page.evaluate(() => services.vault.setKey('test-key', 'synthetic-replacement', false));
    await expect('已配置 · 1 个模型');
    directory = 'unauthorized';
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect('鉴权失败（401），请检查 API Key', 'err');
    await page.evaluate(() => services.vault.removeKey('test-key'));
    await expect('等待配置');
    assert.equal(await status.getAttribute('title'), '未配置 Key');
    assert.equal(t.requests.filter(r => r.method === 'POST').length, 1);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});
