import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPrints } from '../src/home/layout.ts';
const sizes = [2.4, .684, 1, 1.8, .75, 1.4, .55, 2, .8, 1.3, .67].map(ratio => ({ width: ratio * 1000, height: 1000 }));
const epsilon = .001;
for (const width of [288, 358, 736, 1080]) for (const mode of ['rows', 'cols', 'mosaic']) {
  test(`HOME ${mode} at ${width}: complete, uncropped, bounded and no overlap`, () => {
    const { tiles, height } = layoutPrints(sizes, width, mode, width < 800);
    assert.deepEqual(tiles.map(t => t.index).sort((a,b)=>a-b), sizes.map((_,i)=>i));
    for (const t of tiles) {
      assert.ok(t.w > 0 && t.h > 0 && t.x >= -epsilon && t.y >= -epsilon);
      assert.ok(t.x + t.w <= width + epsilon && t.y + t.h <= height + epsilon);
      assert.ok(Math.abs(t.w / t.h - sizes[t.index].width / sizes[t.index].height) < epsilon);
      for (const b of tiles) if (t !== b) assert.ok(t.x + t.w <= b.x + epsilon || b.x + b.w <= t.x + epsilon || t.y + t.h <= b.y + epsilon || b.y + b.h <= t.y + epsilon);
    }
    if (mode === 'cols') {
      assert.equal(new Set(tiles.map(t => t.w)).size, 1);
      assert.equal(new Set(tiles.map(t => t.x)).size, width === 1080 ? 4 : width < 400 ? 2 : 4);
    }
    if (mode === 'mosaic') {
      // A horizontal slice may cross stack gaps, but never an unfilled column:
      // all bands reach both edges, and every interior gap is exactly the gutter.
      const gap = width < 800 ? 8 : 16;
      for (let y = .1; y < height; y += 2.17) {
        const slice = tiles.filter(t => t.y <= y && t.y + t.h >= y).sort((a,b)=>a.x-b.x);
        if (!slice.length) continue; // Inter-band gutter.
        const missing = [{ x: 0, w: 0 }, ...slice, { x: width, w: 0 }].slice(1).map((t,i) => t.x - (i ? slice[i-1].x + slice[i-1].w : 0));
        for (const empty of missing) if (empty > gap + epsilon) {
          // Such a gap must be a vertical gutter between two stacked pictures.
          assert.ok(tiles.some(t => Math.abs(t.y + t.h - y) < gap || Math.abs(t.y - y) < gap));
        }
      }
    }
  });
}
test('rows leave the incomplete last row at target height; wide prints keep proportional area', () => {
  const one = layoutPrints([{width:1000,height:1000}],1080,'rows'); assert.equal(one.tiles[0].h,220); assert.equal(one.tiles[0].w,220);
  const wall = layoutPrints([{width:2400,height:1000},{width:684,height:1000},{width:684,height:1000}],1080,'mosaic');
  const [wide,portrait] = wall.tiles; assert.ok(wide.w*wide.h > portrait.w*portrait.h);
  assert.deepEqual(layoutPrints([], 1080, 'cols'), {tiles:[],height:0});
});
