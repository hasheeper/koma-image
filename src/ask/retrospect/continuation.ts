import type { RetrospectEdge } from './model.ts';
import { NODE_META_ROOM, NODE_FOOTER_ROOM } from './node-chrome.ts';

export interface PositionedNode {
  node: { id: string }; x: number; y: number; width: number; height: number;
  imageWidth: number; imageHeight: number;
}
/** All version and placeholder edges use the same default curve, including during dragging. */
function connectionPath(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(64, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
export function graphEdges(nodes: readonly PositionedNode[], edges: readonly RetrospectEdge[]) {
  const positions = new Map(nodes.map(n => [n.node.id, n]));
  return edges.flatMap(edge => {
    const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return [];
    const x1 = from.x + (from.width + from.imageWidth) / 2, y1 = from.y + NODE_META_ROOM + from.imageHeight / 2;
    const x2 = to.x + (to.width - to.imageWidth) / 2, y2 = to.y + NODE_META_ROOM + to.imageHeight / 2;
    return [{ ...edge, x: (x1 + x2) / 2, y: (y1 + y2) / 2, path: connectionPath(x1, y1, x2, y2) }];
  });
}
/** A view-only placeholder, excluded from actual history, topology and notes. */
export function placeContinuation(nodes: readonly PositionedNode[], edges: readonly RetrospectEdge[], nodeId: string,
  image: { width: number; height: number }, columnGap: number, rowGap: number, anchor?: { x: number; cy: number }) {
  const base = nodes.find(n => n.node.id === nodeId); if (!base) return null;
  const width = Math.max(168, image.width), height = NODE_META_ROOM + image.height + NODE_FOOTER_ROOM;
  const x = anchor ? anchor.x - (width - image.width) / 2 : base.x + base.width + columnGap;
  const descendants = new Set<string>();
  const visit = (id: string) => edges.filter(e => e.from === id).forEach(e => {
    if (!descendants.has(e.to)) { descendants.add(e.to); visit(e.to); }
  });
  visit(nodeId);
  const branch = nodes.filter(n => descendants.has(n.node.id));
  let y = anchor ? anchor.cy - NODE_META_ROOM - image.height / 2 : branch.length ? Math.max(...branch.map(n => n.y + n.height)) + rowGap
    : base.y + (base.imageHeight - image.height) / 2;
  // Keep all existing branches stationary when the creation base changes.
  let hit: PositionedNode | undefined;
  while (!anchor && (hit = nodes.find(n => x < n.x + n.width && x + width > n.x && y < n.y + n.height + rowGap && y + height + rowGap > n.y)))
    y = hit.y + hit.height + rowGap;
  const left = x + (width - image.width) / 2, top = y + NODE_META_ROOM;
  const x1 = base.x + (base.width + base.imageWidth) / 2, y1 = base.y + NODE_META_ROOM + base.imageHeight / 2;
  const y2 = top + image.height / 2;
  return { x, y, width, height, left, top, imageWidth: image.width, imageHeight: image.height,
    path: connectionPath(x1, y1, left, y2) };
}
