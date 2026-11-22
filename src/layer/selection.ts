// Geodesic distance competition inside the stroke's local neighbourhood.
// Crossing a contrast edge or a deep ink line costs more than following a flat fill.
import type { LayerProject, Raster, Rect } from './project.ts';

export function hasExteriorTransparency({ width, height, data }: Raster) {
  // Check the outer canvas, so a hole enclosed inside an opaque illustration cannot pass as background.
  for (let x = 0; x < width; x++)
    if (data[4 * x + 3] < 16 || data[4 * ((height - 1) * width + x) + 3] < 16) return true;
  for (let y = 1; y < height - 1; y++)
    if (data[4 * y * width + 3] < 16 || data[4 * ((y + 1) * width - 1) + 3] < 16) return true;
  return false;
}

export function snapStroke(
  p: LayerProject,
  stamp: Uint8Array,
  dirty: Rect,
  diameter: number,
  erase: boolean,
) {
  const { width, height, data } = p.reference,
    tile = 384;
  const radius = Math.max(8, Math.min(96, Math.ceil(diameter * 1.2)));
  const x0 = Math.max(0, dirty.x - radius),
    y0 = Math.max(0, dirty.y - radius);
  const x1 = Math.min(width, dirty.x + dirty.width + radius),
    y1 = Math.min(height, dirty.y + dirty.height + radius);
  const area = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const columns = Math.ceil(area.width / tile),
    tiles = new Set<number>();
  let guides: Uint8Array | undefined;
  for (let y = dirty.y; y < dirty.y + dirty.height; y++)
    for (let x = dirty.x; x < dirty.x + dirty.width; x++) {
      const i = y * width + x;
      if (stamp[i] <= 100 || !data[4 * i + 3]) continue;
      if (!guides) guides = p.guides?.slice() ?? new Uint8Array(width * height);
      guides[i] = erase ? 1 : 2;
      const left = Math.floor((Math.max(x0, x - radius) - x0) / tile),
        right = Math.floor((Math.min(x1 - 1, x + radius) - x0) / tile);
      const top = Math.floor((Math.max(y0, y - radius) - y0) / tile),
        bottom = Math.floor((Math.min(y1 - 1, y + radius) - y0) / tile);
      for (let ty = top; ty <= bottom; ty++)
        for (let tx = left; tx <= right; tx++) tiles.add(ty * columns + tx);
    }
  if (!guides) return { area, alpha: p.alpha, guides: p.guides };
  const alpha = p.alpha.slice();
  // A long diagonal brush stroke should not allocate four floating point planes the size of the canvas.
  for (const id of tiles) {
    const x = x0 + (id % columns) * tile,
      y = y0 + Math.floor(id / columns) * tile;
    const endX = Math.min(x + tile, x1),
      endY = Math.min(y + tile, y1),
      halo = 2 * radius + 4;
    const left = Math.max(x0, x - halo),
      top = Math.max(y0, y - halo);
    snapWindow(
      p,
      alpha,
      guides,
      radius,
      erase,
      {
        x: left,
        y: top,
        width: Math.min(x1, endX + halo) - left,
        height: Math.min(y1, endY + halo) - top,
      },
      { x, y, width: endX - x, height: endY - y },
    );
  }
  return { alpha, guides, area };
}

function snapWindow(
  p: LayerProject,
  alpha: Uint8Array,
  guides: Uint8Array,
  radius: number,
  erase: boolean,
  window: Rect,
  core: Rect,
) {
  const { width, data } = p.reference;
  const { x: x0, y: y0, width: w, height: h } = window,
    size = w * h;
  const inside = new Float32Array(size),
    outside = new Float32Array(size);
  const horizontal = new Float32Array(size),
    vertical = new Float32Array(size);
  function edge(k: number, j: number) {
    const delta = Math.max(
      Math.abs(data[k] - data[j]),
      Math.abs(data[k + 1] - data[j + 1]),
      Math.abs(data[k + 2] - data[j + 2]),
      Math.abs(data[k + 3] - data[j + 3]),
    );
    const ink =
      Math.max(data[j], data[j + 1], data[j + 2]) < 80 ||
      Math.max(data[k], data[k + 1], data[k + 2]) < 80;
    return 1 + delta * (ink ? 0.85 : 0.5);
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = y * w + x,
        i = (y0 + y) * width + x0 + x,
        k = i * 4;
      const fg = guides[i] === 2;
      // On an exclusion stroke the previously inferred selection is a weak prior.
      // This lets negative seeds travel across a mistaken flat fill up to its ink edge.
      inside[n] = fg ? 0 : erase && p.alpha[i] ? radius : 1e7;
      const outer = !erase && (!data[k + 3] || (!fg && (!x || !y || x === w - 1 || y === h - 1)));
      outside[n] = guides[i] === 1 || outer ? 0 : radius * 2;
      if (x) horizontal[n] = edge(k, k - 4);
      if (y) vertical[n] = edge(k, k - 4 * width);
    }
  function relax(i: number, j: number, cost: number) {
    inside[i] = Math.min(inside[i], inside[j] + cost);
    outside[i] = Math.min(outside[i], outside[j] + cost);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const n = y * w + x;
        if (x) relax(n, n - 1, horizontal[n]);
        if (y) relax(n, n - w, vertical[n]);
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const n = y * w + x;
        if (x + 1 < w) relax(n, n + 1, horizontal[n + 1]);
        if (y + 1 < h) relax(n, n + w, vertical[n + w]);
      }
  }
  for (let y = core.y - y0; y < core.y + core.height - y0; y++)
    for (let x = core.x - x0; x < core.x + core.width - x0; x++) {
      const n = y * w + x,
        i = (y0 + y) * width + x0 + x,
        cap = data[4 * i + 3];
      const coverage = Math.round(cap * Math.max(0, Math.min(1, 0.5 + (outside[n] - inside[n]) / 4)));
      alpha[i] =
        guides[i] === 1
          ? 0
          : Math.min(cap, erase ? Math.min(alpha[i], coverage) : Math.max(alpha[i], coverage));
    }
}
