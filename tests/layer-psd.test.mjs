import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeCanvas, writePsd } from 'ag-psd';
import { decodeLayerPsd } from '../src/layer/psd-import.ts';

initializeCanvas(() => { throw new Error('Unexpected canvas'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
const imageData = (...rgba) => ({ width: 1, height: 1, data: Uint8ClampedArray.from(rgba) });

test('external PSD uses its merged image as master and retains a same-named locked bottom layer', () => {
  const file = writePsd({
    width: 1, height: 1, imageData: imageData(11, 22, 33, 128),
    imageResources: { versionInfo: { hasRealMergedData: true, writerName: 'Fixture', readerName: '', fileVersion: 1 } },
    children: [{ name: '锁定原图', id: 1, hidden: true, protected: { all: true }, transparencyProtected: true,
      imageData: imageData(7, 8, 9, 255) }],
  });
  // Even without creator resources this foreign PSD's full-canvas locked layer remains in the stack.
  const resourcesLength = new DataView(file).getUint32(30);
  const noResources = Buffer.concat([new Uint8Array(file, 0, 30), new Uint8Array(4), new Uint8Array(file, 34 + resourcesLength)]);
  for (const bytes of [file, Uint8Array.from(noResources).buffer]) {
    const { reference, layers } = decodeLayerPsd(bytes);
    assert.equal(reference.data[3], 128);
    assert.deepEqual(layers.map(l => [l.name, l.locked, l.visible, ...l.pixels]), [['锁定原图', true, false, 7, 8, 9, 255]]);
  }
});

test('layered PSD without a compatibility composite builds the master in document stacking order', () => {
  const bytes = writePsd({ width: 1, height: 1, children: [
    { name: '底', imageData: imageData(10, 20, 30, 255) },
    { name: '顶', imageData: imageData(90, 80, 70, 255) },
  ] });
  let offset = 26;
  for (let i = 0; i < 3; i++) offset += 4 + new DataView(bytes).getUint32(offset);
  const { reference, layers } = decodeLayerPsd(bytes.slice(0, offset));
  assert.deepEqual(layers.map(l => l.name), ['底', '顶']);
  assert.deepEqual([...reference.data], [90, 80, 70, 255]);
});

test('flat RGB PSD opens as a master, with actionable errors for damaged files, PSB and unsupported depths', () => {
  // Raw RGB 1 × 1, with empty color, resources and layer sections.
  const bytes = Uint8Array.from([56,66,80,83, 0,1, 0,0,0,0,0,0, 0,3, 0,0,0,1, 0,0,0,1, 0,8, 0,3,
    0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0, 21,42,63]);
  const flat = decodeLayerPsd(bytes.buffer);
  assert.deepEqual([...flat.reference.data], [21, 42, 63, 255]);
  assert.deepEqual(flat.layers, []);
  assert.throws(() => decodeLayerPsd(bytes.buffer.slice(0, 8)), /有效的 PSD/);
  bytes[5] = 2;
  assert.throws(() => decodeLayerPsd(bytes.buffer), /PSB/);
  bytes[5] = 1; bytes[23] = 16;
  assert.throws(() => decodeLayerPsd(bytes.buffer), /8 位/);
  bytes[23] = 8; bytes[35] = 1;
  assert.throws(() => decodeLayerPsd(bytes.buffer), /不完整/);
});
