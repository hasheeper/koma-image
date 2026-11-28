import test from 'node:test';
import assert from 'node:assert/strict';
import { writePsdBuffer } from 'ag-psd';
import { encode } from 'fast-png';
import { newProject } from '../src/layer/project.ts';
import { layeredPsd } from '../src/layer/psd.ts';
import { generation, open, useAskFixture } from './helpers/ask-fixture.mjs';

useAskFixture();

const pixel = (...rgba) => ({ width: 1, height: 1, data: Uint8Array.from(rgba) });
const upload = (name, buffer) => ({ name, mimeType: 'application/octet-stream', buffer });
async function openPanel(page) {
  await page.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  await page.locator('.layer-panel[aria-busy="false"]').waitFor();
  return page.locator('#imageEditor');
}
async function clearCache(page) {
  await page.getByRole('button', { name: '分件项目选项' }).click();
  await page.getByRole('menuitem', { name: '清空分件缓存' }).click();
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const store = layerStorage(app), [latest] = await store.list();
    const p = await store.read(latest.id);
    return { title: p.title, reference: [...p.reference.data.slice(0, 4)], layers: p.layers.map(l => ({
      name: l.name, x: l.x, y: l.y, groups: l.groups, groupIds: l.groupIds, muted: l.mutedGroups,
      visible: l.visible, locked: l.locked, pixels: [...l.pixels.slice(0, 4)],
    })) };
  });
}

test('replacing the source starts from the file and deletes old pixel planes; clearing keeps only the live master', async t => {
  const { page, context } = await open('/#/edit', { ready: '#imageEditor' });
  t.after(() => context.close());
  const panel = await openPanel(page);
  await page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const { idbRequest } = await import('/src/storage/databases.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    window.cacheStore = layerStorage(app);
    window.cacheKeys = async () => {
      const tx = app.databases.transaction('koma-layer', ['projects', 'index']);
      return Promise.all(['projects','index'].map(name => idbRequest(tx.objectStore(name).getAllKeys())));
    };
  });
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const importSource = async file => { await panel.getByLabel('打开定稿').setInputFiles(file); await done(); };
  const keys = () => page.evaluate(() => window.cacheKeys());
  const psd = upload('部件.psd', writePsdBuffer({ width:4, height:4, children:[
    { name:'原始层', left:1, top:1, imageData:pixel(7,9,80,255) },
  ] }));
  await importSource(psd);
  const [, [oldId]] = await keys();
  const image = { name:'新原图.png', mimeType:'image/png', buffer:Buffer.from(encode({ ...pixel(40,70,90,255), channels:4 })) };
  await panel.getByLabel('导入图像为图层').setInputFiles(image); await done();
  assert.equal((await snapshot(page)).layers.length, 2);
  await page.evaluate(async id => { window.staleLayer = await window.cacheStore.read(id); }, oldId);
  const beforeError = await keys();
  await importSource(upload('坏.psd', Buffer.from('invalid')));
  assert.deepEqual(await keys(), beforeError);
  await importSource(psd);
  const [records, [reopenedId]] = await keys();
  assert.notEqual(oldId, reopenedId);
  assert.ok(records.every(k => (Array.isArray(k) ? k[0] : k) === reopenedId));
  assert.deepEqual((await snapshot(page)).layers.map(l => l.name), ['原始层']);
  await importSource(image);
  const [remaining, ids] = await keys();
  assert.equal(ids.length, 1);
  assert.notEqual(ids[0], reopenedId);
  assert.ok(remaining.every(k => (Array.isArray(k) ? k[0] : k) === ids[0]));
  assert.deepEqual((await snapshot(page)).reference, [40,70,90,255]);
  await clearCache(page); await done();
  assert.deepEqual(await keys(), [[],[]]);
  assert.deepEqual(await page.locator('canvas.layer-surface').evaluate(el => [...el.getContext('2d').getImageData(0,0,1,1).data]), [40,70,90,255]);
  assert.match(await page.evaluate(async () => {
    try { await window.cacheStore.save(window.staleLayer); return ''; } catch (e) { return e.message; }
  }), /另一页面/);
  assert.deepEqual(await keys(), [[],[]]);
  await panel.getByLabel('导入图像为图层').setInputFiles(image); await done();
  const [, editedIds] = await keys();
  assert.equal(editedIds.length, 1);
  assert.notEqual(editedIds[0], ids[0]);
  await clearCache(page); await done();
  await page.reload(); await openPanel(page);
  assert.ok(await page.locator('.layer-panel').getByRole('button', { name:'打开图片或 PSD' }).isVisible());
});

