<script setup lang="ts">
import AppIcon from '../../shared/AppIcon.vue';
import RetrospectActions from './RetrospectActions.vue';
import { useRetrospects } from './use-retrospects.ts';
const { active, open } = useRetrospects();
</script>
<template>
  <div v-if="active" class="ask-retrospect-bar" aria-label="当前演进">
    <button class="retrospect-entry" type="button" aria-label="打开当前演进" :title="active.value.title" @click="open(active.id)"><AppIcon name="i-branch" /><b>演进</b><span class="retrospect-current">{{ active.value.title }}</span><small>{{ active.value.nodes.length }} 版</small></button>
    <RetrospectActions :record-id="active.id" />
  </div>
</template>
<style scoped>
.ask-retrospect-bar { display: flex; align-items: center; gap: var(--sp-1); flex: none; min-width: 0; margin-bottom: var(--sp-2); --retrospect-action-size: 24px;  }
.ask-retrospect-bar :deep(.retrospect-more .ico) { --ico: var(--ico-xs); }
/* Match AskTodos: one 20px leading slot, a fixed label, then the current item and count. */
.retrospect-entry { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; min-height: 28px; padding-right: var(--sp-1); text-align: left; color: var(--fg-3); font-size: var(--fz-xs); white-space: nowrap; border-radius: var(--r2); }
.retrospect-entry:hover { background: var(--ask-hover, var(--hover)); }
.retrospect-entry > .ico { flex: none; --ico: var(--ico-xs); margin-inline: calc((20px - var(--ico-xs)) / 2); color: var(--a); }
.retrospect-entry b { flex: none; color: var(--a); font-weight: var(--fw-medium); }
.retrospect-current { min-width: 0; margin-left: 3px; overflow: hidden; text-overflow: ellipsis; color: var(--fg-2); }
.retrospect-entry:hover .retrospect-current { color: var(--fg); }
.retrospect-entry small { flex: none; margin-left: auto; padding-left: var(--sp-3); font: var(--fz-2xs)/1 var(--mono); font-variant-numeric: tabular-nums; }
</style>
