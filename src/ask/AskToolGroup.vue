<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import AppIcon from "../shared/AppIcon.vue";
import type { ToolRow } from "./service.ts";
import { toolIcons as icons } from "./presentation.ts";
const props = defineProps<{ rows: readonly ToolRow[]; reverted?: boolean; source?: string; label?: string }>();
const expanded = shallowRef<boolean | null>(null);
const open = computed(() => expanded.value ?? props.rows.some(r => r.state === 'error' || !!r.reason));
watch(() => props.rows, () => { if (props.rows.some(r => r.state === 'error')) expanded.value = true; });
const rowText = (row: ToolRow) =>
  row.state === "run"
    ? `正在${row.verb} ${row.object}`
    : row.state === "stopped"
      ? `已停止${row.verb}`
      : row.state === "error"
        ? `未能${row.verb}`
        : `已${row.verb}`;
/** One disclosure line per tool group; a finished draft keeps its row, so the line never blinks out before the card. */
function summary(rows: readonly ToolRow[]) {
  const run = rows.find((r) => r.state === "run");
  if (run) return `正在${run.verb} ${run.object}`.trim();
  return rows.map((r, n) => (r.state === "done" ? `${n && rows[n - 1].state === "done" ? "" : "已"}${r.verb} ${r.object}`
    : r.state === "error" ? `未能${r.verb} ${r.object}` : `已停止${r.verb}`).trim()).join("、");
}
</script>
<template>
  <div class="ask-tool-group">
    <div class="tool-summary-head"><button class="ask-tools-line" type="button" :aria-expanded="open" @click="expanded = !open"><span :key="rows.find(r => r.state === 'run')?.id ?? 'settled'" class="ask-tools-summary" :class="{ run: rows.some(r => r.state === 'run') }">{{ reverted ? '已回退 · ' + (label ? '本次更改' : rows.map(r => r.object).join('、')) : label || summary(rows) }}</span><AppIcon name="i-chevron" /></button><span v-if="source" class="tool-origin" :title="source">来自外部</span><slot name="action" /></div>
    <div v-show="open" class="ask-tools">
      <p v-if="source" class="tool-source">来自 {{ source }}</p>
      <div v-for="row in rows" :key="row.id" class="ask-tool" :data-state="row.state"><div class="ask-tool-head"><AppIcon :name="icons[row.name] ?? 'i-info'" /><span class="ask-tool-text">{{ reverted ? '已回退' : rowText(row) }}</span><span v-if="row.state !== 'run'" class="ask-tool-object">{{ row.object }}</span><span v-if="row.stat" class="ask-tool-stat">{{ row.stat }}</span></div><span v-if="row.reason" class="ask-tool-reason">{{ row.reason }}</span></div>
    </div>
  </div>
</template>
<style scoped>
.tool-summary-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tool-summary-head > .ask-tools-line { flex: 0 1 auto; min-width: 0; margin-top: 0; }
.tool-summary-head + .ask-tools { margin: 0 0 6px; padding-left: 12px; border-left: 1px solid var(--line-2); }
/* Tool groups: one disclosure line each, opening directly beneath it. */
.ask-tools-line { display: flex; align-items: center; gap: 4px; max-width: calc(100% + 6px); width: fit-content; margin: 8px 0 2px -6px; padding: 0 6px; color: var(--fg-3); font-size: 13px; line-height: 26px; text-align: left; border-radius: 7px; }
.ask-tools-line:hover { color: var(--fg-2); background: var(--ask-hover, var(--hover)); }
.ask-tools-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-tools-line .ico { flex: none; --ico: var(--ico-xs); transition: transform var(--t1) var(--e); }
.ask-tools-line[aria-expanded="true"] .ico { transform: rotate(90deg); }
.ask-tools { display: flex; flex-direction: column; }
.tool-source { color: var(--fg-3); font-size: 11px; line-height: 22px; }
.tool-origin { flex: none; color: var(--fg-4); font-size: 11px; line-height: 26px; }
.ask-tool { min-width: 0; min-height: 22px; color: var(--fg-3); font-size: 12px; line-height: 22px; animation: ask-fade var(--t3) cubic-bezier(.25, .1, .25, 1) both, ask-rise var(--t3) cubic-bezier(.2, .7, .2, 1) both; }
.ask-tool-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; min-height: 22px; }
.ask-tool .ico { flex: none; align-self: center; --ico: var(--ico-sm); }
.ask-tool-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-tool:not([data-state="run"]) .ask-tool-text { flex: none; }
.ask-tool-object { min-width: 0; overflow: hidden; color: var(--fg-2); font-weight: var(--fw-medium); text-overflow: ellipsis; white-space: nowrap; }
.ask-tool-stat { flex: none; margin-left: 2px; color: var(--fg-4); font: var(--fw-regular) 12px/1 var(--sans); font-variant-numeric: tabular-nums; }
.ask-tool[data-state="error"] .ico { color: var(--err); }
.ask-tool[data-state="done"]:has(.ask-tool-reason) .ico { color: var(--warn); }
.ask-tool-reason { display: block; min-width: 0; padding: 0 0 4px 20px; color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.ask-tool[data-state="done"] .ask-tool-text { animation: ask-fade var(--t2) cubic-bezier(.4, 0, .2, 1) both; }
/* Running text: a soft band sweeps at constant speed over a dim plateau.
   The summary is keyed by its running tool, so each new tool starts a fresh pass. */
.ask-tools-summary.run, .ask-tool[data-state="run"] .ask-tool-text { color: transparent; background: linear-gradient(90deg, var(--fg-3) 0% 26%, color-mix(in srgb, var(--fg) 22%, var(--fg-3)) 35%, color-mix(in srgb, var(--fg) 72%, var(--fg-3)) 44%, var(--fg) 50%, color-mix(in srgb, var(--fg) 72%, var(--fg-3)) 56%, color-mix(in srgb, var(--fg) 22%, var(--fg-3)) 65%, var(--fg-3) 74% 100%) 130% 0 / 200% 100%; background-clip: text; animation: ask-sheen 2.4s linear infinite; }

@keyframes ask-sheen { to { background-position: -70% 0; } }
@keyframes ask-fade { from { opacity: 0; } }
@keyframes ask-rise { from { transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .ask-tool { animation: ask-fade var(--t1) linear both; } .ask-tools-summary.run, .ask-tool[data-state="run"] .ask-tool-text { animation: none; color: var(--fg-3); background: none; } .ask-tool[data-state="run"] .ask-tool-text::after { content: "…"; } .ask-tools-line .ico { transition: none; } }
</style>
