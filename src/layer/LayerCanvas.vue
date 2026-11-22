<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';
import type { GuideChannel } from './mask-history.ts';
import type { LayerProject, Raster, Rect, StackLayer } from './project.ts';
import { layerVisible } from './project.ts';
import {
  brushCoverage,
  createSmudgeState,
  seedSmudgeState,
  smudgeSegment,
  type SmudgeState,
} from './stack.ts';

export type StackTool = 'move' | 'transform' | 'erase' | 'restore' | 'smudge' | 'rect' | 'lasso';
export type CanvasTool = StackTool | GuideChannel;

const props = defineProps<{
  project: LayerProject;
  mode: 'stack' | 'scalpel';
  tool: CanvasTool;
  activeLayerId?: string;
  soloLayerIds?: readonly string[];
  compareReference: boolean;
  previewRaster?: Raster;
  previewLayers?: readonly (Raster & {x?:number;y?:number})[];
  regionPick?: boolean;
  commitMove: boolean;
  transformRect?: Rect;
  transformLockAspect?: boolean;
  transformGhostRef?: boolean;
  transformOpacity?: number;
  mat: string;
  diameter: number;
  hardness: number;
  smudgeStrength?: number;
  erasingGuide: boolean;
  smartSnap: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  brush: [mode: 'erase' | 'restore', points: { x: number; y: number }[]];
  smudge: [points: { x: number; y: number }[]];
  offset: [layerId: string, dx: number, dy: number];
  selectLayer: [layerId: string];
  transformChange: [rect: Rect];
  selectionRect: [rect: Rect | undefined];
  selectionLasso: [polygon: { x: number; y: number }[] | undefined];
  guideStroke: [
    channel: GuideChannel,
    channelData: Uint8Array,
    action: 'draw' | 'erase',
    area: Rect,
    stamp: Uint8Array | undefined,
    diameter: number,
  ];
}>();

const canvas = shallowRef<HTMLCanvasElement>();
const cursor = shallowRef<HTMLElement>();
const reference = computed(() => props.project.reference);
const emptyGuide = computed(() => new Uint8Array(reference.value.width * reference.value.height));

const bitmapCache = new WeakMap<Uint8Array, OffscreenCanvas>();
function getBitmap(width: number, height: number, data: Uint8Array): OffscreenCanvas {
  let cached = bitmapCache.get(data);
  if (!cached || cached.width !== width || cached.height !== height) {
    cached = new OffscreenCanvas(width, height);
    cached.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    bitmapCache.set(data, cached);
  }
  return cached;
}

const isBrushTool = computed(
  () =>
    !props.compareReference &&
    !props.previewRaster &&
    props.previewLayers === undefined &&
    (props.tool === 'erase' ||
      props.tool === 'restore' ||
      props.tool === 'smudge' ||
      props.tool === 'alpha' ||
      props.tool === 'occluded'),
);

function cursorAt(event?: PointerEvent) {
  const ring = cursor.value;
  if (!ring || !canvas.value) return;
  if (!event || !isBrushTool.value || event.pointerType === 'touch') {
    ring.hidden = true;
    return;
  }
  const box = canvas.value.getBoundingClientRect();
  if (!box.width || !box.height) return;
  ring.hidden = false;
  ring.style.left = ((event.clientX - box.left) / box.width) * 100 + '%';
  ring.style.top = ((event.clientY - box.top) / box.height) * 100 + '%';
}

let overlay: OffscreenCanvas | undefined;
let tint: ImageData | undefined;
let paintedAlpha: Uint8Array | undefined;
let paintedOccluded: Uint8Array | undefined;

type TransformHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

let dragMove: { layerId: string; dx: number; dy: number } | undefined;
let dragTransform:
  | {
      handle: TransformHandle;
      startRect: Rect;
      currentRect: Rect;
    }
  | undefined;
let liveEdit:
  | {
      layerId: string;
      mode: 'erase' | 'restore' | 'smudge';
      canvas: OffscreenCanvas;
      points: { x: number; y: number }[];
      smudge?: { state: SmudgeState; imageData: ImageData; strength: number };
    }
  | undefined;
let pendingRect: Rect | undefined;
let pendingLasso: { x: number; y: number }[] | undefined;

