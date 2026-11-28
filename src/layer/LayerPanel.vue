<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import LayerCanvas from './LayerCanvas.vue';
import LayerDecomposeView from './LayerDecomposeView.vue';
import LayerEmptyState from './LayerEmptyState.vue';
import LayerHeader from './LayerHeader.vue';
import LayerInspector from './LayerInspector.vue';
import LayerScalpelView from './LayerScalpelView.vue';
import LayerStackView from './LayerStackView.vue';
import LayerStageDock from './LayerStageDock.vue';
import SplitInputDialog from './SplitInputDialog.vue';
import { createLayerWorkspace, type LayerWorkspaceProps } from './use-layer-workspace.ts';

const props = defineProps<LayerWorkspaceProps>();

const emit = defineEmits<{
  size: [{ width: number; height: number }];
  close: [];
  collapseRail: [];
  panel: [];
  locateForm: [];
  todos: [projectId: string];
  reviewRejections: [];
  askScalpel: [action?: 'layers' | 'missing'];
  background: [source: Blob];
  zoomStep: [direction: 1 | -1];
  zoomFit: [];
  zoomActual: [];
  stateChange: [state: { hasProject: boolean; busy: boolean }];
}>();

const ws = createLayerWorkspace(props, emit);
const {
  project,
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
  activeTool,
  activeLayerId,
  soloLayerIds,
  showingReference,
  previewRaster,
  previewLayers,
  commitMove,
  stackTool,
  transformDraft,
  transformLockAspect,
  transformGhostRef,
  transformOpacity,
  mat,
  brushDiameter,
  guideDiameter,
  brushHardness,
  smudgeStrength,
  erasingGuide,
  smartSnap,
  missingMode,
  scalpelBase,
  scalpelLayerIds,
  stageProject,
  regionPick,
  transparent,
  rejectedCount,
  scope,
  poolBatch,
  chosenDecomposeModel,
  chosenMissingModel,
  chosenRerollModel,
  missingLayerIds,
  scalpelName,
  canTargetScalpel,
  inputLayout,
} = ws;

const showAiFooter = computed(() =>
  props.coCreate ? betaTab.value === 'decompose' || betaTab.value === 'scalpel' : true,
);
const showDecomposeFooter = computed(() =>
  props.coCreate ? betaTab.value === 'decompose' : mode.value === 'stack',
);
const showStackInTray = computed(() => props.coCreate && betaTab.value === 'stack');

const primaryLabel = computed(() => {
  if (showDecomposeFooter.value) {
    if (activeRequest.value === 'decompose') return '正在拆层…';
    return scope.value === 'master' ? (poolBatch.value ? '重新拆层' : '一键总拆') : '开始细拆';
  }
  if (missingMode.value) return activeRequest.value === 'decompose' ? '正在生成缺失件…' : '生成缺失件';
  return activeRequest.value === 'reroll' ? '正在补画…' : '生成透明部件';
});

const primaryDisabled = computed(() => {
  if (showDecomposeFooter.value) return busy.value || !chosenDecomposeModel.value;
  if (missingMode.value)
    return busy.value || !chosenMissingModel.value || missingLayerIds.value?.length === 0 || !scalpelName.value.trim();
  return busy.value || !canTargetScalpel.value || !chosenRerollModel.value || !!inputLayout.value.issue;
});

const runningPrimary = computed(() =>
  showDecomposeFooter.value
    ? activeRequest.value === 'decompose'
    : missingMode.value
      ? activeRequest.value === 'decompose'
      : activeRequest.value === 'reroll',
);

function runPrimaryAction() {
  if (showDecomposeFooter.value) void ws.runDecompose();
  else if (missingMode.value) void ws.runDecompose(true);
  else void ws.runTargetedReroll();
}

defineExpose({
  readyToClose: ws.readyToClose,
  shortcut: ws.onKeyDown,
  cancelStroke: ws.cancelStroke,
  openInPhotopea: ws.openInPhotopea,
  openFile: ws.openReferenceFile,
});
</script>

