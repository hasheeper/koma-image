<script setup lang="ts">
import { computed, onDeactivated, shallowRef } from "vue";
import { useShell } from "../app/shell";
import { workspaceInfo, workspaces } from "../app/routes";
import type { WorkspaceId } from "../app/routes";
import BrandMark from "./BrandMark.vue";
import AppIcon from "./AppIcon.vue";
import { menuKeys } from "./popover";

const props = defineProps<{ workspace: WorkspaceId }>();
const { router } = useShell();
const button = shallowRef<HTMLButtonElement | null>(null);
const menu = shallowRef<HTMLElement | null>(null);
const expanded = shallowRef(false);
const info = computed(() => workspaceInfo[props.workspace]);
const menuId = `workspace-menu-${props.workspace}`;
function beforeToggle(event: Event) {
  expanded.value = (event as ToggleEvent).newState === "open";
  if (expanded.value && button.value && menu.value) {
    const rect = button.value.getBoundingClientRect();
    menu.value.style.left = `${Math.max(8, rect.left)}px`;
    menu.value.style.top = `${rect.bottom + 4}px`;
  }
}
function close() {
  if (menu.value?.matches(":popover-open")) menu.value.hidePopover();
}
function switchTo(workspace: WorkspaceId) {
  close();
  router.switchWorkspace(workspace);
}
function openSettings() {
  close();
  router.openOverlay("settings");
}
onDeactivated(close);
</script>
<template>
  <button
    ref="button"
    class="brand switcher"
    type="button"
    :popovertarget="menuId"
    :aria-expanded="expanded"
    :aria-label="`Koma ${info.name}，切换工作区`"
  >
    <BrandMark :surface="workspace" :subtitle="info.subtitle" />
    <AppIcon class="sw-caret" name="i-chevron" />
  </button>
  <nav
    ref="menu"
    :id="menuId"
    class="menu switch-menu"
    popover
    aria-label="切换工作区"
    @beforetoggle="beforeToggle"
    @keydown="menuKeys"
  >
    <template v-for="target in workspaces" :key="target">
      <a
        class="menu-item switch-item"
        :href="`#/${target}`"
        :aria-current="target === workspace ? 'page' : undefined"
        @click.prevent="switchTo(target)"
      >
        <AppIcon class="sw-glyph" :name="`mk-${target}`" />
        <span class="sw-text"
          ><b>{{ workspaceInfo[target].name }}</b
          ><small>{{ workspaceInfo[target].description }}</small></span
        >
        <AppIcon v-if="target === workspace" class="menu-check" name="i-check" />
      </a>
    </template>
    <hr />
    <button class="menu-item switch-item" type="button" @click="openSettings">
      <AppIcon class="sw-glyph" name="mk-settings" /><span class="sw-text"
        ><b>设置</b><small>连接、模型、Key 与备份</small></span
      >
    </button>
  </nav>
</template>
