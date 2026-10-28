<script setup lang="ts">
import { provide, shallowRef, onMounted, onScopeDispose, watch } from "vue";
import { createRouter } from "./router";
import { createShell, shellKey } from "./shell";
import { usePresentation } from "./presentation";
import HomeWorkspace from "../home/HomeWorkspace.vue";
import type { HomeActivity } from "../home/derive.ts";
import { createHomeNavigation, homeNavigationKey } from "../home/navigation.ts";
import ImageWorkspace from "../workspaces/image/ImageWorkspace.vue";
import ChatWorkspace from "../workspaces/chat/ChatWorkspace.vue";
import TagsWorkspace from "../workspaces/tags/TagsWorkspace.vue";
import SettingsOverlay from "../overlays/SettingsOverlay.vue";
import EditWorkspace from "../workspaces/edit/EditWorkspace.vue";
import KeyDialog from "../overlays/KeyDialog.vue";
import ConfirmSheet from "../shared/ConfirmSheet.vue";
import ToastList from "../shared/ToastList.vue";
import ModelLogos from "../shared/ModelLogos.vue";
import { createUi, uiKey } from "./ui";
import { createAskPresentation, askPresentationKey } from "../ask/presentation.ts";
import AskDrawer from "../ask/AskDrawer.vue";
import { createAsk } from "../ask/service";
import { askKey } from "./ask";
import { createBridge } from "../bridge/service";
import { createSlates } from "../slate/service";
import { slateKey } from "./slate";
import SlatePanel from "../slate/SlatePanel.vue";
import { bridgeKey } from "./bridge";
import { createHome } from "../home/service.ts";
import { homeKey } from "./home.ts";

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
const home = createHome({ services, drawing, chat, editor, slates, router, onError: error => console.warn("HOME 本机数据暂不可用", error) });
provide(homeKey, home);
provide(homeNavigationKey, createHomeNavigation({ router, home, drawing, chat, editor, ui }));
onScopeDispose(() => { void home.dispose(); });
const ask = createAsk({ services, router, drawing, chat, ui, slates, home });
provide(askKey, ask);
provide(askPresentationKey, createAskPresentation(ask, router));
function syncHomeActivity() {
  const plan = ask.draftPlan.value, activity: HomeActivity[] = [];
  if (plan?.changes.length || plan?.newBoardName || plan?.handoff) {
    const line = plan.workspace === 'image' && plan.boardId ? `image:${plan.boardId}` as const
      : plan.workspace === 'chat' && plan.conversationId ? `chat:${plan.conversationId}` as const : null;
    if (line) activity.push({ line, kind: 'draft', text: '草稿待确认' });
  }
  for (const pending of editor.pendingEdits()) {
    const line = ("edit:" + pending.boardId) as HomeActivity["line"];
    if (pending.mask) activity.push({ line, kind: 'mask', text: '蒙版未重绘' });
    if (pending.photopea) activity.push({ line, kind: 'photopea', text: '高级编辑未应用' });
  }
  home.updateActivity(activity);
}
watch(ask.draftPlan, syncHomeActivity, { immediate: true });
onScopeDispose(editor.subscribe(syncHomeActivity));
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
const editCreated = shallowRef(router.route.value.workspace === "edit");
watch(() => router.route.value.workspace, w => { if (w === "edit") editCreated.value = true; });
// Stable workspace keys, regardless of overlay or query ticket. Components stay non-reactive.
const workspaces = {
  home: HomeWorkspace,
  image: ImageWorkspace,
  chat: ChatWorkspace,
  tags: TagsWorkspace,
};
</script>
<template>
  <KeepAlive :max="4">
    <component
      v-if="router.route.value.workspace !== 'edit'"
      :is="workspaces[router.route.value.workspace]"
      :key="router.route.value.workspace"
    />
  </KeepAlive>
  <AskDrawer />
  <SlatePanel v-if="slates.visible.value" />
  <SettingsOverlay />
  <!-- Keep the iframe in place: KeepAlive DOM moves would reload Photopea. -->
  <EditWorkspace v-if="editCreated" v-show="router.route.value.workspace === 'edit'" />
  <KeyDialog />
  <ConfirmSheet />
  <ToastList />
  <ModelLogos />
</template>
