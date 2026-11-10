<script setup lang="ts">
import type { ReviewPicture } from './view.ts';
import { computed } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
const props = defineProps<{ samples: readonly ReviewPicture[]; selected: string; version: string }>();
defineEmits(['select']);
const index = computed(() => props.samples.findIndex(s => s.id === props.selected));
const thumbnails = computed(() => {
  const start = Math.max(0, Math.min(index.value - 1, props.samples.length - 3));
  return props.samples.slice(start, start + 3);
});
</script>
<template>
  <div v-if="samples.length > 1" class="editor-tool-capsule sample-strip" role="group" :aria-label="version + ' 同配方样本'">
    <div class="sample-thumbnails">
      <button v-for="sample in thumbnails" :key="sample.id" type="button" class="sample-thumbnail" :aria-label="'查看样本 ' + sample.id" :aria-pressed="sample.id === selected" @click="$emit('select', sample.id)"><img :src="sample.url" alt="" /></button>
    </div>
    <button class="ibtn" type="button" aria-label="上一张样本" :disabled="index <= 0" @click="$emit('select', samples[index - 1].id)"><AppIcon name="i-back" /></button>
    <span class="sample-count">{{ index + 1 }}/{{ samples.length }}</span>
    <button class="ibtn" type="button" aria-label="下一张样本" :disabled="index >= samples.length - 1" @click="$emit('select', samples[index + 1].id)"><AppIcon name="i-chevron" /></button>
  </div>
</template>
<style scoped>
.sample-thumbnails { display: flex; gap: var(--sp-1); padding-left: var(--sp-2); }
.sample-thumbnail { display: grid; place-items: center; width: 24px; height: var(--editor-tool-size); border-radius: var(--r1); opacity: .55; }
.sample-thumbnail img { display: block; width: 20px; height: 28px; object-fit: contain; border-radius: var(--r1); }
.sample-thumbnail:hover { opacity: 1; }
.sample-thumbnail[aria-pressed="true"] { opacity: 1; box-shadow: inset 0 0 0 1px var(--a-line); }
.sample-count { min-width: 28px; text-align: center; font: var(--fz-2xs) var(--mono); font-variant-numeric: tabular-nums; color: var(--fg-2); }
@container retrospect-stage (max-width: 600px) { .sample-thumbnails { display: none; } }
</style>
