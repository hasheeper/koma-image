import { summarizeMask } from "../domain/mask-summary.ts";
import { maskBitmapPixels } from "./edit-input.ts";
import type { MaskBitmap } from "./edit-input.ts";
export interface MaskPoint { x: number; y: number }
export interface MaskStroke {
  points: [MaskPoint, ...MaskPoint[]];
  diameter: number;
  erase: boolean;
  pointer: number;
  clear?: false;
}
export type MaskEntry = MaskStroke | { clear: true } | { bitmap: MaskBitmap; baseId?: number };
export interface MaskState {
  width: number;
  height: number;
  base?: MaskBitmap;
  strokes: MaskEntry[];
  position: number;
  anchor?: number;
}

export const emptyMask = (width: number, height: number): MaskState => ({ width, height, strokes: [], position: 0 });
/** Packed bitmaps are immutable; copying each one on every brush movement would duplicate large images. */
export function copyMaskState(state: MaskState): MaskState {
  return { ...state, strokes: state.strokes.map(item => "bitmap" in item ? { ...item } : structuredClone(item)) };
}
export function withMaskBitmap(state: MaskState, bitmap: MaskBitmap, baseId?: number): MaskState {
  if (state.width !== bitmap.width || state.height !== bitmap.height) throw new Error("蒙版尺寸必须与底图一致");
  const next = copyMaskState(state);
  next.strokes = next.strokes.slice(0, next.position);
  next.strokes.push({ bitmap, ...(baseId === undefined ? {} : {baseId}) });
  // Each bitmap replaces all previous coverage. Retain the newest independent baselines
  // within 16 MiB; dropping an old baseline also releases its preceding undo entries.
  let bytes = (next.base?.bits.byteLength ?? 0) + next.strokes.reduce((sum, e) => sum + ("bitmap" in e ? e.bitmap.bits.byteLength : 0), 0);
  while (bytes > 16 * 1024 * 1024) {
    const start = next.strokes.findIndex(e => "bitmap" in e), entry = next.strokes[start];
    if (!entry || !("bitmap" in entry)) break;
    bytes -= next.base?.bits.byteLength ?? 0;
    next.base = entry.bitmap;
    next.anchor = entry.baseId ?? next.anchor;
    next.strokes = next.strokes.slice(start + 1);
  }
  next.position = next.strokes.length;
  return next;
}

