import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { useNativeFixture, open } from './helpers/native-fixture.mjs';
import { kieSeedreamModels } from '../src/domain/seedream.ts';

useNativeFixture();

function image(width, height, color, border = 0) {
  const data = new Uint8Array(width * height * 4);
  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) data.set(color, (y * width + x) * 4);
  }
  return Buffer.from(encode({ width, height, data, channels: 4 }));
}

test('Kie Seedream 5.5: configure, generate, follow up, split and recursively split, then complete a transparent part', async t => {
  const { context, page, errors } = await open('custom-images-v1', false);
  t.after(() => context.close());
  const master = image(512, 512, [80, 70, 60, 255]);
  const part = image(100, 100, [20, 110, 220, 255]);
  const transparent = image(128, 128, [45, 195, 110, 255], 20);
  const origin = 'https://kie-result.example.test';
  const tasks = [], polls = [], uploads = [], downloads = [], nativeRequests = [];
  await context.route('https://ark.example.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': '*' };
    if (path.endsWith('/models')) return route.fulfill({ headers, json: { data: [{ id: 'doubao-seedream-5-5' }] } });
    assert.equal(path, '/api/v3/images/generations');
    nativeRequests.push(request.postDataJSON());
    return route.fulfill({ headers, json: { data: [{ b64_json: transparent.toString('base64') }] } });
  });
  await context.route('https://api.kie.ai/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type',
    } });
    assert.equal(request.headers().authorization, 'Bearer synthetic-kie-key');
    const reply = data => route.fulfill({ json: { code: 200, data }, headers: { 'access-control-allow-origin': '*' } });
    if (url.pathname.endsWith('/credit')) return reply(10);
    if (url.pathname.endsWith('/createTask') || url.pathname === '/split') {
      assert.equal(url.pathname === '/split', request.postDataJSON().model === kieSeedreamModels.decompose);
      tasks.push(request.postDataJSON());
      return reply({ taskId: `test-${tasks.length}` });
    }
    assert.equal(url.pathname, '/api/v1/jobs/recordInfo');
    const id = Number(url.searchParams.get('taskId').split('-')[1]);
    const job = tasks[id - 1], firstPoll = !polls.includes(id);
    polls.push(id);
    if (id === 1 && firstPoll) return reply({ state: 'queuing' });
    if (job.model !== kieSeedreamModels.decompose) {
      const url = job.input.background === 'transparent' ? `${origin}/transparent.png` : `${origin}/base.png`;
      return reply({ state: 'success', resultJson: JSON.stringify({ resultUrls: [url] }) });
    }
    const recursive = tasks.filter(x => x.model === kieSeedreamModels.decompose).length > 1;
    const base = { z_index: 0, url: `${origin}/${recursive ? 'part.png' : 'base.png'}` };
    const layer = { z_index: 1, name: recursive ? '子部件' : '发饰', url: `${origin}/part.png`,
      bounding_box: { absolute: recursive ? [10, 10, 50, 50] : [80, 50, 180, 150] } };
    return reply({ state: 'success', resultJson: JSON.stringify({ resultObject: { layers_data: [layer, base] } }) });
  });
  await context.route('https://kieai.redpandaai.co/api/file-base64-upload', async route => {
    const request = route.request();
    assert.equal(request.headers().authorization, 'Bearer synthetic-kie-key');
    uploads.push(request.postDataJSON());
    assert.match(uploads.at(-1).base64Data, /^data:image\/(png|jpeg|webp);base64,/);
    return route.fulfill({ json: { code: 200, success: true, data: { downloadUrl: `${origin}/input-${uploads.length}.png` } },
      headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route(`${origin}/**`, route => {
    const request = route.request();
    assert.equal(request.headers().authorization, undefined);
    const path = new URL(request.url()).pathname;
    downloads.push(path);
    return route.fulfill({ contentType: 'image/png', body: path === '/part.png' ? part : path === '/transparent.png' ? transparent : master,
      headers: { 'access-control-allow-origin': '*' } });
  });

  await page.getByRole('button', { name: '配置供应商', exact: true }).click();
  await page.locator('#connectionProtocol').selectOption('custom-images-v1');
  await page.locator('#imageChannelFormat').selectOption('kie-images');
  await page.locator('#connectionUrl').fill('https://api.kie.ai');
  await page.locator('#imageUploadBase').fill('https://kieai.redpandaai.co');
  await page.locator('#channel-path-layerDecompose').fill('/split');
  await page.locator('#connectionName').fill('模拟 Kie');
  await page.locator('#connectionKey').fill('synthetic-kie-key');
  await page.getByRole('dialog', { name: '供应商设置' }).getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => chat.snapshot().model?.id === 'seedream-5.5');
  await page.getByRole('button', { name: /图像模型，已启用 15 个/ }).click();
  const list = page.getByRole('dialog', { name: '模拟 Kie 模型列表' });
  await list.getByLabel('搜索模型').fill('5-5-layer-decomposition');
  await list.getByText('文生图 · 图生图 · 拆层', { exact: true }).waitFor();
  assert.equal(await list.locator('.md-row').count(), 1);
  await list.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => location.hash = '#/chat');
  for (const [index, prompt] of ['生成一张蓝色的湖', '把天空改成偏暖色'].entries()) {
    await page.locator('#chatPrompt').fill(prompt);
    await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
    await page.waitForFunction(n => !chat.snapshot().busy && chat.snapshot().current.turns.length === n &&
      chat.snapshot().current.turns.every(turn => turn.versions[turn.selectedVersion].status === 'done'), index + 1);
  }
  assert.deepEqual(tasks.map(x => x.model), [kieSeedreamModels.generate, kieSeedreamModels.edit]);
  assert.equal(tasks[0].input.aspect_ratio, '1:1');
  assert.equal(tasks[0].max_cost, undefined);
  assert.deepEqual(tasks[1].input.image_urls, [`${origin}/input-1.png`]);
  assert.deepEqual(polls, [1, 1, 2]);

  await page.evaluate(async () => {
    const next = structuredClone(services.connections.configuration);
    const [kie] = Object.keys(next.connections);
    await services.vault.setKey('key-ark', 'synthetic-ark-key', false);
    next.connections.ark = { id: 'ark', name: '模拟方舟', baseUrl: 'https://ark.example.test', profileId: 'seedream-v1', credentialRef: 'key-ark', revision: 'r1' };
    next.order = ['ark', kie];
    await services.connections.save(next);
  });
  await page.evaluate(() => location.hash = '#/edit');
  await page.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  const panel = page.locator('#imageEditor');
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: master });
  await done();
  const splitModel = panel.getByRole('button', { name: /^拆层模型：/ });
  const arkLabel = 'Seedream 5.5 · Seedream 原生（模拟方舟）', kieLabel = 'Seedream 5.5 · 通用图像接口（模拟 Kie）';
  await splitModel.click();
  const splitMenu = page.getByRole('menu', { name: '拆层模型' });
  const labels = await splitMenu.getByRole('menuitemradio').allTextContents();
  assert.ok(labels.includes(arkLabel) && labels.includes(kieLabel));
  const arkVal = await splitMenu.getByRole('menuitemradio', { name: arkLabel, exact: true }).getAttribute('data-value');
  await splitMenu.getByRole('menuitemradio', { name: kieLabel, exact: true }).click();
  assert.notEqual(await splitModel.getAttribute('data-value'), arkVal);
  await panel.getByRole('slider', { name: '最多拆出层数' }).fill('12');
  await panel.getByRole('button', { name: '一键总拆', exact: true }).click();
  await done();
  assert.equal(tasks[2].model, kieSeedreamModels.decompose);
  assert.equal(tasks[2].input.image_url, `${origin}/input-2.png`);
  assert.equal(tasks[2].input.max_images, 12);
  assert.equal(await panel.locator('.layer-pool-item').count(), 2);
  const surface = page.locator('canvas.layer-surface');
  const pixel = (x, y) => surface.evaluate((el, [a, b]) => [...el.getContext('2d').getImageData(a, b, 1, 1).data], [x, y]);
  assert.deepEqual(await pixel(81, 51), [20, 110, 220, 255]);
  assert.deepEqual(await pixel(79, 51), [0, 0, 0, 0]);

  await panel.getByRole('button', { name: /收纳进图层栈 \(1\)/ }).click();
  await done();
  const expand = panel.getByRole('button', { name: '展开参数', exact: true });
  if (await expand.isVisible()) await expand.click();
  await panel.getByRole('button', { name: '↳ 继续细拆此件', exact: true }).click();
  await panel.getByRole('button', { name: '不限制', exact: true }).click();
  await panel.getByRole('button', { name: '开始细拆', exact: true }).click();
  await page.getByRole('button', { name: '本地放大并继续' }).click();
  await done();
  assert.equal(tasks[3].model, kieSeedreamModels.decompose);
  assert.equal(tasks[3].input.max_images, undefined);
  assert.equal(await panel.getByText('子部件', { exact: true }).count(), 1);

  await panel.getByRole('tab', { name: '局部补画', exact: true }).click();
  const box = await surface.boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await done();
  const rerollModel = panel.getByRole('button', { name: /^局部补画模型：/ });
  await rerollModel.click();
  await page.getByRole('menu', { name: '局部补画模型' }).getByRole('menuitemradio', { name: `${kieLabel}（透明底）`, exact: true }).click();
  await panel.getByLabel('部件名称').fill('发饰');
  await panel.getByRole('button', { name: '生成透明部件', exact: true }).click();
  await done();
  assert.equal(tasks[4].model, kieSeedreamModels.edit);
  assert.equal(tasks[4].input.background, 'transparent');
  assert.equal(tasks[4].input.output_format, 'png');
  assert.equal(tasks[4].input.image_urls.length, 2);
  assert.ok(tasks.every(task => task.input.nsfw_checker === false));
  assert.ok(downloads.includes('/transparent.png'));
  assert.deepEqual(nativeRequests, []);
  await rerollModel.click();
  await page.getByRole('menu', { name: '局部补画模型' }).getByRole('menuitemradio', { name: `${arkLabel}（透明底）`, exact: true }).click();
  await panel.getByRole('button', { name: '生成透明部件', exact: true }).click();
  await done();
  assert.equal(tasks.length, 5);
  assert.equal(nativeRequests.length, 1);
  assert.equal(nativeRequests[0].model, 'doubao-seedream-5-5');
  assert.equal(nativeRequests[0].nsfw_checker, undefined);
  await panel.getByRole('button', { name: '补缺失件', exact: true }).click();
  await panel.getByRole('button', { name: '选择图层', exact: true }).click();
  await panel.getByRole('region', { name: '缺失件底图' }).getByLabel('发饰', { exact: true }).check();
  await panel.getByLabel('部件名称').fill('发饰后的连接片');
  await panel.getByRole('button', { name: /^缺失件模型来源：/ }).click();
  await page.getByRole('menu', { name: '缺失件模型来源' }).getByRole('menuitemradio', { name: kieLabel, exact: true }).click();
  const uploadCount = uploads.length;
  await panel.getByRole('button', { name: '生成缺失件' }).click();
  await page.getByRole('button', { name: '本地放大并继续' }).click();
  await done();
  assert.equal(uploads.length, uploadCount + 1);
  assert.equal(tasks.length, 6);
  assert.equal(tasks[5].model, kieSeedreamModels.decompose);
  assert.equal(tasks[5].input.max_images, 2);
  assert.equal(tasks[5].input.image_url, `${origin}/input-${uploads.length}.png`);
  assert.equal(nativeRequests.length, 1);
  assert.ok(await panel.getByRole('button', { name: '添加为独立图层' }).isEnabled());
  assert.deepEqual(await panel.getByRole('alert').allTextContents(), []);
  assert.deepEqual(errors, []);
});

