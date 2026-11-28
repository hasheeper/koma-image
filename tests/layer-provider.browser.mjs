import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decode, encode } from 'fast-png';
import { readArchive } from '../src/storage/backup-archive.ts';
import { useNativeFixture, open } from './helpers/native-fixture.mjs';

useNativeFixture();

const makePng = (w, h, color) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(color, 4 * i);
  return Buffer.from(encode({ width: w, height: h, data, channels: 4 }));
};

const makeFigurePng = (size, color) => {
  const data = new Uint8Array(size * size * 4);
  for (let y = 12; y < size - 12; y++) {
    for (let x = 12; x < size - 12; x++) data.set(color, 4 * (y * size + x));
  }
  return Buffer.from(encode({ width: size, height: size, data, channels: 4 }));
};

const confirmLocalUpscale = page => page.getByRole('dialog', { name: '拆层送图尺寸不足' })
  .getByRole('button', { name: /^(本地)?放大并继续$/ }).click();

test('Seedream 5.5 Candidate Pool admission, recursive layer split, and targeted scalpel reroll with occluder reference', async (t) => {
  const f = await open('seedream-v1', true, 'doubao-seedream-5-5');
  t.after(() => f.context.close());
  const p = f.page;
  const size = 96;

  const baseBlob = makePng(192, 192, [40, 44, 52, 255]);
  const tailCrop = makePng(40, 120, [210, 212, 220, 255]); // 1:3 tall ponytail
  const sleeveCrop = makePng(64, 48, [95, 110, 180, 255]); // 4:3 wide sleeve
  const subLeft = makePng(32, 48, [110, 130, 195, 255]);
  const subRight = makePng(32, 48, [80, 95, 165, 255]);
  const rerollPng = (() => {
    const data = new Uint8Array(128 * 128 * 4);
    for (let y = 32; y < 96; y++) {
      for (let x = 32; x < 96; x++) data.set([225, 225, 232, 255], 4 * (y * 128 + x));
    }
    return Buffer.from(encode({ width: 128, height: 128, data, channels: 4 }));
  })();

  const captured = [];
  await p.route('**/service/api/v3/images/generations', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    captured.push(body);
    if (body.layer_decomposition) {
      // First decompose = whole master; second decompose = recursive split of sleeve layer.
      const isRecursive = captured.filter((c) => c.layer_decomposition).length > 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: isRecursive
            ? [
                {
                  b64_json: subLeft.toString('base64'),
                  size: '32x48',
                  z_index: 1,
                  bounding_box: { absolute: [0, 0, 31, 47], normalized: [0, 0, 500, 1000] },
                  name: '袖口',
                },
                {
                  b64_json: subRight.toString('base64'),
                  size: '32x48',
                  z_index: 2,
                  bounding_box: { absolute: [32, 0, 63, 47], normalized: [500, 0, 1000, 1000] },
                  name: '袖身',
                },
              ]
            : [
                { b64_json: baseBlob.toString('base64'), size: '192x192', z_index: 0, name: '底图背景' },
                {
                  b64_json: tailCrop.toString('base64'),
                  size: '40x120',
                  z_index: 1,
                  bounding_box: { absolute: [20, 28, 59, 147], normalized: [104, 146, 312, 771] },
                  description: '右马尾，画面右侧垂落的完整长发束与黑色蝴蝶结',
                },
                {
                  b64_json: sleeveCrop.toString('base64'),
                  size: '64x48',
                  z_index: 2,
                  bounding_box: { absolute: [104, 48, 167, 95], normalized: [542, 250, 875, 500] },
                  description: '外套袖子，灰白色宽松外套含滑落大袖子',
                },
              ],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ b64_json: rerollPng.toString('base64'), size: '128x128' }],
      }),
    });
  });

  await p.goto(new URL('/#/edit', p.url()).href);
  await p.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  const panel = p.locator('#imageEditor');
  const done = () => p.locator('.layer-panel[aria-busy="false"]').waitFor();
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({
    name: 'figure.png',
    mimeType: 'image/png',
    buffer: makeFigurePng(size, [160, 162, 170, 255]),
  });
  await done();

  // 1. One-click full decompose enters Candidate Pool (does not overwrite stack).
  await panel.getByLabel('拆层说明').fill('把右马尾和外套袖子拆成独立透明图层');
  const maxSlider = panel.getByRole('slider', { name: '最多拆出层数' });
  assert.equal(await maxSlider.getAttribute('max'), '99');
  await maxSlider.fill('64');
  await panel.getByRole('button', { name: '一键总拆', exact: true }).click();
  await confirmLocalUpscale(p);
  await done();

  assert.deepEqual(await panel.getByRole('alert').allTextContents(), []);
  assert.equal(captured[0].model, 'doubao-seedream-5-5');
  assert.equal(captured[0].layer_decomposition, true);
  assert.equal(captured[0].size, '2K');
  assert.deepEqual(captured[0].layer_decomposition_options, { max_images: 64 });
  assert.equal(captured[0].background, undefined);

  // Candidate pool shows 3 items with concise short names extracted from verbose Ark descriptions.
  assert.equal(await panel.locator('.layer-pool-item').count(), 3);
  assert.equal(await panel.locator('.layer-pool-item').nth(1).locator('strong').innerText(), '右马尾');
  assert.equal(await panel.locator('.layer-pool-item').nth(0).locator('strong').innerText(), '外套袖子');
  const tailThumb = await panel
    .locator('.layer-pool-item')
    .nth(1)
    .locator('canvas')
    .evaluate((el) => [el.width, el.height]);
  assert.ok(tailThumb[1] > tailThumb[0] * 2, JSON.stringify(tailThumb));

  // Multi-layer composite renders ALL visible non-base candidate layers immediately on canvas!
  const canvasPixel = (x, y) =>
    p
      .locator('canvas.layer-surface')
      .evaluate((el, [px, py]) => [...el.getContext('2d').getImageData(px, py, 1, 1).data], [x, y]);
  assert.deepEqual(await canvasPixel(20, 40), [210, 212, 220, 255]);
  assert.deepEqual(await canvasPixel(68, 36), [95, 110, 180, 255]);
  const views = p.getByRole('radiogroup', { name: '分件画布视图' });
  assert.equal(await views.getByRole('radio', { name: '拆分结果' }).isChecked(), true);
  await views.getByText('原图', { exact: true }).click();
  assert.equal(await views.getByRole('radio', { name: '原图' }).isChecked(), true);
  assert.deepEqual(await canvasPixel(20, 40), [160, 162, 170, 255]);
  assert.deepEqual(await canvasPixel(68, 36), [160, 162, 170, 255]);
  await views.getByText('拆分结果', { exact: true }).click();
  assert.deepEqual(await canvasPixel(20, 40), [210, 212, 220, 255]);
  assert.deepEqual(await canvasPixel(68, 36), [95, 110, 180, 255]);
  assert.equal(captured.length, 1);

  // Multi-layer eye toggle hides only 外套袖子 while keeping 右马尾 visible; clicking again restores both.
  await panel.getByRole('button', { name: '显隐候选层 外套袖子', exact: true }).click();
  assert.deepEqual(await canvasPixel(20, 40), [210, 212, 220, 255]);
  assert.deepEqual(await canvasPixel(68, 36), [0, 0, 0, 0]);
  await panel.getByRole('button', { name: '显隐候选层 外套袖子', exact: true }).click();
  assert.deepEqual(await canvasPixel(68, 36), [95, 110, 180, 255]);

  // Solo (S) isolates only 右马尾; clicking again returns to multi-layer composite.
  await panel.getByRole('button', { name: '独显候选层 右马尾', exact: true }).click();
  assert.deepEqual(await canvasPixel(20, 40), [210, 212, 220, 255]);
  assert.deepEqual(await canvasPixel(68, 36), [0, 0, 0, 0]);
  await panel.getByRole('button', { name: '独显候选层 右马尾', exact: true }).click();
  assert.deepEqual(await canvasPixel(68, 36), [95, 110, 180, 255]);

  // Admit the 2 selected layers into the formal Layer Stack.
  await panel.getByRole('button', { name: /收纳进图层栈 \(2\)/ }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 2);
  // Both layers render live in the stack composite!
  assert.deepEqual(await canvasPixel(20, 40), [210, 212, 220, 255]);
  assert.deepEqual(await canvasPixel(68, 36), [95, 110, 180, 255]);
  assert.equal(await views.getByRole('radio', { name: '图层合成' }).isChecked(), true);
  await views.getByText('原图', { exact: true }).click();
  assert.deepEqual(await canvasPixel(68, 36), [160, 162, 170, 255]);
  await views.getByText('图层合成', { exact: true }).click();
  assert.deepEqual(await canvasPixel(68, 36), [95, 110, 180, 255]);

  // 2. Recursive single-layer decomposition ("细拆当前层") with "不限制" enabled omits layer_decomposition_options and never overwrites existing 2 stack layers.
  const expandBtn = panel.getByRole('button', { name: '展开参数', exact: true });
  if (await expandBtn.isVisible()) await expandBtn.click();
  await panel.getByRole('button', { name: '↳ 继续细拆此件', exact: true }).click();
  await panel.getByRole('button', { name: '不限制', exact: true }).click();
  assert.equal(await maxSlider.isDisabled(), true);
  await panel.getByRole('button', { name: '开始细拆', exact: true }).click();
  await confirmLocalUpscale(p);
  await done();
  assert.equal(captured[1].layer_decomposition, true);
  assert.equal(captured[1].layer_decomposition_options, undefined);
  assert.equal(await panel.locator('.layer-pool-item').count(), 2);
  await panel.getByRole('button', { name: /收纳进图层栈 \(2\)/ }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 4);
  const dock = p.getByRole('toolbar', { name: '分件画布工具' });
  await dock.getByRole('button', { name: '撤销', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 2);
  assert.equal(await panel.locator('.layer-pool-item').count(), 2);
  await dock.getByRole('button', { name: '重做', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 4);
  const other = panel.getByLabel('切换待筛批次');
  await other.selectOption({ index: 1 });
  await done();
  assert.equal(await panel.locator('.layer-pool-item').count(), 1);
  assert.match(await panel.locator('.layer-pool-item').innerText(), /底图/);

  // 3. Local component completion: paint blue + orange, expand collapsed occluder fold & check admitted '外套袖子', generate transparent part.
  await panel.getByRole('tab', { name: '局部补画', exact: true }).click();
  const canvas = p.locator('canvas.layer-surface');
  const box = await canvas.boundingBox();
  await p.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await done();
  await p.locator('.layer-dock').getByRole('button', { name: '遮挡补全', exact: true }).click();
  await p.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await done();

  await panel.getByLabel('部件名称').fill('左马尾');
  await panel.getByLabel('补充描述').fill('接通被外套袖子遮挡的马尾中段');
  // Occluder reference selector is collapsed by default to keep the UI clean.
  assert.equal(await p.locator('.layer-panel .layer-fold').evaluate((el) => el.open), false);
  await p.locator('.layer-panel .layer-fold > summary').click();
  await panel.locator('.layer-occluder-chips label', { hasText: '外套袖子' }).click();
  await panel.getByRole('button', { name: '生成透明部件', exact: true }).click();
  await done();

  const rerollReq = captured.at(-1);
  assert.equal(rerollReq.layer_decomposition, undefined);
  assert.equal(rerollReq.background, 'transparent');
  assert.equal(rerollReq.output_format, 'png');
  assert.equal(rerollReq.image.length, 3); // Image 1 context + Image 2 workspace + Image 3 occluder!
  assert.match(
    rerollReq.prompt,
    /Image 3 shows the exact already-separated foreground occluder layers \(外套袖子\)/,
  );
  assert.doesNotMatch(rerollReq.prompt, /#00FF00|chroma/i);

  // Re-rolls share the same three-generation window as full and recursive splits.
  const readRounds = () => p.evaluate(async () =>
    (await import('/src/layer/planning.ts')).layerPort().read().generationRounds);
  assert.deepEqual((await readRounds()).map(r => r.source), ['master', 'layers', 'scalpel']);
  const swatch = makePng(18, 6, [41, 27, 230, 255]);
  await panel.getByLabel('导入补画参考图').setInputFiles({ name: '发色.png', mimeType: 'image/png', buffer: swatch });
  await done();
  await panel.getByRole('button', { name: '添加参考图层' }).click();
  await p.getByRole('menu', { name: '添加参考图层' }).getByRole('menuitem', { name: '右马尾', exact: true }).click();
  await panel.getByLabel('参考用途 发色.png').fill('只参考紫色');
  await panel.getByLabel('参考用途 右马尾').fill('参考整束轮廓');
  await panel.getByLabel('参考用途 右马尾').blur();
  assert.equal(await panel.locator('.layer-occluder-chips').getByRole('checkbox', { name: '右马尾' }).isDisabled(), true);
  await panel.getByRole('button', { name: '生成透明部件', exact: true }).click();
  await done();
  const withRefs = captured.at(-1);
  assert.equal(withRefs.image.length, 5);
  assert.match(withRefs.prompt, /Image 4 is a positive visual reference \(发色.png\).*只参考紫色/);
  assert.match(withRefs.prompt, /Image 5 is a positive visual reference \(右马尾\).*参考整束轮廓/);
  assert.deepEqual(Buffer.from(withRefs.image[3].split(',')[1], 'base64'), swatch);
  const sentLayer = decode(Buffer.from(withRefs.image[4].split(',')[1], 'base64'));
  assert.deepEqual([sentLayer.width, sentLayer.height, ...sentLayer.data.slice(0, 4)], [20, 60, 210, 212, 220, 255]);
  await panel.getByRole('button', { name: '淘汰当前候选', exact: true }).click();
  await done();
  assert.deepEqual((await readRounds()).map(r => [r.round, r.target, r.rejected.map(i => i.name)]), [
    [2, '外套袖子', []], [3, '左马尾', []], [4, '左马尾', ['左马尾']],
  ]);
  assert.equal(await panel.locator('.layer-candidate-strip button[aria-pressed="true"]').innerText(), '#1');

  // Admit reroll candidate #1 to stack -> total 5 stack layers.
  await panel.getByRole('button', { name: '收纳当前候选进图层栈', exact: true }).click();
  await done();
  assert.equal(await panel.locator('.layer-stack-row').count(), 5);

  // 4. Export both Rig Slices v2 ZIP and Layered PSD 8BPS.
  const zipPromise = p.waitForEvent('download');
  await panel.getByRole('button', { name: '导出 Rig 切片包', exact: true }).click();
  const archive = await readArchive(new Blob([await readFile(await (await zipPromise).path())]));
  const manifest = JSON.parse(await (await archive.read('manifest.json')).text());
  assert.equal(manifest.format, 'koma-rig.slices.v2');
  assert.equal(manifest.layers.length, 4);
  assert.deepEqual(manifest.layers.find((l) => l.name === '袖身').rect, [68, 24, 16, 24]);
  assert.ok(!manifest.layers.some((l) => l.name === '外套袖子'));
  assert.deepEqual(manifest.layers.find((l) => l.name === '袖身').groups, ['外套袖子']);
  assert.ok(manifest.layers.every((l) => archive.has(l.texture)));

  const psdPromise = p.waitForEvent('download');
  await panel.getByRole('button', { name: '更多导出方式', exact: true }).click();
  await p.getByRole('menuitem', { name: /导出分层 PSD/ }).click();
  assert.equal((await readFile(await (await psdPromise).path())).toString('ascii', 0, 4), '8BPS');
  assert.deepEqual(f.errors, []);
});

test('scalpel isolates selected layers on the canvas and in unmarked and painted requests', async t => {
  const f = await open('seedream-v1', true, 'doubao-seedream-5-5');
  t.after(() => f.context.close());
  const page = f.page, bodies = [];
  await page.route('**/service/api/v3/images/generations', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: [{ b64_json: makePng(64,64,[99,99,99,255]).toString('base64') }] } });
  });
  await page.goto(new URL('/#/edit', page.url()).href);
  await page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const { newProject } = await import('/src/layer/project.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const p = newProject('selected', '补画底图', { width:64,height:64,data:new Uint8Array(64*64*4).fill(255) });
    const layer = (id, name, x, y, size, rgba) => ({ id, name, x, y, width:size, height:size, visible:true, locked:false,
      pixels:Uint8Array.from({length:size*size*4}, (_,i) => rgba[i%4]) });
    p.layers = [layer('hair','头发',8,8,32,[5,210,30,255]), { ...layer('bow','蝴蝶结',24,24,16,[80,5,210,255]), visible:false },
      layer('other','背景',0,0,64,[30,30,30,255]), { ...layer('old','旧稿',0,0,64,[1,2,3,255]), archived:true }];
    await layerStorage(app).save(p);
  });
  await page.getByRole('button', { name:'Koma Layer', exact:true }).click();
  const panel = page.locator('.layer-panel');
  await panel.getByRole('tab', { name:'局部补画' }).click();
  const source = panel.getByRole('region',{name:'补画底图'});
  const generate = panel.getByRole('button',{name:'生成透明部件'});
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  await source.getByRole('button',{name:'选择图层'}).click();
  assert.equal(await generate.isDisabled(), true);
  assert.equal(await source.getByLabel('旧稿').count(), 0);
  await source.getByLabel('蝴蝶结').check(); await source.getByLabel('头发').check();
  const canvas = page.locator('canvas.layer-surface');
  const samples = [[12,12],[28,28],[62,62]];
  const expected = [[5,210,30,255],[80,5,210,255],[0,0,0,0]];
  const preview = () => canvas.evaluate((el, pts) => pts.map(([x,y]) => [...el.getContext('2d').getImageData(x,y,1,1).data]), samples);
  assert.deepEqual(await preview(), expected);
  await generate.click(); await done();
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].prompt, /selected layers \(头发, 蝴蝶结\)/);
  const images = body => (Array.isArray(body.image) ? body.image : [body.image]).map(url => decode(Buffer.from(url.split(',')[1],'base64')));
  const sample = (img, x, y) => [...img.data.slice((y*img.width+x)*4,(y*img.width+x)*4+4)];
  const [clean] = images(bodies[0]);
  assert.equal(images(bodies[0]).length, 1);
  assert.deepEqual(samples.map(([x,y])=>sample(clean,x,y)), expected);
  await panel.getByRole('button',{name:'返回涂抹'}).click();
  await page.locator('.layer-dock-wrap').getByLabel('边缘吸附').uncheck();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x+box.width*28.5/64,box.y+box.height*28.5/64); await done();
  await generate.click(); await done();
  const [base, guide] = images(bodies[1]);
  assert.deepEqual(samples.map(([x,y])=>sample(base,x,y)), expected);
  assert.notDeepEqual(sample(guide,28,28), expected[1]);
  assert.deepEqual(sample(guide,62,62), expected[2]);
  await panel.getByRole('button',{name:'叠加蓝区原图'}).click();
  assert.deepEqual((await preview())[1], expected[1]);
  await source.getByRole('button',{name:'母版'}).click();
  assert.deepEqual((await preview())[2], [255,255,255,255]);
  assert.equal(bodies.length, 2);
});

