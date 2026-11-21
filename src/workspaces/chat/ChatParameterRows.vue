<script setup lang="ts">
import { computed, useId } from 'vue';
import { chatOptionLabel, chatOptionNames } from '../../domain/chat-options.ts';
import type { ParameterFields } from '../../domain/model-parameters.ts';
import ModelParameterInput from '../../shared/ModelParameterInput.vue';

const props = defineProps<{ fields?: ParameterFields; options: Record<string, string>; disabled?: boolean; idPrefix?: string }>();
const emit = defineEmits<{ change: [key: string, value: string] }>();
const id = useId();
const prefix = computed(() => props.idPrefix ?? id);
</script>

<template>
  <div class="param-rows">
    <div v-for="(field, key) in fields" :key="key" class="param-row">
      <template v-if="field.options.length && !field.allowCustom && field.type !== 'number'">
        <span :id="`${prefix}-${key}`" class="param-name">{{ field.label || chatOptionNames[key] || key }}</span>
        <div class="param-chips" role="radiogroup" :aria-labelledby="`${prefix}-${key}`">
          <label v-for="value in field.options" :key="value" class="param-chip">
            <input type="radio" :name="`${prefix}-${key}`" :checked="options[key] === value" :disabled="disabled" @change="emit('change', key, value)" />
            <span>{{ field.type === 'boolean' ? value === 'true' ? '开启' : '关闭' : chatOptionLabel(value, key) }}</span>
          </label>
        </div>
      </template>
      <template v-else>
        <label class="param-name" :for="`${prefix}-${key}`">{{ field.label || chatOptionNames[key] || key }}</label>
        <ModelParameterInput :id="`${prefix}-${key}`" :field="field" :value="options[key]" :format="value => chatOptionLabel(value, key)" :disabled="disabled" @change="emit('change', key, $event)" />
      </template>
    </div>
  </div>
</template>
