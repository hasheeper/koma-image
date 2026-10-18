<script setup lang="ts">
import { useShell } from "../../app/shell";
import AppIcon from "../../shared/AppIcon.vue";
const { image } = useShell();
const tabs = ["history", "favorites"] as const;
function select(tab: "history" | "favorites") {
  image.library = tab;
  image.historyOpen = true;
}
function keydown(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? "history"
      : event.key === "End"
        ? "favorites"
        : image.library === "history"
          ? "favorites"
          : "history";
  select(next);
  document.getElementById(`${next}Tab`)?.focus();
}
</script>
<template>
  <aside class="gallery" id="gallery" aria-label="历史与收藏图片">
    <header class="library-head">
      <div
        class="library-tabs"
        role="tablist"
        aria-label="图片分类"
        @keydown="keydown"
      >
        <button
          v-for="tab in tabs"
          :key="tab"
          :id="`${tab}Tab`"
          class="ibtn library-tab"
          type="button"
          role="tab"
          aria-controls="tray"
          :aria-selected="image.library === tab"
          :tabindex="image.library === tab ? 0 : -1"
          :data-tip="tab === 'history' ? '历史' : '收藏'"
          :aria-label="`${tab === 'history' ? '历史' : '收藏'}，0 张`"
          @click="select(tab)"
        >
          <AppIcon :name="tab === 'history' ? 'i-history' : 'i-star'" /><b
            class="mono"
            >0</b
          >
        </button>
      </div>
    </header>
    <div
      class="tray"
      id="tray"
      role="tabpanel"
      :aria-labelledby="`${image.library}Tab`"
    ></div>
    <div class="tray-empty" id="trayEmpty">
      <div
        v-show="image.library === 'history'"
        class="tray-ghosts"
        aria-hidden="true"
      >
        <i></i><i></i><i></i><i></i>
      </div>
      <AppIcon
        v-show="image.library === 'favorites'"
        class="ico-lg"
        id="trayEmptyIcon"
        name="i-star"
      />
      <p>
        <span>{{
          image.library === "history"
            ? "生成的图会排在这里"
            : "收藏的图会排在这里"
        }}</span
        ><span>{{
          image.library === "history" ? "刷新页面后清空" : "刷新后仍会保留"
        }}</span>
      </p>
    </div>
    <footer class="library-foot">
      <button
        id="histToggle"
        class="ibtn ibtn-xs library-fold"
        type="button"
        aria-controls="tray"
        :aria-expanded="image.historyOpen"
        :aria-label="image.historyOpen ? '收起图片栏' : '展开图片栏'"
        @click="image.historyOpen = !image.historyOpen"
      >
        <AppIcon name="i-sidebar" /></button
      ><button
        class="ibtn library-clear"
        type="button"
        hidden
        aria-label="清空历史"
      >
        <AppIcon name="i-trash" />
      </button>
    </footer>
  </aside>
</template>
