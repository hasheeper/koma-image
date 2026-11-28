export type RGB = [number, number, number];

/** Straight sRGB RGBA pixel buffer. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

export type ScalpelMode = 'paint' | 'missing';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToneMatch {
  gain: RGB;
  offset: RGB;
  strength: number;
  samples: number;
}

/** A formal layer in the PS-like Layer Stack (stored bottom-to-top). */
export interface StackLayer {
  id: string;
  name: string;
  /** Outermost-to-innermost folder group path (e.g. ['头部', '头发']). */
  groups?: string[];
  groupIds?: string[];
  archived?: boolean;
  archiveOrigin?: {
    batchId?: string;
    groups?: string[];
    groupIds?: string[];
    visible: boolean;
    index: number;
  };
  mutedGroups?: string[];
  candidateId?: string;
  batchId?: string;
  candidateZ?: number;
  /** Last known Photopea layer ID for round-trip change tracking. */
  photopeaId?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Straight sRGB RGBA pixels (width * height * 4). */
  pixels: Uint8Array;
  visible: boolean;
  locked: boolean;
  /** Pre-tone-match pixels so tone alignment can be adjusted or reset reversibly. */
  rawPixels?: Uint8Array;
  /** Strength of reference pixels brushed back onto this layer (width * height, 0..255). */
  restoredMask?: Uint8Array;
  toneMatch?: ToneMatch;
  /** Original raw pixel size returned by AI / imported image before placement scaling. */
  rawSize?: { width: number; height: number };
  /** Linear upscale factor applied to the raw source to fit its canvas rect (>1.15 indicates upscaling). */
  rawScale?: number;
  /** True after unoccluded visible surface has been losslessly sharpened from the master reference. */
  masterRestored?: boolean;
}

/** A candidate returned by Seedream layer_decomposition or targeted reroll before admission to the formal stack. */
export interface PoolLayer {
  id: string;
  name: string;
  local?: boolean;
  needsPosition?: boolean;
  /** Pixels at the initial on-canvas size, retained for subsequent manual resizing. */
  fitSource?: Raster;
  providerPlacement?: {
    absolute?: [number, number, number, number];
    normalized?: [number, number, number, number];
    mapped?: Rect;
  };
  /** Full raw provider description (shown as tooltip when longer than the concise name). */
  description?: string;
  /** Tight unstretched layer pixels in native aspect ratio (for thumbnails). */
  preview: Raster;
  /** Full reference-sized raster with exact canvas placement. */
  raster: Raster;
  box: Rect;
  zIndex: number;
  isBase: boolean;
  width: number;
  height: number;
  /** Linear upscale factor applied to raw provider pixels to reach `box` (>1.15 indicates upscaling). */
  rawScale?: number;
  source: 'decompose' | 'reroll';
}

export function layerVisible(layer: StackLayer): boolean {
  return layer.visible && !layer.archived && !layer.mutedGroups?.length;
}

export interface RerollCandidate {
  id: string;
  model: string;
  route: string;
  /** Frozen selected-layer composite used for later manual alignment. */
  sourceReference?: Raster;
  prompt: string;
  /** Untouched model output placed at 1:1 canvas position (default). */
  raster: Raster;
  /** Tight unstretched preview of the untouched model output for the #1/#2/#3 strip. */
  preview: Raster;
  box: Rect;
  /** Optional composite with blue kept region restored from reference inside the AI cutout. */
  overlayRaster?: Raster;
  overlayPreview?: Raster;
  overlayBox?: Rect;
  blob: Blob;
  transparent: boolean;
  resolution: {
    frameWidth: number;
    frameHeight: number;
    inputWidth: number;
    inputHeight: number;
    requested?: string;
    width: number;
    height: number;
    framing: 'full' | 'local';
  };
}

export interface LayerProject {
  format: 'koma-layer.v2';
  id: string;
  title: string;
  revision: number;
  sourceRecordId?: string;
  sourceDigest?: string;
  /** Immutable locked master artwork (reference.png). */
  reference: Raster;
  /** Formal PS-like layer stack ordered bottom-to-top. */
  layers: StackLayer[];
  activeLayerId?: string;
  /** Targeted scalpel guide channels in reference coordinates (blue = visible keep, orange = occluded extend). */
  alpha: Uint8Array;
  occluded?: Uint8Array;
  /** Smart-snap stroke seeds: 0 unknown, 1 exclude, 2 include. */
  guides?: Uint8Array;
  scalpelName: string;
  scalpelInstruction: string;
  scalpelMode?: ScalpelMode;
  missingLayerIds?: string[];
  /** Unset uses the master. An empty selection in layer mode waits for an explicit choice. */
  scalpelLayerIds?: string[];
  scalpelOccluderIds: string[];
  referenceFiles?: { id: string; name: string; width: number; height: number; blob: Blob }[];
  scalpelReferences?: { picture: string; usage: string }[];
  rerollModel?: string;
  rerollConnection?: string;
  decomposeModel?: string;
  decomposeConnection?: string;
  otherSplits?: NonNullable<LayerProject['pendingSplit']>[];
  pendingSplit?: {
    batch: import('./recursive.ts').DecomposeBatch;
    selected: string[];
    archive: boolean;
  };
  todos?: import('./planning.ts').LayerTodo[];
  subForms?: Record<string, { prompt: string; max: number; unlimited: boolean }>;
  generationRounds?: import('./rejections.ts').GenerationRound[];
  lastSplit?: {
    name: string;
    layers: { name: string; width: number; height: number; zIndex: number; isBase: boolean }[];
  };
  decomposePrompt?: string;
  decomposeMax?: number;
  decomposeUnlimited?: boolean;
}