<template>
  <!-- Left column (Traditional) / Right Glass Tray (BETA) when a project is open; centered darkroom canvas when empty (Plan A) -->
  <Teleport :to="props.emptyHost || 'body'" :disabled="!!project || !props.emptyHost">
    <section
      class="layer-panel"
      :class="{ 'is-beta': props.coCreate, 'is-empty': !project }"
      aria-label="Koma Layer 分件工作台"
      :aria-busy="busy || saving"
    >
      <input
        :ref="(el) => (ws.referenceFile.value = (el as HTMLInputElement | null) ?? undefined)"
        type="file"
        :accept="ws.layerFileAccept"
        aria-label="打开定稿"
        hidden
        @change="ws.loadReferenceFile"
      />
      <input
        :ref="(el) => (ws.importLayerInput.value = (el as HTMLInputElement | null) ?? undefined)"
        type="file"
        :accept="ws.layerFileAccept"
        multiple
        aria-label="导入图像为图层"
        hidden
        @change="ws.onImportLayerFiles"
      />

      <LayerEmptyState v-if="!project" />

      <template v-else>
      <!-- Mode / View Switch Header -->
      <header class="layer-panel-head">
        <!-- BETA single-tray: 3 focused views -->
        <div
          v-if="props.coCreate"
          class="seg layer-mode-tabs is-three"
          role="tablist"
          aria-label="分件工作模式"
        >
          <button
            type="button"
            role="tab"
            class="layer-tab-btn"
            :aria-selected="betaTab === 'stack'"
            @click="ws.selectBetaTab('stack')"
          >
            <AppIcon name="i-layers" />
            <span>图层</span>
            <b v-if="project.layers.length" class="layer-tab-count mono">{{ project.layers.length }}</b>
          </button>
          <button
            type="button"
            role="tab"
            class="layer-tab-btn"
            :aria-selected="betaTab === 'decompose'"
            @click="ws.selectBetaTab('decompose')"
          >
            <AppIcon name="i-branch" />
            <span>拆层</span>
            <i v-if="poolBatch" class="layer-tab-dot" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            role="tab"
            class="layer-tab-btn"
            :aria-selected="betaTab === 'scalpel'"
            @click="ws.selectBetaTab('scalpel')"
          >
            <AppIcon name="i-dt-wand" />
            <span>局部补画</span>
          </button>
        </div>

        <!-- Traditional left column: 2 AI task views (Right rail permanently displays Layer Stack) -->
        <div v-else class="seg layer-mode-tabs" role="tablist" aria-label="分件工作模式">
          <button
            type="button"
            role="tab"
            class="layer-tab-btn"
            :aria-selected="mode === 'stack'"
            @click="ws.selectTraditionalMode('stack')"
          >
            <AppIcon name="i-layers" />
            <span>自动拆层</span>
            <i v-if="poolBatch" class="layer-tab-dot" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            role="tab"
            class="layer-tab-btn"
            :aria-selected="mode === 'scalpel'"
            @click="ws.selectTraditionalMode('scalpel')"
          >
            <AppIcon name="i-dt-wand" />
            <span>局部补画</span>
          </button>
        </div>
      </header>

      <!-- BETA Stack Tab: dedicated full-height independent-scroll tree + bottom drawer -->
      <div v-if="showStackInTray" class="layer-tray-stack">
        <div
          v-if="!transparent || project.todos?.length || rejectedCount || saveError || error || note"
          class="layer-tray-notices"
        >
          <div v-if="!transparent" class="layer-banner" role="note">
            <span>定稿无透明外缘，可直接拆层{{ props.backgroundAvailable ? '或先去底' : '' }}。</span>
            <button
              v-if="props.backgroundAvailable"
              type="button"
              class="btn-link layer-banner-act"
              @click="emit('background', ws.png(project.reference))"
            >
              <AppIcon name="i-dt-background" />
              先去底
            </button>
          </div>
          <div v-if="project.todos?.length || rejectedCount" class="layer-ask-strip">
            <button
              v-if="project.todos?.length"
              type="button"
              class="layer-ask-chip"
              @click="emit('todos', project.id)"
            >
              <AppIcon name="i-tasks" />
              <span>在 ASK 查看拆件待办</span>
              <small class="mono">{{ project.todos.filter((t) => t.done).length }}/{{ project.todos.length }}</small>
            </button>
            <button
              v-if="rejectedCount"
              type="button"
              class="layer-ask-chip"
              @click="emit('reviewRejections')"
            >
              <AppIcon name="i-ask" />
              <span>让 ASK 查看淘汰图</span>
              <small class="mono">{{ rejectedCount }}</small>
            </button>
          </div>
          <div
            v-if="saveError || error"
            :ref="(el) => (ws.errorBox.value = (el as HTMLElement | null) ?? undefined)"
            class="quota-warning editor-err layer-alert"
            role="alert"
          >
            <AppIcon name="i-alert" />
            <span>{{ saveError || error }}</span>
            <button
              v-if="saveError"
              type="button"
              class="btn btn-quiet btn-sm layer-retry-btn"
              :disabled="saving || busy"
              @click="ws.retrySave()"
            >
              重试保存
            </button>
          </div>
          <p v-else-if="note" class="layer-note" role="status">
            <AppIcon name="i-success" />
            <span>{{ note }}</span>
          </p>
        </div>

        <div class="layer-tray-tree">
          <LayerStackView />
        </div>
      </div>

      <!-- Scrollable AI Form Body (Decompose / Scalpel) -->
      <div v-else class="composer-scroll layer-scroll">
        <fieldset class="layer-content" :disabled="busy && !activeRequest">
          <div v-if="!transparent" class="layer-banner" role="note">
            <span>定稿无透明外缘，可直接拆层{{ props.backgroundAvailable ? '或先去底' : '' }}。</span>
            <button
              v-if="props.backgroundAvailable"
              type="button"
              class="btn-link layer-banner-act"
              @click="emit('background', ws.png(project.reference))"
            >
              <AppIcon name="i-dt-background" />
              先去底
            </button>
          </div>

          <div v-if="project.todos?.length || rejectedCount" class="layer-ask-strip">
            <button
              v-if="project.todos?.length"
              type="button"
              class="layer-ask-chip"
              @click="emit('todos', project.id)"
            >
              <AppIcon name="i-tasks" />
              <span>在 ASK 查看拆件待办</span>
              <small class="mono">{{ project.todos.filter((t) => t.done).length }}/{{ project.todos.length }}</small>
            </button>
            <button
              v-if="rejectedCount"
              type="button"
              class="layer-ask-chip"
              @click="emit('reviewRejections')"
            >
              <AppIcon name="i-ask" />
              <span>让 ASK 查看淘汰图</span>
              <small class="mono">{{ rejectedCount }}</small>
            </button>
          </div>

          <div
            v-if="saveError || error"
            :ref="(el) => (ws.errorBox.value = (el as HTMLElement | null) ?? undefined)"
            class="quota-warning editor-err layer-alert"
            role="alert"
          >
            <AppIcon name="i-alert" />
            <span>{{ saveError || error }}</span>
            <button
              v-if="saveError"
              type="button"
              class="btn btn-quiet btn-sm layer-retry-btn"
              :disabled="saving || busy"
              @click="ws.retrySave()"
            >
              重试保存
            </button>
          </div>
          <p v-else-if="note" class="layer-note" role="status">
            <AppIcon name="i-success" />
            <span>{{ note }}</span>
          </p>

          <template v-if="props.coCreate">
            <LayerDecomposeView v-if="betaTab === 'decompose'" />
            <LayerScalpelView v-else />
          </template>
          <template v-else>
            <LayerDecomposeView v-if="mode === 'stack'" />
            <LayerScalpelView v-else />
          </template>
        </fieldset>
      </div>

      <!-- Fixed Action Footer: AI generation -->
      <footer
        v-if="showAiFooter"
        class="composer-foot generation-form layer-foot"
        :aria-busy="runningPrimary"
      >
        <p v-if="progress" class="layer-progress-line" role="status">{{ progress }}</p>
        <div class="go-row">
          <button
            type="button"
            class="btn btn-primary btn-go layer-go-btn"
            :disabled="primaryDisabled"
            @click="runPrimaryAction"
          >
            <AppIcon class="solid" name="i-generate" />
            <span class="go-spin"></span>
            <span aria-live="polite">{{ primaryLabel }}</span>
          </button>
          <button
            type="button"
            class="btn btn-stop"
            :hidden="!runningPrimary"
            @click="ws.stopCurrent()"
          >
            <AppIcon name="i-stop" />
            {{ showDecomposeFooter ? '取消拆层' : '取消生成' }}
          </button>
        </div>
      </footer>

      <!-- Fixed Stack Footer in BETA Tray: clean 2-row active bar + split export -->
      <LayerInspector v-else-if="showStackInTray" />
    </template>
    </section>
  </Teleport>

  <!-- Traditional Right Rail: independent scrollable Layer Tree + clean 2-row footer -->
  <Teleport v-if="!props.coCreate && props.railHost && project" :to="props.railHost">
    <div class="layer-rail-panel" :aria-busy="busy || saving">
      <div class="layer-rail-tree">
        <LayerStackView />
      </div>
      <LayerInspector />
    </div>
  </Teleport>

  <LayerHeader />
  <LayerStageDock />

  <SplitInputDialog
    v-if="splitInputDialog"
    :input="splitInputDialog.input"
    :models="splitInputDialog.models"
    @choose="splitInputDialog.finish"
  />

  <!-- Main Stage Canvas Teleport -->
  <Teleport v-if="props.stage && project && stageProject" :to="props.stage">
    <LayerCanvas
      :key="project.id"
      :ref="(el) => (ws.canvasRef.value = (el as InstanceType<typeof LayerCanvas> | null) ?? undefined)"
      :project="stageProject"
      :region-pick="regionPick"
      :mode="mode"
      :scalpel-raster="mode === 'scalpel' && !missingMode ? scalpelBase?.raster : undefined"
      :tool="activeTool"
      :active-layer-id="activeLayerId"
      :solo-layer-ids="soloLayerIds"
      :compare-reference="showingReference"
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
      :busy="busy || (mode === 'scalpel' && scalpelLayerIds?.length === 0)"
      @brush="ws.onCanvasBrush"
      @smudge="ws.onCanvasSmudge"
      @offset="ws.onCanvasOffset"
      @select-layer="ws.selectLayer"
      @transform-change="ws.onTransformDraftChange"
      @selection-rect="ws.chooseRect"
      @selection-lasso="ws.pendingLasso.value = $event"
      @guide-stroke="ws.onGuideStroke"
    />
  </Teleport>
