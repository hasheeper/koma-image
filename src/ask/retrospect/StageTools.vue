<script setup lang="ts">
import type { ReviewPicture, ImageView } from './view.ts';
import AppIcon from '../../shared/AppIcon.vue';
import SampleStrip from './SampleStrip.vue';
defineProps<{ view: ImageView; hasBaseline: boolean; activeMark: string; zoomLabel: string; samples: readonly ReviewPicture[]; selectedSample: string; version: string }>();
defineEmits(['view', 'imageAction', 'sample']);
</script>
<template>
    <div class="editor-tool-controls retrospect-tools" role="group" aria-label="图片查看工具">
      <SampleStrip :samples="samples" :selected="selectedSample" :version="version" @select="$emit('sample', $event)" />
      <div class="editor-tool-capsule viewer-modes" role="group" aria-label="图片对照方式">
        <button class="editor-tool" type="button" :disabled="!hasBaseline" :aria-pressed="view === 'A'" aria-label="查看 A 基准图" data-tip="A · 基准" @click="$emit('view', 'A')">A</button>
        <button class="editor-tool" type="button" :aria-pressed="view === 'B'" aria-label="查看 B 当前图" data-tip="B · 当前" @click="$emit('view', 'B')">B</button>
        <button class="editor-tool" type="button" :disabled="!hasBaseline" :aria-pressed="view === 'pair'" @click="$emit('view', 'pair')">并排</button>
      </div>
      <div class="editor-tool-capsule viewer-zoom" role="group" :aria-label="'缩放 ' + activeMark">
        <button class="ibtn zoom-step" type="button" :aria-label="'缩小 ' + activeMark + ' 图'" data-tip="缩小" @click="$emit('imageAction', 'step', -1)"><AppIcon name="i-zoom-out" /></button>
        <button class="editor-zoom mono" type="button" :aria-label="activeMark + ' 图原始大小'" data-tip="原始大小" @click="$emit('imageAction', 'actualSize')">{{ zoomLabel }}</button>
        <button class="ibtn zoom-step" type="button" :aria-label="'放大 ' + activeMark + ' 图'" data-tip="放大" @click="$emit('imageAction', 'step', 1)"><AppIcon name="i-zoom-in" /></button>
        <button class="ibtn" type="button" :aria-label="activeMark + ' 图适应画面'" data-tip="适应画面" @click="$emit('imageAction', 'fit')"><AppIcon name="i-fit" /></button>
      </div>
    </div>
</template>
<style scoped>
/* Surface, spacing, button sizing and interaction come from the actual EDIT toolbar. */
.viewer-modes .editor-tool { min-width: var(--editor-tool-size); justify-content: center; padding-inline: var(--sp-2); }
@container retrospect-stage (max-width: 600px) { .zoom-step { display: none; } }
</style>
