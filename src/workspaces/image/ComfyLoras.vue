<script setup lang="ts">
import { computed, nextTick } from "vue";
import { useDrawing } from "../../app/drawing";
import { useUi, message } from "../../app/ui";
import { useShell } from "../../app/shell";
import { comfyFieldInfo } from "../../domain/comfy-controls";
import type { LoraValue } from "../../domain/comfy-controls";
import ComfyChoiceField from "./ComfyChoiceField.vue";
import ComfyOptionsRefresh from "./ComfyOptionsRefresh.vue";
const {drawing,view}=useDrawing(),ui=useUi(),{router}=useShell();
const slots=computed(()=>view.value.model?.comfyControls?.loras ?? []);
const value=(id:string)=>view.value.comfyControls.loras!.find(v=>v.id===id)!;
async function update(id:string,patch:Partial<LoraValue>) {
  const before=view.value.comfyControls;
  const next={...before,loras:before.loras!.map(v=>v.id===id ? {...v,...patch} : v)};
  try { await drawing.patchComfyControls(next); } catch(e) { ui.toast(message(e),"warn"); }
}
async function strength(id:string,key:"strengthModel"|"strengthClip",event:Event) {
  const input=event.target as HTMLInputElement,n=input.value===""?NaN:Number(input.value);
  if(!Number.isFinite(n)){ui.toast("LoRA 强度须为有限数值","warn");input.value=String(value(id)[key]);return;}
  void update(id,{[key]:n});
  await nextTick();
  const current=view.value.comfyControls.loras?.find(v=>v.id===id);
  if(input.isConnected && current) input.value=String(current[key]);
}
</script>
<template>
  <div class="comfy-loras">
    <template v-if="slots.length">
      <ComfyOptionsRefresh />
      <div v-for="slot in slots" :key="slot.id" class="comfy-lora-slot" :data-lora-slot="slot.id">
        <label class="check"><input type="checkbox" :checked="value(slot.id).enabled" :aria-label="`启用 LoRA ${slot.id}`" @change="update(slot.id,{enabled:($event.target as HTMLInputElement).checked})" /><span></span>{{ slot.title }} · #{{ slot.id }}</label>
        <ComfyChoiceField :id="`comfyLoraName-${slot.id}`" label="LoRA 文件" :field="slot.name" :model-value="value(slot.id).name" @update:model-value="update(slot.id,{name:$event})" />
        <div v-for="control in [{key:'strengthModel' as const,label:'模型强度',field:slot.model},...(slot.clip ? [{key:'strengthClip' as const,label:'文本编码器强度',field:slot.clip}] : [])]" :key="control.key" class="fld">
          <label :for="`comfyLora-${slot.id}-${control.key}`">{{ control.label }}</label>
          <input :id="`comfyLora-${slot.id}-${control.key}`" type="number" step="any" :min="comfyFieldInfo(view.comfyOptions.info,control.field)?.min" :max="comfyFieldInfo(view.comfyOptions.info,control.field)?.max" :value="value(slot.id)[control.key]" @change="strength(slot.id,control.key,$event)" />
        </div>
      </div>
      <p class="hint">文件来自当前 GPU；是否兼容底模由工作流决定。停用时强度归零，保留文件和设置；触发词仍写在 Prompt。</p>
    </template>
    <template v-else>
      <p class="hint">此工作流尚未绑定 LoRA。先在 ComfyUI 接好加载节点，再到连接的工作流页绑定。</p>
      <button class="btn btn-quiet btn-sm" type="button" @click="router.openOverlay('settings','connections')">配置 LoRA 绑定</button>
    </template>
  </div>
</template>
<style scoped>
.comfy-loras { display: grid; align-content: start; gap: var(--sp-3); min-height: 0; overflow: auto; padding: var(--sp-3); }
.comfy-lora-slot { display: grid; gap: var(--sp-3); padding-bottom: var(--sp-3); border-bottom: 1px solid var(--line); }
</style>
