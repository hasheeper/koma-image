<script setup lang="ts">

import { useId } from 'vue';
const id=useId();
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
withDefaults(defineProps<{ allowClear?: boolean; canClear?: boolean; canStart?: boolean }>(), { canStart: true });
const emit = defineEmits(['start', 'clear']);
</script>
<template>
  <PopoverMenu compact :id="`historyRetrospectMore${id}`" label="历史更多选项" side="right">
    <template #trigger="{ open, toggle }"><button class="ibtn" type="button" aria-label="历史更多选项" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
    <template #default="{ close }">
      <button v-if="canStart" class="menu-item" type="button" role="menuitem" @click="close(); emit('start')"><AppIcon name="i-branch" /><span class="menu-label">请 ASK 发起演进</span></button>
      <button v-if="allowClear" class="menu-item" type="button" role="menuitem" :disabled="!canClear" @click="close(); emit('clear')"><AppIcon name="i-trash" /><span class="menu-label">清空历史，收藏仍保留</span></button>
    </template>
  </PopoverMenu>
</template>
