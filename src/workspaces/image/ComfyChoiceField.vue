<script setup lang="ts">
import { computed, nextTick } from "vue";
import { useDrawing } from "../../app/drawing";
import { comfyFieldInfo } from "../../domain/comfy-controls";
import type { ControlField } from "../../domain/comfy-controls";
const props=defineProps<{id:string;label:string;field:ControlField;modelValue:string}>();
const emit=defineEmits<{"update:modelValue":[value:string]}>();
const {view}=useDrawing();
const rule=computed(()=>comfyFieldInfo(view.value.comfyOptions.info,props.field));
const choices=computed(()=>rule.value?.choices);
const missing=computed(()=>!!choices.value && !choices.value.includes(props.modelValue));
async function change(event:Event) {
  const input=event.target as HTMLInputElement | HTMLSelectElement;
  emit('update:modelValue',input.value);
  await nextTick();
  // A rejected edit must display the value that will actually be submitted.
  if(input.isConnected) input.value=props.modelValue;
}
</script>
<template>
  <div class="fld">
    <label :for="id">{{ label }}</label>
    <input v-if="rule?.type==='STRING' && !choices" :id="id" type="text" :value="modelValue" @change="change" />
    <select v-else :id="id" :value="modelValue" :disabled="view.comfyOptions.loading || !choices" @change="change">
      <option v-if="!choices || missing" :value="modelValue">{{ modelValue }}{{ missing ? ' · 不在当前列表' : '' }}</option>
      <option v-for="value in choices" :key="value" :value="value">{{ value }}</option>
    </select>
    <p v-if="missing" class="hint warn">当前值已不在服务列表中，请刷新或重新选择。</p>
  </div>
</template>
