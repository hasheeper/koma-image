<script setup lang="ts">
import { computed, shallowRef, ref, watch, nextTick, onDeactivated } from "vue";
import { useShell } from "../../app/shell";
import { useChat } from "../../app/chat";
import { useServices } from "../../app/services";
import { useUi } from "../../app/ui";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import { chatOptions } from "../../services/chat";
import { names } from "../../storage/names";
import { quoteLabel } from "../../domain/quote";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import WalletDisplay from "../../shared/WalletDisplay.vue";
import AppIcon from "../../shared/AppIcon.vue";
import ConversationList from "./ConversationList.vue";
import ContextPanel from "./ContextPanel.vue";
import ChatTurn from "./ChatTurn.vue";
const { chat, view } = useChat(),
  shell = useShell(),
  services = useServices(),
  ui = useUi();
const { narrow, router } = shell;
const scroll = shallowRef<HTMLElement | null>(null),
  account = shallowRef<HTMLElement | null>(null),
  sidebarTools = shallowRef<HTMLElement | null>(null),
  menu = shallowRef<HTMLButtonElement | null>(null),
  prompt = shallowRef<HTMLTextAreaElement | null>(null),
  form = shallowRef<HTMLFormElement | null>(null),
  upload = shallowRef<HTMLInputElement | null>(null),
  context = shallowRef<InstanceType<typeof ContextPanel> | null>(null),
  lightbox = shallowRef<HTMLDialogElement | null>(null),
  modelPop = shallowRef<HTMLElement | null>(null),
  paramPop = shallowRef<HTMLElement | null>(null);
const full = ref(""),
  latest = ref(false),
  drop = ref(false),
  lockTarget = computed(() =>
    narrow.value ? sidebarTools.value : account.value,
  ),
  c = computed(() => view.value.current),
  options = computed(() => chatOptions(c.value));
const labels: Record<string, string> = {
    quality: "质量",
    size: "画幅",
    aspect_ratio: "比例",
    image_size: "分辨率",
    output_format: "格式",
  },
  values: Record<string, string> = {
    auto: "自动",
    low: "草稿",
    medium: "标准",
    high: "高质量",
    xhigh: "超高",
    max: "最高",
    "1024x1024": "方形",
    "1536x1024": "横向",
    "1024x1536": "竖向",
  };
const label = (v: string) => values[v] || v.toUpperCase(),
  summary = computed(() =>
    Object.entries(view.value.model?.fields || {})
      .filter(([k, f]) => options.value[k] !== f.default)
      .map(([k]) => label(options.value[k] || ""))
      .join(" · "),
  );
const groups = computed(() =>
  [...new Set(view.value.models.map((m) => m.provider))].map((provider) => ({
    provider,
    models: view.value.models.filter((m) => m.provider === provider),
  })),
);
const life = useWorkspaceLifecycle("chat", [scroll]);
const scrolls = new Map<string, number>();
let active = false,
  dragDepth = 0,
  stoppedAt = 0,
  claiming = false;
