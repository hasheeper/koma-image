<script lang="ts">
// One observer for the mounted images; each image releases its lease when hidden.
const observed = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;
function observe(image: HTMLImageElement, change: (visible: boolean) => void) {
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) observed.get(entry.target)?.(entry.isIntersecting);
  });
  observed.set(image, change); observer.observe(image);
  return () => {
    observer?.unobserve(image); observed.delete(image);
    if (!observed.size) { observer?.disconnect(); observer = undefined; }
  };
}
</script>
<script setup lang="ts">
import { inject, onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch } from "vue";
import { chatKey } from "../../app/chat.ts";
const props = defineProps<{ assetId: string; maxEdge?: 256 | 1280 }>();
const emit = defineEmits<{ ready: [image: HTMLImageElement]; unload: [] }>();
const chat = inject(chatKey)!;
const image = shallowRef<HTMLImageElement | null>(null), source = shallowRef<string>();
const asset = shallowRef(chat.assets.assets.get(props.assetId));
let visible = false, active = false, stopObserve: (() => void) | undefined;
let lease: ReturnType<typeof chat.assets.preview> | undefined;
function release() { source.value = undefined; lease?.release(); lease = undefined; emit('unload'); }
function load() {
  if (!active || !visible || !asset.value || lease) return;
  const next = lease = chat.assets.preview(props.assetId, props.maxEdge);
  void next.url.then(url => { if (lease === next) source.value = url; }).catch(() => {
    if (lease === next) source.value = asset.value?.url;
  });
}
function refresh() { release(); load(); }
// Avoid taking a full workspace snapshot for each image on every service notification.
const stop = chat.subscribe(() => { asset.value = chat.assets.assets.get(props.assetId); });
watch(() => props.assetId, () => { asset.value = chat.assets.assets.get(props.assetId); });
watch([asset, () => props.maxEdge], refresh);
function resume() {
  if (active || !image.value) return;
  active = true;
  stopObserve = observe(image.value, shown => {
    visible = shown;
    if (shown) load(); else release();
  });
}
function pause() { active = visible = false; stopObserve?.(); stopObserve = undefined; release(); }
onMounted(resume);
onActivated(resume);
onDeactivated(pause);
onBeforeUnmount(() => { pause(); stop(); });
</script>
<template>
  <img ref="image" :src="source" decoding="async" @load="image && emit('ready', image)" />
</template>
