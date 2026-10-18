<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, shallowRef } from "vue";
import { useUi } from "../app/ui";
import AppIcon from "./AppIcon.vue";
const { notices, dismissNotice } = useUi();
const glyph: Record<string, string> = {
  ok: "i-success",
  info: "i-info",
  warn: "i-warning",
  err: "i-alert",
};
const target = shallowRef<string | HTMLElement>("body");
async function followDialog() {
  await nextTick();
  target.value =
    [...document.querySelectorAll<HTMLElement>("dialog:modal")].at(-1) ??
    "body";
}
onMounted(() => {
  document.addEventListener("toggle", followDialog, true);
  document.addEventListener("close", followDialog, true);
  void followDialog();
});
onBeforeUnmount(() => {
  document.removeEventListener("toggle", followDialog, true);
  document.removeEventListener("close", followDialog, true);
});
</script>
<template>
  <Teleport :to="target"
    ><div
      :class="target !== 'body' ? 'editor-toasts' : 'toasts'"
      role="status"
      aria-live="polite"
    >
      <div
        v-for="notice in notices"
        :key="notice.id"
        class="toast-slot"
        :class="notice.out ? 'out' : 'in'"
      >
        <div
          class="toast"
          :data-tone="notice.tone"
          :role="['warn', 'err'].includes(notice.tone) ? 'alert' : undefined"
        >
          <AppIcon
            class="toast-ico"
            :name="glyph[notice.tone] || glyph.err"
          /><span class="toast-text"
            >{{ notice.text
            }}<span v-if="notice.count > 1" class="toast-n"
              >×{{ notice.count }}</span
            ></span
          ><button
            v-if="['warn', 'err'].includes(notice.tone)"
            class="toast-x"
            type="button"
            aria-label="关闭提示"
            @click="dismissNotice(notice.id)"
          >
            <AppIcon class="toast-x-ico" name="i-close" /></button
          ><i
            class="toast-timer"
            aria-hidden="true"
            :style="{ '--dwell': `${notice.duration}ms` }"
            @animationend="dismissNotice(notice.id)"
          ></i>
        </div>
      </div></div
  ></Teleport>
</template>
