<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";

const props = defineProps<{ label: string }>(), ask = useAsk();
const button = shallowRef<HTMLElement | null>(null), shown = shallowRef(false), position = shallowRef({ left: "0px", top: "0px" });
const info = computed(() => { void ask.libraryRevision.value; return ask.pictureInfo(props.label); });
let timer: ReturnType<typeof setTimeout> | undefined;
function close() { clearTimeout(timer); shown.value = false; }
function preview() {
  if (!info.value || !ask.visible.value || !button.value) return;
  const r = button.value.getBoundingClientRect();
  position.value = { left: `${Math.max(8, Math.min(innerWidth - 184, r.left - 176))}px`, top: `${Math.max(8, Math.min(innerHeight - 238, r.top - 80))}px` };
  shown.value = true;
}
function hover() { clearTimeout(timer); timer = setTimeout(preview, 200); }
function locate() { close(); ask.locate(props.label); }
watch(shown, (on) => {
  if (on) { window.addEventListener("scroll", close, true); window.addEventListener("resize", close); }
  else { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); }
});
watch(ask.visible, close);
const removeLayer = ask.layer(() => { if (!shown.value) return false; close(); return true; });
onBeforeUnmount(() => { close(); removeLayer(); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); });
</script>
<template>
  <button ref="button" class="ask-id" type="button" :disabled="!info" :title="info ? `查看 ${label}` : `${label} 已移除或尚不可用`" @click="locate" @pointerenter="hover" @pointerleave="close" @focus="preview" @blur="close">{{ label }}</button>
  <Teleport to="body">
    <div v-if="shown && info" class="ask-preview" :style="position" role="tooltip">
      <img :src="info.url" alt="" /><span>{{ label }} · {{ info.width }}×{{ info.height }}</span>
    </div>
  </Teleport>
</template>
<style scoped>
.ask-id { display: inline; padding: 1px 3px; color: var(--a); font: inherit; font-family: var(--mono); font-size: var(--fz-sm); border-radius: 4px; }
.ask-id:hover, .ask-id:focus-visible { background: var(--hover); text-decoration: underline; }
.ask-id:disabled { color: var(--fg-4); text-decoration: line-through; cursor: default; }
.ask-preview { position: fixed; z-index: var(--z-pop); display: flex; flex-direction: column; gap: 6px; width: 176px; padding: 6px; color: var(--fg-3); font: var(--fw-regular) var(--fz-xs)/1.4 var(--mono); background: var(--raised); border: 1px solid var(--line-2); border-radius: var(--r2); box-shadow: var(--sh-2); pointer-events: none; }
.ask-preview img { width: 100%; max-height: 196px; object-fit: contain; border-radius: 5px; }
</style>
