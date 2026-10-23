<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import { useAsk } from "../app/ask";
import { charLabel } from "./attachments.ts";
const ask = useAsk(), root = shallowRef<HTMLElement | null>(null);
const previous = document.activeElement;
function close(refocus = false) {
  ask.closeAttachment();
  if (refocus && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node) && !(event.target as Element).closest('.ask-att-open')) close();
}
const removeLayer = ask.layer(() => { close(true); return true; });
onMounted(() => { root.value?.focus({ preventScroll: true }); document.addEventListener("pointerdown", outside, true); });
onBeforeUnmount(() => { removeLayer(); document.removeEventListener("pointerdown", outside, true); });
</script>
<template>
  <div v-if="ask.attachmentPreview.value" ref="root" class="ask-attachment-peek" role="dialog" :aria-label="ask.attachmentPreview.value.name" tabindex="-1">
    <div class="ask-peek-head"><b>{{ ask.attachmentPreview.value.name }}</b><small>{{ charLabel(ask.attachmentPreview.value.text.length) }}</small></div>
    <pre>{{ ask.attachmentPreview.value.text }}</pre>
  </div>
</template>
<style scoped>
.ask-attachment-peek { position: absolute; z-index: 5; right: 12px; bottom: 132px; left: 12px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 6px; min-width: 0; max-height: 50%; padding: 10px 12px; overflow: hidden; color: var(--fg); background: color-mix(in srgb, var(--raised) 97%, transparent); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--sh-3), var(--sh-lip); backdrop-filter: blur(16px); outline: none; }
.ask-peek-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; font-size: 13px; }
.ask-peek-head b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-peek-head small { flex: none; color: var(--fg-3); font-size: 12px; }
.ask-attachment-peek pre { min-height: 0; margin: 0; overflow: auto; color: var(--fg-2); font: 12.5px/1.65 var(--sans); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
