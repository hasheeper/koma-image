<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef } from "vue";
import { useSlates } from "../app/slate.ts";
import { useAsk } from "../app/ask.ts";
import { useBridge } from "../app/bridge.ts";
import { useDrawing } from "../app/drawing.ts";
import { message } from "../app/ui.ts";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "../ask/AskMenu.vue";
import { parseSlateEdit } from "./edit.ts";
const slates = useSlates(), ask = useAsk(), bridge = useBridge(), { drawing } = useDrawing();
const dialog = shallowRef<HTMLDialogElement | null>(null), importer = shallowRef<HTMLInputElement | null>(null);
const creating = shallowRef(false), title = shallowRef(''), error = shallowRef('');
const issues = computed(() => bridge.slateMappings.value.filter(m => m.status === 'conflict' || m.status === 'error'));
const unmapped = computed(() => bridge.phase.value === 'active' && slates.activeId.value && !bridge.slateMappings.value.some(m => m.id === slates.activeId.value));
const activeIssue = computed(() => issues.value.find(m => m.id === slates.activeId.value));
const originalFocus = document.activeElement;
function close() { dialog.value?.close(); slates.visible.value = false; }
async function open(id: string, fresh = false) { if (!ask.canManage.value) return; if (await ask.openSlate(id, fresh)) close(); }
async function create() {
  try { const change = parseSlateEdit({ kind: 'slate_edit', op: 'create', slate_title: title.value }, null, drawing.snapshot().form, []).change; await slates.commit(change); open(change.id); }
  catch (e) { error.value = message(e); }
}
async function imported(event: Event) { const target = event.target as HTMLInputElement, file = target.files?.[0]; target.value = ''; if (file) { await bridge.importFile(file); if (!bridge.error.value) { close(); ask.show(); } } }
onMounted(async () => { await nextTick(); dialog.value?.showModal(); });
onBeforeUnmount(() => { dialog.value?.close(); if (originalFocus instanceof HTMLElement && originalFocus.isConnected) originalFocus.focus({ preventScroll: true }); });
</script>
<template>
  <dialog ref="dialog" class="modal slate-panel" aria-label="任务总览" @cancel.prevent="close" @click="($event.target === dialog) && close()" @keydown.stop>
    <header>
      <b>任务总览</b><span></span>
      <AskMenu id="slateOverviewMore" label="任务总览选项" side="right">
        <template #trigger="{ open: shown, toggle }"><button class="ibtn" type="button" aria-label="任务总览选项" aria-haspopup="menu" :aria-expanded="shown" @click="toggle"><AppIcon name="i-more" /></button></template>
        <template #default="{ close: dismiss }">
          <button class="ask-menu-item" role="menuitem" type="button" :disabled="!ask.canManage.value" @click="dismiss(); creating = !creating"><AppIcon name="i-plus" /><span class="ask-menu-label">新建清单</span></button>
          <button v-if="slates.activeId.value" class="ask-menu-item" role="menuitem" type="button" :disabled="!ask.canManage.value" @click="dismiss(); open(slates.activeId.value!, true)"><AppIcon name="i-chat" /><span class="ask-menu-label">在新会话中打开</span></button>
          <button v-if="unmapped" class="ask-menu-item" role="menuitem" type="button" :disabled="bridge.busy.value" @click="dismiss(); bridge.mapSlate(slates.activeId.value!)"><AppIcon name="i-folder" /><span class="ask-menu-label">同步到当前目录</span></button>
          <button v-if="activeIssue && slates.get(activeIssue.id)" class="ask-menu-item" role="menuitem" type="button" title="用当前本机清单替换目录中的任务文件" :disabled="bridge.busy.value" @click="dismiss(); bridge.resolveSlate(activeIssue!.id, 'local')"><AppIcon name="i-check" /><span class="ask-menu-label">保留本机版本</span></button>
          <button class="ask-menu-item" role="menuitem" type="button" :disabled="bridge.busy.value" @click="dismiss(); importer?.click()"><AppIcon name="i-upload" /><span class="ask-menu-label">导入清单 JSON</span></button>
        </template>
      </AskMenu>
      <button class="ibtn" type="button" aria-label="关闭任务总览" @click="close"><AppIcon name="i-close" /></button>
    </header>
    <div class="overview-body"><button v-for="s in slates.list.value" :key="s.id" class="overview-item" type="button" :disabled="!ask.canManage.value || slates.busy.value" @click="open(s.id)"><AppIcon name="i-tasks" :class="{ current: ask.activeSlate.value?.id === s.id }" /><span>{{ s.title }}</span><small>{{ s.todos.filter(t => t.status === 'done').length }}/{{ s.todos.length }}</small><AppIcon name="i-chevron" /></button><p v-if="!slates.list.value.length" class="overview-empty">暂无待办清单</p></div>
    <form v-if="creating" class="overview-create" @submit.prevent="create"><input v-model="title" type="text" aria-label="清单名称" placeholder="清单名称…" maxlength="120" /><button type="submit" :disabled="!title.trim() || slates.busy.value">创建</button></form>
    <div v-for="issue in issues" :key="issue.id" class="overview-issue"><span :title="issue.error">{{ slates.get(issue.id)?.title || '目录任务' }}</span><button type="button" @click="bridge.resolveSlate(issue.id, 'review'); close(); ask.show()">审阅修改</button></div>
    <button v-if="slates.recovery.value" class="overview-recover" type="button" @click="slates.retryRecovery()">恢复中断的操作</button>
    <p v-if="error || slates.error.value || bridge.error.value" class="overview-error" role="status">{{ error || slates.error.value || bridge.error.value }}</p>
    <input ref="importer" hidden type="file" accept=".json,application/json" aria-label="导入任务 JSON" @change="imported" />
  </dialog>
</template>
<style scoped>
.slate-panel { --modal-w: 280px; position: fixed; inset: 64px 16px auto auto; max-height: calc(100dvh - 80px); margin: 0; padding: 8px; color: var(--fg); border-radius: var(--r3); }
.slate-panel::backdrop { background: transparent; backdrop-filter: none; }
.slate-panel header { display: flex; align-items: center; gap: 2px; padding: 0 0 4px 6px; font-size: 13px; }
.slate-panel header b { font-weight: var(--fw-medium); }
.slate-panel header > span { flex: 1; }
.slate-panel .ibtn { width: 26px; height: 26px; }
.slate-panel .ibtn .ico { --ico: var(--ico-sm); }
.overview-body { max-height: min(360px, 50dvh); overflow: auto; }
.overview-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 0 7px; color: var(--fg-2); text-align: left; border-radius: var(--r1); }
.overview-item:hover { background: var(--hover); }
.overview-item > .ico { flex: none; --ico: var(--ico-sm); color: var(--fg-3); }
.overview-item > .ico.current { color: var(--a); }
.overview-item > .ico:last-child { --ico: var(--ico-xs); }
.overview-item > span { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.overview-item small { color: var(--fg-3); font: 11px var(--mono); }
.overview-empty { padding: 18px 6px; color: var(--fg-3); font-size: 12px; }
.overview-create, .overview-issue { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 6px; border-top: 1px solid var(--line); }
.overview-create input { flex: 1; min-width: 0; width: 100%; font-size: 12px; }
.overview-create button, .overview-issue button, .overview-recover { flex: none; color: var(--a); font-size: 12px; }
.overview-issue > span { flex: 1; min-width: 0; overflow: hidden; color: var(--fg-2); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.overview-error { padding: 8px 6px; color: var(--warn); font-size: 12px; overflow-wrap: anywhere; }
</style>
