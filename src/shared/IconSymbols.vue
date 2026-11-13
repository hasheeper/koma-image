<script setup lang="ts">
import source from '/assets/icons.svg?raw';
// Trusted repository asset, bundled with the application. No runtime SVG request.
const symbols = source.slice(source.indexOf('>') + 1, source.lastIndexOf('</svg>'));
</script>
<template>
  <svg aria-hidden="true" style="position: absolute; width: 0; height: 0; overflow: hidden" v-html="symbols"></svg>
</template>