function closeSidebar() {
  shell.chat.sidebarOpen = false;
  menu.value?.focus();
}
function security() {
  shell.chat.sidebarOpen = false;
  router.openOverlay("settings", "security");
}
function resizePrompt() {
  if (prompt.value) {
    prompt.value.style.height = "auto";
    prompt.value.style.height = `${prompt.value.scrollHeight}px`;
  }
}
function bottom() {
  if (scroll.value) {
    scroll.value.scrollTop = scroll.value.scrollHeight;
    latest.value = false;
  }
}
function near() {
  return (
    !scroll.value ||
    scroll.value.scrollHeight -
      scroll.value.scrollTop -
      scroll.value.clientHeight <
      100
  );
}
function show(id: string) {
  full.value = chat.assets.assets.get(id)?.url || "";
  if (full.value) lightbox.value?.showModal();
}
function place(pop: HTMLElement | null, button: HTMLElement) {
  if (!pop) return;
  if (narrow.value) {
    pop.removeAttribute("style");
    delete pop.dataset.placement;
    return;
  }
  const box = button.getBoundingClientRect();
  pop.style.right = `${Math.round(Math.max(8, document.documentElement.clientWidth - box.right))}px`;
  pop.style.top = `${Math.round(box.top - 8)}px`;
  pop.style.maxHeight = `${Math.floor(box.top - 16)}px`;
  pop.dataset.placement = "top";
}
function openPop(pop: HTMLElement | null, e: MouseEvent) {
  if (!view.value.ready) {
    void chat.refreshCatalog();
    return;
  }
  if (pop?.matches(":popover-open")) {
    pop.hidePopover();
    return;
  }
  pop?.showPopover();
  place(pop, e.currentTarget as HTMLElement);
}
async function claim() {
  if (!active || claiming || !view.value.ready) return;
  const url = new URL(location.href),
    ticket = url.searchParams.get("image");
  if (!ticket) return;
  claiming = true;
  try {
    if (await chat.claim(ticket)) {
      url.searchParams.delete("image");
      history.replaceState(history.state, "", url);
    }
  } finally {
    claiming = false;
  }
}
function stop(e: MouseEvent) {
  if (!e.detail || performance.now() - stoppedAt >= 400) chat.cancel();
}
function key(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  if (
    e.metaKey ||
    e.ctrlKey ||
    (!e.shiftKey && !e.altKey && !matchMedia("(pointer: coarse)").matches)
  ) {
    e.preventDefault();
    void chat.execute();
  }
}
watch(
  () => view.value.current.id,
  async (id, old) => {
    if (old && scroll.value) scrolls.set(old, scroll.value.scrollTop);
    await nextTick();
    if (scroll.value)
      scroll.value.scrollTop = scrolls.get(id) ?? scroll.value.scrollHeight;
    resizePrompt();
  },
);
watch(
  () => view.value.current.prompt,
  () => nextTick(resizePrompt),
);
watch(
  () => view.value.busy,
  async (b, old) => {
    const follow = near();
    if (b && !old) stoppedAt = performance.now();
    await nextTick();
    if (follow) bottom();
    else latest.value = true;
  },
);
watch([() => view.value.ready, ui.imageDelivery], () => void claim());
function rail() {
  shell.chat.railCollapsed = !shell.chat.railCollapsed;
  void services.preferences.set(
    names.chatRail,
    shell.chat.railCollapsed ? "collapsed" : "expanded",
  );
}
life.whileActive((signal) => {
  active = true;
  shell.chat.railCollapsed =
    services.preferences.get<string>(names.chatRail, "expanded") ===
    "collapsed";
  void chat.start().then(() => claim());
  const app = document.getElementById("chatApp")!,
    viewport = () => {
      app.style.setProperty(
        "--visible-height",
        `${window.visualViewport?.height || innerHeight}px`,
      );
      app.style.setProperty(
        "--visible-top",
        `${window.visualViewport?.offsetTop || 0}px`,
      );
      resizePrompt();
    };
  window.visualViewport?.addEventListener("resize", viewport, { signal });
  window.visualViewport?.addEventListener("scroll", viewport, { signal });
  window.addEventListener("resize", viewport, { signal });
  viewport();
  const observer = new ResizeObserver(() =>
    app.style.setProperty(
      "--composer-height",
      `${form.value?.getBoundingClientRect().height || 0}px`,
    ),
  );
  if (form.value) observer.observe(form.value);
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "Escape" &&
        !document.querySelector("dialog[open],:popover-open") &&
        shell.chat.sidebarOpen
      )
        closeSidebar();
      if (e.key === "Tab" && shell.chat.sidebarOpen) {
        const els = [
          ...document.querySelectorAll<HTMLElement>(
            "#chatSidebar button,#chatSidebar input,#chatSidebar a",
          ),
        ].filter((e) => e.offsetParent);
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    },
    { signal },
  );
  document.addEventListener(
    "paste",
    (e) => {
      if (document.querySelector("dialog:modal")) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) {
        e.preventDefault();
        void chat.upload(files);
      }
    },
    { signal },
  );
  const end = () => {
    dragDepth = 0;
    drop.value = false;
  };
  document.addEventListener(
    "dragover",
    (e) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    },
    { signal },
  );
  document.addEventListener(
    "dragenter",
    (e) => {
      if (
        e.dataTransfer?.types.includes("Files") &&
        !document.querySelector("dialog:modal")
      ) {
        dragDepth++;
        drop.value = true;
      }
    },
    { signal },
  );
  document.addEventListener(
    "dragleave",
    () => {
      if (--dragDepth <= 0) end();
    },
    { signal },
  );
  document.addEventListener("dragend", end, { signal });
  document.addEventListener(
    "drop",
    (e) => {
      end();
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        if (!document.querySelector("dialog:modal"))
          void chat.upload([...e.dataTransfer.files]);
      }
    },
    { signal },
  );
  signal.addEventListener(
    "abort",
    () => {
      active = false;
      observer.disconnect();
      end();
    },
    { once: true },
  );
});
onDeactivated(() => {
  modelPop.value?.hidePopover();
  paramPop.value?.hidePopover();
  lightbox.value?.close();
});
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
          :aria-expanded="shell.chat.sidebarOpen"
          aria-controls="chatSidebar"
          @click="shell.chat.sidebarOpen = !shell.chat.sidebarOpen"
        >
          <AppIcon name="i-menu" />
        </button>
      </div>
      <div ref="account" class="topbar-account">
        <WalletDisplay :quota="view.quota" :model="view.model" />
      </div>
    </header>
    <div class="chat-layout">
      <button
        class="chat-sidebar-backdrop"
        type="button"
        aria-label="关闭侧栏"
        :hidden="!shell.chat.sidebarOpen"
        @click="closeSidebar"
      ></button>
      <aside class="chat-sidebar" id="chatSidebar" aria-label="会话与工具">
        <div class="sidebar-heading">
          <button
            class="ibtn rail-toggle"
            type="button"
            :aria-label="shell.chat.railCollapsed ? '展开侧栏' : '收起侧栏'"
            :aria-expanded="!shell.chat.railCollapsed"
            aria-controls="conversationList"
            @click="rail"
          >
            <AppIcon name="i-sidebar" /></button
          ><button
            class="ibtn"
            type="button"
            aria-label="新对话"
            @click="
              chat.addConversation();
              shell.chat.sidebarOpen = false;
              prompt?.focus();
            "
          >
            <AppIcon name="i-compose" /></button
          ><button
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
        <ConversationList />
      </aside>
      <main
        class="chat-workspace"
        :inert="narrow && shell.chat.sidebarOpen"
        :data-empty="!c.turns.length"
      >
        <div
          ref="scroll"
          class="chat-scroll"
          id="chatScroll"
          tabindex="0"
          aria-label="绘图消息"
          @scroll="latest = !near()"
        >
          <div class="chat-empty" :hidden="!!c.turns.length">
            <AppIcon class="ico-xl" name="i-image" />
            <h1>从一张图，继续想象</h1>
            <p>描述画面，或上传图片开始修改。</p>
          </div>
          <div class="message-list" id="messageList">
            <ChatTurn v-for="t in c.turns" :key="t.id" :turn="t" @view="show" />
          </div>
        </div>
        <button
          class="ibtn latest-button"
          type="button"
          aria-label="查看最新结果"
          :hidden="!latest || !c.turns.length"
          @click="bottom"
        >
          <AppIcon name="i-down" />
        </button>
        <form
          ref="form"
          class="chat-composer generation-form"
          id="chatForm"
          :aria-busy="!!view.busy"
          :data-drop="drop || undefined"
          @submit.prevent="chat.execute()"
        >
          <div class="chat-attachments" aria-label="本轮图片">
            <div
              v-for="id in c.attachments"
              :key="id"
              class="attachment"
              :data-dropped="!view.context.imageIds.includes(id) || undefined"
            >
              <button
                class="attachment-preview"
                type="button"
                :aria-label="`查看参考图片：${chat.assets.assets.get(id)?.name}`"
                @click="show(id)"
              >
                <img
                  :src="chat.assets.assets.get(id)?.url"
                  alt=""
                  width="96"
                  height="96"
                /></button
              ><button
                class="ibtn attachment-remove"
                type="button"
                aria-label="移除参考图片"
                @click="chat.removeReference(id)"
              >
                <AppIcon name="i-close" />
              </button>
            </div>
            <div v-if="view.uploading" class="attachment attachment-loading">
              <span class="sheen"></span>
            </div>
          </div>
          <label class="sr-only" for="chatPrompt">描述或修改要求</label
          ><textarea
            ref="prompt"
            id="chatPrompt"
            :value="c.prompt"
            rows="1"
            maxlength="24000"
            placeholder="描述画面，或说说这次想怎么改…"
            @input="
              chat.setPrompt(($event.target as HTMLTextAreaElement).value);
              resizePrompt();
            "
            @keydown="key"
          ></textarea>
          <p class="chat-inline-error" role="status">
            {{ view.error || view.catalogError }}
          </p>
          <div class="chat-composer-bottom">
            <button
              class="ibtn"
              type="button"
              aria-label="上传参考图片"
              @click="upload?.click()"
            >
              <AppIcon name="i-plus" /></button
            ><input
              ref="upload"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              @change="
                chat.upload([
                  ...(($event.target as HTMLInputElement).files || []),
                ]);
                ($event.target as HTMLInputElement).value = '';
              "
            />
            <button
              class="context-button"
              type="button"
              :hidden="
                !c.turns.length &&
                !view.context.imageIds.length &&
                !view.context.dropped.length
              "
              aria-label="上下文"
              :aria-expanded="shell.chat.contextOpen"
              :class="{ 'has-overflow': view.context.dropped.length }"
              :data-overflow="view.context.dropped.length || ''"
              @click="context?.toggle()"
            >
              <AppIcon name="i-layers" /><span>{{
                view.context.turnIds.length
              }}</span
              ><span class="context-divider"></span
              ><AppIcon name="i-image" /><span>{{
                view.context.imageIds.length
              }}</span>
            </button>
            <button
              class="param-button"
              type="button"
              :hidden="view.model && !Object.keys(view.model.fields).length"
              :aria-label="`参数：${summary || '默认'}`"
              :data-changed="summary ? '' : undefined"
              @click="openPop(paramPop, $event)"
            >
              <AppIcon class="solid" name="i-parameters" /><span
                class="param-summary"
                >{{ summary }}</span
              ></button
            ><button
              class="model-chip"
              type="button"
              :aria-label="`模型：${view.model?.name || '未配置连接'}`"
              @click="openPop(modelPop, $event)"
            >
              <AppIcon
                class="model-chip-icon"
                :class="{ solid: view.model?.provider !== 'gemini' }"
                :name="
                  view.model?.provider === 'openai'
                    ? 'i-openai'
                    : view.model?.provider === 'gemini'
                      ? 'i-gemini'
                      : 'i-points'
                "
              /><span class="model-chip-name">{{
                view.model?.name || "未配置连接"
              }}</span
              ><AppIcon class="model-chip-caret" name="i-chevron" /></button
            ><span
              v-if="view.quote && view.quote.cost > 0 && !view.busy"
              class="quote-cost mono"
              >{{ quoteLabel(view.quote) }}</span
            ><span class="send-slot"
              ><button
                class="btn btn-primary btn-go chat-send"
                type="submit"
                aria-label="发送绘图请求"
                :hidden="!!view.busy"
                :disabled="
                  !view.ready ||
                  !!view.busy ||
                  !!view.uploading ||
                  !c.prompt.trim()
                "
                :title="`发送（Enter）${view.quote ? ' · ' + quoteLabel(view.quote) : ''}`"
              >
                <AppIcon name="i-send" /></button
              ><button
                class="btn chat-stop"
                type="button"
                aria-label="停止生成"
                :hidden="!view.busy"
                @click="stop"
              >
                <AppIcon name="i-stop" /></button
            ></span>
          </div>
          <span class="sr-only" role="status">{{
            view.busy?.phase || (view.uploading ? "读取图片中" : "")
          }}</span>
        </form>
      </main>
      <ContextPanel ref="context" @view="show" />
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
  <Teleport to="body"
    ><dialog ref="lightbox" class="chat-lightbox" @close="full = ''">
      <button
        class="ibtn"
        type="button"
        aria-label="关闭图片"
        @click="lightbox?.close()"
      >
        <AppIcon name="i-close" /></button
      ><img v-if="full" :src="full" alt="生成图片大图" />
    </dialog>
    <div
      ref="modelPop"
      class="editor-pop chat-pop model-panel"
      popover
      role="dialog"
      aria-label="模型"
    >
      <div class="editor-pop-list" role="radiogroup" aria-label="模型">
        <div
          v-for="g in groups"
          :key="g.provider"
          class="editor-pop-group"
          role="group"
          :aria-label="g.provider"
        >
          <p class="model-group-head">
            <AppIcon
              :class="{ solid: g.provider !== 'gemini' }"
              :name="
                g.provider === 'openai'
                  ? 'i-openai'
                  : g.provider === 'gemini'
                    ? 'i-gemini'
                    : 'i-points'
              "
            /><span>{{
              g.provider === "openai"
                ? "OpenAI"
                : g.provider === "gemini"
                  ? "Gemini"
                  : g.provider
            }}</span>
          </p>
          <label v-for="m in g.models" :key="m.id" class="editor-pop-item"
            ><input
              type="radio"
              name="chatModel"
              :value="m.id"
              :checked="view.model?.id === m.id"
              @change="chat.setModel(m.id)"
              @click="
                (e) => {
                  if (e.detail > 0) modelPop?.hidePopover();
                }
              "
              @keydown.enter="modelPop?.hidePopover()"
            /><span>{{ m.name }}</span></label
          >
        </div>
      </div>
      <div class="model-panel-foot">
        <button
          class="editor-pop-item model-manage"
          type="button"
          @click="
            modelPop?.hidePopover();
            router.openOverlay('settings', 'models');
          "
        >
          <AppIcon name="i-plus" /><span>管理模型…</span>
        </button>
      </div>
    </div>
    <div
      ref="paramPop"
      class="editor-pop chat-pop param-panel"
      popover
      role="dialog"
      aria-label="参数"
    >
      <div class="param-rows">
        <div
          v-for="(field, key) in view.model?.fields"
          :key="key"
          class="param-row"
          role="radiogroup"
          :aria-label="labels[key] || key"
        >
          <span class="param-name">{{ labels[key] || key }}</span>
          <div class="param-chips">
            <label
              v-for="value in field.options"
              :key="value"
              class="param-chip"
              ><input
                type="radio"
                :name="`chatOption-${key}`"
                :checked="options[key] === value"
                @change="chat.setOption(key, value)"
              /><span>{{ label(value) }}</span></label
            >
          </div>
        </div>
      </div>
    </div></Teleport
  >
</template>
