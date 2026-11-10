<script setup lang="ts">

import AppIcon from '../../shared/AppIcon.vue';
defineProps<{ labels: readonly string[] }>();
</script>
<template>
  <details class="same-fields">
    <summary :title="labels.join(' · ')" :aria-label="`未改动：${labels.join('、')}`"><span>未改动</span><AppIcon name="i-chevron" /></summary>
    <div class="same-content"><slot /></div>
  </details>
</template>
<style scoped>
.same-fields { min-width: 0; }
.same-fields summary { display: flex; align-items: center; gap: var(--sp-1); min-height: 24px; color: var(--fg-3); font-size: var(--fz-xs); list-style: none; cursor: pointer; border-radius: var(--r1); }
.same-fields summary::-webkit-details-marker { display: none; }
.same-fields summary:hover { color: var(--fg-2); background: var(--hover); }
.same-fields .ico { --ico: var(--ico-xs); flex: none; }
.same-fields[open] > summary .ico { transform: rotate(90deg); }
.same-content { display: grid; gap: 6px; padding-top: var(--sp-1); }
</style>
