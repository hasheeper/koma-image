import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { useNativeFixture, open } from './helpers/native-fixture.mjs';

useNativeFixture();

test('fal connection configured in settings generates, edits the last image, and places a cropped layer on the original canvas', async t => {
  const { context, page, errors, png } = await open('custom-images-v1', false);
  t.after(() => context.close());
  const queue = 'https://queue.example.test', cdn = 'https://media.example.test';
  const jobs = [], downloads = [];
  const color = [22, 199, 84, 255];
  const part = Buffer.from(encode({ width: 2, height: 2, channels: 4, data: Uint8Array.from([...color, ...color, ...color, ...color]) }));
  await context.route(queue + '/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,GET', 'access-control-allow-headers': 'authorization,content-type',
    } });
    assert.equal(req.headers().authorization, 'Key synthetic');
    const reply = json => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json });
    if (req.method() === 'POST') {
      jobs.push({ path, body: req.postDataJSON() });
      const id = String(jobs.length), url = queue + '/relay/bytedance/seedream/requests/' + id;
      return reply({ request_id: id, status_url: url + '/status', response_url: url });
    }
    if (path.endsWith('/status')) return reply({ status: 'COMPLETED' });
    const base = { url: cdn + '/base.png' }, ear = { url: cdn + '/ear.png' };
    const job = jobs[Number(path.split('/').pop()) - 1];
    return reply(job.path.endsWith('piece') ? { images: [base, ear], layers: [
      { image: ear, z_index: 1, name: '左耳', bounding_box: { absolute: [26, 32, 46, 52] } }, { image: base, z_index: 0 },
    ] } : { images: [base] });
  });
  await context.route(cdn + '/**', route => {
    assert.equal(route.request().headers().authorization, undefined);
    const path = new URL(route.request().url()).pathname; downloads.push(path);
    return route.fulfill({ contentType: 'image/png', body: path === '/ear.png' ? part : png, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.getByRole('button', { name: '配置供应商', exact: true }).click();
  await page.locator('#connectionProtocol').selectOption('custom-images-v1');
  await page.locator('#imageChannelFormat').selectOption('fal-queue');
  await page.locator('#connectionUrl').fill(queue + '/relay');
  await page.locator('summary').filter({ hasText: '上游模型 ID' }).click();
  await page.locator('#imageChannelTemplate').selectOption('seedream-5.5');
  assert.equal(await page.locator('.endpoint-preview').textContent(), queue + '/relay/bytedance/seedream/v5.5/text-to-image');
  await page.getByLabel('拆层', { exact: true }).fill('tenant/piece');
  await page.locator('#connectionName').fill('测试 fal');
  await page.locator('#connectionKey').fill('synthetic');
  await page.getByRole('dialog', { name: '供应商设置' }).getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: /图像模型，已启用 17 个/ }).click();
  const list = page.getByRole('dialog', { name: '测试 fal 模型列表' });
  await list.getByLabel('搜索模型').fill('tenant/piece');
  await list.getByText('文生图 · 图生图 · 拆层', { exact: true }).waitFor();
  await list.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => location.hash = '#/chat');
  await page.waitForFunction(() => chat.snapshot().model?.id === 'seedream-5.5');
  for (const [n, prompt] of ['draw an ear', 'paint it green'].entries()) {
    await page.locator('#chatPrompt').fill(prompt);
    await page.getByRole('button', { name: '发送绘图请求' }).click();
    await page.waitForFunction(count => !chat.snapshot().busy && chat.snapshot().current.turns.length === count &&
      chat.snapshot().current.turns.every(turn => turn.versions[turn.selectedVersion].status === 'done'), n + 1);
  }
  assert.equal(jobs[0].path, '/relay/bytedance/seedream/v5.5/text-to-image');
  assert.equal(jobs[1].path, '/relay/bytedance/seedream/v5.5/edit');
  assert.match(jobs[1].body.image_urls[0], /^data:image\/png;base64,/);
  await page.evaluate(() => location.hash = '#/edit');
  const panel = page.locator('#imageEditor');
  await panel.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: png });
  await panel.getByRole('slider', { name: '最多拆出层数' }).fill('4');
  await panel.getByRole('button', { name: '一键总拆', exact: true }).click();
  const pool = panel.getByRole('region', { name: '本次拆层候选池' });
  await pool.getByText('左耳', { exact: true }).waitFor();
  assert.equal(await pool.locator('.layer-pool-item').count(), 2);
  const pixel = await panel.locator('canvas.layer-surface').evaluate(el => [...el.getContext('2d').getImageData(27, 33, 1, 1).data]);
  assert.deepEqual(pixel, color);
  assert.equal(jobs[2].path, '/relay/tenant/piece'); assert.equal(jobs[2].body.max_images, 4);
  assert.equal(jobs[2].body.image_size, 'auto_2K'); assert.equal(jobs[2].body.image_urls, undefined);
  assert.deepEqual(downloads, ['/base.png', '/base.png', '/base.png', '/ear.png']);
  assert.deepEqual(errors, []);
});
