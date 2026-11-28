import assert from 'node:assert/strict';
import test from 'node:test';
import { decode } from 'fast-png';
import { newProject, layerVisible } from '../src/layer/project.ts';
import { splitSource, admitSplit } from '../src/layer/recursive.ts';
import { resolveLayerPlacement, responseFrame } from '../src/layer/placement.ts';
import { packageFiles } from '../src/layer/export.ts';
import { toggleGroupVisible } from '../src/layer/stack.ts';
import { layerContext, layerConflict, applyLayerEdits } from '../src/layer/planning.ts';
import { parseLayerPatch, validateLayer } from '../src/ask/draft/layer.ts';
import { layerPictureId, scalpelInputs } from '../src/layer/scalpel-references.ts';
import { scalpelFrame, scalpelResolution, placeScalpelReply, restoreScalpelSurface } from '../src/layer/scalpel-resolution.ts';

test('scalpel references respect explicit slots and draft changes, stale sources and role conflicts', () => {
  const p = project(), ref = { picture: layerPictureId('头部'), usage: '参考发色' };
  const ctx = layerContext(p, '局部补画', 'scalpel', undefined, { name: '双图', maxImages: 2 });
  const step = { kind: 'layer_references', references: [ref] };
  const patch = parseLayerPatch(ctx, [step], '参考头部补画');
  assert.deepEqual(applyLayerEdits(p, patch, false).scalpelReferences, [ref]);
  assert.deepEqual(applyLayerEdits({ ...p, scalpelReferences: [ref] }, patch, true).scalpelReferences, []);
  assert.throws(() => applyLayerEdits({ ...p, layers: [] }, patch, false), /删除或归档/);
  assert.throws(() => applyLayerEdits({ ...p, scalpelOccluderIds: ['头部'] }, patch, false), /排除遮挡/);
  assert.throws(() => parseLayerPatch(ctx, [{ ...step, references: [ref, ref] }], ''), /重复/);
  assert.throws(() => parseLayerPatch(ctx, [{ ...step, references: [ref, { ...ref, picture: layerPictureId('手套') }] }], ''), /最多接收 2 张/);
  assert.equal(scalpelInputs(2, 1, false).firstReference, 2);
  assert.equal(scalpelInputs(3, 1, true).occluderIndex, 2);
  assert.equal(scalpelInputs(4, 1, true).firstReference, 4);
});

