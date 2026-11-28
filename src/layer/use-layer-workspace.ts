import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
} from 'vue';
import { usePhotopea } from '../app/photopea.ts';
import { useServices } from '../app/services.ts';
import { useUi } from '../app/ui.ts';
import type { Picture } from '../ask/library.ts';
import { directoryPicker } from '../bridge/fs-driver.ts';
import type { CatalogModel } from '../domain/catalog.ts';
import { naiUpscaleLimit, upscaleModels } from '../domain/media.ts';
import type { PhotopeaLayerResult } from '../services/photopea.ts';
import { download } from '../shared/files.ts';
import { createArchive } from '../storage/backup-archive.ts';
import { alignRasterToReference } from './align.ts';
import { clippedCandidate, fitCandidate, localPixels } from './candidate-fit.ts';
import {
  decodeLayerBlob,
  decomposeCapable,
  decomposeSizes,
  preferredDecomposeModel,
  requestLayerDecompose,
  routeLabel,
  supportsMissingComponent,
  type DecomposeBatch,
  type DecomposeSize,
  type SmallSplitInput,
  type SplitInputUpscale,
} from './decompose.ts';
import { packageFiles, writePackage } from './export.ts';
import { placeOnCanvas, png, readRaster } from './images.ts';
import type { CanvasTool, StackTool } from './LayerCanvas.vue';
import type LayerCanvas from './LayerCanvas.vue';
import { recordGuide, travelGuide, type GuideChannel, type GuideHistory } from './mask-history.ts';
import {
  applyLayerEdits,
  attachLayer,
  layerContext,
  macroPrompt,
  partPrompt,
  rejectionPictures,
  type LayerTodo,
} from './planning.ts';
import {
  alphaBounds,
  crop,
  layerVisible,
  newProject,
  type LayerProject,
  type PoolLayer,
  type Raster,
  type Rect,
  type RerollCandidate,
  type StackLayer,
} from './project.ts';
import { isPsdFile, layerFileAccept, readLayerPsd } from './psd-file.ts';
import { layeredPsd, photopeaLayerPsd } from './psd.ts';
import {
  admitSplit,
  candidateOrder,
  insertMissingComponent,
  insertSplitCandidates,
  moveCandidate,
  splitSource,
} from './recursive.ts';
import { addGeneration, changeRejections, type RejectionChange } from './rejections.ts';
import {
  filePictureId,
  layerPictureId,
  referencePictures,
  referenceSources,
  scalpelInputs,
  scalpelSource,
  type ReferenceSource,
} from './scalpel-references.ts';
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
import { layerStorage, type LayerSummary } from './storage.ts';
import {
  preferredRerollModel,
  requestTargetedReroll,
  rerollCapable,
  type ScalpelFraming,
} from './targeted-reroll.ts';

export interface LayerWorkspaceProps {
  stage: HTMLElement | null;
  emptyHost: HTMLElement | null;
  dock: HTMLElement | null;
  headHost: HTMLElement | null;
  viewHost: HTMLElement | null;
  railHost: HTMLElement | null;
  coCreate: boolean;
  compact: boolean;
  models: CatalogModel[];
  activeModel?: string;
  backgroundAvailable: boolean;
  source?: { blob: Blob; name: string; kind: string; recordId?: string };
  sourceKey?: string;
}

export interface LayerWorkspaceEmit {
  (e: 'size', size: { width: number; height: number }): void;
  (e: 'close'): void;
  (e: 'collapseRail'): void;
  (e: 'panel'): void;
  (e: 'locateForm'): void;
  (e: 'todos', projectId: string): void;
  (e: 'reviewRejections'): void;
  (e: 'askScalpel', action?: 'layers' | 'missing'): void;
  (e: 'background', source: Blob): void;
  (e: 'zoomStep', direction: 1 | -1): void;
  (e: 'zoomFit'): void;
  (e: 'zoomActual'): void;
  (e: 'stateChange', state: { hasProject: boolean; busy: boolean }): void;
}

export type LayerModelChoice = { id: string; connection?: string };
export type BetaLayerTab = 'stack' | 'decompose' | 'scalpel';

export type StackDisplayItem =
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

interface StackSnapshot {
  label: string;
  layers: StackLayer[];
  activeLayerId?: string;
  confirmUndo?: boolean;
  poolChange?: { before: LayerProject['pendingSplit']; after: LayerProject['pendingSplit'] };
  poolOrderChange?: { batchId: string; before: string[]; after: string[] };
  rejection?: RejectionChange;
}