</template>

<style scoped>
.layer-panel,
.layer-rail-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  min-width: 0;
  min-height: 0;
  color: var(--fg);
}

.layer-rail-panel {
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}

.layer-rail-tree,
.layer-tray-tree {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.layer-tray-stack {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.layer-tray-stack:not(:has(> .layer-tray-notices)) {
  grid-template-rows: minmax(0, 1fr);
}
.layer-tray-notices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 14px 6px;
}

.layer-panel.is-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.layer-panel-head {
  flex: none;
  padding: 10px var(--sp-4) 6px;
}

.layer-panel.is-beta .layer-panel-head {
  padding: 10px 14px 6px;
}

.layer-mode-tabs {
  grid-template-columns: repeat(2, 1fr);
}
.layer-mode-tabs.is-three {
  grid-template-columns: repeat(3, 1fr);
}

.layer-tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--r1);
  color: var(--seg-ink);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  --ico: var(--ico-sm);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.layer-tab-btn:hover {
  color: var(--fg-2);
}
.layer-tab-btn[aria-selected='true'] {
  background: var(--seg-active-bg);
  color: var(--seg-active-ink);
  font-weight: var(--fw-semibold);
  box-shadow: var(--seg-active-shadow);
}
.layer-tab-btn[aria-selected='true'] > .ico {
  color: var(--a);
}
.layer-tab-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--a-line);
}

