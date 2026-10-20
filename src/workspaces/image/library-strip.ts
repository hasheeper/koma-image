const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

// The same image keeps its variation across renders, sorting and reloads.
function variation(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++)
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

export function stripBar(
  id: string,
  size: { width: number; height: number },
  distance: number,
) {
  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1024,
    height = Number.isFinite(size.height) && size.height > 0 ? size.height : 1024,
    away = Number.isFinite(distance) ? Math.abs(distance) : 0;
  // Pixel area has a light influence; aspect ratio supplies the main shape.
  // Both are bounded so panoramas and tiny inputs remain legible.
  const area = clamp(1 + 0.08 * Math.log2((width * height) / 1048576), 0.86, 1.12),
    shape = clamp(0.82 * Math.pow(width / height, 0.38), 0.58, 1.04),
    jitter = 0.9 + 0.2 * variation(id),
    depth = 0.72 + 0.28 / (1 + away * 0.12),
    baseLength = clamp(110 * area * shape * jitter * depth, 24, 96);
  return {
    // Fill more of the rail without flattening the per-image variation.
    length:
      Math.round((baseLength + (96 - baseLength) * 0.35) * 100) / 100,
    opacity: 0.3 + 0.6 / (1 + away * 0.12),
  };
}
