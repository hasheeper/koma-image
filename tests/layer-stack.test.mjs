import test from 'node:test';
import assert from 'node:assert/strict';
import { layerVisible, migrateProject, newProject } from '../src/layer/project.ts';
import {
  admitPoolLayers,
  applyBrushStroke,
  applyLayerToneMatch,
  applyPhotopeaReturn,
  applySmudgeStroke,
  brushCoverage,
  compositeLayers,
  deleteGroup,
  deleteLayer,
  duplicateLayer,
  estimateLayerToneMatch,
  importImageLayers,
  mergeDownLayer,
  offsetLayer,
  renameGroup,
  renameLayer,
  reorderLayer,
  restoreAllLayersUnoccludedMaster,
  restoreLayerUnoccludedMaster,
  splitLayerByLasso,
  splitLayerByRect,
  toggleGroupVisible,
  toggleLayerLock,
  toggleLayerVisible,
  ungroupLayers,
} from '../src/layer/stack.ts';
import { alignRasterToReference } from '../src/layer/align.ts';
import { packageFiles, psdLayers } from '../src/layer/export.ts';
import { layeredPsd, photopeaLayerPsd } from '../src/layer/psd.ts';
import { recordGuide, travelGuide } from '../src/layer/mask-history.ts';

function makeRaster(width, height, paint) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = paint(x, y);
      if (rgba) data.set(rgba, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function makePoolItem(name, width, height, box, paint) {
  const raster = makeRaster(width, height, paint);
  return {
    id: crypto.randomUUID(),
    name,
    preview: raster,
    raster,
    box,
    zIndex: 1,
    isBase: false,
    width: box.width,
    height: box.height,
    source: 'decompose',
  };
}

test('migrateProject upgrades legacy v1 checkpoints cleanly without losing confirmed parts', () => {
  const ref = makeRaster(32, 32, (x, y) => (x >= 8 && x < 24 && y >= 8 && y < 24 ? [120, 140, 160, 255] : null));
  const v1 = {
    id: 'legacy-1',
    title: '旧版定稿',
    revision: 4,
    base: ref,
    parts: [
      {
        id: 'p1',
        name: '右马尾',
        x: 8,
        y: 8,
        width: 8,
        height: 8,
        pixels: new Float32Array(8 * 8 * 4).fill(200),
      },
    ],
    alpha: new Uint8Array(32 * 32),
    name: '待修部件',
    instruction: '接通袖口',
    repairModel: 'doubao-seedream-5-5',
  };
  const migrated = migrateProject(v1);
  assert.equal(migrated.format, 'koma-layer.v2');
  assert.equal(migrated.layers.length, 1);
  assert.equal(migrated.layers[0].name, '右马尾');
  assert.equal(migrated.layers[0].visible, true);
  assert.equal(migrated.layers[0].locked, false);
  assert.equal(migrated.layers[0].pixels[0], 200);
  assert.equal(migrated.scalpelName, '待修部件');
  assert.equal(migrated.rerollModel, 'doubao-seedream-5-5');
});

test('admitPoolLayers trims transparent borders, preserves coordinates, and never overwrites existing stack layers', () => {
  const ref = makeRaster(64, 64, () => [200, 200, 200, 255]);
  let project = newProject('p1', 'test', ref);

  const itemA = makePoolItem(
    '头发',
    64,
    64,
    { x: 4, y: 4, width: 24, height: 24 },
    (x, y) => (x >= 8 && x < 16 && y >= 10 && y < 18 ? [180, 185, 195, 255] : null),
  );
  project = admitPoolLayers(project, [itemA]);
  assert.equal(project.layers.length, 1);
  assert.equal(project.layers[0].x, 8);
  assert.equal(project.layers[0].y, 10);
  assert.equal(project.layers[0].width, 8);
  assert.equal(project.layers[0].height, 8);
  const firstId = project.layers[0].id;

  const itemB = makePoolItem(
    '外套',
    64,
    64,
    { x: 20, y: 20, width: 20, height: 20 },
    (x, y) => (x >= 24 && x < 34 && y >= 24 && y < 34 ? [40, 50, 70, 255] : null),
  );
  project = admitPoolLayers(project, [itemB]);
  assert.equal(project.layers.length, 2);
  assert.equal(project.layers[0].id, firstId);
  assert.equal(project.layers[1].name, '外套');
});

test('PS-like stack operations: reorder, visibility, lock guard, rename, duplicate, merge down, offset, composite', () => {
  const ref = makeRaster(32, 32, () => [255, 255, 255, 255]);
  let p = newProject('p2', 'stack', ref);
  const red = makePoolItem('底层红', 32, 32, { x: 4, y: 4, width: 12, height: 12 }, (x, y) =>
    x >= 4 && x < 16 && y >= 4 && y < 16 ? [220, 40, 40, 255] : null,
  );
  const blue = makePoolItem('上层蓝', 32, 32, { x: 8, y: 8, width: 12, height: 12 }, (x, y) =>
    x >= 8 && x < 20 && y >= 8 && y < 20 ? [40, 80, 220, 255] : null,
  );
  p = admitPoolLayers(p, [red, blue]);
  const [bottom, top] = p.layers;

  // Before reorder: overlap pixel (10, 10) is blue (top).
  const comp1 = compositeLayers(p.layers, 32, 32);
  assert.deepEqual([...comp1.data.slice((10 * 32 + 10) * 4, (10 * 32 + 10) * 4 + 4)], [40, 80, 220, 255]);

  // Reorder top to bottom: overlap pixel (10, 10) becomes red.
  let layers = reorderLayer(p.layers, top.id, bottom.id);
  const comp2 = compositeLayers(layers, 32, 32);
  assert.deepEqual([...comp2.data.slice((10 * 32 + 10) * 4, (10 * 32 + 10) * 4 + 4)], [220, 40, 40, 255]);

  // Solo shows only the soloed layer even when hidden.
  layers = toggleLayerVisible(layers, top.id);
  const compSolo = compositeLayers(layers, 32, 32, { soloId: top.id });
  assert.deepEqual([...compSolo.data.slice((10 * 32 + 10) * 4, (10 * 32 + 10) * 4 + 4)], [40, 80, 220, 255]);
  assert.deepEqual([...compSolo.data.slice((5 * 32 + 5) * 4, (5 * 32 + 5) * 4 + 4)], [0, 0, 0, 0]);

  // Lock blocks delete, offset, and mergeDown.
  layers = toggleLayerLock(layers, bottom.id);
  assert.throws(() => deleteLayer(layers, bottom.id), /锁定/);
  const sameOffset = offsetLayer(layers, bottom.id, 5, 5);
  assert.equal(sameOffset.find((l) => l.id === bottom.id).x, bottom.x);
  assert.throws(() => mergeDownLayer(layers, bottom.id), /锁定/);

  // Unlock, rename, duplicate, offset, and mergeDown.
  layers = toggleLayerLock(layers, bottom.id);
  layers = renameLayer(layers, bottom.id, '左袖口');
  assert.equal(layers.find((l) => l.id === bottom.id).name, '左袖口');

  const dup = duplicateLayer(layers, bottom.id);
  assert.equal(dup.layers.length, 3);
  assert.equal(dup.created.name, '左袖口 副本');

  const moved = offsetLayer(dup.layers, dup.created.id, 3, -2);
  assert.equal(moved.find((l) => l.id === dup.created.id).x, bottom.x + 3);
  assert.equal(moved.find((l) => l.id === dup.created.id).y, bottom.y - 2);

  const merged = mergeDownLayer(layers, bottom.id);
  assert.equal(merged.layers.length, 1);
  assert.equal(merged.merged.width, 16);
  assert.equal(merged.merged.height, 16);
});

test('Tier-1 zero-AI split: splitLayerByRect and splitLayerByLasso cleanly separate symmetrical parts', () => {
  const ref = makeRaster(64, 64, () => [200, 200, 200, 255]);
  let p = newProject('p3', 'twintails', ref);
  // Two disconnected twintails merged on a single layer: left [8..20], right [44..56].
  const merged = makePoolItem('双马尾', 64, 64, { x: 0, y: 0, width: 64, height: 64 }, (x, y) => {
    if (y >= 10 && y < 40 && ((x >= 8 && x < 20) || (x >= 44 && x < 56))) return [190, 195, 205, 255];
    return null;
  });
  p = admitPoolLayers(p, [merged]);
  const layerId = p.layers[0].id;

  const rectSplit = splitLayerByRect(p.layers, layerId, { x: 40, y: 0, width: 24, height: 64 });
  assert.equal(rectSplit.layers.length, 2);
  assert.equal(rectSplit.layers[0].x, 8);
  assert.equal(rectSplit.layers[0].width, 12);
  assert.equal(rectSplit.layers[1].x, 44);
  assert.equal(rectSplit.layers[1].width, 12);

  const lassoSplit = splitLayerByLasso(p.layers, layerId, [
    { x: 2, y: 2 },
    { x: 28, y: 2 },
    { x: 28, y: 50 },
    { x: 2, y: 50 },
  ]);
  assert.equal(lassoSplit.layers.length, 2);
  assert.equal(lassoSplit.created.x, 8);
  assert.equal(lassoSplit.created.width, 12);
  assert.equal(lassoSplit.layers[0].x, 44);
});

test('applyBrushStroke supports soft/hard eraser and lossless restore-from-reference with bounds expansion', () => {
  const ref = makeRaster(64, 64, (x, y) =>
    x >= 4 && x < 60 && y >= 4 && y < 60 ? [120, 160, 210, 255] : null,
  );
  let p = newProject('p4', 'brush', ref);
  const part = makePoolItem('头发', 64, 64, { x: 16, y: 16, width: 32, height: 32 }, (x, y) =>
    x >= 16 && x < 48 && y >= 16 && y < 48 ? [120, 160, 210, 255] : null,
  );
  p = admitPoolLayers(p, [part]);

  // Verify radial coverage falloff: soft brush has smooth partial alpha at mid-radius.
  assert.equal(brushCoverage(0, 10, 0), 1);
  const softMid = brushCoverage(5, 10, 0);
  assert.ok(softMid > 0.3 && softMid < 0.7, `expected smooth falloff, got ${softMid}`);
  assert.equal(brushCoverage(5, 10, 1), 1);

  // Soft erase at center (32, 32) with diameter 20, hardness 0
  const erased = applyBrushStroke(p.layers[0], ref, 'erase', [{ x: 32, y: 32 }], 20, 0);
  assert.ok(erased);
  const centerAlpha = erased.pixels[((32 - erased.y) * erased.width + (32 - erased.x)) * 4 + 3];
  const rimAlpha = erased.pixels[((32 - erased.y) * erased.width + (37 - erased.x)) * 4 + 3];
  assert.ok(centerAlpha < 10);
  assert.ok(rimAlpha > 80 && rimAlpha < 200, `expected feathered alpha, got ${rimAlpha}`);

  // Restore from reference outside initial bounds at (10, 10) expands layer bounds automatically
  const restored = applyBrushStroke(erased, ref, 'restore', [{ x: 10, y: 10 }], 8, 1);
  assert.ok(restored);
  assert.ok(restored.x <= 10 && restored.y <= 10);
  const rx = 10 - restored.x;
  const ry = 10 - restored.y;
  assert.deepEqual([...restored.pixels.slice((ry * restored.width + rx) * 4, (ry * restored.width + rx) * 4 + 4)], [
    120, 160, 210, 255,
  ]);
  assert.equal(restored.restoredMask[ry * restored.width + rx], 255);
});

test('applyLayerToneMatch aligns color-shifted AI pixels reversibly and preserves reference-restored pixels', () => {
  const ref = makeRaster(48, 48, (x, y) => [100 + x, 110 + y, 130, 255]);
  let p = newProject('p5', 'tone', ref);
  // AI layer is uniformly darker by -25 on RGB
  const shifted = makePoolItem('袖子', 48, 48, { x: 8, y: 8, width: 32, height: 32 }, (x, y) =>
    x >= 8 && x < 40 && y >= 8 && y < 40 ? [75 + x, 85 + y, 105, 255] : null,
  );
  p = admitPoolLayers(p, [shifted]);
  const est = estimateLayerToneMatch(p.layers[0], ref);
  assert.ok(est && est.samples >= 16);

  // Brush restore on (12, 12) then apply tone match
  const withRestored = applyBrushStroke(p.layers[0], ref, 'restore', [{ x: 12, y: 12 }], 4, 1);
  const fullAligned = applyLayerToneMatch(withRestored, ref, 1);
  const pxAt = (layer, x, y) => {
    const k = ((y - layer.y) * layer.width + (x - layer.x)) * 4;
    return [...layer.pixels.slice(k, k + 4)];
  };
  // AI pixel at (24, 24) should now match reference [124, 134, 130, 255] within +/-2
  const matched = pxAt(fullAligned, 24, 24);
  assert.ok(Math.abs(matched[0] - 124) <= 2 && Math.abs(matched[1] - 134) <= 2 && Math.abs(matched[2] - 130) <= 2);

  // Reversible: strength 0 restores original AI values while keeping restored pixel lossless
  const reset = applyLayerToneMatch(fullAligned, ref, 0);
  assert.deepEqual(pxAt(reset, 24, 24), [99, 109, 105, 255]);
  assert.deepEqual(pxAt(reset, 12, 12), [112, 122, 130, 255]);
});

test('packageFiles emits koma-rig.slices.v2 in visible Z-Order and layeredPsd emits valid 8BPS with visibility/lock', async () => {
  const ref = makeRaster(32, 32, () => [240, 240, 240, 255]);
  let p = newProject('p6', 'export', ref);
  const a = makePoolItem('后发', 32, 32, { x: 2, y: 2, width: 10, height: 10 }, (x, y) =>
    x >= 2 && x < 12 && y >= 2 && y < 12 ? [100, 110, 120, 255] : null,
  );
  const b = makePoolItem('隐藏层', 32, 32, { x: 6, y: 6, width: 10, height: 10 }, (x, y) =>
    x >= 6 && x < 16 && y >= 6 && y < 16 ? [180, 90, 90, 255] : null,
  );
  const c = makePoolItem('前发', 32, 32, { x: 10, y: 10, width: 10, height: 10 }, (x, y) =>
    x >= 10 && x < 20 && y >= 10 && y < 20 ? [200, 200, 210, 255] : null,
  );
  p = admitPoolLayers(p, [a, b, c]);
  p = { ...p, layers: toggleLayerVisible(p.layers, p.layers[1].id) };
  p = { ...p, layers: toggleLayerLock(p.layers, p.layers[2].id) };

  const files = packageFiles(p);
  const map = new Map(files);
  assert.ok(map.has('manifest.json'));
  assert.ok(map.has('reference.png'));
  assert.ok(map.has('textures/0.png'));
  assert.ok(map.has('textures/1.png'));
  assert.ok(!map.has('textures/2.png'));

  const manifest = JSON.parse(await map.get('manifest.json').text());
  assert.equal(manifest.format, 'koma-rig.slices.v2');
  assert.deepEqual(
    manifest.layers.map((l) => l.name),
    ['后发', '前发'],
  );

  const slices = psdLayers(p, true);
  assert.equal(slices.length, 4); // reference + 3 stack layers
  assert.equal(slices[2].visible, false);
  assert.equal(slices[3].locked, true);

  const psd = layeredPsd(p);
  const bytes = new Uint8Array(await psd.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), '8BPS');
});