let pointerState:
  | {
      pointer: number;
      tool: CanvasTool;
      x: number;
      y: number;
      startX: number;
      startY: number;
      // guide brush state
      channel?: Uint8Array;
      origin?: Uint8Array;
      stamp?: Uint8Array;
      dirty?: Rect;
      erasing?: boolean;
      diameter: number;
      hardness: number;
    }
  | undefined;

function activeGuideChannel(tool: GuideChannel): Uint8Array {
  return tool === 'occluded' ? props.project.occluded ?? emptyGuide.value : props.project.alpha;
}

function updateGuideTint(i: number, tool: GuideChannel, value: number) {
  if (!tint) return;
  const k = i * 4;
  const blue = ((tool === 'alpha' ? value : props.project.alpha[i]) * 0.58) / 255;
  const covered = (tool === 'occluded' ? value : props.project.occluded?.[i] ?? 0) / 255;
  const orange = covered * 0.66;
  const below = blue * (1 - covered);
  const alpha = orange + below;
  tint.data[k] = alpha ? (255 * orange + 30 * below) / alpha : 0;
  tint.data[k + 1] = alpha ? (154 * orange + 145 * below) / alpha : 0;
  tint.data[k + 2] = alpha ? (38 * orange + 255 * below) / alpha : 0;
  tint.data[k + 3] = Math.round(255 * alpha);
}

function ensureGuideOverlay(force = false) {
  const { width, height } = reference.value;
  if (
    !force &&
    overlay &&
    overlay.width === width &&
    overlay.height === height &&
    paintedAlpha === props.project.alpha &&
    paintedOccluded === props.project.occluded
  ) {
    return;
  }
  overlay = new OffscreenCanvas(width, height);
  tint = new ImageData(width, height);
  const alpha = props.project.alpha;
  const occluded = props.project.occluded;
  for (let i = 0; i < alpha.length; i++) {
    const k = i * 4;
    const blue = (alpha[i] * 0.58) / 255;
    const covered = (occluded?.[i] ?? 0) / 255;
    const orange = covered * 0.66;
    const below = blue * (1 - covered);
    const a = orange + below;
    tint.data[k] = a ? (255 * orange + 30 * below) / a : 0;
    tint.data[k + 1] = a ? (154 * orange + 145 * below) / a : 0;
    tint.data[k + 2] = a ? (38 * orange + 255 * below) / a : 0;
    tint.data[k + 3] = Math.round(255 * a);
  }
  overlay.getContext('2d')!.putImageData(tint, 0, 0);
  paintedAlpha = alpha;
  paintedOccluded = occluded;
}

function cssScale() {
  const el = canvas.value;
  if (!el) return 1;
  const box = el.getBoundingClientRect();
  return reference.value.width / Math.max(1, box.width);
}

function transformHandlePoints(r: Rect): Record<Exclude<TransformHandle, 'move'>, { x: number; y: number }> {
  const mx = r.x + r.width / 2;
  const my = r.y + r.height / 2;
  return {
    nw: { x: r.x, y: r.y },
    n: { x: mx, y: r.y },
    ne: { x: r.x + r.width, y: r.y },
    e: { x: r.x + r.width, y: my },
    se: { x: r.x + r.width, y: r.y + r.height },
    s: { x: mx, y: r.y + r.height },
    sw: { x: r.x, y: r.y + r.height },
    w: { x: r.x, y: my },
  };
}

function hitTestTransform(x: number, y: number, r: Rect): TransformHandle | undefined {
  const hitR = Math.max(6, 14 * cssScale());
  const handles = transformHandlePoints(r);
  for (const key of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as const) {
    const pt = handles[key];
    if (Math.abs(x - pt.x) <= hitR && Math.abs(y - pt.y) <= hitR) return key;
  }
  if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return 'move';
  return undefined;
}

const HANDLE_CURSORS: Record<TransformHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move',
};

