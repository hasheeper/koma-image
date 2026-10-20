<script setup lang="ts">
import { nextTick, onBeforeUnmount, useTemplateRef, watch } from "vue";
import { useUi } from "../app/ui";
const ui = useUi(),
  dialog = useTemplateRef<HTMLDialogElement>("dialog");
watch(ui.confirmation, async (value) => {
  await nextTick();
  if (value && !dialog.value?.open) {
    dialog.value?.showModal();
    dialog.value
      ?.querySelector<HTMLButtonElement>(
        value.tone === "danger" ? "[data-confirm=cancel]" : "[data-confirm=ok]",
      )
      ?.focus();
  } else if (!value) dialog.value?.close();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  ui.answer(false);
});
</script>
<template>
  <dialog
    ref="dialog"
    id="confirmSheet"
    class="modal modal-confirm"
    aria-labelledby="confirmTitle"
    aria-describedby="confirmBody"
    @cancel.prevent="ui.answer(false)"
  >
    <header class="modal-head">
      <h2 id="confirmTitle">{{ ui.confirmation.value?.title }}</h2>
    </header>
    <div
      id="confirmBody"
      class="modal-body"
      :hidden="
        !ui.confirmation.value?.message && !ui.confirmation.value?.items?.length
      "
    >
      <p v-if="ui.confirmation.value?.message" class="confirm-message">
        {{ ui.confirmation.value.message }}
      </p>
      <ul v-if="ui.confirmation.value?.items?.length" class="confirm-items">
        <li v-for="item in ui.confirmation.value.items" :key="item">
          {{ item }}
        </li>
      </ul>
    </div>
    <footer class="modal-foot">
      <div class="modal-actions">
        <button
          type="button"
          class="btn btn-quiet"
          data-confirm="cancel"
          @click="ui.answer(false)"
        >
          {{ ui.confirmation.value?.cancelLabel || "取消" }}
        </button>
        <button
          type="button"
          class="btn"
          :class="
            ui.confirmation.value?.tone === 'danger'
              ? 'btn-danger'
              : 'btn-primary'
          "
          data-confirm="ok"
          @click="ui.answer(true)"
        >
          {{ ui.confirmation.value?.confirmLabel || "继续" }}
        </button>
      </div>
    </footer>
  </dialog>
</template>

<style scoped>
/* In-page confirmation (confirm-sheet.js). */
.modal-confirm { --modal-w: 420px; }
.modal-confirm .modal-body { display: grid; gap: var(--sp-3); }
.modal-confirm .modal-foot { border-top: 0; padding-top: 0; }
.confirm-message { font-size: var(--fz-sm); line-height: 1.65; color: var(--fg-2); white-space: pre-line; }
.confirm-items { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.confirm-items li { display: flex; gap: var(--sp-2); font-size: var(--fz-sm); line-height: 1.55; color: var(--fg-2); }
.confirm-items li::before { content: ""; flex: none; width: 4px; height: 4px; margin-top: 0.65em; border-radius: 50%; background: var(--fg-4); }

</style>