test('guide history records and travels blue/orange scalpel strokes cleanly', () => {
  const size = 16 * 16;
  let state = { width: 16, height: 16, alpha: new Uint8Array(size) };
  const blue = new Uint8Array(size);
  blue[5 * 16 + 5] = 255;
  state = recordGuide(state, 'alpha', blue, 'draw');
  assert.equal(state.alpha[5 * 16 + 5], 255);

  const orange = new Uint8Array(size);
  orange[6 * 16 + 6] = 255;
  state = recordGuide(state, 'occluded', orange, 'draw');
  assert.equal(state.occluded[6 * 16 + 6], 255);

  state = travelGuide(state, 'undo');
  assert.equal(state.occluded[6 * 16 + 6], 0);
  assert.equal(state.alpha[5 * 16 + 5], 255);

  state = travelGuide(state, 'redo');
  assert.equal(state.occluded[6 * 16 + 6], 255);
});

test('groups: toggleGroupVisible, applyPhotopeaReturn diffing, PSD 8BIMlsct folders, and Rig manifest groups', async () => {
  const ref = makeRaster(32, 32, () => [240, 240, 240, 255]);
  let p = newProject('p7', 'groups', ref);
  const hair = makePoolItem('后发', 32, 32, { x: 4, y: 4, width: 10, height: 10 }, (x, y) =>
    x >= 4 && x < 14 && y >= 4 && y < 14 ? [120, 125, 135, 255] : null,
  );
  p = admitPoolLayers(p, [hair]);

  // Simulate Photopea return: 后发 moved into ['头部', '头发'] and modified + brand new layer '发饰' in same group.
  const groups = [{ id: 20, name: '头部', visible: true }, { id: 21, name: '头发', visible: true }];
  const incoming = [
    {
      photopeaId: 2,
      name: '后发',
      groups,
      visible: true,
      locked: false,
      raster: makeRaster(32, 32, (x, y) => (x >= 4 && x < 14 && y >= 4 && y < 14 ? [130, 135, 145, 255] : null)),
    },
    {
      photopeaId: 11,
      name: '发饰',
      groups,
      visible: true,
      locked: false,
      raster: makeRaster(32, 32, (x, y) => (x >= 16 && x < 22 && y >= 6 && y < 12 ? [20, 20, 25, 255] : null)),
    },
  ];
  const { layers, changes } = applyPhotopeaReturn(p.layers, incoming, { documentId: 'test', ...photopeaLayerPsd(p) });
  assert.equal(layers.length, 2);
  assert.equal(changes[layers[0].id], 'updated');
  assert.equal(changes[layers[1].id], 'new');
  assert.deepEqual(layers[0].groups, ['头部', '头发']);

  // Group visibility toggles all members in the group together.
  const root = layers[0].groupIds.slice(0, 1);
  const hiddenGroup = toggleGroupVisible(layers, root);
  assert.equal(hiddenGroup.every((l) => !layerVisible(l)), true);
  const shownGroup = toggleGroupVisible(hiddenGroup, root);
  assert.equal(shownGroup.every(layerVisible), true);

  // Rig manifest exports groups array and PSD encodes 8BIMlsct + 8BIMpass folder markers.
  p = { ...p, layers: shownGroup };
  const files = new Map(packageFiles(p));
  const manifest = JSON.parse(await files.get('manifest.json').text());
  assert.deepEqual(manifest.layers[0].groups, ['头部', '头发']);
  assert.deepEqual(manifest.layers[1].groups, ['头部', '头发']);

  const psdBytes = new Uint8Array(await layeredPsd(p).arrayBuffer());
  const ascii = new TextDecoder('latin1').decode(psdBytes);
  assert.equal(ascii.slice(0, 4), '8BPS');
  assert.ok(ascii.includes('8BIMlsct'), 'PSD must include 8BIMlsct group dividers');
  assert.ok(ascii.includes('8BIMpass'), 'PSD must include 8BIMpass folder blend mode');

  // Group rename, ungroup (preserving layers), and group deletion (blocking locked members).
  const renamed = renameGroup(shownGroup, layers[0].groupIds, '发丝');
  assert.deepEqual(renamed[0].groups, ['头部', '发丝']);
  const ungrouped = ungroupLayers(renamed, layers[0].groupIds);
  assert.deepEqual(ungrouped[0].groups, ['头部']);
  assert.equal(ungrouped.length, 2);
  const locked = toggleLayerLock(renamed, renamed[0].id);
  assert.throws(() => deleteGroup(locked, root), /已锁定/);
  const deleted = deleteGroup(renamed, root);
  assert.equal(deleted.length, 0);
});

