<script setup lang="ts">
import { computed, h, onBeforeUnmount, shallowRef, watch } from "vue";
import type { FunctionalComponent } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import AskReference from "./AskReference.vue";
import { blocks, inline } from "./format.ts";
import type { Inline } from "./format.ts";
import type { AskEntry, AskTurnView, RetryMode, ToolRow } from "./service.ts";

const ask = useAsk();
// The live turn keeps its id when it settles, so its nodes stay put.
const all = computed<readonly AskEntry[]>(() => {
  const live = ask.live.value;
  return live ? [...ask.entries.value, { type: "turn", id: live.id, turn: live }] : ask.entries.value;
});
const scroller = shallowRef<HTMLElement | null>(null);

/** Model text becomes text nodes and three inline elements, never HTML. */
const Parts: FunctionalComponent<{ parts: readonly Inline[] }> = (props) =>
  props.parts.map((p) =>
    p.t === "text"
      ? p.v
      : p.t === "id" ? h(AskReference, { label: p.v }) : h(p.t, null, p.v),
  );
Parts.props = ["parts"];

const icons: Record<string, string> = { get_state: "i-layers", search_history: "i-search", get_meta: "i-info", diff_meta: "i-layers", view_image: "i-image", view_sheet: "i-layers", search_tags: "i-search", propose_draft: "i-edit" };
const rowText = (row: ToolRow) =>
  row.state === "run"
    ? `正在${row.verb} ${row.object}`
    : row.state === "stopped"
      ? `已停止${row.verb}`
      : row.state === "error"
        ? `未能${row.verb}`
        : `已${row.verb}`;
/** The conclusion leads the last stretch of text once the turn is done. */
function leadOf(turn: AskTurnView) {
  if (turn.status !== "done") return -1;
  for (let i = turn.items.length - 1; i >= 0; i--)
    if (turn.items[i].kind === "text") return i;
  return -1;
}
const filtered = (kind: string | undefined) => kind === "rejected" || kind === "empty";
function retries(turn: AskTurnView): { mode: RetryMode; label: string }[] {
  if (!filtered(turn.failure?.kind)) return [{ mode: "plain", label: "重试" }];
  return [
    ...(ask.adult.value && !ask.codecActive.value
      ? [{ mode: "codec" as const, label: "启用词表混淆并重试" }]
      : []),
    { mode: "metadata", label: turn.metadataOnly ? "重试" : "仅发元数据重试" },
  ];
}

// Follow the tail while a turn streams; scrolling up lets go until the bottom again.
let follow = true,
  frame = 0,
  placed = 0;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 4;
