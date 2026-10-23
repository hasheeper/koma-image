<script setup lang="ts">
import { computed } from "vue";
import { useAsk } from "../app/ask";
import type { NamingTarget } from "../ask/naming.ts";
import AppIcon from "./AppIcon.vue";

const props = defineProps<NamingTarget & { disabled?: boolean }>();
const ask = useAsk();
const busy = computed(() => ask.naming.value?.kind === props.kind && ask.naming.value.id === props.id);
const label = computed(() => busy.value ? "取消命名" : `AI 命名${props.kind === "board" ? "画板" : "对话"}`);
</script>
<template>
  <button class="ai-name" type="button" :class="{ busy }" :title="label" :aria-label="label" :aria-busy="busy" :disabled="!busy && (disabled || !!ask.naming.value)" @click="ask.generateName({ kind, id })">
    <AppIcon :name="busy ? 'i-stop' : 'i-generate'" />
  </button>
</template>
<style scoped>
.ai-name { display: grid; place-items: center; flex: none; width: 30px; height: 30px; padding: 0; color: var(--fg-3); border-radius: 8px; transition: color var(--t1) var(--e), background var(--t1) var(--e); }
.ai-name .ico { width: 16px; height: 16px; }
.ai-name:hover:not(:disabled) { color: var(--a); background: var(--hover); }
.ai-name:disabled { opacity: 0.35; cursor: default; }
.ai-name.busy { color: var(--a); background: var(--a-dim); }
.ai-name.busy .ico { animation: name-pulse 1.4s ease-in-out infinite; }
@keyframes name-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .ai-name.busy .ico { animation: none; } }
</style>
