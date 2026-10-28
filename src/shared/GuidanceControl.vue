<script setup lang="ts">
import { nextTick, ref, shallowRef } from "vue";
const props = defineProps<{ id: string; modelValue: number; official: boolean; varietyPlus?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [number]; "update:varietyPlus": [boolean] }>();
const editing = ref(false), input = shallowRef<HTMLInputElement>();
async function edit() {
  editing.value = true;
  await nextTick(); input.value?.focus(); input.value?.select();
}
function commit() {
  const raw = input.value?.value ?? "", value = Number(raw);
  if (raw.trim() && Number.isFinite(value) && value >= 0) emit("update:modelValue", value);
  editing.value = false;
}
</script>
<template>
  <div class="scrub scrub-sm guidance" :style="{'--p': `${Math.min(100, modelValue / (official ? 10 : 20) * 100)}%`}">
    <span class="guidance-label">Guidance<button v-if="varietyPlus !== undefined" :id="`${id}VarietyPlus`" type="button" class="btn btn-sm variety-button" :class="varietyPlus ? 'btn-accent' : 'btn-quiet'" :aria-pressed="varietyPlus" title="延后启用提示词引导，增加多样性；可能降低提示词贴合度" @click="emit('update:varietyPlus', !varietyPlus)">Variety+</button></span>
    <output :id="`${id}Val`">
      <input v-if="editing" :id="`${id}Input`" ref="input" type="number" min="0" step="any" :value="modelValue" aria-label="手动输入 Guidance" @blur="commit" @keydown.enter.prevent="input?.blur()" @keydown.esc.stop.prevent="editing = false" />
      <button v-else type="button" title="手动输入 Guidance" aria-label="手动输入 Guidance" @click="edit">{{ modelValue }}</button>
    </output>
    <input :id="id" type="range" min="0" :max="official ? 10 : 20" :step="official ? .1 : .5" :value="modelValue" aria-label="Guidance" title="提示词引导强度（CFG Scale）" @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" />
  </div>
</template>
<style scoped>
.guidance > output { z-index: 1; pointer-events: auto; }
.guidance output button, .guidance input[type="number"] { padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; text-align: right; }
.guidance output button { cursor: text; }
.guidance input[type="number"] { width: 64px; height: auto; }
.guidance-label { display: flex; align-items: center; gap: 8px; z-index: 1; }
.variety-button { height: 23px; padding: 2px 7px; font-size: var(--fz-2xs); pointer-events: auto; }
</style>
