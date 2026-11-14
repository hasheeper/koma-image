<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import PopoverMenu from "../shared/ui/PopoverMenu.vue";
defineProps<{ id: string; label: string; side: "left" | "right" | "up"; kind?: "conversation" | "model" | "actions"; escape?: () => boolean }>();
const emit = defineEmits<{ closed: [] }>();
defineSlots<{ trigger(props: { open: boolean; toggle: () => void }): unknown; default(props: { close: (refocus?: boolean) => void }): unknown }>();
const ask = useAsk(), menu = shallowRef<InstanceType<typeof PopoverMenu>>();
let stopLayer = () => {};
function opened() { stopLayer(); stopLayer = ask.layer(() => menu.value?.escape() ?? false); }
function closed() { stopLayer(); stopLayer = () => {}; emit('closed'); }
watch(ask.visible, visible => { if (!visible) menu.value?.close(); });
onBeforeUnmount(() => stopLayer());
</script>
<template>
  <PopoverMenu ref="menu" :id="id" :label="label" :side="side" :escape="escape" compact :menu-class="`ask-menu${kind ? ` ask-menu-${kind}` : ''}`" class="ask-menu-host" :class="{ 'conversation-menu': side === 'left' }" @opened="opened" @closed="closed">
    <template #trigger="slot"><slot name="trigger" v-bind="slot" /></template>
    <template #default="slot"><slot v-bind="slot" /></template>
  </PopoverMenu>
</template>
<style scoped>
.ask-menu-host :deep(.ask-menu) { background: var(--glass-pop-bg); border-color: var(--line-2); border-radius: 10px; box-shadow: var(--glass-pop-shadow); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)); }
.ask-menu-host :deep(.ask-menu-conversation) { width: max-content; min-width: min(208px, calc(100vw - 24px)); max-width: min(248px, calc(100vw - 24px)); }
.ask-menu-host :deep(.ask-menu-model) { width: max-content; min-width: min(180px, calc(100vw - 24px)); max-width: min(248px, calc(100vw - 24px)); }
.ask-menu-host :deep(.ask-menu-actions) { width: max-content; min-width: min(140px, calc(100vw - 24px)); max-width: min(200px, calc(100vw - 24px)); }
</style>