test('scalpel framing clamps strictly inside canvas, preserves natural aspect ratio, and never stretches replies non-uniformly', () => {
  const field = (def, ...options) => ({ default: def, options });
  const model = { fields: { image_size: field('1K', '1K','2K','4K'), aspect_ratio: field('1:1', '1:1', '3:4', '4:3') } };
  assert.deepEqual(scalpelResolution(model, { width: 1408, height: 1408 }), {
    key: 'image_size', value: '2K', width: 2048, height: 2048, side: 2048, aspectRatio: '1:1',
  });
  assert.equal(scalpelResolution(model, { width: 1200, height: 1600 }).aspectRatio, '3:4');
  // Seedream 5.5 custom WxH preserves portrait 2800x3600 ratio within 2K pixel budget (never forced 1:1).
  const seedream55 = {
    family: 'seedream',
    provider: 'seedream',
    templateId: 'seedream-5.5',
    fields: { size: { default: '2K', options: ['1K', '1.5K', '2K'], allowCustom: true } },
  };
  const sdRes = scalpelResolution(seedream55, { width: 2800, height: 3600 });
  assert.equal(sdRes.value, '1808x2304');
  assert.ok(sdRes.width * sdRes.height <= 2048 * 2048);
  assert.ok(Math.abs(sdRes.width / sdRes.height - 2800 / 3600) < 0.01);
  // OpenAI discrete WxH chooses portrait 1024x1536 for portrait frame and square 1024x1024 for square frame.
  assert.equal(scalpelResolution({ fields: { size: field('auto', 'auto','1024x1024','1024x1536') } }, 1900).value, '1024x1024');
  assert.equal(scalpelResolution({ fields: { size: field('auto', 'auto','1024x1024','1024x1536') } }, { width: 800, height: 1200 }).value, '1024x1536');
  assert.equal(scalpelResolution({ fields: {} }, 1500), undefined);

  // scalpelFrame: large painted area defaults to exact full canvas; small edge area clamps inside [0, refW] x [0, refH].
  const refLarge = { width: 200, height: 300, data: new Uint8Array(200 * 300 * 4) };
  const bigAlpha = new Uint8Array(200 * 300);
  for (let y = 60; y < 220; y++) for (let x = 40; x < 160; x++) bigAlpha[y * 200 + x] = 255;
  assert.deepEqual(
    scalpelFrame({ reference: refLarge, alpha: bigAlpha }, { mode: 'auto', model: seedream55 }),
    { x: 0, y: 0, width: 200, height: 300 },
  );
  const smallAlpha = new Uint8Array(200 * 300);
  for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) smallAlpha[y * 200 + x] = 255;
  const smallFrame = scalpelFrame({ reference: refLarge, alpha: smallAlpha }, { mode: 'auto', model: seedream55 });
  assert.ok(smallFrame.x >= 0 && smallFrame.y >= 0 && smallFrame.x + smallFrame.width <= 200 && smallFrame.y + smallFrame.height <= 300);

  const src = { width: 3, height: 1, data: Uint8Array.of(20,9,7,17, 44,88,2,127, 255,0,0,255) };
  const placed = placeScalpelReply(src, { x:-1, y:0, width:3, height:1 }, { width:2, height:1 });
  assert.deepEqual([...placed.data], [44,88,2,127, 255,0,0,255]);
  const ref = { width:3, height:1, data:Uint8Array.of(255,0,0,127, 0,0,255,255, 0,0,0,255) };
  const result = { width:3, height:1, data:Uint8Array.of(0,0,255,127, 80,20,60,127, 0,0,0,0) };
  restoreScalpelSurface(result, { reference:ref, alpha:Uint8Array.of(128,255,255), occluded:Uint8Array.of(0,255,0) }, {x:0,y:0,width:3,height:1});
  assert.deepEqual([...result.data], [128,0,127,127, 80,20,60,127, 0,0,0,0]);
});