function computeTransformedRect(
  start: Rect,
  handle: TransformHandle,
  dx: number,
  dy: number,
  lockAspect: boolean,
): Rect {
  if (handle === 'move') {
    return {
      x: Math.round(start.x + dx),
      y: Math.round(start.y + dy),
      width: start.width,
      height: start.height,
    };
  }
  const minSize = 4;
  const aspect = start.width / Math.max(1, start.height);
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  let rawW = start.width + (hasE ? dx : hasW ? -dx : 0);
  let rawH = start.height + (hasS ? dy : hasN ? -dy : 0);
  rawW = Math.max(minSize, rawW);
  rawH = Math.max(minSize, rawH);

  let width = Math.round(rawW);
  let height = Math.round(rawH);

  if (lockAspect) {
    if ((hasW || hasE) && (hasN || hasS)) {
      const scaleW = rawW / Math.max(1, start.width);
      const scaleH = rawH / Math.max(1, start.height);
      const scale = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
      width = Math.max(minSize, Math.round(start.width * scale));
      height = Math.max(minSize, Math.round(width / aspect));
    } else if (hasW || hasE) {
      width = Math.max(minSize, Math.round(rawW));
      height = Math.max(minSize, Math.round(width / aspect));
    } else {
      height = Math.max(minSize, Math.round(rawH));
      width = Math.max(minSize, Math.round(height * aspect));
    }
  }

  let x = start.x;
  let y = start.y;
  if (hasW) x = right - width;
  else if (!hasE && lockAspect) x = Math.round(start.x + (start.width - width) / 2);
  if (hasN) y = bottom - height;
  else if (!hasS && lockAspect) y = Math.round(start.y + (start.height - height) / 2);

  return { x, y, width, height };
}

function drawTransformOverlay(ctx: CanvasRenderingContext2D, r: Rect) {
  const s = cssScale();
  const lw = Math.max(1, 1.5 * s);
  const hs = Math.max(4, 8 * s);
  ctx.save();
  // Soft white halo + crisp purple accent frame
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#8b5cf6';
  ctx.strokeRect(r.x, r.y, r.width, r.height);

  // Subtle center crosshair
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const arm = Math.max(3, 5 * s);
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy);
  ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm);
  ctx.lineTo(cx, cy + arm);
  ctx.stroke();

  // 8 corner & edge handles
  const handles = transformHandlePoints(r);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  for (const pt of Object.values(handles)) {
    ctx.fillRect(pt.x - hs / 2, pt.y - hs / 2, hs, hs);
    ctx.strokeRect(pt.x - hs / 2, pt.y - hs / 2, hs, hs);
  }
  ctx.restore();
}

function drawSelectionOverlay(ctx: CanvasRenderingContext2D) {
  const scale = Math.max(1, Math.round(reference.value.width / 512));
  if (pendingRect && pendingRect.width >= 2 && pendingRect.height >= 2) {
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.fillRect(pendingRect.x, pendingRect.y, pendingRect.width, pendingRect.height);
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.strokeRect(pendingRect.x, pendingRect.y, pendingRect.width, pendingRect.height);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineDashOffset = 5 * scale;
    ctx.strokeRect(pendingRect.x, pendingRect.y, pendingRect.width, pendingRect.height);
    ctx.restore();
  }
  if (pendingLasso && pendingLasso.length >= 2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pendingLasso[0].x, pendingLasso[0].y);
    for (let i = 1; i < pendingLasso.length; i++) ctx.lineTo(pendingLasso[i].x, pendingLasso[i].y);
    if (!pointerState) ctx.closePath();
    ctx.fillStyle = 'rgba(168, 85, 247, 0.14)';
    if (!pointerState) ctx.fill();
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.stroke();
    ctx.strokeStyle = '#a855f7';
    ctx.lineDashOffset = 5 * scale;
    ctx.stroke();
    ctx.restore();
  }
}