test('Photopea moves layers between same-name folders and keeps their visibility and identities separate', () => {
  const raster = makeRaster(1, 1, () => [80, 90, 100, 255]);
  const p = newProject('pp', 'Photopea', raster);
  const stackLayer = (id, groupId) => ({
    id, name: id, groups: ['发饰'], groupIds: [groupId], photopeaId: 10,
    x: 0, y: 0, width: 1, height: 1, pixels: raster.data, visible: true, locked: false,
  });
  const archiveOrigin = { groups: ['头部'], groupIds: ['head'], index: 1, visible: true };
  p.layers = [
    stackLayer('留在 A', 'a'),
    { ...stackLayer('归档原件', 'a'), archived: true, archiveOrigin, batchId: 'a', visible: false },
    stackLayer('移到 A', 'b'),
    stackLayer('留在 B', 'b'),
  ];
  const binding = { documentId: 'test', ...photopeaLayerPsd(p) };
  const folder = (id, visible) => [{ id, name: '发饰', visible }];
  const inA = folder(5, false), inB = folder(9, true), inNew = folder(12, true);
  const item = (photopeaId, name, groups, visible = true) => ({ photopeaId, name, groups, visible, locked: false, raster });
  const incoming = [
    item(3, '留在 A', inA),
    item(7, '移到 A', inA),
    item(4, '归档原件', inA, false),
    item(8, '留在 B', inB),
    item(11, '留在 B', inNew),
  ];
  const { layers, changes } = applyPhotopeaReturn(p.layers, incoming, binding);
  assert.deepEqual(layers.slice(0, 4).map((l) => l.id), ['留在 A', '移到 A', '归档原件', '留在 B']);
  assert.deepEqual(layers.slice(0, 4).map((l) => l.groupIds), [['a'], ['a'], ['a'], ['b']]);
  assert.notEqual(layers[4].groupIds[0], 'b');
  assert.equal(changes['移到 A'], 'updated');
  assert.equal(changes[layers[4].id], 'new');
  assert.equal(layers[2].archived, true);
  assert.equal(layers[2].archiveOrigin, archiveOrigin);
  assert.deepEqual(layers.map(layerVisible), [false, false, false, true, true]);
  assert.deepEqual(toggleGroupVisible(layers, ['a']).map(layerVisible), [true, true, false, true, true]);

  const reapplied = applyPhotopeaReturn(layers, incoming, { ...binding, initialLayers: undefined });
  assert.deepEqual(reapplied.layers.map(l => [l.id, l.groupIds]), layers.map(l => [l.id, l.groupIds]));
  assert.deepEqual(reapplied.changes, {});
});

