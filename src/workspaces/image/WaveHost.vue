<script setup lang="ts">
import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  useTemplateRef,
  watch,
} from "vue";
import { tileWave } from "../../native/tile-wave.ts";
/* Vue casts an absent boolean prop to false; hosts that never pause (CHAT pending frames) omit it. */
const props = withDefaults(defineProps<{ small?: boolean; active?: boolean }>(), { active: true });
const host = useTemplateRef<HTMLElement>("host");
let wave: ReturnType<typeof tileWave> | undefined;
function start() {
  if (props.active !== false && !wave && host.value)
    wave = tileWave(host.value, props.small ? { cell: 18, fade: false } : {});
}
function pause() {
  wave?.destroy();
  wave = undefined;
}
watch(() => props.active, value => { if (value === false) pause(); else start(); });
onMounted(start);
onActivated(start);
onDeactivated(pause);
onBeforeUnmount(pause);
defineExpose({
  reveal: async (source: CanvasImageSource) => {
    wave?.resize();
    return (await wave?.reveal(source)) ?? false;
  },
  reset: () => wave?.reset(),
});
</script>
<template>
  <div ref="host"><!-- Native canvas owns only this empty host. --></div>
</template>
