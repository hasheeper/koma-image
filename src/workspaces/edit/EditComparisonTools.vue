<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import PhotopeaIcon from '../../shared/PhotopeaIcon.vue';
import EditToolMode from './EditToolMode.vue';

type Mode = 'source' | 'raw' | 'composite';
const props = defineProps<{
  mode: Mode; compact: boolean; colorMatch: boolean; canComposite: boolean;
  busy: boolean; locked: boolean; canApply: boolean; reason?: string;
}>();
const emit = defineEmits<{ select: [mode: Mode]; color: []; fusion: []; apply: [] }>();
const choices = computed(() => [
  { value: 'source', label: '原图', short: '原图', icon: 'i-image' },
  { value: 'raw', label: 'AI 生成', short: 'AI', icon: 'i-generate' },
  { value: 'composite', label: '蒙版替换', short: '蒙版', icon: 'i-layers', disabled: !props.canComposite || props.busy },
]);
const selected = computed(() => choices.value.find(c => c.value === props.mode)!);
function cycle() {
  const enabled = choices.value.filter(c => !c.disabled), at = enabled.findIndex(c => c.value === props.mode);
  emit('select', enabled[(at + 1) % enabled.length].value as Mode);
}
</script>
<template>
  <div class="editor-comparison-tools editor-tool-capsule" role="group" aria-label="改图对比">
    <EditToolMode v-if="compact" id="editorComparison" label="比较图片" :text="selected.short" :icon="selected.icon" :title="selected.label" :active="true" :value="mode" menu-label="比较图片" :options="choices" :disabled="locked" @toggle="cycle" @select="emit('select', $event as Mode)">
      <template #after-options="{ close }">
        <template v-if="canComposite">
          <hr role="separator" />
          <button class="menu-item" type="button" role="menuitemcheckbox" :aria-checked="colorMatch" :disabled="busy" @click="emit('color')"><AppIcon name="i-dt-colorize" /><span class="menu-label">色彩对齐</span><AppIcon v-if="colorMatch" class="menu-check" name="i-check" /></button>
          <button class="menu-item" type="button" @click="close(); emit('fusion')"><PhotopeaIcon /><span class="menu-label">融合精修</span></button>
        </template>
      </template>
    </EditToolMode>
    <template v-else>
      <div class="editor-comparison-modes" role="group" aria-label="对比图片">
        <button v-for="choice in choices" :key="choice.value" class="editor-tool" type="button" :aria-pressed="mode === choice.value" :disabled="choice.disabled" :title="choice.value === 'composite' ? reason : undefined" @click="emit('select', choice.value as Mode)">{{ choice.label }}</button>
      </div>
      <template v-if="canComposite">
        <span class="editor-tool-divider" aria-hidden="true" />
        <button class="ibtn" type="button" aria-label="色彩对齐" :aria-pressed="colorMatch" :data-tip="`色彩对齐：${colorMatch ? '开' : '关'}`" :disabled="locked || busy" @click="emit('color')"><AppIcon name="i-dt-colorize" /></button>
        <button class="ibtn" type="button" aria-label="融合精修" data-tip="在 Photopea 中融合精修" :disabled="locked || busy" @click="emit('fusion')"><PhotopeaIcon /></button>
      </template>
    </template>
    <span v-if="compact && canApply" class="editor-tool-divider" aria-hidden="true" />
    <button v-if="canApply" class="btn btn-primary btn-sm editor-comparison-apply" :data-compact="compact || undefined" type="button" aria-label="应用蒙版" data-tip="应用蒙版" :disabled="locked || busy" @click="emit('apply')"><AppIcon name="i-check" /><span v-if="!compact">应用</span></button>
  </div>
</template>
