<script setup lang="ts">
import { shallowRef, watch } from "vue";
import AppIcon from "../../shared/AppIcon.vue";
import { menuKeys, placeMenu } from "../../shared/popover";
import { usePopover } from "../../shared/ui/use-popover";
const props = defineProps<{ id: string; name: string; active: boolean }>();
const emit = defineEmits<{ edit: []; remove: [] }>();
const trigger = shallowRef<HTMLButtonElement>(), menu = shallowRef<HTMLElement>();
const { open, close, beforeToggle, toggled } = usePopover(menu, {
  position() {
    if (!menu.value || !trigger.value) return;
    placeMenu(menu.value, trigger.value.getBoundingClientRect());
    menu.value.dataset.placed = "";
  },
  closeOnScroll: "all",
  onClose() { if (menu.value) delete menu.value.dataset.placed; },
});
watch(() => props.active, active => { if (!active) close(); });
</script>
<template>
  <button ref="trigger" class="btn btn-quiet btn-sm conn-more" type="button" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="open" :popovertarget="id"><AppIcon name="i-more" /></button>
  <div ref="menu" :id="id" class="menu conn-menu" popover="auto" role="menu" :aria-label="`${name} 的操作`" @beforetoggle="beforeToggle" @toggle="toggled" @keydown="menuKeys" @click="close">
    <button class="menu-item" type="button" role="menuitem" @click="emit('edit')"><AppIcon name="i-rename" /><span>配置供应商</span></button>
    <hr role="separator" />
    <button class="menu-item danger" type="button" role="menuitem" @click="emit('remove')"><AppIcon name="i-trash" /><span>删除供应商</span></button>
  </div>
</template>
