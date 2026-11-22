<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { usePhotopea } from '../app/photopea.ts';
import { useServices } from '../app/services.ts';
import { useUi } from '../app/ui.ts';
import { directoryPicker } from '../bridge/fs-driver.ts';
import type { CatalogModel } from '../domain/catalog.ts';
import type { PhotopeaLayerResult } from '../services/photopea.ts';
import AppIcon from '../shared/AppIcon.vue';
import PhotopeaIcon from '../shared/PhotopeaIcon.vue';
import PopoverMenu from '../shared/ui/PopoverMenu.vue';
import { download } from '../shared/files.ts';
import { createArchive } from '../storage/backup-archive.ts';
import { alignRasterToReference } from './align.ts';
import {
  decodeLayerBlob,
  decomposeCapable,
  preferredDecomposeModel,
  requestLayerDecompose,
  routeLabel,
  type DecomposeBatch,
  type DecomposeSize,
} from './decompose.ts';
import { packageFiles, writePackage } from './export.ts';
import { placeOnCanvas, png, readRaster } from './images.ts';
import LayerCanvas, { type CanvasTool, type StackTool } from './LayerCanvas.vue';
import LayerThumbnail from './LayerThumbnail.vue';
import ScalpelReferences from './ScalpelReferences.vue';
import { filePictureId, layerPictureId, referencePictures, referenceSources, scalpelInputs, type ReferenceSource } from './scalpel-references.ts';
import CandidateFit from './CandidateFit.vue';
import { clippedCandidate, fitCandidate, localPixels } from './candidate-fit.ts';
import { recordGuide, travelGuide, type GuideChannel, type GuideHistory } from './mask-history.ts';
import {
  alphaBounds,
  crop,
  newProject,
  layerVisible,
  type LayerProject,
  type PoolLayer,
  type Raster,
  type Rect,
  type RerollCandidate,
  type StackLayer,
} from './project.ts';
import { layeredPsd } from './psd.ts';
import { hasExteriorTransparency, snapStroke } from './selection.ts';
import {
  admitPoolLayers,
  applyBrushStroke,
  applyLayerToneMatch,
  applyPhotopeaReturn,
  applySmudgeStroke,
  deleteGroup,
  deleteLayer,
  duplicateLayer,
  groupKey,
  importImageLayers,
  layerInGroup,
  mergeDownLayer,
  offsetLayer,
  renameGroup,
  renameLayer,
  reorderLayer,
  restoreAllLayersUnoccludedMaster,
  restoreLayerUnoccludedMaster,
  splitLayerByLasso,
  splitLayerByRect,
  toggleGroupVisible,
  toggleLayerLock,
  toggleLayerVisible,
  transformLayer,
  ungroupLayers,
} from './stack.ts';
import {
  applyLayerEdits,
  attachLayer,
  layerContext,
  rejectionPictures,
  macroPrompt,
  partPrompt,
  type LayerTodo,
} from './planning.ts';
import type { Picture } from '../ask/library.ts';
import { admitSplit, candidateOrder, insertSplitCandidates, moveCandidate, splitSource } from './recursive.ts';
import { addGeneration, changeRejections, type RejectionChange } from './rejections.ts';
import { layerStorage, type LayerSummary } from './storage.ts';
import {
  preferredRerollModel,
  requestTargetedReroll,
  rerollCapable,
  type ScalpelFraming,
} from './targeted-reroll.ts';

const props = defineProps<{
  stage: HTMLElement | null;
  dock: HTMLElement | null;
  compact: boolean;
  models: CatalogModel[];
  activeModel?: string;
  backgroundAvailable: boolean;
  source?: { blob: Blob; name: string; kind: string; recordId?: string };
  sourceKey?: string;
}>();

const emit = defineEmits<{
  size: [{ width: number; height: number }];
  close: [];
  panel: [];
  locateForm: [];
  todos: [projectId: string];
  reviewRejections: [];
  askScalpel: [];
  background: [source: Blob];
}>();

const services = useServices();
const photopea = usePhotopea();
const ui = useUi();
const store = layerStorage(services);
const picker = directoryPicker();

const project = shallowRef<LayerProject>();
const saved = ref<LayerSummary[]>([]);
const busy = ref(false);
const activeRequest = ref<'decompose' | 'reroll' | null>(null);
const saving = ref(false);
const progress = ref('');
const note = ref('');
const error = ref('');
const saveError = ref('');

// Workspace modes & tools
const mode = ref<'stack' | 'scalpel'>('stack');
const stackTool = ref<StackTool>('move');
const guideTool = ref<GuideChannel>('alpha');
const activeTool = computed<CanvasTool>(() =>
  mode.value === 'stack' ? stackTool.value : guideTool.value,
);
const commitMove = ref(false);
const compareReference = ref(false);
const mat = ref<'checker' | 'black' | 'white'>('checker');

// Brush parameters
const brushDiameter = ref(36);
const brushHardness = ref(0.5);
const smudgeStrength = ref(0.85);
const guideDiameter = ref(48);
const erasingGuide = ref(false);
const smartSnap = ref(true);

// Layer stack state
const activeLayerId = ref('');
const soloLayerId = ref('');
const soloGroupKey = ref('');
const collapsedGroups = ref<Record<string, boolean>>({});
const recentChanges = ref<Record<string, 'new' | 'updated'>>({});
const renamingId = ref('');
const renameDraft = ref('');
const renamingGroupKey = ref('');
const renamingGroupPath = ref<string[]>([]);
const groupRenameDraft = ref('');
const draggingLayerId = ref('');
const dragOverLayerId = ref('');

// Pending Tier-1 zero-AI split selection
const pendingRect = shallowRef<Rect>();
const pendingLasso = shallowRef<{ x: number; y: number }[]>();

// Candidate Pool (Seedream 5.5 layer_decomposition)
const poolBatch = shallowRef<DecomposeBatch>();
const poolSelected = ref<string[]>([]);
const poolVisibleIds = ref<string[]>([]);
const poolSoloId = ref('');
const fittingId = ref('');
const maskChoices = computed(() => [
  ...(poolBatch.value?.layers ?? []).filter(l => l.id !== fittingId.value && !l.needsPosition),
  ...(project.value?.layers ?? []).filter(l => !l.archived),
].map(({ id, name }) => ({ id, name })));
watch(() => poolBatch.value?.id, () => { fittingId.value = ''; });
const poolStageActive = ref(false);
const poolDrag = shallowRef<{ batchId: string; from: string; over: string }>();
const poolOrder = computed(() => poolBatch.value ? candidateOrder(poolBatch.value, project.value?.layers ?? []) : []);
const poolFrontFirst = computed(() => {
  const items = new Map(poolBatch.value?.layers.map(l => [l.id, l]));
  return poolOrder.value.flatMap(id => items.get(id) ?? []).reverse();
});
const hoverOrder = computed(() => {
  const drag = poolDrag.value;
  return drag && drag.batchId === poolBatch.value?.id && drag.over
    ? moveCandidate(poolOrder.value, drag.from, drag.over) : poolOrder.value;
});
const previewingPoolDrag = computed(() => hoverOrder.value !== poolOrder.value);
const decomposeConfigOpen = ref(true);
const scope = ref<'master' | 'layers' | 'region'>('master');
const sourceIds = ref<string[]>([]);
const multiIds = ref<string[]>([]);
const multiSelect = ref(false);
const archiveSource = ref(true);
const formKey = computed(() =>
  scope.value === 'master'
    ? 'master'
    : scope.value === 'region'
      ? regionKey(pendingRect.value)
      : JSON.stringify(sourceIds.value),
);
const decomposePrompt = ref('');
const decomposeMax = ref(8);
const decomposeUnlimited = ref(false);
const decomposeSize = ref<DecomposeSize>('2K');
const decomposeModelId = ref('');

// Tier-2 Local Component Completion state
const scalpelName = ref('');
const scalpelInstruction = ref('');
const scalpelOccluderIds = ref<string[]>([]);
const rerollModelId = ref('');
const scalpelFraming = ref<ScalpelFraming>('auto');
const rerollCandidates = shallowRef<RerollCandidate[]>([]);
const activeCandidateId = ref('');
const rerollResultMode = ref<'raw' | 'overlay'>('raw');
const guideHistory = shallowRef<GuideHistory>();

// Stack Undo / Redo (in-memory shallow snapshots, up to 30 steps)
interface StackSnapshot {
  label: string;
  layers: StackLayer[];
  activeLayerId?: string;
  confirmUndo?: boolean;
  poolChange?: { before: LayerProject['pendingSplit']; after: LayerProject['pendingSplit'] };
  poolOrderChange?: { batchId: string; before: string[]; after: string[] };
  rejection?: RejectionChange;
}
const stackHistory = shallowRef<{ entries: StackSnapshot[]; index: number }>({ entries: [], index: -1 });

const canvasRef = shallowRef<InstanceType<typeof LayerCanvas>>();
const masterPicture = computed<Picture | undefined>(() => {
  const p = project.value;
  if (!p) return;
  const master = p.reference;
  let blob = masterBlobs.get(master);
  if (!blob) {
    blob = png(master);
    masterBlobs.set(master, blob);
  }
  return {
    id: p.id,
    entity_key: p.id,
    label: '#layer',
    aliases: ['#layer'],
    origins: [{ source: 'edit', label: '#layer', boardId: p.id, order: 0 }],
    blob,
    createdAt: 0,
    size: { width: master.width, height: master.height },
    params: {},
  };
});
const masterBlobs = new WeakMap<Raster, Blob>();
let detachPlanning: (() => void) | undefined;
const referenceFile = shallowRef<HTMLInputElement>();
const importLayerInput = shallowRef<HTMLInputElement>();
const errorBox = shallowRef<HTMLElement>();

let controller: AbortController | undefined;
let committed: LayerProject | undefined;
let writing: Promise<boolean> | undefined;

const reference = computed(() => project.value?.reference);
const rejectedCount = computed(() =>
  project.value?.generationRounds?.reduce((total, round) => total + round.rejected.length, 0) ?? 0,
);
const transparent = computed(() => !!reference.value && hasExteriorTransparency(reference.value));
const reversedLayers = computed(() => (project.value ? [...project.value.layers].reverse() : []));
const activeLayer = computed(() => project.value?.layers.find((l) => l.id === activeLayerId.value));
const activeLayerIndex = computed(() =>
  project.value ? project.value.layers.findIndex((l) => l.id === activeLayerId.value) : -1,
);
const visibleLayerCount = computed(() => project.value?.layers.filter(layerVisible).length ?? 0);

const soloLayerIds = computed<readonly string[] | undefined>(() => {
  if (soloLayerId.value) return [soloLayerId.value];
  if (soloGroupKey.value && project.value) {
    const prefix = soloGroupKey.value.split('\0');
    const ids = project.value.layers.filter((l) => layerInGroup(l, prefix)).map((l) => l.id);
    if (ids.length) return ids;
  }
  return undefined;
});

type StackDisplayItem =
  | {
      kind: 'group';
      key: string;
      name: string;
      path: string[];
      depth: number;
      collapsed: boolean;
      visible: boolean;
      solo: boolean;
      count: number;
    }
  | { kind: 'layer'; layer: StackLayer; depth: number };

const stackDisplayItems = computed<StackDisplayItem[]>(() => {
  const p = project.value;
  if (!p) return [];
  const items: StackDisplayItem[] = [];
  const openPaths: string[] = [];
  const collapsed = collapsedGroups.value;

  const isHiddenByCollapse = (path: readonly string[]) => {
    for (let d = 1; d <= path.length; d++) {
      if (collapsed[path.slice(0, d).join('\0')]) return true;
    }
    return false;
  };

  for (const layer of reversedLayers.value) {
    const names = layer.groups ?? [];
    const groups = layer.groupIds ?? names;
    let common = 0;
    while (common < openPaths.length && common < groups.length && openPaths[common] === groups[common]) {
      common++;
    }
    openPaths.length = common;
    for (let i = common; i < groups.length; i++) {
      const parentPath = groups.slice(0, i);
      const path = groups.slice(0, i + 1);
      openPaths.push(groups[i]);
      if (isHiddenByCollapse(parentPath)) continue;
      const key = path.join('\0');
      const members = p.layers.filter((l) => layerInGroup(l, path));
      items.push({
        kind: 'group',
        key,
        name: names[i],
        path,
        depth: i,
        collapsed: !!collapsed[key],
        visible: !members.some((l) => l.mutedGroups?.includes(key)),
        solo: soloGroupKey.value === key,
        count: members.length,
      });
    }
    if (!isHiddenByCollapse(groups)) {
      items.push({ kind: 'layer', layer, depth: groups.length });
    }
  }
  return items;
});

const decomposeModels = computed(() => props.models.filter(decomposeCapable));
const chosenDecomposeModel = computed(
  () =>
    (decomposeModelId.value && decomposeModels.value.find((m) => m.id === decomposeModelId.value)) ||
    preferredDecomposeModel(props.models),
);

const rerollModels = computed(() => props.models.filter(rerollCapable));
const chosenRerollModel = computed(
  () =>
    (rerollModelId.value && rerollModels.value.find((m) => m.id === rerollModelId.value)) ||
    preferredRerollModel(props.models, props.activeModel),
);

const hasScalpelGuide = computed(
  () => !!project.value?.alpha.some(Boolean) || !!project.value?.occluded?.some(Boolean),
);
const referenceChoices = computed(() => project.value ? referenceSources(project.value) : []);
const excludedReferences = computed(() => scalpelOccluderIds.value.map(layerPictureId));
const inputLayout = computed(() => scalpelInputs(
  chosenRerollModel.value?.maxImages ?? 0, project.value?.scalpelReferences?.length ?? 0, !!scalpelOccluderIds.value.length,
));

const activeCandidate = computed(() =>
  rerollCandidates.value.find((c) => c.id === activeCandidateId.value),
);
const candidateSize = computed(() => activeCandidate.value?.resolution);
function downloadRawCandidate() {
  const c = activeCandidate.value;
  if (!c) return;
  const ext = c.blob.type === 'image/jpeg' ? 'jpg' : c.blob.type === 'image/webp' ? 'webp' : 'png';
  download(c.blob, `局部补画-原始回图-${rerollCandidates.value.indexOf(c) + 1}.${ext}`);
}

function candidateVariant(c: RerollCandidate) {
  if (rerollResultMode.value === 'overlay' && c.overlayRaster && c.overlayPreview && c.overlayBox) {
    return { raster: c.overlayRaster, preview: c.overlayPreview, box: c.overlayBox };
  }
  return { raster: c.raster, preview: c.preview, box: c.box };
}

const previewRaster = computed<Raster | undefined>(() => {
  if (mode.value === 'scalpel' && activeCandidate.value) {
    return candidateVariant(activeCandidate.value).raster;
  }
  return undefined;
});

const previewLayers = computed(() => {
  const batch = poolBatch.value,
    p = project.value;
  if (mode.value !== 'stack' || !(poolStageActive.value || previewingPoolDrag.value) || !batch || !p) return undefined;
  const selected = batch.layers.filter((l) =>
    poolSoloId.value ? l.id === poolSoloId.value : poolVisibleIds.value.includes(l.id),
  );
  const candidates: StackLayer[] = selected.map((l) => ({
    id: l.id, name: l.name, candidateId: l.id, width: l.raster.width, height: l.raster.height,
    pixels: l.raster.data, visible: true, locked: false,
    x: l.local ? l.box.x : 0,
    y: l.local ? l.box.y : 0,
  }));
  let context = p.layers;
  if (poolSoloId.value) context = [];
  else if (batch.source.kind === 'master') context = context.filter(l => l.batchId === batch.id);
  const members = batch.source.members.map(m => m.id);
  const anchor = batch.insertAbove ? context.findIndex(l => l.id === batch.insertAbove)
    : context.map(l => members.includes(l.id)).lastIndexOf(true);
  return insertSplitCandidates(context, candidates, { ...batch, order: hoverOrder.value }, anchor < 0 ? context.length : anchor + 1)
    .filter(l => layerVisible(l) && !(archiveSource.value && members.includes(l.id)))
    .map(l => ({ data: l.pixels, width: l.width, height: l.height, x: l.x, y: l.y }));
});
const stageProject = computed(() => {
  const p = project.value;
  return p && draggingLayerId.value && dragOverLayerId.value
    ? { ...p, layers: reorderLayer(p.layers, draggingLayerId.value, dragOverLayerId.value) }
    : p;
});

const allPoolVisible = computed(() => {
  const batch = poolBatch.value;
  if (!batch) return false;
  const check = batch.layers;
  return check.every((l) => poolVisibleIds.value.includes(l.id));
});

const canUndo = computed(() =>
  mode.value === 'stack' ? stackHistory.value.index > 0 : (guideHistory.value?.position ?? 0) > 0,
);
const canRedo = computed(() =>
  mode.value === 'stack'
    ? stackHistory.value.index >= 0 && stackHistory.value.index < stackHistory.value.entries.length - 1
    : !!guideHistory.value && guideHistory.value.position < guideHistory.value.edits.length,
);

const hasPendingSelection = computed(() => !!pendingRect.value || !!pendingLasso.value);

watch(
  [error, saveError],
  ([msg, unsaved]) => {
    if (msg || unsaved) errorBox.value?.scrollIntoView({ block: 'nearest' });
  },
  { flush: 'post' },
);

