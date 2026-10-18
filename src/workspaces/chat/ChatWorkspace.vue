<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useShell } from "../../app/shell";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import WalletDisplay from "../../shared/WalletDisplay.vue";
import AppIcon from "../../shared/AppIcon.vue";

const { chat, narrow, router } = useShell();
const prompt = ref("");
const scroll = shallowRef<HTMLElement | null>(null);
const account = shallowRef<HTMLElement | null>(null);
const sidebarTools = shallowRef<HTMLElement | null>(null);
const menu = shallowRef<HTMLButtonElement | null>(null);
const lockTarget = computed(() =>
  narrow.value ? sidebarTools.value : account.value,
);
const lifecycle = useWorkspaceLifecycle("chat", [scroll]);
function closeSidebar() {
  chat.sidebarOpen = false;
  menu.value?.focus();
}
lifecycle.whileActive((signal) => {
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !document.querySelector("dialog[open], :popover-open") &&
        chat.sidebarOpen
      )
        closeSidebar();
    },
    { signal },
  );
  const viewport = window.visualViewport;
  if (!viewport) return;
  const app = document.getElementById("chatApp")!;
  const resize = () => {
    app.style.setProperty("--visible-height", `${viewport.height}px`);
    app.style.setProperty("--visible-top", `${viewport.offsetTop}px`);
  };
  viewport.addEventListener("resize", resize, { signal });
  viewport.addEventListener("scroll", resize, { signal });
  resize();
});
function security() {
  chat.sidebarOpen = false;
  router.openOverlay("settings", "security");
}
</script>
<template>
  <div class="chat-app" id="chatApp" data-workspace-root="chat">
    <header class="topbar">
      <WorkspaceSwitch workspace="chat" />
      <div class="topbar-menu">
        <div class="topbar-end" role="group" aria-label="工具"></div>
        <button
          ref="menu"
          class="ibtn chat-menu"
          type="button"
          aria-label="打开会话与工具"
          :aria-expanded="chat.sidebarOpen"
          aria-controls="chatSidebar"
          @click="chat.sidebarOpen = !chat.sidebarOpen"
        >
          <AppIcon name="i-menu" />
        </button>
      </div>
      <div ref="account" class="topbar-account"><WalletDisplay /></div>
    </header>
    <div class="chat-layout">
      <button
        class="chat-sidebar-backdrop"
        type="button"
        aria-label="关闭侧栏"
        :hidden="!chat.sidebarOpen"
        @click="closeSidebar"
      ></button>
      <aside class="chat-sidebar" id="chatSidebar" aria-label="会话与工具">
        <div class="sidebar-heading">
          <button
            class="ibtn rail-toggle"
            type="button"
            :aria-label="chat.railCollapsed ? '展开侧栏' : '收起侧栏'"
            :aria-expanded="!chat.railCollapsed"
            aria-controls="conversationList"
            @click="chat.railCollapsed = !chat.railCollapsed"
          >
            <AppIcon name="i-sidebar" />
          </button>
          <button class="ibtn" type="button" aria-label="新对话" disabled>
            <AppIcon name="i-compose" />
          </button>
          <button
            class="ibtn sidebar-close"
            type="button"
            aria-label="关闭侧栏"
            @click="closeSidebar"
          >
            <AppIcon name="i-close" />
          </button>
        </div>
        <div class="chat-tools-slot">
          <div
            ref="sidebarTools"
            class="topbar-end"
            role="group"
            aria-label="工具"
          ></div>
        </div>
        <nav
          id="conversationList"
          class="conversation-list"
          aria-label="会话列表"
        ></nav>
      </aside>
      <main class="chat-workspace" :inert="narrow && chat.sidebarOpen">
        <div
          ref="scroll"
          class="chat-scroll"
          id="chatScroll"
          tabindex="0"
          aria-label="绘图消息"
        >
          <div class="chat-empty">
            <AppIcon class="ico-xl" name="i-image" />
            <h1>从一张图，继续想象</h1>
            <p>描述画面，或上传图片开始修改。</p>
          </div>
          <div class="message-list"></div>
        </div>
        <form class="chat-composer generation-form" @submit.prevent>
          <div class="chat-attachments" aria-label="本轮图片"></div>
          <label class="sr-only" for="chatPrompt">描述或修改要求</label>
          <textarea
            id="chatPrompt"
            v-model="prompt"
            rows="1"
            maxlength="24000"
            placeholder="描述画面，或说说这次想怎么改…"
          ></textarea>
          <p class="chat-inline-error" role="status"></p>
          <div class="chat-composer-bottom">
            <button
              class="ibtn"
              type="button"
              aria-label="上传参考图片"
              disabled
            >
              <AppIcon name="i-plus" />
            </button>
            <button
              class="param-button"
              type="button"
              aria-label="参数"
              disabled
            >
              <AppIcon class="solid" name="i-parameters" /><span
                class="param-summary"
              ></span>
            </button>
            <button class="model-chip" type="button" aria-label="模型" disabled>
              <AppIcon class="solid model-chip-icon" name="i-points" /><span
                class="model-chip-name"
                >未配置连接</span
              ><AppIcon class="model-chip-caret" name="i-chevron" />
            </button>
            <span class="send-slot"
              ><button
                class="btn btn-primary btn-go chat-send"
                type="submit"
                aria-label="发送绘图请求"
                disabled
              >
                <AppIcon name="i-send" /></button
            ></span>
          </div>
        </form>
      </main>
    </div>
  </div>
  <Teleport v-if="lockTarget" :to="lockTarget"
    ><button
      class="ibtn topbar-lock"
      type="button"
      aria-label="API Key"
      data-tip="API Key"
      @click="security"
    >
      <AppIcon name="i-lock" /></button
  ></Teleport>
</template>
