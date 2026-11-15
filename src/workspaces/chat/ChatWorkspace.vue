<script setup lang="ts">
import WorkspaceEvolutionEntry from "../../ask/retrospect/WorkspaceEvolutionEntry.vue";
import BoardRetrospectEntry from "../../ask/retrospect/BoardRetrospectEntry.vue";
import { useRetrospects } from "../../ask/retrospect/use-retrospects";
import AnnotationCard from "../../shared/annotations/AnnotationCard.vue";
import ModelParameterInput from "../../shared/ModelParameterInput.vue";
import { computed, shallowRef, ref, watch, nextTick, onDeactivated, onBeforeUnmount } from "vue";
import { useShell } from "../../app/shell";
import { useAskPresentation } from "../../ask/presentation";
const { fullscreen: askFullscreen, chatCanvas: layout, selectCanvasPanel } = useAskPresentation();
import { useAsk } from "../../app/ask";
import { installCanvasSplitter } from "../../native/canvas-splitter";
import { useCanvasSheet } from "../../ask/canvas-sheet";
import PopoverMenu from "../../shared/ui/PopoverMenu.vue";
import CanvasPanelSwitch from "../../shared/ui/CanvasPanelSwitch.vue";
import { useChat } from "../../app/chat";
import { usePhotopea } from "../../app/photopea.ts";
const photopea = usePhotopea();
import { useAnnotations } from "../../app/annotations.ts";
import { chatImageId } from "../../domain/image-origin.ts";
import { useServices } from "../../app/services";
import { useUi, message } from "../../app/ui";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import { chatOptions } from "../../services/chat";
import { chatOptionLabel, chatOptionNames } from "../../domain/chat-options";
import { names } from "../../storage/names";
import { quoteLabel } from "../../domain/quote";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import WalletDisplay from "../../shared/WalletDisplay.vue";
import ThemeToggle from "../../shared/ThemeToggle.vue";
import AppIcon from "../../shared/AppIcon.vue";
import ModelIcon from "../../shared/ModelIcon.vue";
import WaveMark from "../../shared/WaveMark.vue";
import ConversationList from "./ConversationList.vue";
import ContextPanel from "./ContextPanel.vue";
import ChatTurn from "./ChatTurn.vue";
const annotations = useAnnotations(), fullId=shallowRef(''), ask = useAsk();
/* Canvas collaboration only moves hosts: the stream, composer, context and
   conversation remain owned by the chat service and these same components. */
const coCreate = layout.active;
const askHost = shallowRef<HTMLElement | null>(null), contextHost = shallowRef<HTMLElement | null>(null), canvasSplitter = shallowRef<HTMLElement | null>(null);
const navFloat = shallowRef<HTMLElement | null>(null), accountFloat = shallowRef<HTMLElement | null>(null);
const switchHome = shallowRef<HTMLElement | null>(null), switchSide = shallowRef<HTMLElement | null>(null);
/* Phone: the tray is the shared bottom sheet. Closed, its grip sits in the composer's top edge and the
   composer's own context and ASK buttons open it; the context pane keeps the composer, ASK takes its slot. */
const chatLayout = shallowRef<HTMLElement | null>(null), sheet = shallowRef<HTMLElement | null>(null);
const canvasSheet = useCanvasSheet(layout, { host: chatLayout, sheet, cover: () => scroll.value, open: pane => selectPanel(pane) });
const { mode: sheetMode, stageCovered, switchShown } = canvasSheet;
const switchTarget = computed(() => layout.switchInTray.value ? switchSide.value : switchHome.value);
const contextTarget = computed(() => coCreate.value ? contextHost.value : null);
const contextOpen = computed(() => coCreate.value && layout.panel.value === "context");
const contextExpanded = computed(() => coCreate.value ? contextOpen.value : shell.chat.contextOpen);
/* Displayed pane: retained while the tray leaves, so the context dialog closes after the exit. */
const contextShown = computed(() => coCreate.value && layout.shownPanel.value === "context");
/* A draft applied to CHAT while ASK is showing marks the context switch until it is opened. */
const contextUpdated = shallowRef(false);
/* In collaboration an active evolution keeps its pill island; starting one moves into the ⋯ menu,
   so the head never shows two identical ⋯ islands. */
