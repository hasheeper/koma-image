<script setup lang="ts">
import { computed, shallowRef, watch, onBeforeUnmount } from "vue";
import { useShell } from "../../app/shell";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import AppIcon from "../../shared/AppIcon.vue";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import WalletDisplay from "../../shared/WalletDisplay.vue";
import ImageLibrary from "./ImageLibrary.vue";
import BoardSwitcher from "./BoardSwitcher.vue";
import CharactersEditor from "./CharactersEditor.vue";
import PromptDraft from "./PromptDraft.vue";
import DrawingControls from "./DrawingControls.vue";
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
const importSheet = shallowRef<InstanceType<typeof ImportSheet> | null>(null);
const splitter = shallowRef<HTMLElement | null>(null);
const foot = shallowRef<HTMLElement | null>(null);
const { image, narrow, router } = useShell();
const main = shallowRef<HTMLElement | null>(null);

const mobileLibrary = shallowRef<HTMLElement | null>(null);
const account = shallowRef<HTMLElement | null>(null);
const actions = shallowRef<HTMLElement | null>(null);
const composerScroll = shallowRef<HTMLElement | null>(null);
const libraryTarget = computed(() =>
  narrow.value ? mobileLibrary.value : main.value,
);
const lockTarget = computed(() =>
  narrow.value ? actions.value : account.value,
);
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
    !!view.value.model && !view.value.characterProblem &&
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
  const sizeFoot = () => {
    if (narrow.value && foot.value)
      document.documentElement.style.setProperty(
        "--mobile-foot-h",
        `${foot.value.offsetHeight}px`,
      );
    else document.documentElement.style.removeProperty("--mobile-foot-h");
  };
  const observer = new ResizeObserver(sizeFoot);
  if (foot.value) observer.observe(foot.value);
  sizeFoot();
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--mobile-foot-h");
    },
    { once: true },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.isComposing ||
        document.querySelector("dialog[open], :popover-open")
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!view.value.busy && !image.importing) void drawing.run();
      }
      if (event.key === "Escape") {
        if (image.menuOpen) image.menuOpen = false;
        else if (image.importing) importSheet.value?.close();
        else if (image.zoom) image.zoom = false;
        else if (view.value.browsing && view.value.pending) drawing.live();
        else if (view.value.busy) drawing.cancel();
      }
    },
    { signal },
  );
});
function security() {
  image.menuOpen = false;
  router.openOverlay("settings", "security");
}
</script>
<template>
  <header class="topbar">
    <WorkspaceSwitch workspace="image" />
    <div class="topbar-menu">
      <button
        id="topbarMenuToggle"
        class="ibtn topbar-menu-toggle"
        type="button"
        aria-controls="topbarActions"
        :aria-expanded="image.menuOpen"
        :aria-label="image.menuOpen ? '关闭菜单' : '打开菜单'"
        @click="image.menuOpen = !image.menuOpen"
      >
        <AppIcon class="menu-open" name="i-menu" /><AppIcon
          class="menu-close"
          name="i-close"
        />
      </button>
      <button
        class="topbar-menu-backdrop"
        type="button"
        aria-label="关闭菜单"
        @click="image.menuOpen = false"
      ></button>
      <div
        ref="actions"
        id="topbarActions"
        class="topbar-end"
        role="group"
        aria-label="菜单"
      >
        <div
          ref="mobileLibrary"
          class="topbar-history-slot"
          id="topbarHistorySlot"
        ></div>
      </div>
    </div>
    <div ref="account" class="topbar-account">
      <WalletDisplay
        :quota="view.quota"
        :loading="view.quotaLoading"
        :model="view.model"
      />
    </div>
  </header>
  <main ref="main" class="shell" data-workspace-root="image">
    <form
      class="composer generation-form"
      id="form"
      @submit.prevent="drawing.run"
      :aria-busy="view.busy"
    >
      <div ref="composerScroll" class="composer-scroll">
        <BoardSwitcher />
        <PromptDraft
          :key="view.activeBoardId"
          :suggest="view.form.tagSuggest"
          @import="importSheet?.pick()"
        />
        <CharactersEditor :key="view.activeBoardId" />
        <DrawingControls />
      </div>
      <div ref="foot" class="composer-foot">
        <div class="go-row">
          <button
            class="btn btn-primary btn-go"
            id="goBtn"
            type="submit"
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
              :hidden="view.busy || !view.quote.quote"
              :data-stale="view.quote.status === 'loading'"
              ><AppIcon name="i-points" /><b>{{
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
        </div>
      </div>
    </form>
    <div
      ref="splitter"
      class="splitter"
      id="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整栏宽"
      tabindex="0"
    ></div>
    <ImageStage />
  </main>
  <ImportSheet ref="importSheet" />
  <!-- Targets belong to this cached workspace, including when detached by KeepAlive. -->
  <Teleport v-if="libraryTarget" :to="libraryTarget"><ImageLibrary /></Teleport>
  <Teleport v-if="lockTarget" :to="lockTarget"
    ><button
      class="ibtn topbar-lock"
      type="button"
      aria-label="API Key"
      data-tip="API Key"
      @click="security"
    >
      <AppIcon name="i-lock" /><span class="topbar-action-label">API Key</span>
    </button></Teleport
  >
</template>
