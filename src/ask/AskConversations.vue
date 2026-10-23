<script setup lang="ts">
import { nextTick, shallowRef } from "vue";
import { useAsk } from "../app/ask";
import { useUi } from "../app/ui";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "./AskMenu.vue";
import { CONVERSATION_LIMIT } from "./conversations.ts";

/** The title dropdown: new, switch and delete; page memory only. */
const emit = defineEmits<{ chosen: [] }>();
const ask = useAsk(), ui = useUi();
const list = shallowRef<HTMLElement | null>(null);
// Delete takes a second click on the same row; anything else cancels it.
const confirming = shallowRef("");
const cancel = () => {
  if (!confirming.value) return false;
  confirming.value = "";
  return true;
};
function fresh(close: () => void) {
  const result = ask.newConversation();
  if (result === "limit") return ui.toast(`最多 ${CONVERSATION_LIMIT} 个对话`, "err");
  close();
  if (result) emit("chosen");
}
function choose(id: string, close: () => void) {
  ask.selectConversation(id);
  close();
  emit("chosen");
}
async function remove(id: string, at: number) {
  if (confirming.value !== id) return void (confirming.value = id);
  confirming.value = "";
  ask.deleteConversation(id);
  await nextTick();
  const items = list.value?.querySelectorAll<HTMLButtonElement>(".ask-menu-item");
  items?.[Math.min(at, items.length - 1)]?.focus({ preventScroll: true });
}
function left(event: PointerEvent) {
  if (event.pointerType === "mouse") cancel();
}
function blurred(event: FocusEvent) {
  const row = event.currentTarget as HTMLElement;
  if (!row.contains(event.relatedTarget as Node | null) && document.hasFocus()) cancel();
}
</script>
<template>
  <AskMenu id="askConvMenu" label="对话" side="left" :escape="cancel" @closed="confirming = ''">
    <template #trigger="{ open, toggle }">
      <button class="ask-conv" type="button" aria-haspopup="menu" :aria-expanded="open" aria-controls="askConvMenu" :title="ask.heading.value.title" @click="toggle">
        <AppIcon v-if="ask.heading.value.fork" name="i-branch" class="ask-conv-fork" />
        <span class="ask-conv-title">{{ ask.heading.value.title }}</span>
        <AppIcon name="i-chevron" class="ask-conv-chev" />
      </button>
    </template>
    <template #default="{ close }">
      <button class="ask-menu-item" type="button" role="menuitem" :disabled="!ask.canManage.value" @click="fresh(close)"><AppIcon name="i-plus" /><span class="ask-menu-label">新对话</span></button>
      <hr role="separator" />
      <div ref="list" class="ask-conv-list" role="group" aria-label="本页对话">
        <div v-for="(c, i) in ask.conversations.value" :key="c.id" class="ask-conv-row" :class="{ confirming: confirming === c.id }" @pointerleave="left" @focusout="blurred">
          <button class="ask-menu-item" type="button" role="menuitemradio" :aria-checked="c.id === ask.conversationId.value" :disabled="!ask.canManage.value && c.id !== ask.conversationId.value" @click="choose(c.id, close)"><AppIcon :name="c.fork ? 'i-branch' : 'i-chat'" /><span class="ask-menu-label">{{ c.title }}</span><AppIcon name="i-check" class="ask-menu-check" /></button>
          <button class="ask-conv-del" type="button" :aria-label="confirming === c.id ? `确认删除 ${c.title}` : `删除 ${c.title}`" :title="confirming === c.id ? '再点一次删除' : '删除'" :disabled="!ask.canManage.value" @click="remove(c.id, i)"><template v-if="confirming === c.id">删除</template><AppIcon v-else name="i-close" /></button>
        </div>
      </div>
      <p class="ask-conv-note">只保留本页对话，刷新后清空</p>
    </template>
  </AskMenu>
</template>
<style scoped>
.ask-conv { display: flex; align-items: center; gap: 6px; min-width: 0; height: 30px; margin-left: 4px; padding: 0 8px; color: var(--fg-2); font-size: 13px; font-weight: var(--fw-medium); border-radius: 8px; }
.ask-conv:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--ask-hover); }
.ask-conv-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-conv .ico { flex: none; color: var(--fg-3); }
.ask-conv-fork { width: 14px; height: 14px; }
.ask-conv-chev { width: 12px; height: 12px; transform: rotate(90deg); }
.ask-conv-list { display: flex; flex: 0 1 auto; flex-direction: column; gap: 1px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.ask-conv-row { position: relative; display: flex; flex: none; }
.ask-conv-row > .ask-menu-item { flex: 1; }
/* Keep B v5's right-aligned check column; delete occupies that slot on hover. */
@media (hover: hover) { .ask-conv-row:is(:hover, :focus-within):has(.ask-conv-del:not(:disabled)) > .ask-menu-item[aria-checked] .ask-menu-check { visibility: hidden; } }
.ask-conv-del { position: absolute; top: 50%; right: 6px; display: grid; place-items: center; min-width: 24px; height: 24px; padding: 0 4px; color: var(--fg-3); font-size: var(--fz-xs); border-radius: 6px; opacity: 0; transform: translateY(-50%); }
.ask-conv-del .ico { width: 13px; height: 13px; }
.ask-conv-row:is(:hover, :focus-within) .ask-conv-del, .ask-conv-del:focus-visible { opacity: 1; }
.ask-conv-del:hover:not(:disabled) { color: var(--fg); background: var(--ask-hover); }
.ask-conv-del:disabled { display: none; }
.ask-conv-row.confirming .ask-conv-del { padding: 0 8px; color: #fff; font-weight: var(--fw-semibold); background: var(--err); opacity: 1; }
.ask-conv-row.confirming > .ask-menu-item { padding-right: 60px; }
.ask-conv-note { flex: none; margin-top: 4px; padding: 7px 10px 4px; color: var(--fg-3); font-size: var(--fz-xs); border-top: 1px solid var(--line); }
/* Touch keeps both the selected check and an explicit delete target. */
@media (hover: none) {
  .ask-conv-del { opacity: 1; }
  .ask-conv-row > .ask-menu-item { padding-right: 42px; }
}
@media (max-width: 860px) { .ask-conv-del { right: 2px; min-width: 32px; height: 32px; } .ask-conv-row.confirming > .ask-menu-item { padding-right: 68px; } }
</style>
