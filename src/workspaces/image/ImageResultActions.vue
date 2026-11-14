<script setup lang="ts">
import { computed } from 'vue';
import type { HistoryRecord } from '../../domain/drawing.ts';
import { imageFileName } from '../../domain/drawing.ts';
import { useDrawing } from '../../app/drawing.ts';
import { useAsk, AskMark } from '../../app/ask.ts';
import AppIcon from '../../shared/AppIcon.vue';
import EvolutionAction from '../../ask/retrospect/EvolutionAction.vue';
import { useImageActions } from './use-image-actions.ts';
import ImageResultDetails from './ImageResultDetails.vue';
const props = defineProps<{ item: HistoryRecord | null; legacyIds?: boolean; compact?: boolean }>();
const { drawing, view } = useDrawing(), ask = useAsk();
const current = computed(() => props.item), { resultAction } = useImageActions(current);
const saved = computed(() => view.value.favorites.some(r => r.id === props.item?.id));
function openAsk() { const label = props.item && ask.labelFor(props.item.id); if (label) ask.show({ anchor: label }); }
function save() {
  if (!props.item?.blob) return;
  const a = document.createElement('a'); a.href = drawing.url(props.item); a.download = imageFileName(props.item); a.click();
}
</script>
<template>
        <div class="result-actions" :class="{ 'compact-actions editor-tool-controls': compact }" role="group" aria-label="图片操作">
          <div class="result-group result-group-ask" :class="{ 'editor-tool-capsule': compact }">
            <ImageResultDetails v-if="compact && item" :item="item" />
            <button class="btn btn-sm result-ask" type="button" :disabled="!item" aria-label="Ask 这张图" @click="openAsk"><AskMark /><span>Ask</span></button>
          </div>
          <div class="result-group" :class="{ 'editor-tool-capsule': compact }">
            <EvolutionAction v-if="item" :record-id="item.id" />
            <button
              v-for="action in [
                { id: 'editBtn', label: '编辑这张图', icon: 'i-edit' },
                { id: 'annotateBtn', label: '批注这张图', icon: 'i-annotate' },
                { id: 'chatBtn', label: '在对话中改这张图', icon: 'i-chat' },
              ]"
              :key="action.id"
              :id="legacyIds ? action.id : undefined"
              class="ibtn"
              type="button"
              :aria-label="action.label"
              :data-tip="!item?.blob ? '原图已释放，仅保留缩略图和配方' : action.label"
              :disabled="!item?.blob"
              :title="!item?.blob ? '仅保留缩略图和配方，原图已释放' : undefined"
              @click="resultAction(action.id)"
            >
              <AppIcon :name="action.icon" />
            </button>
          </div>
          <div class="result-group" :class="{ 'editor-tool-capsule editor-info-actions': compact }">
            <button
              class="ibtn"
              :id="legacyIds ? 'favoriteBtn' : undefined"
              type="button"
              :data-tip="!item?.blob ? '原图已释放，无法收藏原图' : saved ? '取消收藏' : '收藏'"
              :aria-label="saved ? '取消收藏' : '收藏图片'"
              :aria-pressed="saved"
              :disabled="
                !item?.blob || view.favoritesLoading ||
                view.favoritePending.includes(item?.id || '')
              "
              @click="item && drawing.toggleFavorite(item)"
            >
              <AppIcon name="i-star" /></button
            ><button
              class="ibtn"
              :class="{ 'ibtn-accent': item?.blob && !compact }"
              :id="legacyIds ? 'saveBtn' : undefined"
              type="button"
              :data-tip="!item?.blob ? '原图已释放，无法下载原图' : '下载'"
              aria-label="下载"
              :disabled="!item?.blob"
              @click="save"
            >
              <AppIcon name="i-download" />
            </button>
          </div>
        </div>
</template>
<style scoped>
.result-ask { height: 36px; padding: 0 10px 0 8px; gap: 6px; color: var(--result-ask-ink); font-weight: var(--fw-semibold); background: transparent; border: 1px solid transparent; }
.result-ask:not(:disabled):hover { background: var(--result-ask-hover); border-color: var(--result-ask-line); }
.ibtn[aria-pressed="true"] { color: var(--a); }
.ibtn[aria-pressed="true"] .ico { fill: currentColor; }
.compact-actions { flex-wrap: nowrap; min-width: 0; max-width: 100%; margin: 0; gap: 8px; pointer-events: auto; }
.compact-actions .result-group { gap: 0; }
.compact-actions .result-group + .result-group::before { display: none; }
.compact-actions :deep(.ibtn) { width: 32px; height: 32px; border-radius: 999px; --ico: var(--ico-md); }
.compact-actions .result-ask { height: 32px; padding-inline: 8px; border-radius: 999px; font-size: var(--fz-sm); }
@container canvas-workspace (max-width: 820px) {
  .compact-actions { gap: 4px; }
  .compact-actions :deep(.ibtn) { width: 28px; height: 32px; }
  .compact-actions .result-ask { padding-inline: 5px; }
  .compact-actions .result-ask > span { display: none; }
}
</style>
