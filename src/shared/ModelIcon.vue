<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{ family?: string }>();
const glyphs: Record<string, string> = {
  novelai: "novelai",
  gpt: "openai",
  openai: "openai",
  gemini: "gemini-c",
  fal: "fal-c",
  flux: "flux",
  qwen: "qwen-c",
  seedream: "bytedance-c",
  xai: "grok",
  wan: "alibabacloud-c",
  dashscope: "alibabacloud-c",
};
const glyph = computed(() => glyphs[props.family ?? ""]);
</script>
<template>
  <svg
    v-if="glyph"
    class="vl"
    :class="`vl-${family}`"
    aria-hidden="true"
    viewBox="0 0 24 24"
  >
    <use :href="`#v-${glyph}`" /></svg
  ><AppIcon v-else name="i-model" />
</template>
