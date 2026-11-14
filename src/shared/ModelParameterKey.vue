<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
defineProps<{ id: string; modelValue: string; expanded: boolean; disabled?: boolean; invalid?: boolean; controls: string; hint?: string; describedby?: string }>();
defineEmits<{ 'update:modelValue': [value: string]; toggle: [] }>();
</script>
<template>
  <div v-if="expanded" class="mp-key-editor">
    <button class="ibtn" type="button" :disabled="disabled" :aria-label="`${modelValue || '新参数'} 字段设置`" aria-expanded="true" :aria-controls="controls" title="收起字段设置" @click="$emit('toggle')"><AppIcon name="i-chevron" /></button>
    <label class="sr-only" :for="id">字段名</label><input :id="id" :value="modelValue" class="mp-key-input" type="text" placeholder="字段名" maxlength="128" required spellcheck="false" :disabled="disabled" :aria-invalid="invalid || undefined" :title="hint" :aria-describedby="describedby" @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
  </div>
  <button v-else class="mp-name" type="button" :disabled="disabled" :aria-label="`${modelValue || '新参数'} 字段设置`" aria-expanded="false" :aria-controls="controls" title="编辑字段定义" @click="$emit('toggle')"><AppIcon name="i-chevron" /><code>{{ modelValue || '新参数' }}</code></button>
</template>
<style scoped>
.mp-name .ico { --ico: var(--ico-xs); color: var(--fg-3); transition: transform var(--t1) var(--e); }
.mp-name:hover { color: var(--fg); }
.mp-name:focus-visible { outline: 2px solid var(--a); outline-offset: 2px; border-radius: var(--r1); }
.mp-key-editor { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }
.mp-key-editor .ibtn { width: 20px; height: var(--mp-control-h); flex: none; --ico: var(--ico-xs); }
.mp-key-editor .ico { transform: rotate(90deg); }
.mp-key-editor .mp-key-input { min-width: 0; height: var(--mp-control-h); padding-inline: var(--sp-1); border-color: transparent; background: transparent; }
.mp-key-editor .mp-key-input:focus { border-color: var(--focus-line); background: var(--well); }
.mp-key-editor .mp-key-input[aria-invalid='true'] { border-color: var(--err); }
@media (max-width: 640px) {
  .mp-key-editor .ibtn { width: 28px; height: 44px; }
}
</style>
