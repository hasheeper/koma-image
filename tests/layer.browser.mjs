import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decode, encode } from 'fast-png';
import { readArchive } from '../src/storage/backup-archive.ts';
import {
  useAskFixture,
  open,
  askSettings,
  askDraft,
  bind,
  openDraft,
  openApplyMenu,
  applyDraft,
  undoCheckpoint,
  generation,
  wireStates,
  toolReply,
  askText,
  imageBlocks,
  restoreCheckpoint,
} from './helpers/ask-fixture.mjs';

useAskFixture();

const rgba = (width, height, data) => Buffer.from(encode({ width, height, data, channels: 4 }));

async function openLayer(page) {
  await page.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  await page.locator('.layer-panel[aria-busy="false"]').waitFor();
}

test('large Layer checkpoints reuse individual pixel planes across selection, deletion and undo', async t => {
  const f = await open('/#/edit', { ready: '#imageEditor' });
  t.after(() => f.context.close());
  const { page } = f;
  const result = await page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const { newProject } = await import('/src/layer/project.ts');
    const { transactionDone } = await import('/src/storage/databases.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const side = 1728, reference = { width:side, height:side, data:new Uint8Array(side*side*4) };
    const legacy = newProject('large-layer', '旧分件存档', reference);
    legacy.revision = 4;
    await app.data.write(async () => {
      const tx = app.databases.transaction('koma-layer', ['projects','index'], 'readwrite');
      const done = transactionDone(tx);
      tx.objectStore('projects').put(legacy, legacy.id);
      tx.objectStore('index').put({id:legacy.id,title:legacy.title,revision:4,updated:0}, legacy.id);
      await done;
    });
    const store = layerStorage(app), project = await store.read(legacy.id);
    const layers = Array.from({length:12}, (_, i) => {
      const pixels = new Uint8Array(side*side*4);
      for (let offset=0; offset<pixels.length; offset+=65536) crypto.getRandomValues(pixels.subarray(offset,offset+65536));
      pixels[0] = i; pixels[pixels.length-1] = 255-i;
      return {id:'layer-'+i,name:'部件 '+i,width:side,height:side,x:i,y:i,visible:true,locked:false,pixels};
    });
    const raster = {width:side,height:side,data:layers[3].pixels};
    const pending = {archive:false,selected:['candidate'],batch:{id:'one',projectId:project.id,model:'sample',
      source:{kind:'master',name:'整图',rect:{x:0,y:0,width:side,height:side},members:[]},
      layers:[{id:'candidate',name:'头发',local:true,raster,preview:raster,fitSource:raster,box:{x:0,y:0,width:side,height:side},zIndex:2,isBase:false,width:side,height:side,source:'decompose'}]}};
    await store.save({...project,layers,pendingSplit:pending});
    const reopened = layerStorage(app), restored = await reopened.read(legacy.id);
    const candidate = restored.pendingSplit.batch.layers[0];
    const writes = [], put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value,key) {
      if(this.name==='projects' && Array.isArray(key)) writes.push(key);
      return put.call(this,value,key);
    };
    try {
      const selected = await reopened.save({...restored,activeLayerId:'layer-3'});
      const selectedWrites = writes.length;
      const trimmed = await reopened.save({...selected,layers:selected.layers.slice(1)});
      const undone = await reopened.save({...trimmed,layers:selected.layers});
      return {revision:undone.revision, planes:restored.layers.map(l=>[l.pixels[0],l.pixels.at(-1)]),
        shared:candidate.preview.data===candidate.raster.data && candidate.fitSource.data===restored.layers[3].pixels,
        selectedWrites, restoredPlaneWrites:writes.length};
    } finally { IDBObjectStore.prototype.put = put; }
  });
  assert.deepEqual(result,{revision:8,planes:Array.from({length:12},(_,i)=>[i,255-i]),shared:true,selectedWrites:0,restoredPlaneWrites:1});
  assert.deepEqual(f.errors, []);
});

test('failed Layer admission keeps the current stack and pool, exports, then retries without another generation', async t => {
  const f = await open('/#/edit', {ready:'#imageEditor'});
  t.after(() => f.context.close());
  const { page } = f;
  await page.evaluate(async () => {
    const {layerStorage} = await import('/src/layer/storage.ts');
    const {newProject} = await import('/src/layer/project.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k=>k.description==='application-services')];
    const raster = {width:2,height:2,data:new Uint8Array(16).fill(255)}, rect={x:0,y:0,width:2,height:2};
    const p = newProject('retry','回图存档',raster);
    const layers = ['眼白','睫毛'].map((name,i)=>({id:name,name,local:true,raster,preview:raster,box:rect,zIndex:i,isBase:false,width:2,height:2,source:'decompose'}));
    p.pendingSplit = {archive:false,selected:['眼白'],batch:{id:'batch',projectId:p.id,model:'sample',
      targetName:'眼部',source:{kind:'master',name:'整图',rect,members:[]},layers}};
    window.layerDb = layerStorage(app);
    await layerDb.save(p);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value,key){
      if(this.name==='index' && key===p.id && window.failSave) return this.add(value,key);
      return put.call(this,value,key);
    };
  });
  await openLayer(page);
  const panel=page.locator('#imageEditor'), pool=panel.getByRole('region',{name:'本次拆层候选池'});
  await page.evaluate(()=>{window.failSave=true;});
  await pool.getByRole('button',{name:'收纳进图层栈 (1)'}).click();
  await panel.getByRole('button',{name:'重试保存'}).waitFor();
  assert.match(await panel.getByRole('alert').textContent(),/分件修改尚未保存/);
  assert.doesNotMatch(await panel.getByRole('alert').textContent(),/保存被中断/);
  assert.deepEqual(await panel.locator('.layer-stack-meta strong').allTextContents(),['眼白']);
  assert.deepEqual(await pool.locator('.layer-pool-meta strong').allTextContents(),['睫毛']);
  assert.equal(await page.evaluate(async()=>(await layerDb.read('retry')).layers.length),0);
  const download=page.waitForEvent('download');
  await panel.getByRole('button',{name:'更多导出方式',exact:true}).click();
  await page.getByRole('menuitem',{name:/导出分层 PSD/}).click();
  assert.equal((await readFile(await (await download).path())).toString('ascii',0,4),'8BPS');
  await page.evaluate(()=>{window.failSave=false;});
  await panel.getByRole('button',{name:'重试保存'}).click();
  await panel.getByRole('alert').waitFor({state:'hidden'});
  await page.reload(); await openLayer(page);
  assert.deepEqual(await panel.locator('.layer-stack-meta strong').allTextContents(),['眼白']);
  assert.deepEqual(await pool.locator('.layer-pool-meta strong').allTextContents(),['睫毛']);
  assert.deepEqual(generation(f.requests),[]);
  assert.deepEqual(f.errors,[]);
});

for (const mobile of [false, true]) {
  test(`delete a Layer checklist from task overview · ${mobile ? 'mobile BETA' : 'desktop'}`, async t => {
    const f = await open('/#/edit', { ready: '#imageEditor', width: mobile ? 390 : 1440, touch: mobile });
    t.after(() => f.context.close());
    const { page } = f;
    await bind(page);
    await page.evaluate(async mobile => {
      const { layerStorage } = await import('/src/layer/storage.ts');
      const { newProject } = await import('/src/layer/project.ts');
      const providers = document.body.__vue_app__._context.provides;
      const store = layerStorage(providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')]);
      const reference = { width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) };
      const p = newProject('current', 'reference.png', reference);
      p.layers = [{ id: 'hair', name: '右马尾', visible: true, locked: false, x: 0, y: 0, width: 1, height: 1, pixels: reference.data }];
      p.todos = [{ id: 'p', name: '马尾', done: true, prompt: '保留外形', layerId: 'hair' },
        { id: 'c', parent: 'p', name: '发梢', done: false, prompt: '细拆发梢' }];
      p.decomposePrompt = '保留表单词';
      await store.save({ ...p, id: 'other' });
      await store.save(p);
      if (mobile) localStorage.setItem('koma.image.layout.v1', JSON.stringify({ enabled: true }));
      else {
        const { parseSlateEdit } = await import('/src/slate/edit.ts');
        const { change } = parseSlateEdit({ kind: 'slate_edit', op: 'create', slate_title: '会话构图' }, null, drawing.snapshot().form, []);
        await slate.commit(change);
        await ask.openSlate(change.id);
        ask.hide();
      }
    }, mobile);
    if (mobile) await page.reload();
    await openLayer(page);
    if (mobile) await bind(page);
    await page.getByRole('combobox', { name: '切换分件项目' }).selectOption('current');
    const memo = page.getByRole('region', { name: '拆件待办', exact: true });
    const options = memo.getByRole('button', { name: '待办清单选项' });
    const overview = page.getByRole('dialog', { name: '任务总览' });
    const card = page.locator('#askFullDraft');
    const openOverview = async () => {
      await options.click();
      await memo.getByRole('menuitem', { name: '任务总览' }).click();
    };
    await page.getByRole('button', { name: /在 ASK 查看拆件待办/ }).click();
    await openOverview();
    const remove = overview.getByRole('button', { name: '删除拆件待办 · reference.png', exact: true });
    await remove.click();
    await openDraft(page);
    assert.equal(await card.locator('.draft-stat .d').textContent(), '−2');
    assert.ok(await card.getByRole('button', { name: '马尾 / 发梢 · 删除详情' }).isVisible());
    assert.equal(await page.evaluate(() => ask.externalSnapshot().base.layer.todos.length), 2);
    await (await openApplyMenu(page)).getByRole('menuitem', { name: '放弃草稿' }).click();
    await options.click();
    await memo.getByRole('menuitem', { name: '删除拆件待办' }).click();
    const confirm = card.getByRole('button', { name: '确认删除', exact: true });
    await confirm.click();
    await page.waitForFunction(() => !ask.writingDraft.value && !ask.draftPlan.value);
    assert.equal(await memo.count(), 0);
    if (!mobile) assert.equal(await page.evaluate(() => ask.activeSlate.value.title), '会话构图');
    await undoCheckpoint(page);
    const restored = await page.evaluate(() => ask.externalSnapshot().base.layer.todos);
    assert.deepEqual(restored.map(t => [t.id, t.done, t.layerId ?? t.parent, t.prompt]),
      [['p', true, 'hair', '保留外形'], ['c', false, 'p', '细拆发梢']]);
    await restoreCheckpoint(page);
    await page.reload();
    await openLayer(page);
    assert.equal(await page.getByRole('button', { name: /在 ASK 查看拆件待办/ }).count(), 0);
    assert.equal(await page.locator('.layer-stack-meta strong').textContent(), '右马尾');
    if (mobile) await page.getByRole('tab', { name: /拆层/ }).click();
    assert.equal(await page.getByLabel('拆层说明', { exact: true }).inputValue(), '保留表单词');
    await page.getByRole('combobox', { name: '切换分件项目' }).selectOption('other');
    await page.getByRole('button', { name: /在 ASK 查看拆件待办/ }).click();
    assert.equal(await memo.locator('.todos-progress small').textContent(), '1/2');
    assert.equal(f.calls.length, 0);
    assert.deepEqual(generation(f.requests), []);
    assert.deepEqual(f.errors, []);
  });
}

