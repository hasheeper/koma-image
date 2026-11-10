<script setup lang="ts">
import type { ParameterChange } from './groups.ts';
import AppIcon from '../../shared/AppIcon.vue';
defineProps<{ values: readonly ParameterChange[]; compare: boolean }>();
</script>
<template>
  <dl class="parameter-changes"><div v-for="p in values" :key="p.key" class="parameter-row" :class="{ same: compare && !p.changed }"><dt>{{ p.label.split(' · ').at(-1) }}</dt><dd><del v-if="compare && p.changed">{{ p.before }}</del><AppIcon v-if="compare && p.changed" name="i-chevron" /><b>{{ p.after }}</b></dd></div></dl>
</template>
<style scoped>
/* Each label owns one value comparison; dense rows retain stable alignment. */
.parameter-changes { display: grid; min-width: 0; margin: 0; }
.parameter-row { display: grid; grid-template-columns: minmax(74px, .8fr) minmax(0, 1.2fr); align-items: baseline; gap: var(--sp-3); min-width: 0; min-height: 24px; padding: 2px 0; font-size: var(--fz-sm); line-height: 1.5; }
.parameter-row dt { min-width: 0; color: var(--fg-2); overflow-wrap: anywhere; }
.parameter-row dd { display: flex; justify-content: flex-end; align-items: baseline; flex-wrap: wrap; gap: 6px; min-width: 0; margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.parameter-row del { color: var(--fg-3); text-decoration-color: var(--fg-4); }
.parameter-row b { color: var(--fg); font-weight: var(--fw-medium); }
.parameter-row .ico { --ico: var(--ico-xs); color: var(--fg-3); align-self: center; }
.parameter-row.same :is(dt, b) { color: var(--fg-3); font-weight: var(--fw-regular); }
</style>
