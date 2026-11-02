<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import PopoverMenu from "../shared/ui/PopoverMenu.vue";
defineProps<{ id: string; label: string; side: "left" | "right" | "up"; escape?: () => boolean }>();
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
  <PopoverMenu ref="menu" :id="id" :label="label" :side="side" :escape="escape" compact menu-class="ask-menu" class="ask-menu-host" :class="{ 'conversation-menu': side === 'left' }" @opened="opened" @closed="closed">
    <template #trigger="slot"><slot name="trigger" v-bind="slot" /></template>
    <template #default="slot"><slot v-bind="slot" /></template>
  </PopoverMenu>
</template>
