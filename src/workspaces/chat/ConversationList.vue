<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  shallowRef,
  watch,
  onDeactivated,
  onBeforeUnmount,
} from "vue";
import { useChat } from "../../app/chat";
import { useShell } from "../../app/shell";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import type { ConversationRecord, ConversationSource } from "../../storage/records";
import {
  conversationPeriod,
  coverImage,
  isBlank,
  matchesQuery,
} from "../../domain/conversation";
import type { ConversationPeriod } from "../../domain/conversation";
import { placeMenu, menuKeys } from "../../shared/popover";
import AppIcon from "../../shared/AppIcon.vue";
import AiNameButton from "../../shared/AiNameButton.vue";
import ChatImage from "./ChatImage.vue";
const props = defineProps<{ query: string }>();
const { chat, view } = useChat(),
  shell = useShell();
const periods: Record<ConversationPeriod, string> = {
  today: "今天",
  yesterday: "昨天",
  week: "7 天内",
  earlier: "更早",
};
const collapsed = shallowRef(new Set<string>());
type RelatedKind = ConversationSource["kind"];
const relatedKinds = ["fork", "image"] as const;
const relatedLabels: Record<RelatedKind, string> = { fork: "分支", image: "子区" };
const relatedIcons: Record<RelatedKind, string> = { fork: "i-branch", image: "i-image" };
interface ConversationRow {
  c: ConversationRecord;
  title: string;
  category?: RelatedKind;
  cover?: string;
  depth: number;
  related?: RelatedKind;
  expandable: boolean;
  expanded: boolean;
}
function toggleChildren(id: string) {
  const next = new Set(collapsed.value);
  if (!next.delete(id)) next.add(id);
  collapsed.value = next;
}
watch(() => view.value.current.id, () => {
  const next = new Set(collapsed.value), seen = new Set<string>();
  const records = new Map(view.value.conversations.map((record) => [record.id, record]));
  let source = view.value.current.source;
  while (source && !seen.has(source.conversationId)) {
    const parent = source.conversationId;
    seen.add(parent);
    next.delete(parent);
    source = records.get(parent)?.source;
  }
  collapsed.value = next;
});
const families = computed(() => {
  const { conversations, current } = view.value,
    now = Date.now();
  const listed = conversations.filter((c) => !isBlank(c) && (c.source || c.id !== current.id || c.turns.length));
  const byId = new Map(listed.map((c) => [c.id, c]));
  const parents = new Map<string, string>(), children = new Map<string, Record<RelatedKind, ConversationRecord[]>>();
  for (const c of listed) if (c.source && byId.has(c.source.conversationId)) {
    const parent = c.source.conversationId;
    const siblings = children.get(parent) ?? { fork: [], image: [] };
    siblings[c.source.kind].push(c);
    children.set(parent, siblings);
    parents.set(c.id, parent);
  }
  const searching = !!props.query.trim();
  const matches = new Set(listed.filter((c) => matchesQuery(c, props.query)).map((c) => c.id));
  for (const id of matches) {
    const parent = parents.get(id);
    if (parent) matches.add(parent);
  }
  const visible: { id: string; group: string; rows: ConversationRow[] }[] = [];
  const visited = new Set<string>();
  function append(rows: ConversationRow[], c: ConversationRecord, depth: number, show: boolean, category?: RelatedKind) {
    if (visited.has(c.id)) return;
    visited.add(c.id);
    const related = children.get(c.id);
    const expanded = searching || !collapsed.value.has(c.id);
    if (show && matches.has(c.id)) {
      const cover = depth ? undefined : coverImage(c) ?? c.source?.assetId;
      const kind = depth ? c.source?.kind : undefined;
      const title = kind === "fork" ? c.title.replace(/（分支）$/, "") : c.title;
      rows.push({ c, title, category, depth, related: kind, expandable: !searching && !!related, expanded,
        cover: cover && chat.assets.assets.has(cover) ? cover : undefined });
    }
    if (related) for (const kind of relatedKinds) {
      let heading: RelatedKind | undefined = kind;
      for (const child of related[kind]) {
        const count = rows.length;
        append(rows, child, depth + 1, show && expanded, heading);
        if (rows.length !== count) heading = undefined;
      }
    }
  }
  function root(c: ConversationRecord) {
    if (visited.has(c.id)) return;
    const rows: ConversationRow[] = [];
    append(rows, c, 0, true);
    if (rows.length) visible.push({ id: c.id, group: c.pinned ? "置顶" : periods[conversationPeriod(c.updatedAt, now)], rows });
  }
  for (const c of listed) if (!parents.has(c.id)) root(c);
  for (const c of listed) root(c);
  return visible;
});
const menu = shallowRef<HTMLElement | null>(null),
  target = shallowRef<ConversationRecord | null>(null),
  renaming = ref(""),
  name = ref(""),
  menuOpen = ref(false);