function redraw() {
  const el = canvas.value;
  if (!el) return;
  const { width, height } = reference.value;
  if (el.width !== width || el.height !== height) {
    el.width = width;
    el.height = height;
  }
  const ctx = el.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  if (props.compareReference) {
    ctx.drawImage(getBitmap(width, height, reference.value.data), 0, 0);
    return;
  }

  if (props.previewRaster) {
    ctx.drawImage(getBitmap(props.previewRaster.width, props.previewRaster.height, props.previewRaster.data), 0, 0);
    return;
  }

  if (props.previewLayers !== undefined) {
    for (const layer of props.previewLayers) {
      ctx.drawImage(getBitmap(layer.width, layer.height, layer.data), layer.x ?? 0, layer.y ?? 0);
    }
    return;
  }

  if (props.mode === 'scalpel') {
    ctx.drawImage(getBitmap(width, height, reference.value.data), 0, 0);
    ensureGuideOverlay();
    if (overlay) ctx.drawImage(overlay, 0, 0);
    return;
  }

  // Formal Layer Stack live composite (falls back to master artwork when stack is empty).
  if (props.regionPick || !props.project.layers.length) {
    ctx.drawImage(getBitmap(width, height, reference.value.data), 0, 0);
    drawSelectionOverlay(ctx);
    return;
  }

  const liveTransform =
    props.tool === 'transform' ? (dragTransform?.currentRect ?? props.transformRect) : undefined;
  if (liveTransform && props.transformGhostRef) {
    ctx.drawImage(getBitmap(width, height, reference.value.data), 0, 0);
  }

  const soloSet = props.soloLayerIds?.length ? new Set(props.soloLayerIds) : undefined;
  for (const layer of props.project.layers) {
    if (layer.archived || (soloSet ? !soloSet.has(layer.id) : !layerVisible(layer))) continue;
    if (liveTransform && layer.id === props.activeLayerId) {
      ctx.save();
      ctx.imageSmoothingQuality = 'high';
      if (props.transformGhostRef && props.transformOpacity !== undefined && props.transformOpacity < 1) {
        ctx.globalAlpha = props.transformOpacity;
      }
      ctx.drawImage(
        getBitmap(layer.width, layer.height, layer.pixels),
        liveTransform.x,
        liveTransform.y,
        liveTransform.width,
        liveTransform.height,
      );
      ctx.restore();
      continue;
    }
    const dx = dragMove?.layerId === layer.id ? dragMove.dx : 0;
    const dy = dragMove?.layerId === layer.id ? dragMove.dy : 0;
    if (liveEdit && liveEdit.layerId === layer.id) {
      ctx.drawImage(liveEdit.canvas, dx, dy);
    } else {
      ctx.drawImage(getBitmap(layer.width, layer.height, layer.pixels), layer.x + dx, layer.y + dy);
    }
  }

  if (liveTransform) drawTransformOverlay(ctx, liveTransform);
  drawSelectionOverlay(ctx);
}

watch(
  [
    () => props.project,
    () => props.mode,
    () => props.tool,
    () => props.activeLayerId,
    () => props.soloLayerIds,
    () => props.compareReference,
    () => props.previewRaster,
    () => props.previewLayers,
    () => props.regionPick,
    () => props.transformRect,
    () => props.transformGhostRef,
    () => props.transformOpacity,
  ],
  () => {
    if (props.mode === 'scalpel') ensureGuideOverlay();
    if (props.tool !== 'rect' && pendingRect) {
      pendingRect = undefined;
      emit('selectionRect', undefined);
    }
    if (props.tool !== 'lasso' && pendingLasso) {
      pendingLasso = undefined;
      emit('selectionLasso', undefined);
    }
    if (props.tool !== 'transform' && canvas.value) {
      canvas.value.style.cursor = '';
    }
    cursorAt();
    redraw();
  },
  { flush: 'post' },
);
onMounted(redraw);

function canvasPoint(e: PointerEvent) {
  const box = canvas.value!.getBoundingClientRect();
  return {
    x: ((e.clientX - box.left) * reference.value.width) / Math.max(1, box.width),
    y: ((e.clientY - box.top) * reference.value.height) / Math.max(1, box.height),
  };
}

function hitTestLayer(x: number, y: number): StackLayer | undefined {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const isHit = (layer: StackLayer) => {
    const lx = ix - layer.x;
    const ly = iy - layer.y;
    if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) return false;
    return layer.pixels[(ly * layer.width + lx) * 4 + 3] > 0;
  };
  if (props.soloLayerIds?.length) {
    const soloSet = new Set(props.soloLayerIds);
    const current = props.project.layers.find((l) => l.id === props.activeLayerId && soloSet.has(l.id));
    if (current && isHit(current)) return current;
    for (let i = props.project.layers.length - 1; i >= 0; i--) {
      const layer = props.project.layers[i];
      if (soloSet.has(layer.id) && isHit(layer)) return layer;
    }
    return undefined;
  }
  const current = props.project.layers.find((l) => l.id === props.activeLayerId && layerVisible(l));
  if (current && isHit(current)) return current;
  for (let i = props.project.layers.length - 1; i >= 0; i--) {
    const layer = props.project.layers[i];
    if (layerVisible(layer) && isHit(layer)) return layer;
  }
  return undefined;
}