watch(reference, (refImg) => {
  if (refImg) emit('size', { width: refImg.width, height: refImg.height });
});

function resetStackHistory(p: LayerProject) {
  stackHistory.value = {
    entries: [{ label: '初始状态', layers: p.layers, activeLayerId: p.activeLayerId }],
    index: 0,
  };
}

function pushStackHistory(
  label: string,
  layers: StackLayer[],
  nextActiveId?: string,
  options?: Pick<StackSnapshot, 'confirmUndo' | 'poolChange' | 'poolOrderChange' | 'rejection'>,
) {
  const cur = stackHistory.value;
  const trimmed = cur.entries.slice(0, cur.index + 1);
  trimmed.push({ label, layers, activeLayerId: nextActiveId, ...options });
  const capped = trimmed.slice(-30);
  stackHistory.value = { entries: capped, index: capped.length - 1 };
}

function display(p: LayerProject) {
  const switched = project.value?.id !== p.id;
  committed = p;
  saveError.value = '';
  project.value = p;
  if (switched) {
    const source = p.pendingSplit?.batch.source;
    scope.value = source?.kind ?? 'master';
    sourceIds.value = source?.members.map((m) => m.id) ?? [];
    multiIds.value = [];
    multiSelect.value = false;
    poolBatch.value = p.pendingSplit?.batch;
    poolSelected.value = [...(p.pendingSplit?.selected ?? [])];
    poolVisibleIds.value = [...poolSelected.value];
    archiveSource.value = p.pendingSplit?.archive ?? true;
    poolSoloId.value = '';
    poolStageActive.value = !!p.pendingSplit;
    decomposeConfigOpen.value = true;
    rerollCandidates.value = [];
    activeCandidateId.value = '';
    rerollResultMode.value = 'raw';
    guideHistory.value = undefined;
    soloLayerId.value = '';
    soloGroupKey.value = '';
    collapsedGroups.value = {};
    recentChanges.value = {};
    renamingId.value = '';
    renamingGroupKey.value = '';
    pendingRect.value = source?.kind === 'region' ? source.rect : undefined;
    pendingLasso.value = undefined;
    compareReference.value = false;
    mode.value = 'stack';
    stackTool.value = 'move';
    resetStackHistory(p);
  }
  activeLayerId.value =
    (p.activeLayerId && p.layers.some((l) => l.id === p.activeLayerId)
      ? p.activeLayerId
      : p.layers.at(-1)?.id) ?? '';
  loadForm(p);
  decomposeModelId.value = p.decomposeModel ?? '';
  scalpelName.value = p.scalpelName;
  scalpelInstruction.value = p.scalpelInstruction;
  scalpelOccluderIds.value = p.scalpelOccluderIds.filter((id) => p.layers.some((l) => l.id === id));
  rerollModelId.value = p.rerollModel ?? '';
}

function queueSave(next: LayerProject) {
  if (project.value?.layers !== next.layers) {
    const available = new Set(referenceSources(next).map(s => s.picture));
    next.scalpelReferences = next.scalpelReferences?.filter(r => available.has(r.picture));
    scalpelOccluderIds.value = next.scalpelOccluderIds.filter(id => next.layers.some(l => l.id === id));
    next.scalpelOccluderIds = [...scalpelOccluderIds.value];
  }
  project.value = next;
  note.value = '';
  error.value = '';
  if (writing) return;
  saving.value = true;
  writing = (async () => {
    try {
      while (project.value && project.value !== committed) {
        const snapshot = project.value;
        const stored = await store.save({ ...snapshot, revision: committed!.revision });
        committed = stored;
        if (project.value === snapshot) project.value = stored;
      }
      saveError.value = '';
      return true;
    } catch (e) {
      const detail = e instanceof DOMException && e.name === 'QuotaExceededError'
        ? '浏览器可用存储空间不足'
        : e instanceof Error ? e.message || e.name : String(e);
      saveError.value = `分件修改尚未保存（${detail}）。当前图层和候选仍在本页。`;
      return false;
    } finally {
      saving.value = false;
      writing = undefined;
    }
  })();
}

async function settled() {
  return writing ? await writing : !saveError.value;
}

function retrySave() {
  if (project.value && !writing) queueSave(project.value);
}

async function runTask(work: () => Promise<void>, allowUnsaved = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  note.value = '';
  try {
    if (await settled() || allowUnsaved) await work();
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    busy.value = false;
    activeRequest.value = null;
    progress.value = '';
    controller = undefined;
  }
}

function stackRejections(p: LayerProject, layers: StackLayer[], change?: RejectionChange, undo = false) {
  if (change?.reason === 'deleted_layer' && !undo) {
    const retained = new Set([...layers.map(l => l.candidateId), ...rerollCandidates.value.map(c => c.id)]);
    change = { ...change, items: change.items.filter(item => !retained.has(item.id)) };
  }
  return changeRejections(p.generationRounds, change, undo);
}

function commitStackChange(
  label: string,
  layers: StackLayer[],
  nextActiveId?: string,
  options?: Pick<StackSnapshot, 'confirmUndo' | 'poolChange' | 'rejection'> & { keepChanges?: boolean },
) {
  const p = project.value;
  if (!p) return;
  const generationRounds = stackRejections(p, layers, options?.rejection);
  const resolvedActive =
    nextActiveId && layers.some((l) => l.id === nextActiveId)
      ? nextActiveId
      : activeLayerId.value && layers.some((l) => l.id === activeLayerId.value)
        ? activeLayerId.value
        : layers.at(-1)?.id;
  if (soloLayerId.value && !layers.some((l) => l.id === soloLayerId.value)) {
    soloLayerId.value = '';
  }
  if (soloGroupKey.value) {
    const prefix = soloGroupKey.value.split('\0');
    if (!layers.some((l) => layerInGroup(l, prefix))) soloGroupKey.value = '';
  }
  if (!options?.keepChanges && Object.keys(recentChanges.value).length) {
    recentChanges.value = {};
  }
  activeLayerId.value = resolvedActive ?? '';
  scalpelOccluderIds.value = scalpelOccluderIds.value.filter((id) => layers.some((l) => l.id === id));
  pushStackHistory(label, layers, resolvedActive, {
    confirmUndo: options?.confirmUndo,
    poolChange: options?.poolChange,
    rejection: options?.rejection,
  });
  queueSave({
    ...p,
    layers,
    generationRounds,
    activeLayerId: resolvedActive,
    pendingSplit: poolState(),
    scalpelOccluderIds: [...scalpelOccluderIds.value],
  });
}

function loadForm(p: LayerProject) {
  const form = formKey.value === 'master' ? undefined : p.subForms?.[formKey.value];
  decomposePrompt.value = form?.prompt ?? (scope.value === 'master' ? (p.decomposePrompt ?? '') : '');
  decomposeMax.value = form?.max ?? (scope.value === 'master' ? (p.decomposeMax ?? 8) : 12);
  decomposeUnlimited.value = form?.unlimited ?? (scope.value === 'master' && !!p.decomposeUnlimited);
}
function regionKey(rect?: Rect) {
  return rect ? 'region:' + [rect.x, rect.y, rect.width, rect.height].join(',') : 'region';
}
function chooseRect(rect?: Rect) {
  if (scope.value !== 'region' || !project.value) {
    pendingRect.value = rect;
    return;
  }
  const previous = pendingRect.value;
  pendingRect.value = rect;
  if (previous || project.value.subForms?.[formKey.value]) loadForm(project.value);
}
function focusSplit(kind: typeof scope.value, ids: string[] = []) {
  if (!project.value) return;
  syncFields();
  if (kind === 'region') clearPendingSelection();
  scope.value = kind;
  sourceIds.value = project.value.layers.filter((l) => ids.includes(l.id)).map((l) => l.id);
  loadForm(project.value);
  decomposeConfigOpen.value = true;
  poolStageActive.value = false;
  compareReference.value = false;
  if (kind === 'region') stackTool.value = 'rect';
}
function poolState() {
  return poolBatch.value
    ? { batch: poolBatch.value, selected: [...poolSelected.value], archive: archiveSource.value }
    : undefined;
}
function showPool(state: LayerProject['pendingSplit']) {
  poolBatch.value = state?.batch;
  poolSelected.value = [...(state?.selected ?? [])];
  poolVisibleIds.value = [...poolSelected.value];
  archiveSource.value = state?.archive ?? true;
  poolSoloId.value = '';
  poolStageActive.value = !!state;
  decomposeConfigOpen.value = !state;
}
function switchPool(id: string) {
  const p = project.value;
  const chosen = p?.otherSplits?.find((s) => s.batch.id === id);
  if (!p || !chosen) return;
  const previous = poolState();
  const source = chosen.batch.source;
  scope.value = source.kind;
  sourceIds.value = source.members.map((m) => m.id);
  pendingRect.value = source.kind === 'region' ? source.rect : undefined;
  stackTool.value = 'move';
  loadForm(p);
  showPool(chosen);
  queueSave({
    ...p,
    pendingSplit: chosen,
    otherSplits: [...(p.otherSplits ?? []).filter((s) => s !== chosen), ...(previous ? [previous] : [])],
  });
}
function savePool() {
  if (project.value) queueSave({ ...project.value, pendingSplit: poolState() });
}
function syncFields() {
  const p = project.value;
  if (!p) return;
  const next: LayerProject = {
    ...p,
    ...(scope.value === 'master'
      ? {
          decomposePrompt: decomposePrompt.value,
          decomposeMax: decomposeMax.value,
          decomposeUnlimited: decomposeUnlimited.value,
        }
      : {
          subForms: {
            ...p.subForms,
            [formKey.value]: {
              prompt: decomposePrompt.value,
              max: decomposeMax.value,
              unlimited: decomposeUnlimited.value,
            },
          },
        }),
    pendingSplit: poolState(),
    decomposeModel: decomposeModelId.value || undefined,
    scalpelName: scalpelName.value,
    scalpelInstruction: scalpelInstruction.value,
    scalpelOccluderIds: [...scalpelOccluderIds.value],
    rerollModel: rerollModelId.value || undefined,
  };
  queueSave(next);
}

async function start(blob: Blob, title: string, sourceRecordId?: string) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const id =
    'layer-' + Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('');
  const existing = await store.read(id);
  if (existing) display(existing);
  else {
    const fresh = newProject(id, title, await readRaster(blob), sourceRecordId);
    display(fresh);
    queueSave({ ...fresh });
    await settled();
  }
  saved.value = await store.list();
}

async function loadProject(id: string) {
  const p = await store.read(id);
  if (!p) throw new Error('找不到分件项目');
  display(p);
}

function switchProject(id: string) {
  // The controlled select can re-render while the previous project's save drains.
  return runTask(() => loadProject(id));
}

async function loadReferenceFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await runTask(async () => {
    await start(file, file.name);
  });
}

async function onImportLayerFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  const p = project.value;
  if (!p || !files.length) return;
  const targetProjectId = p.id;
  await runTask(async () => {
    const items: {
      name: string;
      raster: Raster;
      x?: number;
      y?: number;
      rawSize?: { width: number; height: number };
      rawScale?: number;
    }[] = [];
    let alignedCount = 0;
    let scaledCount = 0;
    let lastConfidence = 0;
    const { width: refW, height: refH } = p.reference;
    for (const file of files) {
      if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error(`「${file.name}」需要 PNG、JPEG 或 WebP 格式`);
      }
      const raw = await readRaster(file);
      if (raw.width === refW && raw.height === refH) {
        items.push({ name: file.name, raster: raw, x: 0, y: 0 });
        continue;
      }
      const alignment = alignRasterToReference(raw, p.reference);
      if (alignment.matched) {
        const tight = crop(raw, alignment.sourceBox);
        const target = alignment.rect;
        const resized =
          target.width === tight.width && target.height === tight.height
            ? tight
            : placeOnCanvas(
                tight,
                { x: 0, y: 0, width: target.width, height: target.height },
                target.width,
                target.height,
              );
        const rawScale =
          Math.round(
            Math.max(
              target.width / Math.max(1, tight.width),
              target.height / Math.max(1, tight.height),
            ) * 100,
          ) / 100;
        items.push({
          name: file.name,
          raster: resized,
          x: target.x,
          y: target.y,
          rawSize: { width: tight.width, height: tight.height },
          rawScale,
        });
        alignedCount++;
        lastConfidence = alignment.confidence;
        continue;
      }
      let raster = raw;
      if (raster.width > refW || raster.height > refH) {
        const scale = Math.min(refW / raster.width, refH / raster.height);
        const fittedW = Math.max(1, Math.round(raster.width * scale));
        const fittedH = Math.max(1, Math.round(raster.height * scale));
        raster = placeOnCanvas(
          raster,
          { x: 0, y: 0, width: fittedW, height: fittedH },
          fittedW,
          fittedH,
        );
        scaledCount++;
      }
      items.push({ name: file.name, raster });
    }
    const cur = project.value;
    if (!cur || cur.id !== targetProjectId) return;
    const { project: next, added } = importImageLayers(cur, items);
    const changes: Record<string, 'new' | 'updated'> = {};
    for (const layer of added) changes[layer.id] = 'new';
    recentChanges.value = changes;
    poolStageActive.value = false;
    soloLayerId.value = '';
    soloGroupKey.value = '';
    compareReference.value = false;
    mode.value = 'stack';
    commitStackChange(
      added.length === 1 ? `导入图层「${added[0].name}」` : `导入 ${added.length} 个图层`,
      next.layers,
      next.activeLayerId,
      { keepChanges: true },
    );
    if (added.length === 1 && alignedCount === 1) {
      note.value = `已导入并自动对齐「${added[0].name}」（匹配度 ${Math.round(lastConfidence * 100)}%）`;
    } else if (alignedCount) {
      note.value = `已导入 ${added.length} 个图层（其中 ${alignedCount} 层已自动对齐原图）`;
    } else {
      const label = added.length === 1 ? `已导入图层「${added[0].name}」` : `已导入 ${added.length} 个图层`;
      note.value = scaledCount ? `${label}（超画布图像已等比缩放居中）` : label;
    }
  });
}

// ── Seedream 5.5 拆层 & 候选池（Candidate Pool）──────────────────────────────

async function runDecompose() {
  const p = project.value;
  const model = chosenDecomposeModel.value;
  if (!p || !model) {
    error.value = '请先在设置中配置支持原图拆层的 Seedream 5.5（火山方舟 / BytePlus）连接';
    return;
  }
  await runTask(async () => {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    activeRequest.value = 'decompose';
    progress.value = '正在准备拆层请求…';
    if (scope.value === 'region' && !pendingRect.value) throw new Error('请在母版上框选要细拆的区域');
    if (scope.value === 'layers' && !sourceIds.value.length) throw new Error('请选择要继续细拆的图层');
    const source = splitSource(
      p,
      scope.value === 'layers' ? sourceIds.value : [],
      scope.value === 'region' ? pendingRect.value : undefined,
    );
    const batch = await requestLayerDecompose(
      services,
      p,
      model,
      {
        prompt: decomposePrompt.value,
        maxImages: decomposeUnlimited.value ? undefined : decomposeMax.value,
        size: decomposeSize.value,
        source,
      },
      request.signal,
      (msg) => {
        progress.value = msg;
      },
    );
    request.signal.throwIfAborted();
    if (project.value?.id !== p.id) return;
    const previousPool = poolState();
    poolBatch.value = batch;
    archiveSource.value = source.kind === 'layers';
    const defaultPicked = batch.layers.filter((l) => !l.isBase).map((l) => l.id);
    poolSelected.value = defaultPicked.length
      ? defaultPicked
      : batch.layers.slice(0, 1).map((l) => l.id);
    poolVisibleIds.value = [...poolSelected.value];
    poolSoloId.value = '';
    poolStageActive.value = true;
    decomposeConfigOpen.value = false;
    compareReference.value = false;
    note.value = `${batch.targetName}返回 ${batch.layers.length} 个候选层，已在画布实时叠加显示`;
    queueSave({
      ...project.value!,
      pendingSplit: poolState(),
      otherSplits: [...(project.value!.otherSplits ?? []), ...(previousPool ? [previousPool] : [])],
      generationRounds: addGeneration(project.value, {
        source: source.kind, target: source.name, model: batch.model,
        candidateIds: batch.layers.map(l => l.id),
      }),
      lastSplit: {
        name: batch.targetName,
        layers: batch.layers.map(({ name, width, height, zIndex, isBase }) => ({
          name,
          width,
          height,
          zIndex,
          isBase,
        })),
      },
    });
  });
}