const { active: activeEvolution } = useRetrospects();
const evolutionAvailable = computed(() => view.value.current.turns.some(t => t.versions.some(v => v.status === "done")));
const panelOptions = computed(() => [
  { value: "context", label: "上下文", icon: "i-layers", controls: "contextPanel", updated: contextUpdated.value },
  { value: "ask", label: "ASK", icon: "i-ask", controls: "askDrawer" },
]);
watch(askHost, host => { layout.askHost.value = host; });
onBeforeUnmount(() => { layout.askHost.value = null; });
function selectPanel(panel: "ask" | "context") {
  selectCanvasPanel(layout, panel);
}
function toggleContext() {
  if (coCreate.value) selectPanel("context");
  else context.value?.toggle();
}
watch(ask.appliedDraft, value => {
  if (value?.workspace === "chat" && coCreate.value && layout.panel.value !== "context") contextUpdated.value = true;
});
watch(contextOpen, open => { if (open) contextUpdated.value = false; });
const { chat, view } = useChat(),
  shell = useShell(),
  services = useServices(),
  ui = useUi();
const { narrow, router } = shell;
const scroll = shallowRef<HTMLElement | null>(null),
  search = shallowRef<HTMLInputElement | null>(null),
  searchRow = shallowRef<HTMLButtonElement | null>(null),
  menu = shallowRef<HTMLButtonElement | null>(null),
  prompt = shallowRef<HTMLTextAreaElement | null>(null),
  form = shallowRef<HTMLFormElement | null>(null),
  upload = shallowRef<HTMLInputElement | null>(null),
  context = shallowRef<InstanceType<typeof ContextPanel> | null>(null),
  lightbox = shallowRef<HTMLDialogElement | null>(null),
  modelPop = shallowRef<HTMLElement | null>(null),
  paramPop = shallowRef<HTMLElement | null>(null);
const full = ref(""),
  openPanel = ref<"model" | "param" | "">(""),
  latest = ref(false),
  drop = ref(false),
  searching = ref(false),
  query = ref(""),
  c = computed(() => view.value.current),
  latestResult = computed(() => {
    for (let i = c.value.turns.length - 1; i >= 0; i--)
      if (
        c.value.turns[i].versions[c.value.turns[i].selectedVersion]?.status ===
        "done"
      )
        return i;
    return -1;
  }),
  options = computed(() => chatOptions(c.value));
/* A starter only fills the composer; nothing is sent, or charged, until the
   user sends it. */
const starters = [
  {
    label: "窗边打盹的橘猫",
    prompt: "一只橘猫在洒满阳光的窗台上打盹，暖色调，柔和的自然光",
  },
  {
    label: "雨夜霓虹街头",
    prompt: "赛博朋克风格的雨夜街头，霓虹灯倒映在积水里，电影感构图",
  },
  {
    label: "水彩森林小屋",
    prompt: "水彩风格，森林深处的小木屋，清晨薄雾，柔和配色",
  },
];
const summary = computed(() =>
    Object.entries(view.value.model?.fields || {})
      .filter(([k, f]) => options.value[k] && options.value[k] !== f.default)
      .map(([k]) => chatOptionLabel(options.value[k] || ""))
      .join(" · "),
  );
