<script setup lang="ts">
import type { GraphTool, SelectionMode } from './view.ts';
import { computed, useId } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import EditToolMode from '../../workspaces/edit/EditToolMode.vue';
const props = defineProps<{ tool: GraphTool; selectionMode: SelectionMode; percent: number; annotationDisabled: boolean }>();
const emit = defineEmits(['tool', 'mode', 'zoom', 'fit']);
const id = useId();
const options = [
  { value: 'single', label: '单选', icon: 'i-select-cursor' },
  { value: 'multi', label: '多选', icon: 'i-layers' },
  { value: 'box', label: '框选', icon: 'i-select-rect' },
];
const choice = computed(() => options.find(option => option.value === props.selectionMode) ?? options[0]);
</script>
<template>
    <div class="editor-tool-controls" role="group" aria-label="关系图工具">
      <div class="editor-tool-capsule">
        <button class="ibtn" type="button" aria-label="平移工具" data-tip="平移 · H · 拖动空白 / 空格 / 中键" :aria-pressed="tool === 'pan'" @click="emit('tool', 'pan')"><AppIcon name="i-hand" /></button>
        <EditToolMode :id="`graphSelect${id}`" :label="choice.label" :aria-label="`选择工具：${choice.label}`" :title="`选择 · ${choice.label}`" :icon="choice.icon" :active="tool === 'select'" :disabled="false" menu-label="方式" :value="selectionMode" :options="options" @toggle="emit('tool', 'select')" @select="emit('mode', $event)" />
        <button class="ibtn" type="button" :disabled="annotationDisabled" aria-label="批注工具" data-tip="批注 · N" :aria-pressed="tool === 'annotate'" @click="emit('tool', 'annotate')"><AppIcon name="i-annotate" /></button>
      </div>
      <div class="editor-tool-capsule">
        <button class="ibtn" type="button" aria-label="缩小关系图" data-tip="缩小" @click="emit('zoom', 'out')"><AppIcon name="i-zoom-out" /></button>
        <button class="editor-zoom mono" type="button" aria-label="关系图原始大小" data-tip="原始大小" @click="emit('zoom', 'actual')">{{ percent }}%</button>
        <button class="ibtn" type="button" aria-label="放大关系图" data-tip="放大" @click="emit('zoom', 'in')"><AppIcon name="i-zoom-in" /></button>
        <button class="ibtn" type="button" aria-label="关系图适应全部" data-tip="适应全部" @click="emit('fit')"><AppIcon name="i-fit" /></button>
      </div>
    </div>
</template>