test('importImageLayers preserves 1:1 offset on full-canvas PNGs, centers smaller PNGs, and rejects empty rasters', () => {
  const ref = makeRaster(64, 64, () => [200, 200, 200, 255]);
  const p = newProject('p8', 'import', ref);
  const full = makeRaster(64, 64, (x, y) => (x >= 10 && x < 20 && y >= 12 && y < 22 ? [30, 180, 210, 255] : null));
  const small = makeRaster(16, 16, (x, y) => (x >= 2 && x < 14 && y >= 4 && y < 12 ? [240, 90, 120, 255] : null));
  const { project: next, added } = importImageLayers(p, [
    { name: '后发_精修.png', raster: full },
    { name: '蝴蝶结.webp', raster: small },
  ]);
  assert.equal(added.length, 2);
  assert.equal(next.layers.length, 2);
  assert.equal(next.activeLayerId, added[1].id);
  // Full-canvas PNG keeps exact (10, 12) offset after transparent border trim.
  assert.equal(added[0].name, '后发_精修');
  assert.deepEqual([added[0].x, added[0].y, added[0].width, added[0].height], [10, 12, 10, 10]);
  // Smaller 16x16 PNG centered at (24, 24), then trimmed by (2, 4) -> (26, 28).
  assert.equal(added[1].name, '蝴蝶结');
  assert.deepEqual([added[1].x, added[1].y, added[1].width, added[1].height], [26, 28, 12, 8]);
  // Fully transparent image throws cleanly.
  assert.throws(
    () => importImageLayers(next, [{ name: 'empty.png', raster: makeRaster(16, 16, () => null) }]),
    /全部透明/,
  );
});