const sourceConnections = shallowRef(services.connections.configuration.connections);
const groups = computed(() =>
  [...new Set(view.value.models.map((m) => m.provider))].map((provider) => ({
    provider,
    models: view.value.models
      .filter((m) => m.provider === provider)
      .map((m) => ({
        ...m,
        sourceName: sourceConnections.value[m.connection]?.name.trim() || "",
      })),
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
function newConversation() {
  chat.addConversation();
  shell.chat.sidebarOpen = false;
  prompt.value?.focus();
}
async function startSearch() {
  if (shell.chat.railCollapsed && !coCreate.value) rail();
  searching.value = true;
  await nextTick();
  search.value?.focus();
}
async function endSearch(refocus = false) {
  query.value = "";
  searching.value = false;
  if (!refocus) return;
  await nextTick();
  searchRow.value?.focus();
}
/* Escape leaves the search, and must not also close the phone drawer. */
function searchKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  if (e.isComposing) return;
  e.preventDefault();
  void endSearch(true);
}
async function fillPrompt(text: string) {
  chat.setPrompt(text);
  await nextTick();
  prompt.value?.focus();
  prompt.value?.setSelectionRange(text.length, text.length);
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
async function annotate() {
  const asset=chat.assets.assets.get(fullId.value);if(!asset)return;
  const owner=view.value.current;
  const turn=owner.turns.find(t=>t.versions.some(v=>v.blocks.some(b=>b.type==='image'&&b.assetId===asset.id)||Object.values(v.composites??{}).includes(asset.id)));
  const version=turn?.versions.find(v=>v.blocks.some(b=>b.type==='image'&&b.assetId===asset.id)||Object.values(v.composites??{}).includes(asset.id));
  lightbox.value?.close();
  try{await annotations.open({blob:asset.blob,name:asset.name,recordId:turn&&version?chatImageId(owner.id,turn.id,version.id,asset.id):asset.id,workspace:'chat',chat:{conversationId:owner.id,turnId:turn?.id,versionId:version?.id,assetId:asset.id}});}catch(e){ui.toast(message(e),'err');}
}
function show(id: string) {
  fullId.value=id;
  full.value = chat.assets.assets.get(id)?.url || "";
  if (full.value) lightbox.value?.showModal();
}
function place(pop: HTMLElement | null, button: HTMLElement) {
  if (!pop) return;
  if (coCreate.value && narrow.value) {
    pop.removeAttribute("style");
    delete pop.dataset.placement;
    return;
  }
  const box = button.getBoundingClientRect();
  const viewport = window.visualViewport,
    top = viewport?.offsetTop ?? 0,
    bottom = top + (viewport?.height ?? innerHeight),
    above = Math.max(0, box.top - top - 12),
    below = Math.max(0, bottom - box.bottom - 12);
  pop.style.maxHeight = `${Math.max(above, below)}px`;
  const up = pop.offsetHeight <= above || above >= below;
  pop.style.maxHeight = `${up ? above : below}px`;
  const height = pop.getBoundingClientRect().height;
  pop.style.right = `${Math.round(Math.max(8, document.documentElement.clientWidth - box.right))}px`;
  pop.style.top = `${Math.round(Math.max(top + 8, Math.min(bottom - height - 8, up ? box.top - 4 - height : box.bottom + 4)))}px`;
  pop.dataset.placement = up ? "top" : "bottom";
}
function panelToggled(panel: "model" | "param", e: ToggleEvent) {
  if (e.newState === "open") openPanel.value = panel;
  else if (openPanel.value === panel) openPanel.value = "";
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
watch(coCreate, () => {
  shell.chat.sidebarOpen = false;
  shell.chat.contextOpen = false;
  if (!coCreate.value) contextUpdated.value = false;
  modelPop.value?.hidePopover();
  paramPop.value?.hidePopover();
});
function rail() {
  shell.chat.railCollapsed = !shell.chat.railCollapsed;
  if (shell.chat.railCollapsed) void endSearch();
  void services.preferences.set(
    names.chatRail,
    shell.chat.railCollapsed ? "collapsed" : "expanded",
  );
}
life.whileActive((signal) => {
  active = true;
  const syncSources = () => {
    sourceConnections.value = services.connections.configuration.connections;
  };
  syncSources();
  signal.addEventListener("abort", services.connections.subscribe(syncSources), { once: true });
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
      modelPop.value?.hidePopover();
      paramPop.value?.hidePopover();
    };
  window.visualViewport?.addEventListener("resize", viewport, { signal });
  window.visualViewport?.addEventListener("scroll", viewport, { signal });
  window.addEventListener("resize", viewport, { signal });
  viewport();
  if (canvasSplitter.value) installCanvasSplitter(canvasSplitter.value, app, () => layout.ratio.value, layout.setRatio, signal);
  canvasSheet.install(signal);
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
      /* The embedded context stays a non-modal dialog, so only modal layers hold Escape. */
      const covered = document.querySelector(coCreate.value ? "dialog:modal,:popover-open" : "dialog[open],:popover-open");
      if (e.key === "Escape" && !covered && shell.chat.sidebarOpen) closeSidebar();
      else if (e.key === "Escape" && !covered && coCreate.value && layout.compact.value && layout.panel.value && !e.defaultPrevented) layout.panel.value = null;
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
  <div class="chat-app" id="chatApp" data-workspace-root="chat" :class="{ 'chat-collaboration': coCreate, 'canvas-collaboration': coCreate, 'chat-panel-collapsed': coCreate && !layout.trayHeld.value, 'chat-panel-compact': stageCovered, 'chat-drawer-open': coCreate && shell.chat.sidebarOpen, 'canvas-sheet': sheetMode }" :data-sheet-pane="sheetMode ? layout.shownPanel.value || undefined : undefined" :data-detent="sheetMode ? layout.detent.value : undefined" :style="coCreate ? { '--canvas-ask-width': `${layout.ratio.value * 100}%` } : undefined" :inert="askFullscreen || !!photopea.task.value">
    <header class="topbar" :hidden="coCreate">
      <Teleport :to="navFloat || 'body'" :disabled="!coCreate || !navFloat"><WorkspaceSwitch workspace="chat" :compact="coCreate" /></Teleport><button
        class="ibtn rail-toggle"
        type="button"
        :aria-label="shell.chat.railCollapsed ? '展开侧栏' : '收起侧栏'"
        :aria-expanded="!shell.chat.railCollapsed"
        aria-controls="conversationList"
        @click="rail"
      >
        <AppIcon name="i-sidebar" />
      </button>
      <div class="topbar-menu">
        <div class="topbar-end" role="group" aria-label="工具"><WorkspaceEvolutionEntry v-if="!coCreate" :available="evolutionAvailable" /></div>
      </div>
      <Teleport :to="accountFloat || 'body'" :disabled="!coCreate || !accountFloat"><div class="topbar-account">
        <WalletDisplay :quota="view.quota" :model="view.model" /><ThemeToggle />
      </div></Teleport>
    </header>
    <div ref="chatLayout" class="chat-layout canvas-sheet-host">
      <Transition name="chat-backdrop">
      <button
        v-show="coCreate && shell.chat.sidebarOpen"
        class="chat-sidebar-backdrop"
        type="button"
        aria-label="关闭侧栏"
        @click="closeSidebar"
      ></button>
      </Transition>
      <aside class="chat-sidebar" id="chatSidebar" aria-label="会话与工具">
        <div class="sidebar-actions">
          <button
            class="sidebar-row"
            type="button"
            aria-label="新对话"
            :aria-current="c.turns.length ? undefined : 'page'"
            @click="newConversation"
          >
            <AppIcon name="i-compose" /><span>新对话</span>
          </button>
          <div v-if="searching" class="sidebar-search">
            <AppIcon name="i-search" /><input
              ref="search"
              v-model="query"
              type="search"
              placeholder="搜索对话"
              aria-label="搜索对话"
              aria-controls="conversationList"
              enterkeyhint="search"
              autocomplete="off"
              @keydown="searchKey"
              @blur="query.trim() || endSearch()"
            />
          </div>
          <button
            v-else
            ref="searchRow"
            class="sidebar-row"
            type="button"
            aria-label="搜索对话"
            aria-controls="conversationList"
            @click="startSearch"
          >
            <AppIcon name="i-search" /><span>搜索对话</span>
          </button>
        </div>
        <ConversationList :query="query" />
      </aside>
      <main
        class="chat-workspace"
        :inert="(coCreate && shell.chat.sidebarOpen) || stageCovered"
        :data-empty="!c.turns.length"
        :data-receded="stageCovered || undefined"
      >
        <header v-show="coCreate" class="chat-canvas-head canvas-recede-hide">
          <div ref="navFloat" class="chat-canvas-nav"></div>
          <button ref="menu" class="chat-canvas-conversation" type="button" aria-label="打开会话列表" aria-controls="chatSidebar" :aria-expanded="shell.chat.sidebarOpen" @click="shell.chat.sidebarOpen = !shell.chat.sidebarOpen">
            <AppIcon name="i-sidebar" /><span>{{ c.turns.length ? c.title : "新对话" }}</span>
          </button>
          <div class="chat-canvas-evolution"><BoardRetrospectEntry v-if="coCreate" /></div>
          <PopoverMenu id="chatCanvasOptions" label="对话画布选项" side="right" compact menu-class="canvas-options-menu" pointer-focus="menu">
            <template #trigger="{ open, toggle }"><button class="ibtn chat-canvas-options" type="button" aria-label="对话画布选项" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
            <template #default="{ close }">
              <button v-if="!activeEvolution && evolutionAvailable" class="menu-item" type="button" role="menuitem" @click="close(); ask.startEvolution()"><AppIcon name="i-branch" /><span class="menu-label">请 ASK 发起演进</span></button>
              <div ref="accountFloat" class="chat-canvas-account"></div>
            </template>
          </PopoverMenu>
          <div ref="switchHome" class="chat-switch-home"></div>
        </header>
        <div
          ref="scroll"
          class="chat-scroll"
          :class="{ 'canvas-recede': coCreate }"
          id="chatScroll"
          tabindex="0"
          aria-label="绘图消息"
          @scroll="latest = !near()"
        >
          <div class="chat-empty" :hidden="!!c.turns.length">
            <h1 class="chat-lock" aria-label="Koma Chat">
              <WaveMark class="chat-mark" surface="chat" /><span
                class="chat-word"
                ><span class="brand-title">Koma</span
                ><span class="brand-subtitle">CHAT</span></span
              >
            </h1>
          </div>
          <div class="message-list" id="messageList">
            <ChatTurn
              v-for="(t, i) in c.turns"
              :key="t.id"
              :turn="t"
              :number="i + 1"
              :older="i < latestResult"
              @view="show"
            />
          </div>
        </div>
        <button
          class="ibtn latest-button"
          :class="{ 'canvas-recede-hide': coCreate }"
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
        ><button v-if="sheetMode" class="canvas-sheet-grip chat-composer-grip" type="button" data-sheet-grip aria-label="展开对话面板" title="上拉展开" @click="canvasSheet.tap()"></button>
          <AnnotationCard v-if="c.pendingAnnotation" inline :regions="c.pendingAnnotation.snapshot.regions" :references="c.pendingAnnotation.snapshot.references" :preview="chat.assets.assets.get(c.pendingAnnotation.guideAssetId)?.url" :single-image="c.pendingAnnotation.singleImage" :markup="!!c.pendingAnnotation.markup" :markup-eligible="view.model?.markupEligible" :disabled="!!view.busy || !!view.uploading" @comment="chat.annotationComment" @mode="chat.annotationTextOnly" @markup="chat.annotationMarkup()" @remove="chat.clearAnnotations()" />
          <div class="chat-attachments" aria-label="本轮图片">
            <div
              v-for="id in c.attachments.filter(id => id !== c.pendingAnnotation?.guideAssetId)"
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
              :aria-expanded="contextExpanded"
              :class="{ 'has-overflow': view.context.dropped.length }"
              :data-overflow="view.context.dropped.length || ''"
              @click="toggleContext"
            >
              <AppIcon name="i-layers" /><span>{{
                view.context.turnIds.length
              }}</span
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
              aria-haspopup="dialog"
              :aria-expanded="openPanel === 'param'"
              @click="openPop(paramPop, $event)"
            >
              <AppIcon class="solid" name="i-parameters" /><span
                class="param-summary"
                >{{ summary }}</span
              ></button
            ><button v-if="sheetMode" class="ibtn chat-sheet-ask" type="button" aria-label="打开 ASK" title="ASK" @click="selectPanel('ask')"><AppIcon name="i-ask" /></button
            ><span class="composer-end"
              ><span
                v-if="view.quote && view.quote.cost > 0 && !view.busy"
                class="quote-cost"
                >{{ quoteLabel(view.quote) }}</span
              ><button
                class="model-chip"
                type="button"
                :aria-label="`模型：${view.model?.name || '未配置连接'}`"
                aria-haspopup="dialog"
                :aria-expanded="openPanel === 'model'"
                @click="openPop(modelPop, $event)"
              >
                <span class="model-chip-name">{{
                  view.model?.name || "未配置连接"
                }}</span
                ><AppIcon class="model-chip-caret" name="i-chevron" /></button
              ><span class="send-slot"
                ><button
                  class="btn btn-primary chat-send"
                  type="submit"
                  aria-label="发送绘图请求"
                  :hidden="!!view.busy"
                  :disabled="
                    !view.ready ||
                    !!view.busy ||
                    !!view.uploading ||
                    (!c.prompt.trim() && !c.pendingAnnotation)
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
                  <AppIcon name="i-stop" /></button></span
            ></span>
          </div>
          <span class="sr-only" role="status">{{
            view.busy?.phase || (view.uploading ? "读取图片中" : "")
          }}</span>
        </form>
        <div
          v-if="!c.turns.length"
          class="chat-starters"
          :class="{ 'canvas-recede-hide': coCreate }"
          role="group"
          aria-label="开始方式"
          :data-quiet="!!c.prompt.trim() || !!c.attachments.length || undefined"
        >
          <button class="chat-starter" type="button" @click="upload?.click()">
            <AppIcon name="i-image-plus" />上传图片修改</button
          ><button
            v-for="s in starters"
            :key="s.label"
            class="chat-starter"
            type="button"
            :title="s.prompt"
            @click="fillPrompt(s.prompt)"
          >
            <AppIcon name="i-brush" />{{ s.label }}
          </button>
        </div>
      </main>
      <div v-show="coCreate && layout.panel.value && !layout.compact.value" ref="canvasSplitter" class="chat-canvas-splitter" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整对话侧栏宽度" aria-valuemin="25" aria-valuemax="45" :aria-valuenow="Math.round(layout.ratio.value * 100)"></div>
      <Transition name="canvas-tray" :css="layout.trayMotion.value" :duration="layout.trayDuration.value" @after-leave="layout.settleTray()">
      <aside v-show="coCreate && layout.panel.value" ref="sheet" class="chat-canvas-sidebar canvas-sheet-tray" aria-label="对话创作侧栏">
        <header v-show="layout.compact.value" class="chat-sidebar-head canvas-tray-head" :class="{ 'is-folded': layout.headFolded.value && !sheetMode }"><button v-if="sheetMode" class="canvas-sheet-grip" type="button" data-sheet-grip :aria-label="layout.detent.value === 'half' ? '展开到全屏' : '收回半屏'" title="拖动调整高度" @click="canvasSheet.tap()"></button><div class="canvas-sheet-actions"><button class="ibtn" type="button" aria-label="收起对话面板" @click="layout.panel.value = null"><AppIcon name="i-close" /></button><button class="ibtn canvas-fold" type="button" aria-label="收起顶栏" @click="layout.toggleHead($event)"><AppIcon name="i-chevron" /></button></div><div ref="switchSide"></div><button v-show="layout.headFolded.value" class="canvas-head-handle" type="button" aria-label="展开顶栏" @click="layout.toggleHead($event)"></button></header>
        <div class="chat-sidebar-content canvas-sheet-content" :data-pane-motion="layout.paneMotion.value || undefined">
          <div ref="askHost" class="chat-canvas-ask canvas-sheet-ask" @focusin="canvasSheet.focus"></div>
          <div ref="contextHost" v-show="contextShown" class="chat-canvas-context"></div>
        </div>
      </aside>
      </Transition>
      <Teleport :to="contextTarget || 'body'" :disabled="!contextTarget"><ContextPanel ref="context" :embedded="coCreate" :open="contextShown" @view="show" @close="layout.panel.value = null" /></Teleport>
    </div>
  </div>
  <Teleport :to="switchTarget || 'body'" :disabled="!switchTarget"><CanvasPanelSwitch v-show="switchShown" label="对话侧栏内容" :options="panelOptions" :selected="layout.panel.value" @select="selectPanel($event as 'ask' | 'context')" /></Teleport>
  <Teleport to="body"
    ><dialog ref="lightbox" class="chat-lightbox" @close="full = ''">
      <button
        class="ibtn"
        type="button"
        aria-label="关闭图片"
        @click="lightbox?.close()"
      >
        <AppIcon name="i-close" /></button
      ><img v-if="full" :src="full" alt="生成图片大图" /><button class="btn chat-annotate" @click="annotate"><AppIcon name="i-annotate" />批注</button>
    </dialog>
    <div
      ref="modelPop"
      class="menu editor-pop chat-pop model-panel"
      :class="{ 'canvas-collaboration': coCreate }"
      popover
      role="dialog"
      aria-label="模型"
      @toggle="panelToggled('model', $event as ToggleEvent)"
    >
      <div class="editor-pop-list" role="radiogroup" aria-label="模型">
        <div
          v-for="g in groups"
          :key="g.provider"
          class="editor-pop-group"
          role="group"
          :aria-label="g.provider"
        >
          <p class="menu-group model-group-head">
            <ModelIcon :family="g.provider" /><span>{{
              g.provider === "openai"
                ? "OpenAI"
                : g.provider === "gemini"
                  ? "Gemini"
                  : g.provider === "seedream" ? "Seedream" : g.provider
            }}</span>
          </p>
          <label
            v-for="m in g.models"
            :key="m.id"
            class="menu-item editor-pop-item"
            :title="m.sourceName ? `${m.name}\n当前参数来源：${m.sourceName}。生成时自动选择兼容来源。` : m.name"
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
            /><span class="menu-label">{{ m.name }}</span>
            <AppIcon class="menu-check" name="i-check" />
            <span v-if="m.sourceName" class="chip model-source">{{ m.sourceName }}</span>
            </label
          >
        </div>
      </div>
      <div class="model-panel-foot">
        <button
          class="menu-item model-manage"
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
      class="menu editor-pop chat-pop param-panel"
      :class="{ 'canvas-collaboration': coCreate }"
      popover
      role="dialog"
      aria-label="参数"
      @toggle="panelToggled('param', $event as ToggleEvent)"
    >
      <div class="param-rows">
        <div
          v-for="(field, key) in view.model?.fields"
          :key="key"
          class="param-row"
          :role="field.options.length && !field.allowCustom && field.type !== 'number' ? 'radiogroup' : undefined"
          :aria-label="chatOptionNames[key] || key"
        >
          <label class="param-name" :for="`chatOption-${key}`">{{ field.label || chatOptionNames[key] || key }}</label>
          <div v-if="field.options.length && !field.allowCustom && field.type !== 'number'" class="param-chips">
            <label
              v-for="value in field.options"
              :key="value"
              class="param-chip"
              ><input
                type="radio"
                :name="`chatOption-${key}`"
                :checked="options[key] === value"
                @change="chat.setOption(key, value)"
              /><span>{{ field.type === 'boolean' ? value === 'true' ? '开启' : '关闭' : chatOptionLabel(value, key) }}</span></label
            >
          </div>
          <ModelParameterInput v-else :id="`chatOption-${key}`" :field="field" :value="options[key]" :format="value => chatOptionLabel(value, key)" :disabled="!!view.busy" @change="chat.setOption(key, $event)" />
        </div>
      </div>
    </div></Teleport
  >
</template>

<style scoped src="../../shared/canvas-motion.css"></style>
<style scoped src="../../shared/canvas-surface.css"></style>
<style scoped src="../../shared/canvas-sheet.css"></style>
<style scoped src="./chat-canvas.css"></style>
<style scoped>
.chat-lightbox .chat-annotate { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); }
</style>
