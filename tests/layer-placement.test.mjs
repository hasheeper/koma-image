import test from 'node:test';
import assert from 'node:assert/strict';
import { responseFrame, resolveLayerPlacement } from '../src/layer/placement.ts';

const parent = { x: 412, y: 227, width: 180, height: 160 };
const frame = { width: 180, height: 160 };
const eyes = [
  { size: { width: 31, height: 34 }, meta: { box: [12, 7, 42, 40] } },
  { size: { width: 59, height: 64 }, meta: { box: [65, 24, 124, 88] } },
];
for (const base of [true, false])
  test('eye pixels, inclusive + half-open boxes ' + (base ? 'with base' : 'crops only'), () => {
    const entries = base ? [...eyes, { size: frame, meta: { zIndex: 0 } }] : eyes;
    const source = responseFrame(entries, frame);
    assert.deepEqual(resolveLayerPlacement(eyes[0].size, source, parent, eyes[0].meta), {
      x: 424,
      y: 234,
      width: 31,
      height: 34,
    });
    assert.deepEqual(resolveLayerPlacement(eyes[1].size, source, parent, eyes[1].meta), {
      x: 477,
      y: 251,
      width: 59,
      height: 64,
    });
  });
test('cropped-only resized sleeve halves recover the response coordinate frame', () => {
  const target = { x: 52, y: 24, width: 32, height: 24 },
    size = { width: 32, height: 48 };
  const entries = [
    { size, meta: { box: [0, 0, 31, 47] } },
    { size, meta: { box: [32, 0, 63, 47] } },
  ];
  const frame = responseFrame(entries, target);
  assert.deepEqual(resolveLayerPlacement(size, frame, target, entries[1].meta), {
    x: 68,
    y: 24,
    width: 16,
    height: 24,
  });
  assert.equal(responseFrame(entries.slice(1), target), undefined);
  assert.equal(resolveLayerPlacement(size, undefined, target, entries[1].meta), undefined);
});
test('normalized edges identify a smaller unknown return frame even when absolute edges fit the sent frame', () => {
  const target = { x: 120, y: 80, width: 200, height: 200 };
  assert.deepEqual(
    resolveLayerPlacement({ width: 20, height: 20 }, target, target, {
      box: [20, 30, 39, 49],
      normalizedBox: [200, 300, 400, 500],
    }),
    { x: 160, y: 140, width: 40, height: 40 },
  );
});
test('single pixel at right edge is never expanded or shifted', () => {
  assert.deepEqual(
    resolveLayerPlacement({ width: 1, height: 1 }, frame, parent, { box: [179, 159, 179, 159] }),
    { x: 591, y: 386, width: 1, height: 1 },
  );
});

test('native micro-detail uses the verified base and half-open absolute box even for a padded PNG', () => {
  const target = { x: 400, y: 200, width: 1600, height: 1600 };
  const base = { size: { width: 1600, height: 1600 }, meta: { zIndex: 0 } };
  const detail = { size: { width: 1024, height: 1024 },
    meta: { seedreamBox: true, box: [750, 257, 802, 311], normalizedBox: [400, 210, 480, 245] } };
  const frame = responseFrame([detail, base], target);
  assert.deepEqual(resolveLayerPlacement(detail.size, frame, target, detail.meta),
    { x: 1150, y: 457, width: 52, height: 54 });
  assert.deepEqual(resolveLayerPlacement({ width: 53, height: 55 }, frame, target, detail.meta),
    { x: 1150, y: 457, width: 52, height: 54 });
  assert.deepEqual(resolveLayerPlacement(detail.size, undefined, target,
    { seedreamBox: true, normalizedBox: [0, 0, 1, 1] }), { x: 400, y: 200, width: 2, height: 2 });
});
