import { characterCapability, characterSummary, nextCharacterId } from "../domain/characters.ts";
import { boardForm, boardColors } from "../domain/drawing.ts";
import { stateHash } from "./draft/validate.ts";
import { chatSnapshot, chatContext, chatPictures } from "./chat-context.ts";
import { computed, nextTick, shallowRef, watch } from "vue";
import type { ShallowRef } from "vue";
import type { ApplicationServices } from "../services/application.ts";
import type { AppRouter } from "../app/router.ts";
import type { Drawing } from "../services/drawing.ts";
import type { Chat } from "../services/chat.ts";
import { message } from "../app/ui.ts";
import type { Ui } from "../app/ui.ts";
import { reasoningConnections } from "../config/connections.ts";
import { ancestry } from "../domain/conversation.ts";
import { names } from "../storage/names.ts";
import { codecFor } from "./codec.ts";
import { readAskSettings, withModel } from "./settings.ts";
import { createProvider, ProviderError } from "./provider.ts";
import type { AskMessage, AskUsage, AskRequest, AskEvent, ProviderErrorKind } from "./provider.ts";
import { approxTokens, createSession, estimateRequest } from "./session.ts";
import type { Session } from "./session.ts";
import { createConversations, titleOf, UNTITLED } from "./conversations.ts";
import type { ConversationCore } from "./conversations.ts";
import { run } from "./runner.ts";
import { createTools } from "./tools.ts";
import { chatLabel, createIds, idPattern } from "./ids.ts";
import { snapshotPictures } from "./library.ts";
import { createVision } from "./vision.ts";
import { buildDigest, stateBlock } from "./digest/index.ts";
import type { Digest } from "./digest/index.ts";
import { promptVersion, systemCore, systemPreferences } from "./prompts/index.ts";
import { createCallLog } from "./debug.ts";
import type { CallLogView } from "./debug.ts";
import { createPacer, PACE } from "./pacer.ts";
import { createDraftWriter } from "./draft/apply.ts";
import { validateDraft } from "./draft/validate.ts";
import { createDraftStack } from "./draft/stack.ts";
import type { DraftRecord } from "./draft/stack.ts";
import { draftView } from "./draft/view.ts";
import type { Draft, DraftPlan, DraftState } from "./draft/types.ts";
import { ATTACHMENT_LIMITS, attachmentBlocks, attachmentCapacity, attachmentPictures, attachmentView, createAttachments, prepareAttachment } from "./attachments.ts";
import type { AttachmentView } from "./attachments.ts";
import { boardNameContent, conversationNameContent, namingRequest, readGeneratedName } from "./naming.ts";
import type { NamingTarget } from "./naming.ts";
import { namingPromptVersion } from "./prompts/naming.ts";
import { createAskFavorites } from "./favorites.ts";
import type { SavedConversation } from "./favorites.ts";
import type { Writer } from "../services/data-lease.ts";

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
export interface CheckpointView {
  readonly id: number;
  readonly title: string;
  readonly status: "applied" | "reverted";
  readonly added: number;
  readonly removed: number;
}
export interface AskTurnView {
  readonly id: number;
  readonly question: string;
  readonly anchor: string | null;
  readonly items: readonly AskItem[];
  readonly status: "thinking" | "running" | "done" | "failed" | "stopped";
  readonly failure: { readonly kind: ProviderErrorKind | "local"; readonly message: string } | null;
  readonly truncated: boolean;
  readonly metadataOnly: boolean;
  readonly committed: number | null;
  readonly checkpoint: CheckpointView | null;
  readonly attachments: readonly AttachmentView[];
}
export type AskEntry =
  | { readonly type: "turn"; readonly id: number; readonly turn: AskTurnView }
  | { readonly type: "note"; readonly id: number; readonly text: string };
