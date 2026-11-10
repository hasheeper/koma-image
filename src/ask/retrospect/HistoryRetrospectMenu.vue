<script setup lang="ts">

import { useId } from 'vue';
const id=useId();
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
const emit = defineEmits(['start']);
</script>
<template>
  <PopoverMenu compact :id="`historyRetrospectMore${id}`" label="历史更多选项" side="right">
    <template #trigger="{ open, toggle }"><button class="ibtn" type="button" aria-label="历史更多选项" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
    <template #default="{ close }"><button class="menu-item" type="button" role="menuitem" @click="close(); emit('start')"><AppIcon name="i-branch" /><span class="menu-label">请 ASK 发起演进</span></button></template>
  </PopoverMenu>
</template>