function setRegionDestination(field: 'groupName' | 'insertAbove', value: string) {
  if (poolBatch.value?.source.kind !== 'region') return;
  poolBatch.value = { ...poolBatch.value, [field]: value };
  savePool();
}
function applyPoolOrder(from: string, to?: string) {
  const batch = poolBatch.value, p = project.value;
  if (!batch || !p || busy.value || !to) return;
  if (!batch.layers.some(l => l.id === from) || !batch.layers.some(l => l.id === to)) return;
  const before = poolOrder.value, after = moveCandidate(before, from, to);
  if (after === before) return;
  poolBatch.value = { ...batch, order: after };
  poolStageActive.value = true;
  compareReference.value = false;
  pushStackHistory('候选图层排序', p.layers, activeLayerId.value, {
    poolOrderChange: { batchId: batch.id, before, after },
  });
  savePool();
}
function startPoolDrag(event: DragEvent, id: string) {
  if (busy.value || !poolBatch.value || (event.target as Element).closest('input,button,select,.layer-fit')) {
    event.preventDefault();
    return;
  }
  poolDrag.value = { batchId: poolBatch.value.id, from: id, over: '' };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-koma-layer-candidate', id);
  }
}
function overPoolRow(event: DragEvent, to: string) {
  const drag = poolDrag.value;
  if (!drag || drag.batchId !== poolBatch.value?.id) return;
  event.preventDefault();
  if (drag.over !== to) poolDrag.value = { ...drag, over: to };
}
function leavePool(event: DragEvent) {
  const drag = poolDrag.value;
  if (drag?.over && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    poolDrag.value = { ...drag, over: '' };
  }
}
function dropPoolRow(event: DragEvent, to: string) {
  const drag = poolDrag.value;
  poolDrag.value = undefined;
  if (!drag || drag.batchId !== poolBatch.value?.id) return;
  event.preventDefault();
  applyPoolOrder(drag.from, to);
}
function togglePoolSelect(id: string) {
  poolSelected.value = poolSelected.value.includes(id)
    ? poolSelected.value.filter((x) => x !== id)
    : [...poolSelected.value, id];
  savePool();
}
function selectAllPool() {
  const ids = poolBatch.value?.layers.map((l) => l.id) ?? [];
  poolSelected.value = ids.every((id) => poolSelected.value.includes(id)) ? [] : ids;
  savePool();
}
function adjustCandidate(item: PoolLayer, edit: { box: Rect } | { maskId: string }) {
  const p = project.value, batch = poolBatch.value;
  if (!p || !batch || busy.value || !batch.layers.includes(item)) return;
  const before = poolState();
  try {
    if ('box' in edit) {
      const fitted = fitCandidate(item, edit.box, p.reference);
      poolBatch.value = { ...batch, layers: batch.layers.map(l => l.id === item.id ? fitted : l) };
      poolVisibleIds.value = [...new Set([...poolVisibleIds.value, item.id])];
      if (poolSoloId.value) poolSoloId.value = item.id;
    } else {
      const mask = batch.layers.find(l => l.id === edit.maskId && l.id !== item.id && !l.needsPosition);
      const formal = p.layers.find(l => l.id === edit.maskId && !l.archived);
      if (!mask && !formal) throw new Error('请选择已定位的轮廓图层');
      const pixels = mask ? localPixels(mask) : { data: formal!.pixels, width: formal!.width, height: formal!.height };
      const copy = clippedCandidate(item, pixels, mask?.box ?? formal!);
      const order = [...poolOrder.value];
      order.splice(order.indexOf(item.id) + 1, 0, copy.id);
      poolBatch.value = { ...batch, order, layers: [...batch.layers, copy] };
      poolSelected.value = [...poolSelected.value.filter(id => id !== item.id), copy.id];
      poolVisibleIds.value = [...poolVisibleIds.value.filter(id => id !== item.id), copy.id];
      if (poolSoloId.value) poolSoloId.value = copy.id;
      fittingId.value = '';
    }
    poolStageActive.value = true;
    compareReference.value = false;
    const label = 'box' in edit ? '校准候选位置与尺寸' : '另存可见裁片';
    pushStackHistory(label, p.layers, activeLayerId.value, { poolChange: { before, after: poolState() } });
    savePool();
    note.value = 'box' in edit ? '已按原画布坐标更新' : '已选中可见裁片，完整组件保留在候选池';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function toggleAllPoolVisible() {
  if (!poolBatch.value) return;
  poolSoloId.value = '';
  poolStageActive.value = true;
  compareReference.value = false;
  if (allPoolVisible.value) {
    poolVisibleIds.value = [];
  } else {
    poolVisibleIds.value = poolBatch.value.layers.map((l) => l.id);
  }
}

function togglePoolVisible(id: string) {
  compareReference.value = false;
  poolStageActive.value = true;
  if (poolSoloId.value) {
    if (poolSoloId.value === id) {
      poolSoloId.value = '';
      poolVisibleIds.value = poolVisibleIds.value.filter((x) => x !== id);
      return;
    }
    poolSoloId.value = '';
  }
  if (poolVisibleIds.value.includes(id)) {
    poolVisibleIds.value = poolVisibleIds.value.filter((x) => x !== id);
  } else {
    poolVisibleIds.value = [...poolVisibleIds.value, id];
  }
}

function togglePoolSolo(id: string) {
  compareReference.value = false;
  poolStageActive.value = true;
  poolSoloId.value = poolSoloId.value === id ? '' : id;
}

function admitSelectedPool() {
  const p = project.value;
  const batch = poolBatch.value;
  if (!p || !batch) return;
  const picked = batch.layers.filter((l) => poolSelected.value.includes(l.id));
  if (!picked.length) {
    error.value = '请先勾选至少一个候选图层';
    return;
  }
  try {
    const previousPool = poolState();
    const next = admitSplit(p, batch, picked, archiveSource.value);
    const addedCount = next.layers.length - p.layers.length;
    const remaining = batch.layers.filter((l) => !poolSelected.value.includes(l.id));
    if (remaining.length) {
      poolBatch.value = { ...batch, order: poolOrder.value, layers: remaining };
      poolSelected.value = [];
      poolVisibleIds.value = remaining.filter((l) => !l.isBase).map((l) => l.id);
      poolSoloId.value = '';
      poolStageActive.value = false;
    } else {
      poolBatch.value = undefined;
      poolSelected.value = [];
      poolVisibleIds.value = [];
      poolSoloId.value = '';
      poolStageActive.value = false;
      decomposeConfigOpen.value = true;
    }
    commitStackChange(`收纳 ${addedCount} 层`, next.layers, next.activeLayerId, {
      poolChange: { before: previousPool, after: poolState() },
    });
    if (scope.value === 'region') {
      scope.value = 'master';
      stackTool.value = 'move';
      clearPendingSelection();
      loadForm(project.value!);
    }
    note.value = `已收纳 ${addedCount} 个图层`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function discardPool(id?: string) {
  const p = project.value, batch = poolBatch.value;
  if (!p || !batch || busy.value) return;
  const dropped = batch.layers.filter(l => !id || l.id === id);
  if (!dropped.length) return;
  const before = poolState();
  const remaining = batch.layers.filter(l => id && l.id !== id);
  if (remaining.length) {
    poolBatch.value = { ...batch, layers: remaining };
    poolSelected.value = poolSelected.value.filter(i => i !== id);
    poolVisibleIds.value = poolVisibleIds.value.filter(i => i !== id);
    if (poolSoloId.value === id) poolSoloId.value = '';
  } else showPool(undefined);
  const rejection: RejectionChange = {
    reason: 'discarded_candidate',
    items: dropped.filter(item => !p.layers.some(layer => layer.candidateId === item.id))
      .map(({ id, name, preview }) => ({ id, name, preview })),
  };
  try {
    commitStackChange('淘汰候选', p.layers, activeLayerId.value, {
      poolChange: { before, after: poolState() }, rejection, keepChanges: true,
    });
    const tracked = p.generationRounds?.some(r => r.candidateIds.includes(dropped[0].id));
    note.value = tracked ? `已淘汰 ${dropped.length} 张候选` : `已淘汰 ${dropped.length} 张候选，本批在 ASK 的三轮记录范围外`;
  } catch (e) {
    showPool(before);
    error.value = e instanceof Error ? e.message : String(e);
  }
}

// ── 类 PS 正式图层栈操作 ──────────────────────────────────────────────────────

function selectLayer(id: string) {
  activeLayerId.value = id;
  poolStageActive.value = false;
  if (soloLayerId.value && soloLayerId.value !== id) soloLayerId.value = '';
  const p = project.value;
  if (p && p.activeLayerId !== id) {
    queueSave({ ...p, activeLayerId: id });
  }
}

function restoreSource(layer: StackLayer) {
  const p = project.value;
  if (!p) return;
  const originals = p.layers.filter((l) => l.archived && l.batchId === layer.batchId);
  const restored = p.layers
    .filter((l) => !originals.includes(l))
    .map((l) => (l.batchId === layer.batchId ? { ...l, visible: false } : l));
  for (const original of originals.sort(
    (a, b) => (a.archiveOrigin?.index ?? 0) - (b.archiveOrigin?.index ?? 0),
  )) {
    const source = original.archiveOrigin;
    restored.splice(source?.index ?? restored.length, 0, {
      ...original,
      archived: false,
      archiveOrigin: undefined,
      groups: source?.groups,
      groupIds: source?.groupIds,
      batchId: source?.batchId,
      visible: source?.visible ?? true,
      mutedGroups: original.mutedGroups?.filter((key) =>
        layerInGroup({ groups: source?.groups, groupIds: source?.groupIds }, key.split('\0')),
      ),
    });
  }
  commitStackChange('恢复归档原件', restored, layer.id);
}
function onToggleVisible(id: string) {
  const p = project.value;
  if (!p) return;
  poolStageActive.value = false;
  if (soloLayerId.value === id) soloLayerId.value = '';
  soloGroupKey.value = '';
  commitStackChange('切换图层显隐', toggleLayerVisible(p.layers, id));
}

function onToggleSolo(id: string) {
  compareReference.value = false;
  poolStageActive.value = false;
  soloGroupKey.value = '';
  soloLayerId.value = soloLayerId.value === id ? '' : id;
  if (soloLayerId.value) activeLayerId.value = id;
}

function onToggleGroupCollapse(key: string) {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] };
}

function onToggleGroupVisible(path: string[]) {
  const p = project.value;
  if (!p) return;
  poolStageActive.value = false;
  soloLayerId.value = '';
  soloGroupKey.value = '';
  commitStackChange('切换分组显隐', toggleGroupVisible(p.layers, path));
}

function onToggleGroupSolo(key: string) {
  compareReference.value = false;
  poolStageActive.value = false;
  soloLayerId.value = '';
  soloGroupKey.value = soloGroupKey.value === key ? '' : key;
}

function startRenameGroup(key: string, path: string[], currentName: string) {
  renamingId.value = '';
  renamingGroupKey.value = key;
  renamingGroupPath.value = [...path];
  groupRenameDraft.value = currentName;
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.layer-group-rename-input');
    input?.focus();
    input?.select();
  });
}

function commitRenameGroup(key: string) {
  if (renamingGroupKey.value !== key) return;
  const p = project.value;
  const path = renamingGroupPath.value;
  renamingGroupKey.value = '';
  if (!p || !path.length) return;
  const trimmed = groupRenameDraft.value.trim();
  if (!trimmed) return;
  const nextLayers = renameGroup(p.layers, path, trimmed);
  commitStackChange(`重命名分组「${trimmed}」`, nextLayers);
}

function onUngroup(key: string, path: string[], name: string) {
  const p = project.value;
  if (!p) return;
  const nextLayers = ungroupLayers(p.layers, path);
  if (soloGroupKey.value === key || soloGroupKey.value.startsWith(key + '\0')) {
    soloGroupKey.value = '';
  }
  const nextCollapsed = { ...collapsedGroups.value };
  delete nextCollapsed[key];
  collapsedGroups.value = nextCollapsed;
  commitStackChange(`解散分组「${name}」`, nextLayers);
  note.value = `已解散分组「${name}」，组内图层已保留`;
}