for (const width of [1440, 390]) {
  test(`candidate layer order · ${width === 390 ? 'mobile BETA arrows' : 'desktop drag'} · preview, history and partial admission`, async t => {
    const mobile = width === 390;
    const f = await open('/#/edit', { ready: '#imageEditor', width, touch: mobile });
    t.after(() => f.context.close());
    const page = f.page;
    await page.evaluate(async mobile => {
      const { newProject } = await import('/src/layer/project.ts');
      const { splitSource } = await import('/src/layer/recursive.ts');
      const { layerStorage } = await import('/src/layer/storage.ts');
      const providers = document.body.__vue_app__._context.provides;
      const store = layerStorage(providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')]);
      const raster = red => ({ width: 1, height: 1, data: new Uint8Array([red, 80, 160, 255]) });
      const p = newProject('order', '候选层序', raster(0));
      const layers = ['残余底图', '右马尾', '袖子'].map((name, i) => ({
        id: name, name, zIndex: i ? 5 : 0, isBase: !i, source: 'decompose', local: true,
        width: 1, height: 1, raster: raster(i * 100), preview: raster(i * 100),
        box: { x: 0, y: 0, width: 1, height: 1 },
      }));
      // Persist the pre-sorter checkpoint format, with duplicate provider depths.
      const batch = { id: 'first', targetName: '全身', model: 'test', route: 'test', prompt: '', source: splitSource(p), layers };
      p.pendingSplit = { batch, selected: ['右马尾', '袖子'], archive: false };
      p.otherSplits = [{ batch: { ...batch, id: 'other', layers: [layers[0]] }, selected: [], archive: false }];
      await store.save(p);
      if (mobile) localStorage.setItem('koma.image.layout.v1', JSON.stringify({ enabled: true }));
    }, mobile);
    if (mobile) await page.reload();
    await openLayer(page);
    const panel = page.locator('#imageEditor');
    const pool = panel.getByRole('region', { name: '本次拆层候选池' });
    const row = name => pool.locator('.layer-pool-item').filter({ has: page.getByText(name, { exact: true }) });
    const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
    const tool = name => page.getByRole('toolbar', { name: '分件画布工具' }).getByRole('button', { name, exact: true });
    const views = page.getByRole('radiogroup', { name: '分件画布视图' });
    const order = () => pool.locator('.layer-pool-meta strong').allTextContents();
    const pixel = () => page.locator('canvas.layer-surface').evaluate(el => el.getContext('2d').getImageData(0, 0, 1, 1).data[0]);
    assert.equal(await pixel(), 200);
    assert.ok(await pool.getByRole('button', { name: '上移候选层 袖子' }).isDisabled());
    assert.ok(await pool.getByRole('button', { name: '下移候选层 残余底图' }).isDisabled());
    await row('右马尾').getByRole('checkbox').uncheck();
    if (mobile) {
      await views.getByText('原图', { exact: true }).tap();
      assert.equal(await pixel(), 0);
      await views.getByText('拆分结果', { exact: true }).tap();
      assert.equal(await pixel(), 200);
      await pool.getByRole('button', { name: '上移候选层 右马尾' }).tap();
    } else {
      await views.getByText('原图', { exact: true }).click();
      assert.equal(await pixel(), 0);
      await row('右马尾').dispatchEvent('dragstart');
      await row('袖子').dispatchEvent('dragover');
      assert.equal(await pixel(), 100);
      await row('右马尾').dispatchEvent('dragend');
      assert.equal(await pixel(), 0);
      await row('右马尾').dragTo(row('袖子'));
    }
    await done();
    assert.deepEqual(await order(), ['右马尾', '袖子', '残余底图']);
    assert.equal(await row('右马尾').getByRole('checkbox').isChecked(), false);
    assert.equal(await pixel(), 100);
    await pool.getByRole('button', { name: '独显候选层 袖子' }).click();
    await tool('撤销').click();
    await done();
    assert.deepEqual(await order(), ['袖子', '右马尾', '残余底图']);
    assert.equal(await pool.getByRole('button', { name: '独显候选层 袖子' }).getAttribute('aria-pressed'), 'true');
    const batchPicker = panel.getByLabel('切换待筛批次');
    await batchPicker.selectOption('other');
    await tool('重做').click();
    await done();
    assert.deepEqual(await order(), ['残余底图']);
    await batchPicker.selectOption('first');
    await done();
    await page.reload();
    await openLayer(page);
    assert.deepEqual(await order(), ['右马尾', '袖子', '残余底图']);
    assert.equal(await row('残余底图').getByRole('checkbox').isChecked(), false);
    assert.equal(await row('右马尾').getByRole('checkbox').isChecked(), false);
    const admit = pool.getByRole('button', { name: '收纳进图层栈 (1)' });
    await admit.click();
    await done();
    await pool.getByRole('button', { name: '显隐候选层 右马尾' }).click();
    assert.equal(await pixel(), 200); // The admitted sleeve remains underneath in the same batch.
    await pool.getByRole('button', { name: '显隐候选层 右马尾' }).click();
    assert.equal(await pixel(), 100);
    await row('右马尾').getByRole('checkbox').check();
    await admit.click();
    await done();
    if (mobile) await panel.getByRole('tab', { name: /图层/ }).click();
    assert.deepEqual(await panel.locator('.layer-stack-meta strong').allTextContents(), ['右马尾', '袖子']);
    assert.equal(await pixel(), 100);
    if (mobile) await panel.getByRole('tab', { name: /拆层/ }).click();
    assert.deepEqual(await order(), ['残余底图']);
    assert.deepEqual(generation(f.requests), []);
    assert.deepEqual(f.errors, []);
  });
}

test('candidate alignment fits saved face parts, clips a static copy, preserves original and exports matching pixels', async t => {
  const f = await open('/#/edit', { ready: '#imageEditor' });
  t.after(() => f.context.close());
  const page = f.page;
  await page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const { newProject } = await import('/src/layer/project.ts');
    const { splitSource } = await import('/src/layer/recursive.ts');
    const providers = document.body.__vue_app__._context.provides;
    const store = layerStorage(providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')]);
    const p = newProject('alignment', '脸', { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4) });
    const layer = (id, name, x, y, width, height, zIndex, color) => {
      const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => color[i % 4]);
      const raster = { width, height, data };
      return { id, name, width: 1024, height: 1024, zIndex, local: true, isBase: false, source: 'decompose',
        box: { x, y, width, height }, raster, preview: raster };
    };
    const layers = [layer('white','眼白',4,5,4,2,1,[255,255,255,128]), layer('iris','虹膜',4,3,4,6,2,[80,100,120,200])];
    p.pendingSplit = { batch: { id: 'face', targetName: '脸', source: splitSource(p), model: 'mock', route: 'mock', prompt: '', layers },
      selected: ['white','iris'], archive: false };
    await store.save(p);
  });
  await openLayer(page);
  const panel = page.locator('#imageEditor'), pool = panel.getByRole('region', { name: '本次拆层候选池' });
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const fit = pool.getByRole('group', { name: '虹膜 校准' });
  const iris = pool.getByRole('button', { name: '校准候选层 虹膜', exact: true });
  const pixel = (x,y) => page.locator('canvas.layer-surface').evaluate((c,[x,y]) => [...c.getContext('2d').getImageData(x,y,1,1).data], [x,y]);
  await iris.click();
  assert.equal(await fit.getByLabel('原画布 宽').inputValue(), '4');
  await fit.getByLabel('原画布 X').fill('5');
  await fit.getByLabel('原画布 宽').fill('3');
  await fit.getByRole('button', { name: '应用位置与尺寸' }).click();
  await done();
  assert.equal((await pixel(4,3))[3], 0);
  assert.equal((await pixel(5,3))[3], 200);
  await fit.getByLabel('原画布 宽').fill('4');
  await fit.getByRole('button', { name: '应用位置与尺寸' }).click();
  await done();
  await fit.getByLabel('裁片轮廓').selectOption('white');
  await fit.getByRole('button', { name: '另存可见裁片' }).click();
  await done();
  assert.equal((await pixel(5,3))[3], 0);
  assert.equal(await pool.getByLabel('勾选候选层 虹膜', { exact: true }).isChecked(), false);
  const dock = page.getByRole('toolbar', { name: '分件画布工具' });
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  assert.equal((await pixel(5,3))[3], 200);
  await dock.getByRole('button', { name: '重做', exact: true }).click();
  await done();
  await page.reload();
  await openLayer(page);
  assert.equal(await pool.getByLabel('勾选候选层 虹膜 · 可见裁片').isChecked(), true);
  await pool.getByRole('button', { name: '独显候选层 虹膜 · 可见裁片', exact: true }).click();
  assert.equal((await pixel(5,5))[3], 100);
  await pool.getByRole('button', { name: '收纳进图层栈 (2)' }).click();
  await done();
  assert.deepEqual(await pool.locator('.layer-pool-meta strong').allTextContents(), ['虹膜']);
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出 Rig 切片包', exact: true }).click();
  const archive = await readArchive(new Blob([await readFile(await (await download).path())]));
  const manifest = JSON.parse(await (await archive.read('manifest.json')).text());
  const clipped = manifest.layers.find(l => l.name === '虹膜 · 可见裁片');
  assert.deepEqual(clipped.rect, [5,5,3,2]);
  const texture = decode(new Uint8Array(await (await archive.read(clipped.texture)).arrayBuffer()));
  assert.deepEqual([...texture.data.slice(0,4)], [80,100,120,100]);
  assert.deepEqual(generation(f.requests), []);
  assert.deepEqual(f.errors, []);
});