test('opens a Koma PSD, appends nested external PSD layers atomically and undoes the batch', async t => {
  const f = await open('/#/edit', { ready: '#imageEditor' });
  t.after(() => f.context.close());
  const { page } = f;
  const panel = await openPanel(page);
  const master = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(97) };
  const project = newProject('test', '测试', master);
  project.layers = [{ id: 'hair', name: '前发', groups: ['头部'], x: 2, y: 3,
    width: 1, height: 1, visible: true, locked: true, pixels: Uint8Array.of(4, 88, 209, 127) }];
  await panel.getByLabel('打开定稿').setInputFiles(upload('定稿.PSD', Buffer.from(await layeredPsd(project).arrayBuffer())));
  await panel.locator('.layer-stack-row, [role="alert"]').first().waitFor();
  assert.deepEqual(await panel.getByRole('alert').allTextContents(), [], f.errors.join('\n'));
  await page.reload();
  await openPanel(page);
  let state = await snapshot(page);
  assert.equal(state.title, '定稿.PSD');
  assert.deepEqual(state.reference, [97, 97, 97, 97]);
  assert.equal(state.layers.length, 1);
  assert.deepEqual(state.layers[0].groups, ['头部']);
  assert.deepEqual(state.layers[0].pixels, [4, 88, 209, 127]);
  assert.equal(state.layers[0].locked, true);
  const picker = panel.getByLabel('导入图像为图层');
  const external = upload('五官.psd', writePsdBuffer({
    width: 4, height: 4, children: [
      { name: '五官', hidden: true, children: [{ name: '脸', children: [
        { name: '鼻', left: -1, top: 1, imageData: pixel(7, 8, 9, 200) },
      ] }] },
      { name: '五官', children: [{ name: '眼', left: 1, top: 2, opacity: 0.5,
        imageData: pixel(18, 28, 38, 200), mask: { left: 1, top: 2, imageData: pixel(128, 128, 128, 255) } }] },
    ],
  }, { compress: true, noBackground: true }));
  const png = { name: '高光.png', mimeType: 'image/png', buffer: Buffer.from(encode({ ...pixel(19, 20, 21, 255), channels: 4 })) };
  await picker.setInputFiles([external, png]);
  await panel.getByText('已导入 3 个图层', { exact: true }).waitFor();
  await page.locator('.layer-panel[aria-busy="false"]').waitFor();
  state = await snapshot(page);
  assert.deepEqual(state.layers.map(l => l.name), ['前发', '鼻', '眼', '高光']);
  const [, nose, eye] = state.layers;
  assert.deepEqual([nose.x, nose.y, eye.x, eye.y], [1, 3, 3, 4]);
  assert.deepEqual(nose.groups, ['五官', '脸']);
  assert.notEqual(nose.groupIds[0], eye.groupIds[0]);
  assert.deepEqual(nose.muted, [nose.groupIds[0]]);
  assert.equal(nose.visible, true);
  assert.deepEqual(eye.pixels, [18, 28, 38, 50]);
  const bad = upload('样式.psd', writePsdBuffer({ width: 1, height: 1,
    children: [{ name: '阴影', blendMode: 'multiply', imageData: pixel(0, 0, 0, 255) }] }));
  await picker.setInputFiles([external, bad]);
  await panel.getByRole('alert').filter({ hasText: '阴影' }).waitFor();
  assert.deepEqual(await snapshot(page), state);
  const dock = page.getByRole('toolbar', { name: '分件画布工具' });
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await panel.getByText('鼻', { exact: true }).first().waitFor({ state: 'detached' });
  assert.equal(await panel.locator('.layer-stack-row').count(), 1);
  await dock.getByRole('button', { name: '重做', exact: true }).click();
  await page.reload();
  await openPanel(page);
  assert.deepEqual(await snapshot(page), state);
  assert.deepEqual(generation(f.requests), []);
  assert.deepEqual(f.errors, []);
});