export type RetryMode = "plain" | "metadata" | "codec";
interface ConversationScope {
  readonly id: string;
  readonly ids: ReturnType<typeof createIds>;
  readonly attachments: ReturnType<typeof createAttachments>;
}
/** The current conversation lives in the service's refs while selected. */
interface Conversation extends ConversationCore {
  named: boolean;
  favorite: boolean;
  readonly createdAt: number;
  readonly scope: ConversationScope;
  readonly session: Session;
  entries: readonly AskEntry[];
  input: string;
  anchor: string | null;
  draft: DraftRecord | null;
  tray: readonly string[];
  preparing: number;
}

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
  ui: Pick<Ui, "toast">;
}) {
  const { services, router, drawing, chat } = deps;
  const { preferences, connections } = services;
  const writer = createDraftWriter(drawing, chat, router),
    history = createDraftStack(writer),
    vision = createVision(),
    tools = createTools(),
    toolList = [...tools.values()].map((entry) => entry.tool);
  const scopes = new Map<string, ConversationScope>();
  function scope(id: string = crypto.randomUUID()) {
    let value = scopes.get(id);
    if (!value) { value = { id, ids: createIds(), attachments: createAttachments(id => vision.forget(id)) }; scopes.set(id, value); }
    return value;
  }
  let activeScope = scope(), ids = activeScope.ids, attachments = activeScope.attachments;
  const favorites = createAskFavorites(services), favoritesReady = shallowRef(false), favoriteBusy = shallowRef(false);
  const readSettings = () => readAskSettings(preferences.get(names.ask, null)),
    readAdult = () => preferences.get<unknown>(names.askAdult, false) === true;
  const debug = shallowRef<CallLogView>({ calls: [], dropped: 0 }),
    callLog = createCallLog(view => { debug.value = view; });
  const naming = shallowRef<NamingTarget | null>(null);
  let namingController: AbortController | null = null;

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
    usage = shallowRef<AskUsage>({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    conversationUsage = shallowRef<AskUsage>(usage.value),
    conversationId = shallowRef(""),
    listRevision = shallowRef(0),
    settings = shallowRef(readSettings()),
    adult = shallowRef(readAdult()),
    routing = shallowRef(connections.configuration),
    sessionCodec = shallowRef(false),
    preferencePaused = shallowRef(false),
    stateRevision = shallowRef(0),
    libraryRevision = shallowRef(0),
    draftRevision = shallowRef(0),
    draft = shallowRef<DraftRecord | null>(null),
    appliedDraft = shallowRef<{ id: number; workspace: "image" | "chat" } | null>(null),
    writingDraft = shallowRef(false);
  const tray = shallowRef<readonly string[]>([]), preparing = shallowRef(0);
  const attachmentPreview = shallowRef<{ id: string; name: string; text: string } | null>(null);
  let importing = Promise.resolve();
  // Usage is counted for the whole page; deleting a conversation keeps it.
  const total = { ...usage.value };
  function addUsage(value: AskUsage) {
    total.input += value.input;
    total.output += value.output;
    total.cacheRead += value.cacheRead;
    total.cacheWrite += value.cacheWrite;
  }
  const conversations = createConversations<Conversation>({
    make: (id) => ({ id, title: UNTITLED, named: false, favorite: false, createdAt: Date.now(), scope: activeScope, origin: null, session: createSession(addUsage), entries: [], input: "", anchor: null, draft: null, tray: [], preparing: 0 }),
    // Callers stash the refs first, so the records are current.
    empty: (c) => !c.favorite && !c.entries.length,
  });
  conversationId.value = conversations.current.id;
  function stash() {
    Object.assign(conversations.current, { entries: entries.value, input: input.value, anchor: anchor.value, draft: draft.value });
  }
  function load() {
    const c = conversations.current;
    activeScope = c.scope; ids = activeScope.ids; attachments = activeScope.attachments;
    entries.value = c.entries; input.value = c.input; anchor.value = c.anchor;
    draft.value = c.draft; appliedDraft.value = null;
    tray.value = c.tray; preparing.value = c.preparing;
    attachmentPreview.value = null;
    conversationUsage.value = c.session.usage; conversationId.value = c.id; notice.value = "";
    listRevision.value++; draftRevision.value++;
    syncDrawing();
  }
  function setTray(value: readonly string[], owner = conversations.current) {
    owner.tray = value;
    if (owner === conversations.current) tray.value = value;
    libraryRevision.value++;
  }
  const entryAttachments = (items: readonly AskEntry[]) => items.flatMap(e => e.type === "turn" ? e.turn.attachments.map(a => a.id) : []);
  function addFiles(files: readonly File[], pasted = false) {
    const owner = conversations.current, attachments = owner.scope.attachments;
    if (disposed || !favoritesReady.value || !files.length) return Promise.resolve();
    owner.preparing++; preparing.value = owner.preparing;
    importing = importing.then(async () => {
      const errors: string[] = [], unsupported: string[] = [];
      for (const file of files) {
        if (disposed || !conversations.get(owner.id)) break;
        try {
          if ([...scopes.values()].reduce((sum, c) => sum + c.attachments.bytes, file.size) > ATTACHMENT_LIMITS.pageBytes) throw new Error("本页附件已超过 200 MB");
          const prepared = await prepareAttachment(file, pasted);
          if (disposed || !conversations.get(owner.id)) break;
          attachmentCapacity(attachments.read(owner.tray), prepared.kind, prepared.kind === "text" ? prepared.text.length : 0);
          const item = attachments.add(prepared);
          setTray([...owner.tray, item.id], owner);
        } catch (error) {
          const reason = message(error);
          if (reason.startsWith("不支持 ")) unsupported.push(reason.slice(4)); else errors.push(reason);
        }
      }
      if (!disposed && conversations.get(owner.id)) {
        if (unsupported.length) errors.unshift(`不支持 ${[...new Set(unsupported)].join("、")}`);
        if (errors.length) deps.ui.toast([...new Set(errors)].join("；"), "err");
      }
    }).finally(() => {
      owner.preparing--;
      if (owner === conversations.current) preparing.value = owner.preparing;
      saveFavorite(owner);
    });
    return importing;
  }
  function removeAttachment(id: string) {
    if (!tray.value.includes(id)) return;
    if (attachmentPreview.value?.id === id) attachmentPreview.value = null;
    setTray(tray.value.filter(value => value !== id)); attachments.release([id]);
  }
  const editorOpen = computed(() => router.route.value.overlay === "editor"),
    visible = computed(() => open.value && !editorOpen.value),
    running = computed(() => live.value !== null),
    connection = computed(
      () =>
        reasoningConnections(routing.value).find(
          (c) => c.id === settings.value.connectionId,
        ) ?? null,
    ),
    /** Picked IDs of each reasoning connection, for the composer's quick switch. */
    picks = computed(() =>
      reasoningConnections(routing.value).flatMap((c) => {
        const ids = settings.value.models[c.id];
        return ids?.length ? [{ id: c.id, name: c.name, ids }] : [];
      }),
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
  function readDraftState(boardId?: string): DraftState {
    const d = drawing.snapshot(), c = chat.snapshot().current;
    const board = d.boards.find(b => b.id === (boardId ?? d.activeBoardId));
    return { boardId: boardId ?? d.activeBoardId, boardName: board?.name, boardPresent: !!board, nextCharacterId: board?.nextCharacterId, form: structuredClone({ ...d.form, ...board?.form }), composer: c.prompt, conversationId: c.id, chat: chatSnapshot(chat.snapshot()), models: [...d.models], samplers: [...d.samplers], samplersByModel: Object.fromEntries(d.models.map((m) => [m.id, drawing.samplersFor(m.id)])) };
  }
  const draftPlan = computed(() => {
    void draftRevision.value;
    return draft.value ? validateDraft(draft.value.draft, readDraftState(draft.value.draft.base.boardId), { off: draft.value.off }) : null;
  });
  const undoTarget = computed(() => {
    void draftRevision.value;
    return history.top?.conversationId === conversationId.value ? history.top : null;
  });
  const redoTarget = computed(() => {
    void draftRevision.value;
    return history.redo?.conversationId === conversationId.value ? history.redo : null;
  });
  const canUndoDraft = computed(() => {
    void draftRevision.value;
    const record = undoTarget.value;
    return !!record?.plan && writer.canUndo(record.plan, record.receipt);
  });
  function checkpoint(record: DraftRecord) {
    const owner = conversations.get(record.conversationId);
    if (!owner || !record.plan || record.status === "pending") return;
    const { added, removed } = draftView(record.plan);
    const view: CheckpointView = { id: record.id, title: record.plan.title, status: record.status, added, removed };
    const next = (owner === conversations.current ? entries.value : owner.entries).map((e) =>
      e.type === "turn" && e.id === record.turnId ? { ...e, turn: { ...e.turn, checkpoint: view } } : e);
    owner.entries = next;
    if (owner === conversations.current) entries.value = next;
    saveFavorite(owner);
  }
  const draftApplyLabel = computed(() => {
    const plan = draftPlan.value, workspace = plan?.workspace;
    if (workspace === "image" && plan?.newBoardName) return router.route.value.workspace === "image" ? "新建并应用" : "切回绘图并新建";
    if (workspace === "image" && plan?.boardId && drawing.snapshot().activeBoardId !== plan.boardId) return `切回${drawing.board(plan.boardId)?.name ?? "源画板"}并应用`;
    return workspace && router.route.value.workspace !== workspace ? `切回${workspace === "image" ? "绘图" : "对话"}并应用` : "应用";
  });
  async function focusWritten(plan: DraftPlan) {
    await nextTick();
    const field = plan.changes.some((c) => c.field === "prompt") ? "prompt" : plan.changes.some((c) => c.field === "negative") ? "negative" : plan.workspace === "chat" ? "chatPrompt" : null;
    if (!field && plan.workspace === "image") {
      const role = plan.steps.find(s => s.characterId && s.enabled && !s.issue);
      const row = role?.characterId ? document.querySelector(`[data-character-id="${role.characterId}"]`) : null;
      row?.querySelector<HTMLButtonElement>('.mc-toggle[aria-expanded="false"]')?.click();
      await nextTick();
      const subfield = role?.label === "Negative" ? "negative" : "prompt";
      row?.querySelector<HTMLButtonElement>(`[data-character-field="${subfield}"]`)?.click();
      await nextTick();
      document.getElementById(`char-${role?.characterId}-${subfield}`)?.focus({ preventScroll: true });
      return;
    }
    if (!field) return;
    if (field === "prompt" || field === "negative") document.getElementById(`tab-${field}`)?.click();
    await nextTick();
    const element = document.getElementById(field);
    if (element instanceof HTMLTextAreaElement) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }
  async function applyDraft(fingerprint: string, newBoard?: boolean) {
    const record = draft.value;
    if (!record || writingDraft.value || controller || disposed) return;
    let plan = validateDraft(record.draft, readDraftState(record.draft.base.boardId), { off: record.off });
    if (plan.fingerprint !== fingerprint) { draftRevision.value++; notice.value = "内容已变化，请核对更新后的草稿再应用"; return; }
    if (!plan.changes.length && !plan.branch) return;
    writingDraft.value = true; notice.value = "";
    try {
      if ((!!plan.newBoardName || newBoard === true) && plan.workspace === "image" && plan.boardId) {
        const source = drawing.board(plan.boardId);
        if (!source) throw new Error("来源画板已删除");
        const form = boardForm({ ...drawing.snapshot().form, ...structuredClone(source.form), ...Object.fromEntries(plan.changes.map(c => [c.field, c.after])) });
        plan = { ...plan, createdBoard: { ...structuredClone(source), id: crypto.randomUUID(), name: plan.newBoardName ?? `${source.name} 副本`.slice(0, 80), color: boardColors[drawing.snapshot().boards.length % boardColors.length], nextCharacterId: Math.max(source.nextCharacterId, nextCharacterId(form.characters)), form } };
      }
      await history.apply(record, plan);
      checkpoint(record);
      draft.value = null;
      appliedDraft.value = { id: record.id, workspace: plan.workspace };
      say(`已应用草稿 ${plan.title} · ${plan.changes.length} 项 · ${plan.workspace === "image" ? "未生成" : "未发送"}`);
      await focusWritten(plan);
    } catch (error) { notice.value = message(error); }
    finally { saveFavorite(); await flushFavorites().catch(() => {}); writingDraft.value = false; draftRevision.value++; }
  }
  async function moveDraft(id: number, restore: boolean) {
    const record = restore ? redoTarget.value : undoTarget.value;
    if (!record || record.id !== id || writingDraft.value || controller || disposed) return;
    writingDraft.value = true; notice.value = "";
    try {
      await (restore ? history.restore(id) : history.undo(id));
      checkpoint(record);
      appliedDraft.value = restore ? { id, workspace: record.plan!.workspace } : null;
      say(`${restore ? "已恢复" : "已回退"}草稿 ${record.plan!.title}`);
      await focusWritten(record.plan!);
    } catch (error) {
      notice.value = `${restore ? "恢复" : "回退"}失败：${message(error)}`;
      deps.ui.toast(notice.value, "err");
    } finally { saveFavorite(); await flushFavorites().catch(() => {}); writingDraft.value = false; draftRevision.value++; }
  }
  const undoDraft = (id = undoTarget.value?.id) => id === undefined ? Promise.resolve() : moveDraft(id, false);
  const restoreDraft = (id: number) => moveDraft(id, true);
  function ignoreDraft() {
    if (!draft.value || writingDraft.value) return;
    draft.value = null; notice.value = ""; say("已忽略草稿，内容未修改");
  }

  function digestNow(anchorLabel: string | null, formText = false): Digest {
    const d = drawing.snapshot(),
      c = chat.snapshot(),
      workspace = router.route.value.workspace,
      conversation = c.current;
    const digest = buildDigest({
      workspace,
      anchor: anchorLabel,
      form: d.form,
      boardId: d.activeBoardId, boards: d.boards,
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
    }, { formText });
    return inline.value ? { ...digest, json: JSON.stringify({ ...JSON.parse(digest.json), inline_selection: inline.value }) } : digest;
  }
  const currentHash = () => stateHash(readDraftState());
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

  const dirtyFavorites = new Set<string>();
  let favoriteTimer: ReturnType<typeof setTimeout> | undefined, savingFavorites = Promise.resolve();
  let saveWarned = false;
  function savedConversation(c: Conversation): SavedConversation {
    const source = c === conversations.current && live.value
      ? [...c.entries, { type: "turn" as const, id: live.value.id, turn: live.value }] : c.entries;
    const savedEntries = source.map(e => e.type === "note" ? e : { ...e, turn: {
      ...e.turn,
      status: e.turn.status === "thinking" || e.turn.status === "running" ? "stopped" as const : e.turn.status,
      items: e.turn.items.map(item => item.kind !== "tools" ? item : { ...item, rows: item.rows.map(row => row.state === "run" ? { ...row, state: "stopped" as const } : row) }),
      attachments: e.turn.attachments.map(({ url: _url, ...a }) => a),
    } });
    return { version: 1, id: c.id, title: c.title, named: c.named, origin: c.origin, createdAt: c.createdAt,
      scope: { id: c.scope.id, labels: c.scope.ids.snapshot() }, session: c.session.snapshot(), entries: savedEntries,
      input: c.input, anchor: c.anchor, tray: c.tray,
      attachments: c.scope.attachments.snapshot([...c.tray, ...entryAttachments(savedEntries)]),
      draft: c.draft ? { value: c.draft.draft, off: [...c.draft.off], turnId: c.draft.turnId } : null };
  }
  function saveFavorite(c = conversations.current) {
    if (!favoritesReady.value || disposed || !c.favorite) return;
    dirtyFavorites.add(c.id);
    clearTimeout(favoriteTimer);
    favoriteTimer = setTimeout(() => void flushFavorites().catch(() => {}), 300);
  }
  function flushFavorites(write: Writer = services.data.write) {
    clearTimeout(favoriteTimer);
    if (!favoritesReady.value || !dirtyFavorites.size) return savingFavorites.catch(() => {});
    stash();
    const pending = [...dirtyFavorites]; dirtyFavorites.clear();
    const records: SavedConversation[] = [], remove: string[] = [];
    for (const id of pending) {
      const c = conversations.get(id);
      if (c?.favorite) records.push(savedConversation(c)); else remove.push(id);
    }
    const job = savingFavorites.catch(() => {}).then(async () => {
      try { await favorites.write(records, remove, write); saveWarned = false; }
      catch (error) {
        pending.forEach(id => dirtyFavorites.add(id));
        if (!saveWarned && !disposed) deps.ui.toast(`收藏保存失败：${message(error)}`, "err");
        saveWarned = true;
        throw error;
      }
    });
    savingFavorites = job;
    return job;
  }
  async function restoreFavorites() {
    try {
      const saved = await favorites.read();
      if (disposed) return;
      let checkpointId = 0;
      const restoredScopes = new Map<string, ConversationScope>();
      const restored = saved.map((record): Conversation => {
        // Each page extends its own copy, so two tabs can both allocate #a2 without mixing them later.
        let context = restoredScopes.get(record.scope.id);
        if (!context) { context = scope(); restoredScopes.set(record.scope.id, context); }
        context.ids.restore(record.scope.labels);
        context.attachments.restore(record.attachments, [...record.tray, ...entryAttachments(record.entries)]);
        const restoredEntries = record.entries.map(e => e.type === "note" ? e : { ...e, turn: { ...e.turn,
          // Historical checkpoints remain visible, but can never alias a new page's undo record.
          checkpoint: e.turn.checkpoint ? { ...e.turn.checkpoint, id: --checkpointId } : null,
          attachments: context.attachments.read(e.turn.attachments.map(a => a.id)).map(attachmentView),
        } });
        for (const entry of restoredEntries) sequence = Math.max(sequence, entry.id);
        const pending = record.draft ? history.create(record.draft.value, record.id, record.draft.turnId) : null;
        if (pending && record.draft) pending.off = new Set(record.draft.off);
        return { id: record.id, title: record.title, named: record.named, favorite: true, createdAt: record.createdAt, origin: record.origin,
          scope: context, session: createSession(addUsage, record.session.turns, record.session.usage), entries: restoredEntries,
          input: record.input, anchor: record.anchor, tray: record.tray, draft: pending, preparing: 0 };
      });
      conversations.restore(restored);
      if (restored.length) load();
    } catch (error) { if (!disposed) deps.ui.toast(`收藏读取失败：${message(error)}`, "err"); }
    finally { favoritesReady.value = true; }
  }
  const stopFavoriteSave = watch([entries, input, anchor, tray, draft, () => !!live.value, () => {
    void draftRevision.value;
    return [...(draft.value?.off ?? [])].join("|");
  }], () => saveFavorite());
  const unregisterFavorites = services.data.register({
    flush: flushFavorites,
    // Ordinary backup never replaces the ASK store. Refresh only its workspace references.
    async reload() { syncDrawing(); },
    ready() { if (dirtyFavorites.size) void flushFavorites().catch(() => {}); },
  });
  const flushOnHide = () => { if (document.visibilityState === "hidden") void flushFavorites().catch(() => {}); };
  const flushOnLeave = () => { void flushFavorites().catch(() => {}); };
  document.addEventListener("visibilitychange", flushOnHide);
  window.addEventListener("pagehide", flushOnLeave);

  const staticTokens = computed(
    () => approxTokens(JSON.stringify(toolList)) + approxTokens(system.value.join("\n")),
  );
  const stateTokens = computed(() => {
    void stateRevision.value;
    void entries.value;
    void conversationId.value;
    return visible.value && ready.value === "ok"
      ? estimateRequest({
          tools: [],
          system: ["", ""],
          messages: [
            ...conversations.current.session.messages,
            { role: "user", content: [{ type: "text", text: stateBlock(digestNow(anchor.value)) }, ...attachmentBlocks(attachments.read(tray.value), !settings.value.images)] },
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

  function providerForSend() {
    if (ready.value !== "ok") {
      notice.value =
        ready.value === "local"
          ? "请在服务端配置 ASK 推理连接后重启"
          : ready.value === "connection"
            ? "请先在设置 → ASK 选择连接"
            : "请先在设置 → ASK 选择模型";
      return;
    }
    try {
      return createProvider(connections.context(connection.value!.id), deps.fetch);
    } catch (error) {
      notice.value = message(error);
      return;
    }
  }
  type SendOptions = { metadataOnly?: boolean; anchor?: string | null; preserveInput?: boolean; attachments?: readonly string[] };
  async function send(text = input.value, options: SendOptions = {}) {
    if ((!text.trim() && !(options.attachments ?? tray.value).length) || !manageable() || preparing.value) return;
    if (draft.value) { notice.value = "请先应用或忽略当前草稿"; return; }
    const provider = providerForSend();
    if (provider) await runTurn(text, options, provider);
  }
  async function runTurn(text: string, options: SendOptions, provider: ReturnType<typeof createProvider>) {
    const question = text.trim();
    notice.value = "";
    // The compact success pill belongs to the write, not later replies.
    appliedDraft.value = null;
    const owner = conversations.current;
    const attached = attachments.read(options.attachments ?? tray.value);
    if (!entries.value.length && !owner.named) { owner.title = titleOf(question, attached[0]?.name); listRevision.value++; }
    const config = settings.value,
      turnAnchor = options.anchor !== undefined ? options.anchor : [...question.matchAll(idPattern)][0]?.[0] ?? anchor.value,
      metadataOnly = !!options.metadataOnly || !config.images,
      codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words, replacements: config.replacements });
    // The snapshot is fixed for the whole turn; get_state appends newer ones.
    const digest = digestNow(turnAnchor), initialState = digestNow(turnAnchor, true), snapshotTime = Date.now();
    const snapshot = drawing.snapshot(),
      frozenBoards = structuredClone(snapshot.boards),
      library = [...snapshotPictures(snapshot.history, snapshot.favorites, ids), ...chatPictures(chat.snapshot(), chat), ...attachmentPictures(attachments.read([...new Set([...entryAttachments(entries.value), ...attached.map(a => a.id)])]))],
      turnChatContext = chatContext(chat.snapshot()),
      known = owner.session.viewed(),
      turnViewed = new Set(known),
      draftBase = readDraftState();
    if (!metadataOnly) for (const a of attached) if (a.kind === "image") turnViewed.add(a.id);
    const user: AskMessage = {
      role: "user",
      content: [
        { type: "text", text: stateBlock(digest) },
        ...attachmentBlocks(attached, metadataOnly),
        { type: "text", text: question },
      ],
    };
    const turn = owner.session.begin(user, { metadataOnly }),
      abort = new AbortController(),
      pacer = createPacer();
    abort.signal.addEventListener("abort", pacer.cancel, { once: true });
    controller = abort;
    if (options.attachments === undefined) setTray([]); // Transfer the tray's references into this view turn.
    if (!options.preserveInput && text === input.value) input.value = "";
    const working: WorkingTurn = {
      id: ++sequence,
      question,
      anchor: turnAnchor,
      items: [],
      status: "thinking",
      failure: null,
      truncated: false,
      metadataOnly,
      committed: null,
      checkpoint: null,
      attachments: attached.map(attachmentView),
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
    saveFavorite(owner);
    if (owner.favorite) void flushFavorites().catch(() => {});
    let last: "text" | "start" | "end" | null = null;
    const rows = new Map<string, Mutable<ToolRow>>();
    async function* tracedStream(request: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
      let call = 0;
      try {
        yield* provider.stream(request, { codec, signal, allowEmpty: turn.budget.toolCalls > 0, observe(event) {
          if (event.type === "request") call = callLog.start({ conversation: owner.id, turn: working.id, step: turn.budget.requests, question,
            connection: config.connectionId, protocol: provider.profile.protocol === "anthropic-messages" ? "anthropic-messages" : "openai-chat",
            model: request.model, promptVersion }, event.body);
          else if (call) callLog.finish(call, event);
        } });
      } catch (error) {
        if (call) callLog.fail(call, signal.aborted);
        throw error;
      }
    }
    try {
      for await (const event of run({
        stream: tracedStream,
        request: { model: config.model, tools: toolList, system: system.value, maxTokens: MAX_OUTPUT },
        turn,
        tools,
        context: {
          signal: abort.signal,
          metadataOnly,
          library,
          vision,
          visual: { signal: abort.signal, metadataOnly, budget: turn.budget.vision, viewed: turnViewed },
          tags: services.tags.suggest,
          snapshotTime,
          chatContext: turnChatContext,
          draftBase,
          question,
          state: (scope, boardId) => {
            if (boardId) {
              const boards = scope === "latest" ? drawing.snapshot().boards : frozenBoards;
              const board = boards.find(b => b.id === boardId);
              if (!board) throw new Error("画板不在该状态快照中");
              return { text: JSON.stringify({ board_id: board.id, name: board.name, form: { ...board.form, characters: board.form.characters.map(c => ({ ...characterSummary(c, board.form.placement, board.form.model), centers: c.centers })) }, character_capability: characterCapability(board.form.model), draft_base_hash: digest.baseHash }), images: snapshot.history.length };
            }
            return scope === "latest" ? {
            text: stateBlock(digestNow(turnAnchor, true)),
            images: drawing.snapshot().history.length,
          } : { text: stateBlock(initialState), images: snapshot.history.length };
          },
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
        } else if (event.type === "usage") { usage.value = { ...total }; conversationUsage.value = owner.session.usage; }
        else if (event.type === "done") working.truncated = event.reason === "length";
      }
      if (proposed) pacer.push(() => {}, PACE.beforeDraft);
      await pacer.settled();
      abort.signal.throwIfAborted();
      turn.commit({ viewed: [...turnViewed].filter((id) => !known.has(id)) });
      working.committed = owner.session.turns;
      if (proposed) draft.value = history.create(proposed, owner.id, working.id);
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
      usage.value = { ...total };
      conversationUsage.value = owner.session.usage;
      saveFavorite(owner);
      if (owner.favorite) await flushFavorites().catch(() => {});
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
  // The menu is locked while a turn runs or a draft is being written.
  const manageable = () => favoritesReady.value && !favoriteBusy.value && !controller && !writingDraft.value && !disposed;
  function renameConversation(id: string, name: string) {
    const owner = conversations.get(id);
    if (!owner || !name.trim() || disposed) return;
    owner.title = titleOf(name); owner.named = true; listRevision.value++;
    saveFavorite(owner);
  }
  async function toggleFavorite() {
    if (!manageable() || preparing.value) return;
    const owner = conversations.current, before = owner.favorite;
    favoriteBusy.value = true;
    owner.favorite = !before; listRevision.value++;
    dirtyFavorites.add(owner.id);
    try { await flushFavorites(); }
    catch { owner.favorite = before; dirtyFavorites.delete(owner.id); listRevision.value++; }
    finally { favoriteBusy.value = false; }
  }
  /** A single explicit naming request, independent of conversation turns and generation locks. */
  async function generateName(target: NamingTarget) {
    if (disposed) return;
    if (naming.value) {
      if (naming.value.kind === target.kind && naming.value.id === target.id) namingController?.abort();
      return;
    }
    stash();
    const owner = target.kind === "conversation" ? conversations.get(target.id) : null,
      board = target.kind === "board" ? drawing.board(target.id) : null;
    if (!owner && !board) return;
    const original = owner?.title ?? board!.name, config = settings.value,
      choice = config.naming ?? config;
    let call = 0, received = false;
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(new ProviderError("timeout", "命名超时，请重试")), 60_000);
    namingController = abort; naming.value = target;
    try {
      const source = board ? boardNameContent(board.form) : conversationNameContent(owner!.entries.flatMap(e => e.type === "turn" && e.turn.status === "done"
        ? [{ question: e.turn.question, reply: e.turn.items.flatMap(i => i.kind === "text" ? [i.text] : []).join("\n") }] : []));
      const request = namingRequest(choice.model, source);
      if (!reasoningConnections(routing.value).some(c => c.id === choice.connectionId) || !choice.model)
        throw new Error("请先在设置 → ASK 配置命名模型或当前 ASK 模型");
      const provider = createProvider(connections.context(choice.connectionId), deps.fetch),
        codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words, replacements: config.replacements });
      let text = "";
      for await (const event of provider.stream(request, { signal: abort.signal, codec, observe(event) {
        if (event.type === "request") call = callLog.start({ conversation: owner?.id ?? `board:${target.id}`, turn: 0, step: 1, question: `AI 命名 · ${owner ? "ASK" : "画板"}`,
          connection: choice.connectionId, protocol: provider.profile.protocol === "anthropic-messages" ? "anthropic-messages" : "openai-chat", model: choice.model, promptVersion: namingPromptVersion }, event.body);
        else if (call) callLog.finish(call, event);
      } })) {
        if (event.type === "text") text += event.text;
        else if (event.type === "call") throw new Error("命名请求返回了工具调用，请重试");
        else {
          if (event.usage) { addUsage(event.usage); usage.value = { ...total }; }
          if (event.stop !== "end") throw new Error("名称未完整生成，请重试");
        }
      }
      received = true;
      abort.signal.throwIfAborted();
      const name = readGeneratedName(text, owner ? 60 : 80);
      if (owner) {
        if (conversations.get(owner.id) !== owner || owner.title !== original) return;
        renameConversation(owner.id, name);
      } else {
        if (drawing.board(target.id) !== board || board!.name !== original) return;
        await drawing.renameBoard(target.id, name);
      }
      if (!disposed) deps.ui.toast("名称已更新");
    } catch (error) {
      if (call && !received) callLog.fail(call, abort.signal.aborted && !(abort.signal.reason instanceof ProviderError));
      if (!disposed && (!abort.signal.aborted || abort.signal.reason instanceof ProviderError))
        deps.ui.toast(`命名失败：${message(abort.signal.aborted ? abort.signal.reason : error)}`, "err");
    } finally {
      clearTimeout(timeout);
      if (namingController === abort) { namingController = null; naming.value = null; }
    }
  }
  /** Stays on (or returns to) the one empty conversation; "limit" at 20. */
  function newConversation(): boolean | "limit" {
    if (!manageable()) return false;
    stash();
    const before = conversations.current;
    if (conversations.fresh() === "limit") return "limit";
    if (conversations.current !== before) load();
    anchor.value = null;
    return true;
  }
  function selectConversation(id: string) {
    if (!manageable() || id === conversations.current.id) return;
    stash();
    if (conversations.select(id)) load();
  }
  /** Written content stays as it is; nothing is reverted. */
  async function deleteConversation(id: string) {
    if (!manageable()) return;
    const owner = conversations.get(id);
    if (owner?.favorite) {
      favoriteBusy.value = true; owner.favorite = false; dirtyFavorites.add(id);
      try { await flushFavorites(); }
      catch { owner.favorite = true; dirtyFavorites.delete(id); return; }
      finally { favoriteBusy.value = false; }
    }
    stash();
    const before = conversations.current;
    const gone = conversations.remove(id);
    if (!gone) return;
    gone.scope.attachments.release([...gone.tray, ...entryAttachments(gone.entries)]);
    history.removeConversation(id);
    draftRevision.value++;
    if (conversations.current !== before) load();
    else listRevision.value++;
  }
  /** Preflight the whole rollback before invoking any write port or truncating. */
  async function editTurn(id: number, text: string): Promise<boolean> {
    if (!manageable() || preparing.value) return false;
    const index = entries.value.findIndex(e => e.type === "turn" && e.id === id);
    const entry = entries.value[index];
    if (!entry || entry.type !== "turn" || (!text.trim() && !entry.turn.attachments.length) || !providerForSend()) return false;
    const removed = entries.value.slice(index), turnIds = new Set(removed.filter(e => e.type === "turn").map(e => e.id));
    const applied = removed.flatMap(e => e.type === "turn" && e.turn.checkpoint?.status === "applied" ? [e.turn.checkpoint.id] : []);
    const retained = entries.value.slice(0, index).reduce((count, e) => e.type === "turn" ? Math.max(count, e.turn.committed ?? 0) : count, 0);
    writingDraft.value = true; notice.value = "";
    try {
      const order = history.preflight(applied);
      for (const recordId of order) {
        checkpoint(await history.undo(recordId));
        appliedDraft.value = null;
      }
      // Credentials/settings can change during persistence; never delete before ready.
      const provider = providerForSend();
      if (!provider) return false;
      conversations.current.session.truncate(retained);
      const originalAttachments = entry.turn.attachments.map(a => a.id);
      attachments.retain(originalAttachments);
      attachments.release(entryAttachments(removed));
      entries.value = entries.value.slice(0, index);
      history.removeTurns(conversationId.value, turnIds);
      if (draft.value && turnIds.has(draft.value.turnId)) draft.value = null;
      appliedDraft.value = null;
      if (order.length) deps.ui.toast(`已撤回 ${order.length} 份草稿`);
      writingDraft.value = false;
      void runTurn(text, { anchor: entry.turn.anchor, metadataOnly: entry.turn.metadataOnly, preserveInput: true, attachments: originalAttachments }, provider);
      return true;
    } catch (error) {
      notice.value = `回退失败：${message(error)}`;
      deps.ui.toast(notice.value, "err");
      return false;
    } finally { writingDraft.value = false; draftRevision.value++; }
  }
  function forkTurn(id: number): boolean | "limit" {
    if (!manageable()) return false;
    const index = entries.value.findIndex(e => e.type === "turn" && e.id === id), entry = entries.value[index];
    if (!entry || entry.type !== "turn" || entry.turn.status !== "done" || entry.turn.committed === null) return false;
    stash();
    const source = conversations.current, count = entry.turn.committed;
    const fork = conversations.fork(newId => ({
      id: newId, title: source.title, named: source.named, origin: { conversationId: source.id, turnId: id },
      favorite: false, createdAt: Date.now(), scope: source.scope,
      session: source.session.fork(count),
      entries: entries.value.slice(0, index + 1).flatMap(e => e.type === "turn" ? [{ ...e, turn: { ...e.turn, checkpoint: null } }] : []),
      anchor: entry.turn.anchor, input: "", draft: null, tray: [], preparing: 0,
    }));
    if (fork === "limit") { deps.ui.toast("最多 20 个对话"); return "limit"; }
    attachments.retain(entryAttachments(fork.entries));
    load();
    return true;
  }
  /** Only the user's click retries; nothing here runs on its own. */
  function retry(id: number, mode: RetryMode) {
    const entry = entries.value.find((e) => e.type === "turn" && e.id === id);
    if (!entry || entry.type !== "turn" || controller || writingDraft.value || draft.value || preparing.value) return;
    if (mode === "codec") {
      if (!adult.value || !settings.value.words.length) return;
      sessionCodec.value = true;
    }
    const provider = providerForSend();
    if (!provider) return;
    entries.value = entries.value.filter((e) => e !== entry);
    void runTurn(entry.turn.question, { metadataOnly: mode === "metadata" || entry.turn.metadataOnly, anchor: entry.turn.anchor, preserveInput: true, attachments: entry.turn.attachments.map(a => a.id) }, provider);
  }
  /** Esc: popovers, then the draft (A2), then the running turn, then the drawer. */
  function escape() {
    for (const layer of [...layers].reverse()) if (layer()) return;
    if (writingDraft.value) return;
    if (draft.value) ignoreDraft();
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
      if (draft.value) { inline.value = null; open.value = true; notice.value = "请先应用或忽略当前草稿"; return; }
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
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z" && canUndoDraft.value && !controller && !writingDraft.value) {
      const field = active?.id === "chatPrompt" ? "composer" : active?.id;
      const target = undoTarget.value?.plan?.changes.some((c) => c.field === field);
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
      if (!open.value) anchor.value = null;
      open.value = !open.value;
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || (!visible.value && !compact) || modal()) return;
    if (!inside && active && active !== document.body) return;
    // Stopping lives in the window: Esc on the island never interrupts a running turn.
    if (!visible.value && controller) return;
    event.preventDefault();
    escape();
  }
  window.addEventListener("keydown", onKey);
  void restoreFavorites();

  return {
    debug: debug as Readonly<ShallowRef<CallLogView>>,
    debugCall: callLog.get,
    debugPrevious: callLog.previous,
    exportDebug: callLog.export,
    clearDebug() { if (!controller && !namingController) callLog.clear(); },
    naming: naming as Readonly<ShallowRef<NamingTarget | null>>,
    generateName,
    renameConversation,
    toggleFavorite,
    favoritesReady,
    favoriteBusy,
    flushFavorites,
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
    conversationUsage: conversationUsage as Readonly<ShallowRef<AskUsage>>,
    conversationId: conversationId as Readonly<ShallowRef<string>>,
    /** Newest first. */
    conversations: computed(() => {
      void listRevision.value;
      return conversations.list().map((c) => ({ id: c.id, title: c.title, fork: !!c.origin, favorite: c.favorite })).sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }),
    heading: computed(() => {
      void listRevision.value;
      return { title: conversations.current.title, fork: !!conversations.current.origin, favorite: conversations.current.favorite };
    }),
    canManage: computed(() => favoritesReady.value && !favoriteBusy.value && !running.value && !writingDraft.value),
    newConversation,
    selectConversation,
    deleteConversation,
    editTurn,
    forkTurn,
    tray: computed(() => attachments.read(tray.value).map(attachmentView)),
    preparing,
    addFiles,
    addPastedText(text: string) { return addFiles([new File([text], "粘贴的文本", { type: "text/plain" })], true); },
    removeAttachment,
    attachmentPreview,
    openAttachment(id: string) { const a = attachments.get(id); if (a?.kind === "text") attachmentPreview.value = { id, name: a.name, text: a.text }; },
    closeAttachment() { attachmentPreview.value = null; },
    attachmentText(id: string) { const a = attachments.get(id); return a?.kind === "text" ? a.text : null; },
    referenceHistory(id: string) {
      const label = ids.label(id);
      if (label) input.value += `${input.value && !/\s$/.test(input.value) ? " " : ""}${label} `;
    },
    settings: settings as Readonly<ShallowRef<ReturnType<typeof readSettings>>>,
    adult: adult as Readonly<ShallowRef<boolean>>,
    preferencePaused: preferencePaused as Readonly<ShallowRef<boolean>>,
    ready,
    draftPlan,
    appliedDraft,
    undoId: computed(() => undoTarget.value?.id ?? null),
    redoId: computed(() => redoTarget.value?.id ?? null),
    writingDraft,
    draftApplyLabel,
    canUndoDraft,
    applyDraft,
    undoDraft,
    restoreDraft,
    ignoreDraft,
    toggleDraftStep(id: string) {
      if (writingDraft.value || !draft.value) return;
      const next = new Set(draft.value.off);
      if (next.has(id)) next.delete(id); else next.add(id);
      draft.value.off = next;
      draftRevision.value++;
    },
    reproposeDraft() {
      if (!draft.value || writingDraft.value || controller) return;
      const question = draft.value.draft.question;
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
      else if (!open.value) anchor.value = null;
      if (options.question) input.value = input.value.trim() ? `${input.value}\n${options.question}` : options.question;
      open.value = true;
    },
    hide() {
      open.value = false;
    },
    toggle() {
      inline.value = null;
      if (!open.value) anchor.value = null;
      if (!editorOpen.value) open.value = !open.value;
    },
    clearAnchor() {
      anchor.value = null;
    },
    labelFor(id: string) { return ids.label(id); },
    pictureInfo(label: string) {
      if (label.startsWith("#a")) {
        const a = attachments.get(label);
        return a?.kind === "image" ? { label, url: a.url, width: a.size.width, height: a.size.height } : null;
      }
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
      if (label.startsWith("#a")) return;
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
    /** The same stored switch as the settings page. */
    setImages(on: boolean) {
      return preferences.set(names.ask, { ...settings.value, images: on });
    },
    picks,
    /** The quick switch stores the same choice as the settings page. */
    useModel(connectionId: string, id: string) {
      return preferences.set(names.ask, withModel(settings.value, connectionId, id));
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
      saveFavorite();
      void flushFavorites().catch(() => {});
      disposed = true;
      stopFavoriteSave();
      unregisterFavorites();
      clearTimeout(favoriteTimer);
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnLeave);
      namingController?.abort();
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
      callLog.clear();
      vision.dispose();
      for (const context of scopes.values()) context.attachments.dispose();
      scopes.clear();
      attachmentPreview.value = null;
      root = null;
    },
  };
}
export type Ask = ReturnType<typeof createAsk>;
