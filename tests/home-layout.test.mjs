import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPrints } from '../src/shared/gallery/layout.ts';
const sizes = [2.4, .684, 1, 1.8, .75, 1.4, .55, 2, .8, 1.3, .67].map(ratio => ({ width: ratio * 1000, height: 1000 }));
const epsilon = .001;
for (const mode of ['rows', 'cols', 'mosaic']) {
  test(`HOME ${mode}: every image stays proportional, bounded and non-overlapping`, () => {
    const width = 736;
    const { tiles, height } = layoutPrints(sizes, width, mode);
    assert.deepEqual(tiles.map(t => t.index).sort((a,b)=>a-b), sizes.map((_,i)=>i));
    for (const t of tiles) {
      assert.ok(t.w > 0 && t.h > 0 && t.x >= -epsilon && t.y >= -epsilon);
      assert.ok(t.x + t.w <= width + epsilon && t.y + t.h <= height + epsilon);
      assert.ok(Math.abs(t.w / t.h - sizes[t.index].width / sizes[t.index].height) < epsilon);
      for (const b of tiles) if (t !== b) assert.ok(t.x + t.w <= b.x + epsilon || b.x + b.w <= t.x + epsilon || t.y + t.h <= b.y + epsilon || b.y + b.h <= t.y + epsilon);
    }
    assert.deepEqual(layoutPrints([], width, mode), {tiles:[],height:0});
  });
}
