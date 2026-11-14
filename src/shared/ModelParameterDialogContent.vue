<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import ModelIcon from "./ModelIcon.vue";
withDefaults(defineProps<{
  title: string; supplier: string; family?: string; upstreamId?: string;
  busy?: boolean; invalid?: boolean; addDisabled?: boolean;
  closeLabel?: string; resetLabel?: string; resetTitle?: string; error?: string;
}>(), { busy: false, invalid: false, addDisabled: false,
  closeLabel: "关闭模型参数", resetLabel: "恢复默认", resetTitle: undefined, error: "" });
defineEmits<{ close: []; reset: []; add: [] }>();
</script>
<template>
  <header class="modal-head">
    <div class="mp-heading" :title="upstreamId ? `上游 ID：${upstreamId}` : undefined">
      <h2 tabindex="-1" autofocus><ModelIcon :family="family" /><span>{{ title }}</span></h2>
      <div class="mp-tags"><span class="type" :title="`供应商：${supplier}`">{{ supplier }}</span><slot name="source" /></div>
    </div>
    <div class="mp-head-actions"><slot name="actions" /><button class="ibtn" type="button" :aria-label="closeLabel" :disabled="busy" @click="$emit('close')"><AppIcon name="i-close" /></button></div>
  </header>
  <div class="modal-body">
    <slot name="status" />
    <div class="mp-fields">
      <div class="mp-columns"><div class="mp-column-title"><span>参数</span><button class="ibtn ibtn-xs" type="button" aria-label="添加参数" title="添加参数" :disabled="busy || addDisabled" @click="$emit('add')"><AppIcon name="i-plus" /></button></div><span>默认值</span></div>
      <slot />
    </div>
    <p v-if="error" class="modal-error" role="alert">{{ error }}</p>
  </div>
  <footer class="modal-foot"><div class="modal-actions"><button class="btn-link mp-reset" type="button" :title="resetTitle" :disabled="busy" @click="$emit('reset')">{{ resetLabel }}</button><button class="btn btn-quiet" type="button" :disabled="busy" @click="$emit('close')">取消</button><button class="btn btn-primary" type="submit" :disabled="busy || invalid">{{ busy ? '保存中…' : '保存参数' }}</button></div></footer>
</template>
<style scoped>
.modal-head { align-items: start; }
.mp-heading { display: grid; gap: var(--sp-2); min-width: 0; }
.mp-heading h2 { display: flex; align-items: start; gap: var(--sp-2); line-height: 1.4; overflow-wrap: anywhere; }
.mp-heading h2 span { min-width: 0; }
.mp-heading h2 :deep(.vl), .mp-heading h2 :deep(.ico) { width: var(--ico-lg); height: var(--ico-lg); flex: none; margin-top: 3px; }
.mp-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.mp-tags :deep(.type) { max-width: 100%; height: auto; min-height: 18px; white-space: normal; overflow-wrap: anywhere; }
.mp-head-actions { display: flex; flex: none; align-items: center; gap: var(--sp-1); margin-top: -4px; }
.modal-body { display: grid; gap: var(--sp-4); padding-bottom: var(--sp-3); }
.mp-fields { --mp-columns: minmax(0, 1fr) minmax(0, 144px) 36px; }
.mp-column-title { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }
.mp-column-title .ibtn { --ico: var(--ico-sm); }
@media (max-width: 640px) {
  .mp-fields { --mp-columns: minmax(0, 1fr) minmax(96px, 0.85fr) 36px; }
}
</style>
