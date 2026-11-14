<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useId, watch } from "vue";
import { useAsk } from "../app/ask";
import { summary } from "./format.ts";
import type { AskTurnView } from "./service.ts";

const props = defineProps<{ turns: readonly AskTurnView[]; current: number | null }>();
const emit = defineEmits<{ select: [id: number] }>();
const ask = useAsk(), tooltipId = useId();
const root = shallowRef<HTMLElement | null>(null), rail = shallowRef<HTMLElement | null>(null), card = shallowRef<HTMLElement | null>(null);
const inspected = shallowRef<number | null>(null), focused = shallowRef<number | null>(null);
const near = shallowRef(false), keyboard = shallowRef(false);
const question = (turn: AskTurnView) => turn.question.trim() || turn.attachments.filter(a => !a.toolRead).map(a => a.name).join("、") || "附件提问";
const plain = (text: string) => summary(text.slice(0, 6000)).map(part => part.v).join("");
const preview = computed(() => {
  const index = props.turns.findIndex(turn => turn.id === inspected.value), turn = props.turns[index];
  if (!turn) return null;
  const reply = [...turn.items].reverse().find(item => item.kind === "text" && item.text.trim());
  return {
    index: index + 1, question: plain(question(turn)),
    reply: reply?.kind === "text" ? plain(reply.text)
      : turn.status === "failed" ? turn.failure?.message || "回复失败"
        : turn.status === "stopped" ? "已停止"
          : turn.status === "done" ? "已完成工具操作" : "正在回复…",
  };
});
let timer: ReturnType<typeof setTimeout> | undefined, removeLayer = () => {};
const button = (id: number | null) => rail.value?.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
function keepVisible(id: number | null) {
  const node = button(id), list = rail.value;
  if (!node || !list) return;
  if (node.offsetTop < list.scrollTop) list.scrollTop = node.offsetTop;
  else if (node.offsetTop + node.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = node.offsetTop + node.offsetHeight - list.clientHeight;
}
function place() {
  const box = root.value?.getBoundingClientRect(), anchor = button(inspected.value)?.getBoundingClientRect(), el = card.value;
  if (!box || !anchor || !el) return;
  el.style.top = `${Math.max(0, Math.min(anchor.top - box.top + anchor.height / 2 - el.offsetHeight / 2, box.height - el.offsetHeight))}px`;
}
function stay() { clearTimeout(timer); }
function close() { inspected.value = null; }
function enter() { stay(); near.value = true; }
function leave() {
  stay();
  timer = setTimeout(() => { near.value = false; if (!keyboard.value) close(); }, 160);
}
function inspect(id: number) { inspected.value = id; void nextTick(place); }
function focus(id: number) {
  focused.value = id;
  keyboard.value = button(id)?.matches(":focus-visible") ?? false;
  keepVisible(id); inspect(id);
}
function blur(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) { focused.value = null; keyboard.value = false; close(); }
}
function select(id: number) { emit("select", id); close(); }
function keys(event: KeyboardEvent, index: number) {
  const next = event.key === "ArrowDown" ? Math.min(props.turns.length - 1, index + 1)
    : event.key === "ArrowUp" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? props.turns.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault(); event.stopPropagation();
  keyboard.value = true;
  const id = props.turns[next].id;
  button(id)?.focus({ preventScroll: true }); keepVisible(id);
}
watch(inspected, id => {
  removeLayer();
  if (id !== null) removeLayer = ask.layer(() => { close(); return true; });
});
watch([() => props.current, () => props.turns.length], () => {
  if (!preview.value && focused.value === null) keepVisible(props.current);
  if (inspected.value !== null && !preview.value) close();
}, { flush: "post" });
const resized = new ResizeObserver(place);
onMounted(() => { if (root.value) resized.observe(root.value); keepVisible(props.current); });
watch(card, (el, old) => { if (old) resized.unobserve(old); if (el) resized.observe(el); });
onBeforeUnmount(() => { stay(); removeLayer(); resized.disconnect(); });
</script>