test('alignRasterToReference auto-scales and locates a half-res partially-occluded layer on a dark master', () => {
  const refW = 240, refH = 320;
  // Build a textured jellyfish-hair silhouette at (60..180, 40..240) on an opaque black background,
  // with a contrasting foreground torso occluding the center (95..145, 95..185) in the master.
  const hairColor = (x, y) => {
    const u = (x - 60) / 120;
    const v = (y - 40) / 200;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    // Tapered dome top + flowing twin tails bottom
    const halfW = v < 0.2 ? Math.sqrt(Math.max(0, 1 - ((0.2 - v) / 0.2) ** 2)) * 0.45 : 0.45 + 0.05 * Math.sin(v * 9);
    const dx = Math.abs(u - 0.5);
    if (dx > halfW) return null;
    if (v > 0.78 && dx < 0.28) return null; // gap between twin tails
    const wave = Math.sin(u * 18 + v * 12) * 35;
    const highlight = Math.exp(-((v - 0.15) ** 2) * 40) * 70;
    return [
      Math.max(0, Math.min(255, Math.round(70 + v * 90 + highlight + wave * 0.4))),
      Math.max(0, Math.min(255, Math.round(180 + (1 - v) * 50 + wave * 0.6))),
      Math.max(0, Math.min(255, Math.round(210 + Math.cos(u * 14) * 35))),
      255,
    ];
  };
  const reference = makeRaster(refW, refH, (x, y) => {
    // Foreground occluder torso in the middle of the hair
    if (x >= 96 && x < 144 && y >= 100 && y < 185) return [215, 165, 150, 255];
    return hairColor(x, y) ?? [0, 0, 0, 255];
  });

  // Imported PNG is a 0.5x square local crop (120x120) containing the complete unoccluded hair (60x100) with transparent padding.
  const imported = makeRaster(120, 120, (ix, iy) => {
    const rx = 60 + (ix - 30) * 2;
    const ry = 40 + (iy - 10) * 2;
    return hairColor(rx, ry);
  });

  const result = alignRasterToReference(imported, reference);
  assert.equal(result.matched, true, `expected match, got confidence=${result.confidence}`);
  assert.ok(result.confidence >= 0.5, `expected confidence >= 0.5, got ${result.confidence}`);
  assert.ok(Math.abs(result.rect.x - 60) <= 4, `x=${result.rect.x} expected ~60`);
  assert.ok(Math.abs(result.rect.y - 40) <= 4, `y=${result.rect.y} expected ~40`);
  assert.ok(Math.abs(result.rect.width - 120) <= 6, `width=${result.rect.width} expected ~120`);
  assert.ok(Math.abs(result.rect.height - 200) <= 8, `height=${result.rect.height} expected ~200`);

  // Unrelated flat cyan square on flat gray reference must not falsely match.
  const flatRef = makeRaster(64, 64, () => [200, 200, 200, 255]);
  const unrelated = makeRaster(16, 16, () => [40, 190, 230, 255]);
  assert.equal(alignRasterToReference(unrelated, flatRef).matched, false);
});

