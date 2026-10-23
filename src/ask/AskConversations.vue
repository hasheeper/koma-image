<script setup lang="ts">
import { nextTick, shallowRef } from "vue";
import { useAsk } from "../app/ask";
import { useUi } from "../app/ui";
import AppIcon from "../shared/AppIcon.vue";
import AiNameButton from "../shared/AiNameButton.vue";
import AskMenu from "./AskMenu.vue";
import { CONVERSATION_LIMIT } from "./conversations.ts";

/** The title dropdown: temporary conversations and locally saved favorites. */
const emit = defineEmits<{ chosen: [] }>();
const ask = useAsk(), ui = useUi();
const list = shallowRef<HTMLElement | null>(null);
const renaming = shallowRef(false), name = shallowRef(""), nameInput = shallowRef<HTMLInputElement | null>(null);
async function rename() {
  confirming.value = "";
  name.value = ask.heading.value.title; renaming.value = true;
  await nextTick(); nameInput.value?.focus(); nameInput.value?.select();
}
function saveName(close: () => void) {
  ask.renameConversation(ask.conversationId.value, name.value);
  close();
}
function nameKeys(event: KeyboardEvent) {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.stopPropagation();
  if (event.key === "Enter" && event.isComposing) event.preventDefault();
}
// Delete takes a second click on the same row; anything else cancels it.
const confirming = shallowRef("");
const cancel = () => {
  if (renaming.value) { renaming.value = false; return true; }
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
  await ask.deleteConversation(id);
  await nextTick();
  const items = list.value?.querySelectorAll<HTMLButtonElement>(".ask-menu-item");
  items?.[Math.min(at, items.length - 1)]?.focus({ preventScroll: true });
}
function left(event: PointerEvent) {
  if (event.pointerType === "mouse") confirming.value = "";
}
function blurred(event: FocusEvent) {
  const row = event.currentTarget as HTMLElement;
  if (!row.contains(event.relatedTarget as Node | null) && document.hasFocus()) confirming.value = "";
}
</script>
<template>
  <AskMenu id="askConvMenu" label="对话" side="left" :escape="cancel" @closed="confirming = ''; renaming = false">
    <template #trigger="{ open, toggle }">
      <button class="ask-conv" type="button" aria-haspopup="menu" :aria-expanded="open" aria-controls="askConvMenu" :title="ask.heading.value.title" @click="toggle">
        <AppIcon v-if="ask.heading.value.favorite || ask.heading.value.fork" :name="ask.heading.value.favorite ? 'i-star' : 'i-branch'" class="ask-conv-fork" :class="{ starred: ask.heading.value.favorite }" />
        <span class="ask-conv-title">{{ ask.heading.value.title }}</span>
        <AppIcon name="i-chevron" class="ask-conv-chev" />
      </button>
    </template>
    <template #default="{ close }">
      <button class="ask-menu-item" type="button" role="menuitem" :disabled="!ask.canManage.value" @click="fresh(close)"><AppIcon name="i-plus" /><span class="ask-menu-label">新对话</span></button>
      <form v-if="renaming" class="ask-conv-rename" @submit.prevent="saveName(close)" @keydown.tab.stop><input ref="nameInput" v-model="name" type="text" maxlength="60" aria-label="对话名称" @keydown="nameKeys" /><button class="btn btn-sm" type="submit" :disabled="!name.trim()">保存</button></form>
      <button v-else class="ask-menu-item" type="button" role="menuitem" :disabled="!ask.canManage.value" @click="rename"><AppIcon name="i-edit" /><span class="ask-menu-label">重命名</span></button>
      <button class="ask-menu-item" type="button" role="menuitemcheckbox" :aria-checked="ask.heading.value.favorite" :aria-busy="ask.favoriteBusy.value" :disabled="!ask.canManage.value || !!ask.preparing.value" @click="confirming = ''; ask.toggleFavorite()"><AppIcon name="i-star" :class="{ starred: ask.heading.value.favorite }" /><span class="ask-menu-label">{{ ask.heading.value.favorite ? '取消收藏' : '收藏会话' }}</span><AppIcon name="i-check" class="ask-menu-check" /></button>
      <hr role="separator" />
      <div ref="list" class="ask-conv-list" role="group" aria-label="ASK 对话">
        <div v-for="(c, i) in ask.conversations.value" :key="c.id" class="ask-conv-row" :class="{ confirming: confirming === c.id }" @pointerleave="left" @focusout="blurred">
          <button class="ask-menu-item" type="button" role="menuitemradio" :aria-checked="c.id === ask.conversationId.value" :disabled="!ask.canManage.value && c.id !== ask.conversationId.value" @click="choose(c.id, close)"><AppIcon :name="c.favorite ? 'i-star' : c.fork ? 'i-branch' : 'i-chat'" :class="{ starred: c.favorite }" /><span class="ask-menu-label">{{ c.title }}</span><AppIcon name="i-check" class="ask-menu-check" /></button>
          <button class="ask-conv-del" type="button" :aria-label="confirming === c.id ? `确认删除 ${c.title}` : `删除 ${c.title}`" :title="confirming === c.id ? '再点一次删除' : '删除'" :disabled="!ask.canManage.value" @click="remove(c.id, i)"><template v-if="confirming === c.id">删除</template><AppIcon v-else name="i-close" /></button>
        </div>
      </div>
      <p class="ask-conv-note">收藏保留，其余刷新后清空</p>
    </template>
  </AskMenu>
  <AiNameButton kind="conversation" :id="ask.conversationId.value" :disabled="ask.running.value" />
</template>
<style scoped>
.ask-conv { display: flex; align-items: center; gap: 6px; min-width: 0; height: 30px; margin-left: 4px; padding: 0 8px; color: var(--fg-2); font-size: 13px; font-weight: var(--fw-medium); border-radius: 8px; }
.ask-conv:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--ask-hover); }
.ask-conv-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-conv .ico { flex: none; color: var(--fg-3); }
.ask-conv .starred, .ask-menu-item .ico.starred { color: var(--a); fill: var(--a); }
.ask-conv-fork { width: 14px; height: 14px; }
.ask-conv-chev { width: 12px; height: 12px; transform: rotate(90deg); }
.ask-conv-list { display: flex; flex: 0 1 auto; flex-direction: column; gap: 1px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.ask-conv-rename { display: flex; gap: 6px; padding: 4px 6px; }
.ask-conv-rename input { width: 100%; min-width: 0; height: 30px; }
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
