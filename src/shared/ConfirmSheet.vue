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
