<script setup lang="ts">
import { computed } from "vue";
import type { Workflow } from "../../domain/comfy-workflow";
import type { LoraBinding } from "../../domain/comfy-controls";
type DraftBinding = Omit<LoraBinding,"zeroDisables"> & {zeroDisables:boolean};
const props=defineProps<{workflow:Workflow;modelValue:DraftBinding[];disabled?:boolean;idPrefix?:string}>();
const emit=defineEmits<{"update:modelValue":[value:DraftBinding[]]}>();
const inputs=(id:string,kind:"string"|"number")=>Object.entries(props.workflow[id]?.inputs ?? {}).filter(([,v])=>typeof v===kind && (kind!=="number" || Number.isFinite(v)));
const nodes=computed(()=>Object.entries(props.workflow).filter(([id])=>inputs(id,"string").length && inputs(id,"number").length));
const standard=(id:string)=>["LoraLoader","LoraLoaderModelOnly"].includes(props.workflow[id]?.class_type);
function update(index:number,patch:Partial<DraftBinding>) {emit("update:modelValue",props.modelValue.map((b,i)=>i===index?{...b,...patch}:b));}
function node(index:number,event:Event) {
  const nodeId=(event.target as HTMLSelectElement).value, fields=props.workflow[nodeId]?.inputs ?? {};
  update(index,{nodeId,nameField:typeof fields.lora_name==="string"?"lora_name":"",modelField:typeof fields.strength_model==="number"?"strength_model":"",clipField:typeof fields.strength_clip==="number"?"strength_clip":undefined,zeroDisables:standard(nodeId)});
}
</script>
<template>
  <details class="comfy-lora-bindings">
    <summary>LoRA · 绑定已有节点</summary>
    <p class="hint">每个位置对应工作流中已接好的一个加载节点。取消绑定会恢复工作流原值，不会删除或停用该节点。</p>
    <div v-for="(binding,index) in modelValue" :key="index" class="comfy-lora-binding">
      <div class="fld">
        <label :for="`${idPrefix ?? ''}comfyLoraNode-${index}`">LoRA 位置 {{ index+1 }}</label>
        <select :id="`${idPrefix ?? ''}comfyLoraNode-${index}`" :value="binding.nodeId" :disabled="disabled" @change="node(index,$event)">
          <option value="">选择已有加载节点</option>
          <option v-for="[id,n] in nodes" :key="id" :value="id">#{{ id }} {{ n._meta?.title || n.class_type }}</option>
        </select>
      </div>
      <template v-if="binding.nodeId">
        <div v-for="control in [{key:'nameField' as const,label:'LoRA 文件名',kind:'string' as const},{key:'modelField' as const,label:'模型强度',kind:'number' as const},{key:'clipField' as const,label:'文本编码器强度 · 可选',kind:'number' as const}]" :key="control.key" class="fld">
          <label :for="`${idPrefix ?? ''}comfyLora-${index}-${control.key}`">{{ control.key==='clipField' && workflow[binding.nodeId]?.class_type==='LoraLoader' ? '文本编码器强度' : control.label }}</label>
          <select :id="`${idPrefix ?? ''}comfyLora-${index}-${control.key}`" :value="binding[control.key] ?? ''" :disabled="disabled" @change="update(index,{[control.key]:(($event.target as HTMLSelectElement).value || undefined)})">
            <option value="">{{ control.key==='clipField' && workflow[binding.nodeId]?.class_type!=='LoraLoader' ? '无此输入' : '请选择输入' }}</option>
            <option v-for="[field,value] in inputs(binding.nodeId,control.kind)" :key="field" :value="field">{{ field }} = {{ value }}</option>
          </select>
        </div>
        <label v-if="!standard(binding.nodeId)" class="check"><input type="checkbox" :checked="binding.zeroDisables" :disabled="disabled" @change="update(index,{zeroDisables:($event.target as HTMLInputElement).checked})" /><span></span>此节点的全部 LoRA 强度已绑定，归零即可停用</label>
      </template>
      <button class="btn btn-quiet btn-sm" type="button" :disabled="disabled" @click="emit('update:modelValue',modelValue.filter((_,i)=>i!==index))">取消绑定此位置</button>
    </div>
    <button class="btn btn-quiet btn-sm" type="button" :disabled="disabled" @click="emit('update:modelValue',[...modelValue,{nodeId:'',nameField:'',modelField:'',zeroDisables:false}])">绑定 LoRA 位置</button>
  </details>
</template>
<style scoped>
.comfy-lora-bindings > :not(summary) { margin-top: var(--sp-3); }
.comfy-lora-bindings summary { cursor: pointer; }
.comfy-lora-binding { display: grid; gap: var(--sp-3); padding-bottom: var(--sp-3); border-bottom: 1px solid var(--line); }
</style>
