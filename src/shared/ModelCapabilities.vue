<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
defineProps<{ value: string }>();
const caps: Record<string, [string, string]> = {
  g: ["generate", "生图"],
  e: ["edit", "改图"],
  i: ["brush", "重绘"],
  u: ["upscale", "放大"],
};
</script>
<template>
  <span class="caps"
    ><span
      v-for="code in [...value].filter((c) => caps[c])"
      :key="code"
      class="cp"
      :title="caps[code][1]"
      ><AppIcon :name="`i-${caps[code][0]}`" /></span
  ></span>
</template>