test('PS-like Layer Stack: Z-order, visibility/solo/lock/rename/duplicate/merge/delete, Tier-1 rect split, soft eraser, restore-from-ref, color align, move snap-back & persistence', async (t) => {
  const f = await open('/#/edit', {
    ready: '#imageEditor',
    standard: true,
    chatModel: true,
    editModels: true,
  });
  t.after(() => f.context.close());
  const page = f.page;
  const panel = page.locator('#imageEditor');
  const dock = page.getByRole('toolbar', { name: '分件画布工具' });
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const canvas = page.locator('canvas.layer-surface');
  const pixelAt = (x, y) =>
    canvas.evaluate((el, [px, py]) => [...el.getContext('2d').getImageData(px, py, 1, 1).data], [x, y]);

  // Seed a v2 project directly in IndexedDB with a master reference and 2 formal stack layers:
  // - Layer 0 ("双马尾"): left block [10..34, 20..76] & right block [62..86, 20..76] in light gray (color-shifted -20 from reference)
  // - Layer 1 ("红袖子"): overlapping block [24..54, 34..62] in red
  await page.evaluate(async () => {
    const { newProject } = await import('/src/layer/project.ts');
    const { layerStorage } = await import('/src/layer/storage.ts');
    const providers = document.body.__vue_app__._context.provides;
    const store = layerStorage(
      providers[
        Object.getOwnPropertySymbols(providers).find((k) => k.description === 'application-services')
      ],
    );
    const W = 96,
      H = 96;
    const refData = new Uint8Array(W * H * 4);
    for (let y = 10; y < 86; y++) {
      for (let x = 8; x < 88; x++) {
        refData.set([170, 175, 185, 255], (y * W + x) * 4);
      }
    }
    const p = newProject('ps-stack-demo', '立绘分件测试', { width: W, height: H, data: refData });
    // Layer 0: 双马尾 (two disconnected halves on one layer, slightly darker than ref for tone-match check)
    const hairW = 76,
      hairH = 56;
    const hairPx = new Uint8Array(hairW * hairH * 4);
    for (let y = 0; y < hairH; y++) {
      for (let x = 0; x < hairW; x++) {
        if (x < 24 || x >= 52) hairPx.set([140, 145, 155, 255], (y * hairW + x) * 4);
      }
    }
    // Layer 1: 红袖子 (overlaps left twintail at x=24..34, y=34..62)
    const sleeveW = 30,
      sleeveH = 28;
    const sleevePx = new Uint8Array(sleeveW * sleeveH * 4);
    for (let i = 0; i < sleeveW * sleeveH; i++) sleevePx.set([210, 60, 60, 255], i * 4);

    p.layers = [
      {
        id: 'layer-hair',
        name: '双马尾',
        x: 10,
        y: 20,
        width: hairW,
        height: hairH,
        pixels: hairPx,
        visible: true,
        locked: false,
      },
      {
        id: 'layer-sleeve',
        name: '红袖子',
        x: 24,
        y: 34,
        width: sleeveW,
        height: sleeveH,
        pixels: sleevePx,
        visible: true,
        locked: false,
      },
    ];
    p.activeLayerId = 'layer-sleeve';
    await store.save(p);
  });

  await openLayer(page);
  assert.equal(await panel.locator('.layer-stack-row').count(), 2);

  // 1. Live composite & Compare Reference toggle
  assert.deepEqual(await pixelAt(28, 45), [210, 60, 60, 255]); // red sleeve on top of hair
  assert.deepEqual(await pixelAt(70, 45), [140, 145, 155, 255]); // right twintail
  const views = page.getByRole('radiogroup', { name: '分件画布视图' });
  assert.equal(await views.getByRole('radio', { name: '图层合成' }).isChecked(), true);
  await views.getByText('原图', { exact: true }).click();
  assert.deepEqual(await pixelAt(28, 45), [170, 175, 185, 255]); // locked reference
  await views.getByText('图层合成', { exact: true }).click();
  assert.deepEqual(await pixelAt(28, 45), [210, 60, 60, 255]);

  const sleeveRow = panel.locator('.layer-stack-row').filter({ hasText: '红袖子' }),
    hairRow = panel.locator('.layer-stack-row').filter({ hasText: '双马尾' });
  await sleeveRow.dispatchEvent('dragstart');
  await hairRow.dispatchEvent('dragover');
  assert.deepEqual(await pixelAt(28, 45), [140, 145, 155, 255]);
  await sleeveRow.dispatchEvent('dragend');
  assert.deepEqual(await pixelAt(28, 45), [210, 60, 60, 255]);

  // 2. Z-Order reorder: move "红袖子" down below "双马尾" -> overlap flips to gray hair!
  await panel.getByRole('button', { name: '下移一层', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(28, 45), [140, 145, 155, 255]);

  // 3. Solo (S) & Visibility (👁) & Lock (🔒)
  await panel.getByRole('button', { name: '独显 红袖子', exact: true }).click();
  assert.deepEqual(await pixelAt(28, 45), [210, 60, 60, 255]);
  assert.deepEqual(await pixelAt(70, 45), [0, 0, 0, 0]);
  await panel.getByRole('button', { name: '独显 红袖子', exact: true }).click(); // exit solo
  assert.deepEqual(await pixelAt(70, 45), [140, 145, 155, 255]);

  await panel.getByRole('button', { name: '显隐 双马尾', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(70, 45), [0, 0, 0, 0]);
  await panel.getByRole('button', { name: '显隐 双马尾', exact: true }).click();
  await done();

  await panel.getByRole('button', { name: '锁定 红袖子', exact: true }).click();
  await done();
  assert.equal(await panel.getByRole('button', { name: '删除图层', exact: true }).isDisabled(), true);
  await panel.getByRole('button', { name: '锁定 红袖子', exact: true }).click();
  await done();

  // 4. Inline rename, duplicate, and merge down (via row context menu)
  await panel.getByRole('button', { name: '更多操作 红袖子', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const renameInput = panel.getByLabel('输入新图层名称', { exact: true });
  await renameInput.fill('外套左袖');
  await renameInput.press('Enter');
  await done();
  await panel.locator('.layer-stack-row', { hasText: '外套左袖' }).waitFor();

  await panel.getByRole('button', { name: '更多操作 外套左袖', exact: true }).click();
  await page.getByRole('menuitem', { name: '复制', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 3);
  await panel.getByRole('button', { name: '更多操作 外套左袖 副本', exact: true }).click();
  await page.getByRole('menuitem', { name: '向下合并', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 2);

  // 5. Tier-1 Zero-AI Split: select "双马尾", draw rect over right half, split into 2 layers!
  await panel.locator('.layer-stack-row', { hasText: '双马尾' }).click();
  await done();
  await dock.getByRole('button', { name: '框选拆分', exact: true }).click();
  const box = await canvas.boundingBox();
  const toScreen = (cx, cy) => ({ x: box.x + (cx / 96) * box.width, y: box.y + (cy / 96) * box.height });
  const r0 = toScreen(56, 12);
  const r1 = toScreen(92, 84);
  await page.mouse.move(r0.x, r0.y);
  await page.mouse.down();
  await page.mouse.move(r1.x, r1.y);
  await page.mouse.up();
  await page.getByRole('button', { name: '拆分为新图层', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 3); // 外套左袖 + 双马尾 (left) + 双马尾 · 拆分 (right)

  // 6. One-click color alignment on active right twintail (from 140,145,155 -> 170,175,185) + reversible slider
  await panel.getByRole('button', { name: '精修', exact: true }).click();
  await panel.getByRole('button', { name: '一键色彩对齐原画', exact: true }).click();
  await done();
  const aligned = await pixelAt(70, 45);
  assert.ok(Math.abs(aligned[0] - 170) <= 2 && Math.abs(aligned[1] - 175) <= 2, JSON.stringify(aligned));

  // 7. Soft Eraser + Restore-from-Reference Brush + Stack Undo/Redo
  await dock.getByRole('button', { name: '橡皮', exact: true }).click();
  await page.getByRole('slider', { name: '画笔直径' }).fill('16');
  await page.getByRole('slider', { name: '画笔硬度' }).fill('0');
  const erasePt = toScreen(74, 45);
  await page.mouse.click(erasePt.x, erasePt.y);
  await done();
  assert.ok((await pixelAt(74, 45))[3] < 20);

  // Restore lossless pixels from reference back onto active layer
  await dock.getByRole('button', { name: '刷回原图', exact: true }).click();
  await page.getByRole('slider', { name: '画笔硬度' }).fill('1');
  await page.mouse.click(erasePt.x, erasePt.y);
  await done();
  assert.deepEqual(await pixelAt(74, 45), [170, 175, 185, 255]);

  // Undo restores the erased hole, Redo brings reference pixels back
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  assert.ok((await pixelAt(74, 45))[3] < 20);
  await dock.getByRole('button', { name: '重做', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(74, 45), [170, 175, 185, 255]);

  // 7b. Smudge / Edge Bleed Brush: pull right edge of active twintail (x=86) past its cropped rect to x=92
  assert.deepEqual(await pixelAt(90, 45), [0, 0, 0, 0]);
  await dock.getByRole('button', { name: '拽边笔', exact: true }).click();
  await page.getByRole('slider', { name: '拽边笔径' }).fill('12');
  await page.getByRole('slider', { name: '拽边强度' }).fill('0.92');
  const s0 = toScreen(82, 45);
  const s1 = toScreen(92, 45);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  await page.mouse.move(s1.x, s1.y, { steps: 6 });
  await page.mouse.up();
  await done();
  const smudgedPx = await pixelAt(90, 45);
  assert.ok(smudgedPx[3] > 30, `expected smudged bleed pixel alpha > 30, got ${JSON.stringify(smudgedPx)}`);
  assert.ok(Math.abs(smudgedPx[0] - 170) <= 6, `expected no dark fringe on bleed, got ${JSON.stringify(smudgedPx)}`);
  // Undo reverts expanded smudge, Redo restores it
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(90, 45), [0, 0, 0, 0]);
  await dock.getByRole('button', { name: '重做', exact: true }).click();
  await done();
  assert.ok((await pixelAt(90, 45))[3] > 30);

  // 8. Move Preview: drag snaps back by default, commits when "松手保留偏移" is checked
  await dock.getByRole('button', { name: '移动', exact: true }).click();
  const beforeMove = await canvas.evaluate((el) => el.toDataURL());
  const m0 = toScreen(74, 45);
  const m1 = toScreen(54, 45);
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m1.x, m1.y);
  assert.notEqual(await canvas.evaluate((el) => el.toDataURL()), beforeMove);
  await page.mouse.up();
  assert.equal(await canvas.evaluate((el) => el.toDataURL()), beforeMove); // snapped back!

  // 9. Reload persistence + Rig ZIP & PSD downloads
  await page.reload();
  await openLayer(page);
  assert.equal(await panel.locator('.layer-stack-row').count(), 3);

  const zipPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出 Rig 切片包', exact: true }).click();
  const archive = await readArchive(new Blob([await readFile(await (await zipPromise).path())]));
  const manifest = JSON.parse(await (await archive.read('manifest.json')).text());
  assert.equal(manifest.format, 'koma-rig.slices.v2');
  assert.equal(manifest.layers.length, 3);
  assert.ok(manifest.layers.every((l) => archive.has(l.texture)));
  const smudgedExport = manifest.layers.find((l) => l.name.includes('拆分'));
  assert.ok(
    smudgedExport && smudgedExport.rect[0] + smudgedExport.rect[2] > 88,
    `expected exported rect to expand past original x+w=86, got ${JSON.stringify(smudgedExport?.rect)}`,
  );

  const psdPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '更多导出方式', exact: true }).click();
  await page.getByRole('menuitem', { name: /导出分层 PSD/ }).click();
  assert.equal((await readFile(await (await psdPromise).path())).toString('ascii', 0, 4), '8BPS');

  // 10. Optimistic revision lock prevents concurrent clobbering
  const statuses = await page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const providers = document.body.__vue_app__._context.provides;
    const db = layerStorage(
      providers[
        Object.getOwnPropertySymbols(providers).find((k) => k.description === 'application-services')
      ],
    );
    const cur = await db.read((await db.list())[0].id);
    return (
      await Promise.allSettled([db.save({ ...cur, title: 'one' }), db.save({ ...cur, title: 'two' })])
    )
      .map((r) => r.status)
      .sort();
  });
  assert.deepEqual(statuses, ['fulfilled', 'rejected']);
  assert.deepEqual(f.errors, []);
});

test('opaque artwork shows optional background removal hint without blocking Seedream decompose', async (t) => {
  const f = await open('/#/edit', { ready: '#imageEditor', standard: true, editModels: true });
  t.after(() => f.context.close());
  const p = f.page;
  await openLayer(p);
  const panel = p.locator('.layer-panel');
  const solid = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) solid.set([220, 220, 220, 255], i * 4);
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({
    name: 'opaque.png',
    mimeType: 'image/png',
    buffer: rgba(64, 64, solid),
  });
  await p.locator('.layer-panel[aria-busy="false"]').waitFor();
  await panel.locator('.layer-banner', { hasText: '定稿无透明外缘' }).waitFor();
  // Mode tabs and Seedream decompose section remain immediately accessible (non-blocking).
  await panel.getByRole('tab', { name: '自动拆层', exact: true }).waitFor();
  assert.deepEqual(f.errors, []);
});

test('Koma Layer Photopea round-trip keeps a merged middle layer in the original folder and confirms before undoing', async (t) => {
  const f = await open('/#/edit', { ready: '#imageEditor', standard: true, editModels: true });
  t.after(() => f.context.close());
  const page = f.page;
  const panel = page.locator('#imageEditor');
  const dock = page.getByRole('toolbar', { name: '分件画布工具' });
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const canvas = page.locator('canvas.layer-surface');
  const pixelAt = (x, y) =>
    canvas.evaluate((el, [px, py]) => [...el.getContext('2d').getImageData(px, py, 1, 1).data], [x, y]);

  // Intercept Photopea iframe with a lightweight layer-exporting test double.
  const stub = String.raw`<!doctype html><html lang="zh"><body>Photopea Layer stub<script>
const config = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const session = JSON.parse(config.environment.customIO.save.match(/koma:("[^"]+")/)[1]);
let source, width = 96, height = 96, openedPsdHeader = '';
async function makeRectPng(x0, y0, w, h, color) {
  const c = new OffscreenCanvas(width, height), ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(x0, y0, w, h);
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
function minimalPsd() {
  const b = new Uint8Array(64);
  b.set([56, 66, 80, 83, 0, 1], 0);
  return b.buffer;
}
addEventListener('message', async (e) => {
  const send = (d) => parent.postMessage(d, e.origin);
  if (e.data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(e.data);
    if (bytes[0] === 56 && bytes[1] === 66 && bytes[2] === 80 && bytes[3] === 83) {
      openedPsdHeader = '8BPS';
    }
    send('done');
    return;
  }
  if (typeof e.data !== 'string') return;
  const command = Number(e.data.match(/command:(\d+)/)?.[1]);
  const reply = (event, detail) => send(JSON.stringify({ koma: session, command, event, detail }));
  reply('start');
  const m = e.data.match(/d\.source=("[^"]+")/);
  if (m) source = JSON.parse(m[1]);
  if (e.data.includes('reply("layerState"') && !e.data.includes('reply("project")')) {
    reply('layerState', { refId: 1, width, height });
  } else if (e.data.includes('reply("project")')) {
    reply('document', source);
    reply('layerState', { refId: 1, width, height });
    reply('project');
    send(minimalPsd());
  } else if (e.data.includes('reply("layerTree"')) {
    reply('document', source);
    const groups = [{ id: 7, name: '头部', visible: true }, { id: 6, name: '头发', visible: true }];
    reply('layerTree', {
      width,
      height,
      items: [
        { id: 4, name: '旧头发', groups, visible: true, locked: false },
        { id: 11, name: '发顶', groups, visible: true, locked: false },
        { id: 5, name: '旧发饰', groups, visible: true, locked: false },
      ],
      skipped: [],
    });
    reply('layer');
    send(await makeRectPng(12, 12, 24, 24, 'rgba(130, 140, 210, 1)'));
    reply('layer');
    send(await makeRectPng(56, 20, 20, 20, 'rgba(235, 90, 130, 1)'));
    reply('layer');
    send(await makeRectPng(40, 56, 24, 24, 'rgba(100, 110, 150, 1)'));
  }
  reply('complete');
  send('done');
});
parent.postMessage('done', '*');
</script></body></html>`;

  await page.route('https://www.photopea.com/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: stub }),
  );

  // The exported PSD IDs place the two original layers in one nested group and 发顶 in another.
  await page.evaluate(async () => {
    const { newProject } = await import('/src/layer/project.ts');
    const { layerStorage } = await import('/src/layer/storage.ts');
    const providers = document.body.__vue_app__._context.provides;
    const store = layerStorage(
      providers[
        Object.getOwnPropertySymbols(providers).find((k) => k.description === 'application-services')
      ],
    );
    const W = 96,
      H = 96;
    const refData = new Uint8Array(W * H * 4);
    for (let y = 10; y < 86; y++)
      for (let x = 10; x < 86; x++) refData.set([180, 180, 185, 255], (y * W + x) * 4);
    const p = newProject('pp-roundtrip', 'Photopea 往返', { width: W, height: H, data: refData });
    const px = new Uint8Array(24 * 24 * 4);
    for (let i = 0; i < 24 * 24; i++) px.set([100, 110, 150, 255], i * 4);
    const part = (id, name, x, y, groups, groupIds) => ({
      id, name, x, y, groups, groupIds, width: 24, height: 24, pixels: px, visible: true, locked: false,
    });
    p.layers = [
      part('orig-hair', '旧头发', 12, 12, ['头部', '头发'], ['head', 'hair']),
      part('orig-accessory', '旧发饰', 40, 56, ['头部', '头发'], ['head', 'hair']),
      part('orig-cap', '发顶', 56, 20, ['发顶原组'], ['cap']),
    ];
    p.activeLayerId = 'orig-hair';
    await store.save(p);
  });

  await openLayer(page);
  assert.equal(await panel.locator('.layer-stack-row').count(), 3);
  assert.equal(await panel.locator('.layer-group-row').count(), 3);
  assert.deepEqual(await pixelAt(20, 20), [100, 110, 150, 255]);

  // 1. Open Photopea from Koma Layer: single apply button (no editor return-mode dropdown).
  await panel.getByRole('button', { name: 'Photopea 精修', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.photopea-panel') && !document.querySelector('.photopea-loading'),
  );
  assert.equal(await page.locator('.photopea-choice').count(), 0);

  // 2. The merged layer belongs between two surviving layers in the target folder.
  await page.getByRole('button', { name: '应用并返回', exact: true }).click();
  await page.waitForSelector('.photopea-panel', { state: 'hidden' });
  await done();

  assert.equal(await panel.locator('.layer-group-row').count(), 2); // 头部 & 头发
  assert.equal(await panel.locator('.layer-group-row', { hasText: '发顶原组' }).count(), 0);
  assert.equal(await panel.locator('.layer-stack-row').count(), 3);
  assert.equal(await panel.locator('.layer-change-badge', { hasText: '新增' }).count(), 1);
  assert.equal(await panel.locator('.layer-change-badge', { hasText: '已修' }).count(), 1);
  assert.deepEqual(await pixelAt(20, 20), [130, 140, 210, 255]);
  assert.deepEqual(await pixelAt(64, 28), [235, 90, 130, 255]);

  // 3. Group visibility & collapse
  await panel.getByRole('button', { name: '显隐分组 头部', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(20, 20), [0, 0, 0, 0]);
  assert.deepEqual(await pixelAt(64, 28), [0, 0, 0, 0]);
  await panel.getByRole('button', { name: '显隐分组 头部', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(64, 28), [235, 90, 130, 255]);

  await panel.locator('.layer-group-row', { hasText: '头发' }).click();
  assert.equal(await panel.locator('.layer-stack-row').count(), 0);
  await panel.locator('.layer-group-row', { hasText: '头发' }).click();
  assert.equal(await panel.locator('.layer-stack-row').count(), 3);

  // 4. Group PopoverMenu supports deleting the entire group (and undoing cleanly).
  await panel.getByRole('button', { name: '分组操作 头部', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除整组', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-group-row').count(), 0);
  assert.equal(await panel.locator('.layer-stack-row').count(), 0);
  // Undo restores the whole group.
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-group-row').count(), 2);
  assert.equal(await panel.locator('.layer-stack-row').count(), 3);

  // 5. Rig ZIP export preserves nested groups in manifest.json
  const zipPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出 Rig 切片包', exact: true }).click();
  const archive = await readArchive(new Blob([await readFile(await (await zipPromise).path())]));
  const manifest = JSON.parse(await (await archive.read('manifest.json')).text());
  assert.deepEqual(manifest.layers.map(l => l.name), ['旧头发', '发顶', '旧发饰']);
  assert.deepEqual(manifest.layers.map(l => l.groups), Array.from({ length: 3 }, () => ['头部', '头发']));
  assert.equal(new Set(manifest.layers.map(l => l.groupId)).size, 1);

  // 6. Undo back to pre-Photopea requires confirmation.
  // First undo the two group-visibility toggles to reach the Photopea sync snapshot.
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  // Now we are on the 'Photopea 精修' snapshot: clicking undo pops confirm dialog!
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByText('撤回本次 Photopea 精修？', { exact: true }).waitFor();
  // Cancel keeps Photopea result intact
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await panel.locator('.layer-group-row').count(), 2);
  // Confirm restores the original folder and pixels.
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '撤回', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 3);
  assert.equal(await panel.locator('.layer-group-row', { hasText: '发顶原组' }).count(), 1);
  assert.deepEqual(await pixelAt(20, 20), [100, 110, 150, 255]);
  assert.deepEqual(await pixelAt(64, 28), [100, 110, 150, 255]);
  assert.deepEqual(f.errors, []);
});

test('Layer ASK sends master pixels only when view_image is requested', async (t) => {
  const f = await open('/#/edit', { ready: '#imageEditor', ask: askSettings() });
  t.after(() => f.context.close());
  const { page, llm, calls } = f;
  await openLayer(page);
  await page.getByLabel('打开定稿', { exact: true }).setInputFiles({
    name: 'eye.png',
    mimeType: 'image/png',
    buffer: rgba(20, 20, new Uint8Array(1600).fill(255)),
  });
  await page.locator('.layer-panel[aria-busy="false"]').waitFor();
  await bind(page);
  llm.push(toolReply('inspect', 'view_image', { id: '#layer', spec: 'glance' }));
  await askText(page, llm, '请看分件母版，描述可拆部位。');
  assert.ok(calls.length >= 2);
  assert.equal(imageBlocks(calls[0].body).length, 0);
  assert.equal(imageBlocks(calls[1].body).length, 1);
  assert.deepEqual(generation(f.requests), []);
  assert.deepEqual(f.errors, []);
});

test('scalpel references survive reload; ASK inspects a real source on demand and drafts reversible reference usages without generating', async t => {
  const f = await open('/#/edit', { ready: '#imageEditor', ask: askSettings() });
  t.after(() => f.context.close());
  const { page, llm, calls } = f;
  await page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const { newProject } = await import('/src/layer/project.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const p = newProject('ref-cases', '头部', { width:32, height:32, data:new Uint8Array(4096).fill(255) });
    const pixels = Uint8Array.from({ length: 8 * 16 * 4 }, (_,i) => [2,225,12,255][i%4]);
    p.layers = [{ id:'tail', name:'左马尾', x:24, y:16, width:8, height:16, pixels, visible:false, locked:true },
      { id:'clip', name:'发夹', groups:['头饰'], x:4, y:5, width:8, height:16, pixels, visible:true, locked:false }];
    await layerStorage(app).save(p);
  });
  await openLayer(page);
  const panel = page.locator('.layer-panel');
  const scalpel = () => panel.getByRole('tab', { name:'局部补画' }).click();
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  await scalpel();
  const bytes = Uint8Array.from({ length:8*4*4 }, (_,i) => [220,2,60,255][i%4]);
  await panel.getByLabel('导入补画参考图').setInputFiles({ name:'发色.png', mimeType:'image/png', buffer:rgba(8,4,bytes) });
  await done();
  await panel.getByLabel('参考用途 发色.png').fill('发梢颜色');
  await panel.getByLabel('参考用途 发色.png').blur();
  await done();
  await page.reload(); await openLayer(page); await scalpel();
  assert.equal(await panel.getByLabel('参考用途 发色.png').inputValue(), '发梢颜色');
  await bind(page);
  await panel.getByRole('button', { name:'让 ASK 拟词' }).click();
  assert.match(await page.locator('#askPrompt').inputValue(), /参考图层/);
  await page.evaluate(() => ask.hide());
  await panel.getByRole('button', { name:'让 ASK 选层' }).click();
  assert.match(await page.locator('#askPrompt').inputValue(), /补画底图选择草稿/);
  assert.equal(calls.length, 0);
  llm.push(toolReply('inspect-tail', 'view_image', { id:'#lref-layer-tail', spec:'look' }));
  await askText(page, llm, '看看马尾参考层的颜色。');
  const meta = wireStates(calls[0].body).at(-1).layer.scalpel;
  assert.equal(meta.sourceLayerIds, null);
  assert.deepEqual(meta.sources.map(s => [s.name,s.width,s.height]), [['发色.png',8,4], ['头饰 / 发夹',8,16], ['左马尾',8,16]]);
  assert.equal(meta.references[0].usage, '发梢颜色');
  assert.equal(imageBlocks(calls[0].body).length, 0);
  const [seen] = imageBlocks(calls[1].body);
  const rgb = await page.evaluate(async url => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const ctx = new OffscreenCanvas(1,1).getContext('2d');
    ctx.drawImage(bitmap,0,0,1,1); bitmap.close();
    return [...ctx.getImageData(0,0,1,1).data];
  }, seen.image_url.url);
  assert.ok(rgb[1] > 190 && rgb[0] < 32 && rgb[2] < 32);
  await askDraft(page, llm, [
    { kind:'layer_scalpel_source', layer_ids:['tail','clip'] },
    { kind:'layer_references', references:[{ picture:'#lref-layer-tail', usage:'参考发束走向' }] },
    { kind:'layer_prompt', target:'scalpel', prompt:'沿左马尾的发束走向接通橙区。' },
  ], '单独补画左马尾和发夹，同时用左马尾作为参考，帮我填词');
  const source = panel.getByRole('region',{name:'补画底图'});
  assert.equal(await source.getByRole('button',{name:'母版'}).getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.getByLabel('参考用途 左马尾').count(), 0);
  await applyDraft(page);
  assert.equal(await source.getByLabel('左马尾').isChecked(), true);
  assert.equal(await source.getByLabel('头饰 / 发夹').isChecked(), true);
  assert.equal(await panel.getByLabel('参考用途 左马尾').inputValue(), '参考发束走向');
  await undoCheckpoint(page);
  assert.equal(await source.getByRole('button',{name:'母版'}).getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.getByLabel('参考用途 发色.png').inputValue(), '发梢颜色');
  await restoreCheckpoint(page);
  await page.evaluate(() => ask.hide());
  await page.reload(); await openLayer(page); await scalpel();
  assert.equal(await source.getByLabel('头饰 / 发夹').isChecked(), true);
  assert.equal(await panel.getByLabel('参考用途 左马尾').inputValue(), '参考发束走向');
  assert.match(await panel.getByLabel('补充描述').inputValue(), /沿左马尾/);
  await bind(page);
  await askDraft(page, llm, [
    { kind:'layer_scalpel_source', mode:'missing', component:'耳朵', layer_ids:['tail','clip'] },
    { kind:'layer_prompt', target:'scalpel', prompt:'补全头发后面藏住的耳根。' },
  ], '参考头发和发夹补一只耳朵，帮我选层和拟词');
  assert.equal(await panel.getByLabel('部件名称').inputValue(), '');
  await applyDraft(page);
  const missing = panel.getByRole('region', { name:'缺失件底图' });
  assert.equal(await missing.getByLabel('左马尾').isChecked(), true);
  assert.equal(await missing.getByLabel('头饰 / 发夹').isChecked(), true);
  assert.equal(await panel.getByLabel('部件名称').inputValue(), '耳朵');
  assert.match(await panel.getByLabel('补充描述').inputValue(), /耳根/);
  await undoCheckpoint(page);
  assert.equal(await panel.getByLabel('部件名称').inputValue(), '');
  assert.equal(await source.getByLabel('左马尾').isChecked(), true);
  assert.match(await panel.getByLabel('补充描述').inputValue(), /沿左马尾/);
  assert.deepEqual(generation(f.requests), []);
  assert.deepEqual(f.errors, []);
});

