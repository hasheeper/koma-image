<script setup lang="ts">
import { computed } from "vue";
import { useBridge } from "../app/bridge.ts";
import { useAsk } from "../app/ask.ts";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "../ask/AskMenu.vue";
const bridge = useBridge(), ask = useAsk();
const attention = computed(() => !!bridge.directory.value && bridge.phase.value !== 'active');
function activate(toggle: () => void) {
  if (!bridge.directory.value && bridge.supported) void bridge.mount();
  else if (attention.value) void bridge.resume();
  else toggle();
}
</script>
<template>
  <AskMenu id="askDirectoryMenu" label="协同目录" side="up">
    <template #trigger="{ open, toggle }">
      <button class="directory-chip" :class="{ attention }" type="button" :aria-label="bridge.directory.value ? `协同目录 · ${bridge.directory.value}` : '挂载协同目录'" :aria-expanded="open" aria-controls="askDirectoryMenu" aria-haspopup="menu" :title="bridge.error.value || (attention ? '恢复目录连接' : bridge.directory.value || '挂载协同目录')" :disabled="bridge.busy.value" @click="activate(toggle)"><AppIcon name="i-folder" /><span>{{ bridge.directory.value || '挂载目录' }}</span></button>
    </template>
    <template #default="{ close }">
      <template v-if="bridge.directory.value">
        <button class="ask-menu-item" role="menuitem" type="button" @click="close(); bridge.mount()"><AppIcon name="i-swap" /><span class="ask-menu-label">切换目录</span></button>
        <button class="ask-menu-item" role="menuitem" type="button" @click="close(); bridge.unmount()"><AppIcon name="i-close" /><span class="ask-menu-label">卸载目录</span></button>
      </template>
      <button v-else class="ask-menu-item" role="menuitem" type="button" @click="close(); ask.openSettings()"><AppIcon name="i-settings" /><span class="ask-menu-label">外部协同设置</span></button>
    </template>
  </AskMenu>
</template>
<style scoped>
.directory-chip { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 4px; min-width: 36px; max-width: 132px; height: 22px; padding: 0 6px; color: var(--fg-2); font: 11px var(--sans); white-space: nowrap; background: var(--ask-hover, var(--hover)); border-radius: var(--r1); }
.directory-chip > .ico { flex: none; --ico: var(--ico-xs); }
.directory-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.directory-chip:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--hover); }
.directory-chip.attention { color: var(--warn); }
</style>