/** Source-pixel coordinates keep touch/mouse masks aligned at every display size. */
export function createMaskEditor(canvas: HTMLCanvasElement, onChange: () => void) {
  const mask = document.createElement("canvas"),
    context = mask.getContext("2d", { willReadFrequently: true });
  const previewContext = canvas.getContext("2d");
  if (!context || !previewContext) throw new Error("当前浏览器不支持 Canvas 蒙版");
  const ctx = context, preview = previewContext;
  // Paint in the accent token so the mask follows the theme rather than a copy of it.
  const accent = () =>
    getComputedStyle(canvas).getPropertyValue("--a").trim() || "#b3a1ff";
  let tint = accent();
  let strokes: MaskEntry[] = [], stroke: MaskStroke | null = null, baseline: MaskBitmap | undefined;
  let position = 0, diameter = 64,
    erase = false,
    locked = false;
  let anchor: number | undefined;
  let encoded: string | null | undefined;
  function paint(item: MaskEntry, from = 0) {
    if ("bitmap" in item) {
      ctx.putImageData(maskBitmapPixels(item.bitmap), 0, 0);
      return;
    }
    if (item.clear) {
      ctx.clearRect(0, 0, mask.width, mask.height);
      return;
    }
    ctx.globalCompositeOperation = item.erase
      ? "destination-out"
      : "source-over";
    ctx.fillStyle = ctx.strokeStyle = "white";
    ctx.lineWidth = item.diameter;
    ctx.lineCap = ctx.lineJoin = "round";
    const points = item.points;
    if (from === 0) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, item.diameter / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = Math.max(1, from); i < points.length; i++) {
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  function display() {
    encoded = undefined;
    show();
  }
  function show() {
    preview.clearRect(0, 0, canvas.width, canvas.height);
    preview.drawImage(mask, 0, 0);
    preview.globalCompositeOperation = "source-in";
    preview.fillStyle = tint;
    preview.fillRect(0, 0, canvas.width, canvas.height);
    preview.globalCompositeOperation = "source-over";
  }
  function replay() {
    ctx.clearRect(0, 0, mask.width, mask.height);
    let start = position - 1;
    while (start >= 0) {
      const entry = strokes[start];
      if ("bitmap" in entry || entry.clear) break;
      start--;
    }
    if (start < 0 && baseline) paint({ bitmap: baseline });
    for (const item of strokes.slice(Math.max(0, start), position)) paint(item);
    display();
    onChange();
  }
  function point(event: PointerEvent): MaskPoint {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          mask.width,
          ((event.clientX - rect.left) * mask.width) / rect.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          mask.height,
          ((event.clientY - rect.top) * mask.height) / rect.height,
        ),
      ),
    };
  }
  const down = (event: PointerEvent) => {
    if (locked || stroke || event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    stroke = {
      points: [point(event)],
      diameter,
      erase,
      pointer: event.pointerId,
    };
    paint(stroke);
    display();
    onChange();
  };
  const move = (event: PointerEvent) => {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    stroke.points.push(point(event));
    paint(stroke, stroke.points.length - 1);
    display();
  };
  function finish(event: PointerEvent) {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    strokes = strokes.slice(0, position);
    strokes.push(stroke);
    position++;
    stroke = null;
    onChange();
  }
  let events: AbortController | null | undefined;
  function pause() {
    events?.abort();
    events = null;
    if (stroke) {
      stroke = null;
      replay();
    }
  }
  function resume() {
    if (events) return;
    events = new AbortController();
    for (const [name, handler] of [
      ["pointerdown", down],
      ["pointermove", move],
      ["pointerup", finish],
      ["pointercancel", finish],
      ["lostpointercapture", finish],
    ] as const)
      canvas.addEventListener(name, handler, { signal: events.signal });
  }
  return {
    pause,
    resume,
    // The owner calls this after a theme switch; the mask itself is unchanged.
    retint() { tint = accent(); show(); },
    dispose() { pause(); strokes = []; baseline = undefined; canvas.width = canvas.height = mask.width = mask.height = 1; encoded = undefined; },
    snapshot(): MaskState {
      return copyMaskState({
        width: mask.width,
        height: mask.height,
        base: baseline,
        strokes,
        position,
        ...(anchor === undefined ? {} : {anchor}),
      });
    },
    restore(state: MaskState) {
      stroke = null;
      canvas.width = mask.width = state.width;
      canvas.height = mask.height = state.height;
      strokes = copyMaskState(state).strokes;
      baseline = state.base;
      position = state.position;
      anchor = state.anchor;
      replay();
    },
    resize(width: number, height: number) {
      canvas.width = mask.width = width;
      canvas.height = mask.height = height;
      strokes = [];
      baseline = undefined;
      position = 0;
      anchor = undefined;
      stroke = null;
      display();
      onChange();
    },
    setBrush(size: number, eraser: boolean) {
      diameter = size;
      erase = eraser;
      canvas.dataset.eraser = String(eraser);
    },
    setLocked(value: boolean) {
      locked = value;
    },
    undo() {
      if (!locked && !stroke && position) {
        position--;
        replay();
      }
    },
    redo() {
      if (!locked && !stroke && position < strokes.length) {
        position++;
        replay();
      }
    },
    clear() {
      if (!locked && !stroke) {
        strokes = strokes.slice(0, position);
        strokes.push({ clear: true });
        position++;
        replay();
      }
    },
    // A second finger turns the gesture into a pan or pinch; drop the stroke it started.
    cancel() {
      if (stroke) {
        const id = stroke.pointer;
        stroke = null;
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        replay();
      }
    },
    canUndo: () => position > 0,
    canRedo: () => position < strokes.length,
    isDrawing: () => stroke !== null,
    geometry() { return summarizeMask(ctx.getImageData(0,0,mask.width,mask.height).data,mask.width,mask.height); },
    hasCoverage() {
      if (!mask.width || !mask.height) return false;
      const pixels = ctx.getImageData(0, 0, mask.width, mask.height).data;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 32) return true;
      return false;
    },
    getMask(alpha = false): string | null {
      if (stroke) throw new Error("请完成当前蒙版笔画");
      if (!alpha && encoded !== undefined) return encoded;
      const data = ctx.getImageData(0, 0, mask.width, mask.height);
      let painted = false;
      for (let i = 0; i < data.data.length; i += 4) {
        const white = data.data[i + 3] > 32;
        painted ||= white;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = white ? 255 : 0;
        data.data[i + 3] = alpha && !white ? 0 : 255;
      }
      if (!painted) return (encoded = null);
      const output = document.createElement("canvas");
      output.width = mask.width;
      output.height = mask.height;
      const outputContext = output.getContext("2d");
      if (!outputContext) throw new Error("当前浏览器不支持 Canvas 蒙版");
      outputContext.putImageData(data, 0, 0);
      const result = output.toDataURL("image/png");
      if (!alpha) encoded = result;
      return result;
    },
  };
}
export type MaskEditor = ReturnType<typeof createMaskEditor>;