function raster(w, h, color = 127) {
  return { width: w, height: h, data: new Uint8Array(w * h * 4).fill(color) };
}
function leaf(id, x, y, r) {
  return {
    id,
    name: id,
    x,
    y,
    width: r.width,
    height: r.height,
    pixels: r.data,
    visible: true,
    locked: false,
  };
}
const project = () => ({
  ...newProject('sample', '眼部', raster(256, 200)),
  layers: [
    leaf('躯干', 0, 0, raster(1, 1)),
    leaf('头部', 40, 28, raster(156, 144)),
    leaf('手套', 1, 1, raster(1, 1)),
  ],
});
test('ASK validates scalpel layer selections by identity at proposal, apply and undo', () => {
  const p = project(), ctx = layerContext(p, '局部补画', 'scalpel');
  const step = ids => ({ kind:'layer_scalpel_source', layer_ids:ids });
  const patch = parseLayerPatch(ctx, [step(['手套','头部'])], '选择这两层补画');
  const applied = applyLayerEdits(p, patch, false);
  assert.deepEqual(applied.scalpelLayerIds, ['头部','手套']);
  assert.throws(() => parseLayerPatch(ctx,[step(['手套','手套'])],''), /重复/);
  assert.throws(() => parseLayerPatch(ctx,[step(['不存在'])],''), /已删除或归档/);
  assert.throws(() => applyLayerEdits({ ...p, layers:p.layers.map(l => ({...l, archived:l.id==='手套'})) }, patch, false), /已删除或归档/);
  assert.throws(() => applyLayerEdits({ ...p, scalpelOccluderIds:['头部'] }, patch, false), /排除遮挡/);
  assert.throws(() => applyLayerEdits({ ...applied, scalpelLayerIds:['手套'] }, patch, true), /选择已变化/);
  const reset = parseLayerPatch(layerContext(applied,'',''),[step([])],'改回母版');
  assert.equal(applyLayerEdits(applied,reset,false).scalpelLayerIds, undefined);
  assert.equal(applyLayerEdits(applied,patch,true).scalpelLayerIds, undefined);
});
test('missing-component ASK setup is reviewed atomically and can use a foreground excluded from ordinary paint', () => {
  const p = { ...project(), scalpelName:'旧部件', scalpelLayerIds:['躯干'], scalpelOccluderIds:['手套'] };
  const ctx = layerContext(p, '局部补画', 'scalpel');
  const step = { kind:'layer_scalpel_source', mode:'missing', component:'袖口', layer_ids:['手套','躯干'] };
  const patch = parseLayerPatch(ctx, [step], '补全袖口');
  assert.equal(patch.edits.length, 1);
  const next = applyLayerEdits(p, patch, false);
  assert.equal(next.scalpelName, '袖口');
  assert.equal(next.scalpelMode, 'missing');
  assert.deepEqual(next.missingLayerIds, ['手套','躯干']);
  assert.deepEqual(next.scalpelLayerIds, p.scalpelLayerIds);
  assert.deepEqual(next.scalpelOccluderIds, p.scalpelOccluderIds);
  const master = parseLayerPatch(layerContext(next,'',''), [{ ...step, layer_ids: [] }], '使用母版原图');
  const onMaster = applyLayerEdits(next, master, false);
  assert.equal(onMaster.scalpelMode, 'missing');
  assert.equal(onMaster.missingLayerIds, undefined);
  assert.deepEqual(applyLayerEdits(onMaster, master, true).missingLayerIds, next.missingLayerIds);
  assert.throws(() => applyLayerEdits({ ...p, scalpelName:'手动改名' }, patch, false), /已变化/);
  assert.throws(() => applyLayerEdits({ ...next, missingLayerIds:[] }, patch, true), /已变化/);
  const changed = parseLayerPatch(layerContext(next,'',''), [{ ...step, layer_ids:['手套'] }], '只参考手套');
  assert.throws(() => applyLayerEdits({ ...next, scalpelMode:'paint' }, changed, false), /已变化/);
  const undo = applyLayerEdits(next, patch, true);
  assert.equal(undo.scalpelMode, 'paint');
  assert.equal(undo.scalpelName, p.scalpelName);
  assert.equal(undo.missingLayerIds, undefined);
});

test('missing-component admission checks the frozen references, uncertain placement and residual base', () => {
  const p = project(), source = splitSource(p, ['头部','手套']);
  const r = raster(2,2), part = { id:'ear', name:'候选', local:true, raster:r, preview:r,
    box:{ x:41,y:29,width:2,height:2 }, width:2,height:2,zIndex:1,isBase:false,source:'decompose' };
  const batch = { id:'ear-batch', projectId:p.id, componentName:'左耳', source, layers:[part] };
  assert.throws(() => admitSplit({ ...p, layers:p.layers.map(l => l.id === '头部' ? {...l,x:12} : l) }, batch, [part], false), /来源层已变化/);
  assert.throws(() => admitSplit(p,batch,[{...part,needsPosition:true}],false), /确认待定位/);
  assert.throws(() => admitSplit(p,batch,[{...part,isBase:true}],true), /独立部件/);
  const after = admitSplit(p,batch,[part],true);
  assert.deepEqual(after.layers.map(l => l.name), ['躯干','头部','左耳','手套']);
  assert.deepEqual(after.layers.filter(l => l.candidateId !== 'ear'), p.layers);
});

