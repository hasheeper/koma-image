<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { useUi } from "../app/ui";
import AppIcon from "../shared/AppIcon.vue";
import { copyText } from "../shared/files.ts";
import AskMark from "./AskMark.vue";
import AskMarkdown from "./AskMarkdown.vue";
import AskCheckpoint from "./AskCheckpoint.vue";
import AskEdit from "./AskEdit.vue";
import AskAttachments from "./AskAttachments.vue";
import type { AskEntry, AskTurnView, RetryMode, ToolRow } from "./service.ts";

const ask = useAsk(), ui = useUi();
const emit = defineEmits<{ start: [text: string]; focus: [] }>();
// The live turn keeps its id when it settles, so its nodes stay put.
const all = computed<readonly AskEntry[]>(() => {
  const live = ask.live.value;
  return live ? [...ask.entries.value, { type: "turn", id: live.id, turn: live }] : ask.entries.value;
});
const scroller = shallowRef<HTMLElement | null>(null);
const editing = shallowRef<number | null>(null);
function edit(id: number) {
  if (!ask.canManage.value) return;
  follow = false;
  editing.value = id;
}
function fork(id: number) { if (ask.forkTurn(id) === true) emit("focus"); }

const icons: Record<string, string> = { get_state: "i-layers", search_history: "i-search", get_meta: "i-info", diff_meta: "i-layers", view_image: "i-image", view_sheet: "i-layers", search_tags: "i-search", propose_draft: "i-edit", get_chat_context: "i-layers", get_model_manual: "i-info" };
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
/** One disclosure line per tool group; a finished draft keeps its row, so the line never blinks out before the card. */
function summary(rows: readonly ToolRow[]) {
  const run = rows.find((r) => r.state === "run");
  if (run) return `正在${run.verb} ${run.object}`.trim();
  return rows.map((r, n) => (r.state === "done" ? `${n && rows[n - 1].state === "done" ? "" : "已"}${r.verb} ${r.object}`
    : r.state === "error" ? `未能${r.verb} ${r.object}` : `已停止${r.verb}`).trim()).join("、");
}
// Overrides per turn; partial failures also expose their explanation.
const opened = shallowRef<ReadonlyMap<number, ReadonlyMap<number, boolean>>>(new Map());
const isOpen = (turn: number, index: number, rows: readonly ToolRow[]) =>
  opened.value.get(turn)?.get(index) ?? rows.some((r) => r.state === "error" || !!r.reason);
function toggleTools(turn: number, index: number, rows: readonly ToolRow[]) {
  const next = new Map(opened.value), groups = new Map(next.get(turn));
  groups.set(index, !isOpen(turn, index, rows));
  next.set(turn, groups);
  opened.value = next;
}

/** Reply text for copying: the prose blocks only, no tool lines or picks. */
const replyText = (turn: AskTurnView) => turn.items.flatMap((i) => (i.kind === "text" && i.text.trim() ? [i.text.trim()] : [])).join("\n\n");
const copied = shallowRef("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(key: string, text: string) {
  try {
    await copyText(text);
    copied.value = key;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = ""), 1500);
  } catch {
    ui.toast("复制失败", "err");
  }
}
// Touch screens have no hover: tapping a question toggles its actions.
const touch = window.matchMedia("(hover: none)");
const revealed = shallowRef(0);
function reveal(id: number) {
  if (touch.matches) revealed.value = revealed.value === id ? 0 : id;
}
const starters = computed(() => [
  { icon: "i-image", text: `说说 ${ask.anchor.value ?? ask.current.value ?? "当前图"} 现在的画面` },
  { icon: "i-swap", text: "换一个相似的场景，人物不变" },
  { icon: "i-search", text: "找出 Prompt 里互相冲突的 tag" },
]);