function step() {
  const el = scroller.value;
  frame = 0;
  if (!el) return;
  if (follow) {
    const target = el.scrollHeight - el.clientHeight,
      gap = target - el.scrollTop;
    if (reduced.matches || Math.abs(gap) < 1) el.scrollTop = target;
    else el.scrollTop += gap * 0.18;
    placed = el.scrollTop;
  }
  if (ask.running.value || (follow && !atBottom(el))) frame = requestAnimationFrame(step);
}
function wake() {
  if (!frame) frame = requestAnimationFrame(step);
}
function wheel(event: WheelEvent) {
  if (event.deltaY < 0) follow = false;
  else if (scroller.value && atBottom(scroller.value)) follow = true;
}
function scrolled() {
  const el = scroller.value;
  if (!el) return;
  if (atBottom(el)) follow = true;
  else if (el.scrollTop < placed - 2) follow = false;
}
watch(ask.running, (on) => {
  if (on) follow = true;
  wake();
});
watch([ask.live, ask.entries], wake, { flush: "post" });
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>
<template>
  <div
    ref="scroller"
    class="ask-stream"
    @wheel.passive="wheel"
    @scroll.passive="scrolled"
  >
    <p v-if="ask.ready.value === 'local'" class="ask-empty">本地模式暂不支持 ASK</p>
    <div
      v-else-if="ask.ready.value !== 'ok' && !ask.entries.value.length"
      class="ask-empty"
    >
      <p>{{ ask.ready.value === "connection" ? "选择 ASK 连接与模型后即可提问" : "填写 ASK 模型 ID 后即可提问" }}</p>
      <button class="btn btn-sm btn-quiet" type="button" @click="ask.openSettings()">
        <AppIcon name="i-settings" />设置
      </button>
    </div>
    <template v-for="entry in all" :key="entry.id">
      <p v-if="entry.type === 'note'" :class="entry.action ? 'ask-action' : 'ask-note'">{{ entry.text }}</p>
      <section
        v-else
        v-memo="[entry, ask.adult.value, ask.codecActive.value, ask.libraryRevision.value]"
        class="ask-turn"
        :data-status="entry.turn.status"
        :aria-busy="entry.turn === ask.live.value || undefined"
      >
        <div class="ask-u">
          <p class="ask-q"><Parts :parts="inline(entry.turn.question)" /></p>
        </div>
        <div v-if="entry.turn.status === 'thinking'" class="ask-tools">
          <div class="ask-tool" data-state="run"><span class="ask-tool-text">正在思考</span></div>
        </div>
        <template v-for="(item, i) in entry.turn.items" :key="i">
          <div v-if="item.kind === 'tools'" class="ask-tools">
            <div v-for="row in item.rows" :key="row.id" class="ask-tool" :data-state="row.state">
              <AppIcon :name="icons[row.name] ?? 'i-info'" />
              <span class="ask-tool-text">{{ rowText(row) }}</span>
              <span v-if="row.state !== 'run'" class="ask-tool-object">{{ row.object }}</span>
              <span v-if="row.stat" class="ask-tool-stat">{{ row.stat }}</span>
            </div>
          </div>
          <div v-else-if="item.kind === 'pick'" class="ask-pick" role="group" aria-label="选择要分析的图片">
            <button v-for="id in item.ids" :key="id" type="button" :disabled="!ask.pictureInfo(id)" :aria-label="`选择 ${id} 继续提问`" @click="ask.pick(id)">
              <img v-if="ask.pictureInfo(id)" :src="ask.pictureInfo(id)!.url" alt="" /><span>{{ id }}</span>
            </button>
          </div>
          <template v-for="(block, j) in blocks(item.kind === 'text' ? item.text : '')" v-else :key="`${i}.${j}`">
            <p v-if="block.t === 'p'" :class="{ 'ask-lead': j === 0 && i === leadOf(entry.turn) }">
              <Parts :parts="block.parts" />
            </p>
            <component :is="block.t" v-else>
              <li v-for="(parts, k) in block.items" :key="k"><Parts :parts="parts" /></li>
            </component>
          </template>
        </template>
        <p v-if="entry.turn.truncated" class="ask-meta">回复已达输出上限</p>
        <div v-if="entry.turn.status === 'failed' || entry.turn.status === 'stopped'" class="ask-fail">
          <p class="ask-fail-text">
            <AppIcon :name="entry.turn.status === 'stopped' ? 'i-stop' : 'i-alert'" />
            <span>{{ entry.turn.status === "stopped" ? "已停止，本轮未计入对话" : entry.turn.failure?.message }}</span>
          </p>
          <div class="ask-fail-actions">
            <button
              v-for="r in retries(entry.turn)"
              :key="r.mode"
              class="btn btn-sm btn-quiet"
              type="button"
              @click="ask.retry(entry.id, r.mode)"
            >
              {{ r.label }}
            </button>
            <button
              v-if="filtered(entry.turn.failure?.kind) && !ask.adult.value"
              class="btn btn-sm btn-quiet"
              type="button"
              @click="ask.openSettings()"
            >
              设置
            </button>
          </div>
          <p v-if="filtered(entry.turn.failure?.kind) && !ask.adult.value" class="ask-meta">
            可在设置 → ASK 确认成年内容后启用词表混淆
          </p>
        </div>
      </section>
    </template>
  </div>