let hold: ReturnType<typeof setTimeout> | undefined,
  origin = { x: 0, y: 0 },
  suppress = 0,
  anchor: HTMLElement | null = null;
function cancelHold() {
  clearTimeout(hold);
}
function open(c: ConversationRecord, e: MouseEvent) {
  e.preventDefault();
  target.value = c;
  anchor = e.currentTarget as HTMLElement;
  menu.value?.showPopover();
  placeMenu(
    menu.value!,
    e.type === "contextmenu" && (e.clientX || e.clientY)
      ? { x: e.clientX, y: e.clientY }
      : anchor.getBoundingClientRect(),
  );
  menu.value?.querySelector("button")?.focus();
}
function close(focus = false) {
  menu.value?.hidePopover();
  if (focus) anchor?.focus();
}
function focusRow(id: string, more = false) {
  const row = [
    ...document.querySelectorAll<HTMLElement>(".conversation-item"),
  ].find((item) => item.dataset.id === id);
  row
    ?.querySelector<HTMLButtonElement>(
      more ? ".conversation-more" : ".conversation-open",
    )
    ?.focus();
}
function down(c: ConversationRecord, e: PointerEvent) {
  if (e.pointerType === "mouse" || renaming.value) return;
  origin = { x: e.clientX, y: e.clientY };
  cancelHold();
  const el = e.currentTarget as HTMLElement;
  hold = setTimeout(() => {
    suppress = performance.now() + 1000;
    target.value = c;
    anchor = el;
    menu.value?.showPopover();
    placeMenu(menu.value!, el.getBoundingClientRect());
  }, 500);
}
function move(e: PointerEvent) {
  if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) cancelHold();
}
function pick(c: ConversationRecord) {
  if (performance.now() < suppress) return;
  chat.switchConversation(c);
  shell.chat.sidebarOpen = false;
}
async function act(kind: string) {
  const c = target.value;
  if (!c) return;
  close();
  if (kind === "rename") {
    renaming.value = c.id;
    name.value = c.title;
    await nextTick();
    const field = document.querySelector<HTMLInputElement>(
      ".conversation-rename",
    );
    field?.focus();
    field?.select();
  } else if (kind === "pin") chat.pin(c);
  else if (kind === "duplicate") chat.duplicate(c);
  else await chat.remove(c);
  if (kind !== "rename") {
    await nextTick();
    focusRow(
      kind === "pin" ? c.id : view.value.current.id,
      kind === "pin" && !!anchor?.classList.contains("conversation-more"),
    );
  }
}
function finish(c: ConversationRecord, save = true, refocus = false) {
  if (renaming.value !== c.id) return;
  if (save) chat.rename(c, name.value);
  renaming.value = "";
  if (refocus) void nextTick(() => focusRow(c.id));
}
const life = useWorkspaceLifecycle("chat");
life.whileActive((signal) => {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        menu.value?.matches(":popover-open") &&
        !menu.value.contains(e.target as Node)
      )
        close();
    },
    { capture: true, signal },
  );
  window.addEventListener("resize", () => close(), { signal });
});
onDeactivated(() => {
  close();
  cancelHold();
});
onBeforeUnmount(cancelHold);
</script>
<template>
  <nav
    id="conversationList"
    class="conversation-list"
    aria-label="会话列表"
    @scroll="close()"
  >
    <template v-for="({ id, group, rows }, index) in families" :key="id">
      <h2 v-if="group !== families[index - 1]?.group" class="conversation-group">{{ group }}</h2>
      <div class="conversation-family" :data-expanded="rows.length > 1 || undefined">
        <template v-for="{ c, title, category, cover, depth, related, expandable, expanded } in rows" :key="c.id">
          <h3 v-if="category" class="conversation-category" :style="{ '--conversation-indent': `${Math.min(depth - 1, 3) * 12}px` }">{{ relatedLabels[category] }}</h3>
          <div
            class="conversation-item"
            :data-id="c.id"
            :data-current="c.id === view.current.id || undefined"
            :data-busy="view.busy?.cId === c.id || undefined"
            :data-renaming="renaming === c.id || undefined"
            :data-related="related"
            :data-related-depth="depth || undefined"
            :style="depth > 1 ? { '--conversation-indent': `${Math.min(depth - 1, 3) * 12}px` } : undefined"
            @contextmenu="open(c, $event)"
            @pointerdown="down(c, $event)"
            @pointermove="move"
            @pointerup="cancelHold"
            @pointercancel="cancelHold"
            @pointerleave="cancelHold"
          >
            <span v-if="related" class="conversation-related-icon" aria-hidden="true"><AppIcon :name="relatedIcons[related]" /></span>
            <span v-else class="conversation-thumb" aria-hidden="true">
              <ChatImage v-if="cover" :asset-id="cover" alt="" width="26" height="26" />
              <AppIcon v-else name="i-image" />
            </span>
            <input
              v-if="renaming === c.id"
              v-model="name"
              class="conversation-rename"
              maxlength="60"
              enterkeyhint="done"
              aria-label="对话名称"
              @blur="finish(c)"
              @keydown="
                (e) => {
                  if (e.isComposing) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    finish(c, true, true);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(c, false, true);
                  }
                }
              "
            />
            <button
              v-else
              type="button"
              class="conversation-open"
              :title="c.title"
              :aria-label="related ? `${title}，${relatedLabels[related]}` : undefined"
              :aria-current="c.id === view.current.id ? 'page' : undefined"
              @click="pick(c)"
            >
              <span class="conversation-title">{{ title }}</span>
              <span v-if="view.busy?.cId === c.id" class="sr-only">，生成中</span>
            </button>
            <button v-if="expandable" type="button" class="ibtn conversation-children-toggle" :aria-expanded="expanded"
              :aria-label="`${expanded ? '折叠' : '展开'}关联会话：${c.title}`" @pointerdown.stop @click="toggleChildren(c.id)">
              <AppIcon name="i-chevron" />
            </button>
            <span v-if="view.busy?.cId === c.id" class="conversation-busy" aria-hidden="true"></span>
            <button type="button" class="ibtn ibtn-xs conversation-more" :aria-label="`对话选项：${c.title}`"
              aria-haspopup="menu" :aria-expanded="menuOpen && target?.id === c.id" @click="open(c, $event)">
              <AppIcon name="i-more" />
            </button>
          </div>
        </template>
      </div>
    </template>
    <p v-if="query.trim() && !families.length" class="conversation-empty">
      没有匹配的对话
    </p>
  </nav>
  <Teleport to="body"
    ><div
      ref="menu"
      class="menu conv-menu"
      popover="manual"
      role="menu"
      aria-label="对话选项"
      @toggle="menuOpen = ($event as ToggleEvent).newState === 'open'"
      @keydown="menuKeys"
      @keydown.esc.stop.prevent="close(true)"
      @keydown.tab.prevent="close(true)"
    >
      <button class="menu-item" type="button" role="menuitem" @click="act('rename')">
        <AppIcon name="i-rename" /><span>重命名</span></button
      >
      <AiNameButton v-if="target" kind="chat" :id="target.id" menu @click="close(true)" />
      <button class="menu-item" type="button" role="menuitem" @click="act('pin')">
        <AppIcon name="i-pin" /><span>{{
          target?.pinned ? "取消置顶" : "置顶"
        }}</span></button
      ><button
        class="menu-item"
        type="button"
        role="menuitem"
        :disabled="view.busy?.cId === target?.id"
        @click="act('duplicate')"
      >
        <AppIcon name="i-copy" /><span>复制为新对话</span>
      </button>
      <hr role="separator" />
      <button
        class="menu-item danger"
        type="button"
        role="menuitem"
        @click="act('delete')"
      >
        <AppIcon name="i-trash" /><span>删除</span>
      </button>
    </div></Teleport
  >
</template>