for (const includeBase of [true, false])
  test(
    'layer package preserves native eye textures and exact absolute location ' +
      (includeBase ? 'with base' : 'crops only'),
    async () => {
      const p = project(),
        source = splitSource(p, ['头部']);
      const entries = [
        { name: '高光', r: raster(31, 34, 111), meta: { box: [3, 9, 33, 42], zIndex: 2 } },
        { name: '睫毛', r: raster(59, 64, 185), meta: { box: [55, 40, 114, 104], zIndex: 3 } },
        ...(includeBase ? [{ name: '脸底', r: raster(156, 144, 255), meta: { zIndex: 0 } }] : []),
      ];
      const frame = responseFrame(
        entries.map((e) => ({ size: e.r, meta: e.meta })),
        source.rect,
      );
      const items = entries.map(({ name, r, meta }) => ({
        id: name,
        name,
        box: resolveLayerPlacement(r, frame, source.rect, meta),
        raster: r,
        preview: r,
        local: true,
        width: r.width,
        height: r.height,
        zIndex: meta.zIndex,
        isBase: meta.zIndex === 0,
        source: 'decompose',
      }));
      const batch = {
        id: 'batch',
        source,
        layers: items,
        targetName: '头部',
        model: 'test',
        route: 'test',
        prompt: '',
      };
      const next = admitSplit(p, batch, items, true);
      const file = new Map(packageFiles(next));
      const m = JSON.parse(await file.get('manifest.json').text());
      assert.deepEqual(
        m.layers.map((l) => l.name),
        ['躯干', ...(includeBase ? ['脸底'] : []), '高光', '睫毛', '手套'],
      );
      for (const [name, rect] of [
        ['高光', [43, 37, 31, 34]],
        ['睫毛', [95, 68, 59, 64]],
      ]) {
        const l = m.layers.find((l) => l.name === name);
        assert.deepEqual(l.rect, rect);
        assert.deepEqual(
          decode(new Uint8Array(await file.get(l.texture).arrayBuffer())).data,
          entries.find((e) => e.name === name).r.data,
        );
      }
      const muted = toggleGroupVisible(next.layers, ['batch']);
      assert.deepEqual(
        muted.filter(layerVisible).map((l) => l.name),
        ['躯干', '手套'],
      );
      assert.equal(toggleGroupVisible(muted, ['batch']).find((l) => l.id === '头部').visible, false);
      assert.throws(() => admitSplit(next, batch, items, true), /已经收纳/);
      const stale = { ...p, layers: p.layers.map((l) => (l.id === '头部' ? { ...l, x: l.x + 1 } : l)) };
      assert.throws(() => admitSplit(stale, batch, items, true), /来源层已变化/);
    },
  );
test('ASK can adjust only the selected split limit, preserving unrelated prompt edits on apply and undo', () => {
  const key = JSON.stringify(['头部']);
  const p = {
    ...project(),
    decomposeMax: 9,
    subForms: {
      [key]: { prompt: '手写头部拆层词', max: 8, unlimited: true },
    },
  };
  const state = layerContext(p, 'layers', key);
  const step = { kind: 'layer_prompt', target: 'sub', max: 12 };
  const patch = parseLayerPatch(state, [step], '预计九件，给细拆多留几层');
  const before = { ...p, subForms: { [key]: { ...p.subForms[key], prompt: '刚刚细化过的词' } } };
  const result = applyLayerEdits(before, patch, false);
  assert.deepEqual(result.subForms[key], { prompt: '刚刚细化过的词', max: 12, unlimited: false });
  assert.equal(result.decomposeMax, 9);
  const revised = { ...result, subForms: { [key]: { ...result.subForms[key], prompt: '再次细化' } } };
  assert.deepEqual(applyLayerEdits(revised, patch, true).subForms[key], {
    prompt: '再次细化',
    max: 8,
    unlimited: true,
  });
  const otherLimit = { ...p, subForms: { [key]: { ...p.subForms[key], max: 17, unlimited: false } } };
  assert.throws(() => applyLayerEdits(otherLimit, patch, false), /已变化/);
  assert.throws(() => parseLayerPatch(state, [{ ...step, target: 'scalpel' }], ''), /单件补画/);
  assert.throws(
    () => parseLayerPatch(state, [{ kind: 'layer_prompt', target: 'sub' }], ''),
    /说明或最多层数/,
  );
  for (const max of [1, 100, 2.5])
    assert.throws(() => parseLayerPatch(state, [{ ...step, max }], ''), /2–99/);
  for (const max of [2, 9, 99])
    assert.equal(parseLayerPatch(state, [{ ...step, max }], '').edits[0].after.max, max);
});

