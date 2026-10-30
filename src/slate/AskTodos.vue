<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask.ts";
import { useSlates } from "../app/slate.ts";
import { useDrawing } from "../app/drawing.ts";
import { useUi, message } from "../app/ui.ts";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "../ask/AskMenu.vue";
import SlateDeliverable from "./SlateDeliverable.vue";
import { parseSlateEdit } from "./edit.ts";
import { statusNames } from "./model.ts";
import type { Todo } from "./model.ts";
const ask = useAsk(), slates = useSlates(), { drawing } = useDrawing(), ui = useUi();
const slate = ask.activeSlate, expanded = shallowRef(false), finished = shallowRef(false);
const delivery = shallowRef<{ todo: Todo; complete: boolean } | null>(null);
const done = computed(() => slate.value?.todos.filter(t => t.status === 'done').length ?? 0);
const current = computed(() => slate.value?.todos.find(t => t.status === 'in_progress') ?? slate.value?.todos.find(t => t.status === 'todo'));
const completed = computed(() => slate.value?.todos.filter(t => t.status === 'done' || t.status === 'abandoned') ?? []);
const folding = computed(() => (slate.value?.todos.length ?? 0) > 6 && completed.value.length >= 2);
const rows = computed(() => (slate.value?.todos ?? []).filter(t => !folding.value || finished.value || t.status === 'todo' || t.status === 'in_progress'));
const frozen = computed(() => slates.busy.value || ask.running.value || ask.writingDraft.value || slates.recovery.value);
const previous = new Map<string, Todo['status']>();
watch(ask.conversationId, () => { expanded.value = false; finished.value = false; delivery.value = null; });
async function toggle(todo: Todo) {
  const base = slate.value; if (!base || frozen.value) return;
  if (todo.status !== 'done' && todo.image_required && !todo.binding) { delivery.value = { todo, complete: true }; return; }
  const key = `${base.id}:${todo.id}`, status = todo.status === 'done' ? previous.get(key) ?? 'todo' : 'done';
  if (todo.status !== 'done') previous.set(key, todo.status);
  try { await slates.commit(parseSlateEdit({ kind: 'slate_edit', op: 'update', slate_id: base.id, expected_version: base.version, todos: [{ op: 'update', id: todo.id, status }] }, base, drawing.snapshot().form, []).change); }
  catch (e) { ui.toast(message(e), 'err'); }
}
function discuss(todo: Todo) { ask.setInput(`关于「${todo.title}」，`); document.getElementById('askPrompt')?.focus(); }
</script>
<template>
  <section v-if="slate" class="ask-todos" aria-label="会话待办">
    <div class="todos-header">
      <button class="todos-bar" type="button" :aria-expanded="expanded" aria-controls="askTodoDrawer" @click="expanded = !expanded"><AppIcon name="i-chevron" :class="{ expanded }" /><b>待办</b><span v-if="!expanded" class="todos-current">{{ current?.title || (slate.todos.length ? done === slate.todos.length ? '全部完成' : '已结束' : '') }}</span><span class="todos-progress"><span class="todos-meter" aria-hidden="true"><i :style="{ transform: `scaleX(${slate.todos.length ? done / slate.todos.length : 0})` }"></i></span><small>{{ done }}/{{ slate.todos.length }}</small></span></button>
      <AskMenu id="askTodoOptions" label="待办清单选项" side="right">
        <template #trigger="{ open, toggle }"><button class="ibtn todo-more" type="button" aria-label="待办清单选项" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
        <template #default="{ close }">
          <button class="menu-item" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.detachSlate()"><AppIcon name="i-close" /><span class="menu-label">从当前会话移除</span></button>
          <button class="menu-item danger" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate.id, 'delete')"><AppIcon name="i-trash" /><span class="menu-label">删除清单</span></button>
        </template>
      </AskMenu>
    </div>
    <Transition name="todo-drawer"><div v-if="expanded" id="askTodoDrawer" class="todo-drawer"><div class="todo-drawer-inner"><div class="todos-list">
      <div v-for="todo in rows" :key="todo.id" class="todo-row" :class="todo.status">
        <button class="todo-status" type="button" role="checkbox" :aria-checked="todo.status === 'done' ? 'true' : todo.status === 'in_progress' ? 'mixed' : 'false'" :aria-label="`${todo.title} · ${statusNames[todo.status]}`" :title="todo.status === 'done' ? '重新打开任务' : '标记完成'" :disabled="frozen" @click="toggle(todo)"><span class="todo-circle"><AppIcon v-if="todo.status === 'done'" name="i-check" /><i v-else-if="todo.status === 'in_progress'"></i></span></button>
        <button class="todo-title" type="button" :title="todo.title" @click="discuss(todo)">{{ todo.title }}</button>
        <button class="todo-deliverable" :class="{ bound: todo.binding, required: todo.image_required }" type="button" :aria-label="`${todo.title} · ${todo.binding ? '查看成果' : '交付成果'}`" :title="todo.binding ? '查看成果' : '交付成果'" :disabled="frozen" @click="delivery = { todo, complete: false }"><AppIcon name="i-image" /></button>
        <AskMenu :id="`todo-${todo.id}-options`" :label="`${todo.title} · 任务选项`" side="right">
          <template #trigger="{ open, toggle }"><button class="ibtn todo-more" type="button" :aria-label="`${todo.title} · 任务选项`" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
          <template #default="{ close }">
            <button v-if="todo.status === 'abandoned'" class="menu-item" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate.id, 'reopen', todo.id)"><AppIcon name="i-undo" /><span class="menu-label">重新打开任务</span></button>
            <button v-else-if="todo.status !== 'done'" class="menu-item" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate.id, 'abandon', todo.id)"><AppIcon name="i-close" /><span class="menu-label">放弃任务</span></button>
            <button class="menu-item danger" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate.id, 'remove', todo.id)"><AppIcon name="i-trash" /><span class="menu-label">删除待办</span></button>
          </template>
        </AskMenu>
      </div>
      <button v-if="folding" class="todos-finished" type="button" @click="finished = !finished">{{ finished ? '收起已完成' : `显示已完成的 ${completed.length} 项` }}</button>
      <p v-if="!rows.length" class="todos-empty">暂无待办</p>
    </div></div></div></Transition>
    <SlateDeliverable v-if="delivery" :slate-id="slate.id" :todo-id="delivery.todo.id" :complete="delivery.complete" @close="delivery = null" />
  </section>
