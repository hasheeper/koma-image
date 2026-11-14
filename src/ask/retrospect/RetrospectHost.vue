<script setup lang="ts">
import { computed, defineAsyncComponent, shallowRef, watch } from 'vue';
import { useAsk } from '../../app/ask.ts';
import { useDrawing } from '../../app/drawing.ts';
import { useAskPresentation } from '../presentation.ts';
import AskDrawer from '../AskDrawer.vue';
const Panel = defineAsyncComponent(() => import('./RetrospectPanel.vue'));
const ask = useAsk(), registry = ask.retrospects, { view } = useDrawing(), { canvas, dockedCanvas } = useAskPresentation();
const boardId = computed(() => view.value.activeBoardId);
const activeTree = computed(() => registry.activeForBoard(boardId.value));
const retainedId = shallowRef<string | null>(null), initialVersion = shallowRef<string>();
let embeddedRequest = false, lastBoard = '', lastTree: string | undefined;
watch([canvas.active, boardId, () => activeTree.value?.id], ([active, board, tree]) => {
  if (!active) {
    if (embeddedRequest) { embeddedRequest = false; registry.close(); }
    return;
  }
  if (lastBoard !== board || lastTree !== tree) {
    canvas.recordId.value = tree ?? null;
    canvas.view.value = tree ? 'graph' : 'image';
    initialVersion.value = undefined;
    lastBoard = board; lastTree = tree;
  }
}, { immediate: true, flush: 'sync' });
watch([canvas.active, registry.opened], ([active, opened]) => {
  if (!opened) return;
  initialVersion.value = opened.initialVersion;
  if (active) {
    embeddedRequest = true;
    canvas.recordId.value = opened.id;
    canvas.view.value = 'graph';
  }
}, { immediate: true, flush: 'sync' });
const desiredId = computed(() => canvas.active.value ? canvas.recordId.value : registry.opened.value?.id);
watch(desiredId, id => { if (id) retainedId.value = id; }, { immediate: true, flush: 'sync' });
const record = computed(() => retainedId.value ? registry.get(retainedId.value) : undefined);
const panelVisible = computed(() => canvas.active.value ? !!canvas.recordId.value && canvas.view.value !== 'image' : !!registry.opened.value && !embeddedRequest);
const askTarget = computed(() => dockedCanvas.value ? dockedCanvas.value.askHost.value : registry.host.value);
function closePanel() { if (canvas.active.value) canvas.view.value = 'image'; else registry.close(); }
</script>
<template>
  <Teleport :to="askTarget || 'body'" :disabled="!askTarget">
    <div v-show="!registry.host.value || dockedCanvas || ask.visible.value" class="retrospect-host" :class="{ hosted: !!registry.host.value && !dockedCanvas }"><AskDrawer /></div>
  </Teleport>
  <Panel v-if="record" :key="record.id" :record-id="record.id" :value="record.value" :picture-refs="record.pictureRefs" :initial-version="initialVersion" :embedded="canvas.active.value" :target="canvas.graphHost.value" :actions-target="canvas.actionsHost.value" :detail-target="canvas.recipeHost.value" :covered="canvas.covered.value" :detail-visible="canvas.shownPanel.value === 'context' && canvas.contextKind.value === 'recipe'" @detail="canvas.panel.value = $event ? 'context' : null" :history-visible="canvas.historyVisible.value" @history-host="canvas.historyHost.value = $event" :visible="panelVisible" :canvas-scene="canvas.view.value" @scene="canvas.view.value = $event === 'graph' ? 'graph' : 'node'" @close="closePanel" />
</template>
<style scoped>
.retrospect-host { display: contents; }
@media (min-width: 861px) {
  .hosted :deep(.ask-island) { top: var(--ask-top, 88px); right: var(--ask-right, calc(100vw - min(var(--ask-width), calc(100vw - 16px)) - 40px)); }
  .hosted :deep(.ask-island[data-mode="exp"]) { height: min(var(--ask-height), calc(100dvh - 112px)); }
}
</style>
