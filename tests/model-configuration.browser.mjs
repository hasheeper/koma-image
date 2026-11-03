import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useNativeFixture, origin, open, bind } from './helpers/native-fixture.mjs';
useNativeFixture();
const settings = async (page, section = 'models') => {
  await page.evaluate(section => location.hash = `#/chat/settings/${section}`, section);
  await page.locator('#settingsPanel[open]').waitFor();
};
const saveModel = async page => {
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await page.locator('.model-entry-dialog').waitFor({ state: 'hidden' });
};
const dismissNotices = page => page.evaluate(() => ui.notices.value.forEach(n => ui.dismissNotice(n.id)));
const editParameters = async (page, model, values, supplier = '模拟协议') => {
  await page.getByRole('button', { name: `${model} · ${supplier} 参数`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '来源参数', exact: true });
  for (const [key, value] of Object.entries(values)) {
    const field = dialog.getByRole('group', { name: key, exact: true });
    await field.getByRole('button', { name: `${key} 字段设置`, exact: true }).click();
    const options = field.getByLabel('可选值', { exact: true });
    if (await options.count()) { await options.fill(value); await options.press('Enter'); }
    const input = field.getByLabel('默认值', { exact: true });
    if (await input.evaluate(el => el.tagName === 'SELECT')) await input.selectOption(value);
    else await input.fill(value);
  }
  await dialog.getByRole('button', { name: '保存参数', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
};

test('model settings: manage presets without a connection, persist deletion and sync another tab', async () => {
  const t = await open('openai-images-v1', false), { page } = t;
  try {
    await settings(page);
    assert.equal(await page.locator('.sm-model').count(), 18);
    await page.getByRole('button', { name: '新增 Gemini 模型', exact: true }).click();
    await page.locator('#modelEntryName').fill('我的香蕉');
    await page.locator('#modelEntryTemplate').selectOption('gemini-3-pro-image');
    await saveModel(page);
    const id = await page.evaluate(() => services.connections.configuration.models.find(m => m.name === '我的香蕉').id);
    assert.match(await page.locator(`[data-model="${id}"]`).textContent(), /未配置/);
    const second = await t.context.newPage();
    await second.goto(origin + '/#/chat/settings/models');
    await second.getByRole('button', { name: '编辑 我的香蕉', exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑 我的香蕉', exact: true }).click();
    await page.locator('#modelEntryName').fill('我的香蕉改名');
    await saveModel(page);
    await second.getByRole('button', { name: '编辑 我的香蕉改名', exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑 GPT Image 2', exact: true }).click();
    await page.getByRole('button', { name: '删除 GPT Image 2', exact: true }).click();
    await page.locator('#confirmSheet').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.locator('.model-entry-dialog').isVisible(), true);
    await page.getByRole('button', { name: '删除 GPT Image 2', exact: true }).click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('.model-entry-dialog').waitFor({ state: 'hidden' });
    await page.locator('[data-model="gpt-image-2"]').waitFor({ state: 'detached' });
    await second.locator('[data-model="gpt-image-2"]').waitFor({ state: 'detached' });
    await page.reload(); await bind(page);
    await page.getByRole('button', { name: '编辑 我的香蕉改名', exact: true }).waitFor();
    assert.equal(await page.locator('[data-model="gpt-image-2"]').count(), 0);
    assert.equal(await page.locator('[data-model^="nai-"]').count(), 5);
    assert.equal(await page.locator('[data-model^="nai-"] button[aria-label^="删除"]').count(), 0);
    assert.deepEqual(t.errors, []); assert.equal(t.requests.length, 0);
  } finally { await t.context.close(); }
});

test('manual model CRUD: absent aliases, edited defaults, exact request, history retention and deletion of current selection', async () => {
  for (const profile of ['openai-images-v1', 'gemini-native-v1']) {
    const t = await open(profile), { page } = t;
    try {
      await settings(page);
      const gemini = profile === 'gemini-native-v1';
      if (gemini) await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: `新增 ${gemini ? 'Gemini' : 'GPT'} 模型`, exact: true }).click();
      await page.locator('#modelEntryName').fill('渠道模型');
      if (gemini) await page.locator('#modelEntryTemplate').selectOption('gemini-3-pro-image');
      const alias = 'vendor/自定义 render?x=1@relay';
      assert.equal(await page.locator('.model-entry-dialog .model-sources').count(), 0);
      await saveModel(page);
      const id = await page.evaluate(() => services.connections.configuration.models.find(m => m.name === '渠道模型').id);
      await page.getByRole('button', { name: '展开 渠道模型 的来源', exact: true }).click();
      const row = page.locator(`[data-model="${id}"]`);
      await row.getByRole('button', { name: '为 渠道模型 添加来源', exact: true }).click();
      await row.getByRole('combobox', { name: '渠道模型 的上游 ID', exact: true }).fill(alias);
      await row.getByRole('button', { name: '保存来源', exact: true }).click();
      await row.locator('.sm-new-source').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '编辑 渠道模型', exact: true }).click();
      await page.locator('#modelEntryName').fill('渠道模型已改名');
      await saveModel(page);
      await editParameters(page, '渠道模型已改名', gemini ? { image_size: '4K', aspect_ratio: '7:5' } : { quality: 'vendor-quality', size: '2048x1536' });
      await page.waitForFunction(id => chat.snapshot().models.some(m => m.id === id), id);
      await page.evaluate(id => chat.setModel(id), id);
      // The supplier list also exposes manual IDs absent from its directory.
      await settings(page, 'connections');
      await page.locator('.conn-models[data-kind="image"]').click();
      await page.getByRole('tab', { name: '可用', exact: true }).click();
      assert.match(await page.locator('#modelListDialog').textContent(), /渠道模型已改名/);
      assert.ok((await page.locator('#modelListDialog').textContent()).includes(alias));
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('#settingsPanel .set-back').click(); await dismissNotices(page);
      await page.locator('#chatPrompt').fill('合成图片模拟请求');
      await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
      await page.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns[0]?.versions[0].status === 'done');
      const posts = t.requests.filter(r => r.method === 'POST'); assert.equal(posts.length, 1);
      const body = JSON.parse(posts[0].body);
      if (gemini) {
        assert.ok(posts[0].path.endsWith(`/models/${encodeURIComponent(alias)}:generateContent`));
        assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '7:5', imageSize: '4K' });
      } else {
        assert.equal(body.model, alias); assert.equal(body.quality, 'vendor-quality'); assert.equal(body.size, '2048x1536');
      }
      await settings(page);
      await page.getByRole('button', { name: '编辑 渠道模型已改名', exact: true }).click();
      await page.getByRole('button', { name: '删除 渠道模型已改名', exact: true }).click();
      await page.getByRole('button', { name: '删除', exact: true }).click();
      await page.waitForFunction(() => chat.snapshot().error.includes('模型已删除') && !chat.snapshot().model);
      assert.equal(await page.evaluate(() => chat.snapshot().current.turns[0].versions[0].status), 'done');
      await page.reload(); await bind(page);
      await page.waitForFunction(() => chat.snapshot().ready);
      assert.equal(await page.locator(`[data-model="${id}"]`).count(), 0);
      assert.equal(await page.evaluate(id => chat.snapshot().models.some(m => m.id === id), id), false);
      assert.deepEqual(t.errors, []);
    } finally { await t.context.close(); }
  }
});

