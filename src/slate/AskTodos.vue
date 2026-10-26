<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask.ts";
import { useSlates } from "../app/slate.ts";
import { useDrawing } from "../app/drawing.ts";
import { useUi, message } from "../app/ui.ts";
import AppIcon from "../shared/AppIcon.vue";
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
    <button class="todos-bar" type="button" :aria-expanded="expanded" aria-controls="askTodoDrawer" @click="expanded = !expanded"><AppIcon name="i-chevron" :class="{ expanded }" /><span>待办</span><small>{{ done }}/{{ slate.todos.length }}</small><span v-if="!expanded" class="todos-current">{{ current?.title || (slate.todos.length ? '全部完成' : '') }}</span></button>
    <Transition name="todo-drawer"><div v-if="expanded" id="askTodoDrawer" class="todo-drawer"><div class="todo-drawer-inner"><div class="todos-list">
      <div v-for="todo in rows" :key="todo.id" class="todo-row" :class="todo.status">
        <button class="todo-status" type="button" role="checkbox" :aria-checked="todo.status === 'done' ? 'true' : todo.status === 'in_progress' ? 'mixed' : 'false'" :aria-label="`${todo.title} · ${statusNames[todo.status]}`" :title="todo.status === 'done' ? '重新打开任务' : '标记完成'" :disabled="frozen" @click="toggle(todo)"><AppIcon v-if="todo.status === 'done'" name="i-check" /><span v-else class="todo-circle"><i v-if="todo.status === 'in_progress'"></i></span></button>
        <button class="todo-title" type="button" :title="todo.title" @click="discuss(todo)">{{ todo.title }}</button>
        <button class="todo-deliverable" :class="{ bound: todo.binding }" type="button" :aria-label="`${todo.title} · ${todo.binding ? '查看成果' : '交付成果'}`" :title="todo.binding ? '查看成果' : '交付成果'" :disabled="frozen" @click="delivery = { todo, complete: false }"><AppIcon name="i-image" /></button>
      </div>
      <button v-if="folding" class="todos-finished" type="button" @click="finished = !finished">{{ finished ? '收起已完成' : `显示已完成的 ${completed.length} 项` }}</button>
      <p v-if="!rows.length" class="todos-empty">暂无待办</p>
    </div></div></div></Transition>
    <SlateDeliverable v-if="delivery" :slate-id="slate.id" :todo-id="delivery.todo.id" :complete="delivery.complete" @close="delivery = null" />
  </section>
</template>
<style scoped>
.ask-todos { flex: 0 1 auto; min-height: 0; margin-bottom: 8px; overflow: hidden; }
.todos-bar { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 28px; text-align: left; color: var(--fg-2); font-size: 12px; }
.todos-bar > .ico { flex: none; --ico: var(--ico-xs); color: var(--fg-3); transition: transform var(--t2) var(--e); }
.todos-bar > .ico.expanded { transform: rotate(90deg); }
.todos-bar small { color: var(--fg-3); font: 11px var(--mono); }
.todos-current { min-width: 0; margin-left: 3px; overflow: hidden; color: var(--fg-3); text-overflow: ellipsis; white-space: nowrap; }
.todo-drawer { display: grid; grid-template-rows: 1fr; overflow: hidden; }
.todo-drawer-inner { min-height: 0; overflow: hidden; }
.todos-list { max-height: min(180px, 22dvh); overflow: auto; padding-bottom: 2px; overscroll-behavior: contain; scrollbar-width: thin; }
.todo-row { display: flex; align-items: center; gap: 7px; min-height: 24px; padding-right: 3px; border-radius: var(--r1); }
.todo-row:hover { background: var(--ask-hover, var(--hover)); }
.todo-status { display: grid; flex: none; place-items: center; width: 20px; height: 24px; color: var(--fg-3); }
.todo-status .ico, .todo-deliverable .ico { --ico: var(--ico-xs); }
.todo-circle { display: grid; place-items: center; width: 12px; height: 12px; border: 1px solid var(--fg-3); border-radius: 50%; }
.in_progress .todo-circle { border-color: var(--a); }
.todo-circle i { width: 4px; height: 4px; background: var(--a); border-radius: 50%; }
.todo-title { flex: 1; min-width: 0; overflow: hidden; color: var(--fg-2); font-size: 12px; line-height: 1.5; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.in_progress .todo-title { color: var(--fg); }
:is(.done, .abandoned) .todo-title { color: var(--fg-3); text-decoration: line-through; text-decoration-color: var(--line-2); }
.abandoned .todo-circle { border-style: dashed; }
.todo-deliverable { display: grid; flex: none; place-items: center; width: 24px; height: 24px; color: var(--fg-3); border-radius: var(--r1); }
.todo-deliverable.bound { color: var(--a); }
.todo-deliverable:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.todos-finished { min-height: 24px; margin-left: 27px; color: var(--fg-3); font-size: 11px; }
.todos-empty { padding: 4px 0 8px 27px; color: var(--fg-3); font-size: 12px; }
.todo-drawer-enter-active, .todo-drawer-leave-active { transition: grid-template-rows var(--t2) var(--e); }
.todo-drawer-enter-from, .todo-drawer-leave-to { grid-template-rows: 0fr; }
@media (max-width: 480px) { .todo-row, .todo-status, .todo-deliverable { min-height: 26px; } }
@media (prefers-reduced-motion: reduce) { .todo-drawer-enter-active, .todo-drawer-leave-active, .todos-bar > .ico { transition: none; } }
</style>