.layer-tab-count {
  font-size: var(--fz-2xs);
  font-weight: var(--fw-medium);
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}

.layer-tab-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--a);
  flex: none;
}

.layer-scroll {
  --section: 14px;
  padding: 6px var(--sp-4) var(--sp-4);
  gap: 14px;
}

.layer-panel.is-beta .layer-scroll {
  padding: 4px 14px 16px;
}

.layer-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}

.layer-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r2);
  background: var(--well);
  font-size: var(--fz-xs);
  color: var(--fg-2);
}
.layer-banner-act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  --ico: var(--ico-sm);
}

.layer-ask-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.layer-ask-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 6px;
  border-radius: var(--r1);
  color: var(--fg-3);
  font-size: var(--fz-2xs);
  font-weight: var(--fw-medium);
  --ico: var(--ico-sm);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-ask-chip:hover {
  color: var(--a);
  background: var(--a-dim);
}
.layer-ask-chip small {
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}

.layer-alert {
  align-items: center;
}
.layer-retry-btn {
  flex: none;
  padding: 3px 8px;
}

.layer-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 6px 8px;
  border-radius: var(--r2);
  background: color-mix(in srgb, var(--ok) 10%, transparent);
  color: var(--fg-2);
  font-size: var(--fz-xs);
  line-height: 1.45;
  --ico: var(--ico-sm);
}
.layer-note > .ico {
  color: var(--ok);
}

.layer-foot {
  padding: 10px var(--sp-4) 12px;
  border-top: 1px solid var(--line);
}

.layer-panel.is-beta .layer-foot {
  padding: 10px 14px 12px;
  background: var(--glass-layer);
  border-top-color: var(--line);
}

.layer-progress-line {
  margin: 0 0 2px;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-go-btn {
  justify-content: center;
  gap: 8px;
  height: 42px;
  font-size: var(--fz-sm);
}
.layer-foot .btn-stop {
  height: 42px;
  font-size: var(--fz-xs);
}
</style>