function onDeleteGroup(key: string, path: string[], name: string) {
  const p = project.value;
  if (!p) return;
  try {
    const removed = p.layers.filter((l) => layerInGroup(l, path));
    const nextLayers = deleteGroup(p.layers, path);
    const rejectedItems = removed
      .filter((l) => l.candidateId && !l.archived)
      .map((l) => ({
        id: l.candidateId!,
        name: l.name,
        preview: { width: l.width, height: l.height, data: l.pixels },
      }));
    const rejection: RejectionChange | undefined = rejectedItems.length
      ? { reason: 'deleted_layer', items: rejectedItems }
      : undefined;
    if (soloGroupKey.value === key || soloGroupKey.value.startsWith(key + '\0')) {
      soloGroupKey.value = '';
    }
    const nextCollapsed = { ...collapsedGroups.value };
    delete nextCollapsed[key];
    collapsedGroups.value = nextCollapsed;
    commitStackChange(`删除分组「${name}」`, nextLayers, undefined, { rejection });
    note.value = `已删除分组「${name}」（共 ${removed.length} 层，可 ⌘Z 撤销）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function openInPhotopea() {
  const p = project.value;
  if (!p || busy.value) return;
  error.value = '';
  note.value = '';
  if (!(await settled())) return;
  const fresh = project.value;
  if (!fresh || fresh.id !== p.id) return;
  try {
    photopea.open({
      id: crypto.randomUUID(),
      title: fresh.title,
      layer: {
        key: fresh.id,
        revision: fresh.revision,
        title: fresh.title,
        width: fresh.reference.width,
        height: fresh.reference.height,
        psd: () => layeredPsd(project.value ?? fresh, true),
        valid: () => project.value?.id === fresh.id,
        alive: () => project.value?.id === fresh.id,
        apply: async (result: PhotopeaLayerResult) => {
          const cur = project.value;
          if (!cur || cur.id !== fresh.id) throw new Error('分件项目已切换，请重新打开');
          if (result.width !== cur.reference.width || result.height !== cur.reference.height) {
            throw new Error(
              `画布尺寸已变为 ${result.width}×${result.height}，请恢复为 ${cur.reference.width}×${cur.reference.height} 后再应用`,
            );
          }
          const decoded = [];
          for (const item of result.layers) {
            const raster = await decodeLayerBlob(item.blob);
            decoded.push({
              photopeaId: item.id,
              name: item.name,
              groups: item.groups,
              visible: item.visible,
              locked: item.locked,
              raster,
            });
          }
          const { layers, changes } = applyPhotopeaReturn(cur.layers, decoded);
          if (!layers.length) throw new Error('Photopea 文档中没有可回传的有效像素图层');
          recentChanges.value = changes;
          poolStageActive.value = false;
          soloLayerId.value = '';
          soloGroupKey.value = '';
          commitStackChange('Photopea 精修', layers, layers.at(-1)?.id, {
            confirmUndo: true,
            keepChanges: true,
          });
          if (!(await settled())) throw new Error(saveError.value);
          const vals = Object.values(changes);
          const addedCount = vals.filter((v) => v === 'new').length;
          const updatedCount = vals.filter((v) => v === 'updated').length;
          const groupCount = new Set(
            layers.flatMap((l) => (l.groups?.length ? [groupKey(l.groups)] : [])),
          ).size;
          const parts = [`已同步 ${layers.length} 层`];
          if (groupCount) parts.push(`${groupCount} 个分组`);
          if (addedCount) parts.push(`新增 ${addedCount}`);
          if (updatedCount) parts.push(`修改 ${updatedCount}`);
          if (result.skipped.length) parts.push(`跳过调整层 ${result.skipped.length}`);
          note.value = parts.join(' · ');
          return committed?.revision;
        },
      },
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function onToggleLock(id: string) {
  const p = project.value;
  if (!p) return;
  commitStackChange('切换图层锁定', toggleLayerLock(p.layers, id));
}

function startRename(layer: StackLayer) {
  renamingId.value = layer.id;
  renameDraft.value = layer.name;
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.layer-rename-input');
    input?.focus();
    input?.select();
  });
}

function commitRename(id: string) {
  if (renamingId.value !== id) return;
  const p = project.value;
  renamingId.value = '';
  if (!p) return;
  const trimmed = renameDraft.value.trim();
  const prev = p.layers.find((l) => l.id === id);
  if (!trimmed || !prev || trimmed === prev.name) return;
  commitStackChange('重命名图层', renameLayer(p.layers, id, trimmed));
}

function onMoveOrder(id: string, direction: 'up' | 'down') {
  const p = project.value;
  if (!p) return;
  const idx = p.layers.findIndex((l) => l.id === id);
  const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
  if (idx < 0 || targetIdx < 0 || targetIdx >= p.layers.length) return;
  commitStackChange('调整图层顺序', reorderLayer(p.layers, id, p.layers[targetIdx].id));
}

function onDragStart(e: DragEvent, id: string) {
  draggingLayerId.value = id;
  e.dataTransfer?.setData('text/plain', id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e: DragEvent, id: string) {
  e.preventDefault();
  dragOverLayerId.value = draggingLayerId.value && draggingLayerId.value !== id ? id : '';
}

function onDrop(e: DragEvent, targetId: string) {
  e.preventDefault();
  const fromId = draggingLayerId.value || e.dataTransfer?.getData('text/plain') || '';
  draggingLayerId.value = '';
  dragOverLayerId.value = '';
  const p = project.value;
  if (!p || !fromId || fromId === targetId) return;
  commitStackChange('拖拽调整层序', reorderLayer(p.layers, fromId, targetId));
}

function onDragEnd() {
  draggingLayerId.value = '';
  dragOverLayerId.value = '';
}

function onDuplicate(id: string) {
  const p = project.value;
  if (!p) return;
  try {
    const { layers, created } = duplicateLayer(p.layers, id);
    commitStackChange('复制图层', layers, created.id);
    note.value = `已复制「${created.name}」`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function onMergeDown(id: string) {
  const p = project.value;
  if (!p) return;
  try {
    const { layers, merged } = mergeDownLayer(p.layers, id);
    commitStackChange('向下合并图层', layers, merged.id);
    note.value = `已合并到「${merged.name}」`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function onDelete(id: string) {
  const p = project.value;
  if (!p) return;
  try {
    const nextLayers = deleteLayer(p.layers, id);
    const layer = p.layers.find(l => l.id === id);
    const candidateId = layer?.candidateId;
    const rejection: RejectionChange | undefined = candidateId && !layer.archived ? {
      reason: 'deleted_layer',
      items: [{ id: candidateId, name: layer.name, preview: { width: layer.width, height: layer.height, data: layer.pixels } }],
    } : undefined;
    commitStackChange('删除图层', nextLayers, undefined, { rejection });
    note.value = '已删除图层';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function downloadSingleLayer(layer: StackLayer) {
  download(
    png({ width: layer.width, height: layer.height, data: layer.pixels }),
    `${layer.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'layer'}.png`,
  );
}

// ── 直接画布精修（橡皮 / 刷回原图 / 偏移 / 框选与套索切分 / 一键对色）────────

function onCanvasBrush(brushMode: 'erase' | 'restore', points: { x: number; y: number }[]) {
  const p = project.value;
  const targetId = soloLayerId.value || activeLayerId.value;
  if (!p || !targetId) return;
  const idx = p.layers.findIndex((l) => l.id === targetId);
  if (idx < 0) return;
  const layer = p.layers[idx];
  if (layer.locked) {
    error.value = '该图层已锁定，请先解锁再涂画';
    return;
  }
  const updated = applyBrushStroke(
    layer,
    p.reference,
    brushMode,
    points,
    brushDiameter.value,
    brushHardness.value,
  );
  const nextLayers = p.layers.slice();
  if (updated) {
    nextLayers[idx] = updated;
    commitStackChange(brushMode === 'erase' ? '橡皮擦除' : '刷回原图', nextLayers, updated.id);
  } else {
    nextLayers.splice(idx, 1);
    commitStackChange('擦空图层', nextLayers);
  }
}

function onCanvasSmudge(points: { x: number; y: number }[]) {
  const p = project.value;
  const targetId = soloLayerId.value || activeLayerId.value;
  if (!p || !targetId) return;
  const idx = p.layers.findIndex((l) => l.id === targetId);
  if (idx < 0) return;
  const layer = p.layers[idx];
  if (layer.locked) {
    error.value = '该图层已锁定，请先解锁再涂抹';
    return;
  }
  const updated = applySmudgeStroke(
    layer,
    p.reference,
    points,
    brushDiameter.value,
    smudgeStrength.value,
  );
  if (updated === layer) return;
  const nextLayers = p.layers.slice();
  if (updated) {
    nextLayers[idx] = updated;
    commitStackChange('涂抹拽边', nextLayers, updated.id);
  } else {
    nextLayers.splice(idx, 1);
    commitStackChange('涂抹拽边', nextLayers);
  }
}

function onCanvasOffset(layerId: string, dx: number, dy: number) {
  const p = project.value;
  if (!p || (!dx && !dy)) return;
  commitStackChange('移动图层偏移', offsetLayer(p.layers, layerId, dx, dy), layerId);
}

const splitForm = shallowRef<HTMLElement>();
async function updateTodo(projectId: string, id: string, patch: Partial<Pick<LayerTodo, 'done' | 'layerId'>>) {
  const p = project.value;
  if (p?.id !== projectId || busy.value || !p.todos?.some((t) => t.id === id)) return;
  if (patch.layerId && !p.layers.some((l) => l.id === patch.layerId && !l.archived)) return;
  queueSave({ ...p, todos: p.todos.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  if (!(await settled())) ui.toast(saveError.value || '待办保存失败', 'err');
}
async function useTodo(projectId: string, todoId: string, target: 'master' | 'region' | 'layers') {
  const p = project.value;
  const todo = p?.todos?.find((t) => t.id === todoId);
  if (p?.id !== projectId || !todo || busy.value) return;
  const parent = todo.parent ? p.todos?.find((t) => t.id === todo.parent) : todo;
  const id = parent?.layerId;
  if (target === 'layers' && !p.layers.some((l) => l.id === id && !l.archived)) {
    ui.toast('请先绑定对应图层，或用母版框细拆', 'err');
    return;
  }
  const key = target === 'layers' ? JSON.stringify([id]) : target;
  const groupPreset = target !== 'master' && !todo.parent;
  const prompt = groupPreset ? (todo.subPrompt ?? todo.prompt) : todo.prompt;
  const max = groupPreset ? (todo.subMax ?? todo.max) : todo.max;
  const prior =
    key === formKey.value && mode.value === 'stack'
      ? decomposePrompt.value
      : key === 'master'
        ? p.decomposePrompt
        : p.subForms?.[key]?.prompt;
  if (
    prior &&
    prior !== prompt &&
    !(await ui.confirm({
      title: '替换当前拆层说明？',
      message: prior + '\n→\n' + prompt,
      confirmLabel: '使用备忘预设',
    }))
  )
    return;
  const now = project.value;
  if (now?.id !== p.id || busy.value || now.todos?.find((t) => t.id === todoId) !== todo) return;
  if (target === 'layers' && (!now.layers.some((l) => l.id === id && !l.archived) ||
      now.todos?.find((t) => t.id === parent?.id)?.layerId !== id)) return;
  mode.value = 'stack';
  if (target === 'layers' && id) selectLayer(id);
  focusSplit(target, target === 'layers' && id ? [id] : []);
  decomposePrompt.value = prompt;
  if (max) {
    decomposeMax.value = max;
    decomposeUnlimited.value = false;
  }
  syncFields();
  emit('locateForm');
  await nextTick();
  splitForm.value?.focus({ preventScroll: true });
  splitForm.value?.scrollIntoView({ block: 'nearest' });
}

function clearPendingSelection() {
  pendingRect.value = undefined;
  pendingLasso.value = undefined;
  canvasRef.value?.clearSelection();
}

function executeSplitSelection() {
  const p = project.value;
  const targetId = soloLayerId.value || activeLayerId.value;
  if (!p || !targetId) {
    error.value = '请先在图层栈中选择要切分的图层';
    return;
  }
  try {
    const res = pendingRect.value
      ? splitLayerByRect(p.layers, targetId, pendingRect.value)
      : pendingLasso.value
        ? splitLayerByLasso(p.layers, targetId, pendingLasso.value)
        : undefined;
    if (!res) return;
    commitStackChange('切分为新图层', res.layers, res.created.id);
    clearPendingSelection();
    note.value = `已拆分为独立图层「${res.created.name}」`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function onAlignTone(strength?: number) {
  const p = project.value;
  const layer = activeLayer.value;
  if (!p || !layer) return;
  try {
    const aligned = applyLayerToneMatch(layer, p.reference, strength);
    const nextLayers = p.layers.map((l) => (l.id === layer.id ? aligned : l));
    commitStackChange('色彩对齐原画', nextLayers, aligned.id);
    note.value = `已按原画重合区对齐「${aligned.name}」色阶（强度 ${Math.round((aligned.toneMatch?.strength ?? 1) * 100)}%）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function onRestoreUnoccludedMaster() {
  const p = project.value;
  const layer = activeLayer.value;
  if (!p || !layer) return;
  try {
    const res = restoreLayerUnoccludedMaster(p.layers, layer.id, p.reference);
    if (!res.restoredPixels) {
      note.value = `「${layer.name}」可见区无须还原或已被前景遮挡`;
      return;
    }
    const nextLayers = p.layers.map((l) => (l.id === layer.id ? res.layer : l));
    commitStackChange('可见区还原原画', nextLayers, res.layer.id);
    note.value = `已无损还原「${res.layer.name}」可见区原画（约 ${Math.round(res.restoredRatio * 100)}% 像素恢复母版 1:1 锐度）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function onRestoreAllMaster() {
  const p = project.value;
  if (!p) return;
  try {
    const res = restoreAllLayersUnoccludedMaster(p.layers, p.reference);
    if (!res.updatedCount) {
      note.value = '当前可见图层均无需还原原画';
      return;
    }
    commitStackChange('全栈可见区还原原画', res.layers, activeLayerId.value);
    note.value = `已对 ${res.updatedCount} 个可见图层完成无损原画锐化（被前景遮挡的补画区均已保留）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

const upscaledLayerCount = computed(
  () =>
    project.value?.layers.filter(
      (l) => layerVisible(l) && !l.locked && (l.rawScale ?? 1) > 1.15 && !l.masterRestored,
    ).length ?? 0,
);

const transformBox = ref<Rect>({ x: 0, y: 0, width: 1, height: 1 });
const transformLockAspect = ref(true);
const transformGhostRef = ref(true);
const transformOpacity = ref(0.7);
const transformDraft = ref<Rect | undefined>(undefined);

watch(
  activeLayer,
  (layer) => {
    if (!layer) {
      transformDraft.value = undefined;
      if (stackTool.value === 'transform') stackTool.value = 'move';
      return;
    }
    transformBox.value = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    if (stackTool.value === 'transform') {
      if (layer.locked || layer.archived) {
        transformDraft.value = undefined;
        stackTool.value = 'move';
      } else {
        transformDraft.value = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
      }
    }
  },
  { immediate: true },
);

watch(stackTool, (tool) => {
  if (tool !== 'transform') transformDraft.value = undefined;
});

function enterTransformMode() {
  const layer = activeLayer.value;
  if (!layer || layer.locked || layer.archived) {
    error.value = '请先选中一个未锁定且未归档的图层';
    return;
  }
  clearPendingSelection();
  compareReference.value = false;
  poolStageActive.value = false;
  const rect = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  transformDraft.value = rect;
  transformBox.value = { ...rect };
  stackTool.value = 'transform';
}

function exitTransformMode() {
  transformDraft.value = undefined;
  const layer = activeLayer.value;
  if (layer) transformBox.value = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  if (stackTool.value === 'transform') stackTool.value = 'move';
}

function onTransformDraftChange(rect: Rect) {
  transformDraft.value = rect;
  transformBox.value = { ...rect };
}

function commitTransformDraft() {
  const layer = activeLayer.value;
  const draft = transformDraft.value;
  if (!layer || !draft) {
    exitTransformMode();
    return;
  }
  if (
    draft.x === layer.x &&
    draft.y === layer.y &&
    draft.width === layer.width &&
    draft.height === layer.height
  ) {
    exitTransformMode();
    return;
  }
  applyLayerTransform({ ...draft }, '缩放对齐图层');
  exitTransformMode();
}

function onTransformDimension(axis: 'width' | 'height', raw: number) {
  const layer = activeLayer.value;
  if (!layer || !Number.isFinite(raw) || raw < 1) return;
  const v = Math.round(raw);
  let next: Rect;
  if (!transformLockAspect.value) {
    next = { ...transformBox.value, [axis]: v };
  } else {
    const ratio = layer.width / Math.max(1, layer.height);
    next =
      axis === 'width'
        ? { ...transformBox.value, width: v, height: Math.max(1, Math.round(v / ratio)) }
        : { ...transformBox.value, height: v, width: Math.max(1, Math.round(v * ratio)) };
  }
  transformBox.value = next;
  if (stackTool.value === 'transform') transformDraft.value = { ...next };
}

function onTransformCoord(axis: 'x' | 'y', raw: number) {
  if (!Number.isFinite(raw)) return;
  const next = { ...transformBox.value, [axis]: Math.round(raw) };
  transformBox.value = next;
  if (stackTool.value === 'transform') transformDraft.value = { ...next };
}

function applyLayerTransform(targetRect: Rect, label = '调整位置与尺寸') {
  const p = project.value;
  const layer = activeLayer.value;
  if (!p || !layer) return;
  const { x, y, width, height } = targetRect;
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width * height > 32_000_000) {
    error.value = '请输入有效整数坐标与尺寸（面积不超过 3200 万像素）';
    return;
  }
  try {
    const src: Raster = { width: layer.width, height: layer.height, data: layer.pixels };
    const resized =
      width === layer.width && height === layer.height
        ? src
        : placeOnCanvas(src, { x: 0, y: 0, width, height }, width, height);
    const nextLayers = transformLayer(p.layers, layer.id, { x, y, width, height }, resized.data);
    commitStackChange(label, nextLayers, layer.id);
    note.value = `已更新「${layer.name}」位置与尺寸（${width}×${height}）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function fitLayerToCanvas() {
  const p = project.value;
  const layer = activeLayer.value;
  if (!p || !layer) return;
  const scale = Math.min(p.reference.width / layer.width, p.reference.height / layer.height);
  const width = Math.max(1, Math.round(layer.width * scale));
  const height = Math.max(1, Math.round(layer.height * scale));
  const x = Math.floor((p.reference.width - width) / 2);
  const y = Math.floor((p.reference.height - height) / 2);
  const rect = { x, y, width, height };
  if (stackTool.value === 'transform') {
    transformDraft.value = rect;
    transformBox.value = { ...rect };
    return;
  }
  applyLayerTransform(rect, '等比适配画布');
}

function onAutoAlignLayer() {
  const p = project.value;
  const layer = activeLayer.value;
  if (!p || !layer) return;
  try {
    const src: Raster = { width: layer.width, height: layer.height, data: layer.pixels };
    const alignment = alignRasterToReference(src, p.reference);
    if (!alignment.matched) {
      error.value = `未在原图中找到「${layer.name}」的清晰匹配区域（匹配度 ${Math.round(alignment.confidence * 100)}%），可展开下方「调整位置与尺寸」手动缩放`;
      return;
    }
    const tight = crop(src, alignment.sourceBox);
    const { x, y, width, height } = alignment.rect;
    const resized =
      width === tight.width && height === tight.height
        ? tight
        : placeOnCanvas(tight, { x: 0, y: 0, width, height }, width, height);
    const nextLayers = transformLayer(p.layers, layer.id, { x, y, width, height }, resized.data);
    commitStackChange('自动对齐原图', nextLayers, layer.id);
    note.value = `已自动对齐「${layer.name}」（匹配度 ${Math.round(alignment.confidence * 100)}%）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

// ── 局部补画（Tier-2 Local Component Completion）──────────────────────────────

function onGuideStroke(
  channel: GuideChannel,
  channelData: Uint8Array,
  action: 'draw' | 'erase',
  area: Rect,
  stamp: Uint8Array | undefined,
  strokeDiameter: number,
) {
  const p = project.value;
  if (!p) return;
  let nextAlpha = channel === 'alpha' ? channelData : p.alpha;
  let nextOccluded = channel === 'occluded' ? channelData : p.occluded;
  let nextGuides = p.guides;
  let dirty = area;

  if (stamp && channel === 'alpha' && smartSnap.value) {
    const snapped = snapStroke(p, stamp, area, strokeDiameter, action === 'erase');
    if (snapped.alpha === p.alpha) return;
    nextAlpha = snapped.alpha;
    nextGuides = snapped.guides;
    dirty = snapped.area;
  }

  const nextState = recordGuide(
    {
      width: p.reference.width,
      height: p.reference.height,
      alpha: p.alpha,
      occluded: p.occluded,
      guides: p.guides,
      history: guideHistory.value,
    },
    channel,
    channel === 'alpha' ? nextAlpha : (nextOccluded ?? channelData),
    action,
    dirty,
    nextGuides,
  );
  guideHistory.value = nextState.history;
  queueSave({
    ...p,
    alpha: nextState.alpha,
    occluded: nextState.occluded,
    guides: nextState.guides,
  });
}

function clearScalpelGuides() {
  const p = project.value;
  if (!p) return;
  const empty = new Uint8Array(p.reference.width * p.reference.height);
  guideHistory.value = undefined;
  queueSave({ ...p, alpha: empty, occluded: undefined, guides: undefined });
  note.value = '已清空选区';
}

function toggleOccluder(id: string) {
  if (project.value?.scalpelReferences?.some(r => r.picture === layerPictureId(id))) return;
  if (scalpelOccluderIds.value.includes(id)) {
    scalpelOccluderIds.value = scalpelOccluderIds.value.filter((x) => x !== id);
  } else {
    scalpelOccluderIds.value = [...scalpelOccluderIds.value, id];
  }
  syncFields();
}

async function importScalpelFiles(files: File[]) {
  const id = project.value?.id;
  await runTask(async () => {
    const imported = [];
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error(`「${file.name}」需要 PNG、JPEG 或 WebP 格式`);
      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      const image = await createImageBitmap(blob).catch(() => { throw new Error(`无法读取参考图「${file.name}」`); });
      imported.push({ id: crypto.randomUUID(), name: file.name, width: image.width, height: image.height, blob });
      image.close();
    }
    const p = project.value;
    if (!p || p.id !== id) return;
    queueSave({ ...p, referenceFiles: [...(p.referenceFiles ?? []), ...imported], scalpelReferences: [
      ...(p.scalpelReferences ?? []), ...imported.map(f => ({ picture: filePictureId(f.id), usage: '' })),
    ] });
  });
}
function removeScalpelReference(source: ReferenceSource) {
  const p = project.value;
  if (!p) return;
  queueSave({ ...p, scalpelReferences: p.scalpelReferences?.filter(r => r.picture !== source.picture),
    referenceFiles: p.referenceFiles?.filter(f => filePictureId(f.id) !== source.picture) });
}

async function runTargetedReroll() {
  const p = project.value;
  const model = chosenRerollModel.value;
  if (!p || !model) {
    error.value = '请先在设置中配置支持图像编辑的模型';
    return;
  }
  if (!hasScalpelGuide.value) {
    error.value = '请先涂抹需要局部补画的区域';
    return;
  }
  await runTask(async () => {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    activeRequest.value = 'reroll';
    progress.value = '正在提交局部补画请求…';
    const currentProject: LayerProject = {
      ...p,
      scalpelName: scalpelName.value,
      scalpelInstruction: scalpelInstruction.value,
      scalpelOccluderIds: [...scalpelOccluderIds.value],
      rerollModel: rerollModelId.value || undefined,
    };
    const occluders = currentProject.layers.filter((l) => scalpelOccluderIds.value.includes(l.id));
    const candidate = await requestTargetedReroll(
      services,
      currentProject,
      model,
      occluders,
      request.signal,
      (msg) => {
        progress.value = msg;
      },
      scalpelFraming.value,
    );
    request.signal.throwIfAborted();
    if (project.value?.id !== p.id) return;
    rerollCandidates.value = [...rerollCandidates.value, candidate];
    activeCandidateId.value = candidate.id;
    compareReference.value = false;
    queueSave({
      ...project.value,
      generationRounds: addGeneration(project.value, {
        source: 'scalpel', target: currentProject.scalpelName.trim() || '局部补画', model: candidate.model,
        candidateIds: [candidate.id],
      }),
    });
    note.value = `已生成候选 #${rerollCandidates.value.length}（${candidate.model} · ${candidate.transparent ? '原生透明底' : '不透明回图'}）`;
  });
}

function alignActiveCandidate() {
  const p = project.value;
  const cand = activeCandidate.value;
  if (!p || !cand || busy.value) return;
  const variant = candidateVariant(cand);
  const alignment = alignRasterToReference(variant.raster, p.reference);
  if (!alignment.matched) {
    error.value = `未在原图中找到清晰匹配位置（匹配度 ${Math.round(alignment.confidence * 100)}%），可收纳后用「缩放对齐 (T)」手动微调`;
    return;
  }
  const tight = crop(variant.raster, alignment.sourceBox);
  const alignedCanvas = placeOnCanvas(
    tight,
    alignment.rect,
    p.reference.width,
    p.reference.height,
  );
  const alignedBox = alphaBounds(alignedCanvas) ?? alignment.rect;
  const alignedPreview = crop(alignedCanvas, alignedBox);
  const updated: RerollCandidate =
    rerollResultMode.value === 'overlay' && cand.overlayRaster
      ? { ...cand, overlayRaster: alignedCanvas, overlayPreview: alignedPreview, overlayBox: alignedBox }
      : { ...cand, raster: alignedCanvas, preview: alignedPreview, box: alignedBox };
  rerollCandidates.value = rerollCandidates.value.map((c) => (c.id === cand.id ? updated : c));
  note.value = `已按原图自动对齐当前候选（匹配度 ${Math.round(alignment.confidence * 100)}%）`;
}

function discardActiveCandidate() {
  const p = project.value, candidate = activeCandidate.value;
  if (!p || !candidate || busy.value) return;
  const round = p.generationRounds?.find(r => r.candidateIds.includes(candidate.id));
  const variant = candidateVariant(candidate);
  const rejection: RejectionChange | undefined = p.layers.some(l => l.candidateId === candidate.id) ? undefined : {
    reason: 'discarded_candidate',
    items: [{ id: candidate.id, name: round?.target ?? '局部补画', preview: variant.preview }],
  };
  const generationRounds = changeRejections(p.generationRounds, rejection);
  rerollCandidates.value = rerollCandidates.value.filter(c => c.id !== candidate.id);
  activeCandidateId.value = rerollCandidates.value.at(-1)?.id ?? '';
  queueSave({ ...p, generationRounds });
  note.value = round ? '已移除当前候选' : '已移除当前候选，本次补画在 ASK 的三轮记录范围外';
}

function admitActiveCandidate() {
  const p = project.value;
  const cand = activeCandidate.value;
  if (!p || !cand) return;
  const variant = candidateVariant(cand);
  const rawScale =
    Math.round(
      Math.max(
        cand.resolution.frameWidth / Math.max(1, cand.resolution.width),
        cand.resolution.frameHeight / Math.max(1, cand.resolution.height),
      ) * 100,
    ) / 100;
  const poolItem: PoolLayer = {
    id: cand.id,
    name: scalpelName.value.trim() || `补画部件 #${p.layers.length + 1}`,
    preview: variant.preview,
    raster: variant.raster,
    box: variant.box,
    zIndex: p.layers.length,
    isBase: false,
    width: cand.resolution.width,
    height: cand.resolution.height,
    rawScale,
    source: 'reroll',
  };
  try {
    const next = admitPoolLayers(p, [poolItem]);
    commitStackChange(`收纳「${poolItem.name}」`, next.layers, next.activeLayerId);
    activeCandidateId.value = '';
    mode.value = 'stack';
    stackTool.value = 'move';
    note.value = `已将「${poolItem.name}」收纳进正式图层栈`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

// ── Undo / Redo & Keyboard Shortcuts ─────────────────────────────────────────

async function undoRedo(direction: 'undo' | 'redo') {
  const p = project.value;
  if (!p || busy.value) return;
  canvasRef.value?.cancelStroke();
  if (mode.value === 'stack') {
    const cur = stackHistory.value;
    const nextIdx = cur.index + (direction === 'undo' ? -1 : 1);
    const snap = cur.entries[nextIdx];
    if (!snap) return;
    if (direction === 'undo' && cur.entries[cur.index]?.confirmUndo) {
      const confirmed = await ui.confirm({
        title: '撤回本次 Photopea 精修？',
        message: '将恢复到进入 Photopea 之前的图层与分组状态。',
        confirmLabel: '撤回',
      });
      if (!confirmed) return;
      if (project.value?.id !== p.id || stackHistory.value !== cur) return;
    }
    stackHistory.value = { entries: cur.entries, index: nextIdx };
    activeLayerId.value = snap.activeLayerId ?? snap.layers.at(-1)?.id ?? '';
    recentChanges.value = {};
    if (soloLayerId.value && !snap.layers.some((l) => l.id === soloLayerId.value)) {
      soloLayerId.value = '';
    }
    if (soloGroupKey.value) {
      const prefix = soloGroupKey.value.split('\0');
      if (!snap.layers.some((l) => layerInGroup(l, prefix))) soloGroupKey.value = '';
    }
    const entry = cur.entries[direction === 'undo' ? cur.index : nextIdx];
    const change = entry.poolChange;
    const expected = direction === 'undo' ? change?.after : change?.before;
    const restored = direction === 'undo' ? change?.before : change?.after;
    let otherSplits = p.otherSplits;
    if (entry.poolOrderChange) {
      const { batchId, before, after } = entry.poolOrderChange;
      const order = direction === 'undo' ? before : after;
      if (poolBatch.value?.id === batchId) {
        poolBatch.value = { ...poolBatch.value, order };
        poolStageActive.value = true;
        compareReference.value = false;
      } else {
        otherSplits = otherSplits?.map(s => s.batch.id === batchId ? { ...s, batch: { ...s.batch, order } } : s);
      }
    }
    if (change) {
      if (poolBatch.value?.id === expected?.batch.id) showPool(restored);
      else {
        otherSplits = (otherSplits ?? []).filter(
          (s) => s.batch.id !== expected?.batch.id && s.batch.id !== restored?.batch.id,
        );
        if (restored) otherSplits = [...otherSplits, restored];
      }
    }
    queueSave({
      ...project.value!,
      layers: snap.layers,
      generationRounds: stackRejections(p, snap.layers, entry.rejection, direction === 'undo'),
      pendingSplit: poolState(),
      otherSplits,
      activeLayerId: activeLayerId.value || undefined,
    });
    note.value = `${direction === 'undo' ? '已撤销' : '已重做'}：${snap.label}`;
  } else {
    if (!guideHistory.value) return;
    const nextState = travelGuide(
      {
        width: p.reference.width,
        height: p.reference.height,
        alpha: p.alpha,
        occluded: p.occluded,
        guides: p.guides,
        history: guideHistory.value,
      },
      direction,
    );
    guideHistory.value = nextState.history;
    queueSave({
      ...p,
      alpha: nextState.alpha,
      occluded: nextState.occluded,
      guides: nextState.guides,
    });
    note.value = direction === 'undo' ? '已撤销选区画笔' : '已重做选区画笔';
  }
}

function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undoRedo(e.shiftKey ? 'redo' : 'undo');
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    undoRedo('redo');
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '\\') {
    compareReference.value = !compareReference.value;
    return;
  }
  if (k === 'escape') {
    if (stackTool.value === 'transform') exitTransformMode();
    else if (hasPendingSelection.value) clearPendingSelection();
    else if (soloLayerId.value) soloLayerId.value = '';
    else if (soloGroupKey.value) soloGroupKey.value = '';
    else if (poolSoloId.value) poolSoloId.value = '';
    else if (activeCandidateId.value) activeCandidateId.value = '';
    return;
  }
  if (mode.value === 'stack' && stackTool.value === 'transform' && transformDraft.value) {
    if (k === 'enter') {
      e.preventDefault();
      commitTransformDraft();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    if (k === 'arrowleft') {
      e.preventDefault();
      onTransformDraftChange({ ...transformDraft.value, x: transformDraft.value.x - step });
      return;
    }
    if (k === 'arrowright') {
      e.preventDefault();
      onTransformDraftChange({ ...transformDraft.value, x: transformDraft.value.x + step });
      return;
    }
    if (k === 'arrowup') {
      e.preventDefault();
      onTransformDraftChange({ ...transformDraft.value, y: transformDraft.value.y - step });
      return;
    }
    if (k === 'arrowdown') {
      e.preventDefault();
      onTransformDraftChange({ ...transformDraft.value, y: transformDraft.value.y + step });
      return;
    }
  }
  if (mode.value === 'stack') {
    if (k === 'v') stackTool.value = 'move';
    else if (k === 't') enterTransformMode();
    else if (k === 'e') stackTool.value = 'erase';
    else if (k === 'r') stackTool.value = 'restore';
    else if (k === 's') stackTool.value = 'smudge';
    else if (k === 'm') stackTool.value = 'rect';
    else if (k === 'l') stackTool.value = 'lasso';
  }
}

// ── 导出（Koma Rig Slices v2 & Layered PSD 8BPS）─────────────────────────────

async function exportRigZip() {
  const p = project.value;
  if (!p) return;
  await runTask(async () => {
    const files = packageFiles(p);
    const zip = await createArchive(files);
    const base = p.title.replace(/\.[^.]+$/, '') || 'koma-layer';
    download(zip, `${base}-rig-slices.zip`);
    note.value = `已导出 ${visibleLayerCount.value} 层 Koma Rig 切片包（ZIP）`;
  }, true);
}

async function exportRigFolder() {
  const p = project.value;
  if (!p || !picker) return;
  await runTask(async () => {
    const files = packageFiles(p);
    try {
      const dir = await picker({ mode: 'readwrite', id: 'koma-layer' });
      const folder = await writePackage(dir, files);
      note.value = `已导出 Koma Rig 切片目录：${folder}`;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) throw e;
    }
  }, true);
}

async function exportPsd() {
  const p = project.value;
  if (!p) return;
  await runTask(async () => {
    const psd = layeredPsd(p);
    const base = p.title.replace(/\.[^.]+$/, '') || 'koma-layer';
    download(psd, `${base}.psd`);
    note.value = `已导出分层 PSD（含 ${p.layers.length} 个正式图层与锁定原图）`;
  }, true);
}

function stopCurrent() {
  controller?.abort();
  controller = undefined;
  progress.value = '';
  note.value = '已取消当前生成';
}

function protectUnsaved(event: BeforeUnloadEvent) {
  if (writing || saveError.value) {
    event.preventDefault();
    event.returnValue = true;
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', protectUnsaved);
  detachPlanning = attachLayer({
    read() {
      const p = project.value;
      if (!p) return;
      const focus = mode.value === 'scalpel' ? 'scalpel' : formKey.value;
      const ctx = layerContext(
        p,
        mode.value === 'scalpel' ? '局部补画' : scope.value,
        focus,
        pendingRect.value,
        chosenRerollModel.value && { name: chosenRerollModel.value.name, maxImages: chosenRerollModel.value.maxImages },
      );
      ctx.forms[focus] = {
        prompt: focus === 'scalpel' ? scalpelInstruction.value : decomposePrompt.value,
        max: focus === 'scalpel' ? 12 : decomposeMax.value,
        unlimited: focus === 'scalpel' ? false : decomposeUnlimited.value,
      };
      return ctx;
    },
    picture: () => masterPicture.value,
    referencePictures: () => project.value && referencePictures(project.value),
    rejectionPictures: () => project.value && rejectionPictures(project.value),
    checklist() {
      const p = project.value;
      if (!p?.todos?.length) return;
      return {
        projectId: p.id,
        title: p.title,
        todos: p.todos,
        busy: busy.value,
        layers: reversedLayers.value.filter(l => !l.archived).map(l => ({
          id: l.id, name: [...(l.groups ?? []), l.name].join(' / '),
        })),
      };
    },
    updateTodo,
    useTodo,
    async write(patch, undo) {
      if (busy.value || !project.value) throw new Error('请等待分件操作完成');
      busy.value = true;
      try {
        if (!(await settled())) throw new Error(saveError.value || '分件草稿保存失败');
        const stored = await store.save(applyLayerEdits(project.value, patch, undo, chosenRerollModel.value));
        project.value = committed = stored;
      } finally { busy.value = false; }
      loadForm(project.value);
      scalpelInstruction.value = project.value.scalpelInstruction;
      const names = patch.edits.filter((e) => e.kind === 'name');
      if (names.length) {
        const cur = stackHistory.value;
        stackHistory.value = {
          ...cur,
          entries: cur.entries.map((s) => ({
            ...s,
            layers: s.layers.map((l) => {
              const e = names.find((n) => n.key === l.id && n[undo ? 'after' : 'before'] === l.name);
              return e ? { ...l, name: e[undo ? 'before' : 'after'] } : l;
            }),
          })),
        };
      }
    },
  });
  runTask(async () => {
    saved.value = await store.list();
    if (props.sourceKey?.startsWith('layer:')) await loadProject(props.sourceKey.split(':')[1]);
    else if (props.source) await start(props.source.blob, props.source.name, props.source.recordId);
    else if (saved.value.length) await loadProject(saved.value[0].id);
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', protectUnsaved);
  detachPlanning?.();
  controller?.abort();
});

async function readyToClose(): Promise<boolean> {
  if (await settled()) return true;
  return ui.confirm({ title: '放弃本页未保存的分件修改？', message: '可以返回工作台重试保存，或先导出已收纳图层的 PSD。', confirmLabel: '放弃修改并退出' });
}

function cancelStroke() {
  canvasRef.value?.cancelStroke();
}

defineExpose({ readyToClose, shortcut: onKeyDown, cancelStroke });
</script>

<template>
  <section class="layer-panel" aria-label="Koma Layer 分件工作台" :aria-busy="busy || saving">
    <header class="layer-heading">
      <span class="layer-brand-mark"><AppIcon name="i-layers" /></span>
      <h2>Koma Layer</h2>
      <button type="button" class="layer-exit" @click="emit('close')">
        <AppIcon name="i-close" />
        退出
      </button>
    </header>

    <input
      ref="referenceFile"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      aria-label="打开定稿"
      hidden
      @change="loadReferenceFile"
    />
    <input
      ref="importLayerInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      multiple
      aria-label="导入图像为图层"
      hidden
      @change="onImportLayerFiles"
    />

    <div v-if="!project" class="layer-first">
      <h3>导入定稿</h3>
      <p v-if="error" class="layer-message error" role="alert">{{ error }}</p>
      <p class="layer-help">导入平面立绘，拆分图层并导出切片包或分层 PSD。</p>
      <button type="button" class="layer-primary" :disabled="busy" @click="referenceFile?.click()">
        <AppIcon name="i-upload" />
        导入定稿图片
      </button>
    </div>

    <fieldset v-else class="layer-content" :disabled="busy && !activeRequest">
      <!-- Document Header -->
      <div class="layer-document">
        <LayerThumbnail :image="project.reference" :alt="project.title" />
        <div class="layer-document-name">
          <select
            v-if="saved.length > 1"
            aria-label="切换分件项目"
            :value="project.id"
            @change="switchProject(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in saved" :key="item.id" :value="item.id">
              {{ item.title }}
            </option>
          </select>
          <strong v-else>{{ project.title }}</strong>
          <small>{{ project.reference.width }} × {{ project.reference.height }}</small>
        </div>
        <button type="button" class="layer-mini" title="导入新定稿" @click="referenceFile?.click()">
          <AppIcon name="i-image-plus" />
          换图
        </button>
      </div>

      <!-- Optional opaque background hint (non-blocking) -->
      <div v-if="!transparent" class="layer-banner" role="note">
        <span>定稿无透明外缘，可直接拆层{{ backgroundAvailable ? '或先去底' : '' }}。</span>
        <button
          v-if="backgroundAvailable"
          type="button"
          class="layer-link"
          @click="emit('background', png(project.reference))"
        >
          <AppIcon name="i-dt-background" />
          先去底
        </button>
      </div>

      <button v-if="project.todos?.length" type="button" class="layer-link layer-todo-link" @click="emit('todos', project.id)">
        <AppIcon name="i-tasks" />在 ASK 查看拆件待办
        <small>{{ project.todos.filter((t) => t.done).length }}/{{ project.todos.length }}</small>
      </button>
      <button v-if="rejectedCount" type="button" class="layer-link layer-todo-link" @click="emit('reviewRejections')">
        <AppIcon name="i-ask" />让 ASK 查看淘汰图 <small>近三轮 · {{ rejectedCount }} 张</small>
      </button>
      <!-- Primary Workspace Mode Tabs -->
      <div class="layer-mode-tabs" role="tablist" aria-label="分件工作模式">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'stack'"
          @click="
            mode = 'stack';
            activeCandidateId = '';
          "
        >
          <AppIcon name="i-layers" />
          图层与拆层
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'scalpel'"
          @click="
            mode = 'scalpel';
            poolStageActive = false;
            clearPendingSelection();
          "
        >
          <AppIcon name="i-dt-wand" />
          局部补画
        </button>
      </div>

      <!-- Live Progress Banner -->
      <div v-if="progress || activeRequest" class="layer-live" role="status">
        <span>{{ progress || '正在生成…' }}</span>
        <button type="button" class="layer-mini" @click="stopCurrent">
          <AppIcon name="i-stop" />
          取消
        </button>
      </div>

      <!-- Error / Status Messages -->
      <p v-if="saveError || error" ref="errorBox" class="layer-message error" role="alert">
        <AppIcon name="i-alert" />
        <span>{{ saveError || error }}</span>
        <button v-if="saveError" type="button" class="layer-mini" :disabled="saving || busy" @click="retrySave">重试保存</button>
      </p>
      <p v-else-if="note" class="layer-message" role="status">
        <AppIcon name="i-success" />
        {{ note }}
      </p>

      <!-- ════════════════════ MODE 1: LAYER STACK & CANDIDATE POOL ════════════════════ -->
      <template v-if="mode === 'stack'">
        <!-- Auto Decompose -->
        <section ref="splitForm" class="layer-section" tabindex="-1" aria-label="自动拆层">
          <div class="layer-section-title">
            <h3>
              {{
                scope === 'master'
                  ? '全身总拆'
                  : scope === 'region'
                    ? '细拆 · 母版框选'
                    : '细拆 · ' +
                      project.layers
                        .filter((l) => sourceIds.includes(l.id))
                        .map((l) => l.name)
                        .join(' + ')
              }}
            </h3>
            <button
              v-if="poolBatch"
              type="button"
              class="layer-link"
              @click="decomposeConfigOpen = !decomposeConfigOpen"
            >
              {{ decomposeConfigOpen ? '收起参数' : '展开参数' }}
            </button>
            <small v-else-if="chosenDecomposeModel">{{ routeLabel(chosenDecomposeModel) }}</small>
          </div>

          <template v-if="decomposeConfigOpen || !poolBatch">
            <label v-if="decomposeModels.length > 1" class="layer-field">
              模型
              <select v-model="decomposeModelId" @change="syncFields">
                <option v-for="m in decomposeModels" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
            </label>

            <label class="layer-field">
              拆层说明
              <textarea
                v-model="decomposePrompt"
                rows="3"
                placeholder="从前向后编号，写出每件应补全的遮挡结构"
                @change="syncFields"
              ></textarea>
            </label>

            <button
              type="button"
              class="layer-link"
              @click="
                decomposePrompt =
                  scope === 'master'
                    ? macroPrompt
                    : partPrompt(
                        project.layers
                          .filter((l) => sourceIds.includes(l.id))
                          .map((l) => l.name)
                          .join(' + ') || '局部',
                      );
                syncFields();
              "
            >
              使用编号拆层模板
            </button>
            <div class="layer-slider">
              <div class="layer-slider-head">
                <label for="layerDecomposeMax">最多层数</label>
                <div class="layer-slider-right">
                  <output>{{ decomposeUnlimited ? '不限制' : decomposeMax }}</output>
                  <button
                    type="button"
                    class="layer-pill-toggle"
                    :aria-pressed="decomposeUnlimited"
                    @click="
                      decomposeUnlimited = !decomposeUnlimited;
                      syncFields();
                    "
                  >
                    不限制
                  </button>
                </div>
              </div>
              <input
                id="layerDecomposeMax"
                v-model.number="decomposeMax"
                type="range"
                min="2"
                max="99"
                step="1"
                :disabled="decomposeUnlimited"
                aria-label="最多拆出层数"
                @change="syncFields"
              />
            </div>

            <div class="layer-field">
              <span>输出分辨率</span>
              <div class="layer-result-mode layer-size-mode" role="group" aria-label="拆层输出分辨率">
                <button
                  v-for="opt in [
                    { value: '2K', label: '2K' },
                    { value: '1.5K', label: '1.5K' },
                    { value: '1K', label: '1K' },
                    { value: 'auto', label: '自动' },
                  ] as const"
                  :key="opt.value"
                  type="button"
                  :aria-pressed="decomposeSize === opt.value"
                  title="每层独立渲染目标分辨率；大面积图层建议选 2K 减少放大发虚"
                  @click="decomposeSize = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </template>

          <div class="layer-action-row">
            <button
              v-if="activeRequest === 'decompose'"
              type="button"
              class="layer-secondary layer-cancel-btn"
              @click="stopCurrent"
            >
              <AppIcon name="i-stop" />
              取消拆层
            </button>
            <button
              v-else
              type="button"
              class="layer-primary"
              :disabled="busy || !chosenDecomposeModel"
              @click="runDecompose()"
            >
              <AppIcon name="i-dt-wand" />
              {{ scope === 'master' ? (poolBatch ? '重新拆层' : '一键总拆') : '开始细拆' }}
            </button>
            <button
              type="button"
              class="layer-secondary"
              :disabled="busy || !chosenDecomposeModel || !activeLayer || !!activeLayer.archived"
              :title="activeLayer ? `细分「${activeLayer.name}」` : '请先选中一个图层'"
              @click="activeLayer && focusSplit('layers', [activeLayer.id])"
            >
              <AppIcon name="i-branch" />
              ↳ 继续细拆此件
            </button>
          </div>
          <div class="layer-pool-links">
            <button
              v-if="scope !== 'master'"
              type="button"
              class="layer-link"
              @click="focusSplit('master')"
            >
              返回全身总拆
            </button>
            <button type="button" class="layer-link" @click="focusSplit('region')">框选母版细拆</button>
            <span v-if="scope === 'region' && pendingRect"
              >位置 ({{ pendingRect.x }}, {{ pendingRect.y }}) · {{ pendingRect.width }} × {{ pendingRect.height }}</span
            >
          </div>
          <small v-if="!chosenDecomposeModel" class="layer-model-note">
            需在「设置 → 连接」配置 Seedream 5.5 原生连接。
          </small>
        </section>

        <select
          v-if="project.otherSplits?.length"
          aria-label="切换待筛批次"
          value=""
          @change="
            switchPool(($event.target as HTMLSelectElement).value);
            ($event.target as HTMLSelectElement).value = '';
          "
        >
          <option value="">其他待筛批次（{{ project.otherSplits.length }}）</option>
          <option
            v-for="(entry, i) in project.otherSplits"
            :key="entry.batch.id"
            :value="entry.batch.id"
          >
            {{ i + 1 }} · {{ entry.batch.targetName }} · {{ entry.batch.layers.length }} 层
          </option>
        </select>
        <!-- Candidate Pool -->
        <section v-if="poolBatch" class="layer-section layer-pool" aria-label="本次拆层候选池">
          <div class="layer-section-title">
            <h3>候选图层 ({{ poolBatch.layers.length }})</h3>
            <div class="layer-pool-links">
              <button type="button" class="layer-link" @click="toggleAllPoolVisible">
                {{ allPoolVisible ? '全隐' : '全显' }}
              </button>
              <button type="button" class="layer-link" @click="selectAllPool">全选</button>
              <button type="button" class="layer-link" :disabled="busy" title="淘汰本批剩余候选" @click="discardPool()">清空</button>
            </div>
          </div>

          <div v-if="project.layers.length" class="layer-pool-view-bar">
            <span>画布视图</span>
            <button
              type="button"
              class="layer-pill-toggle"
              :aria-pressed="poolStageActive"
              @click="
                poolStageActive = !poolStageActive;
                compareReference = false;
              "
            >
              {{ poolStageActive ? '返回图层栈' : '预览候选' }}
            </button>
          </div>

          <p v-if="poolBatch.sentSize || poolBatch.requestedSize" class="layer-pool-note">
            <span v-if="poolBatch.requestedSize">档位 {{ poolBatch.requestedSize === 'auto' ? '自动' : poolBatch.requestedSize }}</span>
            <span v-if="poolBatch.sentSize">
              · 送图 {{ poolBatch.sentSize.width }}×{{ poolBatch.sentSize.height }}
              <template v-if="poolBatch.inputDownscaled">（超 8MB 已压缩缩放）</template>
            </span>
          </p>

          <ul class="layer-pool-list" @dragleave="leavePool">
            <li
              v-for="(item, index) in poolFrontFirst"
              :key="item.id"
              class="layer-pool-item"
              :draggable="!busy && poolFrontFirst.length > 1"
              :data-drop-edge="poolDrag?.over === item.id && poolDrag.from !== item.id
                ? (poolOrder.indexOf(poolDrag.from) < poolOrder.indexOf(item.id) ? 'above' : 'below') : undefined"
              @dragstart.stop="startPoolDrag($event, item.id)"
              @dragover="overPoolRow($event, item.id)"
              @drop.stop="dropPoolRow($event, item.id)"
              @dragend="poolDrag = undefined"
              :data-checked="poolSelected.includes(item.id)"
              :data-visible="
                poolStageActive &&
                (poolSoloId ? poolSoloId === item.id : poolVisibleIds.includes(item.id))
              "
              :data-solo="poolStageActive && poolSoloId === item.id"
            >
              <input
                type="checkbox"
                :checked="poolSelected.includes(item.id)"
                :aria-label="`勾选候选层 ${item.name}`"
                @change="togglePoolSelect(item.id)"
              />
              <button
                type="button"
                class="layer-row-flag"
                :aria-pressed="poolSoloId ? poolSoloId === item.id : poolVisibleIds.includes(item.id)"
                :aria-label="`显隐候选层 ${item.name}`"
                title="显示 / 隐藏"
                @click="togglePoolVisible(item.id)"
              >
                <AppIcon
                  :name="
                    (poolSoloId ? poolSoloId === item.id : poolVisibleIds.includes(item.id))
                      ? 'i-eye'
                      : 'i-eye-off'
                  "
                />
              </button>
              <button
                type="button"
                class="layer-row-flag solo"
                :aria-pressed="poolStageActive && poolSoloId === item.id"
                :aria-label="`独显候选层 ${item.name}`"
                title="独显此层"
                @click="togglePoolSolo(item.id)"
              >
                S
              </button>
              <LayerThumbnail :image="item.preview" :alt="item.name" />
              <div
                class="layer-pool-meta"
                :title="item.description || item.name"
                @click="togglePoolSelect(item.id)"
              >
                <strong>{{ item.name }}</strong>
                <small>
                  {{ item.box.width }}×{{ item.box.height }} px
                  <span v-if="item.isBase" class="layer-badge">底图</span>
                  <span
                    v-if="item.rawScale && item.rawScale > 1.15"
                    class="layer-badge warn"
                    :title="`模型原始回图 ${item.width}×${item.height} px，落位放大 ${item.rawScale.toFixed(1)}×；收纳后可用「还原可见区原画」恢复母版清晰度`"
                  >
                    放大 {{ item.rawScale.toFixed(1) }}×
                  </span>
                </small>
              </div>
              <button type="button" class="layer-link" :disabled="busy" :aria-expanded="fittingId === item.id"
                :aria-label="`校准候选层 ${item.name}`" @click="fittingId = fittingId === item.id ? '' : item.id">
                {{ item.needsPosition ? '待定位' : '校准' }}
              </button>
              <div v-if="poolFrontFirst.length > 1" class="layer-pool-order" role="group" :aria-label="`${item.name} 层序`">
                <button type="button" class="layer-row-flag" title="上移一层" :aria-label="`上移候选层 ${item.name}`"
                  :disabled="busy || index === 0" @click="applyPoolOrder(item.id, poolFrontFirst[index - 1]?.id)"><AppIcon name="i-up" /></button>
                <button type="button" class="layer-row-flag" title="下移一层" :aria-label="`下移候选层 ${item.name}`"
                  :disabled="busy || index === poolFrontFirst.length - 1" @click="applyPoolOrder(item.id, poolFrontFirst[index + 1]?.id)"><AppIcon name="i-down" /></button>
              </div>
              <button type="button" class="layer-row-flag" :aria-label="`淘汰候选层 ${item.name}`"
                title="淘汰候选" :disabled="busy" @click="discardPool(item.id)"><AppIcon name="i-trash" /></button>
              <CandidateFit v-if="fittingId === item.id" :item="item" :masks="maskChoices" :busy="busy"
                @fit="adjustCandidate(item, { box: $event })" @clip="adjustCandidate(item, { maskId: $event })" />
            </li>
          </ul>

          <details
            v-if="
              poolBatch.source.kind === 'region' &&
              !project.layers.some((l) => l.batchId === poolBatch?.id)
            "
            class="layer-fold"
          >
            <summary>结果组名称与位置</summary>
            <label
              >组名<input
                :value="poolBatch.groupName ?? poolBatch.source.name"
                maxlength="120"
                @change="setRegionDestination('groupName', ($event.target as HTMLInputElement).value)"
            /></label>
            <label
              >插入位置<select
                :value="poolBatch.insertAbove ?? ''"
                @change="setRegionDestination('insertAbove', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">栈顶</option>
                <option v-for="l in reversedLayers.filter((l) => !l.archived)" :key="l.id" :value="l.id">
                  {{ l.name }} 上方
                </option>
              </select></label
            >
          </details>
          <label v-if="poolBatch.source.kind === 'layers'" class="layer-dock-check"
            ><input
              v-model="archiveSource"
              type="checkbox"
              @change="savePool"
            />原位建组并归档来源层（取消则仅添加）</label
          >
          <div class="layer-pool-footer">
            <button
              type="button"
              class="layer-primary"
              :disabled="!poolSelected.length"
              @click="admitSelectedPool"
            >
              <AppIcon name="i-check" />
              收纳进图层栈 ({{ poolSelected.length }})
            </button>
          </div>
        </section>

        <!-- Formal Layer Stack -->
        <section class="layer-section layer-stack" aria-label="正式图层栈">
          <div class="layer-section-title">
            <div class="layer-stack-head-left">
              <h3>图层栈</h3>
              <span class="layer-count">{{ project.layers.length }} 层</span>
              <button
                v-if="project.layers.length"
                type="button"
                class="layer-link"
                :aria-pressed="multiSelect"
                @click="
                  multiSelect = !multiSelect;
                  multiIds = [];
                "
              >
                多选
              </button>
              <button
                v-if="multiSelect && multiIds.length"
                type="button"
                class="layer-link"
                @click="
                  focusSplit('layers', [...multiIds]);
                  multiSelect = false;
                "
              >
                细拆所选 {{ multiIds.length }} 层
              </button>
            </div>
            <div class="layer-stack-head-actions">
              <button
                type="button"
                class="layer-mini"
                title="从本地导入 PNG / JPEG / WebP 为新图层（支持多选）"
                :disabled="busy"
                @click="importLayerInput?.click()"
              >
                <AppIcon name="i-image-plus" />
                导入图层
              </button>
              <button
                type="button"
                class="layer-mini layer-photopea-btn"
                title="在 Photopea 中打开当前分层文档进行精修、蒙版或分组整理"
                :disabled="busy"
                @click="openInPhotopea"
              >
                <PhotopeaIcon />
                Photopea 精修
              </button>
            </div>
          </div>

          <p v-if="!project.layers.length" class="layer-empty-hint">
            运行上方拆层、局部补画、导入图层或直接进入 Photopea 精修。
          </p>

          <template v-else>
            <!-- Selected Layer Operations Bar -->
            <div v-if="activeLayer" class="layer-stack-ops" role="toolbar" aria-label="当前图层操作">
              <button
                type="button"
                class="layer-icon-btn"
                title="上移一层"
                aria-label="上移一层"
                :disabled="activeLayerIndex >= project.layers.length - 1"
                @click="onMoveOrder(activeLayer.id, 'up')"
              >
                <AppIcon name="i-up" />
              </button>
              <button
                type="button"
                class="layer-icon-btn"
                title="下移一层"
                aria-label="下移一层"
                :disabled="activeLayerIndex <= 0"
                @click="onMoveOrder(activeLayer.id, 'down')"
              >
                <AppIcon name="i-down" />
              </button>
              <button
                type="button"
                class="layer-icon-btn"
                title="重命名"
                aria-label="重命名图层"
                @click="startRename(activeLayer)"
              >
                <AppIcon name="i-rename" />
              </button>
              <button
                type="button"
                class="layer-icon-btn"
                title="向下合并"
                aria-label="向下合并图层"
                :disabled="activeLayerIndex <= 0 || activeLayer.locked"
                @click="onMergeDown(activeLayer.id)"
              >
                <AppIcon name="i-layers" />
              </button>
              <button
                type="button"
                class="layer-icon-btn"
                title="复制图层"
                aria-label="复制图层"
                @click="onDuplicate(activeLayer.id)"
              >
                <AppIcon name="i-copy" />
              </button>
              <button
                type="button"
                class="layer-icon-btn"
                title="导出单层 PNG"
                aria-label="导出单层 PNG"
                @click="downloadSingleLayer(activeLayer)"
              >
                <AppIcon name="i-download" />
              </button>
              <button
                type="button"
                class="layer-icon-btn danger"
                title="删除图层"
                aria-label="删除图层"
                :disabled="activeLayer.locked"
                @click="onDelete(activeLayer.id)"
              >
                <AppIcon name="i-trash" />
              </button>
            </div>

            <!-- Draggable Stack Rows & Collapsible Groups (top-to-bottom Z-Order) -->
            <ul class="layer-stack-list" role="list">
              <template
                v-for="(entry, entryIndex) in stackDisplayItems"
                :key="entry.kind === 'group' ? `g:${entry.key}` : entry.layer.id"
              >
                <li
                  v-if="entry.kind === 'group'"
                  class="layer-group-row"
                  :data-hidden="!entry.visible"
                  :data-solo="entry.solo"
                  :data-collapsed="entry.collapsed"
                  :style="{ '--depth': entry.depth }"
                  @click="onToggleGroupCollapse(entry.key)"
                >
                  <button
                    type="button"
                    class="layer-row-flag"
                    :aria-pressed="entry.visible"
                    :aria-label="`显隐分组 ${entry.name}`"
                    title="显示 / 隐藏整组"
                    @click.stop="onToggleGroupVisible(entry.path)"
                  >
                    <AppIcon :name="entry.visible ? 'i-eye' : 'i-eye-off'" />
                  </button>
                  <button
                    type="button"
                    class="layer-row-flag solo"
                    :aria-pressed="entry.solo"
                    :aria-label="`独显分组 ${entry.name}`"
                    title="独显整组"
                    @click.stop="onToggleGroupSolo(entry.key)"
                  >
                    S
                  </button>
                  <span class="layer-group-chevron" aria-hidden="true">
                    <AppIcon name="i-chevron" />
                  </span>
                  <AppIcon name="i-folder" class="layer-group-folder" />
                  <input
                    v-if="renamingGroupKey === entry.key"
                    v-model="groupRenameDraft"
                    type="text"
                    class="layer-rename-input layer-group-rename-input"
                    aria-label="输入新分组名称"
                    @click.stop
                    @keydown.enter.prevent="commitRenameGroup(entry.key)"
                    @keydown.escape.prevent="renamingGroupKey = ''"
                    @blur="commitRenameGroup(entry.key)"
                  />
                  <strong
                    v-else
                    class="layer-group-name"
                    @dblclick.stop="startRenameGroup(entry.key, entry.path, entry.name)"
                  >
                    {{ entry.name }}
                  </strong>
                  <small class="layer-count">{{ entry.count }}</small>
                  <PopoverMenu
                    compact
                    pointer-focus="menu"
                    close-on-scroll="outside"
                    side="right"
                    :id="`layer-group-menu-${entryIndex}`"
                    :label="`分组操作 ${entry.name}`"
                    @click.stop
                  >
                    <template #trigger="{ open: shown, toggle }">
                      <button
                        type="button"
                        class="layer-row-flag"
                        :aria-label="`分组操作 ${entry.name}`"
                        aria-haspopup="menu"
                        :aria-expanded="shown"
                        title="分组操作"
                        @click.stop="toggle"
                      >
                        <AppIcon name="i-more" />
                      </button>
                    </template>
                    <template #default="{ close: dismiss }">
                      <button
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="
                          dismiss();
                          startRenameGroup(entry.key, entry.path, entry.name);
                        "
                      >
                        <AppIcon name="i-rename" />
                        <span class="menu-label">重命名分组</span>
                      </button>
                      <button
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="
                          dismiss();
                          onUngroup(entry.key, entry.path, entry.name);
                        "
                      >
                        <AppIcon name="i-layers" />
                        <span class="menu-label">解散分组</span>
                      </button>
                      <button
                        class="menu-item danger"
                        role="menuitem"
                        type="button"
                        @click="
                          dismiss();
                          onDeleteGroup(entry.key, entry.path, entry.name);
                        "
                      >
                        <AppIcon name="i-trash" />
                        <span class="menu-label">删除整组</span>
                      </button>
                    </template>
                  </PopoverMenu>
                </li>
                <li
                  v-else
                  class="layer-stack-row"
                  :data-active="entry.layer.id === activeLayerId"
                  :data-hidden="!layerVisible(entry.layer)"
                  :data-solo="soloLayerId === entry.layer.id"
                  :data-drag-over="dragOverLayerId === entry.layer.id"
                  :style="{ '--depth': entry.depth }"
                  :draggable="!multiSelect && !entry.layer.archived && !entry.layer.locked"
                  @click="selectLayer(entry.layer.id)"
                  @dragstart="onDragStart($event, entry.layer.id)"
                  @dragover="onDragOver($event, entry.layer.id)"
                  @drop="onDrop($event, entry.layer.id)"
                  @dragend="onDragEnd"
                >
                  <input
                    v-if="multiSelect && !entry.layer.archived"
                    v-model="multiIds"
                    type="checkbox"
                    :value="entry.layer.id"
                    :aria-label="'选择送拆 ' + entry.layer.name"
                    @click.stop
                  />
                  <button
                    type="button"
                    class="layer-row-flag"
                    :aria-pressed="layerVisible(entry.layer)"
                    :aria-label="`显隐 ${entry.layer.name}`"
                    title="显示 / 隐藏"
                    @click.stop="onToggleVisible(entry.layer.id)"
                  >
                    <AppIcon :name="layerVisible(entry.layer) ? 'i-eye' : 'i-eye-off'" />
                  </button>
                  <button
                    type="button"
                    class="layer-row-flag solo"
                    :aria-pressed="soloLayerId === entry.layer.id"
                    :aria-label="`独显 ${entry.layer.name}`"
                    title="独显此层"
                    @click.stop="onToggleSolo(entry.layer.id)"
                  >
                    S
                  </button>
                  <LayerThumbnail :image="entry.layer" :alt="entry.layer.name" />
                  <div
                    class="layer-stack-meta"
                    :title="`${entry.layer.name} (${entry.layer.x}, ${entry.layer.y})`"
                  >
                    <input
                      v-if="renamingId === entry.layer.id"
                      v-model="renameDraft"
                      type="text"
                      class="layer-rename-input"
                      aria-label="输入新图层名称"
                      @click.stop
                      @keydown.enter.prevent="commitRename(entry.layer.id)"
                      @keydown.escape.prevent="renamingId = ''"
                      @blur="commitRename(entry.layer.id)"
                    />
                    <strong v-else @dblclick.stop="startRename(entry.layer)">{{
                      entry.layer.name
                    }}</strong>
                    <small>
                      {{ entry.layer.width }}×{{ entry.layer.height }}
                      {{ entry.layer.archived ? '· 已归档' : '' }}
                      <span
                        v-if="entry.layer.masterRestored"
                        class="layer-badge sharp"
                        title="可见区已按母版原画 1:1 无损锐化"
                      >
                        原画锐化
                      </span>
                      <span
                        v-else-if="entry.layer.rawScale && entry.layer.rawScale > 1.15"
                        class="layer-badge warn"
                        :title="`${entry.layer.rawSize ? `原始回图 ${entry.layer.rawSize.width}×${entry.layer.rawSize.height}，` : ''}放大 ${entry.layer.rawScale.toFixed(1)}×；点击下方「还原可见区原画」恢复母版清晰度`"
                      >
                        放大 {{ entry.layer.rawScale.toFixed(1) }}×
                      </span>
                      <span
                        v-if="recentChanges[entry.layer.id]"
                        class="layer-change-badge"
                        :data-kind="recentChanges[entry.layer.id]"
                      >
                        {{ recentChanges[entry.layer.id] === 'new' ? '新增' : '已修' }}
                      </span>
                    </small>
                  </div>
                  <button
                    type="button"
                    class="layer-row-flag"
                    :aria-pressed="entry.layer.locked"
                    :aria-label="`锁定 ${entry.layer.name}`"
                    title="锁定 / 解锁"
                    @click.stop="onToggleLock(entry.layer.id)"
                  >
                    <AppIcon name="i-lock" />
                  </button>
                  <PopoverMenu
                    compact
                    pointer-focus="menu"
                    close-on-scroll="outside"
                    side="right"
                    :id="`layer-row-menu-${entry.layer.id}`"
                    :label="`图层操作 ${entry.layer.name}`"
                    @click.stop
                  >
                    <template #trigger="{ open: shown, toggle }">
                      <button
                        type="button"
                        class="layer-row-flag"
                        :aria-label="`图层操作 ${entry.layer.name}`"
                        aria-haspopup="menu"
                        :aria-expanded="shown"
                        title="更多操作"
                        @click.stop="toggle"
                      >
                        <AppIcon name="i-more" />
                      </button>
                    </template>
                    <template #default="{ close: dismiss }">
                      <button
                        v-if="!entry.layer.archived"
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="
                          dismiss();
                          selectLayer(entry.layer.id);
                          focusSplit('layers', [entry.layer.id]);
                        "
                      >
                        <AppIcon name="i-branch" />
                        <span class="menu-label">继续细拆此件</span>
                      </button>
                      <button
                        v-if="entry.layer.archived"
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="
                          dismiss();
                          restoreSource(entry.layer);
                        "
                      >
                        <AppIcon name="i-undo" />
                        <span class="menu-label">恢复原件</span>
                      </button>
                      <button
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="
                          dismiss();
                          startRename(entry.layer);
                        "
                      >
                        <AppIcon name="i-rename" />
                        <span class="menu-label">重命名</span>
                      </button>
                      <button
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        @click="
                          dismiss();
                          onDuplicate(entry.layer.id);
                        "
                      >
                        <AppIcon name="i-copy" />
                        <span class="menu-label">复制</span>
                      </button>
                      <button
                        class="menu-item"
                        role="menuitem"
                        type="button"
                        :disabled="entry.layer.archived || entry.layer.locked"
                        @click="
                          dismiss();
                          onMergeDown(entry.layer.id);
                        "
                      >
                        <AppIcon name="i-layers" />
                        <span class="menu-label">向下合并</span>
                      </button>
                      <button
                        class="menu-item danger"
                        role="menuitem"
                        type="button"
                        :disabled="entry.layer.locked"
                        @click="
                          dismiss();
                          onDelete(entry.layer.id);
                        "
                      >
                        <AppIcon name="i-trash" />
                        <span class="menu-label">删除</span>
                      </button>
                    </template>
                  </PopoverMenu>
                </li>
              </template>
            </ul>

            <!-- Active Layer Alignment & Transform -->
            <div v-if="activeLayer && !activeLayer.archived" class="layer-polish-bar">
              <div class="layer-action-row">
                <button
                  type="button"
                  class="layer-secondary"
                  :disabled="activeLayer.locked"
                  title="把当前图层未被前景遮挡的可见区无损还原为母版 1:1 清晰度（保留被遮挡的 AI 补画区）"
                  @click="onRestoreUnoccludedMaster()"
                >
                  <AppIcon name="i-upscale" />
                  还原可见区原画
                </button>
                <button
                  type="button"
                  class="layer-secondary"
                  :disabled="activeLayer.locked"
                  @click="onAlignTone()"
                >
                  <AppIcon name="i-dt-colorize" />
                  一键色彩对齐原画
                </button>
              </div>
              <div class="layer-action-row">
                <button
                  type="button"
                  class="layer-secondary"
                  :disabled="activeLayer.locked"
                  title="在原图中自动搜索该图层的最佳位置与缩放比例"
                  @click="onAutoAlignLayer()"
                >
                  <AppIcon name="i-fit" />
                  自动对齐原图
                </button>
                <button
                  v-if="visibleLayerCount > 1"
                  type="button"
                  class="layer-secondary"
                  :title="upscaledLayerCount ? `有 ${upscaledLayerCount} 个放大的可见层，可一键全栈还原未遮挡区原画清晰度` : '对全部可见未锁定图层批量执行未遮挡区原画锐化'"
                  @click="onRestoreAllMaster()"
                >
                  <AppIcon name="i-layers" />
                  {{ upscaledLayerCount ? `批量锐化 (${upscaledLayerCount})` : '全栈还原原画' }}
                </button>
              </div>
              <label v-if="activeLayer.toneMatch" class="layer-slider">
                <span>
                  对色强度
                  <output>{{ Math.round(activeLayer.toneMatch.strength * 100) }}%</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  aria-label="对色强度"
                  :value="activeLayer.toneMatch.strength"
                  @change="onAlignTone(Number(($event.target as HTMLInputElement).value))"
                />
              </label>
              <details class="layer-fold">
                <summary>
                  <span>调整位置与尺寸</span>
                  <small>{{ activeLayer.width }}×{{ activeLayer.height }} · ({{ activeLayer.x }}, {{ activeLayer.y }})</small>
                </summary>
                <div class="layer-transform-form">
                  <div class="layer-transform-grid">
                    <label>
                      X
                      <input
                        :value="transformBox.x"
                        type="number"
                        step="1"
                        aria-label="图层 X 坐标"
                        :disabled="activeLayer.locked"
                        @input="onTransformCoord('x', Number(($event.target as HTMLInputElement).value))"
                      />
                    </label>
                    <label>
                      Y
                      <input
                        :value="transformBox.y"
                        type="number"
                        step="1"
                        aria-label="图层 Y 坐标"
                        :disabled="activeLayer.locked"
                        @input="onTransformCoord('y', Number(($event.target as HTMLInputElement).value))"
                      />
                    </label>
                    <label>
                      宽
                      <input
                        :value="transformBox.width"
                        type="number"
                        min="1"
                        step="1"
                        aria-label="图层宽度"
                        :disabled="activeLayer.locked"
                        @input="onTransformDimension('width', Number(($event.target as HTMLInputElement).value))"
                      />
                    </label>
                    <label>
                      高
                      <input
                        :value="transformBox.height"
                        type="number"
                        min="1"
                        step="1"
                        aria-label="图层高度"
                        :disabled="activeLayer.locked"
                        @input="onTransformDimension('height', Number(($event.target as HTMLInputElement).value))"
                      />
                    </label>
                  </div>
                  <div class="layer-transform-actions">
                    <label class="layer-check">
                      <input v-model="transformLockAspect" type="checkbox" />
                      锁定比例
                    </label>
                    <button
                      type="button"
                      class="layer-mini"
                      :disabled="activeLayer.locked"
                      @click="enterTransformMode"
                    >
                      画布拖拽
                    </button>
                    <button
                      type="button"
                      class="layer-mini"
                      :disabled="activeLayer.locked"
                      @click="fitLayerToCanvas"
                    >
                      适配画布
                    </button>
                    <button
                      type="button"
                      class="layer-mini"
                      :disabled="activeLayer.locked"
                      @click="
                        stackTool === 'transform'
                          ? commitTransformDraft()
                          : applyLayerTransform({ ...transformBox })
                      "
                    >
                      应用
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </template>
        </section>
      </template>

      <!-- ════════════════════ MODE 2: LOCAL COMPONENT COMPLETION ════════════════════ -->
      <template v-else>
        <section class="layer-section" aria-label="局部补画">
          <div class="layer-section-title">
            <h3>局部补画</h3>
            <button
              type="button"
              class="layer-link"
              :disabled="!hasScalpelGuide"
              @click="clearScalpelGuides"
            >
              清空选区
            </button>
          </div>

          <div class="layer-guides">
            <button
              type="button"
              :aria-pressed="guideTool === 'alpha'"
              @click="
                guideTool = 'alpha';
                erasingGuide = false;
              "
            >
              <i class="keep"></i>
              保留原件
            </button>
            <button
              type="button"
              :aria-pressed="guideTool === 'occluded'"
              @click="
                guideTool = 'occluded';
                erasingGuide = false;
              "
            >
              <i class="extend"></i>
              遮挡补全
            </button>
          </div>

          <div class="layer-brush-controls">
            <button
              type="button"
              class="layer-secondary"
              :aria-pressed="!erasingGuide"
              @click="erasingGuide = false"
            >
              <AppIcon name="i-brush" />
              画笔
            </button>
            <button
              type="button"
              class="layer-secondary"
              :aria-pressed="erasingGuide"
              @click="erasingGuide = true"
            >
              <AppIcon name="i-eraser" />
              擦除
            </button>
            <label class="layer-slider">
              <span>
                笔径
                <output>{{ guideDiameter }}px</output>
              </span>
              <input
                v-model.number="guideDiameter"
                type="range"
                min="4"
                max="160"
                step="2"
                aria-label="选区笔径"
              />
            </label>
          </div>

          <label v-if="guideTool === 'alpha'" class="layer-check">
            <input v-model="smartSnap" type="checkbox" />
            边缘吸附
          </label>

          <label class="layer-field">
            部件名称
            <input
              v-model="scalpelName"
              type="text"
              placeholder="如：左马尾、外套左袖"
              @blur="syncFields"
            />
          </label>

          <label class="layer-field">
            补充描述
            <textarea
              v-model="scalpelInstruction"
              rows="2"
              placeholder="可选，说明需要补全的遮挡部位"
              @blur="syncFields"
            ></textarea>
          </label>

          <ScalpelReferences :sources="referenceChoices" :selected="project.scalpelReferences ?? []"
            :excluded="excludedReferences" :first-image="inputLayout.firstReference" :busy="busy"
            @files="importScalpelFiles" @change="queueSave({ ...project, scalpelReferences: $event })"
            @remove="removeScalpelReference" @ask="emit('askScalpel')" />

          <details v-if="project.layers.length" class="layer-fold">
            <summary>
              <span>排除遮挡图层</span>
              <small v-if="scalpelOccluderIds.length">已选 {{ scalpelOccluderIds.length }}</small>
            </summary>
            <div class="layer-occluder-chips">
              <label
                v-for="layer in reversedLayers"
                :key="layer.id"
                class="layer-chip"
                :data-checked="scalpelOccluderIds.includes(layer.id)"
                :title="layer.name"
              >
                <input
                  type="checkbox"
                  :checked="scalpelOccluderIds.includes(layer.id)"
                  :disabled="busy || project.scalpelReferences?.some(r => r.picture === layerPictureId(layer.id))"
                  @change="toggleOccluder(layer.id)"
                />
                <span>{{ layer.name }}</span>
              </label>
            </div>
          </details>

          <label v-if="rerollModels.length" class="layer-field">
            模型
            <select aria-label="局部补画模型" :value="chosenRerollModel?.id"
              @change="rerollModelId = ($event.target as HTMLSelectElement).value; syncFields()">
              <option v-for="m in rerollModels" :key="m.id" :value="m.id">
                {{ m.name
                }}{{ m.fields.background?.options.includes('transparent') ? '（透明底）' : '' }}
              </option>
            </select>
          </label>

          <div class="layer-field">
            <span>送图画幅</span>
            <div class="layer-result-mode layer-framing-mode" role="group" aria-label="局部补画送图画幅">
              <button
                type="button"
                :aria-pressed="scalpelFraming === 'auto'"
                title="大件自动整图原比例，小件贴边局部框（不产生画布外空边）"
                @click="scalpelFraming = 'auto'"
              >
                自动
              </button>
              <button
                type="button"
                :aria-pressed="scalpelFraming === 'full'"
                title="始终按整张母版原比例送图，四边锚定最稳"
                @click="scalpelFraming = 'full'"
              >
                整图原比例
              </button>
              <button
                type="button"
                :aria-pressed="scalpelFraming === 'local'"
                title="仅裁选区周围局部画幅（限制在画布内），适合五官等小件"
                @click="scalpelFraming = 'local'"
              >
                局部裁框
              </button>
            </div>
          </div>

          <p v-if="chosenRerollModel && (project.scalpelReferences?.length || scalpelOccluderIds.length)" class="layer-field" aria-live="polite">
            {{ inputLayout.issue || `本轮送图 ${inputLayout.count} / ${chosenRerollModel.maxImages} 张 · ${inputLayout.context ? '含局部原图和选区' : '以选区图定位'}${scalpelOccluderIds.length ? ' · 含遮挡排除图' : ''}` }}
          </p>
          <button
            v-if="activeRequest === 'reroll'"
            type="button"
            class="layer-secondary layer-cancel-btn"
            @click="stopCurrent"
          >
            <AppIcon name="i-stop" />
            取消生成
          </button>
          <button
            v-else
            type="button"
            class="layer-primary"
            :disabled="busy || !hasScalpelGuide || !chosenRerollModel || !!inputLayout.issue"
            @click="runTargetedReroll"
          >
            <AppIcon name="i-retry" />
            生成透明部件
          </button>

          <!-- Candidate Comparison Strip -->
          <div v-if="rerollCandidates.length" class="layer-candidates">
            <div class="layer-section-title">
              <h3>候选结果</h3>
              <button v-if="activeCandidate" type="button" class="layer-link" :disabled="busy"
                @click="discardActiveCandidate">淘汰当前候选</button>
              <button
                v-if="activeCandidateId"
                type="button"
                class="layer-link"
                @click="activeCandidateId = ''"
              >
                返回涂抹
              </button>
            </div>
            <div class="layer-candidate-strip">
              <button
                v-for="(cand, idx) in rerollCandidates"
                :key="cand.id"
                type="button"
                :aria-pressed="activeCandidateId === cand.id"
                @click="
                  compareReference = false;
                  activeCandidateId = activeCandidateId === cand.id ? '' : cand.id;
                "
              >
                <LayerThumbnail :image="candidateVariant(cand).preview" :alt="`候选 #${idx + 1}`" />
                <span>#{{ idx + 1 }}</span>
              </button>
            </div>
            <div v-if="activeCandidate" class="layer-result-mode" role="group" aria-label="补画结果模式">
              <button
                type="button"
                :aria-pressed="rerollResultMode === 'raw'"
                @click="rerollResultMode = 'raw'"
              >
                仅 AI 生成图
              </button>
              <button
                type="button"
                :aria-pressed="rerollResultMode === 'overlay'"
                :disabled="!activeCandidate.overlayRaster"
                title="在 AI 透明轮廓内，用母版原图还原蓝色保留区细节"
                @click="rerollResultMode = 'overlay'"
              >
                叠加蓝区原图
              </button>
            </div>
            <div v-if="candidateSize" class="layer-field">
              <span>{{ candidateSize.framing === 'full' ? '整图原比例' : '局部裁框' }} {{ candidateSize.frameWidth }} × {{ candidateSize.frameHeight }} ·
                送图 {{ candidateSize.inputWidth }} × {{ candidateSize.inputHeight }} ·
                请求 {{ candidateSize.requested || '模型自动' }} ·
                实际回图 {{ candidateSize.width }} × {{ candidateSize.height }} px</span>
              <span v-if="Math.max(candidateSize.frameWidth, candidateSize.frameHeight) > Math.max(candidateSize.width, candidateSize.height)">
                回图小于画幅，补画区已等比放大至原位，细节受回图分辨率限制。
              </span>
              <div class="layer-pool-links">
                <button type="button" class="layer-link" :disabled="busy" @click="alignActiveCandidate">
                  自动对齐原图
                </button>
                <button type="button" class="layer-link" @click="downloadRawCandidate">下载模型原始回图</button>
              </div>
            </div>
            <button
              v-if="activeCandidate"
              type="button"
              class="layer-primary"
              @click="admitActiveCandidate"
            >
              <AppIcon name="i-check" />
              收纳当前候选进图层栈
            </button>
          </div>
        </section>
      </template>

      <!-- Canvas Matte Switcher -->
      <div class="layer-mats">
        <span>底板</span>
        <button type="button" :aria-pressed="mat === 'checker'" @click="mat = 'checker'">
          <i class="checker"></i>棋盘
        </button>
        <button type="button" :aria-pressed="mat === 'black'" @click="mat = 'black'">
          <i class="black"></i>黑
        </button>
        <button type="button" :aria-pressed="mat === 'white'" @click="mat = 'white'">
          <i class="white"></i>白
        </button>
      </div>

      <!-- Footer Delivery Exports -->
      <div class="layer-export">
        <button
          type="button"
          class="layer-primary"
          :disabled="busy || !visibleLayerCount"
          @click="exportRigZip"
        >
          <AppIcon name="i-download" />
          导出 Rig 切片包
        </button>
        <button
          v-if="picker"
          type="button"
          class="layer-icon-btn"
          title="导出切片到文件夹"
          aria-label="导出 Rig 切片目录"
          :disabled="busy || !visibleLayerCount"
          @click="exportRigFolder"
        >
          <AppIcon name="i-folder" />
        </button>
        <button
          type="button"
          class="layer-secondary"
          :disabled="busy || !project.layers.length"
          @click="exportPsd"
        >
          <AppIcon name="i-layers" />
          导出分层 PSD
        </button>
      </div>
    </fieldset>
  </section>

  <!-- Main Stage Canvas Teleport -->
  <Teleport v-if="stage" :to="stage">
    <LayerCanvas
      v-if="project && stageProject"
      ref="canvasRef"
      :project="stageProject"
      :region-pick="scope === 'region' && mode === 'stack' && stackTool === 'rect'"
      :mode="mode"
      :tool="activeTool"
      :active-layer-id="activeLayerId"
      :solo-layer-ids="soloLayerIds"
      :compare-reference="compareReference && !previewingPoolDrag"
      :preview-raster="previewRaster"
      :preview-layers="previewLayers"
      :commit-move="commitMove"
      :transform-rect="stackTool === 'transform' ? transformDraft : undefined"
      :transform-lock-aspect="transformLockAspect"
      :transform-ghost-ref="stackTool === 'transform' && transformGhostRef"
      :transform-opacity="stackTool === 'transform' && transformGhostRef ? transformOpacity : 1"
      :mat="mat"
      :diameter="mode === 'stack' ? brushDiameter : guideDiameter"
      :hardness="brushHardness"
      :smudge-strength="smudgeStrength"
      :erasing-guide="erasingGuide"
      :smart-snap="smartSnap"
      :busy="busy"
      @brush="onCanvasBrush"
      @smudge="onCanvasSmudge"
      @offset="onCanvasOffset"
      @select-layer="selectLayer"
      @transform-change="onTransformDraftChange"
      @selection-rect="chooseRect"
      @selection-lasso="pendingLasso = $event"
      @guide-stroke="onGuideStroke"
    />
    <div v-else class="layer-empty-stage">
      <AppIcon name="i-layers" />
      <h3>尚未载入定稿</h3>
      <button type="button" class="layer-primary" @click="referenceFile?.click()">
        <AppIcon name="i-upload" />
        导入定稿图片
      </button>
    </div>
  </Teleport>

  <!-- Floating Canvas Tool Dock Teleport -->
  <Teleport v-if="dock && project" :to="dock">
    <div class="layer-dock-wrap">
      <div class="layer-dock" role="toolbar" aria-label="分件画布工具">
        <template v-if="mode === 'stack'">
          <button
            type="button"
            :aria-pressed="stackTool === 'move'"
            title="移动预览 (V) — 拖拽查看被遮挡底层，松手自动回弹"
            @click="
              stackTool = 'move';
              clearPendingSelection();
            "
          >
            <AppIcon name="i-hand" />
            移动
          </button>
          <button
            type="button"
            :aria-pressed="stackTool === 'transform'"
            :disabled="!activeLayer || activeLayer.locked || activeLayer.archived"
            title="拖拽缩放与手动对齐 (T) — 拖动四角缩放、拖框移动、方向键微调，回车应用"
            @click="enterTransformMode"
          >
            <AppIcon name="i-expand" />
            缩放对齐
          </button>
          <button
            type="button"
            :aria-pressed="stackTool === 'erase'"
            title="软硬橡皮擦 (E)"
            @click="
              stackTool = 'erase';
              clearPendingSelection();
            "
          >
            <AppIcon name="i-eraser" />
            橡皮
          </button>
          <button
            type="button"
            :aria-pressed="stackTool === 'restore'"
            title="从锁定原图无损刷回 (R)"
            @click="
              stackTool = 'restore';
              clearPendingSelection();
            "
          >
            <AppIcon name="i-brush" />
            刷回原图
          </button>
          <button
            type="button"
            :aria-pressed="stackTool === 'smudge'"
            title="涂抹拽边笔 (S) — 拉长边缘制造防漏光出血位，自动扩展图层边界"
            @click="
              stackTool = 'smudge';
              clearPendingSelection();
            "
          >
            <AppIcon name="i-dt-sketch" />
            拽边笔
          </button>
          <button
            type="button"
            :aria-pressed="stackTool === 'rect'"
            title="框选拆分为新图层 (M)"
            @click="stackTool = 'rect'"
          >
            <AppIcon name="i-select-rect" />
            框选拆分
          </button>
          <button
            type="button"
            :aria-pressed="stackTool === 'lasso'"
            title="套索拆分为新图层 (L)"
            @click="stackTool = 'lasso'"
          >
            <AppIcon name="i-select-polygon" />
            套索拆分
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            :aria-pressed="guideTool === 'alpha'"
            @click="
              guideTool = 'alpha';
              erasingGuide = false;
            "
          >
            <span class="layer-swatch alpha"></span>
            保留原件
          </button>
          <button
            type="button"
            :aria-pressed="guideTool === 'occluded'"
            @click="
              guideTool = 'occluded';
              erasingGuide = false;
            "
          >
            <span class="layer-swatch fill"></span>
            遮挡补全
          </button>
          <button type="button" :aria-pressed="erasingGuide" @click="erasingGuide = !erasingGuide">
            <AppIcon name="i-eraser" />
            橡皮
          </button>
          <button type="button" @click="mode = 'stack'">
            <AppIcon name="i-back" />
            返回图层栈
          </button>
        </template>

        <span class="layer-divider" aria-hidden="true"></span>

        <button
          type="button"
          :disabled="!canUndo || busy"
          title="撤销 (⌘Z)"
          aria-label="撤销"
          @click="undoRedo('undo')"
        >
          <AppIcon name="i-undo" />
        </button>
        <button
          type="button"
          :disabled="!canRedo || busy"
          title="重做 (⇧⌘Z)"
          aria-label="重做"
          @click="undoRedo('redo')"
        >
          <AppIcon name="i-redo" />
        </button>

        <span class="layer-divider" aria-hidden="true"></span>

        <button
          type="button"
          :aria-pressed="compareReference"
          title="对照锁定原图 (\\)"
          @click="compareReference = !compareReference"
        >
          <AppIcon name="i-compare" />
          对照原图
        </button>

        <button v-if="compact" type="button" aria-label="打开分件面板" @click="emit('panel')">
          <AppIcon name="i-sidebar" />
        </button>
      </div>

      <!-- Contextual Sub-bar: Move Commit Toggle / Transform Controls / Brush / Split Confirm -->
      <div
        v-if="
          mode === 'stack' &&
          (stackTool === 'move' ||
            (stackTool === 'transform' && transformDraft) ||
            stackTool === 'erase' ||
            stackTool === 'restore' ||
            stackTool === 'smudge' ||
            hasPendingSelection)
        "
        class="layer-dock-sub"
      >
        <label v-if="stackTool === 'move'" class="layer-dock-check" title="未勾选时松手自动回弹归位">
          <input v-model="commitMove" type="checkbox" />
          保留偏移
        </label>

        <template v-else-if="stackTool === 'transform' && transformDraft">
          <label class="layer-dock-check" title="在底层显示锁定原图，便于手动对齐轮廓">
            <input v-model="transformGhostRef" type="checkbox" />
            叠显原图
          </label>
          <label v-if="transformGhostRef" class="layer-dock-slider">
            <span>透明 {{ Math.round(transformOpacity * 100) }}%</span>
            <input
              v-model.number="transformOpacity"
              type="range"
              min="0.2"
              max="1"
              step="0.05"
              aria-label="对齐图层透明度"
            />
          </label>
          <label class="layer-dock-check">
            <input v-model="transformLockAspect" type="checkbox" />
            锁定比例
          </label>
          <button type="button" class="layer-mini" @click="fitLayerToCanvas">适配画布</button>
          <button type="button" class="layer-primary layer-dock-split" @click="commitTransformDraft">
            <AppIcon name="i-check" />
            应用变换
          </button>
          <button type="button" class="layer-mini" @click="exitTransformMode">取消</button>
        </template>

        <template v-else-if="stackTool === 'erase' || stackTool === 'restore'">
          <label class="layer-dock-slider">
            <span>笔径 {{ brushDiameter }}px</span>
            <input
              v-model.number="brushDiameter"
              type="range"
              min="4"
              max="160"
              step="2"
              aria-label="画笔直径"
            />
          </label>
          <label class="layer-dock-slider">
            <span>硬度 {{ Math.round(brushHardness * 100) }}%</span>
            <input
              v-model.number="brushHardness"
              type="range"
              min="0"
              max="1"
              step="0.05"
              aria-label="画笔硬度"
            />
          </label>
        </template>

        <template v-else-if="stackTool === 'smudge'">
          <label class="layer-dock-slider">
            <span>笔径 {{ brushDiameter }}px</span>
            <input
              v-model.number="brushDiameter"
              type="range"
              min="4"
              max="160"
              step="2"
              aria-label="拽边笔径"
            />
          </label>
          <label class="layer-dock-slider">
            <span>强度 {{ Math.round(smudgeStrength * 100) }}%</span>
            <input
              v-model.number="smudgeStrength"
              type="range"
              min="0.1"
              max="0.98"
              step="0.02"
              aria-label="拽边强度"
            />
          </label>
        </template>

        <template v-else-if="hasPendingSelection && scope !== 'region'">
          <button type="button" class="layer-primary layer-dock-split" @click="executeSplitSelection">
            <AppIcon name="i-branch" />
            拆分为新图层
          </button>
          <button type="button" class="layer-mini" @click="clearPendingSelection">取消选区</button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style src="./layer-panel.css"></style>
