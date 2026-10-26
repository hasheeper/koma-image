<script setup lang="ts">
import { computed } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "./AskMenu.vue";
const emit = defineEmits<{ debug: [] }>();
const ask = useAsk();
const usage = computed(() => { const s = ask.conversationUsage.value; return `输入 ${s.input}（缓存命中 ${s.cacheRead}）、输出 ${s.output} tokens`; });
</script>
<template>
  <AskMenu id="askMoreMenu" label="ASK 选项" side="right">
    <template #trigger="{ open, toggle }"><button class="ibtn" type="button" aria-label="更多" title="更多" aria-haspopup="menu" :aria-expanded="open" aria-controls="askMoreMenu" @click="toggle"><AppIcon name="i-more" /></button></template>
    <template #default="{ close }">
      <button class="ask-menu-item" type="button" role="menuitem" :disabled="!!ask.compaction.value.reason" :title="ask.compaction.value.reason || undefined" @click="close(true); ask.compactContext()"><AppIcon name="i-layers" /><span class="ask-menu-label">压缩上下文</span></button>
      <button class="ask-menu-item" type="button" role="menuitem" :title="usage" @click="close(); emit('debug')"><AppIcon name="i-history" /><span class="ask-menu-label">调用调试</span></button>
    </template>
  </AskMenu>
</template>
