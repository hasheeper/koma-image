<script setup lang="ts">
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import AskToolGroup from "./AskToolGroup.vue";
import { computed } from "vue";
import type { CheckpointView, ToolRow } from "./service.ts";

const props = defineProps<{ checkpoint: CheckpointView; source?: string }>();
const ask = useAsk();
const rows = computed<readonly ToolRow[]>(() => props.checkpoint.receipts ?? [{ id: String(props.checkpoint.id), name: 'propose_draft', verb: '应用', object: props.checkpoint.title, state: 'done', stat: '' }]);
const summary = computed(() => {
  if (rows.value.length <= 1) return undefined;
  const tasks = rows.value.filter(r => r.name === 'slate_edit').length, files = rows.value.filter(r => r.name === 'save_ref').length;
  if (tasks + files !== rows.value.length) return `已应用 ${rows.value.length} 项更改`;
  return [tasks ? `已更新 ${tasks} 项待办` : '', files ? `已保存 ${files} 份资料` : ''].filter(Boolean).join('、');
});
</script>
<template>
  <div v-if="checkpoint.receipts?.length || source" class="ask-checkpoint receipt-checkpoint" :data-state="checkpoint.status" :data-id="checkpoint.id">
    <AskToolGroup :rows="rows" :source="source" :label="summary" :reverted="checkpoint.status === 'reverted'"><template #action><button v-if="checkpoint.editBoardId && checkpoint.status==='applied'" type="button" aria-label="去编辑" title="去编辑" @click="ask.goEdit(checkpoint.editBoardId)"><AppIcon name="i-edit" /></button><button v-if="ask.undoId.value === checkpoint.id" type="button" aria-label="回退" title="回退" :disabled="ask.running.value || ask.writingDraft.value" @click="ask.undoDraft(checkpoint.id)"><AppIcon name="i-undo" /></button><button v-else-if="ask.redoId.value === checkpoint.id" type="button" aria-label="恢复" title="恢复" :disabled="ask.running.value || ask.writingDraft.value" @click="ask.restoreDraft(checkpoint.id)"><AppIcon name="i-redo" /></button></template></AskToolGroup>
  </div>
  <div v-else class="ask-checkpoint" :data-state="checkpoint.status" :data-id="checkpoint.id">
    <AppIcon :name="checkpoint.status === 'applied' ? 'i-check' : checkpoint.status === 'dismissed' ? 'i-close' : 'i-undo'" />
    <span class="checkpoint-title" :title="checkpoint.title">{{ checkpoint.status === 'applied' ? '已写入' : checkpoint.status === 'dismissed' ? '已驳回' : '已回退' }}<b>{{ checkpoint.title }}</b></span>
    <button v-if="checkpoint.editBoardId && checkpoint.status==='applied'" type="button" aria-label="去编辑" title="去编辑" @click="ask.goEdit(checkpoint.editBoardId)"><AppIcon name="i-edit" /></button>
    <span class="checkpoint-stat" :aria-label="`新增 ${checkpoint.added} 项，删除 ${checkpoint.removed} 项`"><span v-if="checkpoint.added" class="ins">+{{ checkpoint.added }}</span><span v-if="checkpoint.removed" class="del">−{{ checkpoint.removed }}</span></span>
    <button v-if="checkpoint.status === 'applied' && ask.undoId.value === checkpoint.id" type="button" aria-label="回退" title="回退" :disabled="ask.running.value || ask.writingDraft.value" @click="ask.undoDraft(checkpoint.id)"><AppIcon name="i-undo" /></button>
    <button v-else-if="checkpoint.status === 'reverted' && ask.redoId.value === checkpoint.id" type="button" aria-label="恢复" title="恢复" :disabled="ask.running.value || ask.writingDraft.value" @click="ask.restoreDraft(checkpoint.id)"><AppIcon name="i-redo" /></button>
  </div>
</template>
<style scoped>
.ask-checkpoint { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px; color: var(--fg-3); font-size: 13px; background: var(--ask-layer); border: 1px solid var(--line-2); border-radius: 12px; }
.ask-checkpoint > .ico { flex: none; --ico: var(--ico-sm); color: var(--ok); }
.checkpoint-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.checkpoint-title b { margin-left: 6px; color: var(--fg); font-weight: var(--fw-medium); }
.checkpoint-stat { display: flex; flex: none; gap: 6px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.ins { color: var(--ok); }
.del { color: var(--err); }
.ask-checkpoint:has(> button) { padding-right: 6px; }
.ask-checkpoint:has(> button) .checkpoint-stat { margin-right: 2px; }
.ask-checkpoint button { display: grid; flex: none; place-items: center; width: 28px; height: 28px; color: var(--fg-3); border-radius: 8px; transition: color var(--t1) var(--e), background var(--t1) var(--e); }
.ask-checkpoint button .ico { --ico: var(--ico-sm); }
.ask-checkpoint button:hover:not(:disabled) { color: var(--fg); background: var(--ask-hover); }
.ask-checkpoint button:disabled { color: var(--fg-4); cursor: default; }
.ask-checkpoint[data-state="reverted"] > .ico, .ask-checkpoint[data-state="reverted"] :is(b, .ins, .del) { color: var(--fg-3); }
.ask-checkpoint[data-state="reverted"] .checkpoint-stat { text-decoration: line-through; }
.ask-checkpoint[data-state="dismissed"] > .ico, .ask-checkpoint[data-state="dismissed"] :is(.ins, .del) { color: var(--fg-3); }
@media (hover: none) { .ask-checkpoint button { width: 36px; height: 36px; } }
.receipt-checkpoint { display: block; min-height: 26px; padding: 0; background: none; border: 0; border-radius: 0; }
</style>
