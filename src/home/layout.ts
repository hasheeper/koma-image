import type { FinalLayout } from './model.ts';
export interface PrintSize { width: number; height: number }
export interface PrintRect { index: number; x: number; y: number; w: number; h: number }
export interface PrintLayout { tiles: PrintRect[]; height: number }
type Item = { index: number; ratio: number };

function rows(items: Item[], width: number, target: number, gap: number): PrintLayout {
  const bands: { items: Item[]; h: number }[] = [];
  const height = (row: Item[]) => (width - gap * (row.length - 1)) / row.reduce((n, p) => n + p.ratio, 0);
  let row: Item[] = [];
  for (const item of items) {
    const next = [...row, item], h = height(next);
    if (row.length && h < target && Math.abs(height(row) - target) < Math.abs(h - target)) {
      bands.push({ items: row, h: height(row) }); row = [];
    }
    row.push(item);
    if (height(row) <= target) { bands.push({ items: row, h: height(row) }); row = []; }
  }
  // The final incomplete row never stretches to fill the remaining width.
  if (row.length) bands.push({ items: row, h: Math.min(target, height(row)) });
  let y = 0;
  const tiles = bands.flatMap(band => {
    let x = 0;
    const result = band.items.map(item => {
      const w = item.ratio * band.h, tile = { index: item.index, x, y, w, h: band.h };
      x += w + gap; return tile;
    });
    y += band.h + gap; return result;
  });
  return { tiles, height: Math.max(0, y - gap) };
}
function columns(items: Item[], width: number, target: number, gap: number): PrintLayout {
  const count = Math.max(2, Math.round((width + gap) / (target + gap)));
  const w = (width - gap * (count - 1)) / count, bottoms = Array<number>(count).fill(0);
  const tiles = items.map(item => {
    const column = bottoms.indexOf(Math.min(...bottoms)), h = w / item.ratio;
    const tile = { index: item.index, x: column * (w + gap), y: bottoms[column]!, w, h };
    bottoms[column]! += h + gap; return tile;
  });
  return { tiles, height: Math.max(0, ...bottoms) - (items.length ? gap : 0) };
}
function mosaic(items: Item[], width: number, target: number, gap: number): PrintLayout {
  const compact = width < 700, limit = compact ? 4 : 8, minEdge = compact ? 108 : 128;
  const unit = compact ? width * .42 : Math.min(230, width * .19);
  const wantedArea = (item: Item) => unit ** 2 * (1 + 1.2 * Math.abs(Math.log(item.ratio)));
  function solve(cells: Item[][]) {
    const effective = cells.map(cell => 1 / cell.reduce((sum, item) => sum + 1 / item.ratio, 0));
    const sum = effective.reduce((a, b) => a + b, 0);
    const stackGap = effective.reduce((n, ratio, i) => n + ratio * (cells[i]!.length - 1) * gap, 0);
    const h = (width - (cells.length - 1) * gap + stackGap) / sum;
    const tiles: PrintRect[] = []; let x = 0, score = .55;
    cells.forEach((cell, i) => {
      const w = (h - gap * (cell.length - 1)) * effective[i]!; let y = 0;
      for (const item of cell) {
        const th = w / item.ratio;
        if (w <= 0 || th <= 0) return;
        tiles.push({ index: item.index, x, y, w, h: th }); y += th + gap;
        const relative = w * th / wantedArea(item);
        score += 3 * Math.max(0, minEdge / Math.min(w, th) - 1) ** 2
          + 1.8 * (Math.log(relative) ** 2 + Math.max(0, relative - 1.8) ** 2);
      }
      x += w + gap;
    });
    score += tiles.length * .35 * Math.log(h / target) ** 2;
    if (tiles.length !== cells.flat().length) score = Infinity;
    return { h, tiles, score };
  }
  type Band = ReturnType<typeof solve>;
  const best: { score: number; count: number; band: Band | null }[] = Array(items.length + 1);
  best[items.length] = { score: 0, count: 0, band: null };
  // Bounded bands and back-pointers keep storage linear in the number of prints.
  for (let start = items.length - 1; start >= 0; start--) {
    best[start] = { score: Infinity, count: 0, band: null };
    for (let count = 1; count <= Math.min(limit, items.length - start); count++) {
      const group = items.slice(start, start + count), pairs: [number, number][] = [];
      const consider = (chosen: [number, number][]) => {
        const cells = group.flatMap((item, i) => {
          if (chosen.some(p => p[1] === i)) return [];
          const pair = chosen.find(p => p[0] === i);
          return [pair ? [item, group[pair[1]]!] : [item]];
        });
        const band = solve(cells), score = band.score + best[start + count]!.score;
        if (score < best[start]!.score) best[start] = { score, count, band };
      };
      consider([]);
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++)
        if (group[i]!.ratio >= .6 && group[j]!.ratio >= .6) pairs.push([i, j]);
      pairs.forEach((pair, i) => {
        consider([pair]);
        if (!compact) for (const other of pairs.slice(i + 1))
          if (other.every(n => !pair.includes(n))) consider([pair, other]);
      });
    }
  }
  let start = 0, y = 0; const tiles: PrintRect[] = [];
  while (start < items.length) {
    const next = best[start]!; if (!next.band) break;
    tiles.push(...next.band.tiles.map(tile => ({ ...tile, y: y + tile.y })));
    y += next.band.h + gap; start += next.count;
  }
  return { tiles: tiles.sort((a, b) => a.index - b.index), height: Math.max(0, y - gap) };
}
/** Pure geometry: no DOM, image decoding, cropping, or selection changes. */
export function layoutPrints(sizes: readonly PrintSize[], width: number, mode: FinalLayout, narrow = width <= 700): PrintLayout {
  if (!(width > 0) || !Number.isFinite(width) || !sizes.length) return { tiles: [], height: 0 };
  const items = sizes.map((p, index) => ({ index, ratio: p.width > 0 && p.height > 0 && Number.isFinite(p.width / p.height) ? p.width / p.height : 1 }));
  const gap = narrow ? 8 : 16;
  return mode === 'rows' ? rows(items, width, narrow ? 140 : 220, gap)
    : mode === 'cols' ? columns(items, width, narrow ? 160 : 230, gap)
      : mosaic(items, width, narrow ? 240 : 310, gap);
}