test('applySmudgeStroke expands layer rect past cropped edge with pure premultiplied color and exports updated rect', async () => {
  const ref = makeRaster(64, 64, () => [255, 255, 255, 255]);
  let p = newProject('p-smudge', 'smudge', ref);
  // Arm root stub cropped tightly at rect = [10, 20, 16, 16] (right edge at x = 26)
  const skin = [240, 195, 170, 255];
  const arm = makePoolItem('手臂', 64, 64, { x: 10, y: 20, width: 16, height: 16 }, (x, y) =>
    x >= 10 && x < 26 && y >= 20 && y < 36 ? skin : null,
  );
  p = admitPoolLayers(p, [arm]);
  const layer = p.layers[0];
  assert.deepEqual([layer.x, layer.y, layer.width, layer.height], [10, 20, 16, 16]);

  // Drag smudge brush from inside the cut edge (x=22) outward past original right edge (x=36)
  const extended = applySmudgeStroke(
    layer,
    ref,
    [
      { x: 22, y: 28 },
      { x: 30, y: 28 },
      { x: 36, y: 28 },
    ],
    14,
    0.92,
  );
  assert.ok(extended, 'smudged layer must remain non-empty');
  assert.ok(
    extended.x + extended.width > 30,
    `expected expanded right edge > 30, got ${extended.x + extended.width}`,
  );
  // Check pixel outside original rect (x=30, y=28): must have visible alpha and pure skin color (no dark fringe!)
  const lx = 30 - extended.x;
  const ly = 28 - extended.y;
  const k = (ly * extended.width + lx) * 4;
  assert.ok(extended.pixels[k + 3] > 80, `expected pulled-out pixel alpha > 80, got ${extended.pixels[k + 3]}`);
  assert.ok(
    Math.abs(extended.pixels[k] - skin[0]) <= 3 &&
      Math.abs(extended.pixels[k + 1] - skin[1]) <= 3 &&
      Math.abs(extended.pixels[k + 2] - skin[2]) <= 3,
    `expected pure skin RGB without dark halo, got [${extended.pixels.slice(k, k + 4)}]`,
  );

  // Dragging past master canvas boundary (x=72 > 64) clamps cleanly within [0..64, 0..64]
  const clamped = applySmudgeStroke(
    extended,
    ref,
    [
      { x: 24, y: 28 },
      { x: 72, y: 28 },
    ],
    14,
    0.95,
  );
  assert.ok(clamped);
  assert.ok(clamped.x >= 0 && clamped.y >= 0);
  assert.ok(clamped.x + clamped.width <= 64 && clamped.y + clamped.height <= 64);

  // Exported koma-rig.slices.v2 manifest and PSD use the expanded rect & texture directly
  const p2 = { ...p, layers: [extended] };
  const files = new Map(packageFiles(p2));
  const manifest = JSON.parse(await files.get('manifest.json').text());
  assert.deepEqual(manifest.layers[0].rect, [extended.x, extended.y, extended.width, extended.height]);
  const psdHeader = new TextDecoder('ascii').decode(
    new Uint8Array(await layeredPsd(p2).arrayBuffer()).slice(0, 4),
  );
  assert.equal(psdHeader, '8BPS');
});

