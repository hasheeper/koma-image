<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useAsk } from '../../app/ask.ts';
import AskDrawer from '../AskDrawer.vue';
const Panel = defineAsyncComponent(() => import('./RetrospectPanel.vue'));
const ask = useAsk(), registry = ask.retrospects;
const record = computed(() => registry.opened.value ? registry.get(registry.opened.value.id) : undefined);
</script>
<template>
  <Teleport :to="registry.host.value || 'body'" :disabled="!registry.host.value">
    <div v-show="!registry.host.value || ask.visible.value" class="retrospect-host" :class="{ hosted: !!registry.host.value }"><AskDrawer /></div>
  </Teleport>
  <Panel v-if="record && registry.opened.value" :key="registry.opened.value.key" :record-id="record.id" :value="record.value" :picture-refs="record.pictureRefs" :initial-version="registry.opened.value.initialVersion" @close="registry.close" />
</template>
<style scoped>
.retrospect-host { display: contents; }
@media (min-width: 861px) {
  .hosted :deep(.ask-island) { top: var(--ask-top, 88px); right: var(--ask-right, calc(100vw - min(var(--ask-width), calc(100vw - 16px)) - 40px)); }
  .hosted :deep(.ask-island[data-mode="exp"]) { height: min(var(--ask-height), calc(100dvh - 112px)); }
}
</style>