test('Layer ASK reviews explicitly rejected pixels from exactly the last three successful generations', async t => {
  const f = await open('/#/edit', { ready: '#imageEditor', ask: askSettings() });
  t.after(() => f.context.close());
  const { page, llm, calls } = f;
  const color = (r, g, b) => rgba(24, 24, Uint8Array.from({ length: 24 * 24 * 4 }, (_, i) => [r, g, b, 255][i % 4]));
  const base = color(245, 245, 245), good = color(20, 200, 20), bad = color(240, 20, 20);
  let generated = 0, failNext = false;
  await page.route('https://gateway.example.test/service/**/models', route =>
    route.fulfill({ json: { data: [{ id: 'doubao-seedream-5-5' }] } }));
  await page.route('https://gateway.example.test/service/api/v3/images/generations', route => {
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 400, json: { error: { message: '模拟生成失败' } } });
    }
    generated++;
    const data = [base, good, bad].map((png, i) => ({
      b64_json: png.toString('base64'), size: '24x24', z_index: i,
      name: ['底图', '袖子', '马尾'][i] + generated,
    }));
    return route.fulfill({ json: { data } });
  });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('koma.routing.v1'));
    settings.connections.image.profileId = 'seedream-v1';
    localStorage.setItem('koma.routing.v1', JSON.stringify(settings));
  });
  await page.reload();
  await openLayer(page);
  const panel = page.locator('#imageEditor');
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const pool = panel.getByRole('region', { name: '本次拆层候选池' });
  const dock = page.getByRole('toolbar', { name: '分件画布工具' });
  const action = name => dock.getByRole('button', { name, exact: true }).click();
  const rounds = () => page.evaluate(() => ask.externalSnapshot().base.layer.generationRounds);
  const generate = async () => {
    const expand = panel.getByRole('button', { name: '展开参数', exact: true });
    if (await expand.isVisible()) await expand.click();
    await panel.getByRole('button', { name: /^(一键总拆|重新拆层)$/ }).click();
    await page.getByRole('button', { name: '本地放大并继续' }).click();
    await done();
  };
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: base });
  await done();
  await bind(page);
  await generate();
  await pool.getByRole('checkbox', { name: '勾选候选层 马尾1' }).uncheck();
  await pool.getByRole('button', { name: '显隐候选层 马尾1', exact: true }).click();
  await pool.getByRole('button', { name: '收纳进图层栈 (1)' }).click();
  await done();
  assert.deepEqual((await rounds())[0].rejected, []);
  await pool.getByRole('button', { name: '淘汰候选层 马尾1', exact: true }).click();
  await done();
  const [removed] = (await rounds())[0].rejected;
  assert.equal(removed.name, '马尾1');
  assert.equal(removed.reason, 'discarded_candidate');
  await action('撤销');
  await done();
  assert.deepEqual((await rounds())[0].rejected, []);
  await action('重做');
  await done();
  assert.deepEqual((await rounds())[0].rejected, [removed]);

  await panel.getByRole('button', { name: '删除图层', exact: true }).click();
  await done();
  assert.equal((await rounds())[0].rejected.find(r => r.name === '袖子1').reason, 'deleted_layer');
  await action('撤销');
  await done();
  assert.deepEqual((await rounds())[0].rejected, [removed]);

  await page.reload();
  await openLayer(page);
  await bind(page);
  await panel.getByRole('button', { name: /让 ASK 查看淘汰图/ }).click();
  assert.match(await page.locator('#askPrompt').inputValue(), /最近三轮/);
  assert.equal(calls.length, 0);
  llm.push(toolReply('inspect-rejected', 'view_image', { id: removed.picture, spec: 'look' }));
  await askText(page, llm, '请看我刚淘汰的马尾。');
  assert.deepEqual(wireStates(calls[0].body).at(-1).layer.generationRounds[0].rejected, [removed]);
  assert.equal(imageBlocks(calls[0].body).length, 0);
  const [sent] = imageBlocks(calls[1].body);
  assert.ok(sent?.image_url.url);
  const pixel = await page.evaluate(async url => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    ctx.drawImage(bitmap, 0, 0, 1, 1); bitmap.close();
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, sent.image_url.url);
  assert.ok(pixel[0] > 200 && pixel[1] < 50 && pixel[2] < 50, JSON.stringify(pixel));
  await page.evaluate(() => ask.hide());
  await generate();
  await pool.getByRole('button', { name: '清空', exact: true }).click();
  await done();
  assert.equal((await rounds())[1].rejected.length, 3);
  await generate();
  failNext = true;
  await generate();
  assert.deepEqual((await rounds()).map(r => r.round), [1, 2, 3]);
  await generate();
  assert.deepEqual((await rounds()).map(r => [r.round, r.rejected.length]), [[2, 3], [3, 0], [4, 0]]);

  // Discard the remaining base of round 1 after it expired. The still-admitted sleeve survives.
  const oldPool = panel.getByRole('combobox', { name: '切换待筛批次' });
  await oldPool.selectOption({ index: 1 });
  await done();
  assert.deepEqual(await pool.locator('.layer-pool-meta strong').allTextContents(), ['底图1']);
  await pool.getByRole('button', { name: '清空', exact: true }).click();
  await done();
  assert.deepEqual(await panel.locator('.layer-stack-meta strong').allTextContents(), ['袖子1']);
  assert.deepEqual((await rounds()).map(r => r.round), [2, 3, 4]);
  // Same ASK conversation: hot turns must not replay expired pixels.
  llm.push(toolReply('expired', 'view_image', { id: removed.picture, spec: 'glance' }));
  const first = calls.length;
  await askText(page, llm, '第一轮旧图还可以查看吗？');
  assert.equal(imageBlocks(calls[first].body).length, 0);
  assert.equal(imageBlocks(calls[first + 1].body).length, 0);
  assert.match(JSON.stringify(calls[first + 1].body.messages), /不在本轮分件项目的最近三轮/);
  await page.evaluate(() => ask.hide());
  await page.reload();
  await openLayer(page);
  await bind(page);
  const [second] = await rounds();
  assert.equal(second.round, 2);
  const stillRecent = second.rejected[0].picture;
  llm.push(toolReply('compare', 'view_sheet', { ids: second.rejected.slice(0, 2).map(r => r.picture) }));
  const sheet = calls.length;
  await askText(page, llm, '并排查看第二轮的两张淘汰图。');
  assert.equal(imageBlocks(calls[sheet + 1].body).length, 1);
  await page.evaluate(() => ask.hide());
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: good });
  await done();
  assert.deepEqual(await rounds(), []);
  llm.push(toolReply('other-project', 'view_image', { id: stillRecent, spec: 'glance' }));
  const other = calls.length;
  await askText(page, llm, '原项目的候选还在这个分件项目吗？');
  assert.equal(imageBlocks(calls[other + 1].body).length, 0);
  assert.equal(generated, 4);
  assert.deepEqual(f.errors, []);
});

