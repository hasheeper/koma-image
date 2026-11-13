<script setup lang="ts">
import { computed } from 'vue';
import { useAsk } from '../../app/ask.ts';
import type { Retrospect } from './model.ts';
import type { PictureRefs } from '../edit-context.ts';
const props = defineProps<{ value: Retrospect; pictureRefs: PictureRefs }>();
const ask = useAsk();
const covers = computed(() => { void ask.libraryRevision.value; return props.value.nodes.filter(n => n.image_ids.length).slice(0, 3).map(node => ({ id: node.id, url: ask.pictureInfo(node.cover, props.pictureRefs)?.url })); });
</script>
<template><span class="retrospect-covers" aria-hidden="true"><span v-for="cover in covers" :key="cover.id"><img v-if="cover.url" :src="cover.url" alt="" /></span></span></template>
<style scoped>
.retrospect-covers { display: flex; flex: none; padding-right: 2px; }
.retrospect-covers > span { display: block; width: var(--cover-width, 20px); height: var(--cover-height, 28px); overflow: hidden; border-radius: var(--r1); background: var(--sunken); box-shadow: 0 0 0 1px var(--line-2); }
.retrospect-covers > span + span { margin-left: -6px; }
.retrospect-covers img { width: 100%; height: 100%; object-fit: cover; }
</style>
