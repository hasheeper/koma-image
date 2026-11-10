import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useNativeFixture, open, bind } from './helpers/native-fixture.mjs';
useNativeFixture();
const modelId = 'gpt-image-2.6-sunburst';
async function bindAnnotations(page) {
  await bind(page);
  await page.evaluate(() => {
    const p = document.body.__vue_app__._instance.provides;
    window.annotations = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'annotations')];
    window.sourceImage = async (width = 256, height = 256) => {
      const c = new OffscreenCanvas(width, height), g = c.getContext('2d'); g.fillStyle = '#a12942'; g.fillRect(0, 0, width, height);
      return c.convertToBlob({ type: 'image/png' });
    };
    window.annotationSnapshot = async blob => {
      const { imageEntity } = await import('/src/domain/image-identity.ts'), bitmap = await createImageBitmap(blob);
      const snapshot = { image: { entity_key: await imageEntity(blob), record_id: 'test-source', scope: { kind: 'page', id: 'test' } },
        width: bitmap.width, height: bitmap.height, regions: [{ key: 'r', shape: 'rect', bbox: { x: .25, y: .25, w: .25, h: .25 }, comment: 'make blue' }], edges: { dilate: 0, feather: 0 } };
      bitmap.close(); return snapshot;
    };
    window.prepareChatAnnotation = async () => {
      const { annotationPreview } = await import('/src/native/annotation-canvas.ts');
      const source = await sourceImage(), snapshot = await annotationSnapshot(source);
      await chat.prepareAnnotations(source, await annotationPreview(source, snapshot), snapshot);
    };
  });
}
async function setup(id = modelId, enable = true) {
  const t = await open('openai-images-v1', true, id);
  await bindAnnotations(t.page);
  await t.page.waitForFunction(() => chat.snapshot().ready);
  if (enable) await t.page.evaluate(async id => {
    const config = structuredClone(services.connections.configuration);
    config.links.test = { [id]: { id, on: true, manual: true, parameters: { markup: { type: 'boolean', options: ['true', 'false'], default: 'true' } } } };
    await services.connections.save(config); await chat.refreshCatalog();
  }, id);
  await t.page.evaluate(id => chat.setModel(id), id);
  t.posts = []; t.fail = false;
  await t.context.route('**/images/edits', async route => {
    const request = route.request(), body = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
    const record = { fields: {}, images: [], markup: null };
    for (const [key, value] of body) {
      if (typeof value === 'string') record.fields[key] = value;
      else if (key === 'markup') record.markup = { type: value.type, data: Buffer.from(await value.arrayBuffer()).toString('base64') };
      else if (key === 'image[]') record.images.push(Buffer.from(await value.arrayBuffer()).toString('base64'));
    }
    t.posts.push(record);
    await route.fulfill(t.fail ? { status: 400, json: { error: 'synthetic markup rejection' } } : { json: { data: [{ b64_json: t.png.toString('base64') }] } });
  });
  return t;
}

