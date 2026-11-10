<script setup lang="ts">

defineProps<{ full: boolean; disabled: boolean }>();
defineEmits(['change']);
</script>
<template><div class="mode-toggle" role="group" aria-label="词文查看方式"><button type="button" :disabled="disabled" :aria-pressed="!full" @click="$emit('change', false)">改动</button><button type="button" :disabled="disabled" :aria-pressed="full" @click="$emit('change', true)">全文</button></div></template>
<style scoped>
.mode-toggle { display: inline-flex; flex: none; gap: 2px; padding: 2px; border-radius: var(--r2); background: var(--well-raised); }
.mode-toggle button { padding: 3px var(--sp-2); border-radius: var(--r1); color: var(--fg-3); font-size: var(--fz-xs); }
.mode-toggle button[aria-pressed=true] { color: var(--seg-active-ink); background: var(--seg-active-bg); box-shadow: var(--seg-active-shadow); font-weight: var(--seg-active-weight); }
.mode-toggle button:hover { color: var(--fg); }
.mode-toggle button:disabled { cursor: default; opacity: .55; }
</style>
