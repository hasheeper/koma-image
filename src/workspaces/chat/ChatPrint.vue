<script setup lang="ts">
import {
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
} from "vue";
import { tileWave } from "../../native/tile-wave.ts";
import ChatImage from "./ChatImage.vue";
const props = defineProps<{
    alt: string;
    width: number;
    height: number;
    assetId: string;
    base: boolean;
    fresh: boolean;
  }>(),
  emit = defineEmits<{ view: [] }>();
const nativeHost = shallowRef<HTMLElement | null>(null),
  revealing = ref(false),
  crest = ref(false),
  entering = ref(false);
let wave: ReturnType<typeof tileWave> | undefined,
  revision = 0, attempted = false;
function pause() {
  revision++;
  wave?.destroy();
  wave = undefined;
  revealing.value = false;
}
async function reveal(img: HTMLImageElement) {
  if (
    attempted || !props.fresh ||
    !nativeHost.value ||
    !img.getClientRects().length
  )
    return;
  attempted = true;
  const token = ++revision;
  wave = tileWave(nativeHost.value);
  revealing.value = true;
  try {
    await img.decode();
    if (token !== revision) return;
    crest.value = true;
    const played = await wave.reveal(img);
    if (token === revision && !played) entering.value = true;
  } catch {
  } finally {
    if (token === revision) {
      wave?.destroy();
      wave = undefined;
      revealing.value = false;
    }
  }
}
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
    <ChatImage
      :asset-id="assetId"
      :max-edge="1280"
      :alt="alt"
      :width="width"
      :height="height"
      tabindex="0"
      role="button"
      aria-label="查看完整图片"
      @click="emit('view')"
      @keydown.enter.prevent="emit('view')"
      @keydown.space.prevent="emit('view')"
      @ready="reveal"
      @unload="pause"
    /><span
      ref="nativeHost"
      style="position: absolute; inset: 0; pointer-events: none"
      ><!-- Only this empty host belongs to the wave driver. --></span
    >
    <slot />
  </figure>
</template>
