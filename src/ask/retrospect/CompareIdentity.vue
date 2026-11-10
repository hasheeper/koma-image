<script setup lang="ts">
import type { RetrospectNode } from './model.ts';
import type { ReviewPicture } from './view.ts';
import AppIcon from '../../shared/AppIcon.vue';
import { computed } from 'vue';
const props = defineProps<{ node?: RetrospectNode | null; sample?: ReviewPicture | null; mark?: string; stacked?: boolean; compact?: boolean; hero?: boolean; brief?: boolean; description?: string }>();
const ratio = computed(() => {
  const recipe = props.node && (props.node.recipes?.[props.sample?.id ?? props.node.cover] ?? props.node.recipe);
  const width = props.sample?.width ?? recipe?.params.width, height = props.sample?.height ?? recipe?.params.height;
  return typeof width === 'number' && typeof height === 'number' && Number.isFinite(width / height) && width > 0 && height > 0 ? width / height : 2 / 3;
});
</script>
<template>
  <span class="identity" :class="{ stacked, compact, hero, titled: !!$slots.default }" :title="brief && sample ? `${node?.id ?? '—'} · ${sample.id}` : undefined">
    <span class="thumb" :style="{ '--thumb-ratio': ratio }"><img v-if="sample?.url" :src="sample.url" alt="" /><AppIcon v-else name="i-branch" /><span v-if="mark">{{ mark }}</span></span>
    <span class="meta"><span class="meta-line"><strong>{{ node?.id ?? '—' }}</strong><span v-if="$slots.default" class="meta-title"><slot /></span><small v-if="sample" :class="{ 'sr-only': brief }">{{ sample.id }}</small></span><span v-if="description" class="meta-description" :title="description">{{ description }}</span></span>
  </span>
</template>
<style scoped>
.identity { display: inline-flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.thumb { --thumb-w: 36px; --thumb-h: 36px; position: relative; display: grid; place-items: center; flex: none; width: min(var(--thumb-w), calc(var(--thumb-h) * var(--thumb-ratio))); height: min(var(--thumb-h), calc(var(--thumb-w) / var(--thumb-ratio))); border-radius: var(--r1); overflow: hidden; background: var(--canvas); }
.thumb img { display: block; width: 100%; height: 100%; object-fit: contain; }
.thumb > span { position: absolute; left: 1px; top: 1px; padding: 0 2px; border-radius: var(--r1); background: color-mix(in srgb, var(--chrome) 80%, transparent); color: var(--a); font: var(--fz-2xs)/1.2 var(--mono); }
.thumb > .ico { --ico: var(--ico-sm); color: var(--fg-3); }
.meta { display: flex; align-items: baseline; gap: 6px; overflow: hidden; min-width: 0; }
.meta strong { flex: none; font: var(--fw-semibold) var(--fz-md)/1.3 var(--mono); }
.meta small { color: var(--fg-3); font: var(--fz-xs)/1.3 var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta-line { display: contents; }
.stacked .meta { display: grid; gap: 2px; }
.compact { gap: 6px; }
.compact .thumb { --thumb-w: 28px; --thumb-h: 27px; }
.compact .meta strong { font-size: var(--fz-sm); }
.hero .thumb { --thumb-w: 64px; --thumb-h: 56px; border-radius: var(--r2); }
.titled { display: flex; width: 100%; gap: var(--sp-3); }
.titled .meta { display: grid; flex: 1; gap: var(--sp-1); }
.titled .meta-line { display: flex; align-items: baseline; gap: var(--sp-2); min-width: 0; }
.titled .meta strong { color: var(--fg-3); font-size: var(--fz-sm); font-weight: var(--fw-medium); }
.titled .meta-title { min-width: 0; overflow: hidden; color: var(--fg); font-size: var(--fz-md); font-weight: var(--fw-semibold); line-height: 1.5; white-space: nowrap; text-overflow: ellipsis; }
.meta-description { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.6; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
</style>
