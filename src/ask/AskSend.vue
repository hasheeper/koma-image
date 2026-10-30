<script setup lang="ts">
import { useAsk } from '../app/ask.ts';
import AppIcon from '../shared/AppIcon.vue';
defineProps<{ home?: boolean }>();
const ask = useAsk();
</script>
<template>
  <span class="ask-send-slot" :class="{ 'home-send': home }">
    <button class="btn btn-primary ask-send" type="submit" :aria-label="home ? '发送给 ASK' : '发送'" :hidden="ask.running.value"
      :disabled="!ask.canManage.value || !!ask.preparing.value || (!ask.input.value.trim() && !ask.tray.value.length) || ask.ready.value === 'local'"><AppIcon name="i-up" /></button>
    <button class="btn ask-stop" type="button" :aria-label="home ? '停止 ASK' : '停止'" :hidden="!ask.running.value" @click="ask.stop()"><AppIcon name="i-stop" /></button>
  </span>
</template>
<style scoped>
.ask-send-slot { display: grid; flex: none; margin-left: 4px; }
.ask-send-slot > .btn { grid-area: 1 / 1; width: 28px; height: 28px; min-height: 0; padding: 0; border-radius: 50%; transition: opacity var(--t2) var(--e), transform var(--t2) var(--e-out), visibility 0s, color var(--t2) var(--e), background-color var(--t2) var(--e); }
.ask-send-slot > .btn[hidden] { display: inline-flex; visibility: hidden; pointer-events: none; opacity: 0; transform: scale(.72); transition: opacity var(--t1) var(--e), transform var(--t1) var(--e), visibility 0s linear var(--t1); }
.ask-send .ico, .ask-stop .ico { --ico: var(--ico-sm); }
.ask-send .ico { stroke-width: var(--ico-stroke-strong); }
.ask-send:disabled { color: var(--fg-4); background: color-mix(in srgb, var(--surface-tint) 7%, transparent); }
.ask-send-slot > .ask-stop { color: var(--fg); background: var(--ask-hover, var(--hover)); border-radius: 8px; }
.ask-stop .ico { fill: currentColor; stroke: none; }
@media (hover: hover) {
  .ask-stop:hover { color: var(--err); background: color-mix(in srgb, var(--err) 12%, transparent); }
}
.home-send > .btn { width: 36px; height: 36px; }
.home-send :is(.ask-send, .ask-stop) .ico { --ico: var(--ico-md); }
.home-send > .ask-stop { border-radius: 10px; }
@media (max-width: 860px) { .ask-send-slot > .btn { width: 36px; height: 36px; } }
</style>
