<script setup lang="ts">
import { nextTick, ref, shallowRef, onDeactivated, onBeforeUnmount } from "vue";
import { useChat } from "../../app/chat";
import { useShell } from "../../app/shell";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import type { ConversationRecord } from "../../storage/records";
import { placeMenu, menuKeys } from "../../shared/popover";
import AppIcon from "../../shared/AppIcon.vue";
const { chat, view } = useChat(),
  shell = useShell();
const menu = shallowRef<HTMLElement | null>(null),
  target = shallowRef<ConversationRecord | null>(null),
  renaming = ref(""),
  name = ref("");
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
    <template v-for="(c, i) in view.conversations" :key="c.id">
      <h2 v-if="c.pinned && i === 0" class="conversation-group">置顶</h2>
      <h2
        v-if="!c.pinned && i > 0 && view.conversations[i - 1]?.pinned"
        class="conversation-group"
      >
        最近
      </h2>
      <div
        class="conversation-item"
        :data-id="c.id"
        :data-current="c.id === view.current.id || undefined"
        :data-busy="view.busy?.cId === c.id || undefined"
        :data-renaming="renaming === c.id || undefined"
        @contextmenu="open(c, $event)"
        @pointerdown="down(c, $event)"
        @pointermove="move"
        @pointerup="cancelHold"
        @pointercancel="cancelHold"
        @pointerleave="cancelHold"
      >
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
          :aria-current="c.id === view.current.id ? 'page' : undefined"
          @click="pick(c)"
        >
          {{ c.title
          }}<span v-if="view.busy?.cId === c.id" class="sr-only">，生成中</span>
        </button>
        <span
          v-if="view.busy?.cId === c.id"
          class="conversation-busy"
          aria-hidden="true"
        ></span>
        <button
          type="button"
          class="ibtn ibtn-xs conversation-more"
          :aria-label="`对话选项：${c.title}`"
          aria-haspopup="menu"
          @click="open(c, $event)"
        >
          <AppIcon name="i-more" />
        </button></div
    ></template>
  </nav>
  <Teleport to="body"
    ><div
      ref="menu"
      class="conv-menu"
      popover="manual"
      role="menu"
      aria-label="对话选项"
      @keydown="menuKeys"
      @keydown.esc.stop.prevent="close(true)"
      @keydown.tab.prevent="close(true)"
    >
      <button type="button" role="menuitem" @click="act('rename')">
        <AppIcon name="i-rename" /><span>重命名</span></button
      ><button type="button" role="menuitem" @click="act('pin')">
        <AppIcon name="i-pin" /><span>{{
          target?.pinned ? "取消置顶" : "置顶"
        }}</span></button
      ><button
        type="button"
        role="menuitem"
        :disabled="view.busy?.cId === target?.id"
        @click="act('duplicate')"
      >
        <AppIcon name="i-copy" /><span>复制为新对话</span>
      </button>
      <hr role="separator" />
      <button
        type="button"
        role="menuitem"
        class="danger"
        @click="act('delete')"
      >
        <AppIcon name="i-trash" /><span>删除</span>
      </button>
    </div></Teleport
  >
</template>
