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

<style scoped>
/* ── Toasts ────────────────────────────────────────────────────
   One column of equal-width notices, newest on top, in the window's
   top-right corner: the first sits inside the bar, centred on its height,
   and the rest hang below it. The editor's own stack sits in the same place
   over its dialog. A 2px line along the bottom drains with the time
   left; toast.js dismisses the notice when that animation ends, so pausing
   it on hover or focus pauses dismissal. */
.toasts, .editor-toasts {
  position: fixed; z-index: var(--z-toast);
  top: max(4px, calc((var(--bar-h) - 48px) / 2)); right: 16px;
  display: grid;
  width: min(380px, calc(100vw - 32px));
  pointer-events: none;
}
/* Each notice sits in a row that opens and closes its own height, so the
   rest of the stack glides rather than jumps. Clipped only while moving,
   or the shadow would be cut. */
.toast-slot { display: grid; grid-template-rows: 1fr; }
.toast-slot.in { overflow: clip; animation: toastRow 280ms var(--e-out); }
.toast-slot.out { overflow: clip; animation: toastRow 240ms var(--e) reverse forwards; }
@keyframes toastRow { from { grid-template-rows: 0fr; } }
.toast {
  --well: #19191c;
  --well-focus: #17171a;
  --tc: var(--a);
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 12px;
  min-height: 48px;
  margin-bottom: 8px; padding: 0 16px;
  font-size: 14px; line-height: 1.5;
  color: var(--fg);
  background: var(--raised);
  border-radius: var(--r2);
  box-shadow: inset 0 0 0 1px var(--line-2), var(--sh-2);
  pointer-events: auto;
}
.toast[data-tone="ok"] { --tc: var(--ok); }
.toast[data-tone="warn"] { --tc: var(--warn); }
.toast[data-tone="err"] { --tc: var(--err); }
.toast:has(.toast-action, .toast-x) { padding-right: 8px; }
.toast-ico { --ico: var(--ico-lg); color: var(--tc); }
.toast-spinner {
  flex: none; width: 18px; height: 18px;
  border: 2px solid var(--a-dim); border-top-color: var(--tc);
  border-radius: 50%; animation: toastSpin 800ms linear infinite;
}
@keyframes toastSpin { to { transform: rotate(1turn); } }
.toast-text {
  flex: 1; min-width: 0; padding: 12px 0;
  overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
}
.toast-n { margin-left: 6px; font: var(--fw-medium) 12px/1 var(--mono); color: var(--fg-3); }
.toast-action {
  flex: none; height: 32px; padding: 0 10px;
  font-weight: var(--fw-medium); color: var(--a);
  border-radius: var(--r1);
  transition: background var(--t1) var(--e);
}
.toast-action:hover { background: var(--a-dim); }
.toast-action:disabled { opacity: 0.5; cursor: default; }
.toast-x {
  flex: none; display: grid; place-items: center;
  width: 32px; height: 32px; margin-left: -4px;
  color: var(--fg-4); border-radius: var(--r1);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.toast-action + .toast-x { margin-left: -6px; }
.toast-x:hover { color: var(--fg); background: var(--hover); }
.toast-x-ico { --ico: var(--ico-md); }
.toast-timer {
  position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
  background: var(--tc); opacity: 0.5;
  transform-origin: left;
  animation: toastDrain var(--dwell) linear forwards;
}
@keyframes toastDrain { to { transform: scaleX(0); } }
:is(.toasts, .editor-toasts):is(:hover, :focus-within) .toast-timer { animation-play-state: paused; }
.toast-slot.in > .toast { animation: toastIn 280ms var(--e-out); }
.toast-slot.out > .toast { animation: toastOut 200ms var(--e) forwards; }
.toast.bump { animation: toastBump 260ms var(--e-out); }
@keyframes toastIn { from { opacity: 0; transform: translateX(20px); } }
@keyframes toastOut { to { opacity: 0; transform: translateX(20px); } }
@keyframes toastBump { 40% { transform: scale(1.02); } }
/* Phones: full width under the bar, so a long sentence still fits. */
@media (max-width: 860px) {
  .toasts, .editor-toasts { left: 12px; right: 12px; width: auto; }
}
/* The timer is also the dismissal clock: it keeps its real length when
   motion is reduced (the rule below would cut it to nothing), but is not
   drawn. */
@media (prefers-reduced-motion: reduce) {
  .toast-timer { animation-duration: var(--dwell) !important; opacity: 0; } /* stylelint-disable-line declaration-no-important -- Keep the real dismissal clock despite the global reduced-motion override. */
}


</style>
