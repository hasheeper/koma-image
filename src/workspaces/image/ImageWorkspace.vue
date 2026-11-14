<script setup lang="ts">
import { computed, shallowRef, watch, nextTick, onBeforeUnmount } from "vue";
import { useSlates } from "../../app/slate";
const slates = useSlates();
import { useShell } from "../../app/shell";
import { useAskPresentation } from "../../ask/presentation";
const { fullscreen: askFullscreen, canvas, selectCanvasPanel } = useAskPresentation();
const { active: coCreate } = canvas;
/* The compact pane covers and pauses the stage until it is closed. */
const compactPanel = canvas.covered;
const recipeHost = shallowRef<HTMLElement | null>(null);
watch(recipeHost, host => { canvas.recipeHost.value = host; });
const askHost = shallowRef<HTMLElement | null>(null), graphHost = shallowRef<HTMLElement | null>(null), imageActions = shallowRef<HTMLElement | null>(null);
watch([askHost, graphHost, imageActions], ([ask, graph, actions]) => { canvas.askHost.value = ask; canvas.graphHost.value = graph; canvas.actionsHost.value = actions; });
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import AppIcon from "../../shared/AppIcon.vue";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import WalletDisplay from "../../shared/WalletDisplay.vue";
import ThemeToggle from "../../shared/ThemeToggle.vue";
import ImageLibrary from "./ImageLibrary.vue";
import BoardSwitcher from "./BoardSwitcher.vue";
import CharactersEditor from "../../shared/nai/CharactersEditor.vue";
import PromptDraft from "./PromptDraft.vue";
import DrawingParameters from "./DrawingParameters.vue";
import DrawingBottomPanel from "../../shared/nai/DrawingBottomPanel.vue";
import DrawingControls from "./DrawingControls.vue";
import NaiTokenCount from "../../shared/nai/NaiTokenCount.vue";
import { naiInputLimits } from "../../domain/nai-input";
import { effectiveNaiMode, naiCapabilities } from "../../domain/nai";
import { usePopover } from "../../shared/ui/use-popover";
import { installCanvasSplitter } from "../../native/canvas-splitter";
import CanvasPanelSwitch from "../../shared/ui/CanvasPanelSwitch.vue";
import { useTransientMark } from "../../shared/ui/use-transient-mark";
import ModelField from "../../shared/nai/ModelField.vue";
import ImageStage from "./ImageStage.vue";
import ImportSheet from "./ImportSheet.vue";
import { useDrawing } from "../../app/drawing";
import { sizeProblem } from "../../domain/drawing";
import { quoteLabel } from "../../domain/quote";
import { useServices } from "../../app/services";
import { names } from "../../storage/names";
import { object } from "../../domain/value";
const { preferences } = useServices();
import { installSplitter } from "../../native/splitter";
const { drawing, view } = useDrawing();
const summaryModel = computed(() => view.value.model?.name ?? '未配置模型');
const summaryModelShort = computed(() => summaryModel.value.replace(/^NAI Diffusion\s+/, ''));
const summaryMode = computed(() => naiCapabilities(view.value.form.model).supported ? effectiveNaiMode(view.value.form.naiMode, view.value.form.prompt) : null);
const importSheet = shallowRef<InstanceType<typeof ImportSheet> | null>(null);
const splitter = shallowRef<HTMLElement | null>(null);
const bottomPanel = shallowRef<InstanceType<typeof DrawingBottomPanel>>();
const foot = shallowRef<HTMLElement | null>(null);
const { image, narrow } = useShell();
const main = shallowRef<HTMLElement | null>(null), canvasLeft = shallowRef<HTMLElement | null>(null);

