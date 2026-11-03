<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{ value: string; label: string }>();
const caps: Record<string, [string, string]> = {
  g: ["generate", "生图"],
  e: ["edit", "改图"],
  i: ["brush", "重绘"],
  u: ["upscale", "放大"],
};
const operations = computed(() => [...props.value].flatMap(code => caps[code] ? [caps[code]] : []));
const description = computed(() => operations.value.map(([, label]) => label).join("、"));
</script>
<template>
  <span v-if="description" class="caps" role="img" :aria-label="`${label}：${description}`">
    <span v-for="[icon, name] in operations" :key="icon" class="cp" :title="name"><AppIcon :name="`i-${icon}`" /></span>
  </span>
</template>
