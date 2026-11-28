import assert from 'node:assert/strict';
import test from 'node:test';
import { useNativeFixture, open, bind, openEditorFixture } from './helpers/native-fixture.mjs';

useNativeFixture();
test('CHAT preserves Nano Banana 2.1 references across channels and EDIT submits GPT edits with optional native markup', async t => {
  const { context, page, errors, png } = await open('custom-images-v1', false);
  t.after(() => context.close());
  const router = [], jobs = [], uploads = [];
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const id = 'alias/banana-sync', bananaJob = 'banana-private', gptEdit = 'gpt2-edit-private';
  const syncBase = 'https://relay-one.example.test/base', asyncBase = 'https://relay-two.example.test/sub';
  const uploadBase = 'https://relay-upload.example.test/assets';
  await context.route(syncBase + '/**', route => {
    const r = route.request(), path = new URL(r.url()).pathname;
    assert.equal(r.headers().authorization, 'Bearer fixture-router');
    if (path === '/base/directory') return route.fulfill({ json: { data: [{ id,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
      supported_parameters: { resolution: { type: 'enum', values: ['1K', '2K'] }, input_references: { type: 'range', min: 0, max: 14 } },
    }] } });
    assert.equal(path, router.length ? '/base/remix' : '/base/render');
    router.push(r.postDataJSON());
    return route.fulfill({ json: { data: [{ media_type: 'image/jpeg', b64_json: jpeg }] } });
  });
  await context.route(asyncBase + '/**', route => {
    const r = route.request(), path = new URL(r.url()).pathname;
    assert.equal(r.headers().authorization, 'Bearer fixture-kie');
    const reply = data => route.fulfill({ json: { code: 200, data } });
    if (path === '/sub/account') return reply(10);
    if (path === '/sub/remix') { jobs.push(r.postDataJSON()); return reply({ taskId: 'mock' }); }
    assert.equal(path, '/sub/jobs/mock');
    return reply({ state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://out.example.test/banana.png'] }) });
  });
  await context.route(uploadBase + '/send', route => {
    assert.equal(route.request().headers().authorization, 'Bearer fixture-kie');
    uploads.push(route.request().postDataJSON().base64Data);
    return route.fulfill({ json: { code: 200, data: { downloadUrl: 'https://in.example.test/' + uploads.length } } });
  });
  await context.route('https://out.example.test/banana.png', route => {
    assert.equal(route.request().headers().authorization, undefined);
    return route.fulfill({ contentType: 'application/octet-stream', body: png });
  });
  async function connect(format, base, key, paths, ids) {
    await page.getByRole('button', { name: '配置供应商', exact: true }).click();
    const protocol = page.locator('#connectionProtocol');
    assert.equal(await protocol.locator('option[value="kie-images-v1"], option[value="openrouter-images-v1"]').count(), 0);
    await protocol.selectOption('custom-images-v1');
    await page.locator('#imageChannelFormat').selectOption(format);
    assert.equal(await page.locator('#connectionUrl').inputValue(), '');
    await page.locator('#connectionUrl').fill(base);
    for (const [key, path] of Object.entries(paths)) await page.locator('#channel-path-' + key).fill(path);
    if (format === 'kie-images') {
      assert.equal(await page.locator('#imageUploadBase').inputValue(), '');
      await page.locator('#imageUploadBase').fill(uploadBase);
    }
    await page.getByText('上游模型 ID', { exact: true }).click();
    for (const [key, value] of Object.entries(ids)) {
      await page.locator('#imageChannelTemplate').selectOption(key.slice(0, key.lastIndexOf('-')));
      await page.locator('[id="channel-model-' + key + '"]').fill(value);
    }
    await page.locator('#connectionName').fill(key);
    await page.locator('#connectionKey').fill(key);
    await page.getByRole('dialog', { name: '供应商设置' }).getByRole('button', { name: '保存', exact: true }).click();
  }
  async function send(prompt, count) {
    await page.locator('#chatPrompt').fill(prompt);
    await page.getByRole('button', { name: '发送绘图请求', exact: true }).click();
    await page.waitForFunction(n => !chat.snapshot().busy && chat.snapshot().current.turns.length === n &&
      chat.snapshot().current.turns.every(turn => turn.versions[turn.selectedVersion].status === 'done'), count);
  }
  await connect('openrouter-images', syncBase, 'fixture-router', { catalog: '/directory', generate: '/render', toolRun: '/remix' },
    { 'gemini-nano-banana-2.1-generate': id });
  await page.getByText('已读取图像目录', { exact: true }).waitFor();
  await page.reload();
  await bind(page);
  await page.getByText('已读取图像目录', { exact: true }).waitFor();
  await page.waitForFunction(() => chat.snapshot().model?.id === 'gemini-nano-banana-2.1');
  await page.evaluate(() => location.hash = '#/chat');
  await send('画一片蓝色的海', 1);
  await send('把灯塔改成红色', 2);
  assert.equal(router[0].model, id);
  assert.equal(router[0].input_references, undefined);
  assert.equal(router[1].input_references.length, 1);
  assert.equal(router[1].input_references[0].image_url.url, 'data:image/jpeg;base64,' + jpeg);
  assert.equal(await page.evaluate(async () => {
    const c = chat.snapshot().current, turn = c.turns[0], v = turn.versions[turn.selectedVersion];
    return (await chat.favoriteRecord(c.id, turn.id, v.id, v.blocks.find(b => b.type === 'image').assetId)).blob.type;
  }), 'image/jpeg');

  await page.evaluate(() => location.hash = '#/chat/settings/connections');
  await page.getByText('已验证生图', { exact: true }).waitFor();
  await connect('kie-images', asyncBase, 'fixture-kie',
    { catalog: '/account', generate: '/create', toolRun: '/remix', uploadImage: '/send', imageTask: '/jobs/{taskId}' },
    { 'gemini-nano-banana-2.1-generate': bananaJob, 'gpt-image-2-edit': gptEdit });
  await page.getByRole('button', { name: '生图顺序', exact: true }).click();
  await page.getByRole('button', { name: '提高 fixture-kie 的优先级' }).click();
  await page.getByRole('button', { name: '关闭生图顺序' }).click();
  await page.waitForFunction(() => chat.snapshot().model?.channelFormat === 'kie-images' && chat.snapshot().model.maxImages === 10);
  await page.evaluate(() => location.hash = '#/chat');
  await send('让灯塔亮起来', 3);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].model, bananaJob);
  assert.ok(uploads.length > 0 && uploads.every(data => data === 'data:image/jpeg;base64,' + jpeg));
  assert.deepEqual(jobs[0].input.image_input, uploads.map((_, i) => 'https://in.example.test/' + (i + 1)));
  assert.equal(router.length, 2);
  assert.deepEqual(await page.evaluate(() => chat.snapshot().current.turns.map(turn => turn.versions[turn.selectedVersion].via.upstreamId)),
    [id, id, bananaJob]);
  await openEditorFixture({ page, png }, {});
  await page.waitForFunction(() => editor.snapshot().models.some(m => m.id === 'gpt-image-2'));
  await page.evaluate(() => {
    editor.setMode('img2img'); editor.setModel('gpt-image-2'); editor.patch({ prompt: '把原图改成手绘' });
  });
  await page.waitForFunction(() => editor.snapshot().edit.canRun);
  await page.locator('#editorRun').click();
  await page.waitForFunction(() => !editor.snapshot().busy && editor.snapshot().session.versions.some(v => v.kind === 'result'));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].model, gptEdit);
  assert.equal(jobs[1].input.input_urls.length, 1);
  assert.equal(jobs[1].input.image_input, undefined);

  await openEditorFixture({ page, png }, {});
  await page.evaluate(async () => {
    editor.setModel('gpt-image-2.6-flare');
    editor.setMode('inpaint');
    editor.patch({ prompt: '把标注区域改成蓝色' });
    const p = document.body.__vue_app__._instance.provides;
    const annotations = p[Object.getOwnPropertySymbols(p).find(key => key.description === 'annotations')];
    const v = editor.snapshot().base;
    await annotations.open({ blob: v.blob, name: v.name, recordId: v.recordId, workspace: 'edit', inline: true,
      edit: { boardId: editor.session.id, versionId: v.id } });
    annotations.update([{ key: 'region', shape: 'rect', bbox: { x: .1, y: .2, w: .4, h: .3 }, comment: 'blue' }]);
    annotations.close();
  });
  await page.getByLabel('标注', { exact: true }).selectOption('native');
  await page.waitForFunction(() => editor.snapshot().edit.canRun);
  const previous = uploads.length;
  await page.locator('#editorRun').click();
  await page.waitForFunction(() => !editor.snapshot().busy && !!editor.snapshot().viewed?.comparison);
  assert.equal(jobs.length, 3);
  assert.equal(jobs[2].model, 'gpt-image-2-6/flare-image-to-image');
  assert.deepEqual(jobs[2].input.input_urls, ['https://in.example.test/' + (previous + 1)]);
  assert.equal(jobs[2].input.markup, 'https://in.example.test/' + (previous + 2));
  assert.match(uploads[previous + 1], /^data:image\/png;base64,/);
  assert.notEqual(uploads[previous], uploads[previous + 1]);
  assert.deepEqual(errors, []);
});

