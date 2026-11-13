<script setup lang="ts">
defineProps<{ name: string }>();
</script>
<template>
  <svg :class="name.startsWith('mk-') ? undefined : 'ico'" aria-hidden="true">
    <use :href="`#${name}`" />
  </svg>
</template>
