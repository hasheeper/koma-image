<script setup lang="ts">
import type { RetrospectNode } from './model.ts';
import type { ReviewPicture } from './view.ts';
defineProps<{ pane: { node: RetrospectNode; mark: string }; picture: ReviewPicture; active: boolean }>();
</script>
<template>
  <header class="pane-identity" :class="{ active }">
    <p class="editor-info-meta">
      <b><span class="pane-side">{{ pane.mark }}</span>{{ pane.node.id }}</b>
      <span class="mono">{{ picture.id }}</span>
    </p>
    <span v-if="picture.width && picture.height" class="pane-dimensions mono">{{ picture.width }}×{{ picture.height }}</span>
  </header>
</template>
<style scoped>
.pane-identity { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); height: 32px; flex: none; }
.pane-side { margin-right: var(--sp-2); color: var(--fg-3); font-weight: var(--fw-regular); }
.pane-identity .editor-info-meta .mono { display: inline; }
.active .pane-side { color: var(--a); }
.pane-dimensions { color: var(--fg-3); font-size: var(--fz-2xs); }
@container image-pane (max-width: 280px) { .pane-dimensions { display: none; } }
</style>