test('an existing Kie connection opens in the generic form, retains disabled mappings, and requires a key for a new upload destination', async t => {
  const { context, page, errors } = await open('custom-images-v1', false);
  t.after(() => context.close());
  await context.route('https://api.kie.ai/api/v1/chat/credit', route => route.fulfill({ json: { code: 200, data: 8 } }));
  await page.evaluate(async () => {
    await services.vault.setKey('key-saved', 'fixture-saved', false);
    await services.connections.save({ version: 1, connections: { saved: { id: 'saved', name: '已有连接',
      profileId: 'kie-images-v1', baseUrl: 'https://api.kie.ai', credentialRef: 'key-saved', revision: 'r1' } },
      links: { saved: { 'gpt-image-2': { id: 'gpt-image-2-text-to-image', manual: false, on: false } } } });
  });
  const form = page.getByRole('dialog', { name: '供应商设置' });
  async function edit() {
    await page.locator('[data-connection="saved"]').getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '配置供应商' }).click();
  }
  const save = () => form.getByRole('button', { name: '保存', exact: true }).click();
  await edit();
  assert.equal(await form.locator('#connectionProtocol').inputValue(), 'custom-images-v1');
  assert.equal(await form.locator('#imageChannelFormat').inputValue(), 'kie-images');
  assert.equal(await form.locator('#imageUploadBase').inputValue(), 'https://kieai.redpandaai.co');
  await form.locator('#channel-path-catalog').fill('');
  await form.locator('#channel-path-generate').fill('/tenant/render');
  await form.getByText('上游模型 ID', { exact: true }).click();
  await form.locator('#imageChannelTemplate').selectOption('gpt-image-2');
  await form.locator('#channel-model-gpt-image-2-generate').fill('deployment/gpt2');
  await save();
  await form.waitFor({ state: 'hidden' });
  await page.getByText('使用本地模型配置', { exact: true }).waitFor();
  const saved = await page.evaluate(() => services.connections.configuration);
  assert.equal(saved.connections.saved.credentialRef, 'key-saved');
  assert.equal(saved.connections.saved.profileId, 'custom-images-v1');
  assert.deepEqual(saved.links.saved['gpt-image-2'], { id: 'deployment/gpt2', manual: false, on: false });
  await edit();
  assert.equal(await form.locator('#channel-path-generate').inputValue(), '/tenant/render');
  await form.locator('#imageUploadBase').fill('https://uploads.example.test');
  await save();
  await form.getByText('地址或协议已更改，请重新填写对应的 API Key').waitFor();
  assert.equal(await page.evaluate(() => services.connections.configuration.connections.saved.imageChannel.uploadBaseUrl), 'https://kieai.redpandaai.co');
  await form.locator('#connectionKey').fill('fixture-new');
  await save();
  await form.waitFor({ state: 'hidden' });
  const changed = await page.evaluate(() => services.connections.configuration.connections.saved);
  assert.notEqual(changed.credentialRef, 'key-saved');
  assert.equal(changed.imageChannel.uploadBaseUrl, 'https://uploads.example.test');
  assert.deepEqual(errors, []);
});
