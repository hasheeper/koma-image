<script setup lang="ts">
import { computed } from 'vue';
import type { PositionChange } from './groups.ts';
const props = defineProps<{ value: PositionChange; compare: boolean }>();
const points = computed(() => Array.from({ length: Math.max(props.compare ? props.value.before?.length ?? 0 : 0, props.value.after?.length ?? 0) }, (_, i) => ({
  before: props.compare ? props.value.before?.[i] : undefined,
  after: props.value.after?.[i],
})));
</script>
<template>
  <div class="position-changes">
    <p v-if="compare && (value.before === null || value.after === null)" class="position-missing">{{ value.before === null ? '基准未记录' : '此版未记录' }}</p>
    <p v-if="!points.length" class="position-empty">{{ value.after === null ? '未记录' : '未设置' }}</p>
    <div v-for="(point, i) in points" :key="i" class="position-row">
      <small v-if="points.length > 1" class="point-number">{{ i + 1 }}</small>
      <span v-for="axis in (['x', 'y'] as const)" :key="axis" class="position-axis">
        <span class="axis-label">{{ axis.toUpperCase() }}</span>
        <template v-if="compare && point.before?.[axis] !== point.after?.[axis]">
          <del v-if="point.before">{{ point.before[axis] }}</del><span v-if="point.before && point.after" class="position-arrow" aria-label="变为">→</span><ins v-if="point.after">{{ point.after[axis] }}</ins>
        </template>
        <span v-else class="position-value">{{ point.after?.[axis] }}</span>
      </span>
    </div>
  </div>
</template>
<style scoped>
.position-changes { display: grid; gap: var(--sp-1); min-width: 0; font-size: var(--fz-sm); line-height: 1.6; font-variant-numeric: tabular-nums; }
.position-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2) var(--sp-4); }
.position-axis { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-1); min-width: 0; overflow-wrap: anywhere; }
.axis-label, .point-number, .position-arrow, .position-missing, .position-empty { color: var(--fg-3); }
.axis-label, .point-number { font-size: var(--fz-xs); }
.position-value { color: var(--fg-2); }
.position-axis :is(del, ins) { padding-inline: var(--sp-1); border-radius: var(--r1); }
.position-axis del { color: var(--fg-2); background: var(--diff-del); text-decoration-color: var(--err); }
.position-axis ins { color: var(--fg); background: var(--diff-ins); text-decoration: none; }
.position-missing, .position-empty { margin: 0; font-size: var(--fz-xs); }
</style>
