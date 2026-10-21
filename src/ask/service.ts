import { computed, shallowRef } from "vue";
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
import { chatLabel, createIds } from "./ids.ts";
import { baseHash, buildDigest, stateBlock } from "./digest/index.ts";
import type { Digest } from "./digest/index.ts";
import { systemCore, systemPreferences } from "./prompts/index.ts";
import { createPacer, PACE } from "./pacer.ts";

export interface ToolRow {
  readonly id: string;
  readonly name: string;
  readonly verb: string;
  readonly object: string;
  readonly stat: string;
  readonly state: "run" | "done" | "error" | "stopped";
}
export type AskItem =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tools"; readonly rows: readonly ToolRow[] };
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
  | { readonly type: "note"; readonly id: number; readonly text: string };
export type RetryMode = "plain" | "metadata" | "codec";

const MAX_OUTPUT = 4096;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type WorkingTurn = Mutable<Omit<AskTurnView, "items">> & {
  items: ({ kind: "text"; text: string } | { kind: "tools"; rows: Mutable<ToolRow>[] })[];
};
const freezeTurn = (w: WorkingTurn): AskTurnView => ({
  ...w,
  items: w.items.map((i) =>
    i.kind === "text" ? { ...i } : { kind: "tools" as const, rows: i.rows.map((r) => ({ ...r })) },
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
    ids = createIds(),
    tools = createTools(),
    toolList = [...tools.values()].map((entry) => entry.tool);
  const readSettings = () => readAskSettings(preferences.get(names.ask, null)),
    readAdult = () => preferences.get<unknown>(names.askAdult, false) === true;

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
    stateRevision = shallowRef(0);
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
      connections.local
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
    disposed = false,
    stateTimer: ReturnType<typeof setTimeout> | undefined;
  const layers = new Set<() => boolean>();

  function digestNow(anchorLabel: string | null): Digest {
    const d = drawing.snapshot(),
      c = chat.snapshot(),
      workspace = router.route.value.workspace,
      conversation = c.current;
    return buildDigest({
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
    });
  }
  const currentHash = () => {
    const d = drawing.snapshot();
    return baseHash(d.form.prompt, d.form.negative, chat.snapshot().current.prompt);
  };
  // Numbers are handed out as images arrive, so every #h keeps its order.
  function syncDrawing() {
    const d = drawing.snapshot();
    ids.sync(d.history, d.favorites);
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
    if (!question || controller || disposed) return;
    if (ready.value !== "ok") {
      notice.value =
        ready.value === "local"
          ? "本地模式暂不支持 ASK"
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
      turnAnchor = options.anchor !== undefined ? options.anchor : anchor.value ?? current.value,
      metadataOnly = !!options.metadataOnly || !config.images,
      codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words });
    // The snapshot is fixed for the whole turn; get_state appends newer ones.
    const digest = digestNow(turnAnchor);
    const user: AskMessage = {
      role: "user",
      content: [
        { type: "text", text: stateBlock(digest) },
        { type: "text", text: question },
      ],
    };
    const turn = session.begin(user),
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
    let frame = 0;
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
          last = "end";
          pacer.push(() => {
            const row = rows.get(event.id);
            if (row) {
              row.state = event.ok ? "done" : "error";
              row.stat = event.stat;
            }
            commit();
          }, PACE.toolMin);
        } else if (event.type === "usage") usage.value = session.usage;
        else if (event.type === "done") working.truncated = event.reason === "length";
      }
      await pacer.settled();
      abort.signal.throwIfAborted();
      turn.commit();
      working.status = "done";
      const reply = working.items.flatMap((i) => (i.kind === "text" ? [i.text.trim()] : [])).filter(Boolean).join("\n\n");
      say(reply);
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
    if (!entry || entry.type !== "turn" || controller) return;
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
    if (controller) stop();
    else open.value = false;
  }
  function onKey(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    const modal = () => document.querySelector("dialog:modal") !== null;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      (event.code === "KeyJ" || event.key.toLowerCase() === "j")
    ) {
      // v1 has no ASK inside the editor (doc 1 D9); modals keep their own keys.
      if (editorOpen.value || modal()) return;
      event.preventDefault();
      open.value = !open.value;
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || !visible.value || modal()) return;
    const active = document.activeElement;
    const inside = root?.contains(event.target as Node) ?? false;
    if (!inside && active && active !== document.body) return;
    event.preventDefault();
    escape();
  }
  window.addEventListener("keydown", onKey);

  return {
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
    codecActive,
    estimate,
    setInput(text: string) {
      input.value = text;
      if (notice.value) notice.value = "";
    },
    /** For workspaces (A1 entries): open with an image already referenced. */
    show(options: { anchor?: string } = {}) {
      if (editorOpen.value) return;
      if (options.anchor !== undefined) anchor.value = options.anchor;
      open.value = true;
    },
    hide() {
      open.value = false;
    },
    toggle() {
      if (!editorOpen.value) open.value = !open.value;
    },
    clearAnchor() {
      anchor.value = null;
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
    attach(element: HTMLElement | null) {
      root = element;
    },
    /** A popover's close handler; returns true when it closed something. */
    layer(close: () => boolean) {
      layers.add(close);
      return () => layers.delete(close);
    },
    dispose() {
      disposed = true;
      stop();
      clearTimeout(stateTimer);
      window.removeEventListener("keydown", onKey);
      for (const stopListening of stops) stopListening();
      layers.clear();
      root = null;
    },
  };
}
export type Ask = ReturnType<typeof createAsk>;