test('Layer ASK adjusts only the maximum; the confirmed value reaches the next manual Seedream request', async (t) => {
  const f = await open('/#/edit', { ready: '#imageEditor', ask: askSettings({ images: false }) });
  t.after(() => f.context.close());
  const { page, llm } = f;
  const image = rgba(20, 20, new Uint8Array(20 * 20 * 4).fill(255));
  const requests = [];
  await page.route('https://gateway.example.test/service/**/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'doubao-seedream-5-5' }] } }),
  );
  await page.route('https://gateway.example.test/service/api/v3/images/generations', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: [{ b64_json: image.toString('base64'), z_index: 0 }] } });
  });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('koma.routing.v1'));
    settings.connections.image.profileId = 'seedream-v1';
    localStorage.setItem('koma.routing.v1', JSON.stringify(settings));
  });
  await page.reload();
  await openLayer(page);
  await page
    .getByLabel('打开定稿', { exact: true })
    .setInputFiles({ name: 'nine.png', mimeType: 'image/png', buffer: image });
  const panel = page.locator('.layer-panel');
  const prompt = '由前向后拆开已列出的九个组件，保留手部与配饰。';
  const field = panel.getByLabel('拆层说明', { exact: true });
  await field.fill(prompt);
  const unlimited = panel.getByRole('button', { name: '不限制', exact: true });
  const max = panel.getByRole('slider', { name: '最多拆出层数' });
  await unlimited.click();
  await bind(page);
  await askDraft(
    page,
    llm,
    [{ kind: 'layer_prompt', target: 'master', max: 12 }],
    '预计拆 9 件，给最多层数留点缓冲，沿用原词',
  );
  assert.ok(
    f.calls[0].body.messages.some(
      (m) => m.role === 'system' && JSON.stringify(m.content).includes('预计 9 件，建议最多 12 层'),
    ),
  );
  assert.equal(await max.isDisabled(), true);
  await applyDraft(page);
  assert.equal(await max.inputValue(), '12');
  assert.equal(await max.isEnabled(), true);
  assert.equal(await field.inputValue(), prompt);
  await undoCheckpoint(page);
  assert.equal(await max.isDisabled(), true);
  await restoreCheckpoint(page);
  await page.evaluate(() => ask.hide());
  await page.reload();
  await openLayer(page);
  assert.equal(await max.inputValue(), '12');
  assert.equal(await field.inputValue(), prompt);
  assert.equal(requests.length, 0);
  await panel.getByRole('button', { name: '一键总拆', exact: true }).click();
  await page.getByRole('button', { name: '本地放大并继续' }).click();
  await page.locator('.layer-pool-item').first().waitFor();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].layer_decomposition_options, { max_images: 12 });
  assert.equal(requests[0].prompt, prompt);
  assert.deepEqual(f.errors, []);
});

