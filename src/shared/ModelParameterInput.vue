<script setup lang="ts">
import { computed, ref } from "vue";
import type { ParameterField } from "../domain/model-parameters";
import { acceptsParameter } from "../domain/model-parameters";
const props = defineProps<{ id: string; field: ParameterField; value?: string; disabled?: boolean; disabledOptions?: string[]; format?: (value: string) => string }>();
const emit = defineEmits<{ change: [value: string] }>();
const draft = ref<string | null>(null);
function edit(event: Event) {
  const input = event.target as HTMLInputElement;
  input.setCustomValidity(""); draft.value = input.value;
}
const placeholder = computed(() => {
  const value = props.value === 'auto' ? props.value : props.field.default;
  return value ? props.format ? props.format(value) : value : '未设置';
});
function change(event: Event) {
  const input = event.target as HTMLInputElement;
  input.setCustomValidity("");
  if (input.value && !acceptsParameter(props.field, input.value)) {
    input.setCustomValidity("请输入符合此来源参数配置的值"); input.reportValidity(); return;
  }
  emit("change", input.value);
}
</script>
<template>
  <select v-if="field.type === 'boolean' || field.options.length && !field.allowCustom" :id="id" :value="value ?? ''" :disabled="disabled" class="model-parameter-input" @change="emit('change', ($event.target as HTMLSelectElement).value)">
    <option v-if="!value" value="" disabled hidden>选择</option><option v-for="option in field.type === 'boolean' ? ['true', 'false'] : field.options" :key="option" :value="option" :disabled="disabledOptions?.includes(option)">{{ field.type === 'boolean' ? option === 'true' ? '开启' : '关闭' : format ? format(option) : option }}</option>
  </select>
  <input v-else :id="id" :value="draft ?? (value === 'auto' && format ? '' : value ?? '')" :disabled="disabled" class="model-parameter-input" :type="field.type === 'number' ? 'number' : 'text'" :min="field.min" :max="field.max" step="any" :list="field.options.length ? `${id}-values` : undefined" :placeholder="placeholder" maxlength="512" @focus="edit" @input="edit" @change="change" @blur="draft = null" />
  <datalist v-if="field.options.length && field.allowCustom" :id="`${id}-values`"><option v-for="option in field.options" :key="option" :value="option" /></datalist>
</template>
<style scoped>
.model-parameter-input { min-width: 0; width: 100%; min-height: 30px; border: 1px solid var(--field-line); border-radius: var(--r2); padding: 4px 8px; background-color: var(--well); color: var(--fg); font-size: var(--fz-xs); }
select.model-parameter-input { padding-right: 30px; }
</style>
