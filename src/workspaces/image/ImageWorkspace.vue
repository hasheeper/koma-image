<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useShell } from "../../app/shell";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import AppIcon from "../../shared/AppIcon.vue";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import WalletDisplay from "../../shared/WalletDisplay.vue";
import ImageLibrary from "./ImageLibrary.vue";
import PromptDraft from "./PromptDraft.vue";
import EmptyStage from "./EmptyStage.vue";

const { image, narrow, router } = useShell();
const main = shallowRef<HTMLElement | null>(null);
const viewport = shallowRef<HTMLElement | null>(null);
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
lifecycle.whileActive((signal) =>
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !document.querySelector("dialog[open], :popover-open")
      )
        image.menuOpen = false;
    },
    { signal },
  ),
);
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
    <div ref="account" class="topbar-account"><WalletDisplay /></div>
  </header>
  <main ref="main" class="shell" data-workspace-root="image">
    <form class="composer generation-form" id="form" @submit.prevent>
      <div ref="composerScroll" class="composer-scroll">
        <PromptDraft />
        <!-- M4 fills this composer with model, size and parameter controls from the baseline. -->
        <div class="fld">
          <div class="fld-top">
            <label class="composer-heading" for="model"
              ><AppIcon class="section-ico" name="i-model" />模型</label
            >
          </div>
          <select id="model" disabled aria-label="模型">
            <option>未配置连接</option>
          </select>
        </div>
      </div>
      <div class="composer-foot">
        <div class="go-row">
          <button
            class="btn btn-primary btn-go"
            id="goBtn"
            type="submit"
            disabled
          >
            <AppIcon class="solid" name="i-generate" /><span>生成</span
            ><span class="go-keys" aria-hidden="true"
              ><kbd><AppIcon name="i-cmd" /></kbd
              ><kbd><AppIcon name="i-enter" /></kbd
            ></span>
          </button>
        </div>
      </div>
    </form>
    <div
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整栏宽"
      aria-disabled="true"
    ></div>
    <section class="stage">
      <div class="stage-status" role="status">
        <strong>就绪</strong><span></span>
      </div>
      <div ref="viewport" class="viewport" id="viewport">
        <div class="layer center" data-layer="empty">
          <EmptyStage :viewport="viewport" />
        </div>
      </div>
    </section>
  </main>
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