</template>
<style scoped>
.ask-stream { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 4px 24px 24px; scrollbar-width: none; color: var(--fg); font: var(--fw-regular) var(--fz-md)/1.7 var(--sans); }
.ask-stream::-webkit-scrollbar { display: none; }
.ask-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-3); min-height: 100%; color: var(--fg-4); font-size: var(--fz-sm); text-align: center; }
.ask-turn { display: flex; flex-direction: column; }
.ask-turn + .ask-turn { margin-top: 30px; }
.ask-turn > * + * { margin-top: 12px; }
.ask-turn > p + p, .ask-turn > p + ul, .ask-turn > p + ol { margin-top: 6px; }
.ask-turn > .ask-lead { margin-top: 16px; }
.ask-turn > *, .ask-tool { animation: ask-fade var(--t3) cubic-bezier(.25, .1, .25, 1) both, ask-rise var(--t3) cubic-bezier(.2, .7, .2, 1) both; }
.ask-u { align-self: flex-end; max-width: 84%; }
.ask-q { padding: 7px 15px; color: var(--fg); background: var(--hover); border-radius: 18px; overflow-wrap: anywhere; white-space: pre-wrap; }
.ask-turn p, .ask-turn li { overflow-wrap: anywhere; white-space: pre-line; }
.ask-lead { font-weight: var(--fw-semibold); }
.ask-turn ul, .ask-turn ol { display: flex; flex-direction: column; gap: 2px; padding-left: 20px; }
.ask-turn li::marker { color: var(--fg-4); }
.ask-stream :deep(code) { padding: 1px 5px; font: inherit; font-family: var(--mono); font-size: var(--fz-sm); background: rgba(255, 255, 255, .08); border-radius: var(--r1); }
.ask-stream :deep(.ask-id) { font-family: var(--mono); font-size: var(--fz-sm); color: var(--a); }
.ask-stream :deep(strong) { font-weight: var(--fw-semibold); }
.ask-tools { display: flex; flex-direction: column; }
.ask-action { margin-top: 16px; color: var(--fg-3); font-size: var(--fz-sm); }
.ask-pick { display: flex; gap: 10px; overflow-x: auto; }
.ask-pick button { display: flex; flex: none; flex-direction: column; gap: 5px; align-items: center; padding: 2px; color: var(--a); font: var(--fw-regular) var(--fz-xs)/1.4 var(--mono); border: 1px solid transparent; border-radius: 9px; }
.ask-pick button:hover, .ask-pick button:focus-visible { border-color: var(--a); }
.ask-pick button:disabled { color: var(--fg-4); }
.ask-pick img { width: 64px; height: 86px; object-fit: cover; border-radius: 7px; }
.ask-tool { display: flex; align-items: center; gap: 9px; min-height: 26px; color: var(--fg-4); font-size: var(--fz-sm); }
.ask-tool .ico { flex: none; width: 15px; height: 15px; }
.ask-tool-object { min-width: 0; overflow: hidden; color: var(--fg-3); text-overflow: ellipsis; white-space: nowrap; }
.ask-tool-stat { flex: none; margin-left: 2px; font: var(--fw-regular) var(--fz-xs)/1 var(--mono); }
.ask-tool[data-state="error"] .ico { color: var(--err); }
.ask-tool[data-state="done"] .ask-tool-text { animation: ask-fade var(--t2) cubic-bezier(.4, 0, .2, 1) both; }
.ask-tool[data-state="run"] .ask-tool-text { color: transparent; background: linear-gradient(90deg, var(--fg-3) 0%, var(--fg) 50%, var(--fg-3) 100%) 100% 0 / 250% 100%; background-clip: text; animation: ask-sheen 2.4s ease-in-out infinite; }
.ask-note { margin: 30px 0 16px; color: var(--fg-4); font-size: var(--fz-sm); }
.ask-meta { color: var(--fg-4); font-size: var(--fz-xs); }
.ask-fail { display: flex; flex-direction: column; gap: var(--sp-2); }
.ask-fail-text { display: flex; align-items: flex-start; gap: var(--sp-2); color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.5; }
.ask-fail-text .ico { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--err); }
.ask-turn[data-status="stopped"] .ask-fail-text .ico { color: var(--fg-4); }
.ask-fail-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
@keyframes ask-fade { from { opacity: 0; } }
@keyframes ask-rise { from { transform: translateY(4px); } }
@keyframes ask-sheen { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) {
  .ask-turn > *, .ask-tool { animation: ask-fade var(--t1) linear both; }
  .ask-tool[data-state="run"] .ask-tool-text { color: var(--fg-3); background: none; animation: none; }
  .ask-tool[data-state="run"] .ask-tool-text::after { content: "…"; }
}
</style>