test('native CHAT: source setting, separate layer, frozen retry, ZIP recovery and no annotation leak', async () => {
  const t = await setup(modelId, false), { page } = t;
  try {
    await page.evaluate(() => location.hash = '#/chat/settings/models');
    await page.getByRole('button', { name: '展开 GPT Image 2.6 Sunburst 的来源', exact: true }).click();
    await page.getByRole('button', { name: 'GPT Image 2.6 Sunburst · 模拟协议 参数', exact: true }).click();
    const row = page.getByRole('group', { name: 'markup', exact: true });
    assert.equal(await row.getByLabel('默认值', { exact: true }).inputValue(), 'true');
    await row.getByRole('button', { name: 'markup 字段设置', exact: true }).click();
    assert.equal(await row.getByRole('radio', { name: '开关', exact: true }).isChecked(), true);
    await row.getByLabel('默认值', { exact: true }).selectOption('false');
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/models'));
    await page.getByRole('button', { name: '重新读取', exact: true }).click(); await refreshed;
    assert.equal(await row.getByLabel('默认值', { exact: true }).inputValue(), 'false');
    await row.locator('.s-toggle').click();
    assert.equal(await row.getByRole('switch', { name: '启用 markup', exact: true }).isChecked(), false);
    await page.getByRole('button', { name: '保存参数', exact: true }).click();
    await page.waitForFunction(id => services.connections.configuration.links.test[id]?.parameters?.markup === null && !chat.snapshot().model?.markup, modelId);
    await page.getByRole('button', { name: 'GPT Image 2.6 Sunburst · 模拟协议 参数', exact: true }).click();
    await row.locator('.s-toggle').click();
    await page.getByRole('button', { name: '保存参数', exact: true }).click();
    const savedSource = await page.evaluate(id => services.connections.configuration.links.test[id], modelId);
    assert.equal(savedSource.markup, undefined); assert.equal(savedSource.parameters.markup.default, 'true');
    await page.evaluate(() => location.hash = '#/chat');
    await page.waitForFunction(() => chat.snapshot().model?.markup);
    await page.evaluate(async () => { await prepareChatAnnotation(); chat.setOption('complexity', 'medium'); });
    await page.getByRole('button', { name: '标注方式：双图', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '原生', exact: true }).click();
    await page.waitForFunction(() => !!chat.snapshot().current.pendingAnnotation?.markup && !chat.snapshot().uploading);
    await page.evaluate(() => chat.flush());
    await page.reload(); await bindAnnotations(page); await page.waitForFunction(() => chat.snapshot().ready);
    await page.getByRole('button', { name: '标注方式：原生', exact: true }).waitFor();
    await page.evaluate(() => chat.execute());
    assert.equal(t.posts.length, 1); assert.equal(t.posts[0].images.length, 1);
    assert.equal(t.posts[0].fields.complexity, 'medium'); assert.ok(t.posts[0].markup);
    assert.equal(t.posts[0].fields.quality, 'auto'); assert.equal(t.posts[0].fields.size, 'auto'); assert.equal(t.posts[0].fields.output_format, 'png');
    assert.doesNotMatch(t.posts[0].fields.prompt, /图 2/);
    const bytes = await page.evaluate(async record => {
      const pixels = async data => { const b = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob()); const c = new OffscreenCanvas(b.width, b.height), g = c.getContext('2d');g.drawImage(b,0,0);b.close();return {w:c.width,h:c.height,data:g.getImageData(0,0,c.width,c.height).data}; };
      const a = await pixels(record.images[0]), b = await pixels(record.markup.data);
      return { same: a.w === b.w && a.h === b.h, source: [...a.data.slice(0,4)], overlay: [...b.data.slice(0,4)], marked: b.data.some((v,i) => i % 4 === 3 && v > 0) };
    }, t.posts[0]);
    assert.deepEqual(bytes, { same: true, source: [161,41,66,255], overlay: [0,0,0,0], marked: true });
    const saved = await page.evaluate(async () => {
      await chat.flush(); window.nativeZip = (await services.backup.export()).blob;
      const backup = await services.backup.read(nativeZip), c = chat.snapshot().current, annotation = c.turns[0].snapshot.annotation;
      return { cId: c.id, markup: annotation.markup, assets: backup.assets.map(a => a.id) };
    });
    assert.ok(saved.assets.includes(saved.markup.overlayAssetId)); assert.ok(saved.assets.includes(saved.markup.inputAssetId));
    await page.evaluate(async () => {
      const { names } = await import('/src/storage/names.ts'), { transactionDone } = await import('/src/storage/databases.ts');
      await services.data.import(async () => { const tx = services.databases.transaction(names.databases.chat, ['conversations','assets'], 'readwrite');tx.objectStore('conversations').clear();tx.objectStore('assets').clear();await transactionDone(tx); });
      await services.backup.import(await services.backup.read(nativeZip));
    });
    await page.reload(); await bindAnnotations(page); await page.waitForFunction(() => chat.snapshot().ready);
    await page.evaluate(cId => chat.switchConversation(chat.snapshot().conversations.find(c => c.id === cId)), saved.cId);
    await page.evaluate(() => chat.execute(chat.snapshot().current.turns[0]));
    assert.equal(t.posts.length, 2); assert.deepEqual(t.posts[1], t.posts[0]);
    await page.evaluate(async () => { chat.setPrompt('ordinary follow-up'); await chat.execute(); });
    assert.equal(t.posts.length, 3); assert.equal(t.posts[2].markup, null);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('native EDIT: brush and region input preserve local mask replacement and dual mode', async () => {
  const t = await setup('gpt-image-2.5-flare', false), { page } = t;
  try {
    assert.equal(await page.evaluate(() => chat.snapshot().model.markup), true, '2.5 gets markup from its preset without an extra source flag');
    await page.evaluate(async () => { await editor.open('image', await sourceImage(), 'source.png'); });
    await page.waitForFunction(() => editor.snapshot().models.some(m => m.id === 'gpt-image-2.5-flare'));
    await page.evaluate(async () => {
      editor.setModel('gpt-image-2.5-flare'); editor.patch({ prompt: 'make the region blue' }); editor.setMode('inpaint');
      const v = editor.snapshot().base;
      await annotations.open({ blob:v.blob, name:v.name, recordId:v.recordId, workspace:'edit', inline:true, edit:{boardId:editor.session.id,versionId:v.id} });
      annotations.update((await annotationSnapshot(v.blob)).regions); annotations.close();
      const c = new OffscreenCanvas(256,256), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(150,150,20,20); await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');
      editor.setImageEdit({ edges:{dilate:0,feather:0} });
    });
    assert.equal(await page.locator('#editorImageOption-quality').inputValue(), 'auto');
    assert.equal(await page.locator('#editorImageOption-quality option[value=""]').count(), 0);
    await page.getByLabel('标注', { exact: true }).selectOption('native');
    await page.waitForFunction(() => editor.snapshot().edit.canRun);
    await page.locator('#editorRun').click(); await page.waitForFunction(() => !editor.snapshot().busy && !!editor.snapshot().viewed?.comparison);
    assert.equal(t.posts.length, 1); assert.ok(t.posts[0].markup); assert.equal(t.posts[0].images.length, 1); assert.equal(t.posts[0].fields.mask, undefined);
    const result = await page.evaluate(async () => {
      const raw = editor.snapshot().viewed, merged = await editor.applyComparison(editor.session.id, raw.id);
      const b = await createImageBitmap(merged.blob), c = new OffscreenCanvas(b.width,b.height),g=c.getContext('2d');g.drawImage(b,0,0);b.close();const p=g.getImageData(0,0,c.width,c.height).data;
      return { outside:[...p.slice(0,4)], region:[...p.slice((90*256+90)*4,(90*256+90)*4+4)], brush:[...p.slice((155*256+155)*4,(155*256+155)*4+4)] };
    });
    assert.deepEqual(result.outside,[161,41,66,255]); assert.notDeepEqual(result.region,result.outside); assert.notDeepEqual(result.brush,result.outside);
    await page.getByLabel('标注', { exact: true }).selectOption('dual');
    await page.waitForFunction(() => editor.snapshot().edit.canRun); await page.locator('#editorRun').click();
    await page.waitForFunction(() => !editor.snapshot().busy && !editor.snapshot().preparing); assert.equal(t.posts.length, 2); assert.equal(t.posts[1].markup,null); assert.equal(t.posts[1].images.length,2);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('native markup blocks disabled source fields and does not retry rejected requests', async () => {
  const t = await setup(), { page } = t;
  try {
    await page.evaluate(async () => { await prepareChatAnnotation(); await chat.annotationMarkup(); const config=structuredClone(services.connections.configuration);config.links.test['gpt-image-2.6-sunburst'].parameters.markup=null;await services.connections.save(config);await chat.refreshCatalog(); });
    await page.evaluate(() => chat.execute()); assert.equal(t.posts.length,0);
    await page.evaluate(async () => { const config=structuredClone(services.connections.configuration);config.links.test['gpt-image-2.6-sunburst'].parameters.markup={type:'boolean',options:['true','false'],default:'true'};await services.connections.save(config);await chat.refreshCatalog(); });
    t.fail = true;
    await page.evaluate(() => chat.execute(chat.snapshot().current.turns[0]));
    assert.equal(t.posts.length,1); assert.ok(t.posts[0].markup);
    assert.match(await page.evaluate(() => chat.snapshot().current.turns[0].versions.at(-1).error), /synthetic markup rejection/);
    assert.deepEqual(t.errors,[]);
  } finally { await t.context.close(); }
});

test('markup pairs resize together and keep point annotations separate from region masks', async () => {
  const t = await setup(), { page } = t;
  try {
    const result = await page.evaluate(async () => {
      const {prepareAnnotationMarkup} = await import('/src/native/annotation-markup.ts');
      const source=await sourceImage(5000,4000), snapshot=await annotationSnapshot(source);
      snapshot.regions=[{key:'point',shape:'point',bbox:{x:.5,y:.5,w:0,h:0},comment:'change expression'}];
      const pair=await prepareAnnotationMarkup(source,snapshot), input=await createImageBitmap(pair.input), layer=await createImageBitmap(pair.markup);
      const sizes=[input.width,input.height,layer.width,layer.height];input.close();layer.close();
      const {canMaskAnnotations}=await import('/src/domain/region-annotation.ts');
      return {sizes,pixels:pair.width*pair.height,type:pair.markup.type,mask:canMaskAnnotations(snapshot.regions)};
    });
    assert.deepEqual(result.sizes.slice(0,2),result.sizes.slice(2));assert.ok(result.pixels<=16_777_216);assert.equal(result.type,'image/png');assert.equal(result.mask,false);
    assert.deepEqual(t.errors,[]);
  } finally { await t.context.close(); }
});
