<script setup lang="ts">
import type { ParameterField } from "../domain/model-parameters.ts";
defineProps<{ id: string; modelValue: NonNullable<ParameterField['type']>; disabled?: boolean }>();
defineEmits<{ 'update:modelValue': [value: NonNullable<ParameterField['type']>] }>();
</script>
<template>
  <div class="mp-property"><span :id="id" class="mp-label">类型</span><div class="seg mp-types" role="radiogroup" :aria-labelledby="id"><label v-for="kind in (['string', 'number', 'boolean'] as const)" :key="kind"><input :checked="modelValue === kind" type="radio" :name="id" :value="kind" :disabled="disabled" @change="$emit('update:modelValue', kind)" /><span>{{ kind === 'string' ? '文本' : kind === 'number' ? '数字' : '开关' }}</span></label></div></div>
</template>
