import type { PositionedNode } from './continuation.ts';
import { NODE_META_ROOM, NODE_FOOTER_ROOM } from './node-chrome.ts';

/** Place one new sibling. Existing nodes and the user's blank frame never move. */
export function placeStagedSibling(nodes: readonly PositionedNode[], parentId: string,
  size: Pick<PositionedNode, 'width' | 'height' | 'imageHeight'>, blank?: { x: number; y: number; width: number; height: number }) {
  const parent = nodes.find(n => n.node.id === parentId);
  if (!parent) return null;
  const cellWidth = 336, cellHeight = NODE_META_ROOM + 320 + NODE_FOOTER_ROOM, gap = 64;
  const obstacles = blank ? [...nodes, blank] : nodes;
  for (let slot = 0; slot < (nodes.length + 2) * 4; slot++) {
    const left = parent.x + parent.width + 128 + Math.floor(slot / 2) * (cellWidth + gap);
    const top = parent.y + slot % 2 * (cellHeight + gap);
    if (obstacles.some(n => left < n.x + n.width + 24 && left + cellWidth + 24 > n.x && top < n.y + n.height + 24 && top + cellHeight + 24 > n.y)) continue;
    return { x: left + (cellWidth - size.width) / 2, y: top + (320 - size.imageHeight) / 2 };
  }
  return null;
}
