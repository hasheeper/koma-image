<script setup lang="ts">
import { onMounted, shallowRef, watch } from 'vue';
import type { Raster, StackLayer } from './project.ts';

const props = defineProps<{ image: Raster | StackLayer | Blob }>();
const canvas = shallowRef<HTMLCanvasElement>();
const raw = shallowRef('');

watch(
  () => props.image,
  (im, _, cleanup) => {
    raw.value = im instanceof Blob ? URL.createObjectURL(im) : '';
    const url = raw.value;
    if (url) cleanup(() => URL.revokeObjectURL(url));
  },
  { immediate: true },
);

function render() {
  if (!canvas.value || props.image instanceof Blob) return;
  const { width, height } = props.image;
  const src = 'pixels' in props.image ? props.image.pixels : props.image.data;
  const scale = Math.min(1, 80 / Math.max(1, width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const pixels = new ImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (Math.floor(((y + 0.5) * height) / h) * width + Math.floor(((x + 0.5) * width) / w)) * 4;
      pixels.data.set(src.subarray(i, i + 4), (y * w + x) * 4);
    }
  canvas.value.width = w;
  canvas.value.height = h;
  canvas.value.getContext('2d')?.putImageData(pixels, 0, 0);
}

onMounted(render);
watch(() => props.image, render, { flush: 'post' });
</script>
<template>
  <span class="layer-thumb" aria-hidden="true">
    <img v-if="raw" :src="raw" alt="" />
    <canvas v-else ref="canvas" />
  </span>
</template>
<style scoped>
.layer-thumb {
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--image-checker);
  background-size: 8px 8px;
  border-radius: 5px;
}
.layer-thumb canvas,
.layer-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
</style>