test('SD Layer makes a missing ear from one face and hair composite; preview, admit and undo preserve its hidden root', async t => {
  const { page, context, errors } = await open('seedream-v1', true, 'doubao-seedream-5-5');
  t.after(() => context.close());
  const requests = [], skin = [237,180,134,255], hair = [39,28,17,255], ear = [231,132,116,255];
  const base = { z_index:0, b64_json:makePng(512,512,skin).toString('base64') };
  const part = { z_index:1, name:'耳廓', b64_json:makePng(64,32,ear).toString('base64'),
    bounding_box:{ absolute:[6,70,70,102] } };
  await page.route('**/service/api/v3/images/generations', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json:{ data:requests.length === 1 ? [base] : [base,part] } });
  });
  await page.goto(new URL('/#/edit', page.url()).href);
  await page.evaluate(async ({ skin, hair }) => {
    const { layerStorage } = await import('/src/layer/storage.ts'), { newProject } = await import('/src/layer/project.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const p = newProject('missing-ear', '缺失件测试', { width:600, height:600, data:new Uint8Array(600*600*4).fill(255) });
    const make = (id, name, x, y, width, height, rgba) => ({ id, name, x, y, width, height, visible:true, locked:true,
      pixels:Uint8Array.from({length:width*height*4}, (_,i) => rgba[i%4]) });
    p.layers = [make('bg','背景',0,0,600,600,[0,0,180,255]), make('face','面部',48,40,496,512,skin),
      { ...make('hair','前发',32,40,48,400,hair), groups:['头部'], groupIds:['head'] }];
    p.alpha.fill(220);
    p.scalpelLayerIds = ['face'];
    p.scalpelOccluderIds = ['hair'];
    await layerStorage(app).save(p);
    window.readEarProject = () => layerStorage(app).read(p.id);
  }, { skin, hair });
  const openLayer = () => page.getByRole('button', { name:'Koma Layer', exact:true }).click();
  await openLayer();
  const panel = page.locator('#imageEditor'), done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const layers = () => page.evaluate(async () => (await window.readEarProject()).layers.map(
    ({id,name,x,y,width,height,visible,locked,archived,groups}) => ({id,name,x,y,width,height,visible,locked,archived,groups})));
  const original = await layers();
  await panel.getByRole('tab', { name:'局部补画' }).click();
  await panel.getByRole('button', { name:'补缺失件', exact: true }).click();
  const source = panel.getByRole('region', { name:'缺失件底图' });
  const generate = panel.getByRole('button', { name:'生成缺失件' });
  assert.equal(await source.getByLabel('面部').isChecked(), true);
  await source.getByLabel('头部 / 前发').check();
  assert.equal(await generate.isDisabled(), true);
  const target = '画面左侧的耳朵';
  await panel.getByLabel('部件名称').fill(target);
  await panel.getByLabel('补充描述').fill('补全前发后面的耳根');
  const sample = (x,y) => page.locator('canvas.layer-surface').evaluate((el,[x,y]) =>
    [...el.getContext('2d').getImageData(x,y,1,1).data], [x,y]);
  assert.deepEqual(await sample(20,20), [0,0,0,0]);
  await generate.click(); await done();
  assert.match(await panel.getByRole('alert').innerText(), /未返回.*独立有效图层/);
  assert.deepEqual(await layers(), original);
  await generate.click(); await done();
  assert.equal(requests.length, 2);
  const body = requests[1];
  assert.equal(body.layer_decomposition, true);
  assert.equal(body.layer_decomposition_options.max_images, 2);
  assert.equal(body.model, 'doubao-seedream-5-5');
  assert.match(body.prompt, /面部 \+ 前发/);
  assert.ok(body.prompt.includes(target) && body.prompt.includes('补全前发后面的耳根'));
  assert.equal(typeof body.image, 'string');
  const sent = decode(Buffer.from(body.image.split(',')[1], 'base64'));
  assert.deepEqual([sent.width,sent.height], [512,512]);
  const pixels = (x,y) => [...sent.data.slice((y*512+x)*4, (y*512+x+1)*4)];
  assert.deepEqual([pixels(2,2), pixels(20,50), pixels(30,450), pixels(2,450)], [hair,hair,skin,[0,0,0,0]]);
  assert.equal(await panel.getByRole('radio', { name:'勾选候选层 耳廓' }).count(), 1);
  assert.equal(await panel.getByText('残余底图', { exact:true }).count(), 0);
  await panel.getByRole('button', { name:'单看部件' }).click();
  assert.deepEqual(await sample(45,112), ear);
  assert.deepEqual(await sample(20,20), [0,0,0,0]);
  await panel.getByRole('button', { name:'叠回图层' }).click();
  assert.deepEqual([await sample(45,112), await sample(85,112)], [hair,ear]);
  assert.deepEqual(await layers(), original);
  const admit = panel.getByRole('button', { name:'添加为独立图层' });
  await admit.click(); await done();
  const added = await layers();
  assert.deepEqual(added.map(l => l.name), ['背景','面部',target,'前发']);
  assert.deepEqual(added.filter(l => l.name !== target), original);
  assert.deepEqual([added[2].x,added[2].y,added[2].width,added[2].height,added[2].groups,added[2].locked],
    [38,110,64,32,['头部'],false]);
  await page.getByRole('toolbar', { name:'分件画布工具' }).getByRole('button', { name:'撤销', exact:true }).click(); await done();
  assert.deepEqual(await layers(), original);
  await page.reload(); await openLayer();
  await admit.click(); await done();
  assert.deepEqual([await sample(45,112), await sample(85,112)], [hair,ear]);
  assert.equal(requests.length, 2);
  await panel.getByRole('button', { name:'分件项目选项' }).click();
  await page.getByRole('menuitem', { name:'清空分件缓存' }).click(); await done();
  await panel.getByRole('tab', { name:'局部补画' }).click();
  await panel.getByRole('button', { name:'补缺失件', exact: true }).click();
  const master = source.getByRole('button', { name:'母版原图' });
  assert.equal(await master.getAttribute('aria-pressed'), 'true');
  await panel.getByLabel('部件名称').fill('母版的耳朵');
  await source.getByRole('button', { name:'选择图层' }).click();
  assert.equal(await generate.isDisabled(), true);
  await master.click();
  await generate.click(); await done();
  assert.equal(requests.length, 3);
  assert.match(requests[2].prompt, /整张母版原图/);
  const originalImage = decode(Buffer.from(requests[2].image.split(',')[1], 'base64'));
  assert.deepEqual([originalImage.width, originalImage.height], [600,600]);
  assert.ok(originalImage.data.every(v => v === 255));
  await panel.getByRole('button', { name:'单看部件' }).click();
  assert.deepEqual(await sample(20,20), [0,0,0,0]);
  await panel.getByRole('button', { name:'叠回母版' }).click();
  assert.deepEqual(await sample(20,20), [255,255,255,255]);
  await admit.click(); await done();
  assert.match(await panel.getByRole('region', { name:'正式图层栈' }).innerText(), /母版的耳朵/);
  assert.deepEqual(errors, []);
});