const filtered = (kind: string | undefined) => kind === "rejected" || kind === "empty";
const codecAvailable = computed(() => ask.adult.value && ask.settings.value.words.length > 0);
function retries(turn: AskTurnView): { mode: RetryMode; label: string }[] {
  if (!filtered(turn.failure?.kind)) return [{ mode: "plain", label: "重试" }];
  return [
    ...(codecAvailable.value && !ask.codecActive.value
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
  if (follow && editing.value === null) {
    const target = el.scrollHeight - el.clientHeight,
      gap = target - el.scrollTop;
    if (reduced.matches || Math.abs(gap) < 1) el.scrollTop = target;
    else el.scrollTop += gap * 0.18;
    placed = el.scrollTop;
  }
  if (ask.running.value || (follow && editing.value === null && !atBottom(el))) frame = requestAnimationFrame(step);
}
function wake() {
  if (!frame) frame = requestAnimationFrame(step);
}
function wheel(event: WheelEvent) {
  if (event.deltaY < 0) follow = false;
  else if (editing.value === null && scroller.value && atBottom(scroller.value)) follow = true;
}
function scrolled() {
  const el = scroller.value;
  if (!el) return;
  if (editing.value === null && atBottom(el)) follow = true;
  else if (el.scrollTop < placed - 2) follow = false;
}
watch(ask.running, (on) => {
  if (on) { editing.value = null; follow = true; }
  wake();
});
watch([ask.live, ask.entries], wake, { flush: "post" });
// Another conversation opens at its end, without the follow animation.
watch(ask.conversationId, () => {
  editing.value = null;
  opened.value = new Map();
  const el = scroller.value;
  follow = true;
  if (el) placed = el.scrollTop = el.scrollHeight;
}, { flush: "post" });
// A draft card opening below shrinks the stream; keep the tail in view.
const resized = new ResizeObserver(() => { if (follow) wake(); });
onMounted(() => { if (scroller.value) resized.observe(scroller.value); });
onBeforeUnmount(() => { resized.disconnect(); cancelAnimationFrame(frame); clearTimeout(copiedTimer); });
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
    <div v-else-if="!all.length" class="ask-start">
      <div class="ask-start-lock"><AskMark class="ask-start-mark" /><span class="ask-start-word"><span class="brand-title">Koma</span><span class="brand-subtitle">ASK</span></span></div>
      <div class="ask-starters">
        <button v-for="s in starters" :key="s.icon" class="ask-starter" type="button" @click="emit('start', s.text)"><AppIcon :name="s.icon" /><span>{{ s.text }}</span></button>
      </div>
    </div>
    <template v-for="entry in all" :key="entry.id">
      <p v-if="entry.type === 'note'" class="ask-note">{{ entry.text }}</p>
      <section
        v-else
        v-memo="[entry, ask.adult.value, codecAvailable, ask.codecActive.value, ask.libraryRevision.value, opened.get(entry.id), copied.slice(1) === String(entry.id) && copied, revealed === entry.id, editing === entry.id, ask.undoId.value, ask.redoId.value, ask.writingDraft.value, ask.running.value]"
        class="ask-turn"
        :class="{ revealed: revealed === entry.id }"
        :data-status="entry.turn.status"
        :aria-busy="entry.turn === ask.live.value || undefined"
      >
        <template v-if="editing === entry.id">
          <AskAttachments :items="entry.turn.attachments" sent :dim="entry.turn.metadataOnly" />
          <AskEdit :id="entry.id" :question="entry.turn.question" :has-attachments="!!entry.turn.attachments.length" @cancel="editing = null" />
        </template>
        <div v-else class="ask-u" @click="reveal(entry.id)">
          <AskAttachments :items="entry.turn.attachments" sent :dim="entry.turn.metadataOnly" />
          <p v-if="entry.turn.question" class="ask-q"><AskMarkdown :text="entry.turn.question" inline-only /></p>
        </div>
        <div v-if="entry.turn !== ask.live.value && editing !== entry.id" class="ask-acts ask-q-acts">
          <button v-if="entry.turn.question" class="ask-act" type="button" :aria-label="copied === `q${entry.id}` ? '已复制提问' : '复制提问'" title="复制" @click="copy(`q${entry.id}`, entry.turn.question)"><AppIcon :name="copied === `q${entry.id}` ? 'i-check' : 'i-copy'" /></button>
          <button class="ask-act" type="button" aria-label="编辑提问" title="编辑" :disabled="!ask.canManage.value" @click="edit(entry.id)"><AppIcon name="i-edit" /></button>
        </div>
        <div v-if="entry.turn.status === 'thinking'" class="ask-tools ask-thinking">
          <div class="ask-tool" data-state="run"><span class="ask-tool-text">正在思考</span></div>
        </div>
        <template v-for="(item, i) in entry.turn.items" :key="i">
          <template v-if="item.kind === 'tools'">
            <button class="ask-tools-line" type="button" :aria-expanded="isOpen(entry.id, i, item.rows)" @click="toggleTools(entry.id, i, item.rows)"><span class="ask-tools-summary" :class="{ run: item.rows.some(r => r.state === 'run') }">{{ summary(item.rows) }}</span><AppIcon name="i-chevron" /></button>
            <div v-show="isOpen(entry.id, i, item.rows)" class="ask-tools">
              <div v-for="row in item.rows" :key="row.id" class="ask-tool" :data-state="row.state">
                <div class="ask-tool-head">
                  <AppIcon :name="icons[row.name] ?? 'i-info'" />
                  <span class="ask-tool-text">{{ rowText(row) }}</span>
                  <span v-if="row.state !== 'run'" class="ask-tool-object">{{ row.object }}</span>
                  <span v-if="row.stat" class="ask-tool-stat">{{ row.stat }}</span>
                </div>
                <span v-if="row.reason" class="ask-tool-reason">{{ row.reason }}</span>
              </div>
            </div>
          </template>
          <div v-else-if="item.kind === 'pick'" class="ask-pick" role="group" aria-label="选择要分析的图片">
            <button v-for="id in item.ids" :key="id" type="button" :disabled="!ask.pictureInfo(id)" :aria-label="`选择 ${id} 继续提问`" @click="ask.pick(id)">
              <img v-if="ask.pictureInfo(id)" :src="ask.pictureInfo(id)!.url" alt="" /><span>{{ id }}</span>
            </button>
          </div>
          <AskMarkdown v-else :text="item.text" :lead="i === leadOf(entry.turn)" />
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
              v-if="filtered(entry.turn.failure?.kind) && !codecAvailable"
              class="btn btn-sm btn-quiet"
              type="button"
              @click="ask.openSettings()"
            >
              设置
            </button>
          </div>
          <p v-if="filtered(entry.turn.failure?.kind) && !ask.adult.value" class="ask-meta">
            可在设置 → ASK 开启自由创作后启用词表混淆
          </p>
        </div>
        <AskCheckpoint v-if="entry.turn.checkpoint" :checkpoint="entry.turn.checkpoint" />
        <div v-if="entry.turn !== ask.live.value && (replyText(entry.turn) || entry.turn.committed !== null)" class="ask-acts ask-a-acts">
          <button v-if="replyText(entry.turn)" class="ask-act" type="button" :aria-label="copied === `a${entry.id}` ? '已复制回答' : '复制回答'" title="复制" @click="copy(`a${entry.id}`, replyText(entry.turn))"><AppIcon :name="copied === `a${entry.id}` ? 'i-check' : 'i-copy'" /></button>
          <button v-if="entry.turn.status === 'done' && entry.turn.committed !== null" class="ask-act" type="button" aria-label="从此处分支" title="分支" :disabled="!ask.canManage.value" @click="fork(entry.id)"><AppIcon name="i-branch" /></button>
        </div>
      </section>
    </template>
  </div>
</template>
<style scoped>
.ask-stream { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 2px 16px 16px; scrollbar-width: none; color: color-mix(in srgb, var(--fg) 78%, var(--fg-2)); font: var(--fw-regular) 13px/1.72 var(--sans); }
.ask-stream::-webkit-scrollbar { display: none; }
.ask-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-3); min-height: 100%; color: var(--fg-4); font-size: var(--fz-sm); text-align: center; }
/* Empty conversation: the site's lockup (mark + Fredoka wordmark) above three starters. */
.ask-start { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; min-height: 100%; padding: 24px 8px 40px; }
.ask-start-lock { display: inline-flex; align-items: center; gap: 12px; }
.ask-start-mark { width: 34px; height: 34px; }
.ask-start-word { display: inline-flex; align-items: baseline; gap: 7px; line-height: 1; }
.ask-start-word .brand-title { font-size: 28px; }
.ask-start-word .brand-subtitle { font-size: 11px; letter-spacing: .14em; }
.ask-starters { display: grid; width: min(100%, 300px); overflow: hidden; background: var(--ask-field, var(--well)); border: 1px solid var(--line); border-radius: 12px; }
.ask-starter { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; color: var(--fg-2); font-size: 13px; line-height: 1.4; text-align: left; }
.ask-starter + .ask-starter { border-top: 1px solid var(--line); }
.ask-starter .ico { flex: none; width: 16px; height: 16px; color: var(--fg-3); }
.ask-starter:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-starter:hover .ico { color: var(--a); }
.ask-turn { display: flex; flex-direction: column; }
.ask-turn + .ask-turn { margin-top: 30px; }
.ask-turn > * + * { margin-top: 12px; }
.ask-turn > p + p, .ask-turn > p + ul, .ask-turn > p + ol { margin-top: 6px; }
.ask-turn > *, .ask-tool { animation: ask-fade var(--t3) cubic-bezier(.25, .1, .25, 1) both, ask-rise var(--t3) cubic-bezier(.2, .7, .2, 1) both; }
.ask-u { display: flex; flex-direction: column; align-items: flex-end; align-self: flex-end; max-width: 84%; }
.ask-q { padding: 6px 12px; color: var(--fg); font-size: 13px; line-height: 1.6; background: var(--ask-hover, var(--hover)); border-radius: 14px; overflow-wrap: anywhere; white-space: pre-wrap; }
.ask-turn p { overflow-wrap: anywhere; white-space: pre-line; }
.ask-stream :deep(.ask-id) { font-family: var(--mono); font-size: var(--fz-sm); color: var(--a); }
/* Question actions sit bottom-right; answer actions sit bottom-left. */
.ask-acts { display: flex; align-items: center; gap: 2px; height: 28px; }
.ask-turn > .ask-q-acts { align-self: flex-end; margin: 4px -4px 10px 0; }
.ask-turn > .ask-q-acts + * { margin-top: 0; }
.ask-turn > .ask-a-acts { align-self: flex-start; margin: 6px 0 -6px -6px; }
.ask-turn > .ask-checkpoint { margin-top: 8px; }
.ask-turn > .ask-checkpoint + .ask-a-acts { margin-top: 4px; }
.ask-act { display: grid; place-items: center; width: 28px; height: 28px; color: var(--fg-3); border-radius: 8px; opacity: 0; transition: opacity var(--t1) var(--e); }
.ask-act .ico { width: 15px; height: 15px; }
.ask-act:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-u:hover + .ask-q-acts .ask-act, .ask-acts:is(:hover, :focus-within) .ask-act, .ask-turn:hover > .ask-a-acts .ask-act, .ask-turn:last-of-type > .ask-a-acts .ask-act { opacity: 1; }
/* Tool groups: one disclosure line each, opening directly beneath it. */
.ask-tools-line { display: flex; align-items: center; gap: 4px; max-width: calc(100% + 6px); width: fit-content; margin: 8px 0 2px -6px; padding: 0 6px; color: var(--fg-3); font-size: 13px; line-height: 26px; text-align: left; border-radius: 7px; }
.ask-turn > .ask-tools-line { margin-top: 8px; }
.ask-tools-line:hover { color: var(--fg-2); background: var(--ask-hover, var(--hover)); }
.ask-tools-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-tools-summary.run { color: transparent; background: linear-gradient(90deg, var(--fg-3) 0%, var(--fg) 50%, var(--fg-3) 100%) 100% 0 / 250% 100%; background-clip: text; animation: ask-sheen 2.4s ease-in-out infinite; }
.ask-tools-line .ico { flex: none; width: 12px; height: 12px; transition: transform var(--t1) var(--e); }
.ask-tools-line[aria-expanded="true"] .ico { transform: rotate(90deg); }
.ask-tools { display: flex; flex-direction: column; }
.ask-turn > .ask-tools-line + .ask-tools { margin: 0 0 6px; padding-left: 12px; border-left: 1px solid var(--line-2); }
.ask-turn > .ask-thinking { margin-top: 8px; }
.ask-thinking .ask-tool { font-size: 13px; line-height: 26px; }
.ask-pick { display: flex; gap: 10px; overflow-x: auto; }
.ask-pick button { display: flex; flex: none; flex-direction: column; gap: 5px; align-items: center; padding: 2px; color: var(--a); font: var(--fw-regular) var(--fz-xs)/1.4 var(--mono); border: 1px solid transparent; border-radius: 9px; }
.ask-pick button:hover, .ask-pick button:focus-visible { border-color: var(--a); }
.ask-pick button:disabled { color: var(--fg-4); }
.ask-pick img { width: 64px; height: 86px; object-fit: cover; border-radius: 7px; }
.ask-tool { min-width: 0; min-height: 22px; color: var(--fg-3); font-size: 12px; line-height: 22px; }
.ask-tool-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; min-height: 22px; }
.ask-tool .ico { flex: none; align-self: center; width: 14px; height: 14px; }
.ask-tool-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-tool:not([data-state="run"]) .ask-tool-text { flex: none; }
.ask-tool-object { min-width: 0; overflow: hidden; color: var(--fg-2); font-weight: var(--fw-medium); text-overflow: ellipsis; white-space: nowrap; }
.ask-tool-stat { flex: none; margin-left: 2px; color: var(--fg-4); font: var(--fw-regular) 12px/1 var(--sans); font-variant-numeric: tabular-nums; }
.ask-tool[data-state="error"] .ico { color: var(--err); }
.ask-tool[data-state="done"]:has(.ask-tool-reason) .ico { color: var(--warn); }
.ask-tool-reason { display: block; min-width: 0; padding: 0 0 4px 20px; color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.ask-tool[data-state="done"] .ask-tool-text { animation: ask-fade var(--t2) cubic-bezier(.4, 0, .2, 1) both; }
.ask-tool[data-state="run"] .ask-tool-text { color: transparent; background: linear-gradient(90deg, var(--fg-3) 0%, var(--fg) 50%, var(--fg-3) 100%) 100% 0 / 250% 100%; background-clip: text; animation: ask-sheen 2.4s ease-in-out infinite; }
.ask-note { margin: 30px 0 16px; color: var(--fg-4); font-size: var(--fz-sm); }
.ask-meta { color: var(--fg-4); font-size: var(--fz-xs); }
.ask-fail { display: flex; flex-direction: column; gap: var(--sp-2); }
.ask-fail-text { display: flex; align-items: flex-start; gap: var(--sp-2); color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.5; }
.ask-fail-text .ico { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--err); }
.ask-turn[data-status="stopped"] .ask-fail-text .ico { color: var(--fg-4); }
.ask-fail-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
@media (hover: none) {
  .ask-acts { height: 36px; }
  .ask-act { width: 36px; height: 36px; }
  .ask-a-acts .ask-act { opacity: 1; }
  .ask-turn > .ask-q-acts { height: 0; margin-bottom: 12px; overflow: hidden; }
  .ask-turn.revealed > .ask-q-acts { height: 36px; margin-bottom: 8px; overflow: visible; }
  .ask-turn.revealed > .ask-q-acts .ask-act { opacity: 1; }
}
@media (max-width: 860px) { .ask-starter { min-height: 44px; } }
@keyframes ask-fade { from { opacity: 0; } }
@keyframes ask-rise { from { transform: translateY(4px); } }
@keyframes ask-sheen { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) {
  .ask-turn > *, .ask-tool { animation: ask-fade var(--t1) linear both; }
  .ask-tool[data-state="run"] .ask-tool-text, .ask-tools-summary.run { color: var(--fg-3); background: none; animation: none; }
  .ask-tool[data-state="run"] .ask-tool-text::after { content: "…"; }
  .ask-tools-line .ico { transition: none; }
}
</style>