function createLiveBrushCanvas(layer: StackLayer): OffscreenCanvas {
  const { width, height } = reference.value;
  const off = new OffscreenCanvas(width, height);
  off.getContext('2d')!.drawImage(getBitmap(layer.width, layer.height, layer.pixels), layer.x, layer.y);
  return off;
}

function stampLiveBrush(x0: number, y0: number, x1: number, y1: number) {
  if (!liveEdit || !pointerState) return;
  const ctx = liveEdit.canvas.getContext('2d')!;
  const r = Math.max(0.5, pointerState.diameter / 2);
  const hardness = pointerState.hardness;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1, r * 0.25);
  const steps = Math.max(1, Math.ceil(dist / step));

  if (liveEdit.mode === 'erase') {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      const grad = ctx.createRadialGradient(cx, cy, r * hardness, cx, cy, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else {
    const { width, height, data } = reference.value;
    const refBmp = getBitmap(width, height, data);
    const pad = Math.ceil(r + 2);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
    const maxX = Math.min(width, Math.ceil(Math.max(x0, x1) + pad));
    const maxY = Math.min(height, Math.ceil(Math.max(y0, y1) + pad));
    const rw = maxX - minX;
    const rh = maxY - minY;
    if (rw <= 0 || rh <= 0) return;
    const stamp = new OffscreenCanvas(rw, rh);
    const sctx = stamp.getContext('2d')!;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t - minX;
      const cy = y0 + (y1 - y0) * t - minY;
      const grad = sctx.createRadialGradient(cx, cy, r * hardness, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = grad;
      sctx.beginPath();
      sctx.arc(cx, cy, r, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.globalCompositeOperation = 'source-in';
    sctx.drawImage(refBmp, minX, minY, rw, rh, 0, 0, rw, rh);
    ctx.drawImage(stamp, minX, minY);
  }
}

function paintGuide(x: number, y: number) {
  if (!pointerState?.channel || (pointerState.tool !== 'alpha' && pointerState.tool !== 'occluded')) return;
  const tool = pointerState.tool;
  const channel = pointerState.channel;
  const r = Math.max(0.5, pointerState.diameter / 2);
  const { width, height } = reference.value;
  if (pointerState.diameter === 1) {
    x = Math.floor(x) + 0.5;
    y = Math.floor(y) + 0.5;
    pointerState.x = Math.floor(pointerState.x) + 0.5;
    pointerState.y = Math.floor(pointerState.y) + 0.5;
  }
  const dx = x - pointerState.x;
  const dy = y - pointerState.y;
  const length = dx * dx + dy * dy;
  const left = Math.max(0, Math.floor(Math.min(x, pointerState.x) - r));
  const right = Math.min(width, Math.ceil(Math.max(x, pointerState.x) + r));
  const top = Math.max(0, Math.floor(Math.min(y, pointerState.y) - r));
  const bottom = Math.min(height, Math.ceil(Math.max(y, pointerState.y) + r));
  if (right <= left || bottom <= top) return;

  const d = pointerState.dirty;
  const x0 = Math.min(left, d?.x ?? left);
  const y0 = Math.min(top, d?.y ?? top);
  pointerState.dirty = {
    x: x0,
    y: y0,
    width: Math.max(right, d ? d.x + d.width : right) - x0,
    height: Math.max(bottom, d ? d.y + d.height : bottom) - y0,
  };

  const target = pointerState.erasing ? 0 : 255;
  for (let sy = top; sy < bottom; sy++) {
    for (let sx = left; sx < right; sx++) {
      const px = sx + 0.5 - pointerState.x;
      const py = sy + 0.5 - pointerState.y;
      const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0;
      const distance = Math.hypot(px - t * dx, py - t * dy);
      if (distance > r) continue;
      const i = sy * width + sx;
      if (pointerState.stamp) {
        pointerState.stamp[i] = Math.max(pointerState.stamp[i], Math.round(255 * Math.min(1, r - distance + 0.5)));
      }
      if (tool === 'occluded' && pointerState.origin) {
        const weight = brushCoverage(distance, r, 0.8);
        const nextVal = Math.round(pointerState.origin[i] + (target - pointerState.origin[i]) * weight);
        channel[i] = pointerState.erasing ? Math.min(channel[i], nextVal) : Math.max(channel[i], nextVal);
      } else {
        channel[i] = Math.round(channel[i] + (target - channel[i]) * Math.min(1, r - distance + 0.5));
      }
      if (props.smartSnap && tool === 'alpha') {
        channel[i] = Math.min(channel[i], reference.value.data[4 * i + 3]);
      }
      updateGuideTint(i, tool, channel[i]);
    }
  }
  if (overlay && tint) {
    overlay.getContext('2d')!.putImageData(tint, 0, 0, left, top, right - left, bottom - top);
  }
  pointerState.x = x;
  pointerState.y = y;
  redraw();
}

function down(e: PointerEvent) {
  if (
    props.compareReference ||
    props.previewRaster ||
    props.previewLayers !== undefined ||
    props.busy ||
    e.button !== 0 ||
    pointerState
  )
    return;
  const pt = canvasPoint(e);
  const tool = props.tool;

  if (props.mode === 'stack') {
    if (!props.project.layers.length && !props.regionPick) return;
    if (tool === 'move') {
      const hit = hitTestLayer(pt.x, pt.y);
      if (!hit) return;
      if (hit.id !== props.activeLayerId) emit('selectLayer', hit.id);
      dragMove = { layerId: hit.id, dx: 0, dy: 0 };
    } else if (tool === 'transform') {
      const rect = props.transformRect;
      if (!rect) return;
      const handle = hitTestTransform(pt.x, pt.y, rect);
      if (!handle) return;
      dragTransform = {
        handle,
        startRect: { ...rect },
        currentRect: { ...rect },
      };
    } else if (tool === 'erase' || tool === 'restore' || tool === 'smudge') {
      const singleSolo = props.soloLayerIds?.length === 1 ? props.soloLayerIds[0] : undefined;
      const layer = props.project.layers.find((l) => l.id === (singleSolo || props.activeLayerId));
      if (!layer || layer.locked || layer.archived) return;
      const off = createLiveBrushCanvas(layer);
      if (tool === 'smudge') {
        const ctx = off.getContext('2d')!;
        const imageData = ctx.getImageData(0, 0, off.width, off.height);
        const state = createSmudgeState(props.diameter);
        seedSmudgeState(state, imageData.data, off.width, off.height, 0, 0, pt.x, pt.y);
        liveEdit = {
          layerId: layer.id,
          mode: 'smudge',
          canvas: off,
          points: [pt],
          smudge: { state, imageData, strength: props.smudgeStrength ?? 0.85 },
        };
      } else {
        liveEdit = {
          layerId: layer.id,
          mode: tool,
          canvas: off,
          points: [pt],
        };
      }
    } else if (tool === 'rect') {
      pendingLasso = undefined;
      emit('selectionLasso', undefined);
      pendingRect = { x: Math.round(pt.x), y: Math.round(pt.y), width: 0, height: 0 };
    } else if (tool === 'lasso') {
      pendingRect = undefined;
      emit('selectionRect', undefined);
      pendingLasso = [pt];
    } else {
      return;
    }
  } else {
    if (tool !== 'alpha' && tool !== 'occluded') return;
    ensureGuideOverlay();
  }

  canvas.value!.focus({ preventScroll: true });
  canvas.value!.setPointerCapture(e.pointerId);
  cursorAt(e);

  pointerState = {
    pointer: e.pointerId,
    tool,
    x: pt.x,
    y: pt.y,
    startX: pt.x,
    startY: pt.y,
    diameter: props.diameter,
    hardness: props.hardness,
    erasing: props.erasingGuide,
    origin: tool === 'occluded' ? activeGuideChannel(tool) : undefined,
    channel: tool === 'alpha' || tool === 'occluded' ? activeGuideChannel(tool).slice() : undefined,
    stamp:
      tool === 'alpha' && props.smartSnap ? new Uint8Array(reference.value.width * reference.value.height) : undefined,
  };

  if (liveEdit && liveEdit.mode !== 'smudge') {
    stampLiveBrush(pt.x, pt.y, pt.x, pt.y);
    redraw();
  } else if (tool === 'alpha' || tool === 'occluded') {
    paintGuide(pt.x, pt.y);
  }
}

function move(e: PointerEvent) {
  cursorAt(e);
  const pt = canvasPoint(e);
  if (!pointerState) {
    if (props.mode === 'stack' && props.tool === 'transform' && props.transformRect && canvas.value) {
      const handle = hitTestTransform(pt.x, pt.y, props.transformRect);
      canvas.value.style.cursor = handle ? HANDLE_CURSORS[handle] : 'default';
    }
    return;
  }
  if (pointerState.pointer !== e.pointerId) return;

  if (pointerState.tool === 'move' && dragMove) {
    dragMove.dx = Math.round(pt.x - pointerState.startX);
    dragMove.dy = Math.round(pt.y - pointerState.startY);
    redraw();
  } else if (pointerState.tool === 'transform' && dragTransform) {
    const lock = (props.transformLockAspect ?? true) !== e.shiftKey;
    dragTransform.currentRect = computeTransformedRect(
      dragTransform.startRect,
      dragTransform.handle,
      pt.x - pointerState.startX,
      pt.y - pointerState.startY,
      lock,
    );
    emit('transformChange', { ...dragTransform.currentRect });
    redraw();
  } else if ((pointerState.tool === 'erase' || pointerState.tool === 'restore') && liveEdit) {
    stampLiveBrush(pointerState.x, pointerState.y, pt.x, pt.y);
    liveEdit.points.push(pt);
    pointerState.x = pt.x;
    pointerState.y = pt.y;
    redraw();
  } else if (pointerState.tool === 'smudge' && liveEdit?.smudge) {
    liveEdit.points.push(pt);
    const { state, imageData, strength } = liveEdit.smudge;
    const dirty = smudgeSegment(
      imageData.data,
      liveEdit.canvas.width,
      liveEdit.canvas.height,
      0,
      0,
      state,
      pt.x,
      pt.y,
      strength,
    );
    pointerState.x = pt.x;
    pointerState.y = pt.y;
    if (dirty) {
      liveEdit.canvas
        .getContext('2d')!
        .putImageData(imageData, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
      redraw();
    }
  } else if (pointerState.tool === 'rect') {
    const x0 = Math.round(Math.min(pointerState.startX, pt.x));
    const y0 = Math.round(Math.min(pointerState.startY, pt.y));
    const x1 = Math.round(Math.max(pointerState.startX, pt.x));
    const y1 = Math.round(Math.max(pointerState.startY, pt.y));
    pendingRect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    redraw();
  } else if (pointerState.tool === 'lasso' && pendingLasso) {
    const prev = pendingLasso[pendingLasso.length - 1];
    if (Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 2) {
      pendingLasso.push(pt);
      redraw();
    }
  } else if (pointerState.tool === 'alpha' || pointerState.tool === 'occluded') {
    paintGuide(pt.x, pt.y);
  }
}

function end(e: PointerEvent, cancelled = false) {
  if (pointerState?.pointer !== e.pointerId) return;
  const state = pointerState;
  const moved = dragMove;
  const transformed = dragTransform;
  const edit = liveEdit;
  pointerState = undefined;
  dragMove = undefined;
  dragTransform = undefined;
  liveEdit = undefined;

  if (cancelled) {
    if (state.tool === 'transform' && transformed) {
      emit('transformChange', { ...transformed.startRect });
    } else if (state.tool === 'rect') {
      pendingRect = undefined;
      emit('selectionRect', undefined);
    } else if (state.tool === 'lasso') {
      pendingLasso = undefined;
      emit('selectionLasso', undefined);
    } else if (state.tool === 'alpha' || state.tool === 'occluded') {
      ensureGuideOverlay(true);
    }
    redraw();
    return;
  }

  if (state.tool === 'move' && moved) {
    if (props.commitMove && (moved.dx || moved.dy)) {
      emit('offset', moved.layerId, moved.dx, moved.dy);
    }
    redraw();
  } else if (state.tool === 'transform' && transformed) {
    emit('transformChange', { ...transformed.currentRect });
    redraw();
  } else if ((state.tool === 'erase' || state.tool === 'restore') && edit && edit.mode !== 'smudge') {
    emit('brush', edit.mode, edit.points);
    redraw();
  } else if (state.tool === 'smudge' && edit) {
    if (edit.points.length >= 2) emit('smudge', edit.points);
    redraw();
  } else if (state.tool === 'rect') {
    if (pendingRect && pendingRect.width >= 3 && pendingRect.height >= 3) {
      emit('selectionRect', { ...pendingRect });
    } else {
      pendingRect = undefined;
      emit('selectionRect', undefined);
    }
    redraw();
  } else if (state.tool === 'lasso') {
    if (pendingLasso && pendingLasso.length >= 3) {
      emit('selectionLasso', pendingLasso.slice());
    } else {
      pendingLasso = undefined;
      emit('selectionLasso', undefined);
    }
    redraw();
  } else if ((state.tool === 'alpha' || state.tool === 'occluded') && state.channel && state.dirty) {
    const pt = canvasPoint(e);
    if (pt.x !== state.x || pt.y !== state.y) {
      pointerState = state;
      paintGuide(pt.x, pt.y);
      pointerState = undefined;
    }
    emit(
      'guideStroke',
      state.tool,
      state.channel,
      state.erasing ? 'erase' : 'draw',
      state.dirty,
      state.stamp,
      state.diameter,
    );
    if (state.stamp) {
      ensureGuideOverlay(true);
      redraw();
    }
  }
}

function clearSelection() {
  pendingRect = undefined;
  pendingLasso = undefined;
  redraw();
}

function cancelStroke() {
  if (!pointerState && !dragMove && !dragTransform && !liveEdit) return;
  pointerState = undefined;
  dragMove = undefined;
  dragTransform = undefined;
  liveEdit = undefined;
  ensureGuideOverlay(true);
  redraw();
}

defineExpose({ clearSelection, cancelStroke });
</script>

<template>
  <canvas
    ref="canvas"
    class="layer-surface"
    :data-mat="mat"
    :data-tool="compareReference || previewRaster || previewLayers !== undefined ? 'reference' : tool"
    tabindex="0"
    aria-label="Koma Layer 分件画布"
    @pointerenter="cursorAt"
    @pointerleave="cursorAt()"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="end($event)"
    @pointercancel="end($event, true)"
    @lostpointercapture="end($event, true)"
  />
  <span
    ref="cursor"
    hidden
    aria-hidden="true"
    class="layer-brush-cursor"
    :class="{ erasing: tool === 'erase' || ((tool === 'alpha' || tool === 'occluded') && erasingGuide) }"
    :style="{
      '--core': (tool === 'erase' || tool === 'restore' ? hardness : tool === 'smudge' ? 0.35 : 1) * 100 + '%',
      width: (diameter / reference.width) * 100 + '%',
      height: (diameter / reference.height) * 100 + '%',
    }"
  ></span>
</template>

<style scoped>
canvas.layer-surface {
  opacity: 1;
  background: var(--image-checker);
}
canvas.layer-surface[data-mat='black'] {
  background: #000;
}
canvas.layer-surface[data-mat='white'] {
  background: #fff;
}
canvas.layer-surface[data-tool='move'] {
  cursor: grab;
}
canvas.layer-surface[data-tool='move']:active {
  cursor: grabbing;
}
canvas.layer-surface:is([data-tool='rect'], [data-tool='lasso']) {
  cursor: crosshair;
}
@media (hover: hover) {
  canvas.layer-surface:is(
    [data-tool='erase'],
    [data-tool='restore'],
    [data-tool='smudge'],
    [data-tool='alpha'],
    [data-tool='occluded']
  ) {
    cursor: none;
  }
}
.layer-brush-cursor {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  border: 1px solid white;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 75%);
}
.layer-brush-cursor::after {
  content: '';
  position: absolute;
  inset: 50% auto auto 50%;
  width: var(--core);
  height: var(--core);
  transform: translate(-50%, -50%);
  border-radius: 50%;
  outline: 1px solid rgb(255 255 255 / 55%);
}
.layer-brush-cursor.erasing {
  border-style: dashed;
}
</style>