test('large scalpel frame uses clamped natural-aspect full canvas without void padding; preserves 1px linework, overlay toggle and raw download', async t => {
  const f = await open('seedream-v1', true, 'doubao-seedream-5-5');
  t.after(() => f.context.close());
  const p = f.page, requests = [];
  const raw = makePng(800, 64, [42, 211, 88, 255]);
  await p.route('**/service/api/v3/images/generations', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: [{ b64_json: raw.toString('base64') }] } });
  });
  await p.goto(new URL('/#/edit', p.url()).href);
  const frame = await p.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const { newProject } = await import('/src/layer/project.ts');
    const { scalpelFrame } = await import('/src/layer/targeted-reroll.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const width = 1600, height = 128, data = new Uint8Array(width * height * 4);
    const project = newProject('stripes', '细线测试', { width, height, data });
    project.occluded = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, shade = (x % 2) * 255;
      data.set([shade, shade, shade, 255], i * 4);
      if (x >= 320 && x < 400 && y >= 32 && y < 96) project.alpha[i] = 255;
    }
    project.occluded[64 * width + 1429] = 255;
    await layerStorage(app).save(project);
    return scalpelFrame(project);
  });
  // Large painted span defaults to exact full canvas (1600x128) with zero out-of-bounds transparent padding.
  assert.deepEqual(frame, { x: 0, y: 0, width: 1600, height: 128 });
  await p.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  const panel = p.locator('#imageEditor');
  await panel.getByRole('tab', { name: '局部补画' }).click();
  await panel.getByRole('button', { name: '生成透明部件' }).click();
  await panel.getByRole('button', { name: '下载模型原始回图' }).waitFor();
  assert.equal(requests[0].size, '3616x304');
  // Image 1 is the clean unmarked 1:1 original; Image 2 overlays rough translucent guides without hard-cutting context.
  const cleanInput = decode(Buffer.from(requests[0].image[0].split(',')[1], 'base64'));
  const guideInput = decode(Buffer.from(requests[0].image[1].split(',')[1], 'base64'));
  assert.deepEqual([cleanInput.width, cleanInput.height], [1600, 128]);
  assert.deepEqual([guideInput.width, guideInput.height], [1600, 128]);
  const sampleAt = (img, x, y) => img.data[((y - frame.y) * img.width + x - frame.x) * 4];
  assert.deepEqual([sampleAt(cleanInput, 336, 60), sampleAt(cleanInput, 337, 60)], [0, 255]);
  // Unpainted surrounding context remains intact in Image 2 (never hard-cut to transparent).
  assert.equal(guideInput.data[((60 - frame.y) * guideInput.width + 200 - frame.x) * 4 + 3], 255);
  assert.match(requests[0].prompt, /NEVER as a literal pixel cutout mask/);
  const checkPixels = () => p.locator('canvas.layer-surface').evaluate(el => {
    const ctx = el.getContext('2d');
    return [[336, 60], [337, 60], [1429, 64]].map(([x,y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  });
  // Default mode shows the untouched AI reply without overwriting blue guide pixels.
  const rawExpected = [[42, 211, 88, 255], [42, 211, 88, 255], [42, 211, 88, 255]];
  assert.deepEqual(await checkPixels(), rawExpected);
  // Switching to overlay mode restores the original 1px blue surface stripes while keeping orange AI pixels.
  await panel.getByRole('button', { name: '叠加蓝区原图', exact: true }).click();
  const expected = [[0, 0, 0, 255], [255, 255, 255, 255], [42, 211, 88, 255]];
  assert.deepEqual(await checkPixels(), expected);
  assert.match(await panel.innerText(), /整图原比例 1600 × 128/);
  assert.match(await panel.innerText(), /实际回图 800 × 64/);
  assert.match(await panel.innerText(), /补画区已等比放大/);
  const download = p.waitForEvent('download');
  await panel.getByRole('button', { name: '下载模型原始回图' }).click();
  assert.deepEqual(await readFile(await (await download).path()), raw);
  await panel.getByRole('button', { name: '收纳当前候选进图层栈' }).click();
  assert.deepEqual(await checkPixels(), expected);
  const zip = p.waitForEvent('download');
  await panel.getByRole('button', { name: '导出 Rig 切片包' }).click();
  const ar = await readArchive(new Blob([await readFile(await (await zip).path())]));
  const manifest = JSON.parse(await (await ar.read('manifest.json')).text());
  const layer = manifest.layers[0];
  const texture = decode(new Uint8Array(await (await ar.read(layer.texture)).arrayBuffer()));
  for (const [i, [x,y]] of [[336,60],[337,60],[1429,64]].entries()) {
    const k = ((y - layer.rect[1]) * texture.width + x - layer.rect[0]) * 4;
    assert.deepEqual([...texture.data.slice(k,k+4)], expected[i]);
  }
  assert.deepEqual(f.errors, []);
});

for (const [profile, model] of [
  ['openai-images-v1', 'gpt-image-1.5'],
  ['gemini-native-v1', 'gemini-2.5-flash-image'],
  ['koma-standard-v1', 'gemini-3.1-flash-image'],
]) {
  test('Targeted Scalpel uses the configured ' + profile + ' image-edit wire contract', async (t) => {
    const standard = profile === 'koma-standard-v1';
    const account = standard ? { studioModels: { [model]: {
      editor_family: 'gemini', operations: ['generate','edit'], tools:['image-edit'], quota_group:'openai',
      image_capabilities: { fields: { image_size: { options:['1K','2K'], default:'2K' },
        aspect_ratio: { options:['1:1','16:9'], default:'16:9' } } },
    } } } : undefined;
    const f = await open(profile, true, model, account);
    t.after(() => f.context.close());
    const p = f.page;
    await p.goto(new URL('/#/edit', p.url()).href);
    await p.getByRole('button', { name: 'Koma Layer', exact: true }).click();
    const panel = p.locator('.layer-panel');
    const done = () => p.locator('.layer-panel[aria-busy="false"]').waitFor();
    await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({
      name: 'figure.png',
      mimeType: 'image/png',
      buffer: makeFigurePng(96, [85, 110, 150, 255]),
    });
    await done();

    await panel.getByRole('tab', { name: '局部补画', exact: true }).click();
    const canvas = p.locator('canvas.layer-surface');
    const box = await canvas.boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await done();
    await panel.getByLabel('补充描述').fill('complete hidden ponytail strands');
    if (standard) {
      await panel.getByRole('button', { name: /^局部补画模型：/ }).click();
      await p.getByRole('menu', { name: '局部补画模型' }).getByRole('menuitemradio', { name: 'Nano Banana 2 · Koma 标准网关（模拟协议）', exact: true }).click();
    }
    const png = makePng(8, 16, [44, 98, 35, 255]);
    await panel.getByLabel('导入补画参考图').setInputFiles({ name: 'ink.png', mimeType: 'image/png', buffer: png });
    await done();
    if (profile === 'gemini-native-v1') {
      await panel.getByLabel('导入补画参考图').setInputFiles(['blue.png','orange.png'].map(name => ({ name, mimeType:'image/png', buffer: png })));
      await done();
      assert.match(await panel.innerText(), /当前组合需要 4 张输入，模型最多接收 3 张/);
      assert.equal(await panel.getByRole('button', {name:'生成透明部件'}).isDisabled(), true);
      await panel.getByRole('button', {name:'移除参考 blue.png'}).click();
      await panel.getByRole('button', {name:'移除参考 orange.png'}).click();
    }
    await panel.getByRole('button', { name: '生成透明部件', exact: true }).click();
    await done();

    assert.deepEqual(await panel.getByRole('alert').allTextContents(), []);
    const calls = f.requests.filter(
      (r) => r.method === 'POST' && /\/images\/(edits|generations)$|:generateContent$|\/tools\/run$/.test(r.path),
    );
    assert.equal(calls.length, 1);
    const wire = calls[0];
    if (standard) {
      const body = JSON.parse(wire.body);
      assert.ok(wire.path.endsWith('/tools/run'));
      assert.equal(body.model, model);
      assert.equal(body.image_options.output_size, '2k');
      assert.equal(body.image_options.aspect_ratio, '1:1');
      assert.equal(body.additional_images.length, 2);
      assert.equal(body.additional_images[1].split(',')[1], png.toString('base64'));
      assert.match(body.prompt, /Image 3 is a positive visual reference \(ink.png\)/);
    } else if (profile === 'openai-images-v1') {
      assert.ok(wire.path.endsWith('/images/edits'));
      assert.equal(wire.body.match(/name="image\[\]"/g).length, 3);
      assert.match(wire.body, /Image 3 is a positive visual reference \(ink.png\)/);
    } else {
      const parts = JSON.parse(wire.body).contents[0].parts;
      assert.equal(parts.filter((b) => b.inlineData).length, 3);
      assert.equal(parts.filter((b) => b.inlineData)[2].inlineData.data, png.toString('base64'));
      assert.match(parts.find((b) => b.text).text, /complete hidden ponytail strands/);
    }
    assert.deepEqual(f.errors, []);
  });
}

test('master crop and nonadjacent multi-layer split send only the chosen pixels; unchecked candidates survive reload', async (t) => {
  const f = await open('seedream-v1', true, 'doubao-seedream-5-5');
  t.after(() => f.context.close());
  const page = f.page,
    requests = [],
    panel = page.locator('#imageEditor');
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const click = (name) => panel.getByRole('button', { name, exact: true }).click();
  const colors = [
    [255, 9, 22, 255],
    [77, 155, 42, 255],
    [1, 2, 233, 255],
  ];
  const names = ['底片', '中间片', '前片'];
  await page.route('**/service/api/v3/images/generations', (route) => {
    const body = route.request().postDataJSON();
    const url = Array.isArray(body.image) ? body.image[0] : body.image;
    const png = decode(Buffer.from(url.split(',')[1], 'base64'));
    requests.push(png);
    const originalEdge = requests.length === 1 ? 48 : 16;
    return route.fulfill({
      json: {
        data: names.map((name, i) => ({
          name,
          z_index: i + 1,
          b64_json: makePng(4, 4, colors[i]).toString('base64'),
          size: '4x4',
          bounding_box: { normalized: [6 * i, 6 * i, 6 * i + 4, 6 * i + 4].map(v => Math.round(v * 1000 / originalEdge)) },
        })),
      },
    });
  });
  await page.goto(new URL('/#/edit', page.url()).href);
  const enter = async () => {
    await page.getByRole('button', { name: 'Koma Layer', exact: true }).click();
    await done();
  };
  await enter();
  const pixels = new Uint8Array(96 * 96 * 4);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 96; x++) pixels.set([x, y, 62, 255], (y * 96 + x) * 4);
  await panel
    .getByLabel('打开定稿', { exact: true })
    .setInputFiles({
      name: 'crop.png',
      mimeType: 'image/png',
      buffer: Buffer.from(encode({ width: 96, height: 96, channels: 4, data: pixels })),
    });
  await done();
  await click('框选母版细拆');
  const canvas = page.locator('canvas.layer-surface'),
    b = await canvas.boundingBox();
  await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.75);
  await page.mouse.up();
  await panel.getByLabel('拆层说明').fill('1. 前片 2. 中间片 3. 底片，自动补全遮挡。');
  await click('开始细拆');
  await confirmLocalUpscale(page);
  await done();
  assert.equal(requests.length, 1);
  assert.deepEqual([requests[0].width, requests[0].height], [512, 512]);
  assert.deepEqual([...requests[0].data.slice(0, 4)], [24, 24, 62, 255]);
  const middle = panel.locator('.layer-pool-item').filter({ hasText: '中间片' }).getByRole('checkbox');
  await middle.uncheck();
  await done();
  await page.reload();
  await enter();
  assert.equal(await middle.isChecked(), false);
  await middle.check();
  await done();
  await panel.getByRole('button', { name: /收纳进图层栈 \(3\)/ }).click();
  await done();
  await click('多选');
  for (const name of ['底片', '前片']) await panel.getByLabel('选择送拆 ' + name).check();
  await click('细拆所选 2 层');
  await click('开始细拆');
  await confirmLocalUpscale(page);
  await done();
  assert.deepEqual([requests[1].width, requests[1].height], [512, 512]);
  const at = (x, y) => {
    const offset = ((y * 32 + 16) * 512 + x * 32 + 16) * 4;
    return [...requests[1].data.slice(offset, offset + 4)];
  };
  assert.deepEqual(at(0, 0), colors[0]);
  assert.deepEqual(at(7, 7), [0, 0, 0, 0]);
  assert.deepEqual(at(13, 13), colors[2]);
  await panel.getByRole('button', { name: /收纳进图层栈 \(3\)/ }).click();
  await done();
  const download = page.waitForEvent('download');
  await click('导出 Rig 切片包');
  const ar = await readArchive(new Blob([await readFile(await (await download).path())]));
  const m = JSON.parse(await (await ar.read('manifest.json')).text());
  assert.deepEqual(
    m.layers.map((l) => l.name),
    ['中间片', '底片', '中间片', '前片'],
  );
  assert.deepEqual(m.layers[0].rect, [30, 30, 4, 4]);
  assert.notEqual(m.layers[0].groupId, m.layers[1].groupId);
  assert.deepEqual(f.errors, []);
});

