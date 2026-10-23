<script setup lang="ts">
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import type { CheckpointView } from "./service.ts";

defineProps<{ checkpoint: CheckpointView }>();
const ask = useAsk();
</script>
<template>
  <div class="ask-checkpoint" :data-state="checkpoint.status" :data-id="checkpoint.id">
    <AppIcon :name="checkpoint.status === 'applied' ? 'i-check' : 'i-undo'" />
    <span class="checkpoint-title" :title="checkpoint.title">{{ checkpoint.status === 'applied' ? '已写入' : '已回退' }}<b>{{ checkpoint.title }}</b></span>
    <span class="checkpoint-stat" :aria-label="`新增 ${checkpoint.added} 项，删除 ${checkpoint.removed} 项`"><span v-if="checkpoint.added" class="ins">+{{ checkpoint.added }}</span><span v-if="checkpoint.removed" class="del">−{{ checkpoint.removed }}</span></span>
    <button v-if="ask.undoId.value === checkpoint.id" type="button" :disabled="ask.running.value || ask.writingDraft.value" @click="ask.undoDraft(checkpoint.id)">回退</button>
    <button v-else-if="ask.redoId.value === checkpoint.id" type="button" :disabled="ask.running.value || ask.writingDraft.value" @click="ask.restoreDraft(checkpoint.id)">恢复</button>
  </div>
</template>
<style scoped>
.ask-checkpoint { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 6px 0 12px; color: var(--fg-3); font-size: 13px; background: var(--ask-layer); border: 1px solid var(--line-2); border-radius: 12px; }
.ask-checkpoint > .ico { flex: none; width: 14px; height: 14px; color: var(--ok); }
.checkpoint-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.checkpoint-title b { margin-left: 6px; color: var(--fg); font-weight: var(--fw-medium); }
.checkpoint-stat { display: flex; flex: none; gap: 6px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.ins { color: var(--ok); }
.del { color: var(--err); }
.ask-checkpoint button { flex: none; height: 28px; padding: 0 10px; color: var(--fg-2); font-size: 13px; border-radius: 8px; opacity: 0; transition: opacity var(--t1) var(--e); }
.ask-checkpoint:is(:hover, :focus-within, [data-state="reverted"]) button { opacity: 1; }
.ask-checkpoint button:hover { color: var(--fg); background: var(--ask-hover); }
.ask-checkpoint[data-state="reverted"] :is(.ico, b, .ins, .del) { color: var(--fg-3); }
.ask-checkpoint[data-state="reverted"] .checkpoint-stat { text-decoration: line-through; }
@media (hover: none) { .ask-checkpoint button { height: 36px; opacity: 1; } }
</style>
