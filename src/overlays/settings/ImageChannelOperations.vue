<script setup lang="ts">
import { computed } from 'vue';
import { channelOperationEntries, type ImageChannelModel } from '../../gateway/image-channel-models.ts';

const props = defineProps<{ model: ImageChannelModel }>();
const operations = computed(() => channelOperationEntries(props.model));

const summary = computed(() => operations.value.map(([label]) => label).join(' · '));
const detail = computed(() => operations.value.map(([label, id]) => `${label} ${id}`).join('\n'));
</script>

<template>
  <small :title="detail">{{ summary }}</small>
</template>
