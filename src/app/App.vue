<script setup lang="ts">
import { provide } from "vue";
import { createRouter } from "./router";
import { createShell, shellKey } from "./shell";
import { usePresentation } from "./presentation";
import ImageWorkspace from "../workspaces/image/ImageWorkspace.vue";
import ChatWorkspace from "../workspaces/chat/ChatWorkspace.vue";
import TagsWorkspace from "../workspaces/tags/TagsWorkspace.vue";
import SettingsOverlay from "../overlays/SettingsOverlay.vue";
import EditorOverlay from "../overlays/EditorOverlay.vue";

const router = createRouter();
const shell = createShell(router);
provide(shellKey, shell);
usePresentation(shell);
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
</template>
