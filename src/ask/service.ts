import { chatSnapshot, chatContext, chatPictures } from "./chat-context.ts";
import { computed, nextTick, shallowRef, watch } from "vue";
import type { ShallowRef } from "vue";
import type { ApplicationServices } from "../services/application.ts";
import type { AppRouter } from "../app/router.ts";
import type { Drawing } from "../services/drawing.ts";
import type { Chat } from "../services/chat.ts";
import { message } from "../app/ui.ts";
import { reasoningConnections } from "../config/connections.ts";
import { ancestry } from "../domain/conversation.ts";
import { names } from "../storage/names.ts";
import { codecFor } from "./codec.ts";
import { readAskSettings } from "./settings.ts";
import { createProvider, ProviderError } from "./provider.ts";
import type { AskMessage, AskUsage, ProviderErrorKind } from "./provider.ts";
import { approxTokens, createSession, estimateRequest } from "./session.ts";
import { run } from "./runner.ts";
import { createTools } from "./tools.ts";
import { chatLabel, createIds, idPattern } from "./ids.ts";
import { snapshotPictures } from "./library.ts";
import { createVision } from "./vision.ts";
import { localTags, tagCategory } from "../services/tag-memory.ts";
import { baseHash, buildDigest, stateBlock } from "./digest/index.ts";
import type { Digest } from "./digest/index.ts";
import { systemCore, systemPreferences } from "./prompts/index.ts";
import { createPacer, PACE } from "./pacer.ts";
import { createDraftWriter } from "./draft/apply.ts";
import { validateDraft } from "./draft/validate.ts";
import type { Draft, DraftPlan, DraftState } from "./draft/types.ts";

export interface ToolRow {
  readonly id: string;
  readonly name: string;
  readonly verb: string;
  readonly object: string;
  readonly stat: string;
  readonly reason?: string;
  readonly state: "run" | "done" | "error" | "stopped";
}
export type AskItem =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tools"; readonly rows: readonly ToolRow[] }
  | { readonly kind: "pick"; readonly ids: readonly string[] };
export interface AskTurnView {
  readonly id: number;
  readonly question: string;
  readonly anchor: string | null;
  readonly items: readonly AskItem[];
  readonly status: "thinking" | "running" | "done" | "failed" | "stopped";
  readonly failure: { readonly kind: ProviderErrorKind | "local"; readonly message: string } | null;
  readonly truncated: boolean;
  readonly metadataOnly: boolean;
}
export type AskEntry =
  | { readonly type: "turn"; readonly id: number; readonly turn: AskTurnView }
  | { readonly type: "note"; readonly id: number; readonly text: string; readonly action?: boolean };
export type RetryMode = "plain" | "metadata" | "codec";

const MAX_OUTPUT = 4096;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type WorkingTurn = Mutable<Omit<AskTurnView, "items">> & {
  items: ({ kind: "text"; text: string } | { kind: "tools"; rows: Mutable<ToolRow>[] } | { kind: "pick"; ids: readonly string[] })[];
};
const freezeTurn = (w: WorkingTurn): AskTurnView => ({
  ...w,
  items: w.items.map((i) =>
    i.kind !== "tools" ? { ...i } : { kind: "tools" as const, rows: i.rows.map((r) => ({ ...r })) },
  ),
});

/**
 * App-level ASK: open state, the in-memory session and the turn runner. Not a
 * route and not a modal; workspaces only ever call show(). Vue sees low-rate
 * view state; the session, provider, controllers and digests stay plain.
 */
