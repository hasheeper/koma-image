import type { MediaImageMeta } from '../services/media-response.ts';
import type { Rect } from './project.ts';

type Size = { width: number; height: number };
type Frame = Size & { fromBase?: boolean };
type Entry = { size: Size; meta?: MediaImageMeta };

/** Pixel crops distinguish inclusive and exclusive endpoints even for single-pixel strips. */
function endpoint(start: number, end: number, pixels: number): number {
  return end - start + 1 === pixels ? end + 1 : end;
}

function edges(entry: Entry, nativeBase = false) {
  const box = entry.meta?.box;
  if (!box) return;
  const [x, y, lastX, lastY] = box;
  const right = nativeBase ? lastX : endpoint(x, lastX, entry.size.width);
  const bottom = nativeBase ? lastY : endpoint(y, lastY, entry.size.height);
  if (x >= 0 && y >= 0 && right > x && bottom > y) return { x, y, right, bottom };
}

/** Prefer an actual base image. A complete tiling can also establish a resized return frame. */
export function responseFrame(entries: readonly Entry[], sent: Size): Frame | undefined {
  const base = entries.find(
    (e) =>
      !e.meta?.box &&
      !e.meta?.normalizedBox &&
      (e.meta?.zIndex === 0 || (e.meta?.zIndex === undefined && e.meta?.background === 'opaque')) &&
      Math.abs(e.size.width / e.size.height - sent.width / sent.height) <= 1 / sent.height,
  );
  if (base) return { ...base.size, fromBase: true };
  const boxes = entries.flatMap((e) => {
    const box = edges(e);
    return box ? [box] : [];
  });
  if (boxes.every((b) => b.right <= sent.width && b.bottom <= sent.height)) return sent;
  const width = Math.max(...boxes.map((b) => b.right));
  const height = Math.max(...boxes.map((b) => b.bottom));
  const area = boxes.reduce((sum, b) => sum + (b.right - b.x) * (b.bottom - b.y), 0);
  const overlap = boxes.some((b, i) =>
    boxes.slice(i + 1).some((a) => b.x < a.right && b.right > a.x && b.y < a.bottom && b.bottom > a.y),
  );
  if (!overlap && area === width * height && width * sent.height === height * sent.width)
    return { width, height };
}

export function resolveLayerPlacement(
  size: Size,
  frame: Frame | undefined,
  target: Rect,
  meta?: MediaImageMeta,
): Rect | undefined {
  function map(x: number, y: number, right: number, bottom: number, w: number, h: number) {
    const left = Math.min(target.width - 1, Math.round((x * target.width) / w)),
      top = Math.min(target.height - 1, Math.round((y * target.height) / h));
    return {
      x: target.x + left,
      y: target.y + top,
      width: Math.max(1, Math.round((right * target.width) / w) - left),
      height: Math.max(1, Math.round((bottom * target.height) / h) - top),
    };
  }
  const box = edges({ size, meta }, !!(meta?.seedreamBox && frame?.fromBase));
  const absolute =
    frame && box && box.right <= frame.width && box.bottom <= frame.height
      ? map(box.x, box.y, box.right, box.bottom, frame.width, frame.height)
      : undefined;
  if (absolute && frame?.fromBase) return absolute;
  if (meta?.normalizedBox) {
    const [x, y, r, b] = meta.normalizedBox,
      scale = !meta.seedreamBox && Math.max(x, y, r, b) <= 1 ? 1 : 1000;
    if (x >= 0 && y >= 0 && r > x && b > y && r <= scale && b <= scale) {
      // Rounded normalized metadata can be off by one pixel. Only override exact crop edges
      // when the two descriptions imply different coordinate frames.
      const relative = map(x, y, r, b, scale, scale);
      const tolerance = Math.max(2, Math.ceil(Math.max(target.width, target.height) / 1000) + 1);
      if (
        !absolute ||
        Math.max(
          Math.abs(relative.x - absolute.x),
          Math.abs(relative.y - absolute.y),
          Math.abs(relative.x + relative.width - absolute.x - absolute.width),
          Math.abs(relative.y + relative.height - absolute.y - absolute.height),
        ) > tolerance
      )
        return relative;
    }
  }
  if (absolute) return absolute;
  if (
    !meta?.box &&
    !meta?.normalizedBox &&
    frame &&
    size.width === frame.width &&
    size.height === frame.height
  )
    return { ...target };
}