const navHome = shallowRef<HTMLElement | null>(null), navFloat = shallowRef<HTMLElement | null>(null), quickAccount = shallowRef<HTMLElement | null>(null);
const navTarget = computed(() => coCreate.value ? navFloat.value : navHome.value);
const account = shallowRef<HTMLElement | null>(null);
const composerScroll = shallowRef<HTMLElement | null>(null);
const filmstrip = shallowRef<HTMLElement | null>(null), canvasFoot = shallowRef<HTMLElement | null>(null), canvasBottom = shallowRef<HTMLElement | null>(null);
const historyTray = shallowRef<HTMLElement | null>(null);
const imageHistoryHost = shallowRef<HTMLElement | null>(null);
const mobileHistory = computed(() => coCreate.value && canvas.compact.value);
const mobileHistoryOpen = shallowRef(false);
const graphScene = computed(() => coCreate.value && canvas.view.value === 'graph' && !!canvas.recordId.value);
const historyTarget = computed(() => mobileHistory.value ? null : canvas.view.value === 'node' && canvas.recordId.value ? canvas.historyHost.value : imageHistoryHost.value);
const libraryExpanded = computed(() => coCreate.value && !mobileHistory.value && canvas.filmstripOpen.value && !graphScene.value && (image.library === 'favorites' ? view.value.favorites.length > 0 : view.value.history.length > 0 || !!view.value.pending));
watch(libraryExpanded, visible => { canvas.historyVisible.value = visible; }, { immediate: true });
watch([mobileHistory, graphScene, compactPanel, () => view.value.activeBoardId], () => {
  mobileHistoryOpen.value = false;
});
/* Only a user's opening of the desktop groove animates it in. */
const grooveMotion = useTransientMark();
function expandLibrary(open: boolean) {
  if (mobileHistory.value) { quick.close(); mobileHistoryOpen.value = open; }
  else { canvas.setFilmstripOpen(open); if (open) grooveMotion.mark(); }
}
function browseImage() { canvas.view.value = 'image'; mobileHistoryOpen.value = false; }
const formHome = shallowRef<HTMLElement | null>(null), formSide = shallowRef<HTMLElement | null>(null);
const boardHome = shallowRef<HTMLElement | null>(null), boardHead = shallowRef<HTMLElement | null>(null);
const modelHome = shallowRef<HTMLElement | null>(null), sizeHome = shallowRef<HTMLElement | null>(null);
const quickModel = shallowRef<HTMLElement | null>(null), quickSize = shallowRef<HTMLElement | null>(null);
const quickPanel = shallowRef<HTMLElement | null>(null), summaryButton = shallowRef<HTMLElement | null>(null);
const canvasSplitter = shallowRef<HTMLElement | null>(null);
const sidebar = shallowRef<HTMLElement | null>(null), panelSwitch = shallowRef<InstanceType<typeof CanvasPanelSwitch> | null>(null);
const panelSwitchHome = shallowRef<HTMLElement | null>(null), panelSwitchSide = shallowRef<HTMLElement | null>(null);
const panelSwitchTarget = computed(() => compactPanel.value ? panelSwitchSide.value : panelSwitchHome.value);
const contextOpen = computed(() => coCreate.value && canvas.panel.value === 'context');
const formOpen = computed(() => contextOpen.value && canvas.contextKind.value === 'form');
/* What the tray displays: the chosen pane, retained until the tray finishes leaving. */
const contextShown = computed(() => coCreate.value && canvas.shownPanel.value === 'context');
const formShown = computed(() => contextShown.value && canvas.contextKind.value === 'form');
const panelOptions = computed(() => [
  { value: 'context', id: 'canvasContextToggle', label: contextLabel.value, icon: canvas.contextKind.value === 'recipe' ? 'i-layers' : 'i-menu', controls: canvas.contextKind.value === 'recipe' ? 'canvasRecipe' : 'canvasForm' },
  { value: 'ask', label: 'ASK', icon: 'i-ask', controls: 'askDrawer' },
]);
const contextLabel = computed(() => canvas.contextKind.value === 'recipe' ? '配方' : '表单');
const quick = usePopover(quickPanel, { position() {
  const trigger = summaryButton.value?.getBoundingClientRect();
  if (trigger && quickPanel.value) {
    const width = Math.min(320, innerWidth - 16);
    quickPanel.value.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, trigger.right - width))}px`;
    quickPanel.value.style.top = `${trigger.bottom + 6}px`;
  }
}, resize: 'close' });
const libraryTarget = computed(() => coCreate.value ? filmstrip.value : main.value);
const formTarget = computed(() => coCreate.value ? formSide.value : formHome.value);
const boardTarget = computed(() => coCreate.value ? boardHead.value : boardHome.value);
const goTarget = computed(() => coCreate.value ? canvasFoot.value : foot.value);
const modelTarget = computed(() => quick.open.value ? quickModel.value : modelHome.value);
const sizeTarget = computed(() => quick.open.value ? quickSize.value : sizeHome.value);
function closeForm() { canvas.panel.value = null; }
async function selectPanel(panel: 'ask' | 'context') {
  quick.close();
  selectCanvasPanel(canvas, panel);
  if (formOpen.value && !canvas.compact.value) {
    await nextTick();
    document.getElementById('prompt')?.focus({ preventScroll: true });
  }
}
watch(contextOpen, open => {
  if (!open && !canvas.panel.value && sidebar.value?.contains(document.activeElement))
    void nextTick(() => panelSwitch.value?.focus('context'));
});
watch(coCreate, () => { quick.close(); image.zoom = false; bottomPanel.value?.close(); });
watch(() => view.value.activeBoardId, () => { quick.close(); });
watch(canvas.contextKind, () => { quick.close(); bottomPanel.value?.close(); });
const accountTarget = computed(() => coCreate.value ? quickAccount.value : account.value);
const lockTarget = computed(() => coCreate.value ? quickAccount.value : account.value);
const lifecycle = useWorkspaceLifecycle("image", [composerScroll]);
watch(
  () => view.value.state,
  (value) => {
    image.state = value;
  },
  { immediate: true },
);
const valid = computed(
  () =>
    !!view.value.model && !view.value.referenceProblem && !view.value.characterProblem &&
    !sizeProblem(
      view.value.form.width,
      view.value.form.height,
      view.value.model.maxPixels,
    ).fatal,
);
const leave = (event: BeforeUnloadEvent) => {
  if (drawing.hasUnsaved()) {
    event.preventDefault();
    event.returnValue = "";
  }
};
window.addEventListener("beforeunload", leave);
onBeforeUnmount(() => window.removeEventListener("beforeunload", leave));
lifecycle.whileActive((signal) => {
  if (canvasSplitter.value && main.value) installCanvasSplitter(canvasSplitter.value, main.value, () => canvas.ratio.value, canvas.setRatio, signal);
  if (splitter.value) {
    installSplitter(splitter.value, signal);
    splitter.value.addEventListener(
      "widthcommit",
      (e) => {
        void preferences.set(names.preferences, {
          ...object(preferences.get(names.preferences, {})),
          rail: (e as CustomEvent<number>).detail,
        });
      },
      { signal },
    );
  }
  const dockObserver = new ResizeObserver(() => {
    if (coCreate.value && canvasBottom.value?.offsetHeight) canvasLeft.value?.style.setProperty('--canvas-dock-space', `${canvasBottom.value.offsetHeight + 24}px`);
  });
  if (canvasBottom.value) dockObserver.observe(canvasBottom.value);
  const sizeViewport = () => {
    if (coCreate.value && canvas.compact.value && window.visualViewport)
      main.value?.style.setProperty('--canvas-viewport-height', `${window.visualViewport.height}px`);
    else main.value?.style.removeProperty('--canvas-viewport-height');
  };
  const stopViewport = watch([coCreate, canvas.compact], sizeViewport, { immediate: true });
  window.visualViewport?.addEventListener('resize', sizeViewport, { signal });
  signal.addEventListener(
    "abort",
    () => {
      dockObserver.disconnect(); stopViewport();
      main.value?.style.removeProperty('--canvas-viewport-height');
    },
    { once: true },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.defaultPrevented || event.isComposing ||
        document.querySelector("dialog:modal, :popover-open")
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!view.value.busy && !image.importing) void drawing.run();
      }
      if (event.key === "Escape") {
        if (formOpen.value) { event.preventDefault(); if (!bottomPanel.value?.close()) closeForm(); }
        else if (image.importing) importSheet.value?.close();
        else if (bottomPanel.value?.close()) {}
        else if (image.zoom) image.zoom = false;
        else if (view.value.browsing && view.value.pending) drawing.live();
        else if (view.value.busy) drawing.cancel();
      }
    },
    { signal },
  );
});
</script>
<template>
  <header v-show="!coCreate" class="topbar image-topbar" :inert="askFullscreen">
    <div ref="navHome" class="canvas-nav-home"></div>
    <div class="topbar-menu">
      <div
        id="topbarActions"
        class="topbar-end"
        role="group"
        aria-label="菜单"
      >
        <div class="topbar-tools"></div>
      </div>
    </div>
    <div ref="account" class="topbar-account"></div>
  </header>
  <main ref="main" class="shell" :class="{ 'canvas-layout': coCreate, 'canvas-collaboration': coCreate, 'sidebar-collapsed': coCreate && !canvas.trayHeld.value }" :style="{ '--canvas-ask-width': `${canvas.ratio.value * 100}%` }" data-workspace-root="image" :inert="askFullscreen">
    <div ref="formHome" class="form-home"></div>
    <Teleport v-if="formTarget" :to="formTarget">
    <form
      class="composer generation-form"
      v-show="!coCreate || formShown"
      id="form"
      @submit.prevent="drawing.run"
      :aria-busy="view.busy"
    >
      <div ref="composerScroll" class="composer-scroll">
        <div ref="boardHome" class="composer-slot"></div>
        <div ref="modelHome" class="composer-slot"></div>
        <PromptDraft
          :key="view.activeBoardId"
          :suggest="view.form.tagSuggest"
          @import="importSheet?.pick()"
        />
        <CharactersEditor :key="view.activeBoardId" />
        <div ref="sizeHome" class="composer-slot"></div>
      </div>
      <div ref="foot" class="composer-foot drawing-footer">
        <DrawingBottomPanel ref="bottomPanel"><template #parameters><DrawingParameters /></template></DrawingBottomPanel>

      </div>
    </form>
    </Teleport>
    <div
      v-show="!coCreate" ref="splitter"
      class="splitter"
      id="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整栏宽"
      tabindex="0"
    ></div>
    <section ref="canvasLeft" class="canvas-left" :class="{ 'graph-scene': graphScene, 'history-browsing': mobileHistoryOpen }" :data-receded="compactPanel || undefined" :inert="compactPanel" aria-label="IMAGE 画布">
      <header v-show="coCreate" class="canvas-head canvas-recede-hide" :class="{ 'recipe-context': canvas.contextKind.value === 'recipe' }">
        <div ref="navFloat" class="canvas-nav"></div>
        <div ref="boardHead" class="canvas-board"></div>
        <div v-if="canvas.recordId.value" class="canvas-views" role="group" aria-label="画布视图">
          <template v-if="canvas.view.value === 'node'">
            <button type="button" aria-label="返回演进" title="返回演进画布" @click="canvas.view.value = 'graph'"><AppIcon name="i-back" />演进</button>
            <span class="canvas-inspection" aria-current="page" title="演进节点检视"><AppIcon name="i-image" />检视</span>
          </template>
          <template v-else>
            <button type="button" :aria-pressed="canvas.view.value === 'graph'" title="演进画布" @click="canvas.view.value = 'graph'"><AppIcon name="i-branch" />演进</button>
            <button type="button" :aria-pressed="canvas.view.value === 'image'" title="当前画板" @click="canvas.view.value = 'image'"><AppIcon name="i-frame" />画板</button>
          </template>
        </div>
        <button v-show="canvas.contextKind.value === 'form'" ref="summaryButton" class="canvas-summary" type="button" popovertarget="canvasQuick" aria-label="调整型号与画幅" aria-haspopup="dialog" :aria-expanded="quick.open.value" :title="`${summaryModel} · ${view.form.width}×${view.form.height}`">
          <span class="canvas-summary-identity">
            <span v-if="summaryMode" class="canvas-mode-icon" :title="summaryMode === 'furry' ? '兽人' : '动漫'"><AppIcon :name="summaryMode === 'furry' ? 'i-paw' : 'i-sakura'" /></span>
            <span class="canvas-summary-model"><span class="model-full">{{ summaryModel }}</span><span class="model-short">{{ summaryModelShort }}</span></span>
          </span>
          <span class="canvas-summary-size"><AppIcon name="i-frame" />{{ view.form.width }}×{{ view.form.height }}</span>
          <span v-if="naiInputLimits(view.form.model)" class="canvas-tokens"><NaiTokenCount field="prompt" :text="view.form.prompt" /><span>tok</span></span>
          <AppIcon class="canvas-summary-caret" name="i-chevron" />
        </button>
        <div ref="panelSwitchHome" class="canvas-panel-switch-home"></div>
        <Teleport v-if="panelSwitchTarget" :to="panelSwitchTarget">
        <CanvasPanelSwitch ref="panelSwitch" label="侧栏内容" :options="panelOptions" :selected="canvas.panel.value" @select="selectPanel($event as 'ask' | 'context')" />
        </Teleport>
      </header>
      <div class="canvas-stage" :class="{ 'canvas-recede': coCreate }">
        <Teleport :to="historyTarget || 'body'" :disabled="!historyTarget">
          <div ref="historyTray" v-show="libraryExpanded && historyTarget" class="canvas-history" :data-groove-motion="grooveMotion.on.value || undefined" aria-label="图片历史侧栏"></div>
        </Teleport>
        <ImageStage :compact="coCreate" :history-visible="libraryExpanded" @history-host="imageHistoryHost = $event" :actions-target="imageActions" :visible="!coCreate || canvas.view.value === 'image' || !canvas.recordId.value" :paused="compactPanel" />
        <div ref="graphHost" v-show="coCreate && canvas.view.value !== 'image' && canvas.recordId.value" class="canvas-graph"></div>
      </div>
      <div ref="canvasBottom" v-show="coCreate" class="canvas-bottom canvas-recede-hide">
        <div ref="filmstrip" v-show="!graphScene" class="canvas-filmstrip"></div>
        <div ref="imageActions" class="editor-toolbar canvas-image-actions" :class="{ 'graph-actions': graphScene }"></div>
        <div ref="canvasFoot" class="canvas-foot generation-form" :aria-busy="view.busy"></div>
      </div>

    </section>
    <div v-show="coCreate && canvas.panel.value && !canvas.compact.value" ref="canvasSplitter" class="canvas-splitter" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整侧栏宽度" aria-valuemin="25" aria-valuemax="45" :aria-valuenow="Math.round(canvas.ratio.value * 100)"></div>
    <Transition name="canvas-tray" :css="canvas.trayMotion.value" @after-leave="canvas.settleTray()">
    <aside v-show="coCreate && canvas.panel.value" ref="sidebar" class="canvas-sidebar" aria-label="创作侧栏">
      <header v-show="canvas.compact.value" class="canvas-sidebar-head canvas-tray-head" :class="{ 'is-folded': canvas.headFolded.value }">
        <div class="canvas-sheet-actions"><button class="ibtn" type="button" aria-label="收起创作面板" @click="canvas.panel.value = null"><AppIcon name="i-close" /></button><button class="ibtn canvas-fold" type="button" aria-label="收起顶栏" @click="canvas.toggleHead($event)"><AppIcon name="i-chevron" /></button></div>
        <div ref="panelSwitchSide"></div>
        <button v-show="canvas.headFolded.value" class="canvas-head-handle" type="button" aria-label="展开顶栏" @click="canvas.toggleHead($event)"></button>
      </header>
      <div class="canvas-sidebar-content" :data-pane-motion="canvas.paneMotion.value || undefined">
      <div ref="askHost" class="canvas-ask"></div>
      <section v-show="formShown" id="canvasForm" class="canvas-form-panel" aria-label="IMAGE 表单">
        <header class="canvas-panel-head"><AppIcon name="i-menu" /><strong>表单</strong></header>
        <div ref="formSide" class="canvas-form-body"></div>
      </section>
      <div ref="recipeHost" v-show="contextShown && canvas.contextKind.value === 'recipe'" id="canvasRecipe" class="canvas-recipe"></div>
      </div>
    </aside>
    </Transition>
  </main>
  <div ref="quickPanel" id="canvasQuick" class="canvas-quick" :class="{ 'canvas-collaboration': coCreate }" popover="auto" role="dialog" aria-label="型号与画幅" @beforetoggle="quick.beforeToggle" @toggle="quick.toggled"><div ref="quickAccount" class="canvas-account"></div><div ref="quickModel"></div><div ref="quickSize"></div></div>
  <Teleport v-if="navTarget" :to="navTarget"><WorkspaceSwitch workspace="image" :compact="coCreate" /></Teleport>
  <Teleport v-if="accountTarget" :to="accountTarget"><WalletDisplay :quota="view.quota" :loading="view.quotaLoading" :model="view.model" /><ThemeToggle /></Teleport>
  <Teleport v-if="boardTarget" :to="boardTarget"><BoardSwitcher :compact="coCreate" /></Teleport>
  <Teleport v-if="modelTarget" :to="modelTarget"><ModelField /></Teleport>
  <Teleport v-if="sizeTarget" :to="sizeTarget"><DrawingControls /></Teleport>
  <Teleport v-if="goTarget" :to="goTarget">        <div class="go-row">
          <button
            class="btn btn-primary btn-go"
            id="goBtn"
            type="submit" form="form"
            :disabled="view.busy || !valid"
          >
            <AppIcon class="solid" name="i-generate" /><span
              class="go-spin"
              aria-hidden="true"
            ></span
            ><span id="goLabel">{{
              view.busy
                ? view.label
                : view.batchCount > 1
                  ? `生成 ×${view.batchCount}`
                  : "生成"
            }}</span
            ><span
              class="cost-tag"
              id="goCost"
              :hidden="view.busy || !view.quote.quote || !quoteLabel(view.quote.quote, view.batchCount)"
              :data-stale="view.quote.status === 'loading'"
              ><AppIcon v-if="view.quote.quote" name="i-points" /><b>{{
                quoteLabel(view.quote.quote, view.batchCount)
              }}</b></span
            ><span class="go-keys" aria-hidden="true"
              ><kbd><AppIcon name="i-cmd" /></kbd
              ><kbd><AppIcon name="i-enter" /></kbd
            ></span></button
          ><button
            class="btn btn-stop"
            id="cancelBtn"
            type="button"
            :hidden="!view.busy"
            @click="drawing.cancel"
          >
            <AppIcon name="i-stop" />停止
          </button>
        </div></Teleport>
  <ImportSheet ref="importSheet" />
  <!-- Targets belong to this cached workspace, including when detached by KeepAlive. -->
  <Teleport v-if="libraryTarget" :to="libraryTarget"><ImageLibrary :horizontal="coCreate" :mobile="mobileHistory" :tray-target="historyTray" :collapsed="mobileHistory ? !mobileHistoryOpen : !canvas.filmstripOpen.value" @expand="expandLibrary" :compact="graphScene" @browse="browseImage" /></Teleport>
  <Teleport v-if="lockTarget" :to="lockTarget">
    <button
      class="ibtn topbar-lock"
      type="button"
      aria-label="打开任务总览"
      :title="coCreate ? '任务总览' : undefined"
      :data-tip="narrow ? undefined : '任务总览'"
      @click="slates.visible.value = true"
    >
      <AppIcon name="i-tasks" /><span v-if="!coCreate" class="topbar-action-label">任务总览</span>
    </button>
  </Teleport>
</template>

<style scoped src="../../shared/canvas-motion.css"></style>
<style scoped src="../../shared/canvas-surface.css"></style>
<style scoped>
.composer-foot.drawing-footer { padding-top: 10px; gap: 0; background: color-mix(in srgb,var(--chrome) 65%,var(--raised)); border-radius: var(--r3) var(--r3) 0 0; border-top: 1px solid var(--line-2); box-shadow: 0 -5px 16px -12px rgb(var(--shadow-rgb) / calc(.7333 * var(--shadow-strength))); backdrop-filter: none; }
.form-home, .canvas-left, .canvas-stage, .composer-slot { display: contents; }
.composer-slot :deep(.fld) { flex: none; gap: var(--sp-2); }
.canvas-nav-home { display: contents; }
.canvas-layout { position: relative; grid-template-columns: minmax(0, 1fr) 10px var(--canvas-ask-width, 40%); grid-template-rows: minmax(0, 1fr); height: var(--canvas-viewport-height, 100dvh); min-height: 0; padding: 8px; overflow: clip; transition: none; }
.canvas-layout.sidebar-collapsed { grid-template-columns: minmax(0, 1fr) 0 0; }
.canvas-layout .form-home { display: none; }
.canvas-layout .canvas-left { container: canvas-workspace / inline-size; position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border-radius: 16px; background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--stage-wash) 2.2%, transparent), transparent 62%), var(--stage); }
.canvas-head { position: absolute; top: 8px; right: 8px; left: 8px; z-index: 8; display: flex; align-items: center; gap: 8px; min-width: 0; height: 36px; pointer-events: none; }
.canvas-head > * { pointer-events: auto; }
.canvas-nav { flex: none; }
.canvas-head :is(.canvas-summary, .canvas-views), .canvas-board { background: var(--glass-bg); border: 1px solid var(--line-2); border-radius: 10px; box-shadow: var(--sh-1); backdrop-filter: blur(var(--glass-blur)); }
.canvas-account { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.canvas-account :deep(.wallet) { margin-right: auto; }
.canvas-board { flex: 0 1 160px; min-width: 100px; }
.canvas-views { display: inline-flex; flex: none; align-items: center; gap: 2px; height: 34px; padding: 3px; }
.canvas-views > :is(button, .canvas-inspection) { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 65px; height: 26px; padding: 0 8px; color: var(--fg-3); border-radius: 7px; font-size: var(--fz-xs); font-weight: var(--fw-medium); white-space: nowrap; --ico: var(--ico-sm); }
.canvas-views button:hover { color: var(--fg-2); background: var(--hover); }
.canvas-views button { -webkit-tap-highlight-color: transparent; }
.canvas-views button[aria-pressed="true"] { color: var(--fg); background: var(--nav-active-bg); box-shadow: var(--nav-active-shadow); }
.canvas-views .canvas-inspection { position: relative; color: var(--fg-2); }
.canvas-inspection::before { position: absolute; top: 6px; bottom: 6px; left: -1px; width: 1px; content: ''; background: var(--line-2); }
.canvas-summary { display: flex; align-items: center; gap: 8px; flex: 0 1 auto; min-width: 0; height: 34px; margin-left: auto; padding: 0 10px; font-size: var(--fz-xs); line-height: 1; white-space: nowrap; }
.canvas-summary:is(:hover, [aria-expanded="true"]) { background: var(--hover); }
.canvas-summary-identity { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.canvas-mode-icon { display: inline-flex; flex: none; color: var(--fg-3); --ico: var(--ico-sm); }
.canvas-summary-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--fg); font-weight: var(--fw-semibold); }
.model-short { display: none; }
.canvas-summary-size { display: inline-flex; align-items: center; gap: 4px; flex: none; padding-left: 8px; border-left: 1px solid var(--line); color: var(--fg-3); font-size: var(--fz-xs); font-variant-numeric: tabular-nums; --ico: var(--ico-sm); }
.canvas-tokens { display: inline-flex; flex: none; align-items: baseline; gap: 3px; padding-left: 8px; border-left: 1px solid var(--line); color: var(--fg-3); font-size: var(--fz-2xs); font-variant-numeric: tabular-nums; }
.canvas-tokens :deep(.tab-count) { padding: 0; background: none; font: inherit; }
.canvas-summary-caret { flex: none; color: var(--fg-3); transform: rotate(90deg); --ico: var(--ico-sm); }
.canvas-summary[aria-expanded="true"] .canvas-summary-caret { transform: rotate(-90deg); }
.canvas-panel-switch-home { flex: none; margin-left: auto; }
.canvas-summary + .canvas-panel-switch-home { margin-left: 0; }
.recipe-context .canvas-panel-switch-home { margin-left: auto; }
@container canvas-workspace (max-width: 760px) { .model-full { display: none; } .model-short { display: inline; } }
@container canvas-workspace (max-width: 620px) {
  .canvas-board { flex-basis: 92px; min-width: 72px; }
  .canvas-views > :is(button, .canvas-inspection) { min-width: 56px; padding-inline: 6px; gap: 4px; }
  .canvas-summary { flex: none; gap: 6px; padding-inline: 8px; }
  .canvas-summary-identity { display: none; }
  .canvas-summary-size { padding-left: 0; border-left: 0; }
}
.canvas-layout .canvas-stage { padding-bottom: var(--canvas-dock-space, 72px); position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; }
.canvas-layout .graph-scene .canvas-stage { padding-bottom: 0; }
.canvas-layout .canvas-stage > :deep(.stage) { width: 100%; min-width: 0; padding-top: 48px; }
.canvas-graph { position: absolute; inset: 0 0 var(--canvas-dock-space, 72px); }
.graph-scene .canvas-graph { bottom: 0; }
.canvas-history { width: 100%; height: 100%; min-height: 0; padding: 4px; overflow: hidden; border-radius: 10px; background: var(--sunken); box-shadow: inset 0 1px 3px rgb(var(--shadow-rgb) / calc(.2 * var(--shadow-strength))); }
.canvas-bottom { position: absolute; right: 12px; bottom: 12px; left: 12px; z-index: 7; display: flex; align-items: center; gap: 12px; min-width: 0; pointer-events: none; }
.canvas-bottom > * { pointer-events: auto; }
.canvas-filmstrip { flex: none; min-width: 0; }
.canvas-image-actions { position: static; flex: 1 1 auto; flex-direction: row; justify-content: center; width: auto; max-width: none; min-width: 0; transform: none; }
.canvas-image-actions.graph-actions { justify-content: flex-start; pointer-events: none; }
.canvas-image-actions:empty { pointer-events: none; }
.canvas-foot { display: flex; flex: none; align-items: center; min-width: 0; margin-left: auto; }
.canvas-foot .go-row { flex: none; width: auto; grid-template-columns: max-content 0px; margin-left: auto; min-width: 0; }
.canvas-foot .go-row:has(> .btn-stop:not([hidden])) { grid-template-columns: max-content 72px; column-gap: 8px; }
.canvas-foot .btn-go { height: 48px; min-height: 48px; min-width: 192px; justify-content: center; padding: 0 12px; gap: 7px; border-radius: 14px; box-shadow: var(--sh-1); font-size: var(--fz-md); }
.canvas-foot[aria-busy="true"] .btn-go { min-width: 176px; }
.canvas-foot .btn-stop { height: 48px; min-height: 48px; padding: 0 6px; gap: 4px; border-radius: 14px; }
.canvas-foot .cost-tag { margin-left: 4px; padding: 3px 6px; font-size: var(--fz-xs); }
.canvas-foot .btn-go > .ico { --ico: var(--ico-md); }
.canvas-foot .go-keys { display: none; }
@container canvas-workspace (max-width: 820px) {
  .canvas-bottom { gap: 6px; }
  .canvas-foot .btn-go { min-width: 168px; padding-inline: 8px; gap: 5px; font-size: var(--fz-sm); }
  .canvas-foot[aria-busy="true"] .btn-go { min-width: 144px; }
  .canvas-foot .go-row:has(> .btn-stop:not([hidden])) { grid-template-columns: max-content 64px; column-gap: 6px; }
}
.canvas-sidebar { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; color: var(--fg); border-radius: 16px; background: var(--glass-bg); box-shadow: inset 0 1px 0 var(--glass-edge), 0 0 0 1px var(--line-2), var(--sh-1); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)); }
.canvas-sidebar-head { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px 4px; }
.canvas-sidebar-head .ibtn { width: 36px; height: 36px; color: var(--fg-3); --ico: var(--ico-md); }
.canvas-sidebar-content { position: relative; flex: 1; min-width: 0; min-height: 0; }
.canvas-ask, .canvas-recipe, .canvas-form-panel { position: absolute; inset: 0; min-width: 0; min-height: 0; }
.canvas-form-panel { display: flex; flex-direction: column; overflow: hidden; border-radius: inherit; }
.canvas-panel-head { display: flex; align-items: center; flex: none; gap: 8px; height: 48px; padding: 0 18px; color: var(--fg-2); --ico: var(--ico-md); }
.canvas-panel-head strong { font-size: var(--fz-sm); font-weight: var(--fw-semibold); }
.canvas-form-body { flex: 1; min-height: 0; }
.canvas-splitter { position: relative; cursor: col-resize; touch-action: none; border-radius: 6px; }
.canvas-splitter::after { position: absolute; inset: 45% 4px; content: ''; background: var(--line-2); border-radius: 2px; }
.canvas-splitter:is(:hover, :focus-visible)::after { background: var(--a); }
.canvas-layout[data-resizing] { cursor: col-resize; user-select: none; }
.canvas-form-body .composer { display: grid; width: 100%; height: 100%; min-height: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.canvas-form-body .composer-scroll { overflow-y: auto; padding: 4px 16px 16px; }
.canvas-form-body .composer-foot { position: static; padding: 10px 16px 12px; border-radius: 0; background: var(--glass-layer); box-shadow: none; }
.canvas-form-body :deep(.bottom-controls) { margin-bottom: 0; }
.canvas-quick { position: fixed; width: min(320px, calc(100vw - 16px)); max-height: calc(100dvh - 140px); margin: 0; padding: 16px; overflow-y: auto; color: var(--fg); background: var(--glass-pop-bg); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--line-2); border-radius: 16px; box-shadow: var(--glass-pop-shadow); }
.canvas-quick > div + div { margin-top: 16px; }
@media (min-width: 1080px) and (max-width: 1250px) { .canvas-board { flex-basis: 140px; } .canvas-head { gap: 4px; padding-inline: 6px; } }
@media (max-width: 1079px) {
  .canvas-layout, .canvas-layout.sidebar-collapsed { grid-template-columns: minmax(0, 1fr); padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); }
  .canvas-layout .canvas-left { grid-column: 1; grid-row: 1; }
  .history-browsing .canvas-stage { transform: translateX(24%) scale(1.22); filter: blur(14px); opacity: .5; pointer-events: none; }
  .history-browsing .canvas-head, .history-browsing .canvas-bottom > :not(.canvas-filmstrip) { opacity: 0; pointer-events: none; }
  .canvas-head { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; grid-template-rows: 40px 40px; height: auto; gap: 6px; }
  .canvas-nav { grid-column: 1; grid-row: 1; }
  .canvas-board { grid-column: 2; grid-row: 1; width: auto; min-width: 0; }
  .canvas-head .canvas-panel-switch-home { grid-column: 3; grid-row: 1; margin-left: 0; }
  .canvas-head > .canvas-views:not(.canvas-panel-switch) { grid-column: 1 / -1; grid-row: 2; justify-self: start; }
  .canvas-head .canvas-summary { grid-column: 1 / -1; grid-row: 2; justify-self: end; max-width: calc(100% - 144px); margin-left: 0; }
  .canvas-head:not(:has(> .canvas-views:not(.canvas-panel-switch))) .canvas-summary { max-width: 100%; }
  .canvas-head :is(.canvas-views, .canvas-summary) { height: 40px; }
  .canvas-views > :is(button, .canvas-inspection) { height: 32px; }
  .canvas-sidebar { position: absolute; inset: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); z-index: 9; gap: 8px; background: none; box-shadow: none; backdrop-filter: none; }
  /* Same corners as the canvas head: the switch stays put and × takes the workspace mark's place. */
  .canvas-sidebar-head { padding: 8px 8px 0 0; }
  .canvas-sidebar-head .ibtn { background: var(--glass-bg); border: 1px solid var(--line-2); border-radius: 10px; box-shadow: var(--sh-1); backdrop-filter: blur(var(--glass-blur)); }
  .canvas-sidebar-head .ibtn { width: 40px; height: 40px; }
  .canvas-sidebar-content { border-radius: 16px; background: var(--glass-bg); box-shadow: inset 0 1px 0 var(--glass-edge), 0 0 0 1px var(--line-2), var(--sh-1); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)); }
  .canvas-layout .canvas-stage > :deep(.stage) { padding-top: 96px; }
  .canvas-form-body :deep(.fld-hero) { flex: none; min-height: 280px; }
  .canvas-form-panel > .canvas-panel-head { display: none; }
  .canvas-layout .canvas-stage :deep(.compact-stage .viewport) { height: 100%; max-height: none; min-height: 0; padding: 12px; transition: none; }
  .canvas-layout .canvas-bottom { gap: 8px; right: 8px; bottom: 8px; left: 8px; }
  .canvas-bottom .canvas-image-actions:empty { display: none; }
  .canvas-bottom .canvas-image-actions.graph-actions { justify-content: flex-start; }
  .canvas-foot .btn-go { min-height: 44px; height: 44px; min-width: 156px; }
  .canvas-foot .btn-stop { min-height: 44px; height: 44px; }
}
@container canvas-workspace (max-width: 600px) {
  .canvas-layout .canvas-bottom { flex-wrap: wrap; }
  .canvas-bottom .canvas-image-actions { flex: 1 0 100%; order: -1; }
}
@container canvas-workspace (min-width: 521px) and (max-width: 600px) {
  .graph-scene .canvas-bottom { flex-wrap: nowrap; }
  .graph-scene .canvas-image-actions { flex: 1 1 auto; order: 0; }
}
</style>
