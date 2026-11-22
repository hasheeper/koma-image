<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from "vue";
import { useAskPresentation } from "../ask/presentation.ts";
import { layerPort, type LayerTodo } from "../layer/planning.ts";
import { useAsk } from "../app/ask.ts";
import { useSlates } from "../app/slate.ts";
import { useDrawing } from "../app/drawing.ts";
import { useUi, message } from "../app/ui.ts";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "../ask/AskMenu.vue";
import SlateDeliverable from "./SlateDeliverable.vue";
import { parseSlateEdit } from "./edit.ts";
import { statusNames } from "./model.ts";
import type { Todo, TodoStatus } from "./model.ts";
const ask = useAsk(), slates = useSlates(), { drawing } = useDrawing(), ui = useUi();
const slate = ask.activeSlate, expanded = shallowRef(false), finished = shallowRef(false);
const delivery = shallowRef<{ todo: Todo; complete: boolean } | null>(null);
const { layerChecklist: checklist, todoRequest } = useAskPresentation();
const source = shallowRef<'layer' | 'slate'>('layer');
const showLayer = computed(() => !!checklist.value && (source.value === 'layer' || !slate.value));
const items = computed(() => showLayer.value ? checklist.value!.todos : slate.value?.todos ?? []);
const total = computed(() => items.value.length);
const done = computed(() => items.value.filter(t => 'done' in t ? t.done : t.status === 'done').length);
const slateCurrent = computed(() => slate.value?.todos.find(t => t.status === 'in_progress') ?? slate.value?.todos.find(t => t.status === 'todo'));
const completed = computed(() => slate.value?.todos.filter(t => t.status === 'done' || t.status === 'abandoned') ?? []);
const folding = computed(() => (slate.value?.todos.length ?? 0) > 6 && completed.value.length >= 2);
const slateRows = computed(() => (slate.value?.todos ?? []).filter(t => !folding.value || finished.value || t.status === 'todo' || t.status === 'in_progress'));
const frozen = computed(() => slates.busy.value || ask.running.value || ask.writingDraft.value || slates.recovery.value);
type Row = { id: string; title: string; status: TodoStatus } & (
  { slate: Todo; part?: undefined } | { part: LayerTodo; projectId: string; children: number; slate?: undefined }
);
const unfolded = shallowRef(new Set<string>());
const binding = shallowRef('');
const rows = computed<Row[]>(() => {
  const list = checklist.value;
  if (!showLayer.value || !list) return slateRows.value.map(todo => ({ id: todo.id, title: todo.title, status: todo.status, slate: todo }));
  const children = new Map<string, LayerTodo[]>();
  for (const t of list.todos) {
    if (!t.parent) continue;
    const group = children.get(t.parent);
    if (group) group.push(t); else children.set(t.parent, [t]);
  }
  const row = (part: LayerTodo): Row => ({ id: part.id, title: part.name, status: part.done ? 'done' : 'todo',
    projectId: list.projectId, part, children: children.get(part.id)?.length ?? 0 });
  return list.todos.filter(t => !t.parent).flatMap(t => [
    row(t), ...(unfolded.value.has(t.id) ? (children.get(t.id) ?? []).map(row) : [])
  ]);
});
const currentTitle = computed(() => showLayer.value ? checklist.value?.todos.find(t => !t.done)?.name : slateCurrent.value?.title);
const listBusy = computed(() => showLayer.value ? checklist.value?.busy || ask.writingDraft.value : frozen.value);
type PartRow = Extract<Row, { part: LayerTodo }>;
function fold(id: string) {
  const next = new Set(unfolded.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  unfolded.value = next;
}
function updatePart(row: PartRow, patch: Partial<Pick<LayerTodo, 'done' | 'layerId'>>) {
  if (!listBusy.value) void layerPort()?.updateTodo(row.projectId, row.id, patch);
}
function usePart(row: PartRow, sub: boolean, region = false) {
  const list = checklist.value;
  if (!list || list.projectId !== row.projectId || listBusy.value) return;
  const parent = row.part.parent ? list.todos.find(t => t.id === row.part.parent) : row.part;
  const bound = list.layers.some(l => l.id === parent?.layerId);
  void layerPort()?.useTodo(list.projectId, row.id, !sub ? 'master' : region || !bound ? 'region' : 'layers');
}
async function showBindings(id: string) {
  binding.value = id;
  await nextTick();
  const menu = document.getElementById(`todo-${id}-options`);
  const selected = menu?.querySelector<HTMLElement>('[aria-checked="true"]');
  (selected ?? menu?.querySelector('button'))?.focus();
}
watch(() => checklist.value?.projectId, () => {
  source.value = 'layer'; unfolded.value = new Set(); binding.value = ''; expanded.value = false;
});
watch(() => slate.value?.id, id => { if (id) source.value = 'slate'; });
watch(todoRequest, request => {
  if (!request || request.id !== (request.source === 'layer' ? checklist.value?.projectId : slate.value?.id)) return;
  source.value = request.source;
  expanded.value = true;
});
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
  <section v-if="slate || checklist" class="ask-todos" :aria-label="showLayer ? '拆件待办' : '会话待办'">
    <div class="todos-header">
      <button class="todos-bar" type="button" :aria-expanded="expanded" aria-controls="askTodoDrawer" @click="expanded = !expanded">
        <AppIcon name="i-chevron" :class="{ expanded }" /><b>{{ showLayer ? '拆件待办' : '待办' }}</b>
        <span v-if="!expanded" class="todos-current">{{ currentTitle || (total ? done === total ? '全部完成' : '已结束' : '') }}</span>
        <span class="todos-progress"><span class="todos-meter" aria-hidden="true"><i :style="{ transform: `scaleX(${total ? done / total : 0})` }"></i></span><small>{{ done }}/{{ total }}</small></span>
      </button>
      <AskMenu id="askTodoOptions" label="待办清单选项" side="right">
        <template #trigger="{ open, toggle }"><button class="ibtn todo-more" type="button" aria-label="待办清单选项" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
        <template #default="{ close }">
          <button v-if="checklist && slate" class="menu-item" role="menuitem" type="button" @click="close(); source = showLayer ? 'slate' : 'layer'; expanded = true"><AppIcon name="i-tasks" /><span class="menu-label">{{ showLayer ? '查看会话待办' : '查看拆件待办' }}</span></button>
          <button v-if="checklist" class="menu-item" role="menuitem" type="button" @click="close(); slates.visible.value = true"><AppIcon name="i-menu" /><span class="menu-label">任务总览</span></button>
          <button v-if="showLayer && checklist" class="menu-item danger" role="menuitem" type="button" :disabled="!ask.canDeleteLayerChecklist.value" @click="close(); ask.proposeDeleteLayerChecklist(checklist.projectId)"><AppIcon name="i-trash" /><span class="menu-label">删除拆件待办</span></button>
          <template v-if="slate && !showLayer">
            <button class="menu-item" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.detachSlate()"><AppIcon name="i-close" /><span class="menu-label">从当前会话移除</span></button>
            <button class="menu-item danger" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate!.id, 'delete')"><AppIcon name="i-trash" /><span class="menu-label">删除清单</span></button>
          </template>
        </template>
      </AskMenu>
    </div>
    <Transition name="todo-drawer"><div v-if="expanded" id="askTodoDrawer" class="todo-drawer"><div class="todo-drawer-inner"><div class="todos-list">
      <div v-for="row in rows" :key="row.part ? row.projectId + ':' + row.id : row.id" class="todo-row" :class="[row.status, { 'todo-child': row.part?.parent }]">
        <button class="todo-status" type="button" role="checkbox" :aria-checked="row.status === 'done' ? 'true' : row.status === 'in_progress' ? 'mixed' : 'false'" :aria-label="`${row.title} · ${statusNames[row.status]}`" :title="row.status === 'done' ? '重新打开任务' : '标记完成'" :disabled="listBusy" @click="row.part ? updatePart(row, { done: !row.part.done }) : toggle(row.slate)">
          <span class="todo-circle"><AppIcon v-if="row.status === 'done'" name="i-check" /><i v-else-if="row.status === 'in_progress'"></i></span>
        </button>
        <button class="todo-title" type="button" :title="row.part ? row.title + (row.part.parent ? ' · 填细拆词' : ' · 填总拆词') : row.title" :disabled="!!row.part && listBusy" @click="row.part ? usePart(row, !!row.part.parent) : discuss(row.slate)">{{ row.title }}</button>
        <button v-if="row.slate" class="todo-deliverable" :class="{ bound: row.slate.binding, required: row.slate.image_required }" type="button" :aria-label="`${row.title} · ${row.slate.binding ? '查看成果' : '交付成果'}`" :title="row.slate.binding ? '查看成果' : '交付成果'" :disabled="frozen" @click="delivery = { todo: row.slate, complete: false }"><AppIcon name="i-image" /></button>
        <button v-else-if="row.children" class="todo-children" type="button" :aria-label="`${row.title} · 细分 ${row.children} 项`" :aria-expanded="unfolded.has(row.id)" @click="fold(row.id)"><span>{{ row.children }}</span><AppIcon name="i-chevron" /></button>
        <AskMenu v-if="!row.part?.parent" :id="`todo-${row.id}-options`" :label="`${row.title} · 任务选项`" side="right" @closed="binding = ''">
          <template #trigger="{ open, toggle }"><button class="ibtn todo-more" type="button" :aria-label="`${row.title} · 任务选项`" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-more" /></button></template>
          <template #default="{ close }">
            <template v-if="row.part && checklist">
              <template v-if="binding === row.id">
                <button class="menu-item" role="menuitemradio" type="button" :aria-checked="!checklist.layers.some(l => l.id === row.part.layerId)" :disabled="listBusy" @click="close(); updatePart(row, { layerId: undefined })"><span class="menu-label">不绑定图层</span></button>
                <button v-for="l in checklist.layers" :key="l.id" class="menu-item" role="menuitemradio" type="button" :aria-checked="row.part.layerId === l.id" :disabled="listBusy" @click="close(); updatePart(row, { layerId: l.id })"><span class="menu-label">{{ l.name }}</span><AppIcon v-if="row.part.layerId === l.id" name="i-check" /></button>
              </template>
              <template v-else>
                <button v-if="checklist.layers.some(l => l.id === row.part.layerId)" class="menu-item" role="menuitem" type="button" :disabled="listBusy" @click="close(); usePart(row, true)"><AppIcon name="i-layers" /><span class="menu-label">定位并填细拆词</span></button>
                <button class="menu-item" role="menuitem" type="button" :disabled="listBusy" @click="close(); usePart(row, true, true)"><AppIcon name="i-frame" /><span class="menu-label">用母版框细拆</span></button>
                <button v-if="checklist.layers.length" class="menu-item" role="menuitem" type="button" :disabled="listBusy" @click="showBindings(row.id)"><AppIcon name="i-layers" /><span class="menu-label">绑定正式图层…</span></button>
              </template>
            </template>
            <template v-else-if="row.slate && slate">
              <button v-if="row.status === 'abandoned'" class="menu-item" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate!.id, 'reopen', row.id)"><AppIcon name="i-undo" /><span class="menu-label">重新打开任务</span></button>
              <button v-else-if="row.status !== 'done'" class="menu-item" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate!.id, 'abandon', row.id)"><AppIcon name="i-close" /><span class="menu-label">放弃任务</span></button>
              <button class="menu-item danger" role="menuitem" type="button" :disabled="!ask.canManageTasks.value" @click="close(); ask.proposeSlateAction(slate!.id, 'remove', row.id)"><AppIcon name="i-trash" /><span class="menu-label">删除待办</span></button>
            </template>
          </template>
        </AskMenu>
      </div>
      <button v-if="!showLayer && folding" class="todos-finished" type="button" @click="finished = !finished">{{ finished ? '收起已完成' : `显示已完成的 ${completed.length} 项` }}</button>
      <p v-if="!rows.length" class="todos-empty">暂无待办</p>
    </div></div></div></Transition>
    <SlateDeliverable v-if="slate && delivery" :slate-id="slate.id" :todo-id="delivery.todo.id" :complete="delivery.complete" @close="delivery = null" />
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
.todo-child { padding-left: 20px; }
.todo-children { display: inline-flex; align-items: center; justify-content: center; gap: 3px; min-width: 32px; min-height: 26px; color: var(--fg-3); font-size: 11px; font-variant-numeric: tabular-nums; }
.todo-children .ico { --ico: var(--ico-xs); }
.todo-children[aria-expanded="true"] .ico { transform: rotate(90deg); }
.todo-row :deep(.ask-menu) { max-height: min(40dvh, 320px); overflow-y: auto; }
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
