<script setup lang="ts">
import { useDrawing } from "../../app/drawing";
import AppIcon from "../../shared/AppIcon.vue";
const {drawing,view}=useDrawing();
</script>
<template>
  <div :aria-busy="view.comfyOptions.loading">
    <button class="btn btn-quiet btn-sm" type="button" :disabled="view.comfyOptions.loading" @click="drawing.refreshComfyOptions()"><AppIcon name="i-retry" :class="{'comfy-options-loading':view.comfyOptions.loading}" />{{ view.comfyOptions.loading ? '读取中…' : '刷新服务选项' }}</button>
    <p v-if="view.comfyOptions.error" class="hint warn" role="status">{{ view.comfyOptions.error }}</p>
  </div>
</template>
<style scoped>
.comfy-options-loading { animation: comfy-options-spin 1s linear infinite; }
@keyframes comfy-options-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .comfy-options-loading { animation: none; } }
</style>
