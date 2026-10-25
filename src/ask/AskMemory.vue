<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, useId, watch } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import AskMarkdown from "./AskMarkdown.vue";
import type { TurnId } from "./compact/ledger";

const ask = useAsk(), id = useId();
const root = shallowRef<HTMLDetailsElement | null>(null), back = shallowRef<HTMLButtonElement | null>(null);
const opened = shallowRef(false), full = shallowRef(false), tab = shallowRef("memo");
const tabs = computed(() => [
  { id: "memo", label: "记忆" },
  { id: "turns", label: `轮次 ${ask.memory.value?.count ?? 0}` },
  ...(ask.memory.value?.attachments.length ? [{ id: "files", label: `附件 ${ask.memory.value.attachments.length}` }] : []),
]);
const preview = computed(() => ask.attachmentPreview.value?.inline ? ask.attachmentPreview.value : null);
const statuses = { pending: "待确认", applied: "已应用", reverted: "已回退", dismissed: "已忽略" };
let origin: HTMLElement | null = null, stopLayer = () => {};
async function inspect(event: MouseEvent, kind: "turn" | "text", target: string) {
  origin = event.currentTarget as HTMLElement;
  if (kind === "turn") ask.openTurn(target as TurnId, true);
  else ask.openAttachment(target, true);
  await nextTick(); back.value?.focus({ preventScroll: true });
}
async function closePreview(refocus = true) {
  if (preview.value) ask.closeAttachment();
  await nextTick();
  if (refocus && origin?.isConnected) origin.focus({ preventScroll: true });
  origin = null;
}
function toggle() {
  opened.value = !opened.value;
  if (!opened.value) { void closePreview(false); root.value?.querySelector("summary")?.focus({ preventScroll: true }); }
}
async function tabKeys(event: KeyboardEvent, current: number) {
  const next = event.key === "ArrowRight" ? (current + 1) % tabs.value.length
    : event.key === "ArrowLeft" ? (current - 1 + tabs.value.length) % tabs.value.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.value.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault(); tab.value = tabs.value[next].id;
  await nextTick(); root.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
}
watch(opened, on => {
  stopLayer();
  if (on) stopLayer = ask.layer(() => {
    if (!root.value?.contains(document.activeElement)) return false;
    if (preview.value) void closePreview();
    else toggle();
    return true;
  });
});
watch(ask.visible, visible => { if (!visible) void closePreview(false); });
onBeforeUnmount(() => { stopLayer(); if (preview.value) ask.closeAttachment(); });
</script>
<template>
  <details v-if="ask.memory.value" ref="root" class="ask-memory" :open="opened" @keydown.tab.stop>
    <summary :aria-controls="`${id}-body`" @click.prevent="toggle"><AppIcon name="i-layers" /><span class="memory-label">已压缩前 {{ ask.memory.value.count }} 轮</span><span class="memory-line" aria-hidden="true"></span><small class="memory-tokens">约 {{ ask.memory.value.tokens.toLocaleString('zh-CN') }} tokens</small><AppIcon name="i-chevron" class="memory-chevron" /></summary>
    <div :id="`${id}-body`" class="memory-body">
      <div v-if="preview" class="memory-preview" role="region" :aria-label="preview.name">
        <div class="memory-preview-head"><button ref="back" type="button" class="memory-back" @click="closePreview()"><AppIcon name="i-chevron" />返回</button><span>{{ preview.name }}</span></div>
        <pre>{{ preview.text }}</pre>
        <button v-if="preview.turnId" class="memory-reference" type="button" :disabled="!ask.canManage.value || !!ask.preparing.value" @click="ask.referenceTurn()">引用到输入框</button>
      </div>
      <div v-show="!preview">
        <div class="memory-tabs" role="tablist" aria-label="压缩内容">
          <button v-for="(t, i) in tabs" :id="`${id}-tab-${t.id}`" :key="t.id" class="memory-tab" type="button" role="tab" :aria-selected="tab === t.id" :aria-controls="`${id}-panel-${t.id}`" :tabindex="tab === t.id ? 0 : -1" @click="tab = t.id" @keydown="tabKeys($event, i)">{{ t.label }}</button>
          <small class="memory-mobile-tokens">约 {{ ask.memory.value.tokens.toLocaleString('zh-CN') }} tokens</small>
        </div>
        <div v-show="tab === 'memo'" :id="`${id}-panel-memo`" role="tabpanel" :aria-labelledby="`${id}-tab-memo`">
          <div :id="`${id}-memo`" class="memory-memo" :class="{ full }" :inert="!full" aria-label="归档备忘录"><AskMarkdown :text="ask.memory.value.memo" /></div>
          <button class="memory-more" type="button" :aria-expanded="full" :aria-controls="`${id}-memo`" @click="full = !full">{{ full ? '收起全文' : '展开全文' }}</button>
        </div>
        <div v-show="tab === 'turns'" :id="`${id}-panel-turns`" class="memory-ledger" role="tabpanel" :aria-labelledby="`${id}-tab-turns`">
          <button v-for="row in ask.memory.value.ledger" :key="row.turnId" class="memory-turn" type="button" :aria-label="`查看 ${row.turnId} 原文`" :title="[row.context, row.draft ? [row.draft.scope.join('、'), row.draft.delta].filter(Boolean).join(' · ') : row.reply].filter(Boolean).join(' · ')" @click="inspect($event, 'turn', row.turnId)">
            <code>{{ row.turnId }}</code><span class="memory-entry">{{ row.draft?.title || row.ask || '附件提问' }}</span><small v-if="row.draft" class="memory-status">{{ statuses[row.draft.status] }}</small><span class="memory-go">原文<AppIcon name="i-chevron" /></span>
          </button>
        </div>
        <div v-if="ask.memory.value.attachments.length" v-show="tab === 'files'" :id="`${id}-panel-files`" class="memory-attachments" role="tabpanel" :aria-labelledby="`${id}-tab-files`">
          <component :is="a.kind === 'text' ? 'button' : 'div'" v-for="a in ask.memory.value.attachments" :key="a.id" class="memory-file" :type="a.kind === 'text' ? 'button' : undefined" :title="`${a.id} · ${a.name}`" @click="a.kind === 'text' && inspect($event, 'text', a.id)"><span class="memory-entry">{{ a.name }}</span><small>{{ a.total_chars !== undefined ? `${a.total_chars.toLocaleString('zh-CN')} 字` : `${a.size?.width}×${a.size?.height}` }}</small><span v-if="a.kind === 'text'" class="memory-go">预览<AppIcon name="i-chevron" /></span></component>
        </div>
      </div>
    </div>
  </details>