// Same two-level shape as an existing nine-part Koma Layer project.
const splitPlan = [
  ['头部前部与面部', '瞳孔高光', '上眼睑睫毛', '眼白', '无五官脸底'],
  ['双马尾、发饰与后发底', '左马尾', '右马尾', '后发'],
  ['右臂与右手（含金手镯与黑手套）', '右手套', '金手镯'],
  ['黑色百褶短裙与腰带', '前裙摆', '腰带'],
  ['浅灰敞开外套', '前襟', '后衣片'],
  ['左臂与左手（含黑手套）', '左手套'],
  ['黑色十字短袖与颈肩躯干', '短袖'],
  ['双腿、腿环与不对称袜', '腿环'],
  ['黑色厚底双扣短靴'],
].map(([name, ...children]) => ({
  name, prompt: '按遮挡顺序拆出' + name, max: 12,
  sub_prompt: '按由前向后顺序细拆' + name, sub_max: 9,
  children: children.map(name => ({ name, prompt: '单独输出' + name + '。', max: 5 })),
}));

test('Layer ASK drafts read metadata, route numbered prompts, persist two-level notes and undo without generating', async (t) => {
  const f = await open('/#/edit', { ready: '#imageEditor', ask: askSettings({ images: false }) });
  t.after(() => f.context.close());
  const { page, llm } = f;
  await openLayer(page);
  await page.getByLabel('打开定稿', { exact: true }).setInputFiles({
    name: 'head.png',
    mimeType: 'image/png',
    buffer: rgba(20, 20, new Uint8Array(20 * 20 * 4).fill(255)),
  });
  await page.locator('.layer-panel[aria-busy="false"]').waitFor();
  await bind(page);
  const prompt = '1. 睫毛；2. 高光；3. 虹膜；4. 眼白；5. 无五官光洁脸壳。补圆瞳孔，不留断口。';
  await askDraft(
    page,
    llm,
    [
      { kind: 'layer_prompt', target: 'master', prompt, max: 10 },
      {
        kind: 'layer_todos',
        parts: splitPlan,
      },
    ],
    '规划拆层并准备总拆说明',
  );
  const state = wireStates(f.calls[0].body).at(-1);
  assert.equal(state.layer.width, 20);
  assert.equal(state.layer.picture, '#layer');
  assert.equal(await page.getByLabel('拆层说明', { exact: true }).inputValue(), '');
  const preview = page.locator('#askDraftBody').getByRole('region', { name: '任务变更' });
  assert.equal(await page.locator('#askFullDraft .draft-destination').getAttribute('title'), '分件项目 · head.png');
  assert.equal(await preview.locator('.slate-change').count(), 3);
  await preview.getByRole('button', { name: '头部前部与面部 · 新增详情' }).click();
  assert.ok(await preview.getByText(splitPlan[0].sub_prompt, { exact: true }).isVisible());
  await preview.getByRole('button', { name: '其余 22 项' }).click();
  assert.equal(await preview.locator('.slate-change').count(), 25);
  await preview.getByRole('button', { name: '收起', exact: true }).click();
  await page.getByRole('button', { name: '撤回 两级拆件备忘' }).click();
  await page.getByRole('button', { name: '恢复 两级拆件备忘' }).click();
  await applyDraft(page);
  assert.equal(await page.getByLabel('拆层说明', { exact: true }).inputValue(), prompt);
  const memo = page.locator('#askDrawer .ask-todos[aria-label="拆件待办"]');
  assert.match(await memo.innerText(), /0\/25/);
  await undoCheckpoint(page);
  assert.equal(await page.getByLabel('拆层说明', { exact: true }).inputValue(), '');
  assert.equal(await memo.count(), 0);
  await restoreCheckpoint(page);
  await memo.locator('.todos-bar').click();
  await memo.getByRole('checkbox', { name: '头部前部与面部 · 待办' }).click();
  await memo.getByRole('button', { name: '头部前部与面部 · 细分 4 项' }).click();
  await memo.getByRole('button', { name: '瞳孔高光', exact: true }).click();
  assert.equal(await page.getByLabel('拆层说明', { exact: true }).inputValue(), '单独输出瞳孔高光。');
  assert.ok(await page.getByRole('heading', { name: '细拆 · 母版框选' }).isVisible());
  await memo.waitFor({ state: 'hidden' });
  await page.locator('.layer-panel[aria-busy="false"]').waitFor();
  await page.reload();
  await openLayer(page);
  await page.getByRole('button', { name: /在 ASK 查看拆件待办/ }).click();
  assert.ok(await memo.getByRole('checkbox', { name: '头部前部与面部 · 已完成' }).isChecked());
  assert.deepEqual(generation(f.requests), []);
  assert.deepEqual(f.errors, []);
});

