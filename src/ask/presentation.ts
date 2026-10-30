import { computed, inject, onScopeDispose, shallowRef, watch } from "vue";
import type { InjectionKey } from "vue";
import type { Ask } from "./service.ts";
import type { AppRouter } from "../app/router.ts";
import { summary as replySummary } from "./format.ts";
import { createHomeTransitions } from "../home/transition.ts";

/** Tool rows in the conversation and the call inspector share one glyph per tool. */
export const toolIcons: Readonly<Record<string, string>> = { get_state: "i-layers", search_history: "i-search", get_meta: "i-info", diff_meta: "i-layers", view_image: "i-image", view_sheet: "i-layers", search_tags: "i-search", propose_draft: "i-edit", get_chat_context: "i-layers", get_model_manual: "i-info", get_turn: "i-layers", read_ref: "i-file", save_ref: "i-download", slate_edit: "i-tasks", deliver: "i-image" };

/** One app-owned presentation, shared by the floating island and HOME's head. */
export function createAskPresentation(ask: Ask, router: AppRouter) {
  const shown = shallowRef(ask.visible.value), homeSize = shallowRef<'half' | 'full'>('half');
  const viewport = shallowRef(innerWidth), home = computed(() => router.route.value.workspace === 'home');
  const mobile = computed(() => viewport.value <= 860);
  const canDock = computed(() => viewport.value >= 1280);
  const dockWidth = computed(() => Math.round(Math.min(480, Math.max(420, viewport.value * .32))));
  const dock = computed(() => !home.value || !shown.value ? 'off' : !canDock.value ? 'full' : homeSize.value);
  const fullscreen = computed(() => shown.value && (home.value ? dock.value === 'full' : mobile.value));
  const reserve = computed(() => home.value && shown.value && canDock.value ? dockWidth.value + 12 : 0);
  const dismissedTurn = shallowRef(0), dismissedApplied = shallowRef<object | null>(null);
  let measure = () => {};
  const transitions = createHomeTransitions(() => measure());
  const latest = computed(() => [...ask.entries.value].reverse().find(e => e.type === "turn")?.turn);
  const mode = computed(() => shown.value ? "exp" : ask.running.value ? "run"
    : ask.draftPlan.value ? "ready"
    : ask.appliedDraft.value && dismissedApplied.value !== ask.appliedDraft.value ? "done"
    : latest.value && latest.value.id > dismissedTurn.value ? "ready" : "idle");
  const tools = computed(() => ask.compacting.value ? [] : (ask.live.value ?? latest.value)?.items.flatMap(i => i.kind === "tools" ? i.rows : []) ?? []);
  const compactDraft = computed(() => !!ask.draftPlan.value);
  const completed = computed(() => tools.value.filter(t => t.state === "done").length);
  const activity = computed(() => {
    if (ask.compacting.value) return { verb: "正在压缩", object: "上下文", stat: "", key: "compaction" };
    const row = tools.value.find(t => t.state === "run");
    if (row) return { verb: `正在${row.verb}`, object: row.object, stat: row.stat, key: row.id };
    if (ask.live.value?.items.at(-1)?.kind === "text") return { verb: "正在整理", object: "回复", stat: "", key: "reply" };
    const previous = tools.value.at(-1);
    return previous ? { verb: previous.state === "done" ? `已${previous.verb}` : `未能${previous.verb}`, object: previous.object, stat: previous.stat, key: `${previous.id}-done` }
      : { verb: "正在思考", object: "", stat: "", key: "thinking" };
  });
  const outcome = computed(() => latest.value?.status === "failed" ? "未能完成" : latest.value?.status === "stopped" ? "已停止" : "已完成");
  const summary = computed(() => {
    const turn = latest.value;
    if (turn?.status === "failed") return [{ t: "text" as const, v: turn.failure?.message ?? "请展开查看详情" }];
    if (turn?.status === "stopped") return [{ t: "text" as const, v: "本轮已停止，未计入对话。" }];
    const text = [...(turn?.items ?? [])].reverse().find(i => i.kind === "text")?.text ?? "";
    const first = replySummary(text);
    return first.length ? first : [{ t: "text" as const, v: ask.draftPlan.value ? "草稿已就绪，请核对后应用。" : "请展开查看详情。" }];
  });
  function dismiss() {
    dismissedTurn.value = latest.value?.id ?? 0;
    dismissedApplied.value = ask.appliedDraft.value;
  }

  const note = shallowRef(mode.value !== 'idle' && mode.value !== 'exp');
  const resize = () => { viewport.value = innerWidth; };
  window.addEventListener('resize', resize);
  watch(ask.visible, visible => {
    if (visible) dismiss();
    if (home.value && !router.route.value.overlay) {
      const next = visible ? canDock.value ? homeSize.value : 'full' : 'off';
      transitions.ask(dock.value, next, () => { shown.value = visible; });
    } else shown.value = visible;
  }, { flush: 'sync' });
  watch(() => router.route.value.workspace, () => { transitions.cancel(); shown.value = ask.visible.value; }, { flush: 'sync' });
  watch(ask.draftPlan, (plan, previous) => { if (!plan && previous && !ask.appliedDraft.value) dismiss(); });
  watch(ask.appliedDraft, (value, previous) => { if (!value && previous) dismiss(); });
  watch(ask.conversationId, dismiss);
  let doneTimer: ReturnType<typeof setTimeout> | undefined;
  watch([mode, ask.appliedDraft], ([state]) => {
    clearTimeout(doneTimer);
    if (state === 'done') doneTimer = setTimeout(dismiss, 3000);
  });
  watch(() => mode.value !== 'idle' && mode.value !== 'exp', value => {
    if (home.value && !shown.value && !transitions.active()) transitions.flow(() => { note.value = value; });
    else note.value = value;
  }, { flush: 'sync' });
  onScopeDispose(() => { transitions.cancel(); clearTimeout(doneTimer); window.removeEventListener('resize', resize); });
  return { shown, mode, note, home, mobile, fullscreen, dock, canDock, dockWidth, reserve, homeSize, latest, tools, compactDraft, completed, activity, outcome, summary, dismiss,
    measureWith(callback: () => void) { measure = callback; return () => { if (measure === callback) measure = () => {}; }; },
    resizeHome() { homeSize.value = homeSize.value === 'half' ? 'full' : 'half'; } };
}
export type AskPresentation = ReturnType<typeof createAskPresentation>;
export const askPresentationKey: InjectionKey<AskPresentation> = Symbol('ask-presentation');
export function useAskPresentation() {
  const value = inject(askPresentationKey);
  if (!value) throw new Error('ASK presentation unavailable');
  return value;
}
