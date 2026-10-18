<script setup lang="ts">
defineProps<{ surface: string; subtitle: string }>();
const sprite = `${import.meta.env.BASE_URL}assets/icons.svg`;
</script>
<template>
  <span class="brand-mark" aria-hidden="true"
    ><svg><use :href="`${sprite}#mk-${surface}`" /></svg
  ></span>
  <span class="brand-wordmark"
    ><span class="brand-title">Koma</span
    ><span class="brand-subtitle">{{ subtitle }}</span></span
  >
</template>
