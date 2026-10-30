<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, shallowRef, useId } from "vue";
import { themeChoices, useTheme } from "../app/theme";
import type { ThemeChoice } from "../app/theme";
import { message, useUi } from "../app/ui";
import { menuKeys, placeMenu } from "./popover";
import AppIcon from "./AppIcon.vue";

defineProps<{ sidebar?: boolean }>();
const theme = useTheme(), ui = useUi(), id = useId();
const button = shallowRef<HTMLButtonElement>(), menu = shallowRef<HTMLElement>(), expanded = shallowRef(false);
const current = computed(() => themeChoices[theme.choice.value]);
function place() {
  if (button.value && menu.value) placeMenu(menu.value, button.value.getBoundingClientRect());
}
function close() {
  if (menu.value?.matches(":popover-open")) menu.value.hidePopover();
  window.removeEventListener("resize", place);
}
function beforeToggle(event: ToggleEvent) {
  expanded.value = event.newState === "open";
  if (expanded.value && menu.value) {
    menu.value.style.display = "grid"; place(); menu.value.style.removeProperty("display");
  }
}
function toggled(event: ToggleEvent) {
  window.removeEventListener("resize", place);
  if (event.newState === "open") {
    place(); window.addEventListener("resize", place);
    menu.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }
}
function choose(choice: ThemeChoice) {
  close(); button.value?.focus({ preventScroll: true });
  theme.set(choice).catch((error: unknown) => ui.toast(message(error), "err"));
}
onDeactivated(close);
onBeforeUnmount(() => { close(); window.removeEventListener("resize", place); });
</script>
<template>
  <button ref="button" :class="sidebar ? 'sidebar-row' : 'ibtn'" type="button"
    :aria-label="`外观：${current.label}`" :data-tip="sidebar ? undefined : `外观：${current.label}`"
    aria-haspopup="menu" :aria-controls="id" :aria-expanded="expanded" :popovertarget="id">
    <AppIcon :name="current.icon" /><span :class="sidebar ? undefined : 'topbar-action-label'">外观</span>
  </button>
  <div :id="id" ref="menu" class="menu theme-menu" popover="auto" role="menu" aria-label="外观"
    @beforetoggle="beforeToggle" @toggle="toggled" @keydown="menuKeys">
    <button v-for="(item, choice) in themeChoices" :key="choice" class="menu-item" type="button"
      role="menuitemradio" :aria-checked="theme.choice.value === choice" @click="choose(choice)">
      <AppIcon :name="item.icon" /><span class="menu-label">{{ item.label }}</span><AppIcon class="menu-check" name="i-check" />
    </button>
  </div>
</template>
<style scoped>
.theme-menu { width: 160px; }
</style>