test('Layer switches between Kie 5.0 automatic count and synchronous 5.5 bounded count and places each result', async t => {
  const { context, page, errors, png } = await open('custom-images-v1', false);
  t.after(() => context.close());
  const color = [27, 190, 82, 255], part = image(20, 20, color);
  const layer = { z_index: 1, name: '耳朵', bounding_box: { absolute: [42, 31, 62, 51] } };
  const sync = [], jobs = [];
  await context.route('https://sync.example.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/models') return route.fulfill({ json: { data: [{ id: 'tenant/sd',
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
      supported_parameters: { resolution: { type: 'enum', values: ['1K', '2K'] }, input_references: { type: 'range', min: 0, max: 10 } } }] } });
    assert.equal(path, '/split');
    sync.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: [
      { b64_json: part.toString('base64'), layer }, { b64_json: png.toString('base64'), layer: { z_index: 0 } },
    ] } });
  });
  await context.route('https://async.example.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    const reply = data => route.fulfill({ json: { code: 200, data } });
    if (path === '/upload') return reply({ downloadUrl: 'https://files.example.test/in' });
    if (path === '/edit') { jobs.push(route.request().postDataJSON()); return reply({ taskId: 'fixture' }); }
    assert.equal(path, '/status');
    return reply({ state: 'success', resultJson: JSON.stringify({ resultObject: { layers_data: [
      { ...layer, url: 'https://files.example.test/part' }, { z_index: 0, url: 'https://files.example.test/base' },
    ] } }) });
  });
  await context.route('https://files.example.test/**', route => route.fulfill({ contentType: 'image/png',
    body: route.request().url().endsWith('/part') ? part : png }));
  await page.evaluate(async () => {
    const next = structuredClone(services.connections.configuration);
    for (const [id, format, paths, modelIds] of [
      ['sync', 'openrouter-images', { catalog: '/models', generate: '/gen', toolRun: '/edit', layerDecompose: '/split' }, { 'seedream-5.5': { generate: 'tenant/sd' } }],
      ['async', 'kie-images', { generate: '/gen', toolRun: '/edit', uploadImage: '/upload', imageTask: '/status' }, {}],
    ]) {
      next.connections[id] = { id, name: id, profileId: 'custom-images-v1', baseUrl: 'https://' + id + '.example.test', revision: 'r1',
        credentialRef: 'key-' + id, imageChannel: { format, paths, modelIds } };
      await services.vault.setKey('key-' + id, 'fixture', false);
    }
    await services.connections.save(next);
    location.hash = '#/edit';
  });
  const panel = page.locator('#imageEditor');
  await page.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({ name: 'master.png', mimeType: 'image/png', buffer: png });
  for (const [label, automatic] of [['Seedream 5.0 Pro · 通用图像接口（async）', true], ['Seedream 5.5 · 通用图像接口（sync）', false]]) {
    await panel.getByRole('button', { name: /^拆层模型：/ }).click();
    await page.getByRole('menu', { name: '拆层模型' }).getByRole('menuitemradio', { name: label, exact: true }).click();
    const slider = panel.getByRole('slider', { name: '最多拆出层数' });
    const sizes = panel.getByRole('group', { name: '拆层输出分辨率' });
    assert.equal(await panel.getByRole('button', { name: '不限制', exact: true }).count(), 0);
    if (automatic) {
      assert.equal(await slider.count(), 0);
      await panel.getByText('此来源自动决定拆层数量。').waitFor();
      await sizes.getByRole('button', { name: '1.5K', exact: true }).click();
    } else {
      assert.equal(await slider.getAttribute('max'), '16');
      await slider.fill('16');
      assert.equal(await sizes.getByRole('button', { name: '1.5K', exact: true }).count(), 0);
      assert.equal(await sizes.getByRole('button', { name: '2K', exact: true }).getAttribute('aria-pressed'), 'true');
    }
    await panel.getByRole('button', { name: '一键总拆', exact: true }).click();
    const pool = panel.getByRole('region', { name: '本次拆层候选池' });
    await pool.getByText('耳朵', { exact: true }).waitFor();
    assert.equal(await pool.locator('.layer-pool-item').count(), 2);
    const pixel = await panel.locator('canvas.layer-surface').evaluate(el => [...el.getContext('2d').getImageData(43, 32, 1, 1).data]);
    assert.deepEqual(pixel, color);
    await pool.getByRole('button', { name: '清空', exact: true }).click();
    await pool.waitFor({ state: 'hidden' });
  }
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], { model: 'seedream/5-pro-layer-decomposition', input: {
    size: '1.5K', output_format: 'png', image_url: 'https://files.example.test/in',
    ...(jobs[0].input.prompt ? { prompt: jobs[0].input.prompt } : {}),
  } });
  assert.equal(sync.length, 1);
  assert.equal(sync[0].model, 'tenant/sd');
  assert.equal(sync[0].resolution, '2K');
  assert.equal(sync[0].provider.options.seed.layer_decomposition_options.max_images, 16);
  assert.deepEqual(errors, []);
});
