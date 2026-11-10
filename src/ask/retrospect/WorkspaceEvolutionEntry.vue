<script setup lang="ts">
import { useAsk } from '../../app/ask.ts';
import { useRetrospects } from './use-retrospects.ts';
import BoardRetrospectEntry from './BoardRetrospectEntry.vue';
import HistoryRetrospectMenu from './HistoryRetrospectMenu.vue';
defineProps<{ available: boolean }>();
const ask=useAsk(), { active }=useRetrospects();
</script>
<template><BoardRetrospectEntry v-if="active" /><HistoryRetrospectMenu v-else-if="available" @start="ask.startEvolution()" /></template>
