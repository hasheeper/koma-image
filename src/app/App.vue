<script setup lang="ts">
import { provide, onMounted, onScopeDispose } from "vue";
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
import AskDrawer from "../ask/AskDrawer.vue";
import { createAsk } from "../ask/service";
import { askKey } from "./ask";
import { createBridge } from "../bridge/service";
import { createSlates } from "../slate/service";
import { slateKey } from "./slate";
import SlatePanel from "../slate/SlatePanel.vue";
import { bridgeKey } from "./bridge";

import { useServices } from "./services";
import { createDrawing } from "../services/drawing";
import { createChat } from "../services/chat";
import { createEditor } from "../services/editor";
import { editorKey } from "./editor";
import { chatKey } from "./chat";
import { drawingKey } from "./drawing";
const router = createRouter();
const shell = createShell(router);
provide(shellKey, shell);
const ui = createUi();
provide(uiKey, ui);
const services = useServices();
const drawing = createDrawing(services, ui, router);
const chat = createChat(services, ui);
provide(chatKey, chat);
const editor = createEditor(services, ui, router, drawing, chat);
provide(editorKey, editor);
onScopeDispose(() => editor.dispose());
onScopeDispose(() => chat.dispose());
provide(drawingKey, drawing);
onScopeDispose(() => drawing.dispose());
const slates = createSlates(services, drawing);
provide(slateKey, slates);
onScopeDispose(() => { void slates.dispose(); });
const ask = createAsk({ services, router, drawing, chat, ui, slates });
provide(askKey, ask);
onScopeDispose(() => ask.dispose());
const bridge = createBridge({ services, ask, drawing, router, ui, slates });
provide(bridgeKey, bridge);
onScopeDispose(() => { void bridge.dispose(); });
usePresentation(shell, ui);
onMounted(() => {
  if (
    services.data.phase === "ready" &&
    !services.connections.local &&
    !Object.keys(services.connections.configuration.connections).length &&
    !router.route.value.overlay
  )
    router.openOverlay("settings", "connections");
});
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
  <AskDrawer />
  <SlatePanel v-if="slates.visible.value" />
  <SettingsOverlay />
  <EditorOverlay />
  <KeyDialog />
  <ConfirmSheet />
  <ToastList />
  <ModelLogos />
</template>