test('restoreLayerUnoccludedMaster sharpens blurred visible lineart while protecting occluded AI regions and unseparated occluders', () => {
  const cyan = [150, 225, 230, 255];
  const line = [30, 40, 50, 255];
  const blurredLine = [118, 175, 180, 255];
  const redTorso = [220, 60, 60, 255];
  const pinkRibbon = [245, 70, 150, 255];

  // Master 64x64: cyan hair with crisp 2px dark lineart at x=12..13, red foreground torso at x=24..40,
  // and an unseparated bright pink ribbon at x=48..58 (NOT present in any upper layer!).
  const ref = makeRaster(64, 64, (x, y) => {
    if (x >= 24 && x < 40 && y >= 10 && y < 54) return redTorso;
    if (x >= 48 && x < 58 && y >= 18 && y < 46) return pinkRibbon;
    if (x >= 4 && x < 60 && y >= 8 && y < 56) {
      return x === 12 || x === 13 ? line : cyan;
    }
    return null;
  });

  // Lower layer: blurry upscaled rear hair (blurred lineart at x=12..13, AI-reconstructed cyan behind torso & ribbon)
  let p = newProject('p-sharp', 'sharp', ref);
  const hairPool = makePoolItem('后发', 64, 64, { x: 4, y: 8, width: 56, height: 48 }, (x, y) => {
    if (x < 4 || x >= 60 || y < 8 || y >= 56) return null;
    if (x === 12 || x === 13) return blurredLine;
    return cyan;
  });
  const torsoPool = makePoolItem('躯干', 64, 64, { x: 24, y: 10, width: 16, height: 44 }, (x, y) =>
    x >= 24 && x < 40 && y >= 10 && y < 54 ? redTorso : null,
  );
  p = admitPoolLayers(p, [hairPool, torsoPool]);

  const res = restoreLayerUnoccludedMaster(p.layers, p.layers[0].id, ref);
  assert.ok(res.restoredPixels > 0);
  assert.equal(res.layer.masterRestored, true);

  const pxAt = (layer, mx, my) => {
    const k = ((my - layer.y) * layer.width + (mx - layer.x)) * 4;
    return [...layer.pixels.slice(k, k + 4)];
  };
  // 1. Crisp 2px dark lineart in unoccluded zone (x=12, y=30) is restored to 100% native master sharpness!
  assert.deepEqual(pxAt(res.layer, 12, 30), line);
  // 2. AI-reconstructed cyan hair behind upper red torso (x=32, y=30) is untouched (no red bleed!)
  assert.deepEqual(pxAt(res.layer, 32, 30), cyan);
  // 3. AI-reconstructed cyan hair behind unseparated pink ribbon (x=53, y=30) is untouched by 7x7 color gate!
  assert.deepEqual(pxAt(res.layer, 53, 30), cyan);

  // Batch helper updates visible unlocked layers cleanly
  const batch = restoreAllLayersUnoccludedMaster(p.layers, ref);
  assert.equal(batch.updatedCount, 2);
  assert.deepEqual(pxAt(batch.layers[0], 12, 30), line);
});