</template>
<style scoped>
.ask-todos { flex: 0 1 auto; min-height: 0; margin-bottom: 8px; overflow: hidden; }
.todos-header { display: flex; align-items: center; gap: 4px; }
.todos-header .todos-bar { flex: 1; min-width: 0; }
.todo-more { flex: none; width: 24px; height: 24px; color: var(--fg-3); }
.todo-more .ico { --ico: var(--ico-xs); }
/* The chevron is centred on the 20px status column so the bar, the glyphs and the titles share one grid; progress keeps to the right edge. */
.todos-bar { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 28px; padding-right: 4px; text-align: left; color: var(--fg-3); font-size: 12px; white-space: nowrap; }
.todos-bar b { flex: none; color: var(--fg-2); font-weight: var(--fw-medium); }
.todos-bar > .ico { flex: none; --ico: var(--ico-xs); margin-inline: calc((20px - var(--ico-xs)) / 2); color: var(--fg-3); transition: transform var(--t2) var(--e); }
.todos-bar > .ico.expanded { transform: rotate(90deg); }
.todos-progress { display: inline-flex; flex: none; align-items: center; gap: 8px; margin-left: auto; padding-left: 12px; }
.todos-meter { width: 32px; height: 3px; overflow: hidden; background: var(--line-2); border-radius: 2px; }
.todos-meter i { display: block; height: 100%; background: var(--a); border-radius: inherit; transform-origin: left; transition: transform var(--t2) var(--e); }
.todos-progress small { font: 11px/1 var(--mono); font-variant-numeric: tabular-nums; }
.todos-current { min-width: 0; margin-left: 3px; overflow: hidden; text-overflow: ellipsis; }
.todo-drawer { display: grid; grid-template-rows: 1fr; overflow: hidden; }
.todo-drawer-inner { min-height: 0; overflow: hidden; }
.todos-list { max-height: min(184px, 23dvh); overflow: auto; padding-bottom: 2px; overscroll-behavior: contain; scrollbar-width: thin; }
.todo-row { display: flex; align-items: center; gap: 7px; min-height: 26px; padding-right: 2px; border-radius: var(--r2); }
.todo-row:hover { background: var(--ask-hover, var(--hover)); }
.todo-row.in_progress { background: color-mix(in srgb, var(--a) 7%, transparent); }
/* Every status is the same 12px circle; a hairline threads consecutive rows into one list. */
.todo-status { position: relative; display: grid; flex: none; place-items: center; width: 20px; height: 26px; color: var(--fg-3); }
.todo-row:has(+ .todo-row) .todo-status::after { content: ''; position: absolute; top: calc(50% + 9px); left: 50%; width: 1px; height: calc(100% - 18px); background: var(--line-2); transform: translateX(-50%); }
.todo-circle { display: grid; place-items: center; width: 12px; height: 12px; border: 1px solid var(--fg-4); border-radius: 50%; transition: border-color var(--t1) var(--e); }
.todo-status:not(:disabled):hover .todo-circle { border-color: var(--fg-2); }
.in_progress .todo-circle { border-color: var(--a); }
.todo-circle i { width: 4px; height: 4px; background: var(--a); border-radius: 50%; }
.done .todo-circle { background: var(--line-2); border-color: transparent; }
.todo-circle .ico { --ico: var(--ico-xs); color: var(--fg-3); transform: scale(.72); }
.abandoned .todo-circle { border-style: dashed; }
.todo-title { flex: 1; min-width: 0; overflow: hidden; color: var(--fg-2); font-size: 12px; line-height: 1.5; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.in_progress .todo-title { color: var(--fg); }
:is(.done, .abandoned) .todo-title { color: var(--fg-3); text-decoration: line-through; text-decoration-color: var(--fg-4); }
/* A bound deliverable keeps the accent; an optional picture stays faint until the row is pointed at. */
.todo-deliverable { display: grid; flex: none; place-items: center; width: 24px; height: 24px; color: var(--fg-4); border-radius: var(--r1); transition: color var(--t1) var(--e); }
.todo-deliverable .ico { --ico: var(--ico-xs); }
.todo-deliverable.required { color: var(--fg-3); }
.todo-deliverable:not(.required, .bound) { opacity: .5; }
.todo-row:hover .todo-deliverable { opacity: 1; }
.todo-deliverable.bound { color: var(--a); }
.todo-deliverable:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.todos-finished { min-height: 24px; margin-left: 27px; color: var(--fg-3); font-size: 11px; }
.todos-empty { padding: 4px 0 8px 27px; color: var(--fg-3); font-size: 12px; }
.todo-drawer-enter-active, .todo-drawer-leave-active { transition: grid-template-rows var(--t2) var(--e); }
.todo-drawer-enter-from, .todo-drawer-leave-to { grid-template-rows: 0fr; }
@media (max-width: 480px) { .todo-row, .todo-status { min-height: 30px; } .todo-status { height: 30px; } .todo-deliverable { width: 28px; height: 28px; } }
@media (prefers-reduced-motion: reduce) { .todo-drawer-enter-active, .todo-drawer-leave-active, .todos-bar > .ico, .todos-meter i { transition: none; } }
</style>