export function newProject(
  id: string,
  title: string,
  reference: Raster,
  sourceRecordId?: string,
): LayerProject {
  const size = reference.width * reference.height;
  return {
    format: 'koma-layer.v2',
    id,
    title,
    revision: 0,
    sourceRecordId,
    reference,
    layers: [],
    alpha: new Uint8Array(size),
    scalpelName: '',
    scalpelInstruction: '',
    scalpelOccluderIds: [],
    decomposeMax: 8,
  };
}

/** Upgrade persisted v1 checkpoints cleanly into v2 without dropping existing confirmed parts. */
export function migrateProject(raw: unknown): LayerProject {
  const p = raw as Record<string, unknown>;
  if (p.format === 'koma-layer.v2') {
    const project = p as unknown as LayerProject;
    const selected = (ids?: string[]) => Array.isArray(ids)
      ? [...new Set(ids.filter(id => Array.isArray(project.layers) && project.layers.some(l => l.id === id && !l.archived)))].sort()
      : undefined;
    return {
      ...project,
      layers: Array.isArray(project.layers)
        ? project.layers.map((l) => ({
            ...l,
            groups: Array.isArray(l.groups)
              ? l.groups.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
              : undefined,
          }))
        : [],
      scalpelName: typeof project.scalpelName === 'string' ? project.scalpelName : '',
      scalpelLayerIds: selected(project.scalpelLayerIds),
      missingLayerIds: selected(project.missingLayerIds),
      scalpelInstruction:
        typeof project.scalpelInstruction === 'string' ? project.scalpelInstruction : '',
      scalpelOccluderIds: Array.isArray(project.scalpelOccluderIds) ? project.scalpelOccluderIds : [],
    };
  }
  const reference = (p.reference ?? p.base) as Raster;
  const base = newProject(
    String(p.id ?? crypto.randomUUID()),
    String(p.title ?? '未命名定稿'),
    reference,
    typeof p.sourceRecordId === 'string' ? p.sourceRecordId : undefined,
  );
  const oldParts = Array.isArray(p.parts)
    ? (p.parts as Array<{
        id: string;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        pixels: Float32Array | Uint8Array;
      }>)
    : [];
  const layers: StackLayer[] = oldParts.map((part) => ({
    id: part.id || crypto.randomUUID(),
    name: part.name || '图层',
    x: part.x,
    y: part.y,
    width: part.width,
    height: part.height,
    pixels: Uint8Array.from(part.pixels, (v) => Math.max(0, Math.min(255, Math.round(v)))),
    visible: true,
    locked: false,
  }));
  return {
    ...base,
    revision: typeof p.revision === 'number' ? p.revision : 0,
    layers,
    activeLayerId: layers.at(-1)?.id,
    alpha:
      p.alpha instanceof Uint8Array && p.alpha.length === reference.width * reference.height
        ? p.alpha
        : base.alpha,
    occluded:
      p.occluded instanceof Uint8Array && p.occluded.length === reference.width * reference.height
        ? p.occluded
        : undefined,
    guides:
      p.guides instanceof Uint8Array && p.guides.length === reference.width * reference.height
        ? p.guides
        : undefined,
    scalpelName: typeof p.name === 'string' ? p.name : '',
    scalpelInstruction: typeof p.instruction === 'string' ? p.instruction : '',
    rerollModel: typeof p.repairModel === 'string' ? p.repairModel : undefined,
  };
}

export function bounds(channel: Uint8Array, width: number): Rect | undefined {
  let left = width,
    right = -1,
    top = channel.length / width,
    bottom = -1;
  for (let i = 0; i < channel.length; i++) {
    if (!channel[i]) continue;
    const x = i % width,
      y = Math.floor(i / width);
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (right >= 0) return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function alphaBounds(image: Raster): Rect | undefined {
  const { width, height, data } = image;
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right >= 0) return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function crop(source: Raster, rect: Rect): Raster {
  const { x, y, width, height } = rect,
    data = new Uint8Array(width * height * 4);
  const left = Math.max(0, x),
    right = Math.min(source.width, x + width);
  for (let row = Math.max(0, y); right > left && row < Math.min(source.height, y + height); row++) {
    const start = (row * source.width + left) * 4;
    data.set(
      source.data.subarray(start, start + (right - left) * 4),
      ((row - y) * width + left - x) * 4,
    );
  }
  return { width, height, data };
}