test('ASK separates three targets, retains human checklist progress, and detects field or project conflicts', () => {
  const p = project(),
    s = layerContext(p, 'layers', '["头部"]');
  const patch = parseLayerPatch(
    s,
    [
      { kind: 'layer_prompt', target: 'master', prompt: '全身', max: 9 },
      { kind: 'layer_prompt', target: 'sub', prompt: '头部', max: 16 },
      { kind: 'layer_prompt', target: 'scalpel', prompt: '马尾' },
      {
        kind: 'layer_todos',
        parts: [
          {
            name: '头部',
            prompt: '全身顺序',
            sub_prompt: '头部顺序',
            sub_max: 16,
            children: [{ name: '眼白', prompt: '补圆边缘' }],
          },
        ],
      },
    ],
    '规划拆层',
  );
  const applied = applyLayerEdits(p, patch, false);
  assert.deepEqual(
    [applied.decomposePrompt, applied.subForms['["头部"]'].prompt, applied.scalpelInstruction],
    ['全身', '头部', '马尾'],
  );
  assert.equal(applied.todos[0].subPrompt, '头部顺序');
  assert.equal(applied.todos[1].parent, applied.todos[0].id);
  assert.equal(layerConflict(layerContext(applied, 'master', 'master'), patch, 'after'), '');
  assert.equal(applyLayerEdits(applied, patch, true).scalpelInstruction, '');
  assert.match(layerConflict({ ...s, projectId: 'other' }, patch, 'before'), /切换/);
  assert.match(
    layerConflict(
      layerContext({ ...applied, decomposePrompt: '我改过的词' }, 'master', 'master'),
      patch,
      'after',
    ),
    /变化/,
  );
  const edited = {
    ...applied,
    todos: applied.todos.map((t) => ({ ...t, done: true, layerId: '头部' })),
  };
  const increment = parseLayerPatch(
    layerContext(edited, 'layers', '["头部"]'),
    [{ kind: 'layer_todos', parts: [{ id: edited.todos[0].id, name: '头部', prompt: '新指引' }] }],
    '增补备忘',
  );
  assert.deepEqual(
    applyLayerEdits(edited, increment, false).todos.map((t) => [t.done, t.layerId]),
    [
      [true, '头部'],
      [true, '头部'],
    ],
  );
  assert.throws(
    () => parseLayerPatch(s, [{ kind: 'layer_rename', layer_id: '头部', name: 'head' }], '先看头部'),
    /用户提出/,
  );
  assert.throws(
    () => parseLayerPatch(s, [{ kind: 'layer_rename', layer_id: '头部', name: 'head' }], '不要改名'),
    /用户提出/,
  );
  assert.throws(() => parseLayerPatch(s, [{ kind: 'layer_generate' }], '拆层'), /只接受/);
  const rename = parseLayerPatch(
    s,
    [
      { kind: 'layer_rename', layer_id: '头部', name: 'head' },
      { kind: 'layer_rename', layer_id: '手套', name: 'glove' },
    ],
    '简化图层名并改名',
  );
  const plan = validateLayer(
    { title: '改名', layerPatch: rename },
    { conversationId: 'chat', layer: s },
    new Set(['layer:1']),
  );
  const renamed = applyLayerEdits(p, plan.layerPatch, false);
  assert.deepEqual(
    renamed.layers.map((l) => l.name),
    ['躯干', 'head', '手套'],
  );
  assert.deepEqual(renamed.layers[1].pixels, p.layers[1].pixels);
});
