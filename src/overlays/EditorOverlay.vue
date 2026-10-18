<script setup lang="ts">
import { useTemplateRef } from "vue";
import { useDialog } from "./use-dialog";
import BrandMark from "../shared/BrandMark.vue";
import AppIcon from "../shared/AppIcon.vue";
import WalletDisplay from "../shared/WalletDisplay.vue";
// M6 supplies the session, driver and running-job guard. No Canvas driver is started in M1.
const { requestClose, cancel, closed } = useDialog(
  "editor",
  useTemplateRef<HTMLDialogElement>("dialog"),
);
</script>
<template>
  <dialog
    ref="dialog"
    id="imageEditor"
    class="editor"
    data-mode="img2img"
    aria-labelledby="editorTitle"
    @cancel="cancel"
    @close="closed"
  >
    <header class="topbar editor-bar">
      <button
        class="ibtn editor-back"
        type="button"
        aria-label="返回"
        autofocus
        @click="requestClose"
      >
        <AppIcon name="i-back" />
      </button>
      <h2 class="brand editor-title" id="editorTitle" aria-label="图像编辑">
        <BrandMark surface="edit" subtitle="EDIT" />
      </h2>
      <div class="topbar-end editor-bar-end">
        <button class="ibtn" type="button" aria-label="打开图片" disabled>
          <AppIcon name="i-upload" /></button
        ><button class="ibtn" type="button" aria-label="版本栏" disabled>
          <AppIcon name="i-layers" />
        </button>
      </div>
      <div class="topbar-account"><WalletDisplay /></div>
    </header>
    <div class="editor-shell">
      <div class="composer"><div class="composer-scroll"></div></div>
      <div class="splitter" aria-hidden="true"></div>
      <section class="stage">
        <div class="viewport editor-mat">
          <div class="editor-viewport" id="editorViewport"></div>
          <div class="blank editor-empty">
            <AppIcon class="ico-xl" name="i-image" />
            <p class="blank-s">打开一张图片，开始编辑</p>
          </div>
        </div>
      </section>
      <aside class="editor-rail" aria-label="编辑版本"></aside>
    </div>
  </dialog>
</template>
