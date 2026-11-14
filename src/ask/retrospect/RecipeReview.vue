<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import ModeToggle from './ModeToggle.vue';
import GroupBody from './GroupBody.vue';
import { groupsOf } from './groups.ts';
import { recipeWorkspace } from './recipe.ts';

import type { RetrospectNode } from './model.ts';
import type { RecipeGroup } from './groups.ts';
const props = defineProps<{ a: RetrospectNode | null; b: RetrospectNode }>();
const full = shallowRef(false), closed = shallowRef(new Set<string>());
const scrolled = shallowRef(false);
const scroll = useTemplateRef<HTMLElement>('scroll');
const groups = computed(() => groupsOf(props.a, props.b));
const transition = computed(() => props.a && (recipeWorkspace(props.a.recipe) !== 'image' || recipeWorkspace(props.b.recipe) !== 'image')
  ? `${recipeWorkspace(props.a.recipe).toUpperCase()} → ${recipeWorkspace(props.b.recipe).toUpperCase()}` : '');
const effectiveFull = computed(() => !props.a || !!transition.value || full.value);
const changed = computed(() => groups.value.some(g => g.changed));
const incomplete = computed(() => groups.value.some(g=>g.unknown) || [props.a, props.b].filter((n): n is RetrospectNode => !!n).some(n => n.recipe.prompt === null || n.recipe.negative === null || n.recipe.characters === null));
function isClosed(group: RecipeGroup) {
  if (closed.value.has(group.id)) return closed.value.has(`${group.id}:closed`);
  return !!props.a && !effectiveFull.value && !group.changed && !group.unknown;
}
function toggle(group: RecipeGroup) {
  const next = new Set(closed.value); next.add(group.id);
  if (isClosed(group)) next.delete(`${group.id}:closed`); else next.add(`${group.id}:closed`);
  closed.value = next;
}
watch(() => [props.a?.id, props.a?.cover, props.b.id, props.b.cover], () => { closed.value = new Set<string>(); scrolled.value = false; if (scroll.value) scroll.value.scrollTop = 0; });
</script>
<template>
  <section class="recipe-review" :class="{ scrolled, identical: a && !changed && !incomplete }" aria-label="配方审阅">
    <header class="review-head"><span>{{ transition ? '原始输入与操作' : '配方' }}<small v-if="a && !changed && !incomplete"> · 相同</small></span><ModeToggle v-if="!transition" :full="effectiveFull" :disabled="!a" @change="full = $event" /><small v-else>{{ transition }}</small></header>
    <div ref="scroll" class="review-scroll" @scroll.passive="scrolled = ($event.target as HTMLElement).scrollTop > 0">
      <div class="review-groups">
        <p v-if="transition" class="transition-hint">分别展示各图的原始输入与操作；工坊记录不计算词文删改。</p>
        <section v-for="group in groups" :key="`${a?.id}:${b.id}:${group.id}`" class="recipe-group" :class="{ collapsed: isClosed(group), unchanged: !group.changed }" :aria-label="group.label">
          <button class="group-head" type="button" :aria-expanded="!isClosed(group)" @click="toggle(group)"><strong>{{ group.label }}</strong><small v-if="group.state">{{ group.state }}</small><small v-else-if="group.unknown">部分未记录</small><small v-else-if="isClosed(group) && !group.changed">未改动</small><AppIcon name="i-chevron" :class="{ open: !isClosed(group) }" /></button>
          <GroupBody v-if="!isClosed(group)" :group="group" :full="effectiveFull || !group.changed" :baseline="!!a && !group.standalone" />
        </section>
        <p v-if="incomplete" class="missing">原始配方未完整记录</p>
      </div>
    </div>
  </section>
</template>
<style scoped>
.recipe-review { --recipe-group-bg: color-mix(in srgb, var(--chrome) 70%, var(--sunken)); display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; padding-top: var(--sp-1); background: var(--chrome); }
/* The mode header is outside the scroll container; content cannot leak above it. */
.review-head { display: flex; flex: none; align-items: center; justify-content: space-between; gap: var(--sp-2); padding: var(--sp-1) var(--sp-4); color: var(--fg-2); font-size: var(--fz-sm); }
.review-head small { color: var(--fg-3); font-size: inherit; }
.review-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.review-groups { padding: var(--sp-2) var(--sp-3) var(--sp-5); }
.recipe-group { min-width: 0; padding: var(--sp-3); border-radius: var(--r3); background: var(--recipe-group-bg); }
.recipe-group + .recipe-group { margin-top: var(--sp-4); }
.group-head { position: sticky; top: 0; z-index: 1; display: flex; width: 100%; align-items: center; gap: var(--sp-2); min-height: 32px; padding: var(--sp-1) 0 var(--sp-2); background: var(--recipe-group-bg); color: var(--fg); text-align: left; }
.group-head strong { flex: 1; font-size: var(--fz-md); font-weight: var(--fw-semibold); }
.group-head small { font-size: var(--fz-xs); color: var(--fg-3); }
.group-head .ico { --ico: var(--ico-xs); color: var(--fg-3); }
.group-head .open { transform: rotate(90deg); }
.collapsed .group-head { position: static; }
.missing { margin: var(--sp-3) 0 0; font-size: var(--fz-xs); color: var(--fg-3); }
.transition-hint { margin: 0 0 var(--sp-3); font-size: var(--fz-xs); color: var(--fg-3); }
.group-head::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: var(--sp-2); background: linear-gradient(var(--recipe-group-bg), transparent); pointer-events: none; }
.collapsed .group-head::after { display: none; }
.review-head { position: relative; z-index: 2; }
.scrolled .review-head::after { content: ''; position: absolute; top: 100%; left: var(--sp-4); right: var(--sp-4); height: var(--sp-2); background: linear-gradient(var(--chrome), transparent); pointer-events: none; }
.identical .recipe-group + .recipe-group { margin-top: var(--sp-3); }
.unchanged .group-head strong { color: var(--fg-2); }

</style>
