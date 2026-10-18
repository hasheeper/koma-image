<script setup lang="ts">
import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  useTemplateRef,
} from "vue";
import { tileWave } from "../../native/tile-wave.js";
const props = defineProps<{ small?: boolean }>();
const host = useTemplateRef<HTMLElement>("host");
let wave: ReturnType<typeof tileWave> | undefined;
function start() {
  if (!wave && host.value)
    wave = tileWave(host.value, props.small ? { cell: 18, fade: false } : {});
}
function pause() {
  wave?.destroy();
  wave = undefined;
}
onMounted(start);
onActivated(start);
onDeactivated(pause);
onBeforeUnmount(pause);
defineExpose({
  reveal: async (source: CanvasImageSource) =>
    (await wave?.reveal(source)) ?? false,
  reset: () => wave?.reset(),
});
</script>
<template>
  <div ref="host"><!-- Native canvas owns only this empty host. --></div>
</template>