export function createAsk(deps: {
  services: ApplicationServices;
  router: AppRouter;
  drawing: Drawing;
  chat: Chat;
  fetch?: typeof fetch;
}) {
  const { services, router, drawing, chat } = deps;
  const { preferences, connections } = services;
  const session = createSession(),
    writer = createDraftWriter(drawing, chat, router),
    ids = createIds(),
    vision = createVision(),
    viewed = new Set<string>(),
    tools = createTools(),
    toolList = [...tools.values()].map((entry) => entry.tool);
  const readSettings = () => readAskSettings(preferences.get(names.ask, null)),
    readAdult = () => preferences.get<unknown>(names.askAdult, false) === true;

  const inline = shallowRef<{ target: "image.prompt" | "image.negative" | "chat.composer"; text: string } | null>(null);
  let inlineElement: HTMLTextAreaElement | null = null;
  let inlineFrame = 0;
  function placeInline() {
    cancelAnimationFrame(inlineFrame);
    inlineFrame = requestAnimationFrame(() => {
      inlineFrame = 0;
      if (!inlineElement || !root || !inline.value || !visible.value) return;
      const r = inlineElement.getBoundingClientRect(), width = Math.min(480, innerWidth - 16), height = Math.min(560, innerHeight - 96);
      root.style.setProperty("--ask-inline-left", `${Math.max(8, Math.min(innerWidth - width - 8, r.left))}px`);
      root.style.setProperty("--ask-inline-top", `${Math.max(8, Math.min(innerHeight - height - 8, r.bottom + 8))}px`);
    });
  }
  const open = shallowRef(false),
    entries = shallowRef<readonly AskEntry[]>([]),
    live = shallowRef<AskTurnView | null>(null),
    input = shallowRef(""),
    anchor = shallowRef<string | null>(null),
    current = shallowRef<string | null>(null),
    notice = shallowRef(""),
    announce = shallowRef({ id: 0, text: "" }),
    usage = shallowRef<AskUsage>(session.usage),
    settings = shallowRef(readSettings()),
    adult = shallowRef(readAdult()),
    routing = shallowRef(connections.configuration),
    sessionCodec = shallowRef(false),
    preferencePaused = shallowRef(false),
    stateRevision = shallowRef(0),
    libraryRevision = shallowRef(0),
    draftRevision = shallowRef(0),
    draft = shallowRef<Draft | null>(null),
    draftOff = shallowRef<ReadonlySet<string>>(new Set()),
    draftStatus = shallowRef<"pending" | "applied">("pending"),
    appliedPlan = shallowRef<DraftPlan | null>(null),
    writingDraft = shallowRef(false);
  const editorOpen = computed(() => router.route.value.overlay === "editor"),
    visible = computed(() => open.value && !editorOpen.value),
    running = computed(() => live.value !== null),
    connection = computed(
      () =>
        reasoningConnections(routing.value).find(
          (c) => c.id === settings.value.connectionId,
        ) ?? null,
    ),
    ready = computed<"local" | "connection" | "model" | "ok">(() =>
      connections.local && !reasoningConnections(routing.value).length
        ? "local"
        : !connection.value
          ? "connection"
          : !settings.value.model
            ? "model"
            : "ok",
    ),
    codecActive = computed(
      () => adult.value && (settings.value.alwaysCodec || sessionCodec.value),
    ),
    system = computed(
      () =>
        [
          systemCore({ adult: adult.value }),
          systemPreferences(preferencePaused.value ? "" : settings.value.preference),
        ] as const,
    );

  let sequence = 0,
    controller: AbortController | null = null,
    root: HTMLElement | null = null,
    dismissCompact = () => {},
    disposed = false,
    stateTimer: ReturnType<typeof setTimeout> | undefined;
  const layers = new Set<() => boolean>();
  const inlineObserver = new ResizeObserver(placeInline);
  const stopInline = watch([visible, inline], () => {
    inlineObserver.disconnect();
    window.removeEventListener("scroll", placeInline, true);
    window.removeEventListener("resize", placeInline);
    cancelAnimationFrame(inlineFrame);
    if (visible.value && inline.value) {
      if (inlineElement) inlineObserver.observe(inlineElement);
      window.addEventListener("scroll", placeInline, true);
      window.addEventListener("resize", placeInline);
      void nextTick(placeInline);
    }
  });
  function readDraftState(): DraftState {
    const d = drawing.snapshot(), c = chat.snapshot().current;
    return { form: { ...d.form }, composer: c.prompt, conversationId: c.id, chat: chatSnapshot(chat.snapshot()), models: [...d.models], samplers: [...d.samplers], samplersByModel: Object.fromEntries(d.models.map((m) => [m.id, drawing.samplersFor(m.id)])) };
  }
  const draftPlan = computed(() => {
    void draftRevision.value;
    return draft.value ? draftStatus.value === "applied" ? appliedPlan.value : validateDraft(draft.value, readDraftState(), { off: draftOff.value, category: tagCategory }) : null;
  });
  const canUndoDraft = computed(() => {
    void draftRevision.value;
    return !!appliedPlan.value && writer.canUndo(appliedPlan.value);
  });
  const draftApplyLabel = computed(() => {
    const workspace = draftPlan.value?.workspace;
    return workspace && router.route.value.workspace !== workspace ? `切回${workspace === "image" ? "绘图" : "对话"}并应用` : "应用";
  });
  async function focusWritten(plan: DraftPlan) {
    await nextTick();
    const field = plan.changes.some((c) => c.field === "prompt") ? "prompt" : plan.changes.some((c) => c.field === "negative") ? "negative" : plan.workspace === "chat" ? "chatPrompt" : null;
    if (!field) return;
    if (field === "prompt" || field === "negative") document.getElementById(`tab-${field}`)?.click();
    await nextTick();
    const element = document.getElementById(field);
    if (element instanceof HTMLTextAreaElement) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }
  async function applyDraft(fingerprint: string) {
    if (!draft.value || draftStatus.value !== "pending" || writingDraft.value || controller || disposed) return;
    const plan = validateDraft(draft.value, readDraftState(), { off: draftOff.value, category: tagCategory });
    if (plan.fingerprint !== fingerprint) { draftRevision.value++; notice.value = "内容已变化，请核对更新后的草稿再应用"; return; }
    if (!plan.changes.length && !plan.branch) return;
    writingDraft.value = true; notice.value = "";
    try {
      await writer.apply(plan);
      appliedPlan.value = plan; draftStatus.value = "applied";
      const text = `已应用草稿 ${plan.title} · ${plan.changes.length} 项 · ${plan.workspace === "image" ? "未生成" : "未发送"}`;
      push({ type: "note", id: ++sequence, text, action: true }); say(text);
      await focusWritten(plan);
    } catch (error) { notice.value = message(error); }
    finally { writingDraft.value = false; draftRevision.value++; }
  }
  async function undoDraft() {
    const plan = appliedPlan.value;
    if (!plan || writingDraft.value || controller || disposed) return;
    writingDraft.value = true; notice.value = "";
    try {
      await writer.undo(plan);
      if (plan.branch && draft.value) draft.value = { ...draft.value, base: readDraftState() };
      appliedPlan.value = null; draftStatus.value = "pending";
      push({ type: "note", id: ++sequence, text: `已撤销草稿 ${plan.title}`, action: true }); say("已撤销草稿，表单已恢复");
      await focusWritten(plan);
    } catch (error) { notice.value = message(error); }
    finally { writingDraft.value = false; draftRevision.value++; }
  }
  function ignoreDraft() {
    if (!draft.value || draftStatus.value !== "pending" || writingDraft.value) return;
    draft.value = null; draftOff.value = new Set(); notice.value = ""; say("已忽略草稿，内容未修改");
  }

  function digestNow(anchorLabel: string | null): Digest {
    const d = drawing.snapshot(),
      c = chat.snapshot(),
      workspace = router.route.value.workspace,
      conversation = c.current;
    const digest = buildDigest({
      workspace,
      anchor: anchorLabel,
      form: d.form,
      modelName: d.model?.name ?? null,
      history: d.history,
      favorites: d.favorites,
      current: d.current,
      generation: {
        state: d.state,
        busy: d.busy,
        index: d.pending?.index,
        total: d.pending?.total,
        error: d.error || undefined,
      },
      composer: conversation.prompt,
      chat:
        workspace === "chat"
          ? {
              title: conversation.title,
              turns: ancestry(conversation).length,
              head: conversation.headId ? chatLabel(conversation, conversation.headId) : null,
              composer: conversation.prompt,
              context: {
                turns: c.context.turnIds.length,
                images: c.context.imageIds.length,
                dropped: c.context.dropped.length,
              },
              busy: c.busy?.phase ?? null,
              model: c.model?.name ?? null,
            }
          : null,
      ids,
      category: tagCategory,
    });
    return inline.value ? { ...digest, json: JSON.stringify({ ...JSON.parse(digest.json), inline_selection: inline.value }) } : digest;
  }
  const currentHash = () => {
    const d = drawing.snapshot();
    return baseHash(d.form.prompt, d.form.negative, chat.snapshot().current.prompt);
  };
  // Numbers are handed out as images arrive, so every #h keeps its order.
  function syncDrawing() {
    const d = drawing.snapshot();
    ids.sync(d.history, d.favorites);
    libraryRevision.value++;
    draftRevision.value++;
    current.value = d.current ? ids.label(d.current.id) : null;
    if (!visible.value || stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = undefined;
      stateRevision.value++;
    }, 400);
  }
  syncDrawing();
  const stops = [
    drawing.subscribe(syncDrawing),
    chat.subscribe(() => { draftRevision.value++; libraryRevision.value++; }),
    preferences.subscribe((key) => {
      if (!key || key === names.ask) settings.value = readSettings();
      if (!key || key === names.askAdult) adult.value = readAdult();
    }),
    connections.subscribe(() => (routing.value = connections.configuration)),
  ];

  const staticTokens = computed(
    () => approxTokens(JSON.stringify(toolList)) + approxTokens(system.value.join("\n")),
  );
  const stateTokens = computed(() => {
    void stateRevision.value;
    void entries.value;
    return visible.value && ready.value === "ok"
      ? estimateRequest({
          tools: [],
          system: ["", ""],
          messages: [
            ...session.messages,
            { role: "user", content: [{ type: "text", text: stateBlock(digestNow(anchor.value)) }] },
          ],
        })
      : 0;
  });
  /** Rough input tokens for the next send, shown with「约」. */
  const estimate = computed(() =>
    stateTokens.value ? staticTokens.value + stateTokens.value + approxTokens(input.value) : 0,
  );

  function push(entry: AskEntry) {
    entries.value = [...entries.value, entry];
  }
  function say(text: string) {
    announce.value = { id: announce.value.id + 1, text };
  }

  async function send(
    text = input.value,
    options: { metadataOnly?: boolean; anchor?: string | null } = {},
  ) {
    const question = text.trim();
    if (!question || controller || disposed || writingDraft.value) return;
    if (draft.value && draftStatus.value === "pending") { notice.value = "请先应用或忽略当前草稿"; return; }
    if (ready.value !== "ok") {
      notice.value =
        ready.value === "local"
          ? "请在服务端配置 ASK 推理连接后重启"
          : ready.value === "connection"
            ? "请先在设置 → ASK 选择连接"
            : "请先在设置 → ASK 填写模型 ID";
      return;
    }
    let provider: ReturnType<typeof createProvider>;
    try {
      provider = createProvider(connections.context(connection.value!.id), deps.fetch);
    } catch (error) {
      notice.value = message(error);
      return;
    }
    notice.value = "";
    const config = settings.value,
      turnAnchor = options.anchor !== undefined ? options.anchor : [...question.matchAll(idPattern)][0]?.[0] ?? anchor.value,
      metadataOnly = !!options.metadataOnly || !config.images,
      codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words });
    // The snapshot is fixed for the whole turn; get_state appends newer ones.
    const digest = digestNow(turnAnchor);
    const snapshot = drawing.snapshot(),
      library = [...snapshotPictures(snapshot.history, snapshot.favorites, ids), ...chatPictures(chat.snapshot(), chat)],
      turnChatContext = chatContext(chat.snapshot()),
      turnViewed = new Set(viewed),
      draftBase = readDraftState();
    const user: AskMessage = {
      role: "user",
      content: [
        { type: "text", text: stateBlock(digest) },
        { type: "text", text: question },
      ],
    };
    const turn = session.begin(user, { metadataOnly }),
      abort = new AbortController(),
      pacer = createPacer();
    abort.signal.addEventListener("abort", pacer.cancel, { once: true });
    controller = abort;
    if (text === input.value) input.value = "";
    const working: WorkingTurn = {
      id: ++sequence,
      question,
      anchor: turnAnchor,
      items: [],
      status: "thinking",
      failure: null,
      truncated: false,
      metadataOnly,
    };
    let frame = 0, proposed: Draft | undefined;
    const commit = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      live.value = freezeTurn(working);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(commit);
    };
    commit();
    let last: "text" | "start" | "end" | null = null;
    const rows = new Map<string, Mutable<ToolRow>>();
    try {
      for await (const event of run({
        stream: (request, signal) => provider.stream(request, { codec, signal }),
        request: { model: config.model, tools: toolList, system: system.value, maxTokens: MAX_OUTPUT },
        turn,
        tools,
        context: {
          signal: abort.signal,
          metadataOnly,
          library,
          vision,
          visual: { signal: abort.signal, metadataOnly, budget: turn.budget.vision, viewed: turnViewed },
          tags: localTags,
          chatContext: turnChatContext,
          draftBase,
          question,
          state: () => ({
            text: stateBlock(digestNow(turnAnchor)),
            images: drawing.snapshot().history.length,
          }),
        },
        signal: abort.signal,
      })) {
        if (event.type === "text") {
          last = "text";
          pacer.push(() => {
            working.status = "running";
            const tail = working.items.at(-1);
            if (tail?.kind === "text") tail.text += event.text;
            else working.items.push({ kind: "text", text: event.text });
            schedule();
          });
        } else if (event.type === "tool-start") {
          const gap = last === "text" ? PACE.afterText : last === "end" ? PACE.betweenTools : 0;
          last = "start";
          pacer.push(() => {
            working.status = "running";
            const row: Mutable<ToolRow> = { id: event.id, name: event.name, verb: event.verb, object: event.object, stat: "", state: "run" };
            rows.set(event.id, row);
            const tail = working.items.at(-1);
            if (tail?.kind === "tools") tail.rows.push(row);
            else working.items.push({ kind: "tools", rows: [row] });
            commit();
          }, gap);
        } else if (event.type === "tool-end") {
          if (event.draft) proposed = event.draft;
          last = "end";
          pacer.push(() => {
            const row = rows.get(event.id);
            if (row) {
              row.state = event.ok ? "done" : "error";
              row.stat = event.stat;
              row.reason = event.reason;
            }
            if (event.picks?.length) working.items.push({ kind: "pick", ids: event.picks });
            commit();
          }, PACE.toolMin);
        } else if (event.type === "usage") usage.value = session.usage;
        else if (event.type === "done") working.truncated = event.reason === "length";
      }
      if (proposed) pacer.push(() => {}, PACE.beforeDraft);
      await pacer.settled();
      abort.signal.throwIfAborted();
      turn.commit();
      for (const id of turnViewed) viewed.add(id);
      if (proposed) { draft.value = proposed; draftOff.value = new Set(); draftStatus.value = "pending"; appliedPlan.value = null; }
      working.status = "done";
      const reply = working.items.flatMap((i) => (i.kind === "text" ? [i.text.trim()] : [])).filter(Boolean).join("\n\n");
      say([reply, proposed ? "草稿已就绪，等待确认" : ""].filter(Boolean).join("\n"));
      settle(working);
      if (currentHash() !== digest.baseHash)
        push({ type: "note", id: ++sequence, text: "提示词已在外部修改" });
    } catch (error) {
      pacer.cancel();
      await pacer.settled();
      turn.rollback();
      const stopped = abort.signal.aborted;
      working.status = stopped ? "stopped" : "failed";
      working.failure = stopped
        ? null
        : { kind: error instanceof ProviderError ? error.kind : "local", message: message(error) };
      for (const row of rows.values()) if (row.state === "run") row.state = stopped ? "stopped" : "error";
      say(stopped ? "已停止" : `未能完成：${working.failure!.message}`);
      settle(working);
    } finally {
      abort.signal.removeEventListener("abort", pacer.cancel);
      cancelAnimationFrame(frame);
      if (controller === abort) controller = null;
      usage.value = session.usage;
    }
  }
  function settle(working: WorkingTurn) {
    const view = freezeTurn(working);
    live.value = null;
    push({ type: "turn", id: view.id, turn: view });
  }
  function stop() {
    controller?.abort(new DOMException("已停止", "AbortError"));
  }
  /** Only the user's click retries; nothing here runs on its own. */
  function retry(id: number, mode: RetryMode) {
    const entry = entries.value.find((e) => e.type === "turn" && e.id === id);
    if (!entry || entry.type !== "turn" || controller || writingDraft.value || (draft.value && draftStatus.value === "pending")) return;
    if (mode === "codec") {
      if (!adult.value) return;
      sessionCodec.value = true;
    }
    entries.value = entries.value.filter((e) => e !== entry);
    void send(entry.turn.question, { metadataOnly: mode === "metadata", anchor: entry.turn.anchor });
  }
  /** Esc: popovers, then the draft (A2), then the running turn, then the drawer. */
  function escape() {
    for (const layer of [...layers].reverse()) if (layer()) return;
    if (writingDraft.value) return;
    if (draft.value && draftStatus.value === "pending") ignoreDraft();
    else if (controller) stop();
    else { open.value = false; dismissCompact(); }
  }
  function onKey(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    const modal = () => document.querySelector("dialog:modal") !== null;
    const active = document.activeElement;
    const inside = !!root?.contains(active);
    const body = !active || active === document.body;
    const typing = active instanceof HTMLElement && (active.matches("input,textarea,select") || active.isContentEditable);
    if (event.defaultPrevented || modal() || editorOpen.value) return;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
      if (!(active instanceof HTMLTextAreaElement) || !["prompt", "negative", "chatPrompt"].includes(active.id) || controller || writingDraft.value) return;
      event.preventDefault();
      if (draft.value && draftStatus.value === "pending") { inline.value = null; open.value = true; notice.value = "请先应用或忽略当前草稿"; return; }
      inlineElement = active;
      inline.value = { target: active.id === "chatPrompt" ? "chat.composer" : active.id === "negative" ? "image.negative" : "image.prompt", text: (active.value.slice(active.selectionStart, active.selectionEnd) || active.value).slice(0, 24000) };
      open.value = true;
      void nextTick(() => { placeInline(); document.getElementById("askPrompt")?.focus(); });
      return;
    }
    const compact = !editorOpen.value && !!root && root.dataset.mode !== "idle";
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && (visible.value || compact) && (inside || body) && !typing && window.getSelection()?.isCollapsed !== false) {
      const button = root?.querySelector<HTMLButtonElement>(".ask-draft-apply");
      if (button && !button.disabled && button.getClientRects().length && !button.closest('[inert]')) { event.preventDefault(); void applyDraft(button.dataset.fingerprint ?? ""); }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z" && canUndoDraft.value) {
      const field = active?.id === "chatPrompt" ? "composer" : active?.id;
      const target = appliedPlan.value?.changes.some((c) => c.field === field);
      if ((inside && !typing) || body || target) { event.preventDefault(); void undoDraft(); }
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      (event.code === "KeyJ" || event.key.toLowerCase() === "j")
    ) {
      // v1 has no ASK inside the editor (doc 1 D9); modals keep their own keys.
      if (editorOpen.value || modal()) return;
      event.preventDefault();
      inline.value = null;
      open.value = !open.value;
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || (!visible.value && !compact) || modal()) return;
    if (!inside && active && active !== document.body) return;
    event.preventDefault();
    escape();
  }
  window.addEventListener("keydown", onKey);

  return {
    inline,
    expand() { inline.value = null; },
    visible,
    running,
    entries: entries as Readonly<ShallowRef<readonly AskEntry[]>>,
    live: live as Readonly<ShallowRef<AskTurnView | null>>,
    input: input as Readonly<ShallowRef<string>>,
    anchor: anchor as Readonly<ShallowRef<string | null>>,
    current: current as Readonly<ShallowRef<string | null>>,
    notice: notice as Readonly<ShallowRef<string>>,
    announce: announce as Readonly<ShallowRef<{ id: number; text: string }>>,
    usage: usage as Readonly<ShallowRef<AskUsage>>,
    settings: settings as Readonly<ShallowRef<ReturnType<typeof readSettings>>>,
    adult: adult as Readonly<ShallowRef<boolean>>,
    preferencePaused: preferencePaused as Readonly<ShallowRef<boolean>>,
    ready,
    draftPlan,
    draftStatus,
    writingDraft,
    draftApplyLabel,
    canUndoDraft,
    applyDraft,
    undoDraft,
    ignoreDraft,
    toggleDraftStep(id: string) {
      if (writingDraft.value || draftStatus.value !== "pending") return;
      const next = new Set(draftOff.value);
      if (next.has(id)) next.delete(id); else next.add(id);
      draftOff.value = next;
    },
    reproposeDraft() {
      if (!draft.value || writingDraft.value || controller) return;
      const question = draft.value.question;
      ignoreDraft();
      void send(`基于当前内容重新提议。\n${question}`);
    },
    libraryRevision: libraryRevision as Readonly<ShallowRef<number>>,
    codecActive,
    estimate,
    setInput(text: string) {
      input.value = text;
      if (notice.value) notice.value = "";
    },
    /** For workspaces (A1 entries): open with an image already referenced. */
    show(options: { anchor?: string; question?: string } = {}) {
      if (editorOpen.value) return;
      inline.value = null;
      if (options.anchor !== undefined) anchor.value = options.anchor;
      if (options.question) input.value = input.value.trim() ? `${input.value}\n${options.question}` : options.question;
      open.value = true;
    },
    hide() {
      open.value = false;
    },
    toggle() {
      inline.value = null;
      if (!editorOpen.value) open.value = !open.value;
    },
    clearAnchor() {
      anchor.value = null;
    },
    labelFor(id: string) { return ids.label(id); },
    pictureInfo(label: string) {
      if (label.startsWith("#c")) {
        const picture = chatPictures(chat.snapshot(), chat).find((p) => p.label === label);
        const source = chatSnapshot(chat.snapshot()).sources.find((s) => s.label === label);
        const asset = source?.assetId ? chat.assets.assets.get(source.assetId) : null;
        return picture && asset ? { label, url: asset.url, width: asset.width, height: asset.height } : null;
      }
      const id = ids.resolve(label), d = drawing.snapshot();
      const item = [...d.history, ...d.favorites].find((r) => r.id === id);
      return item ? { label, url: drawing.url(item, true), width: item.size.width, height: item.size.height } : null;
    },
    locate(label: string) {
      if (label.startsWith("#c")) {
        router.switchWorkspace("chat");
        if (window.matchMedia("(max-width: 860px)").matches) open.value = false;
        return;
      }
      const id = ids.resolve(label), d = drawing.snapshot();
      const item = [...d.history, ...d.favorites].find((r) => r.id === id);
      if (!item) { notice.value = `${label} 已不在本页历史或收藏中`; return; }
      router.switchWorkspace("image");
      drawing.show(item, true);
      if (window.matchMedia("(max-width: 860px)").matches) open.value = false;
    },
    pick(label: string) {
      if (!this.pictureInfo(label)) return;
      anchor.value = label;
      if (!input.value.trim()) input.value = `请分析 ${label}`;
    },
    togglePreference() {
      preferencePaused.value = !preferencePaused.value;
    },
    openSettings() {
      router.openOverlay("settings", "ask");
    },
    send: () => send(),
    stop,
    retry,
    /** The drawer element, for Esc containment. */
    attach(element: HTMLElement | null, dismiss = () => {}) {
      root = element;
      dismissCompact = dismiss;
    },
    /** A popover's close handler; returns true when it closed something. */
    layer(close: () => boolean) {
      layers.add(close);
      return () => layers.delete(close);
    },
    dispose() {
      disposed = true;
      stopInline();
      inlineObserver.disconnect();
      cancelAnimationFrame(inlineFrame);
      window.removeEventListener("scroll", placeInline, true);
      window.removeEventListener("resize", placeInline);
      inlineElement = null;
      stop();
      clearTimeout(stateTimer);
      window.removeEventListener("keydown", onKey);
      for (const stopListening of stops) stopListening();
      layers.clear();
      vision.dispose();
      viewed.clear();
      root = null;
    },
  };
}
export type Ask = ReturnType<typeof createAsk>;
