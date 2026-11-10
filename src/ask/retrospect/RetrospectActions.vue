<script setup lang="ts">
import { computed, useId } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
import { useAsk } from '../../app/ask.ts';
import { useRetrospects } from './use-retrospects.ts';
const { registry } = useRetrospects();
const ask = useAsk();
const props = defineProps<{ recordId: string }>();
const id = useId();
const record = computed(() => { return registry.get(props.recordId); });
function change() { if (record.value) ask.setEvolutionStatus(record.value.id, record.value.status === 'active' ? 'ended' : 'active'); }
</script>
<template>
  <PopoverMenu v-if="record" compact :id="`retrospectActions${id}`" label="演进选项" side="right">
    <template #trigger="{ open, toggle }"><button class="ibtn retrospect-more" type="button" aria-label="演进选项" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
    <template #default="{ close }"><button class="menu-item" type="button" role="menuitem" @click="close(); change()"><AppIcon :name="record.status === 'active' ? 'i-check' : 'i-undo'" /><span class="menu-label">{{ record.status === 'active' ? '解除跟踪' : '继续演进' }}</span></button></template>
  </PopoverMenu>
</template>
<style scoped>.retrospect-more { flex: none; width: var(--retrospect-action-size, 28px); height: var(--retrospect-action-size, 28px); color: var(--fg-3); --ico: var(--ico-sm); }</style>
