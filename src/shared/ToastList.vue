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
          :aria-busy="notice.tone === 'load' ? true : undefined"
          :role="['warn', 'err'].includes(notice.tone) ? 'alert' : undefined"
        >
          <i
            v-if="notice.tone === 'load'"
            class="toast-spinner"
            aria-hidden="true"
          ></i>
          <AppIcon
            v-else
            class="toast-ico"
            :name="glyph[notice.tone] || glyph.err"
          /><span class="toast-text"
            >{{ notice.text
            }}<span v-if="notice.count > 1" class="toast-n"
              >×{{ notice.count }}</span
            ></span
          ><button
            v-if="notice.action"
            class="toast-action"
            type="button"
            @click="
              async () => {
                if ((await notice.action!.run()) !== false)
                  dismissNotice(notice.id);
              }
            "
          >
            {{ notice.action.label }}</button
          ><button
            v-if="['warn', 'err'].includes(notice.tone)"
            class="toast-x"
            type="button"
            aria-label="关闭提示"
            @click="dismissNotice(notice.id)"
          >
            <AppIcon class="toast-x-ico" name="i-close" /></button
          ><i
            v-if="notice.duration > 0"
            class="toast-timer"
            aria-hidden="true"
            :style="{ '--dwell': `${notice.duration}ms` }"
            @animationend="dismissNotice(notice.id)"
          ></i>
        </div>
      </div></div
  ></Teleport>
</template>
