<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAskPresentation } from "../ask/presentation.ts";
import { useAsk } from "./ask.ts";
import { usePhotopea } from "./photopea.ts";
import { useShell } from "./shell.ts";
import { useUi } from "./ui.ts";

const { canvas } = useAskPresentation(), { router } = useShell();
const ask = useAsk(), photopea = usePhotopea(), ui = useUi();
const dialog = shallowRef<HTMLDialogElement | null>(null), dismissed = shallowRef(false);
const needed = computed(() => canvas.compact.value && !canvas.enabled.value &&
  ["image", "edit", "chat"].includes(router.route.value.workspace) && !router.route.value.overlay &&
  !photopea.task.value && !ask.retrospects.opened.value && !ui.confirmation.value && !ui.pickerOpen.value);
let disposed = false;
async function sync() {
  await nextTick();
  if (disposed || !dialog.value) return;
  if (!needed.value || dismissed.value) dialog.value.close();
  else if (!dialog.value.open && !document.querySelector("dialog:modal")) dialog.value.showModal();
}
watch([needed, dismissed], sync);
watch([canvas.compact, canvas.enabled], () => { dismissed.value = false; });
onMounted(() => { document.addEventListener("close", sync, true); void sync(); });
onBeforeUnmount(() => { disposed = true; document.removeEventListener("close", sync, true); dialog.value?.close(); });
</script>
<template>
  <dialog ref="dialog" class="modal compact-layout-notice" aria-labelledby="compactLayoutTitle" aria-describedby="compactLayoutBody" @cancel.prevent="dismissed = true">
    <header class="modal-head"><h2 id="compactLayoutTitle">当前窗口较窄</h2></header>
    <div class="modal-body"><p id="compactLayoutBody">传统布局适合电脑端，建议切换到画布协创 BETA。</p></div>
    <footer class="modal-foot"><div class="modal-actions">
      <button class="btn btn-quiet" type="button" @click="dismissed = true">继续桌面布局</button>
      <button class="btn btn-primary" type="button" @click="canvas.setEnabled(true)">切换到 BETA</button>
    </div></footer>
  </dialog>
</template>
<style scoped>
.compact-layout-notice { --modal-w: 400px; }
.modal-body p { margin: 0; color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.65; }
.modal-foot { padding-top: 0; border-top: 0; }
</style>
