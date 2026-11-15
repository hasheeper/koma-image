<script setup lang="ts">
import { computed } from 'vue';
import { useBridge } from '../app/bridge.ts';
import { useAsk } from '../app/ask.ts';
import AppIcon from '../shared/AppIcon.vue';
defineProps<{home?:boolean}>();
const bridge=useBridge(),ask=useAsk();
const attention=computed(()=>!!bridge.directory.value&&bridge.phase.value!=='active');
const title=computed(()=>bridge.project.value?.title||bridge.directory.value||'企划目录');
async function activate(){
  if(!bridge.supported){ask.openSettings();return;}
  if(!bridge.directory.value)await bridge.mount();else if(attention.value)await bridge.resume();
  if(bridge.directory.value)bridge.openProject();
}
</script>
<template><button class="directory-chip" :class="{attention,home}" type="button" :aria-label="bridge.directory.value ? `打开企划集 · ${title}` : '挂载企划目录'" :title="bridge.error.value || title" :disabled="bridge.busy.value" @click="activate"><i v-if="home && bridge.directory.value" class="directory-dot" aria-hidden="true"></i><AppIcon name="i-folder"/><span>{{ title }}</span></button></template>
<style scoped>
.directory-chip { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 4px; min-width: 36px; max-width: 132px; height: var(--composer-chip); padding: 0 8px; color: var(--fg-2); font: 12px var(--sans); white-space: nowrap; background: var(--ask-hover, var(--hover)); border-radius: var(--r2); }
.directory-chip > .ico { flex: none; --ico: var(--ico-xs); }
.directory-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.directory-chip:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--hover); }
.directory-chip.attention { color: var(--warn); }
.directory-chip.home { height: 26px; max-width: 180px; padding: 0 9px; gap: 5px; background: none; font-size: var(--fz-xs); border-radius: 13px; }
.directory-chip.home > .ico { --ico: var(--ico-sm); }
.directory-dot { flex: none; width: 5px; height: 5px; background: var(--ok); border-radius: 50%; }
.attention .directory-dot { background: var(--warn); }
@media (max-width: 560px) { .directory-chip.home > span { display: none; } }
</style>
