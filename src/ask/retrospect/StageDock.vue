<script setup lang="ts">
import { watch, useTemplateRef } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';

const props = defineProps<{ embedded?: boolean; inline?: boolean; scene: 'graph' | 'image'; imageDisabled?: boolean; detailOpened: boolean; detailId: string; askOpened: boolean; askDisabled: boolean }>();
defineEmits<{ scene: [value: 'graph' | 'image']; detail: []; ask: [] }>();
const dock = useTemplateRef<HTMLElement>('dock'), recipe = useTemplateRef<HTMLButtonElement>('recipe');
watch([dock, () => props.inline], ([element, inline], _, onCleanup) => {
  if (!element || inline) return;
  const stage = element.closest<HTMLElement>('.stage-panel');
  const observer = new ResizeObserver(() => {
    const height = element.offsetHeight;
    if (height) stage?.style.setProperty('--stage-dock-space', `${height + 32}px`);
  });
  observer.observe(element);
  onCleanup(() => { observer.disconnect(); stage?.style.removeProperty('--stage-dock-space'); });
}, { flush: 'post' });
defineExpose({ focusRecipe() { recipe.value?.focus({ preventScroll: true }); } });
</script>
<template>
  <div ref="dock" class="editor-toolbar stage-dock" :class="{ embedded, inline }" :data-scene="scene" role="toolbar" aria-label="演进工具">
    <div class="editor-tool-controls stage-dock-controls">
      <div v-if="!embedded" class="editor-tool-capsule">
        <button class="editor-tool stage-view-toggle" type="button" :disabled="scene === 'graph' && imageDisabled" :aria-label="scene === 'graph' ? '大图' : '演进图'" :data-tip="scene === 'graph' ? '查看大图' : '返回演进图'" @click="$emit('scene', scene === 'graph' ? 'image' : 'graph')"><AppIcon :name="scene === 'graph' ? 'i-upscale' : 'i-branch'" />{{ scene === 'graph' ? '大图' : '演进图' }}</button>
      </div>
      <div class="stage-context-controls"><slot /></div>
      <div v-if="!embedded" class="editor-tool-capsule">
        <button ref="recipe" class="editor-tool" type="button" aria-label="配方" :aria-expanded="detailOpened" :aria-controls="detailId" :data-tip="detailOpened ? '收起配方' : '展开配方对比'" @click="$emit('detail')"><AppIcon name="i-sidebar" />配方</button>
      </div>
      <div v-if="!embedded" class="editor-tool-capsule stage-ask-capsule">
        <button class="editor-tool" type="button" aria-label="ASK" :aria-pressed="askOpened" :disabled="askDisabled" :data-tip="askOpened ? '收起 ASK' : '在演进中打开 ASK'" @click="$emit('ask')"><AppIcon name="i-ask" />ASK</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.stage-dock { left: calc((100% - var(--stage-float-reserve, 0px)) / 2); bottom: calc(var(--sp-4) + env(safe-area-inset-bottom)); max-width: calc(100% - var(--stage-float-reserve, 0px) - 24px); pointer-events: none; }
.stage-dock.inline { position: static; max-width: none; transform: none; }
.inline .stage-dock-controls, .inline :deep(.editor-tool-controls) { flex-wrap: nowrap; }
.stage-dock :deep(.editor-tool-capsule) { pointer-events: auto; }
.stage-context-controls { display: flex; align-items: center; justify-content: center; min-width: 0; max-width: 100%; }
.embedded .stage-context-controls { display: contents; }
.stage-ask-capsule .editor-tool { color: var(--a); }
.stage-ask-capsule .editor-tool[aria-pressed="true"] { background: var(--a-dim); }
@container retrospect-stage (max-width: 1100px) {
  .stage-dock:not(.embedded) .stage-context-controls { order: -1; flex-basis: 100%; }
}
@container canvas-workspace (max-width: 620px) {
  .stage-dock.inline { --editor-tool-size: 28px; --editor-tool-arrow-size: 14px; }
  .inline .stage-dock-controls, .inline :deep(.editor-tool-controls) { gap: 6px; }
  .inline :deep(.editor-zoom) { min-width: 38px; }
}
</style>
