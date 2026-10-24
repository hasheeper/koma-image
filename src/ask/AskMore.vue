<script setup lang="ts">
import { computed } from "vue";
import { useAsk } from "../app/ask";
import { message, useUi } from "../app/ui";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "./AskMenu.vue";

const emit = defineEmits<{ debug: [] }>();
const ask = useAsk(), ui = useUi();
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const spent = computed(() => {
  const mine = ask.conversationUsage.value, page = ask.usage.value, total = mine.input + mine.output, all = page.input + page.output;
  return all ? { label: total ? k(total) : "", title: `本对话 ${total} tokens：输入 ${mine.input}（缓存命中 ${mine.cacheRead}）、输出 ${mine.output}\n本页 ASK 共 ${all} tokens` } : null;
});
async function images() {
  try { await ask.setImages(!ask.settings.value.images); } catch (error) { ui.toast(message(error), "err"); }
}
</script>
<template>
  <AskMenu id="askMoreMenu" label="ASK 选项" side="right">
    <template #trigger="{ open, toggle }">
      <button class="ibtn" type="button" aria-label="更多" title="更多" aria-haspopup="menu" :aria-expanded="open" aria-controls="askMoreMenu" @click="toggle"><AppIcon name="i-more" /></button>
    </template>
    <template #default="{ close }">
      <button class="ask-menu-item" type="button" role="menuitemcheckbox" :aria-checked="ask.settings.value.images" @click="images"><AppIcon name="i-image" /><span class="ask-menu-label">发送图片给模型</span><AppIcon name="i-check" class="ask-menu-check" /></button>
      <button v-if="ask.settings.value.preference" class="ask-menu-item" type="button" role="menuitemcheckbox" :aria-checked="!ask.preferencePaused.value" :title="`${ask.settings.value.preference}\n（停用只对本次有效）`" @click="ask.togglePreference()"><AppIcon name="i-star" /><span class="ask-menu-label">使用个人偏好</span><AppIcon name="i-check" class="ask-menu-check" /></button>
      <hr role="separator" />
      <button class="ask-menu-item" type="button" role="menuitem" :disabled="!!ask.compaction.value.reason" :title="ask.compaction.value.reason || '压缩较早的对话，保留原文供召回'" @click="close(true); ask.compactContext()"><AppIcon name="i-layers" /><span class="ask-menu-label">压缩上下文</span></button>
      <small v-if="ask.compaction.value.reason" class="ask-menu-group" role="presentation">{{ ask.compaction.value.reason }}</small>
      <button class="ask-menu-item" type="button" role="menuitem" :title="spent?.title" @click="close(); emit('debug')"><AppIcon name="i-history" /><span class="ask-menu-label">调用上下文</span><small v-if="spent?.label">{{ spent.label }}</small></button>
      <button class="ask-menu-item" type="button" role="menuitem" @click="close(); ask.openSettings()"><AppIcon name="i-settings" /><span class="ask-menu-label">ASK 设置</span></button>
    </template>
  </AskMenu>
</template>
