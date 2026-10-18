<script setup lang="ts">
defineProps<{ name: string }>();
const sprite = `${import.meta.env.BASE_URL}assets/icons.svg`;
</script>
<template>
  <svg :class="name.startsWith('mk-') ? undefined : 'ico'" aria-hidden="true">
    <use :href="`${sprite}#${name}`" />
  </svg>
</template>
