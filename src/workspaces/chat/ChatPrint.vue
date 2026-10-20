<script setup lang="ts">
import {
  onMounted,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
} from "vue";
import { tileWave } from "../../native/tile-wave.ts";
const props = defineProps<{
    url: string;
    alt: string;
    width: number;
    height: number;
    assetId: string;
    base: boolean;
    fresh: boolean;
  }>(),
  emit = defineEmits<{ view: [] }>();
const nativeHost = shallowRef<HTMLElement | null>(null),
  img = shallowRef<HTMLImageElement | null>(null),
  revealing = ref(false),
  crest = ref(false),
  entering = ref(false);
let wave: ReturnType<typeof tileWave> | undefined,
  revision = 0;
function pause() {
  revision++;
  wave?.destroy();
  wave = undefined;
  revealing.value = false;
}
onMounted(async () => {
  if (
    !props.fresh ||
    !nativeHost.value ||
    !img.value ||
    !img.value.getClientRects().length
  )
    return;
  const token = ++revision;
  wave = tileWave(nativeHost.value);
  revealing.value = true;
  try {
    await img.value.decode();
    if (token !== revision) return;
    crest.value = true;
    const played = await wave.reveal(img.value);
    if (token === revision && !played) entering.value = true;
  } catch {
  } finally {
    if (token === revision) {
      wave?.destroy();
      wave = undefined;
      revealing.value = false;
    }
  }
});
onDeactivated(pause);
onBeforeUnmount(pause);
</script>
<template>
  <figure
    class="print chat-print"
    :data-asset="assetId"
    :data-base="base ? '' : undefined"
    :data-reveal="revealing ? '' : undefined"
    :data-wave="revealing ? (crest ? 'crest' : 'rest') : undefined"
    :data-new="entering ? 'true' : undefined"
    @animationend="entering = false"
  >
    <img
      ref="img"
      :src="url"
      :alt="alt"
      :width="width"
      :height="height"
      decoding="async"
      tabindex="0"
      role="button"
      aria-label="查看完整图片"
      @click="emit('view')"
      @keydown.enter.prevent="emit('view')"
      @keydown.space.prevent="emit('view')"
    /><span
      ref="nativeHost"
      style="position: absolute; inset: 0; pointer-events: none"
      ><!-- Only this empty host belongs to the wave driver. --></span
    >
    <slot />
  </figure>
</template>
