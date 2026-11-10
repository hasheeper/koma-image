<script setup lang="ts">
import AppIcon from '../../shared/AppIcon.vue';
import { useRetrospects } from './use-retrospects.ts';
const { active, open } = useRetrospects();
</script>
<template><button v-if="active" class="board-retrospect-entry" type="button" aria-label="打开画板演进，进行中" :title="`进行中 · ${active.value.title}`" @click="open(active.id)"><AppIcon name="i-branch" /><span>演进</span><i class="active-dot" aria-hidden="true"></i></button></template>
<style scoped>
.board-retrospect-entry { position: relative; align-self: center; display: flex; align-items: center; gap: var(--sp-1); flex: none; height: 28px; padding-inline: var(--sp-2); margin-right: var(--sp-1); color: var(--a); background: var(--a-dim); border-radius: 999px; font-size: var(--fz-xs); font-weight: var(--fw-medium); --ico: var(--ico-sm); }
.board-retrospect-entry:hover { background: color-mix(in srgb, var(--a) 20%, var(--well-raised)); }
.active-dot { flex: none; width: 5px; height: 5px; margin-left: var(--sp-1); background: currentColor; border-radius: 50%; }
@container (max-width: 290px) { .board-retrospect-entry { width: 28px; padding: 0; justify-content: center; } .board-retrospect-entry span { display: none; } .active-dot { position: absolute; top: 4px; right: 4px; width: 4px; height: 4px; margin: 0; } }
</style>