export function createLayerWorkspace(props: LayerWorkspaceProps, emit: LayerWorkspaceEmit) {
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
  const splitInputDialog = shallowRef<{
    input: SmallSplitInput;
    models: { model: CatalogModel; label: string }[];
    finish: (method?: SplitInputUpscale) => void;
  }>();

  // Workspace modes & tools
  const mode = ref<'stack' | 'scalpel'>('stack');
  const betaTab = ref<BetaLayerTab>('decompose');
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
  const revealTarget = shallowRef<{ id: string; seq: number }>();
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
  const candidatePool = shallowRef<HTMLElement>();
  const poolSelected = ref<string[]>([]);
  const poolVisibleIds = ref<string[]>([]);
  const poolSoloId = ref('');
  const fittingId = ref('');
  const maskChoices = computed(() =>
    [
      ...(poolBatch.value?.layers ?? []).filter((l) => l.id !== fittingId.value && !l.needsPosition),
      ...(project.value?.layers ?? []).filter((l) => !l.archived),
    ].map(({ id, name }) => ({ id, name })),
  );
  watch(
    () => poolBatch.value?.id,
    () => {
      fittingId.value = '';
    },
  );
  const poolStageActive = ref(false);
  const poolDrag = shallowRef<{ batchId: string; from: string; over: string }>();
  const poolOrder = computed(() =>
    poolBatch.value ? candidateOrder(poolBatch.value, project.value?.layers ?? []) : [],
  );
  const poolFrontFirst = computed(() => {
    const items = new Map(poolBatch.value?.layers.map((l) => [l.id, l]));
    return poolOrder.value.flatMap((id) => items.get(id) ?? []).reverse();
  });
  const hoverOrder = computed(() => {
    const drag = poolDrag.value;
    return drag && drag.batchId === poolBatch.value?.id && drag.over
      ? moveCandidate(poolOrder.value, drag.from, drag.over)
      : poolOrder.value;
  });
  const previewingPoolDrag = computed(() => hoverOrder.value !== poolOrder.value);
  const showingReference = computed(() => compareReference.value && !previewingPoolDrag.value);
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
  const decomposeChoice = shallowRef<LayerModelChoice>();

  // Tier-2 Local Component Completion state
  const scalpelName = ref('');
  const scalpelInstruction = ref('');
  const scalpelOccluderIds = ref<string[]>([]);
  const rerollChoice = shallowRef<LayerModelChoice>();
  const scalpelFraming = ref<ScalpelFraming>('auto');
  const rerollCandidates = shallowRef<RerollCandidate[]>([]);
  const activeCandidateId = ref('');
  const rerollResultMode = ref<'raw' | 'overlay'>('raw');
  const guideHistory = shallowRef<GuideHistory>();

  // Stack Undo / Redo (in-memory shallow snapshots, up to 30 steps)
  const stackHistory = shallowRef<{ entries: StackSnapshot[]; index: number }>({
    entries: [],
    index: -1,
  });

  const canvasRef = shallowRef<InstanceType<typeof LayerCanvas>>();
  const masterBlobs = new WeakMap<Raster, Blob>();
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
  let detachPlanning: (() => void) | undefined;
  const referenceFile = shallowRef<HTMLInputElement>();
  const importLayerInput = shallowRef<HTMLInputElement>();
  const importLifetime = new AbortController();
  const errorBox = shallowRef<HTMLElement>();
  const splitForm = shallowRef<HTMLElement>();

  let controller: AbortController | undefined;
  let committed: LayerProject | undefined;
  let writing: Promise<boolean> | undefined;

  const reference = computed(() => project.value?.reference);
  const formalLayers = computed(() => project.value?.layers ?? []);
  const missingMode = computed(() => project.value?.scalpelMode === 'missing');
  const missingLayerIds = computed(() => project.value?.missingLayerIds);
  const scalpelLayerIds = computed(() => project.value?.scalpelLayerIds);
  const scalpelBase = computed(
    () => reference.value && scalpelSource(reference.value, formalLayers.value, scalpelLayerIds.value),
  );
  const rejectedCount = computed(
    () => project.value?.generationRounds?.reduce((total, round) => total + round.rejected.length, 0) ?? 0,
  );
  const transparent = computed(() => !!reference.value && hasExteriorTransparency(reference.value));
  const reversedLayers = computed(() => (project.value ? [...project.value.layers].reverse() : []));
  const activeLayer = computed(() => project.value?.layers.find((l) => l.id === activeLayerId.value));
  const activeLayerIndex = computed(() =>
    project.value ? project.value.layers.findIndex((l) => l.id === activeLayerId.value) : -1,
  );
  const visibleLayerCount = computed(() => project.value?.layers.filter(layerVisible).length ?? 0);

  watch(
    [() => !!project.value, () => busy.value || saving.value],
    ([hasProject, isBusy]) => emit('stateChange', { hasProject, busy: isBusy }),
    { immediate: true },
  );

  function selectBetaTab(tab: BetaLayerTab) {
    betaTab.value = tab;
    if (tab === 'scalpel') {
      mode.value = 'scalpel';
      poolStageActive.value = false;
      clearPendingSelection();
    } else {
      mode.value = 'stack';
      activeCandidateId.value = '';
      if (tab === 'stack') poolStageActive.value = false;
    }
  }

  function selectTraditionalMode(next: 'stack' | 'scalpel') {
    mode.value = next;
    if (next === 'scalpel') {
      betaTab.value = 'scalpel';
      poolStageActive.value = false;
      clearPendingSelection();
    } else {
      betaTab.value = poolBatch.value || !project.value?.layers.length ? 'decompose' : 'stack';
      activeCandidateId.value = '';
    }
  }

  const soloLayerIds = computed<readonly string[] | undefined>(() => {
    if (soloLayerId.value) return [soloLayerId.value];
    if (soloGroupKey.value && project.value) {
      const prefix = soloGroupKey.value.split('\0');
      const ids = project.value.layers.filter((l) => layerInGroup(l, prefix)).map((l) => l.id);
      if (ids.length) return ids;
    }
    return undefined;
  });

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
  const rerollModels = computed(() => props.models.filter(rerollCapable));
  const chosenDecomposeModel = computed(() =>
    resolveLayerModel(decomposeModels.value, decomposeChoice.value, preferredDecomposeModel),
  );
  const missingModels = computed(() => decomposeModels.value.filter(supportsMissingComponent));
  const splitCountMax = computed(() => {
    const limits = chosenDecomposeModel.value?.splitLimits;
    return limits ? Math.min(99, limits.max ?? 0) : 99;
  });
  const splitAllowsAuto = computed(() => chosenDecomposeModel.value?.splitLimits?.auto ?? true);
  const splitSizeOptions = computed(() => decomposeSizes(chosenDecomposeModel.value));
  const displayedSplitSize = computed({
    get: () => splitSizeOptions.value.includes(decomposeSize.value) ? decomposeSize.value : splitSizeOptions.value[0],
    set: (size: DecomposeSize) => { decomposeSize.value = size; },
  });
  const displayedSplitCount = computed({
    get: () => Math.min(decomposeMax.value, splitCountMax.value),
    set: (value: number) => { decomposeMax.value = value; },
  });
  const chosenMissingModel = computed(() =>
    resolveLayerModel(missingModels.value, decomposeChoice.value, preferredDecomposeModel),
  );
  const chosenRerollModel = computed(() =>
    resolveLayerModel(rerollModels.value, rerollChoice.value, (models) =>
      preferredRerollModel(models, props.activeModel),
    ),
  );
  const layerConnectionNames = computed(() => {
    const connections = services.connections.configuration.connections;
    return Object.fromEntries(props.models.map((m) => [m.connection, connections[m.connection]?.name]));
  });
  const modelKey = (model: LayerModelChoice) => JSON.stringify([model.id, model.connection]);
  const selectValue = (choice?: LayerModelChoice) => (choice?.connection ? modelKey(choice) : '');

  function resolveLayerModel(
    models: CatalogModel[],
    choice: LayerModelChoice | undefined,
    preferred: (models: CatalogModel[]) => CatalogModel | undefined,
  ) {
    const selected = models.find(
      (m) => m.id === choice?.id && (!choice.connection || m.connection === choice.connection),
    );
    return choice?.connection ? selected : (selected ?? preferred(models));
  }
  function modelOptionLabel(model: CatalogModel) {
    const protocol = routeLabel(model),
      name = layerConnectionNames.value[model.connection];
    return `${model.name} · ${protocol}${name && !protocol.includes(name) ? `（${name}）` : ''}`;
  }
  function chooseLayerModel(kind: 'decompose' | 'reroll', value: string) {
    const [models, choice] =
      kind === 'decompose' ? ([decomposeModels, decomposeChoice] as const) : ([rerollModels, rerollChoice] as const);
    const selected = models.value.find((model) => modelKey(model) === value);
    choice.value = selected ? { id: selected.id, connection: selected.connection } : undefined;
    syncFields();
  }
  function selectLayerModel(kind: 'decompose' | 'reroll', event: Event) {
    chooseLayerModel(kind, (event.target as HTMLSelectElement).value);
  }

  const hasScalpelGuide = computed(
    () => !!project.value?.alpha.some(Boolean) || !!project.value?.occluded?.some(Boolean),
  );
  const canTargetScalpel = computed(() =>
    scalpelLayerIds.value ? !!scalpelLayerIds.value.length : hasScalpelGuide.value,
  );
  const referenceChoices = computed(() => (project.value ? referenceSources(project.value) : []));
  const excludedReferences = computed(() => scalpelOccluderIds.value.map(layerPictureId));
  const inputLayout = computed(() =>
    scalpelInputs(
      chosenRerollModel.value?.maxImages ?? 0,
      project.value?.scalpelReferences?.length ?? 0,
      !!scalpelOccluderIds.value.length,
      !!scalpelLayerIds.value?.length && !hasScalpelGuide.value,
    ),
  );

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
    if (mode.value === 'scalpel' && !missingMode.value && activeCandidate.value) {
      return candidateVariant(activeCandidate.value).raster;
    }
    return undefined;
  });

  const previewLayers = computed(() => {
    const batch = poolBatch.value,
      p = project.value;
    const drawable = (l: StackLayer) => ({ data: l.pixels, width: l.width, height: l.height, x: l.x, y: l.y });
    if (mode.value === 'scalpel' && missingMode.value && p) {
      const ids = missingLayerIds.value;
      return ids ? p.layers.filter((l) => !l.archived && ids.includes(l.id)).map(drawable) : [p.reference];
    }
    if (mode.value !== 'stack' || !(poolStageActive.value || previewingPoolDrag.value) || !batch || !p) return undefined;
    const selected = batch.layers.filter((l) =>
      poolSoloId.value ? l.id === poolSoloId.value : poolVisibleIds.value.includes(l.id),
    );
    const candidates: StackLayer[] = selected.map((l) => ({
      id: l.id,
      name: l.name,
      candidateId: l.id,
      width: l.raster.width,
      height: l.raster.height,
      pixels: l.raster.data,
      visible: true,
      locked: false,
      x: l.local ? l.box.x : 0,
      y: l.local ? l.box.y : 0,
    }));
    let context = p.layers;
    if (batch.componentName) {
      if (poolSoloId.value) return candidates.map(drawable);
      if (batch.source.kind === 'master') return [p.reference, ...candidates.map(drawable)];
      const anchorExists = context.some((l) => l.id === batch.source.members.at(-1)?.id);
      if (candidates[0] && anchorExists) context = insertMissingComponent(context, candidates[0], batch.source);
      return context.filter(layerVisible).map(drawable);
    }
    if (poolSoloId.value) context = [];
    else if (batch.source.kind === 'master') context = context.filter((l) => l.batchId === batch.id);
    const members = batch.source.members.map((m) => m.id);
    const anchor = batch.insertAbove
      ? context.findIndex((l) => l.id === batch.insertAbove)
      : context.map((l) => members.includes(l.id)).lastIndexOf(true);
    return insertSplitCandidates(
      context,
      candidates,
      { ...batch, order: hoverOrder.value },
      anchor < 0 ? context.length : anchor + 1,
    )
      .filter((l) => layerVisible(l) && !(archiveSource.value && members.includes(l.id)))
      .map(drawable);
  });
  const regionPick = computed(() => scope.value === 'region' && mode.value === 'stack' && stackTool.value === 'rect');
  const showViewSwitch = computed(
    () =>
      mode.value === 'stack' &&
      (previewLayers.value !== undefined || (!regionPick.value && !!(poolBatch.value || project.value?.layers.length))),
  );
  const showingResult = computed(
    () => !showingReference.value && (previewLayers.value !== undefined || !!project.value?.layers.length),
  );
  function setReferenceView(show: boolean) {
    if (show) canvasRef.value?.cancelStroke();
    compareReference.value = show;
  }
  function showLayerResult() {
    if (!project.value?.layers.length && poolBatch.value) poolStageActive.value = true;
    setReferenceView(false);
  }
  const stageProject = computed(() => {
    const p = project.value;
    return p && draggingLayerId.value && dragOverLayerId.value
      ? { ...p, layers: reorderLayer(p.layers, draggingLayerId.value, dragOverLayerId.value) }
      : p;
  });

  const allPoolVisible = computed(() => {
    const batch = poolBatch.value;
    if (!batch) return false;
    return batch.layers.every((l) => poolVisibleIds.value.includes(l.id));
  });

  const canUndo = computed(() =>
    mode.value === 'stack'
      ? stackHistory.value.index > 0
      : !missingMode.value && (guideHistory.value?.position ?? 0) > 0,
  );
  const canRedo = computed(() =>
    mode.value === 'stack'
      ? stackHistory.value.index >= 0 && stackHistory.value.index < stackHistory.value.entries.length - 1
      : !missingMode.value && !!guideHistory.value && guideHistory.value.position < guideHistory.value.edits.length,
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
      const source = p.pendingSplit?.batch.componentName ? undefined : p.pendingSplit?.batch.source;
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
      decomposeConfigOpen.value = !p.pendingSplit;
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
      betaTab.value = p.pendingSplit || !p.layers.length ? 'decompose' : 'stack';
      stackTool.value = 'move';
      resetStackHistory(p);
    }
    activeLayerId.value =
      (p.activeLayerId && p.layers.some((l) => l.id === p.activeLayerId) ? p.activeLayerId : p.layers.at(-1)?.id) ??
      '';
    loadForm(p);
    decomposeChoice.value = p.decomposeModel ? { id: p.decomposeModel, connection: p.decomposeConnection } : undefined;
    scalpelName.value = p.scalpelName;
    scalpelInstruction.value = p.scalpelInstruction;
    scalpelOccluderIds.value = p.scalpelOccluderIds.filter((id) => p.layers.some((l) => l.id === id));
    rerollChoice.value = p.rerollModel ? { id: p.rerollModel, connection: p.rerollConnection } : undefined;
  }

  function saveActive(next: LayerProject) {
    return next.revision === 0 ? store.replace(next, []) : store.save(next);
  }

  function queueSave(next: LayerProject) {
    if (project.value?.layers !== next.layers) {
      const available = new Set(referenceSources(next).map((s) => s.picture));
      if (next.scalpelLayerIds) next.scalpelLayerIds = next.scalpelLayerIds.filter((id) => available.has(layerPictureId(id)));
      if (next.missingLayerIds) next.missingLayerIds = next.missingLayerIds.filter((id) => available.has(layerPictureId(id)));
      next.scalpelReferences = next.scalpelReferences?.filter((r) => available.has(r.picture));
      scalpelOccluderIds.value = next.scalpelOccluderIds.filter((id) => next.layers.some((l) => l.id === id));
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
          const stored = await saveActive({ ...snapshot, revision: committed!.revision });
          committed = stored;
          if (project.value === snapshot) project.value = stored;
        }
        saveError.value = '';
        return true;
      } catch (e) {
        const detail =
          e instanceof DOMException && e.name === 'QuotaExceededError'
            ? '浏览器可用存储空间不足'
            : e instanceof Error
              ? e.message || e.name
              : String(e);
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

  function formatLayerError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const name = e instanceof DOMException || e instanceof Error ? e.name : '';
    if (name === 'NotReadableError' || /could not be read|permission problems/i.test(raw)) {
      return '无法读取该文件（可能缺少访问权限、文件已被移动或尚未从云端下载），请重新选择。';
    }
    if (name === 'SecurityError' || name === 'NotAllowedError') {
      return '没有读取该文件的权限，请将文件移至本地目录后重新选择。';
    }
    if (name === 'NotFoundError') {
      return '找不到该文件，可能已被移动或删除。';
    }
    if (name === 'QuotaExceededError') {
      return '本地存储空间不足，无法保存分件数据。';
    }
    return raw;
  }

  function clearError() {
    error.value = '';
  }

  async function runTask(work: () => Promise<void>, allowUnsaved = false) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    note.value = '';
    try {
      if ((await settled()) || allowUnsaved) await work();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        error.value = formatLayerError(e);
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
      const retained = new Set([...layers.map((l) => l.candidateId), ...rerollCandidates.value.map((c) => c.id)]);
      change = { ...change, items: change.items.filter((item) => !retained.has(item.id)) };
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
    mode.value = 'stack';
    betaTab.value = 'decompose';
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
    const source = chosen.batch.componentName ? undefined : chosen.batch.source;
    scope.value = source?.kind ?? 'master';
    sourceIds.value = source?.members.map((m) => m.id) ?? [];
    pendingRect.value = source?.kind === 'region' ? source.rect : undefined;
    stackTool.value = 'move';
    mode.value = 'stack';
    betaTab.value = 'decompose';
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
      decomposeModel: decomposeChoice.value?.id,
      decomposeConnection: decomposeChoice.value?.connection,
      scalpelName: scalpelName.value,
      scalpelInstruction: scalpelInstruction.value,
      scalpelOccluderIds: [...scalpelOccluderIds.value],
      rerollModel: rerollChoice.value?.id,
      rerollConnection: rerollChoice.value?.connection,
    };
    queueSave(next);
  }

  async function start(blob: Blob, title: string, sourceRecordId?: string, resume = false) {
    const previous = await store.list();
    const bytes = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const digest = Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('');
    const existing = resume && previous.find((s) => s.sourceDigest === digest || s.id === 'layer-' + digest);
    if (existing) {
      await loadProject(existing.id);
      return;
    }
    const psd = isPsdFile(title, blob.type) || (bytes.byteLength >= 4 && new DataView(bytes).getUint32(0) === 0x38425053);
    if (psd) progress.value = '正在读取 PSD 图层…';
    const imported = psd ? await readLayerPsd(bytes, importLifetime.signal) : undefined;
    const fresh = newProject(crypto.randomUUID(), title, imported?.reference ?? (await readRaster(blob)), sourceRecordId);
    fresh.sourceDigest = digest;
    if (imported) {
      fresh.layers = imported.layers;
      fresh.activeLayerId = fresh.layers.at(-1)?.id;
    }
    importLifetime.signal.throwIfAborted();
    display(await store.replace(fresh, previous));
    saved.value = await store.list();
  }

  async function clearLayerCache() {
    await runTask(async () => {
      const prior = project.value;
      await store.clear();
      saved.value = [];
      if (prior) {
        const fresh = newProject(crypto.randomUUID(), prior.title, prior.reference, prior.sourceRecordId);
        fresh.sourceDigest = prior.sourceDigest ?? /^layer-([a-f0-9]{64})$/.exec(prior.id)?.[1];
        display(fresh);
      }
      note.value = prior ? '分件缓存已清空，可以从母版重新开始。' : '分件缓存已清空。';
    }, true);
  }

  async function loadProject(id: string) {
    const p = await store.read(id);
    if (!p) throw new Error('找不到分件项目');
    display(p);
  }

  function switchProject(id: string) {
    return runTask(() => loadProject(id));
  }

  async function openReferenceFile(file: File) {
    await runTask(async () => {
      await start(file, file.name);
    }, true);
  }

  async function loadReferenceFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await openReferenceFile(file);
  }

  async function onImportLayerFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    const p = project.value;
    if (!p || !files.length) return;
    const targetProjectId = p.id;
    await runTask(async () => {
      const items: Parameters<typeof importImageLayers>[1][number][] = [];
      let alignedCount = 0;
      let scaledCount = 0;
      let lastConfidence = 0;
      const { width: refW, height: refH } = p.reference;
      for (const file of files) {
        if (isPsdFile(file.name, file.type)) {
          progress.value = `正在读取「${file.name}」的 PSD 图层…`;
          const { reference, layers } = await readLayerPsd(await file.arrayBuffer(), importLifetime.signal);
          const dx = Math.floor((refW - reference.width) / 2),
            dy = Math.floor((refH - reference.height) / 2);
          if (layers.length) {
            for (const layer of layers) items.push({ ...layer, x: layer.x + dx, y: layer.y + dy });
          } else {
            items.push({ name: file.name, raster: reference, x: dx, y: dy });
          }
          continue;
        }
        if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          throw new Error(`「${file.name}」需要 PNG、JPEG、WebP 或 PSD 格式`);
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
              Math.max(target.width / Math.max(1, tight.width), target.height / Math.max(1, tight.height)) * 100,
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
          raster = placeOnCanvas(raster, { x: 0, y: 0, width: fittedW, height: fittedH }, fittedW, fittedH);
          scaledCount++;
        }
        items.push({ name: file.name, raster });
      }
      const cur = project.value;
      if (importLifetime.signal.aborted || !cur || cur.id !== targetProjectId) return;
      const { project: next, added } = importImageLayers(cur, items);
      const changes: Record<string, 'new' | 'updated'> = {};
      for (const layer of added) changes[layer.id] = 'new';
      recentChanges.value = changes;
      poolStageActive.value = false;
      soloLayerId.value = '';
      soloGroupKey.value = '';
      compareReference.value = false;
      mode.value = 'stack';
      betaTab.value = 'stack';
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

  function chooseSplitUpscale(input: SmallSplitInput, signal: AbortSignal): Promise<SplitInputUpscale> {
    signal.throwIfAborted();
    const pixels = input.source.width * input.source.height;
    const models = upscaleModels({ models: props.models })
      .filter(
        (model) =>
          pixels <= model.sourceMaxPixels && (model.provider !== 'novelai' || pixels <= naiUpscaleLimit(model)),
      )
      .map((model) => ({ model, label: modelOptionLabel(model) }));
    return new Promise((resolve, reject) => {
      function finish(method?: SplitInputUpscale) {
        signal.removeEventListener('abort', cancel);
        splitInputDialog.value = undefined;
        if (method) resolve(method);
        else reject(new DOMException('已取消放大', 'AbortError'));
      }
      function cancel() {
        finish();
      }
      signal.addEventListener('abort', cancel, { once: true });
      splitInputDialog.value = { input, models, finish };
    });
  }

  async function runDecompose(missing = false) {
    const p = project.value;
    const model = missing ? chosenMissingModel.value : chosenDecomposeModel.value;
    if (!p || !model) {
      error.value = missing ? '请先配置支持补缺失件的 Seedream 5.5 来源' : '请先配置支持拆层的图像来源';
      return;
    }
    await runTask(async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      activeRequest.value = 'decompose';
      progress.value = '正在准备拆层请求…';
      const kind = missing ? (missingLayerIds.value ? 'layers' : 'master') : scope.value;
      const ids = missing ? (missingLayerIds.value ?? []) : sourceIds.value;
      if (kind === 'region' && !pendingRect.value) throw new Error('请在母版上框选要细拆的区域');
      if (kind === 'layers' && !ids.length) throw new Error(missing ? '请选择参考图层' : '请选择要继续细拆的图层');
      const source = splitSource(p, kind === 'layers' ? ids : [], kind === 'region' ? pendingRect.value : undefined);
      const batch = await requestLayerDecompose(
        services,
        p,
        model,
        {
          prompt: missing ? scalpelInstruction.value : decomposePrompt.value,
          componentName: missing ? scalpelName.value : undefined,
          maxImages: !splitCountMax.value || (splitAllowsAuto.value && decomposeUnlimited.value) ? undefined : displayedSplitCount.value,
          size: decomposeSize.value,
          source,
        },
        request.signal,
        (msg) => {
          progress.value = msg;
        },
        chooseSplitUpscale,
      );
      request.signal.throwIfAborted();
      if (project.value?.id !== p.id) return;
      const previousPool = poolState();
      poolBatch.value = batch;
      archiveSource.value = !missing && source.kind === 'layers';
      const defaultPicked = batch.layers.filter((l) => !l.isBase).map((l) => l.id);
      poolSelected.value = missing
        ? defaultPicked.slice(0, 1)
        : defaultPicked.length
          ? defaultPicked
          : batch.layers.slice(0, 1).map((l) => l.id);
      poolVisibleIds.value = [...poolSelected.value];
      poolSoloId.value = '';
      poolStageActive.value = true;
      decomposeConfigOpen.value = false;
      compareReference.value = false;
      betaTab.value = 'decompose';
      if (missing) {
        mode.value = 'stack';
        stackTool.value = 'move';
      }
      queueSave({
        ...project.value!,
        pendingSplit: poolState(),
        otherSplits: [...(project.value!.otherSplits ?? []), ...(previousPool ? [previousPool] : [])],
        generationRounds: addGeneration(project.value, {
          source: missing ? 'scalpel' : source.kind,
          target: batch.componentName ?? source.name,
          model: batch.model,
          candidateIds: batch.layers.map((l) => l.id),
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
      note.value = `${batch.targetName}返回 ${batch.layers.length} 个候选层，已在画布实时叠加显示`;
      if (missing) {
        await nextTick();
        candidatePool.value?.focus({ preventScroll: true });
        candidatePool.value?.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function setRegionDestination(field: 'groupName' | 'insertAbove', value: string) {
    if (poolBatch.value?.source.kind !== 'region') return;
    poolBatch.value = { ...poolBatch.value, [field]: value };
    savePool();
  }
  function applyPoolOrder(from: string, to?: string) {
    const batch = poolBatch.value,
      p = project.value;
    if (!batch || !p || busy.value || !to) return;
    if (!batch.layers.some((l) => l.id === from) || !batch.layers.some((l) => l.id === to)) return;
    const before = poolOrder.value,
      after = moveCandidate(before, from, to);
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
    if (poolBatch.value?.componentName) {
      poolSelected.value = [id];
      poolVisibleIds.value = [id];
      if (poolSoloId.value) poolSoloId.value = id;
      poolStageActive.value = true;
      compareReference.value = false;
      savePool();
      return;
    }
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
    const p = project.value,
      batch = poolBatch.value;
    if (!p || !batch || busy.value || !batch.layers.includes(item)) return;
    const before = poolState();
    try {
      if ('box' in edit) {
        const fitted = fitCandidate(item, edit.box, p.reference);
        poolBatch.value = { ...batch, layers: batch.layers.map((l) => (l.id === item.id ? fitted : l)) };
        poolVisibleIds.value = [...new Set([...poolVisibleIds.value, item.id])];
        if (poolSoloId.value) poolSoloId.value = item.id;
      } else {
        const mask = batch.layers.find((l) => l.id === edit.maskId && l.id !== item.id && !l.needsPosition);
        const formal = p.layers.find((l) => l.id === edit.maskId && !l.archived);
        if (!mask && !formal) throw new Error('请选择已定位的轮廓图层');
        const pixels = mask
          ? localPixels(mask)
          : { data: formal!.pixels, width: formal!.width, height: formal!.height };
        const copy = clippedCandidate(item, pixels, mask?.box ?? formal!);
        const order = [...poolOrder.value];
        order.splice(order.indexOf(item.id) + 1, 0, copy.id);
        poolBatch.value = { ...batch, order, layers: [...batch.layers, copy] };
        poolSelected.value = [...poolSelected.value.filter((id) => id !== item.id), copy.id];
        poolVisibleIds.value = [...poolVisibleIds.value.filter((id) => id !== item.id), copy.id];
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
      const remaining = batch.componentName ? [] : batch.layers.filter((l) => !poolSelected.value.includes(l.id));
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
        if (props.coCreate) betaTab.value = 'stack';
      }
      commitStackChange(`收纳 ${addedCount} 层`, next.layers, next.activeLayerId, {
        poolChange: { before: previousPool, after: poolState() },
      });
      if (batch.componentName) {
        soloLayerId.value = '';
        soloGroupKey.value = '';
        compareReference.value = false;
      }
      if (!batch.componentName && scope.value === 'region') {
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
    const p = project.value,
      batch = poolBatch.value;
    if (!p || !batch || busy.value) return;
    const dropped = batch.layers.filter((l) => !id || l.id === id);
    if (!dropped.length) return;
    const before = poolState();
    const remaining = batch.layers.filter((l) => id && l.id !== id);
    if (remaining.length) {
      poolBatch.value = { ...batch, layers: remaining };
      poolSelected.value = poolSelected.value.filter((i) => i !== id);
      poolVisibleIds.value = poolVisibleIds.value.filter((i) => i !== id);
      if (poolSoloId.value === id) poolSoloId.value = '';
    } else showPool(undefined);
    const rejection: RejectionChange = {
      reason: 'discarded_candidate',
      items: dropped
        .filter((item) => !p.layers.some((layer) => layer.candidateId === item.id))
        .map(({ id, name, preview }) => ({ id, name, preview })),
    };
    try {
      commitStackChange('淘汰候选', p.layers, activeLayerId.value, {
        poolChange: { before, after: poolState() },
        rejection,
        keepChanges: true,
      });
      const tracked = p.generationRounds?.some((r) => r.candidateIds.includes(dropped[0].id));
      note.value = tracked
        ? `已淘汰 ${dropped.length} 张候选`
        : `已淘汰 ${dropped.length} 张候选，本批在 ASK 的三轮记录范围外`;
    } catch (e) {
      showPool(before);
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  function groupMemberIds(path: readonly string[]): string[] {
    const p = project.value;
    if (!p) return [];
    return p.layers.filter((l) => !l.archived && layerInGroup(l, path)).map((l) => l.id);
  }

  function revealLayerAncestors(layer: StackLayer) {
    const path = layer.groupIds ?? layer.groups ?? [];
    if (!path.length) return;
    let next: Record<string, boolean> | undefined;
    for (let d = 1; d <= path.length; d++) {
      const key = path.slice(0, d).join('\0');
      if (collapsedGroups.value[key]) {
        next ??= { ...collapsedGroups.value };
        delete next[key];
      }
    }
    if (next) collapsedGroups.value = next;
  }

  function selectLayer(id: string) {
    activeLayerId.value = id;
    poolStageActive.value = false;
    if (soloLayerId.value && soloLayerId.value !== id) soloLayerId.value = '';
    const p = project.value;
    if (!p) return;
    const clicked = p.layers.find((l) => l.id === id);
    if (clicked) {
      revealLayerAncestors(clicked);
      revealTarget.value = { id, seq: (revealTarget.value?.seq ?? 0) + 1 };
    }
    const syncSplit =
      scope.value === 'layers' &&
      !poolBatch.value &&
      sourceIds.value.length <= 1 &&
      !!clicked &&
      !clicked.archived &&
      sourceIds.value[0] !== id;
    if (syncSplit) {
      syncFields();
      sourceIds.value = [id];
    }
    const latest = project.value;
    if (latest && latest.activeLayerId !== id) {
      queueSave({ ...latest, activeLayerId: id });
    }
    if (syncSplit && project.value) {
      loadForm(project.value);
    }
  }

  function restoreSource(layer: StackLayer) {
    const p = project.value;
    if (!p) return;
    const originals = p.layers.filter((l) => l.archived && l.batchId === layer.batchId);
    const restored = p.layers
      .filter((l) => !originals.includes(l))
      .map((l) => (l.batchId === layer.batchId ? { ...l, visible: false } : l));
    for (const original of originals.sort((a, b) => (a.archiveOrigin?.index ?? 0) - (b.archiveOrigin?.index ?? 0))) {
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
          psd: () => photopeaLayerPsd(project.value ?? fresh),
          valid: () => project.value?.id === fresh.id,
          alive: () => project.value?.id === fresh.id,
          apply: async (result: PhotopeaLayerResult, binding) => {
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
            const { layers, changes } = applyPhotopeaReturn(cur.layers, decoded, binding);
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
              layers.flatMap((l) => l.groupIds?.map((_, i, ids) => groupKey(ids.slice(0, i + 1))) ?? []),
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
      const layer = p.layers.find((l) => l.id === id);
      const candidateId = layer?.candidateId;
      const rejection: RejectionChange | undefined =
        candidateId && !layer.archived
          ? {
              reason: 'deleted_layer',
              items: [{ id: candidateId, name: layer.name, preview: { width: layer.width, height: layer.height, data: layer.pixels } }],
            }
          : undefined;
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
    const updated = applyBrushStroke(layer, p.reference, brushMode, points, brushDiameter.value, brushHardness.value);
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
    const updated = applySmudgeStroke(layer, p.reference, points, brushDiameter.value, smudgeStrength.value);
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
    if (
      target === 'layers' &&
      (!now.layers.some((l) => l.id === id && !l.archived) || now.todos?.find((t) => t.id === parent?.id)?.layerId !== id)
    )
      return;
    mode.value = 'stack';
    betaTab.value = 'decompose';
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
    const nextOccluded = channel === 'occluded' ? channelData : p.occluded;
    let nextGuides = p.guides;
    let dirty = area;

    if (stamp && channel === 'alpha' && smartSnap.value) {
      const snapped = snapStroke({ ...p, reference: scalpelBase.value!.raster }, stamp, area, strokeDiameter, action === 'erase');
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
    if (
      scalpelLayerIds.value?.includes(id) ||
      project.value?.scalpelReferences?.some((r) => r.picture === layerPictureId(id))
    )
      return;
    if (scalpelOccluderIds.value.includes(id)) {
      scalpelOccluderIds.value = scalpelOccluderIds.value.filter((x) => x !== id);
    } else {
      scalpelOccluderIds.value = [...scalpelOccluderIds.value, id];
    }
    syncFields();
  }

  function showScalpelSource() {
    canvasRef.value?.cancelStroke();
    mode.value = 'scalpel';
    betaTab.value = 'scalpel';
    activeCandidateId.value = '';
    compareReference.value = false;
  }
  function setScalpelMode(missing: boolean) {
    const p = project.value;
    if (!p || busy.value || missingMode.value === missing) return;
    showScalpelSource();
    queueSave({
      ...p,
      scalpelMode: missing ? 'missing' : 'paint',
      missingLayerIds:
        missing && p.scalpelMode === undefined && p.missingLayerIds === undefined
          ? p.scalpelLayerIds?.slice()
          : p.missingLayerIds,
    });
  }
  function chooseScalpelLayers(ids?: string[]) {
    const p = project.value;
    if (!p || busy.value) return;
    if (ids?.some((id) => !p.layers.some((l) => l.id === id && !l.archived))) {
      error.value = '所选补画图层已删除或归档，请重新选择';
      return;
    }
    if (!missingMode.value && ids?.some((id) => scalpelOccluderIds.value.includes(id))) {
      error.value = '所选图层已用于排除遮挡，请先取消该用途';
      return;
    }
    showScalpelSource();
    const selected = ids?.slice().sort();
    queueSave(missingMode.value ? { ...p, missingLayerIds: selected } : { ...p, scalpelLayerIds: selected });
  }

  async function importScalpelFiles(files: File[]) {
    const id = project.value?.id;
    await runTask(async () => {
      const imported = [];
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw new Error(`「${file.name}」需要 PNG、JPEG 或 WebP 格式`);
        const blob = new Blob([await file.arrayBuffer()], { type: file.type });
        const image = await createImageBitmap(blob).catch(() => {
          throw new Error(`无法读取参考图「${file.name}」`);
        });
        imported.push({ id: crypto.randomUUID(), name: file.name, width: image.width, height: image.height, blob });
        image.close();
      }
      const p = project.value;
      if (!p || p.id !== id) return;
      queueSave({
        ...p,
        referenceFiles: [...(p.referenceFiles ?? []), ...imported],
        scalpelReferences: [
          ...(p.scalpelReferences ?? []),
          ...imported.map((f) => ({ picture: filePictureId(f.id), usage: '' })),
        ],
      });
    });
  }
  function removeScalpelReference(source: ReferenceSource) {
    const p = project.value;
    if (!p) return;
    queueSave({
      ...p,
      scalpelReferences: p.scalpelReferences?.filter((r) => r.picture !== source.picture),
      referenceFiles: p.referenceFiles?.filter((f) => filePictureId(f.id) !== source.picture),
    });
  }

  async function runTargetedReroll() {
    const p = project.value;
    const model = chosenRerollModel.value;
    if (!p || !model) {
      error.value = '请先在设置中配置支持图像编辑的模型';
      return;
    }
    if (!canTargetScalpel.value) {
      error.value = scalpelLayerIds.value ? '请先选择补画图层' : '请先涂抹需要局部补画的区域';
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
        rerollModel: rerollChoice.value?.id,
        rerollConnection: rerollChoice.value?.connection,
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
        scalpelBase.value,
      );
      request.signal.throwIfAborted();
      if (project.value?.id !== p.id) return;
      rerollCandidates.value = [...rerollCandidates.value, candidate];
      activeCandidateId.value = candidate.id;
      compareReference.value = false;
      queueSave({
        ...project.value,
        generationRounds: addGeneration(project.value, {
          source: 'scalpel',
          target: currentProject.scalpelName.trim() || '局部补画',
          model: candidate.model,
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
    const alignment = alignRasterToReference(variant.raster, cand.sourceReference ?? p.reference);
    if (!alignment.matched) {
      error.value = `未在原图中找到清晰匹配位置（匹配度 ${Math.round(alignment.confidence * 100)}%），可收纳后用「缩放对齐 (T)」手动微调`;
      return;
    }
    const tight = crop(variant.raster, alignment.sourceBox);
    const alignedCanvas = placeOnCanvas(tight, alignment.rect, p.reference.width, p.reference.height);
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
    const p = project.value,
      candidate = activeCandidate.value;
    if (!p || !candidate || busy.value) return;
    const round = p.generationRounds?.find((r) => r.candidateIds.includes(candidate.id));
    const variant = candidateVariant(candidate);
    const rejection: RejectionChange | undefined = p.layers.some((l) => l.candidateId === candidate.id)
      ? undefined
      : {
          reason: 'discarded_candidate',
          items: [{ id: candidate.id, name: round?.target ?? '局部补画', preview: variant.preview }],
        };
    const generationRounds = changeRejections(p.generationRounds, rejection);
    rerollCandidates.value = rerollCandidates.value.filter((c) => c.id !== candidate.id);
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
      betaTab.value = 'stack';
      stackTool.value = 'move';
      note.value = `已将「${poolItem.name}」收纳进正式图层栈`;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

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
          otherSplits = otherSplits?.map((s) =>
            s.batch.id === batchId ? { ...s, batch: { ...s.batch, order } } : s,
          );
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
      if (missingMode.value || !guideHistory.value) return;
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
      setReferenceView(!compareReference.value);
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
        ctx.scalpel.target = scalpelName.value;
        ctx.scalpel.missingModel = chosenMissingModel.value?.name;
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
          layers: reversedLayers.value
            .filter((l) => !l.archived)
            .map((l) => ({
              id: l.id,
              name: [...(l.groups ?? []), l.name].join(' / '),
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
          const stored = await saveActive(applyLayerEdits(project.value, patch, undo, chosenRerollModel.value));
          project.value = committed = stored;
        } finally {
          busy.value = false;
        }
        loadForm(project.value);
        scalpelInstruction.value = project.value.scalpelInstruction;
        scalpelName.value = project.value.scalpelName;
        if (patch.edits.some((e) => e.kind === 'scalpelSource' || e.kind === 'scalpelSetup')) showScalpelSource();
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
    void runTask(async () => {
      saved.value = await store.list();
      if (props.sourceKey?.startsWith('layer:')) await loadProject(props.sourceKey.split(':')[1]);
      else if (props.source) await start(props.source.blob, props.source.name, props.source.recordId, true);
      else if (saved.value.length) await loadProject(saved.value[0].id);
    });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', protectUnsaved);
    detachPlanning?.();
    controller?.abort();
    importLifetime.abort();
  });

  async function readyToClose(): Promise<boolean> {
    if (await settled()) return true;
    return ui.confirm({
      title: '放弃本页未保存的分件修改？',
      message: '可以返回工作台重试保存，或先导出已收纳图层的 PSD。',
      confirmLabel: '放弃修改并退出',
    });
  }

  function cancelStroke() {
    canvasRef.value?.cancelStroke();
  }

  function usePromptTemplate() {
    const p = project.value;
    if (!p) return;
    decomposePrompt.value =
      scope.value === 'master'
        ? macroPrompt
        : partPrompt(
            p.layers
              .filter((l) => sourceIds.value.includes(l.id))
              .map((l) => l.name)
              .join(' + ') || '局部',
          );
    syncFields();
  }

  const workspace = {
    props,
    emit,
    picker,
    layerFileAccept,
    png,
    layerVisible,
    layerPictureId,
    project,
    saved,
    busy,
    activeRequest,
    saving,
    progress,
    note,
    error,
    saveError,
    splitInputDialog,
    mode,
    betaTab,
    selectBetaTab,
    selectTraditionalMode,
    stackTool,
    guideTool,
    activeTool,
    commitMove,
    compareReference,
    mat,
    brushDiameter,
    brushHardness,
    smudgeStrength,
    guideDiameter,
    erasingGuide,
    smartSnap,
    activeLayerId,
    revealTarget,
    soloLayerId,
    soloGroupKey,
    collapsedGroups,
    recentChanges,
    renamingId,
    renameDraft,
    renamingGroupKey,
    renamingGroupPath,
    groupRenameDraft,
    draggingLayerId,
    dragOverLayerId,
    pendingRect,
    pendingLasso,
    poolBatch,
    candidatePool,
    poolSelected,
    poolVisibleIds,
    poolSoloId,
    fittingId,
    maskChoices,
    poolStageActive,
    poolDrag,
    poolOrder,
    poolFrontFirst,
    showingReference,
    decomposeConfigOpen,
    scope,
    sourceIds,
    multiIds,
    multiSelect,
    archiveSource,
    decomposePrompt,
    decomposeMax,
    decomposeUnlimited,
    splitCountMax, splitAllowsAuto, displayedSplitCount,
    splitSizeOptions, displayedSplitSize,
    decomposeChoice,
    scalpelName,
    scalpelInstruction,
    scalpelOccluderIds,
    rerollChoice,
    scalpelFraming,
    rerollCandidates,
    activeCandidateId,
    rerollResultMode,
    canvasRef,
    referenceFile,
    importLayerInput,
    errorBox,
    splitForm,
    reference,
    missingMode,
    missingLayerIds,
    scalpelLayerIds,
    scalpelBase,
    rejectedCount,
    transparent,
    reversedLayers,
    activeLayer,
    activeLayerIndex,
    visibleLayerCount,
    soloLayerIds,
    stackDisplayItems,
    decomposeModels,
    rerollModels,
    chosenDecomposeModel,
    missingModels,
    chosenMissingModel,
    chosenRerollModel,
    modelKey,
    selectValue,
    modelOptionLabel,
    chooseLayerModel,
    selectLayerModel,
    hasScalpelGuide,
    canTargetScalpel,
    referenceChoices,
    excludedReferences,
    inputLayout,
    activeCandidate,
    candidateSize,
    downloadRawCandidate,
    candidateVariant,
    previewRaster,
    previewLayers,
    regionPick,
    showViewSwitch,
    showingResult,
    setReferenceView,
    showLayerResult,
    stageProject,
    allPoolVisible,
    canUndo,
    canRedo,
    hasPendingSelection,
    upscaledLayerCount,
    transformBox,
    transformLockAspect,
    transformGhostRef,
    transformOpacity,
    transformDraft,
    queueSave,
    retrySave,
    chooseRect,
    focusSplit,
    switchPool,
    savePool,
    syncFields,
    clearLayerCache,
    clearError,
    switchProject,
    openReferenceFile,
    loadReferenceFile,
    onImportLayerFiles,
    runDecompose,
    setRegionDestination,
    applyPoolOrder,
    startPoolDrag,
    overPoolRow,
    leavePool,
    dropPoolRow,
    togglePoolSelect,
    selectAllPool,
    adjustCandidate,
    toggleAllPoolVisible,
    togglePoolVisible,
    togglePoolSolo,
    admitSelectedPool,
    discardPool,
    selectLayer,
    groupMemberIds,
    restoreSource,
    onToggleVisible,
    onToggleSolo,
    onToggleGroupCollapse,
    onToggleGroupVisible,
    onToggleGroupSolo,
    startRenameGroup,
    commitRenameGroup,
    onUngroup,
    onDeleteGroup,
    openInPhotopea,
    onToggleLock,
    startRename,
    commitRename,
    onMoveOrder,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onDuplicate,
    onMergeDown,
    onDelete,
    downloadSingleLayer,
    onCanvasBrush,
    onCanvasSmudge,
    onCanvasOffset,
    clearPendingSelection,
    executeSplitSelection,
    onAlignTone,
    onRestoreUnoccludedMaster,
    onRestoreAllMaster,
    enterTransformMode,
    exitTransformMode,
    onTransformDraftChange,
    commitTransformDraft,
    onTransformDimension,
    onTransformCoord,
    applyLayerTransform,
    fitLayerToCanvas,
    onAutoAlignLayer,
    onGuideStroke,
    clearScalpelGuides,
    toggleOccluder,
    setScalpelMode,
    chooseScalpelLayers,
    importScalpelFiles,
    removeScalpelReference,
    runTargetedReroll,
    alignActiveCandidate,
    discardActiveCandidate,
    admitActiveCandidate,
    undoRedo,
    onKeyDown,
    exportRigZip,
    exportRigFolder,
    exportPsd,
    stopCurrent,
    readyToClose,
    cancelStroke,
    usePromptTemplate,
  };

  provide(LAYER_WORKSPACE_KEY, workspace);
  return workspace;
}

export type LayerWorkspace = ReturnType<typeof createLayerWorkspace>;

const LAYER_WORKSPACE_KEY: InjectionKey<LayerWorkspace> = Symbol('koma-layer-workspace');

export function useLayerWorkspace(): LayerWorkspace {
  const ctx = inject(LAYER_WORKSPACE_KEY);
  if (!ctx) throw new Error('Layer workspace context is missing');
  return ctx;
}