test('supplier switches enable Chat and Images independently with the same saved key and image mappings', async () => {
  const t = await open('openai-images-v1'), { page } = t;
  try {
    await page.evaluate(async () => {
      const next = structuredClone(services.connections.configuration);
      next.links.test = { 'gpt-image-1.5': { id: 'relay-render', manual: true, on: true } };
      await services.connections.save(next);
    });
    await settings(page, 'connections');
    const edit = async () => {
      await page.locator('.conn-card[data-connection="test"]').getByRole('button', { name: /更多/ }).click();
      await page.getByRole('menuitem', { name: '配置供应商', exact: true }).click();
      assert.equal(await page.locator('#connectionProtocol').inputValue(), 'openai');
    };
    await edit();
    assert.equal(await page.getByRole('checkbox', { name: '文字 · ASK', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: '图像 · 生图与编辑', exact: true }).isChecked(), true);
    await page.getByRole('checkbox', { name: '文字 · ASK', exact: true }).check();
    await page.locator('.supplier-form').getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => services.connections.configuration.connections.test.profileId === 'openai-chat-images-v1');
    assert.equal(await page.locator('.conn-card').count(), 1);
    assert.deepEqual(await page.locator('.conn-card .conn-models').evaluateAll(rows => rows.map(r => r.dataset.kind)), ['image', 'llm']);
    await edit();
    await page.getByRole('checkbox', { name: '图像 · 生图与编辑', exact: true }).uncheck();
    await page.locator('.supplier-form').getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => services.connections.configuration.connections.test.profileId === 'openai-chat-v1');
    assert.equal(await page.locator('.conn-card .conn-models[data-kind="image"]').count(), 0);
    assert.equal(await page.locator('.conn-card .conn-models[data-kind="llm"]').count(), 1);
    await edit();
    await page.getByRole('checkbox', { name: '图像 · 生图与编辑', exact: true }).check();
    await page.getByRole('checkbox', { name: '文字 · ASK', exact: true }).uncheck();
    await page.locator('.supplier-form').getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => services.connections.configuration.connections.test.profileId === 'openai-images-v1');
    assert.equal(await page.locator('.conn-card .conn-models[data-kind="llm"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => services.connections.configuration.links.test), { 'gpt-image-1.5': { id: 'relay-render', manual: true, on: true } });
    assert.equal(await page.evaluate(() => services.connections.context('test').key()), 'synthetic-native-only');
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('model source errors: NAI never appears under GPT/Gemini; one 401 leaves other sources usable and manual entry available', async () => {
  const t = await open('nai-official-v1', true, '', undefined, '', true), { page } = t;
  try {
    await t.context.route('https://gateway.example.test/bad/**', route => route.fulfill({ status: 401, json: { error: 'invalid synthetic-bad-key' } }));
    await page.evaluate(async () => {
      const next = structuredClone(services.connections.configuration);
      next.connections.bad = { id: 'bad', name: '失效渠道', baseUrl: 'https://gateway.example.test/bad', profileId: 'openai-images-v1', credentialRef: 'key-bad', revision: 'r1' };
      await services.connections.save(next); await services.vault.setKey('key-bad', 'synthetic-bad-key', false);
    });
    await settings(page);
    await page.getByRole('button', { name: '展开 GPT Image 1.5 的来源', exact: true }).click();
    const row = page.locator('[data-model="gpt-image-1.5"]');
    await page.locator('.sm-notice').filter({ hasText: '鉴权失败（401），请检查 API Key' }).waitFor();
    assert.deepEqual(await row.locator('.sm-conn').allTextContents(), ['模拟网关']);
    assert.match(await row.textContent(), /gpt-image-1.5/); assert.doesNotMatch(await row.textContent(), /synthetic-bad-key|未找到/);
    await row.getByRole('button', { name: '为 GPT Image 1.5 添加来源', exact: true }).click();
    await row.getByRole('combobox', { name: 'GPT Image 1.5 的供应商', exact: true }).selectOption('bad');
    await row.getByRole('combobox', { name: 'GPT Image 1.5 的上游 ID', exact: true }).fill('unknown-image-id');
    await row.getByRole('button', { name: '保存来源', exact: true }).click();
    await row.locator('.sm-new-source').waitFor({ state: 'detached' });
    assert.deepEqual(await row.locator('.sm-conn').allTextContents(), ['模拟网关', '失效渠道']);
    assert.equal(await page.evaluate(() => services.connections.configuration.links.bad['gpt-image-1.5'].id), 'unknown-image-id');
    await page.getByRole('button', { name: '重试 失效渠道 目录', exact: true }).click();
    await page.locator('.sm-notice').filter({ hasText: '鉴权失败（401），请检查 API Key' }).waitFor();
    await page.getByRole('button', { name: '展开 NAI Diffusion V5 Full 的来源', exact: true }).click();
    assert.deepEqual(await page.locator('[data-model="nai-diffusion-5-full"] .sm-conn').allTextContents(), ['模拟网关', '模拟协议']);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('inline sources: save arbitrary IDs, cancel, reject empty/duplicate IDs, restore automatic matching and preserve parameters', async () => {
  const t = await open('openai-images-v1', true, '', undefined, '', true), { page } = t;
  try {
    await settings(page);
    await page.getByRole('button', { name: '展开 GPT Image 1.5 的来源', exact: true }).click();
    const row = page.locator('[data-model="gpt-image-1.5"]');
    const idButton = row.getByRole('button', { name: '为 GPT Image 1.5 指定 模拟协议 上的 ID', exact: true });
    const input = row.locator('.sm-id-input');
    const savedLink = () => page.evaluate(() => services.connections.configuration.links.test?.['gpt-image-1.5']);
    await idButton.click(); await input.fill('cancelled-id'); await input.press('Escape');
    assert.equal(await savedLink(), undefined);
    assert.equal(await page.locator('#settingsPanel').isVisible(), true);
    await idButton.click(); await input.fill('   '); await input.press('Enter');
    assert.equal(await row.getByRole('alert').textContent(), '请输入上游 ID');
    assert.equal(await savedLink(), undefined);
    const alias = 'vendor/自定义 renderer?x=1@third-party';
    await input.fill(alias); await input.press('Enter');
    await input.waitFor({ state: 'detached' });
    assert.deepEqual(await savedLink(), { id: alias, manual: true, on: true });
    await idButton.click(); await input.fill(alias + '-blur'); await input.press('Tab'); await page.keyboard.press('Tab');
    await input.waitFor({ state: 'detached' });
    assert.equal((await savedLink()).id, alias + '-blur');
    const toggle = row.getByRole('switch', { name: 'GPT Image 1.5 · 模拟协议 来源', exact: true });
    await toggle.uncheck();
    await page.waitForFunction(() => services.connections.configuration.links.test['gpt-image-1.5'].on === false);
    await page.getByRole('button', { name: '编辑 GPT Image 1.5', exact: true }).click();
    assert.equal(await page.locator('.model-entry-dialog .model-sources').count(), 0);
    await saveModel(page);
    assert.deepEqual(await savedLink(), { id: alias + '-blur', manual: true, on: false });
    await editParameters(page, 'GPT Image 1.5', { quality: 'custom-quality' });
    await page.evaluate(async () => {
      const next = structuredClone(services.connections.configuration);
      next.order = ['test', 'primary'];
      next.links.test['gpt-image-2'] = { id: 'claimed-id', manual: true, on: true };
      await services.connections.save(next);
    });
    assert.deepEqual(await row.locator('.sm-conn').allTextContents(), ['模拟协议', '模拟网关']);
    await idButton.click(); await input.fill('claimed-id'); await input.press('Enter');
    await row.getByRole('alert').filter({ hasText: '此 ID 已用于「GPT Image 2」' }).waitFor();
    assert.equal((await savedLink()).id, alias + '-blur');
    await input.press('Escape');
    await page.reload(); await bind(page);
    await page.getByRole('button', { name: '展开 GPT Image 1.5 的来源', exact: true }).click();
    assert.ok((await idButton.textContent()).includes(alias + '-blur'));
    assert.equal(await toggle.isChecked(), false);
    assert.equal((await savedLink()).parameters.quality.default, 'custom-quality');
    await idButton.click();
    await row.getByRole('button', { name: '恢复 模拟协议 自动匹配', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    assert.equal(await savedLink(), undefined);
    assert.equal(await toggle.isChecked(), true);
    await row.getByRole('button', { name: '收起 GPT Image 1.5 的来源', exact: true }).locator('.sm-chevron').click();
    assert.match(await row.locator('.sm-pill').textContent(), /模拟协议\+1/);
    assert.equal(await page.evaluate(() => services.connections.configuration.links.test['gpt-image-2'].id), 'claimed-id');
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('add source: hide unmapped rows, add from plus, validate, cancel, preserve disabled mappings and persist', async () => {
  const t = await open('openai-images-v1', true, '', undefined, '', true), { page } = t;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await settings(page);
    await page.getByRole('button', { name: '展开 GPT Image 2.5 Sunburst 的来源', exact: true }).locator('.sm-chevron').click();
    const row = page.locator('[data-model="gpt-image-2.5-sunburst"]');
    const plus = row.getByRole('button', { name: '为 GPT Image 2.5 Sunburst 添加来源', exact: true });
    const supplier = row.getByRole('combobox', { name: 'GPT Image 2.5 Sunburst 的供应商', exact: true });
    const upstream = row.getByRole('combobox', { name: 'GPT Image 2.5 Sunburst 的上游 ID', exact: true });
    assert.equal(await row.locator('.sm-line').count(), 0);
    assert.doesNotMatch(await row.textContent(), /填写 ID|未匹配|模拟协议|模拟网关/);
    await plus.click(); await upstream.fill('not-saved'); await upstream.press('Escape');
    assert.equal(await row.locator('.sm-new-source').count(), 0);
    assert.equal(await row.locator('.sm-line').count(), 0);
    assert.equal(await page.locator('#settingsPanel').isVisible(), true);
    assert.equal(await plus.evaluate(button => button === document.activeElement), true);
    await plus.click(); await upstream.fill('discard-on-collapse');
    await row.getByRole('button', { name: '收起 GPT Image 2.5 Sunburst 的来源', exact: true }).locator('.sm-chevron').click();
    await row.getByRole('button', { name: '展开 GPT Image 2.5 Sunburst 的来源', exact: true }).locator('.sm-chevron').click();
    assert.equal(await row.locator('.sm-new-source').count(), 0);
    await plus.click(); await supplier.selectOption('test');
    await row.getByRole('button', { name: '保存来源', exact: true }).click();
    assert.equal(await row.getByRole('alert').textContent(), '请输入上游 ID');
    await upstream.fill('gpt-image-1.5');
    await row.getByRole('button', { name: '保存来源', exact: true }).click();
    await row.getByRole('alert').filter({ hasText: '此 ID 已用于「GPT Image 1.5」' }).waitFor();
    const id = 'vendor/custom-image-id@unlisted';
    await upstream.fill(id); await upstream.press('Enter');
    await row.locator('.sm-new-source').waitFor({ state: 'detached' });
    assert.deepEqual(await row.locator('.sm-conn').allTextContents(), ['模拟协议']);
    assert.equal(await page.evaluate(() => services.connections.configuration.links.test['gpt-image-2.5-sunburst'].id), id);
    await plus.click();
    assert.deepEqual(await supplier.locator('option').allTextContents(), ['模拟网关']);
    await row.getByRole('button', { name: '取消添加来源', exact: true }).click();
    await row.getByRole('switch', { name: 'GPT Image 2.5 Sunburst · 模拟协议 来源', exact: true }).uncheck();
    await page.waitForFunction(() => services.connections.configuration.links.test['gpt-image-2.5-sunburst'].on === false);
    assert.equal(await row.locator('.sm-line').count(), 1);
    await plus.click(); await upstream.fill('discard-on-navigation');
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await settings(page);
    assert.equal(await row.locator('.sm-new-source').count(), 0);
    await page.reload(); await bind(page);
    await page.getByRole('button', { name: '展开 GPT Image 2.5 Sunburst 的来源', exact: true }).locator('.sm-chevron').click();
    assert.deepEqual(await row.locator('.sm-conn').allTextContents(), ['模拟协议']);
    assert.equal(await row.getByRole('switch').isChecked(), false);
    assert.ok((await row.textContent()).includes(id));
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('source parameters UI: add typed fields, keep unsaved edits on refresh, persist per source and send exact values from workspace controls', async () => {
  for (const profile of ['openai-images-v1', 'gemini-native-v1']) {
    const t = await open(profile), { page } = t, gemini = profile === 'gemini-native-v1';
    try {
      if (gemini) await page.setViewportSize({ width: 390, height: 844 });
      await settings(page);
      const model = gemini ? 'Nano Banana' : 'GPT Image 1.5';
      await page.getByRole('button', { name: `展开 ${model} 的来源`, exact: true }).click();
      await page.getByRole('button', { name: `${model} · 模拟协议 参数`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '来源参数', exact: true });
      assert.match(await dialog.textContent(), /参考预设 · 接口未声明参数/);
      await dialog.getByRole('button', { name: '添加参数', exact: true }).click();
      const number = dialog.locator('.mp-field').last();
      const key = gemini ? 'temperature' : 'vendor_steps';
      await number.getByLabel('字段名', { exact: true }).fill(key);
      await number.getByText('数字', { exact: true }).click();
      await number.getByLabel('最小值', { exact: true }).fill('0');
      await number.getByLabel('最大值', { exact: true }).fill('20');
      await number.getByLabel('默认值', { exact: true }).fill('1.5');
      await dialog.getByRole('button', { name: '添加参数', exact: true }).click();
      const boolean = dialog.locator('.mp-field').last();
      const boolKey = gemini ? 'imageConfig.includeRaiReason' : 'watermark';
      await boolean.getByLabel('字段名', { exact: true }).fill(boolKey);
      await boolean.getByText('开关', { exact: true }).click();
      await boolean.getByLabel('默认值', { exact: true }).selectOption('false');
      const refreshed = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/models'));
      await dialog.getByRole('button', { name: '重新读取', exact: true }).click();
      await refreshed;
      assert.equal(await dialog.locator('.mp-field').filter({ has: page.locator('.mp-name code', { hasText: new RegExp(`^${key}$`) }) }).getByLabel('默认值', { exact: true }).inputValue(), '1.5');
      await dialog.getByRole('button', { name: '保存参数', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const id = gemini ? 'gemini-2.5-flash-image' : 'gpt-image-1.5';
      const saved = await page.evaluate(id => services.connections.configuration.links.test[id], id);
      assert.equal(saved.parameters[key].default, '1.5'); assert.equal(saved.parameters[boolKey].default, 'false');
      await page.reload(); await bind(page);
      await page.waitForFunction(id => chat.snapshot().models.some(m => m.id === id), id);
      await page.evaluate(id => chat.setModel(id), id);
      await page.locator('#settingsPanel .set-back').click(); await dismissNotices(page);
      await page.locator('.param-button:visible').click();
      const params = page.getByRole('dialog', { name: '参数', exact: true });
      await params.locator(`[id="chatOption-${key}"]`).fill('2');
      await params.locator(`[id="chatOption-${key}"]`).press('Tab');
      await page.keyboard.press('Escape');
      await page.locator('#chatPrompt').fill('合成模拟参数请求');
      await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
      await page.waitForFunction(() => !chat.snapshot().busy && chat.snapshot().current.turns[0]?.versions[0].status === 'done');
      const sent = t.requests.filter(r => r.method === 'POST'); assert.equal(sent.length, 1);
      const body = JSON.parse(sent[0].body);
      if (gemini) assert.deepEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], temperature: 2, imageConfig: { includeRaiReason: false } });
      else assert.deepEqual(body, { model: 'gpt-image-1.5', prompt: '合成模拟参数请求', n: 1, vendor_steps: 2, watermark: false });
      assert.deepEqual(t.errors, []);
    } finally { await t.context.close(); }
  }
});
