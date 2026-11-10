<script setup lang="ts">
import AppIcon from '../../shared/AppIcon.vue';
import ComparePair from './ComparePair.vue';
import RecipeReview from './RecipeReview.vue';
import type { Retrospect, RetrospectNode } from './model.ts';
import type { ReviewPicture } from './view.ts';
defineProps<{ mode: 'floating' | 'sidebar'; a: RetrospectNode | null; b: RetrospectNode; graph: Retrospect; pictures: Record<string, ReviewPicture>; automatic: boolean }>();
const emit = defineEmits<{ baseline: [id: string | null]; swap: []; placement: []; close: [] }>();
</script>
<template>
  <aside class="recipe-inspector" :data-mode="mode" aria-label="原始配方对比">
    <header class="inspector-head">
      <ComparePair :a="a" :b="b" :graph="graph" :pictures="pictures" :automatic="automatic" @baseline="emit('baseline', $event)" @swap="emit('swap')">
        <template #controls>
          <button class="ibtn placement" type="button" :aria-label="mode === 'floating' ? '切换为侧栏' : '切换为悬浮窗'" :title="mode === 'floating' ? '切换为侧栏' : '切换为悬浮窗'" :aria-pressed="mode === 'sidebar'" @click="emit('placement')"><AppIcon :name="mode === 'floating' ? 'i-sidebar' : 'i-layers'" /></button>
          <button class="ibtn" type="button" aria-label="关闭配方" title="关闭配方" @click="emit('close')"><AppIcon name="i-close" /></button>
        </template>
        <template v-if="$slots.status" #aside><slot name="status" /></template>
      </ComparePair>
    </header>
    <RecipeReview :a="a" :b="b" />
    <footer class="inspector-foot"><slot name="actions" /></footer>
  </aside>
</template>
<style scoped>
.recipe-inspector { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; color: var(--fg); border-radius: 18px; background: var(--chrome); box-shadow: 0 0 0 1px var(--line-2), var(--sh-2); }
.inspector-head { flex: none; padding: var(--sp-3) var(--sp-4) 0; }
.inspector-head::after { content: ''; display: block; height: 1px; margin-top: var(--sp-3); background: var(--line-2); }
.inspector-head .ibtn { flex: none; width: 28px; height: 28px; border-radius: var(--r2); color: var(--fg-2); --ico: var(--ico-sm); }
.inspector-head .ibtn:hover { background: var(--hover); color: var(--fg); }
.placement[aria-pressed="false"] .ico { transform: scaleX(-1); }
.placement[aria-pressed="true"] { color: var(--a); }
.inspector-foot { flex: none; padding: var(--sp-3) var(--sp-4); border-top: 1px solid var(--line-2); }
.inspector-foot :deep(.btn) { min-height: 32px; white-space: nowrap; }
.recipe-inspector[data-mode="sidebar"] { border-radius: 0; box-shadow: -1px 0 0 var(--line-2); }
@media (max-width: 860px) { .recipe-inspector[data-mode] { border-radius: 18px; } .placement { display: none; } }
</style>