for (const width of [1440, 390]) {
  test(`Layer BETA · ${width}px · existing project todos in the shared ASK drawer`, async t => {
    const f = await open('/#/edit', { ready: '#imageEditor', width, touch: width === 390 });
    t.after(() => f.context.close());
    const { page } = f;
    await bind(page);
    await page.evaluate(async parts => {
      const { layerStorage } = await import('/src/layer/storage.ts');
      const { newProject } = await import('/src/layer/project.ts');
      const providers = document.body.__vue_app__._context.provides;
      const store = layerStorage(providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')]);
      const ref = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
      const other = newProject('second', '另一定稿', ref);
      const p = newProject('nine', 'reference.png', ref);
      p.todos = parts.flatMap((item, i) => [
        { id: 'part-' + i, name: item.name, prompt: item.prompt, max: item.max, subPrompt: item.sub_prompt, subMax: item.sub_max, done: false },
        ...item.children.map((child, j) => ({ id: 'part-' + i + '-' + j, parent: 'part-' + i, ...child, done: false })),
      ]);
      const layer = { id: 'head', name: '头部总成', groups: ['人物'], x: 5, y: 4, width: 4, height: 5, pixels: new Uint8Array(80).fill(255), visible: true, locked: false };
      p.layers = [layer, { ...layer, archived: true, visible: false, id: 'archive', name: '归档原件' }];
      await store.save(other);
      await store.save(p);
      const { parseSlateEdit } = await import('/src/slate/edit.ts');
      const { change } = parseSlateEdit({ kind: 'slate_edit', op: 'create', slate_title: '原有会话清单',
        todos: [{ op: 'add', todo_title: '整理构图', image_required: false }] }, null, drawing.snapshot().form, []);
      await slate.commit(change);
      await ask.openSlate(change.id);
      ask.hide();
    }, splitPlan);
    await page.evaluate(() => { location.hash = '#/edit/settings/general'; });
    await page.locator('.s-toggle[title="画布协创 BETA"]').click();
    await page.evaluate(() => { location.hash = '#/edit'; });
    await page.locator('.editor.edit-collaboration').waitFor();
    await openLayer(page);
    const sidebar = page.getByRole('complementary', { name: '编辑创作侧栏' });
    const memo = sidebar.locator('#askDrawer .ask-todos');
    const showTodos = page.getByRole('button', { name: /在 ASK 查看拆件待办/ });
    const tabs = page.getByRole('group', { name: '编辑侧栏内容' });
    await showTodos.click();
    assert.equal(await memo.count(), 1);
    assert.equal(await page.locator('.layer-panel .todo-row, .layer-checklist').count(), 0);
    assert.equal(await memo.locator('.todo-row').count(), 9);
    assert.equal(await memo.locator('.todos-progress small').textContent(), '0/25');
    await memo.getByRole('button', { name: '待办清单选项' }).click();
    await memo.getByRole('menuitem', { name: '查看会话待办' }).click();
    assert.equal(await memo.locator('.todo-title').textContent(), '整理构图');
    await memo.getByRole('button', { name: '待办清单选项' }).click();
    await memo.getByRole('menuitem', { name: '查看拆件待办' }).click();

    const overview = page.getByRole('dialog', { name: '任务总览' });
    for (const [entry, label] of [['原有会话清单', '会话待办'], ['拆件待办 · reference.png', '拆件待办']]) {
      await memo.getByRole('button', { name: '待办清单选项' }).click();
      await memo.getByRole('menuitem', { name: '任务总览' }).click();
      await overview.locator('.overview-item').filter({ hasText: entry }).click();
      await sidebar.getByRole('region', { name: label, exact: true }).waitFor();
    }

    const head = splitPlan[0].name;
    await memo.getByRole('button', { name: head + ' · 细分 4 项' }).click();
    await memo.getByRole('checkbox', { name: '瞳孔高光 · 待办' }).click();
    assert.equal(await memo.locator('.todos-progress small').textContent(), '1/25');
    await memo.getByRole('button', { name: head + ' · 任务选项' }).click();
    await memo.getByRole('menuitem', { name: '绑定正式图层…' }).click();
    assert.equal(await memo.getByRole('menuitemradio', { name: /归档原件/ }).count(), 0);
    await memo.getByRole('menuitemradio', { name: '人物 / 头部总成' }).click();
    await page.locator('#askPrompt').fill('还没发出的意见');
    const conversation = await page.evaluate(() => ask.conversationId.value);
    const field = page.getByLabel('拆层说明', { exact: true });
    await memo.getByRole('button', { name: '瞳孔高光', exact: true }).click();
    await sidebar.getByRole('heading', { name: '细拆 · 头部总成' }).waitFor();
    assert.equal(await field.inputValue(), '单独输出瞳孔高光。');
    assert.equal(await sidebar.getByRole('slider', { name: '最多拆出层数' }).inputValue(), '5');
    await field.fill('保留手改词');
    await showTodos.click();
    await memo.getByRole('button', { name: '瞳孔高光', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: '替换当前拆层说明？' });
    await dialog.getByRole('button', { name: '取消' }).click();
    assert.equal(await field.inputValue(), '保留手改词');
    assert.equal(await page.locator('#askPrompt').inputValue(), '还没发出的意见');
    assert.equal(await page.evaluate(() => ask.conversationId.value), conversation);
    await memo.getByRole('button', { name: '瞳孔高光', exact: true }).click();
    await dialog.getByRole('button', { name: '使用备忘预设' }).click();
    await sidebar.getByRole('heading', { name: '细拆 · 头部总成' }).waitFor();
    if (width === 390) {
      await tabs.getByRole('button', { name: '分件' }).click();
      await sidebar.waitFor({ state: 'hidden' });
      const tools = page.getByRole('toolbar', { name: '分件画布工具' });
      await tools.getByRole('button', { name: '橡皮', exact: true }).click();
      await tools.getByRole('button', { name: '移动', exact: true }).click();
      await page.getByRole('radiogroup', { name: '分件画布视图' }).getByText('原图', { exact: true }).click();
      await page.getByRole('button', { name: '展开创作面板' }).click();
      await tabs.getByRole('button', { name: 'ASK', exact: true }).click();
      assert.equal(await memo.locator('.todos-progress small').textContent(), '1/25');
    }
    await page.locator('.layer-panel[aria-busy="false"]').waitFor({ state: 'attached' });
    await page.reload();
    await openLayer(page);
    await showTodos.click();
    assert.equal(await memo.locator('.todos-progress small').textContent(), '1/25');
    await memo.getByRole('button', { name: head + ' · 任务选项' }).click();
    await memo.getByRole('menuitem', { name: '定位并填细拆词' }).click();
    await dialog.getByRole('button', { name: '使用备忘预设' }).click();
    await sidebar.getByRole('heading', { name: '细拆 · 头部总成' }).waitFor();
    assert.equal(await field.inputValue(), splitPlan[0].sub_prompt);
    assert.equal(await sidebar.getByRole('slider', { name: '最多拆出层数' }).inputValue(), '9');
    await page.getByRole('combobox', { name: '切换分件项目' }).selectOption('second');
    await page.locator('.layer-panel[aria-busy="false"]').waitFor();
    await tabs.getByRole('button', { name: 'ASK', exact: true }).click();
    assert.equal(await sidebar.getByRole('region', { name: '拆件待办' }).count(), 0);
    assert.deepEqual(generation(f.requests), []);
    assert.deepEqual(f.errors, []);
  });
}

test('Layer stack imports external PNG images as layers with canvas render, persistence, and undo', async (t) => {
  const f = await open('/#/edit', { ready: '#imageEditor' });
  t.after(() => f.context.close());
  const { page } = f;
  await openLayer(page);
  const panel = page.locator('#imageEditor');
  const dock = page.locator('.layer-dock');
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const pixelAt = (x, y) =>
    page.locator('canvas.layer-surface').evaluate(
      (canvas, [px, py]) => [...canvas.getContext('2d').getImageData(px, py, 1, 1).data],
      [x, y],
    );

  // Open a 64x64 reference artwork
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({
    name: 'master.png',
    mimeType: 'image/png',
    buffer: rgba(64, 64, new Uint8Array(64 * 64 * 4).fill(200)),
  });
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 0);

  // Import a 64x64 transparent PNG with a colored square at (8..24, 10..26)
  const patch = new Uint8Array(64 * 64 * 4);
  for (let y = 10; y < 26; y++) {
    for (let x = 8; x < 24; x++) {
      patch.set([220, 60, 140, 255], (y * 64 + x) * 4);
    }
  }
  await panel.getByLabel('导入图像为图层', { exact: true }).setInputFiles({
    name: '新发饰.png',
    mimeType: 'image/png',
    buffer: rgba(64, 64, patch),
  });
  await done();

  assert.equal(await panel.locator('.layer-stack-row').count(), 1);
  assert.match(await panel.locator('.layer-stack-row').first().innerText(), /新发饰/);
  assert.deepEqual(await pixelAt(14, 16), [220, 60, 140, 255]);
  assert.deepEqual(await pixelAt(2, 2), [0, 0, 0, 0]);

  // Persists across reload
  await page.reload();
  await openLayer(page);
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 1);
  assert.deepEqual(await pixelAt(14, 16), [220, 60, 140, 255]);

  // Import a second smaller 16x16 PNG (centered at (24, 24)) and verify undo removes it
  const small = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < small.length; i += 4) small.set([40, 190, 230, 255], i);
  await panel.getByLabel('导入图像为图层', { exact: true }).setInputFiles({
    name: '高光.png',
    mimeType: 'image/png',
    buffer: rgba(16, 16, small),
  });
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 2);
  assert.deepEqual(await pixelAt(32, 32), [40, 190, 230, 255]);

  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 1);
  assert.deepEqual(await pixelAt(32, 32), [0, 0, 0, 0]);

  // Manual transform (position & size) works and updates the canvas
  await panel.getByRole('button', { name: '调整位置与尺寸', exact: true }).click();
  await panel.getByLabel('图层 X 坐标', { exact: true }).fill('20');
  await panel.getByLabel('图层 Y 坐标', { exact: true }).fill('22');
  await panel.getByRole('button', { name: '应用', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(24, 26), [220, 60, 140, 255]);
  assert.deepEqual(await pixelAt(10, 12), [0, 0, 0, 0]);

  // Interactive on-canvas Free Transform (缩放对齐): drag SE handle to double size, apply, and undo
  await dock.getByRole('button', { name: '缩放对齐', exact: true }).click();
  const canvasBox = await page.locator('canvas.layer-surface').boundingBox();
  const toScreen = (cx, cy) => [
    canvasBox.x + (cx / 64) * canvasBox.width,
    canvasBox.y + (cy / 64) * canvasBox.height,
  ];
  // Layer is currently at (20, 22, 16, 16) -> SE handle at (36, 38); drag SE handle to (52, 54) -> 32x32
  const [sx, sy] = toScreen(36, 38);
  const [ex, ey] = toScreen(52, 54);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(ex, ey, { steps: 6 });
  await page.mouse.up();
  await page.locator('.layer-dock-sub').getByRole('button', { name: '应用变换', exact: true }).click();
  await done();
  // Pixel at (46, 48) is now inside the resized 32x32 square (20..52, 22..54)
  assert.deepEqual(await pixelAt(46, 48), [220, 60, 140, 255]);
  // Undo restores previous 16x16 geometry cleanly
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  assert.deepEqual(await pixelAt(46, 48), [0, 0, 0, 0]);
  assert.deepEqual(await pixelAt(24, 26), [220, 60, 140, 255]);
  assert.deepEqual(f.errors, []);
});