test('undersized 387×358 split offers cancel, local upscale and a configured upscale model before submission', async (t) => {
  const f = await open('seedream-v1', true, 'doubao-seedream-5-5', {
    quoteCost: 3,
    studioModels: { 'fal-upscale': { name: '模拟照片放大', provider: 'fal', operations: ['edit'], tools: ['image-edit'] } },
  }, '', true);
  t.after(() => f.context.close());
  const page = f.page;
  const sent = [];
  const read = url => decode(Buffer.from(url.split(',')[1], 'base64'));
  const resized = makePng(774, 716, [70, 180, 25, 255]).toString('base64');
  const part = makePng(32, 32, [90, 60, 190, 255]).toString('base64');
  let failUpscale = false;
  await page.route('**/primary/v1/image/tools/run', route => {
    const body = route.request().postDataJSON();
    sent.push({ kind: 'upscale', model: body.model, cost: body.max_cost, image: read(body.init_image) });
    return failUpscale
      ? route.fulfill({ status: 422, json: { error: { message: '模拟放大失败' } } })
      : route.fulfill({ json: { data: [{ b64_json: resized }] } });
  });
  await page.route('**/service/api/v3/images/generations', route => {
    const body = route.request().postDataJSON();
    sent.push({ kind: 'split', image: read(body.image) });
    return route.fulfill({ json: { data: [{
      b64_json: part, name: '发丝', z_index: 1, bounding_box: { normalized: [250, 250, 750, 750] },
    }] } });
  });
  await page.goto(new URL('/#/edit', page.url()).href);
  await page.waitForSelector('#imageEditor');
  await page.evaluate(async () => {
    const { newProject } = await import('/src/layer/project.ts');
    const { layerStorage } = await import('/src/layer/storage.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const project = newProject('small-split', '细拆尺寸测试', { width: 512, height: 512, data: new Uint8Array(512 * 512 * 4) });
    const width = 387, height = 358, pixels = new Uint8Array(width * height * 4);
    for (let y = 10; y < height - 10; y++) {
      for (let x = 10; x < width - 10; x++) pixels.set([160, 80, 40, 160], (y * width + x) * 4);
    }
    project.layers = [{ id: 'front-hair', name: '前发', x: 32, y: 40, width, height, pixels, visible: true, locked: false }];
    project.activeLayerId = 'front-hair';
    await layerStorage(app).save(project);
  });
  await page.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  const panel = page.locator('.layer-panel');
  const dialog = page.getByRole('dialog', { name: '拆层送图尺寸不足' });
  const done = () => page.locator('.layer-panel[aria-busy="false"]').waitFor();
  const start = () => panel.getByRole('button', { name: '开始细拆', exact: true }).click();
  const chooseModel = async () => {
    const select = dialog.getByLabel('放大方式');
    const label = (await select.getByRole('option', { name: /模拟照片放大/ }).textContent()).trim();
    await select.selectOption({ label });
    await dialog.getByRole('button', { name: '放大并继续', exact: true }).click();
  };
  await done();
  await panel.getByRole('button', { name: '↳ 继续细拆此件', exact: true }).click();
  await start();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /387×358.*262,144.*533×493/s);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await done();
  assert.deepEqual(sent, []);
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.endsWith('/tools/estimate')).length, 0);
  assert.equal(await panel.locator('.layer-pool-item').count(), 0);

  await start();
  await confirmLocalUpscale(page);
  await done();
  assert.deepEqual(sent.map(r => r.kind), ['split']);
  assert.deepEqual([sent[0].image.width, sent[0].image.height], [533, 493]);
  assert.equal(sent[0].image.data[3], 0);
  assert.match(await panel.locator('.layer-pool-note').innerText(), /533×493.*本地放大/);

  await start();
  await chooseModel();
  await done();
  assert.deepEqual(sent.map(r => r.kind), ['split', 'upscale', 'split']);
  assert.deepEqual([sent[1].model, sent[1].cost, sent[1].image.width, sent[1].image.height], ['fal-upscale', 3, 387, 358]);
  assert.deepEqual([sent[2].image.width, sent[2].image.height, sent[2].image.data[3]], [533, 493, 0]);
  const mid = (246 * 533 + 266) * 4;
  assert.deepEqual([...sent[2].image.data.slice(mid, mid + 4)], [70, 180, 25, 160]);
  const checkpoint = await page.evaluate(async () => {
    const { layerStorage } = await import('/src/layer/storage.ts');
    const providers = document.body.__vue_app__._context.provides;
    const app = providers[Object.getOwnPropertySymbols(providers).find(k => k.description === 'application-services')];
    const project = await layerStorage(app).read('small-split');
    const source = project.layers[0];
    return { source: [source.width, source.height], rect: project.pendingSplit.batch.layers[0].box };
  });
  assert.deepEqual(checkpoint, { source: [387, 358], rect: { x: 129, y: 130, width: 193, height: 179 } });

  failUpscale = true;
  await start();
  await chooseModel();
  await done();
  assert.deepEqual(sent.map(r => r.kind), ['split', 'upscale', 'split', 'upscale']);
  assert.match(await panel.getByRole('alert').innerText(), /模拟放大失败/);
  assert.equal(await panel.locator('.layer-pool-item').count(), 1);
  assert.deepEqual(f.errors, []);
});

