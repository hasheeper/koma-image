<script setup lang="ts">
// The project's public source repository; the one outbound link HOME and settings carry.
const href = "https://github.com/hasheeper/koma-image";
</script>
<template>
  <a :href="href" target="_blank" rel="noopener noreferrer"><slot /></a>
</template>