</template>
<style scoped>
/* The prototype's 14px stream gap plus 6px component margin becomes 20px here. */
.ask-memory { container-type: inline-size; margin: 20px 0; color: var(--fg-2); font-size: 13px; line-height: 22px; }
.ask-memory summary { display: flex; align-items: center; gap: 8px; min-height: 32px; list-style: none; border-radius: 6px; font-size: 14px; line-height: 20px; cursor: pointer; }
.ask-memory summary::-webkit-details-marker { display: none; }
.ask-memory summary > .ico { display: block; flex: none; --ico: var(--ico-md); color: var(--fg-3); }
.memory-label, .memory-tokens { display: block; flex: none; white-space: nowrap; }
.memory-tokens { color: var(--fg-3); font-size: 12px; line-height: 20px; font-variant-numeric: tabular-nums; }
.memory-line { flex: 1; min-width: 16px; height: 1px; background: var(--line-2); }
.ask-memory summary > .memory-chevron { --ico: var(--ico-sm); transition: transform var(--t1) var(--e); }
.ask-memory summary:hover .memory-label { color: var(--fg); }
.ask-memory[open] .memory-chevron { transform: rotate(90deg); }
.memory-body { margin: 4px 0 6px 8px; padding-left: 15px; border-left: 1px solid var(--line-2); }
.memory-tabs { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.memory-tab { flex: none; padding: 3px 0; color: var(--fg-3); border-bottom: 1px solid transparent; }
.memory-tab[aria-selected="true"] { color: var(--fg); border-color: var(--a); }
.memory-mobile-tokens { display: none; margin-left: auto; color: var(--fg-3); font-size: 12px; line-height: 20px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.memory-memo { max-height: 88px; overflow: hidden; line-height: 22px; overflow-wrap: anywhere; }
.memory-memo:not(.full) { mask-image: linear-gradient(#000 66px, transparent 88px); }
.memory-memo.full { max-height: 240px; overflow: auto; overscroll-behavior: contain; }
.memory-memo :deep(:is(h1, h2, h3, h4, h5, h6)) { font-size: 13px; line-height: 22px; }
.memory-more { margin-top: 4px; padding: 2px 0; color: var(--fg-3); }
.memory-ledger, .memory-attachments { max-height: 240px; overflow: auto; overscroll-behavior: contain; }
.memory-turn, .memory-file { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; min-height: 30px; padding: 0 6px; border-radius: 6px; text-align: left; }
.memory-turn:hover, button.memory-file:hover { background: var(--ask-hover); }
.memory-turn code { flex: none; min-width: 2.5ch; color: var(--fg-3); font: 12px/20px var(--mono); }
.memory-entry { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-status, .memory-file small { flex: none; color: var(--fg-3); font-size: 12px; }
.memory-go { display: flex; flex: none; align-items: center; gap: 2px; color: var(--fg-3); font-size: 12px; opacity: 0; }
.memory-go .ico { --ico: var(--ico-xs); }
:is(.memory-turn, .memory-file):is(:hover, :focus-visible) .memory-go { opacity: 1; }
.memory-preview-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.memory-preview-head > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memory-back { display: flex; flex: none; align-items: center; gap: 2px; color: var(--fg-3); }
.memory-back .ico { --ico: var(--ico-xs); transform: rotate(180deg); }
.memory-preview pre { max-height: 240px; margin: 0; overflow: auto; font: 13px/22px var(--sans); white-space: pre-wrap; overflow-wrap: anywhere; overscroll-behavior: contain; }
.memory-reference { margin-top: 6px; color: var(--a); }
:is(.memory-tab, .memory-more, .memory-back):hover { color: var(--fg); }
.ask-memory :is(summary, button):focus-visible { outline: 1px solid var(--a); outline-offset: 2px; border-radius: 2px; }
@container (max-width: 307px) { .memory-tokens { display: none; } .memory-mobile-tokens { display: block; } .memory-tabs { flex-wrap: wrap; } }
@media (hover: none) { .memory-go { opacity: 1; } .memory-turn, .memory-file { min-height: 36px; } }
@media (prefers-reduced-motion: reduce) { .memory-chevron { transition: none; } }
</style>