test('in-flight targeted reroll exposes live cancel button immediately and aborts cleanly', async (t) => {
  const f = await open('seedream-v1', true, 'doubao-seedream-5-5');
  t.after(() => f.context.close());
  const p = f.page;
  let release;
  const inflight = new Promise((r) => { release = r; });
  t.after(() => release());
  await p.route('**/service/api/v3/images/generations', async (route) => {
    await inflight;
    await route.abort();
  });
  await p.goto(new URL('/#/edit', p.url()).href);
  await p.getByRole('button', { name: 'Koma Layer', exact: true }).click();
  const panel = p.locator('#imageEditor');
  const done = () => p.locator('.layer-panel[aria-busy="false"]').waitFor();
  await panel.getByLabel('打开定稿', { exact: true }).setInputFiles({
    name: 'figure.png',
    mimeType: 'image/png',
    buffer: makeFigurePng(96, [85, 110, 150, 255]),
  });
  await done();
  await panel.getByRole('tab', { name: '局部补画', exact: true }).click();
  const canvas = p.locator('canvas.layer-surface');
  const box = await canvas.boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await done();

  await panel.getByRole('button', { name: '生成透明部件', exact: true }).click();
  // Live cancel button renders immediately and is clickable while upstream is pending.
  const cancelBtn = panel.getByRole('button', { name: '取消生成', exact: true });
  await cancelBtn.waitFor();
  assert.equal(await cancelBtn.isDisabled(), false);
  await cancelBtn.click();
  await done();
  assert.match(await panel.innerText(), /已取消当前生成/);
  assert.equal(await panel.getByRole('button', { name: '生成透明部件', exact: true }).isEnabled(), true);
  assert.deepEqual(f.errors, []);
});
