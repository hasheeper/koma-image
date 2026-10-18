<script setup lang="ts">
import { provide, onScopeDispose } from "vue";
import { createRouter } from "./router";
import { createShell, shellKey } from "./shell";
import { usePresentation } from "./presentation";
import ImageWorkspace from "../workspaces/image/ImageWorkspace.vue";
import ChatWorkspace from "../workspaces/chat/ChatWorkspace.vue";
import TagsWorkspace from "../workspaces/tags/TagsWorkspace.vue";
import SettingsOverlay from "../overlays/SettingsOverlay.vue";
import EditorOverlay from "../overlays/EditorOverlay.vue";
import KeyDialog from "../overlays/KeyDialog.vue";
import ConfirmSheet from "../shared/ConfirmSheet.vue";
import ToastList from "../shared/ToastList.vue";
import ModelLogos from "../shared/ModelLogos.vue";
import { createUi, uiKey } from "./ui";

import { useServices } from "./services";
import { createDrawing } from "../services/drawing";
import { drawingKey } from "./drawing";
const router = createRouter();
const shell = createShell(router);
provide(shellKey, shell);
const ui = createUi();
provide(uiKey, ui);
const drawing = createDrawing(useServices(), ui);
provide(drawingKey, drawing);
onScopeDispose(() => drawing.dispose());
usePresentation(shell, ui);
// Stable workspace keys, regardless of overlay or query ticket. Components stay non-reactive.
const workspaces = {
  image: ImageWorkspace,
  chat: ChatWorkspace,
  tags: TagsWorkspace,
};
</script>
<template>
  <KeepAlive :max="3">
    <component
      :is="workspaces[router.route.value.workspace]"
      :key="router.route.value.workspace"
    />
  </KeepAlive>
  <SettingsOverlay />
  <EditorOverlay />
  <KeyDialog />
  <ConfirmSheet />
  <ToastList />
  <ModelLogos />
</template>
