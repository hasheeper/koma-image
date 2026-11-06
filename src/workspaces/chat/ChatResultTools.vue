<script setup lang="ts">
import AppIcon from "../../shared/AppIcon.vue";
defineProps<{ url: string; filename: string; favorite?: boolean; favoriteBusy?: boolean }>();
const emit = defineEmits<{
  edit: [];
  retry: [];
  favorite: [];
}>();
</script>
<template>
  <div class="chat-result-tools" role="toolbar" aria-label="图片操作">
    <div class="chat-result-tool-group">
      <button
        class="ibtn"
        type="button"
        aria-label="在 EDIT 编辑这张图"
        data-tip="编辑：放大、重绘、批注"
        @click="emit('edit')"
      ><AppIcon name="i-edit" /></button>
      <button
        class="ibtn"
        type="button"
        aria-label="重新生成此版本"
        data-tip="重新生成"
        @click="emit('retry')"
      ><AppIcon name="i-retry" /></button>
    </div>
    <span class="chat-result-tool-sep" aria-hidden="true"></span>
    <div class="chat-result-tool-group">
      <button
        class="ibtn"
        :class="{ 'is-on': favorite }"
        type="button"
        :aria-label="favorite ? '取消收藏' : '收藏图片'"
        :data-tip="favorite ? '取消收藏' : '收藏'"
        :aria-pressed="!!favorite"
        :disabled="favoriteBusy"
        @click="emit('favorite')"
      ><AppIcon name="i-star" :class="{ solid: favorite }" /></button>
      <a
        class="ibtn"
        :href="url"
        :download="filename"
        aria-label="下载图片"
        data-tip="下载"
      ><AppIcon name="i-download" /></a>
    </div>
  </div>
</template>
<style scoped>
.chat-result-tools { display: flex; align-items: center; padding: 1px; background: color-mix(in srgb, var(--fg) 4%, transparent); border-radius: var(--r2); transition: opacity var(--t1) var(--e); }
.chat-result-tool-group { display: flex; align-items: center; gap: 2px; }
.chat-result-tool-sep { flex: none; width: 1px; height: 14px; margin-inline: 4px; background: color-mix(in srgb, var(--fg) 18%, transparent); }
.chat-result-tools .ibtn { width: var(--chat-result-tool-size); height: var(--chat-result-tool-size); --ico: var(--ico-md); border-radius: var(--r1); }
.chat-result-tools .ibtn[aria-pressed="false"] { color: var(--fg-3); }
.chat-result-tools .ibtn:hover { color: var(--fg); }
.chat-result-tools .ibtn.is-on { color: var(--a); }
.chat-result-tools .ibtn:disabled { opacity: .5; cursor: default; }
.chat-result-tools .solid { stroke: currentColor; }
.chat-result-tool-group:last-child .ibtn::after { left: auto; right: 0; transform: translate(0, -3px); }
.chat-result-tool-group:last-child .ibtn:hover::after { transform: translate(0, 0); }
</style>
