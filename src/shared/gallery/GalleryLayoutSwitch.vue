<script setup lang="ts">
import { galleryLayouts } from './layout.ts';
import type { GalleryLayout } from './layout.ts';
defineProps<{ modelValue: GalleryLayout; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: GalleryLayout] }>();
const names = { rows: '行对齐', cols: '列对齐', mosaic: '拼图' };
</script>

<template>
  <div class="seg gallery-layout-switch" role="group" :aria-label="label">
    <button v-for="layout in galleryLayouts" :key="layout" type="button" :aria-pressed="modelValue===layout" @click="emit('update:modelValue',layout)">{{ names[layout] }}</button>
  </div>
</template>

<style scoped>
.gallery-layout-switch { flex: none; }
.gallery-layout-switch button { display: block; padding: 3px 10px; color: var(--fg-3); font-size: var(--fz-xs); border-radius: var(--r1); transition: background var(--t1) var(--e), color var(--t1) var(--e); }
.gallery-layout-switch [aria-pressed=true] { color: var(--nav-active-ink); background: var(--nav-active-bg); box-shadow: var(--sh-1); }
</style>
