<script setup lang="ts">
import { computed } from 'vue';
import { useBridge } from '../app/bridge.ts';
import { useAsk } from '../app/ask.ts';
import { useUi, message } from '../app/ui.ts';
import type { Directory } from './fs-driver.ts';
import AppIcon from '../shared/AppIcon.vue';
defineProps<{home?:boolean}>();
const bridge=useBridge(),ask=useAsk(),ui=useUi();
const attention=computed(()=>!!bridge.directory.value&&!['active','readonly'].includes(bridge.phase.value));
const title=computed(()=>bridge.project.value?.title||bridge.directory.value||'企划目录');
const label=computed(()=>bridge.mountStep.value ? '取消挂载' : bridge.directory.value ? `打开企划集 · ${title.value}` : '挂载企划目录');
async function activate(){
  if(bridge.mountStep.value){await bridge.cancelMount();return;}
  if(bridge.directory.value){bridge.openProject();return;}
  if(!bridge.supported){ask.openSettings();return;}
  await bridge.mount(undefined, true);
}
function dragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.stopPropagation(); event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}
async function drop(event: DragEvent) {
  const transfer = event.dataTransfer;
  if (!transfer?.types.includes('Files')) return;
  event.stopPropagation(); event.preventDefault();
  const files = Array.from(transfer.items).filter(i => i.kind === 'file');
  const item = files[0] as (DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }) | undefined;
  try {
    if (files.length !== 1 || !item) throw new Error('请拖入一个企划文件夹');
    if (!item.getAsFileSystemHandle) throw new Error('当前浏览器请点击按钮选择企划目录');
    // Capture the handle within the drop event, before its data store expires.
    const handle = await item.getAsFileSystemHandle();
    if (handle?.kind !== 'directory') throw new Error('请拖入企划文件夹，例如包含 project.json 的目录');
    await bridge.cancelMount();
    await bridge.mount(handle as Directory, true);
  } catch (e) { ui.toast(message(e), 'err'); }
}
</script>
<template>
  <button class="directory-chip" :class="{attention,home}" type="button" :aria-label="label"
    :title="bridge.mountStep.value ? bridge.mountStep.value + '，点击取消' : bridge.error.value || (bridge.directory.value ? title : '选择目录，或拖入企划文件夹')"
    :disabled="!bridge.directory.value && bridge.busy.value && !bridge.mountStep.value" @click="activate" @dragover="dragOver" @drop="drop">
    <i v-if="home && bridge.directory.value" class="directory-dot" aria-hidden="true"></i>
    <AppIcon :name="bridge.mountStep.value ? 'i-close' : 'i-folder'"/><span>{{ bridge.mountStep.value ? bridge.mountStep.value + ' · 取消' : title }}</span>
  </button>
</template>
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