<template>
  <div ref="root" class="ask-timeline" :data-expanded="near || keyboard || undefined" @pointerenter="enter" @pointerleave="leave" @focusout="blur" @keydown.tab.stop>
    <div class="ask-timeline-edge" aria-hidden="true"></div>
    <nav ref="rail" class="ask-timeline-rail" aria-label="对话轮次导航" @scroll.passive="place">
      <button v-for="(turn, index) in turns" :key="turn.id" type="button" :data-id="turn.id" :aria-label="`第 ${index + 1} 轮：${question(turn).slice(0, 120)}`" :aria-current="current === turn.id ? 'step' : undefined" :aria-describedby="inspected === turn.id ? tooltipId : undefined" :tabindex="turn.id === (focused ?? current ?? turns[0]?.id) ? 0 : -1" :class="{ inspecting: inspected === turn.id }" @pointerenter="$event.pointerType !== 'touch' && inspect(turn.id)" @focus="focus(turn.id)" @click="select(turn.id)" @keydown="keys($event, index)">
        <span aria-hidden="true"></span>
      </button>
    </nav>
    <div v-if="preview" :id="tooltipId" ref="card" class="ask-timeline-preview" role="tooltip">
      <small>第 {{ preview.index }} 轮</small>
      <p class="ask-timeline-question">{{ preview.question }}</p>
      <p class="ask-timeline-reply">{{ preview.reply }}</p>
    </div>
  </div>
</template>

<style scoped>
.ask-timeline { position: absolute; z-index: 3; inset: 8px 0; pointer-events: none; }
.ask-timeline-edge { position: absolute; inset-block: 0; left: max(0px, calc(var(--ask-reading-inset, 16px) - 36px)); width: min(36px, var(--ask-reading-inset, 16px)); pointer-events: auto; }
.ask-timeline-rail { position: absolute; top: 50%; left: max(4px, calc(var(--ask-reading-inset, 16px) - 32px)); width: 28px; max-height: 100%; overflow: auto; overscroll-behavior: contain; scrollbar-width: none; opacity: 0; transform: translate(-4px, -50%); transition: opacity var(--t1) var(--e), transform var(--t1) var(--e); pointer-events: none; }
.ask-timeline[data-expanded] .ask-timeline-rail { opacity: 1; transform: translateY(-50%); pointer-events: auto; }
.ask-timeline-rail::-webkit-scrollbar { display: none; }
.ask-timeline-rail button { display: flex; align-items: center; justify-content: center; width: 100%; height: 14px; color: var(--fg-4); border-radius: 5px; }
.ask-timeline-rail button span { width: 8px; height: 2px; background: color-mix(in srgb, currentcolor 55%, var(--canvas)); border-radius: 2px; box-shadow: 0 0 0 2px var(--canvas), 0 0 6px 3px var(--canvas); transition: width var(--t1) var(--e), background-color var(--t1) var(--e); }
.ask-timeline-rail button[aria-current] { color: var(--fg-2); }
.ask-timeline-rail button[aria-current] span { width: 14px; background: currentcolor; }
.ask-timeline-rail button:is(.inspecting, :hover, :focus-visible) { color: var(--fg); }
.ask-timeline-rail button:is(.inspecting, :hover, :focus-visible) span { width: 22px; background: currentcolor; }
.ask-timeline-rail button:focus-visible { outline: 1px solid var(--a); outline-offset: -2px; }
.ask-timeline-preview { position: absolute; left: max(38px, calc(var(--ask-reading-inset, 16px) + 2px)); width: min(280px, calc(100% - max(38px, var(--ask-reading-inset, 16px)) - 16px)); max-height: 100%; padding: 10px 12px; overflow: hidden; color: var(--fg); background: var(--glass-pop-bg); border: 1px solid var(--line-2); border-radius: 10px; box-shadow: var(--glass-pop-shadow); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)); pointer-events: auto; }
.ask-timeline-preview small { display: block; margin-bottom: 5px; color: var(--fg-3); font: 11px/1.5 var(--sans); }
.ask-timeline-preview p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.ask-timeline-question { -webkit-line-clamp: 2; font: var(--fw-medium) 13px/1.6 var(--sans); }
.ask-timeline-reply { margin-top: 7px; color: var(--fg-2); -webkit-line-clamp: 3; font: 12px/1.65 var(--sans); }
@media (hover: none) {
  .ask-timeline-rail { opacity: 1; transform: translateY(-50%); pointer-events: auto; }
  .ask-timeline-edge { pointer-events: none; }
}
@media (pointer: coarse) { .ask-timeline-rail button { height: 24px; } }
@media (prefers-reduced-motion: reduce) { .ask-timeline-rail, .ask-timeline-rail button span { transition: none; } }
</style>
