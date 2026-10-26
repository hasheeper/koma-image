import { canonical } from "./canonical.ts";
import { parseFile } from "./draft/files.ts";
import type { FilePort } from "./draft/files.ts";
import type { Slates } from "../slate/service.ts";
import { summary as slateSummary } from "../slate/model.ts";
import type { ExternalOrigin, ExternalNote, InboxReceipt } from "../bridge/protocol.ts";
import { characterCapability, characterSummary, nextCharacterId } from "../domain/characters.ts";
import { boardForm, boardColors } from "../domain/drawing.ts";
import { stateHash } from "./draft/validate.ts";
import { chatSnapshot, chatContext, chatDraftModel, chatImages, chatModelState, chatPictures } from "./chat-context.ts";
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
import type { SessionData } from "./session.ts";
import { runCompaction } from "./compact/run.ts";
import { archiveCount, shouldCompact } from "./compact/trigger.ts";
import { attachmentIndex } from "./compact/archive.ts";
import { recordDraft } from "./compact/ledger.ts";
import type { TurnId } from "./compact/ledger.ts";
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
import type { Draft, DraftPlan, DraftState, HandoffImage } from "./draft/types.ts";
import { ATTACHMENT_LIMITS, attachmentBlocks, attachmentCapacity, attachmentPictures, attachmentView, createAttachments, prepareAttachment } from "./attachments.ts";
import type { AttachmentView } from "./attachments.ts";
import { boardNameContent, conversationNameContent, namingRequest, readGeneratedName } from "./naming.ts";
import type { NamingTarget } from "./naming.ts";
import { namingPromptVersion } from "./prompts/naming.ts";
import { createAskFavorites, restoreSavedSession } from "./favorites.ts";
import type { SavedConversation } from "./favorites.ts";
import type { Writer } from "../services/data-lease.ts";
import type { RefSource, RefFile } from "./reference-source.ts";
import { createReferenceReader } from "./read-ref.ts";

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
  readonly receipts?: readonly ToolRow[];
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
  /** Successful conversation turn ID, independent of the UI row and undo record. */
  readonly turnId: TurnId | null;
  readonly checkpoint: CheckpointView | null;
  readonly attachments: readonly AttachmentView[];
}
export type AskEntry =
  | { readonly type: "turn"; readonly id: number; readonly turn: AskTurnView }
  | { readonly type: "note"; readonly id: number; readonly text: string; readonly compactRetry?: boolean; readonly external?: ExternalNote; readonly checkpoint?: CheckpointView | null };
export type RetryMode = "plain" | "metadata" | "codec";
interface ConversationScope {
  readonly id: string;
  readonly ids: ReturnType<typeof createIds>;
  readonly attachments: ReturnType<typeof createAttachments>;
}
/** The current conversation lives in the service's refs while selected. */
interface Conversation extends ConversationCore {
  slateId: string | null;
  named: boolean;
  favorite: boolean;
  readonly createdAt: number;
  readonly scope: ConversationScope;
  readonly session: Session;
  entries: readonly AskEntry[];
  input: string;
  anchor: string | null;
  draft: DraftRecord | null;
  externalQueue: DraftRecord[];
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
  slates?: Slates;
  fetch?: typeof fetch;
  ui: Pick<Ui, "toast">;
}) {
  const { services, router, drawing, chat } = deps;
  const { preferences, connections } = services;
  let filePort: FilePort | null = null;
  const writer = createDraftWriter(drawing, chat, router, deps.slates, () => filePort),
    history = createDraftStack(writer),
    vision = createVision(),
    tools = createTools(),
    toolList = [...tools.values()].map((entry) => entry.tool);
  const scopes = new Map<string, ConversationScope>();
  let referenceSource: RefSource | null = null;
  const pageAttachmentBytes = () => [...scopes.values()].reduce((sum, c) => sum + c.attachments.bytes, 0);
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
  const compacting = shallowRef(false), dispatching = shallowRef(false);
  let compactingOwner: string | null = null;
  const attachmentPreview = shallowRef<{ id: string; name: string; text: string; turnId?: TurnId; inline?: boolean } | null>(null);
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
    make: (id) => ({ id, slateId: null, title: UNTITLED, named: false, favorite: false, createdAt: Date.now(), scope: activeScope, origin: null, session: createSession(addUsage), entries: [], input: "", anchor: null, draft: null, externalQueue: [], tray: [], preparing: 0 }),
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
  function addInputs(inputs: readonly (() => Promise<{ file: File; origin?: RefFile["origin"] }>)[], pasted = false) {
    const owner = conversations.current, attachments = owner.scope.attachments;
    if (disposed || !favoritesReady.value || !inputs.length) return Promise.resolve();
    owner.preparing++; preparing.value = owner.preparing;
    importing = importing.then(async () => {
      const errors: string[] = [], unsupported: string[] = [];
      for (const read of inputs) {
        if (disposed || !conversations.get(owner.id)) break;
        try {
          const { file, origin } = await read();
          if ([...scopes.values()].reduce((sum, c) => sum + c.attachments.bytes, file.size) > ATTACHMENT_LIMITS.pageBytes) throw new Error("本页附件已超过 200 MB");
          const prepared = await prepareAttachment(file, pasted, settings.value.textAttachments);
          if (disposed || !conversations.get(owner.id)) break;
          attachmentCapacity(attachments.read(owner.tray), prepared.kind, prepared.kind === "text" ? prepared.text.length : 0, settings.value.textAttachments);
          const item = attachments.add({ ...prepared, ...(origin ? { origin } : {}) });
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
  function addFiles(files: readonly File[], pasted = false) { return addInputs(files.map(file => async () => ({ file })), pasted); }
  function removeAttachment(id: string) {
    if (!tray.value.includes(id)) return;
    if (attachmentPreview.value?.id === id) attachmentPreview.value = null;
    setTray(tray.value.filter(value => value !== id)); attachments.release([id]);
  }
  const editorOpen = computed(() => router.route.value.overlay === "editor"),
    visible = computed(() => open.value && !editorOpen.value),
    running = computed(() => live.value !== null || compacting.value || dispatching.value),
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
  const externalEvents = new Set<(origin: ExternalOrigin, receipt: InboxReceipt) => void>();
  const externalRevision = shallowRef(0);
  function externalStatus(record: DraftRecord, status: InboxReceipt["status"], error?: string) {
    const origin = record.draft.external, owner = conversations.get(record.conversationId);
    if (!origin || !owner) return;
    const rows = (owner === conversations.current ? entries.value : owner.entries).map(e => e.id === record.turnId && e.type === "note"
      ? { ...e, external: { origin, status, ...(error ? { error } : {}) } } : e);
    owner.entries = rows;
    if (owner === conversations.current) entries.value = rows;
    for (const fn of externalEvents) fn(origin, { draft_id: origin.draftId, status, ...(error ? { error } : {}) });
    saveFavorite(owner);
  }
  function promoteExternal() {
    if (disposed || !favoritesReady.value || favoriteBusy.value || running.value || writingDraft.value || draft.value || preparing.value || controller) return;
    const owner = conversations.current, next = owner.externalQueue.shift();
    if (!next) return;
    draft.value = next; owner.draft = next;
    externalRevision.value++; draftRevision.value++;
    say("外部草稿已就绪，等待确认"); saveFavorite(owner);
  }
  const stopExternal = watch([running, writingDraft, draft, preparing, favoritesReady, favoriteBusy, conversationId, externalRevision], promoteExternal);
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
  function readDraftState(boardId?: string, slateId?: string): DraftState {
    const d = drawing.snapshot(), c = chat.snapshot().current;
    const board = d.boards.find(b => b.id === (boardId ?? d.activeBoardId));
    return { fileContext: filePort?.context(), slate: deps.slates?.get(slateId ?? conversations.current.slateId ?? "") ?? null, boardId: boardId ?? d.activeBoardId, boardName: board?.name, boardPresent: !!board, nextCharacterId: board?.nextCharacterId, form: structuredClone({ ...d.form, ...board?.form }), composer: c.prompt, conversationId: c.id, chat: chatSnapshot(chat.snapshot()), models: [...d.models], samplers: [...d.samplers], samplersByModel: Object.fromEntries(d.models.map((m) => [m.id, drawing.samplersFor(m.id)])),
      workspace: router.route.value.workspace, chatModel: chatDraftModel(chat.snapshot()) };
  }
  /** Handoff images are checked live: IMAGE records by ID, CHAT pictures by asset. */
  function hasImage(image: HandoffImage) {
    if (image.source === "chat") return chat.assets.assets.has(image.ref);
    const d = drawing.snapshot();
    return d.history.some((r) => r.id === image.ref) || d.favorites.some((r) => r.id === image.ref);
  }
  const draftPlan = computed(() => {
    void draftRevision.value;
    return draft.value ? validateDraft(draft.value.draft, readDraftState(draft.value.draft.base.boardId, draft.value.draft.steps.find(s => s.kind === "slate_edit")?.change.before?.id), { off: draft.value.off, has: hasImage }) : null;
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
    const receipts: ToolRow[] = [];
    const change = record.plan.slate;
    if (change) {
      for (const todo of change.after?.todos ?? []) {
        const old = change.before?.todos.find(t => t.id === todo.id);
        if (canonical(old ?? null) === canonical(todo)) continue;
        receipts.push({ id: todo.id, name: 'slate_edit', verb: todo.status === 'done' && old?.status !== 'done' ? '完成' : old ? '更新' : '添加', object: todo.title, stat: '', state: 'done' });
      }
      for (const todo of change.before?.todos ?? []) if (!change.after?.todos.some(t => t.id === todo.id)) receipts.push({ id: todo.id, name: 'slate_edit', verb: '移除', object: todo.title, stat: '', state: 'done' });
      if (canonical(change.before?.golden_recipe ?? null) !== canonical(change.after?.golden_recipe ?? null)) receipts.push({ id: `${change.id}-recipe`, name: 'propose_draft', verb: '更新', object: '任务配方', stat: '', state: 'done' });
      if (!receipts.length) receipts.push({ id: change.id, name: 'slate_edit', verb: change.after ? '更新清单' : '删除清单', object: change.after?.title ?? change.before?.title ?? '', stat: '', state: 'done' });
    }
    for (const file of record.plan.files ?? []) receipts.push({ id: file.id, name: 'save_ref', verb: file.context.id === null ? '准备下载' : '保存', object: file.title, stat: file.context.id === null ? '下载' : 'refs/', state: 'done' });
    if (receipts.length && record.plan.changes.length) receipts.push({ id: `${record.id}-board`, name: 'propose_draft', verb: '更新', object: '画板', stat: `${record.plan.changes.length} 项`, state: 'done' });
    const view: CheckpointView = { id: record.id, title: record.plan.title, status: record.status, added, removed, ...(receipts.length ? { receipts } : {}) };
    const next = (owner === conversations.current ? entries.value : owner.entries).map((e) =>
      e.id !== record.turnId ? e : e.type === "turn" ? { ...e, turn: { ...e.turn, checkpoint: view } } : { ...e, checkpoint: view });
    const turn = next.find(e => e.type === "turn" && e.id === record.turnId);
    if (turn?.type === "turn" && turn.turn.turnId) owner.session.updateDraft(turn.turn.turnId, record.status, record.plan);
    owner.entries = next;
    if (owner === conversations.current) entries.value = next;
    saveFavorite(owner);
  }
  const draftApplyLabel = computed(() => {
    const plan = draftPlan.value, workspace = plan?.workspace;
    if (plan?.files?.length) return "应用";
    if (plan?.slate && !plan.changes.length && !plan.newBoardName) return "应用到任务板";
    if (plan?.steps.some((s) => s.kind === "handoff")) return router.route.value.workspace === "chat" ? "新开对话并应用" : "切到对话并新开";
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
    // A page that never opened CHAT has no restored conversation to write into.
    writingDraft.value = true;
    try { await chat.warm(); } finally { writingDraft.value = false; }
    if (draft.value !== record || controller || disposed) return;
    let plan = validateDraft(record.draft, readDraftState(record.draft.base.boardId, record.draft.steps.find(s => s.kind === "slate_edit")?.change.before?.id), { off: record.off, has: hasImage });
    if (plan.fingerprint !== fingerprint) { draftRevision.value++; notice.value = "内容已变化，请核对更新后的草稿再应用"; return; }
    if (!plan.changes.length && !plan.branch && !plan.handoff && !plan.slate && !plan.files?.length) return;
    if (plan.files?.length && plan.steps.some(step => step.issue)) { notice.value = "草稿有冲突，请先核对"; return; }
    writingDraft.value = true; notice.value = "";
    try {
      if ((!!plan.newBoardName || newBoard === true) && plan.workspace === "image" && plan.boardId) {
        const source = drawing.board(plan.boardId);
        if (!source) throw new Error("来源画板已删除");
        const form = boardForm({ ...drawing.snapshot().form, ...structuredClone(source.form), ...Object.fromEntries(plan.changes.map(c => [c.field, c.after])) });
        plan = { ...plan, createdBoard: { ...structuredClone(source), id: crypto.randomUUID(), name: plan.newBoardName ?? `${source.name} 副本`.slice(0, 80), color: boardColors[drawing.snapshot().boards.length % boardColors.length], nextCharacterId: Math.max(source.nextCharacterId, nextCharacterId(form.characters)), form } };
      }
      await history.apply(record, plan);
      if (plan.slate?.after) conversations.current.slateId = plan.slate.id;
      checkpoint(record);
      if (plan.slate) notice.value = deps.slates?.error.value ?? "";
      externalStatus(record, "applied", notice.value || undefined);
      draft.value = null;
      appliedDraft.value = { id: record.id, workspace: plan.workspace };
      const count = plan.handoff ? plan.steps.filter((s) => s.enabled && !s.issue && !s.locked).length : plan.changes.length + (plan.slate ? 1 : 0) + (plan.files?.length ?? 0);
      say(`已应用草稿 ${plan.title} · ${count} 项 · ${plan.workspace === "image" ? "未生成" : "未发送"}`);
      await focusWritten(plan);
    } catch (error) { notice.value = message(error); externalStatus(record, "pending", notice.value); }
    finally { saveFavorite(); await flushFavorites().catch(() => {}); writingDraft.value = false; draftRevision.value++; }
  }
  async function moveDraft(id: number, restore: boolean) {
    const record = restore ? redoTarget.value : undoTarget.value;
    if (!record || record.id !== id || writingDraft.value || controller || disposed) return;
    writingDraft.value = true; notice.value = "";
    try {
      await chat.warm();
      await (restore ? history.restore(id) : history.undo(id));
      checkpoint(record);
      if (record.plan?.slate) notice.value = deps.slates?.error.value ?? "";
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
    if (!draft.value || writingDraft.value || controller || disposed) return;
    const entry = entries.value.find(e => e.type === "turn" && e.id === draft.value?.turnId);
    if (entry?.type === "turn" && entry.turn.turnId) conversations.current.session.updateDraft(entry.turn.turnId, "dismissed");
    externalStatus(draft.value, "dismissed");
    draft.value = null; notice.value = ""; say("已忽略草稿，内容未修改");
  }

  function digestNow(anchorLabel: string | null, formText = false): Digest {
    const d = drawing.snapshot(),
      c = chat.snapshot(),
      workspace = router.route.value.workspace,
      conversation = c.current;
    const digest = buildDigest({
      askTurnId: conversations.current.session.nextTurnId,
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
      chatModel: chatModelState(c),
      ids,
    }, { formText });
    return { ...digest, json: JSON.stringify({ ...JSON.parse(digest.json),
      active_slate: slateSummary(deps.slates?.get(conversations.current.slateId ?? "") ?? null),
      ...(referenceSource ? { refs_index: referenceSource.index() } : {}),
      ...(inline.value ? { inline_selection: inline.value } : {}) }) };
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
    ...(deps.slates ? [deps.slates.subscribe(() => { stateRevision.value++; draftRevision.value++; })] : []),
    chat.subscribe(() => { draftRevision.value++; libraryRevision.value++; }),
    watch(open, (shown) => { if (shown) void chat.warm(); }, { immediate: true }),
    preferences.subscribe((key) => {
      if (!key || key === names.ask) settings.value = readSettings();
      if (!key || key === names.askAdult) adult.value = readAdult();
    }),
    connections.subscribe(() => (routing.value = connections.configuration)),
  ];

  const dirtyFavorites = new Set<string>();
  let favoriteTimer: ReturnType<typeof setTimeout> | undefined, savingFavorites = Promise.resolve();
  let saveWarned = false;
  function savedConversation(c: Conversation, session = c.session.snapshot()): SavedConversation {
    const source = c === conversations.current && live.value
      ? [...c.entries, { type: "turn" as const, id: live.value.id, turn: live.value }] : c.entries;
    const savedEntries = source.map(e => e.type === "note" ? e : { ...e, turn: {
      ...e.turn,
      status: e.turn.status === "thinking" || e.turn.status === "running" ? "stopped" as const : e.turn.status,
      items: e.turn.items.map(item => item.kind !== "tools" ? item : { ...item, rows: item.rows.map(row => row.state === "run" ? { ...row, state: "stopped" as const } : row) }),
      attachments: e.turn.attachments.map(({ url: _url, ...a }) => a),
    } });
    return { version: 1, id: c.id, title: c.title, named: c.named, origin: c.origin, createdAt: c.createdAt, slateId: c.slateId,
      scope: { id: c.scope.id, labels: c.scope.ids.snapshot() }, session, entries: savedEntries,
      input: c.input, anchor: c.anchor, tray: c.tray,
      attachments: c.scope.attachments.snapshot([...c.tray, ...entryAttachments(savedEntries), ...session.archive.flatMap(t => t.attachments)]),
      draft: c.draft ? { value: c.draft.draft, off: [...c.draft.off], turnId: c.draft.turnId } : null,
      externalQueue: c.externalQueue.map(r => ({ value: r.draft, turnId: r.turnId })) };
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
    // A compaction candidate owns this record until its durable commit. Other
    // favorites may still flush, but cannot queue a stale copy of this owner.
    const pending = [...dirtyFavorites].filter(id => id !== compactingOwner);
    if (!pending.length) return savingFavorites.catch(() => {});
    pending.forEach(id => dirtyFavorites.delete(id));
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
        const session = restoreSavedSession(record, addUsage);
        const restoredEntries = record.entries.map(e => e.type === "note" ? { ...e, checkpoint: e.checkpoint ? { ...e.checkpoint, id: --checkpointId } : null } : { ...e, turn: { ...e.turn,
          turnId: e.turn.turnId ?? (e.turn.committed ? session.records[e.turn.committed - 1]?.turnId ?? null : null),
          // Historical checkpoints remain visible, but can never alias a new page's undo record.
          checkpoint: e.turn.checkpoint ? { ...e.turn.checkpoint, id: --checkpointId } : null,
          attachments: context.attachments.read(e.turn.attachments.map(a => a.id)).map(attachmentView),
        } });
        for (const entry of restoredEntries) sequence = Math.max(sequence, entry.id);
        const pending = record.draft ? history.create(record.draft.value, record.id, record.draft.turnId) : null;
        if (pending && record.draft) pending.off = new Set(record.draft.off);
        return { id: record.id, slateId: record.slateId ?? null, title: record.title, named: record.named, favorite: true, createdAt: record.createdAt, origin: record.origin,
          scope: context, session, entries: restoredEntries,
          input: record.input, anchor: record.anchor, tray: record.tray, draft: pending, preparing: 0, externalQueue: (record.externalQueue ?? []).map(r => history.create(r.value, record.id, r.turnId)) };
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
            ...conversations.current.session.requestHistory(!settings.value.images),
            { role: "user", content: [{ type: "text", text: stateBlock(digestNow(anchor.value)) }, ...attachmentBlocks(attachments.read(tray.value), !settings.value.images)] },
          ],
        })
      : 0;
  });
  /** Rough input tokens for the next send, shown with「约」. */
  const estimate = computed(() =>
    stateTokens.value ? staticTokens.value + stateTokens.value + approxTokens(input.value) : 0,
  );
  const memory = computed(() => {
    void stateRevision.value; void entries.value; void draftRevision.value; void conversationId.value;
    const owner = conversations.current, session = owner.session, value = session.memory;
    if (!value) return null;
    const archived = new Set(session.archive.map(t => t.turnId)), boards = drawing.snapshot().boards;
    // The row stays where the compaction ran: after the last turn it saw, not at the archive boundary.
    const after = session.records.at(-1 - session.turnsSinceCompaction)?.turnId ?? value.through;
    return { through: value.through, after, count: session.archive.length, tokens: approxTokens(value.text), memo: value.memo,
      ledger: session.ledger.filter(e => archived.has(e.turnId)).map(e => ({ ...e,
        context: [...e.targets, ...e.boards.map(id => boards.find(b => b.id === id)?.name ?? "已删除的画板")].join(" · ") })),
      attachments: attachmentIndex(session.archive, owner.scope.attachments.get) };
  });
  const compaction = computed(() => {
    void stateRevision.value; void entries.value; void draftRevision.value; void conversationId.value;
    const session = conversations.current.session;
    const count = archiveCount(session.retained, settings.value.compaction.highWaterTokens,
      session.ledger.filter(e => e.draft?.status === "pending").map(e => e.turnId));
    const reason = !favoritesReady.value || favoriteBusy.value ? "正在保存会话" : running.value ? "请求进行中"
      : writingDraft.value ? "正在写入草稿" : preparing.value ? "正在准备附件"
      : ready.value !== "ok" ? "请先配置模型" : session.turns < 4 ? "至少需要 4 轮对话"
      : !count ? "没有可压缩的完整轮次" : "";
    return { reason, count, lastInputTokens: session.lastInputTokens, highWaterTokens: settings.value.compaction.highWaterTokens };
  });
  function needsCompaction() {
    const session = conversations.current.session;
    return shouldCompact({ lastInputTokens: session.lastInputTokens, totalTurns: session.turns,
      turnsSinceCompaction: session.turnsSinceCompaction, archiveCount: compaction.value.count,
      highWaterTokens: settings.value.compaction.highWaterTokens,
      ...(session.archiveRebuild ? { archiveRebuild: { estimatedTokens: estimateRequest({ tools: toolList, system: system.value,
        messages: session.requestHistory(!settings.value.images) }) } } : {}) });
  }

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
  type SendOptions = { metadataOnly?: boolean; anchor?: string | null; preserveInput?: boolean; attachments?: readonly string[]; replaceId?: number };
  async function send(text = input.value, options: SendOptions = {}) {
    if ((!text.trim() && !(options.attachments ?? tray.value).length) || !manageable() || preparing.value) return;
    if (draft.value) { notice.value = "请先应用或忽略当前草稿"; return; }
    const provider = providerForSend();
    if (provider) await dispatch(text, options, provider);
  }
  /** One controller covers pre-send compaction, persistence and the following answer. */
  async function dispatch(text: string, options: SendOptions, provider: ReturnType<typeof createProvider>) {
    const owner = conversations.current, abort = new AbortController(), fromTray = options.attachments === undefined;
    const selected = [...(options.attachments ?? tray.value)], pool = owner.scope.attachments;
    const captured = { ...options, attachments: selected, anchor: options.anchor !== undefined ? options.anchor
      : [...text.matchAll(idPattern)][0]?.[0] ?? anchor.value };
    // Keep the intended attachments alive if the user changes the tray while organizing.
    pool.retain(selected);
    let transferred = false;
    controller = abort; dispatching.value = true;
    try {
      if (needsCompaction()) {
        await compact(owner, provider, abort);
        if (abort.signal.aborted) return;
        const current = providerForSend();
        if (!current) return;
        provider = current;
      }
      if (abort.signal.aborted || disposed) return;
      // The CHAT snapshot must be the stored conversation, even if CHAT was never opened.
      // Compaction reads no workspace state, so it starts without waiting.
      await chat.warm();
      if (abort.signal.aborted || disposed) return;
      owner.session.checkedArchive();
      await runTurn(text, captured, provider, abort, () => {
        transferred = true;
        if (fromTray) {
          const consumed = owner.tray.filter(id => selected.includes(id));
          setTray(owner.tray.filter(id => !selected.includes(id)), owner); pool.release(consumed);
        }
        if (options.replaceId !== undefined) {
          const replaced = entries.value.filter(e => e.id === options.replaceId);
          entries.value = entries.value.filter(e => e.id !== options.replaceId);
          pool.release(entryAttachments(replaced));
        }
      });
    } finally {
      if (!transferred) pool.release(selected);
      await finishRequest(owner, abort);
    }
  }
  async function finishRequest(owner: Conversation, abort: AbortController) {
    stateRevision.value++;
    usage.value = { ...total }; conversationUsage.value = owner.session.usage;
    saveFavorite(owner);
    if (owner.favorite) await flushFavorites().catch(() => {});
    if (controller === abort) controller = null;
    dispatching.value = false;
  }
  async function compactContext() {
    if (!manageable() || compaction.value.reason) return "skipped" as const;
    const provider = providerForSend();
    if (!provider) return "failed" as const;
    const owner = conversations.current, abort = new AbortController();
    controller = abort; dispatching.value = true;
    try { return await compact(owner, provider, abort); }
    finally { await finishRequest(owner, abort); }
  }
  async function compact(owner: Conversation, provider: ReturnType<typeof createProvider>, abort: AbortController) {
    const config = settings.value;
    const codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words, replacements: config.replacements });
    compactingOwner = owner.id; compacting.value = true; notice.value = "";
    say("正在压缩上下文");
    let call = 0;
    async function persist(candidate: SessionData, signal: AbortSignal) {
      const job = savingFavorites.catch(() => {}).then(async () => {
        signal.throwIfAborted(); stash();
        await favorites.write([savedConversation(owner, candidate)], [], services.data.write, signal);
      });
      savingFavorites = job;
      await job;
    }
    try {
      const result = await runCompaction({ session: owner.session, provider,
        request: { model: config.model, tools: toolList, system: system.value }, codec, signal: abort.signal,
        attachments: id => owner.scope.attachments.get(id), metadataOnly: !config.images, highWaterTokens: config.compaction.highWaterTokens,
        ...(owner.favorite ? { persist } : {}), observe(event) {
          if (event.type === "request") call = callLog.start({ conversation: owner.id, turn: 0, step: 1,
            question: "压缩上下文", purpose: "compaction", connection: config.connectionId,
            protocol: provider!.profile.protocol === "anthropic-messages" ? "anthropic-messages" : "openai-chat",
            model: config.model, promptVersion }, event.body);
          else if (call) callLog.finish(call, event);
        } });
      if (result.status === "compacted") say("上下文已压缩");
      return result.status;
    } catch (error) {
      if (call) callLog.fail(call, abort.signal.aborted);
      if (!abort.signal.aborted) {
        notice.value = `压缩失败：${message(error)}`;
        push({ type: "note", id: ++sequence, text: notice.value, compactRetry: true });
      }
      else say("已停止压缩，待发内容已保留");
      return abort.signal.aborted ? "stopped" as const : "failed" as const;
    } finally {
      compactingOwner = null; compacting.value = false; stateRevision.value++;
      usage.value = { ...total }; conversationUsage.value = owner.session.usage;
    }
  }
  async function runTurn(text: string, options: SendOptions, provider: ReturnType<typeof createProvider>, abort: AbortController, transfer: () => void) {
    const question = text.trim();
    notice.value = "";
    // The compact success pill belongs to the write, not later replies.
    appliedDraft.value = null;
    const owner = conversations.current;
    const attached = attachments.read(options.attachments ?? tray.value);
    if (!entries.value.some(e => e.id !== options.replaceId) && !owner.named) {
      owner.title = titleOf(question, attached[0]?.name); listRevision.value++;
    }
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
    const readBoards = new Set(draftBase.boardId ? [draftBase.boardId] : []);
    if (!metadataOnly) for (const a of attached) if (a.kind === "image") turnViewed.add(a.id);
    const user: AskMessage = {
      role: "user",
      content: [
        { type: "text", text: stateBlock(digest), source: { kind: "workspace_state" } },
        ...attachmentBlocks(attached, metadataOnly),
        { type: "text", text: question },
      ],
    };
    const turn = owner.session.begin(user, { metadataOnly }), pacer = createPacer();
    abort.signal.addEventListener("abort", pacer.cancel, { once: true });
    transfer();
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
      turnId: null,
      checkpoint: null,
      attachments: attached.map(attachmentView),
    };
    const visual = { signal: abort.signal, metadataOnly, budget: turn.budget.vision, viewed: turnViewed };
    const readRef = createReferenceReader({ source: referenceSource?.snapshot() ?? null, pool: owner.scope.attachments,
      attached, limits: config.textAttachments, pageBytes: pageAttachmentBytes, visual, vision,
      added(item) {
        working.attachments = [...working.attachments, attachmentView(item)];
        library.push(...attachmentPictures([item])); libraryRevision.value++;
        schedule(); saveFavorite(owner);
      },
    });
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
    const readTargets = new Set<string>(), toolTargets = new Map<string, string[]>();
    const rows = new Map<string, Mutable<ToolRow>>();
    async function* tracedStream(request: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
      let call = 0;
      let observedUsage: AskUsage | null = null, done = false;
      try {
        for await (const event of provider.stream(request, { codec, signal, allowEmpty: turn.budget.toolCalls > 0, observe(event) {
          if (event.type === "request") call = callLog.start({ conversation: owner.id, turn: working.id, step: turn.budget.requests, question,
            ...(owner.session.takeAfterCompaction() ? { afterCompaction: true } : {}),
            connection: config.connectionId, protocol: provider.profile.protocol === "anthropic-messages" ? "anthropic-messages" : "openai-chat",
            model: request.model, promptVersion }, event.body);
          else { observedUsage = event.usage; if (call) callLog.finish(call, event); }
        } })) { if (event.type === "done") done = true; yield event; }
      } catch (error) {
        if (!done) turn.record(observedUsage);
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
          visual,
          readRef,
          tags: services.tags.suggest,
          snapshotTime,
          chatContext: turnChatContext,
          draftBase,
          readSlate: scope => scope === "latest" ? deps.slates?.get(conversations.current.slateId ?? "") ?? null : draftBase.slate ?? null,
          question,
          recall: input => owner.session.recall(input, id => owner.scope.attachments.get(id)),
          state: (scope, boardId) => {
            if (boardId) {
              const boards = scope === "latest" ? drawing.snapshot().boards : frozenBoards;
              const board = boards.find(b => b.id === boardId);
              if (!board) throw new Error("画板不在该状态快照中");
              readBoards.add(board.id);
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
          toolTargets.set(event.id, event.object.match(idPattern) ?? []);
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
          if (event.ok) for (const id of toolTargets.get(event.id) ?? []) readTargets.add(id);
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
      working.turnId = turn.commit({ viewed: [...turnViewed].filter((id) => !known.has(id)), question,
        attachments: attached.map(a => a.id), targets: [...new Set([...(`${turnAnchor ?? ""} ${question}`.match(idPattern) ?? []),
          ...attached.filter(a => a.kind === "image").map(a => a.id), ...readTargets])],
        boards: [...readBoards],
        ...(proposed ? { draft: recordDraft(proposed, validateDraft(proposed, draftBase, { off: new Set(), has: hasImage })) } : {}) });
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
      usage.value = { ...total };
      conversationUsage.value = owner.session.usage;
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
    for (const r of [...gone.externalQueue, ...(gone.draft ? [gone.draft] : [])]) {
      const origin = r.draft.external;
      if (origin) for (const fn of externalEvents) fn(origin, { draft_id: origin.draftId, status: "dismissed" });
    }
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
    if (!entry || entry.type !== "turn" || (!text.trim() && !entry.turn.attachments.some(a => !a.toolRead)) || !providerForSend()) return false;
    const removed = entries.value.slice(index), turnIds = new Set(removed.map(e => e.id));
    const applied = removed.flatMap(e => { const c = e.type === "turn" ? e.turn.checkpoint : e.checkpoint; return c?.status === "applied" ? [c.id] : []; });
    const retained = entries.value.slice(0, index).reduce((count, e) => e.type === "turn" ? Math.max(count, e.turn.committed ?? 0) : count, 0);
    writingDraft.value = true; notice.value = "";
    try {
      await chat.warm();
      const order = history.preflight(applied);
      for (const recordId of order) {
        checkpoint(await history.undo(recordId));
        appliedDraft.value = null;
      }
      // Credentials/settings can change during persistence; never delete before ready.
      const provider = providerForSend();
      if (!provider) return false;
      conversations.current.session.truncate(retained, attachments.get);
      for (const r of [...conversations.current.externalQueue, ...(draft.value ? [draft.value] : [])])
        if (turnIds.has(r.turnId)) externalStatus(r, "dismissed");
      conversations.current.externalQueue = conversations.current.externalQueue.filter(r => !turnIds.has(r.turnId));
      externalRevision.value++;
      const originalAttachments = entry.turn.attachments.filter(a => !a.toolRead).map(a => a.id);
      attachments.retain(originalAttachments);
      attachments.release(entryAttachments(removed));
      // Keep an editable stopped row until a normal request actually starts.
      // Stopping pre-send compaction must not discard the edited text/attachments.
      entries.value = [...entries.value.slice(0, index), { ...entry, turn: { ...entry.turn, question: text,
        attachments: entry.turn.attachments.filter(a => !a.toolRead),
        status: "stopped", items: [], failure: null, truncated: false, committed: null, turnId: null, checkpoint: null } },
        ...entries.value.slice(index).filter(e => e.type === "note" && e.external && !turnIds.has(e.id))];
      history.removeTurns(conversationId.value, turnIds);
      if (draft.value && turnIds.has(draft.value.turnId)) draft.value = null;
      appliedDraft.value = null;
      if (order.length) deps.ui.toast(`已撤回 ${order.length} 份草稿`);
      writingDraft.value = false;
      void dispatch(text, { anchor: entry.turn.anchor, metadataOnly: entry.turn.metadataOnly, preserveInput: true,
        attachments: originalAttachments, replaceId: entry.id }, provider);
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
      session: source.session.fork(count, attachments.get),
      entries: entries.value.slice(0, index + 1).flatMap(e => e.type === "turn" ? [{ ...e, turn: { ...e.turn, checkpoint: null } }] : []),
      slateId: source.slateId, anchor: entry.turn.anchor, input: "", draft: null, externalQueue: [], tray: [], preparing: 0,
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
    void dispatch(entry.turn.question, { metadataOnly: mode === "metadata" || entry.turn.metadataOnly, anchor: entry.turn.anchor,
      preserveInput: true, attachments: entry.turn.attachments.filter(a => !a.toolRead).map(a => a.id), replaceId: entry.id }, provider);
  }
  /** Esc: popovers, then the draft (A2), then the running turn, then the drawer. */
  function escape() {
    for (const layer of [...layers].reverse()) if (layer()) return;
    if (writingDraft.value) return;
    if (controller) stop();
    else if (draft.value) ignoreDraft();
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
  function proposeFile(document: 'recipe' | 'memo' | 'slate', content?: { title: string; text: string }) {
    if (!manageable() || writingDraft.value) return;
    try {
      const base = readDraftState();
      const latest = [...entries.value].reverse().find(e => e.type === 'turn' && e.turn.status === 'done');
      const body = content?.text ?? (latest?.type === 'turn' ? latest.turn.items.flatMap(i => i.kind === 'text' ? [i.text] : []).join('\n\n') : '');
      const step = parseFile({ kind: 'save_ref', document, document_title: (content?.title ?? conversations.current.title).slice(0, 80), ...(document === 'memo' ? { text: body } : {}) }, base);
      if (draft.value) {
        if (draft.value.draft.steps.length >= 12) throw new Error('草稿步骤已满');
        if (draft.value.draft.steps.some(s => s.kind === 'save_ref' && s.file.document === document)) return;
        draft.value = { ...draft.value, draft: { ...draft.value.draft, steps: [...draft.value.draft.steps, step] } };
      } else {
        const id = ++sequence;
        entries.value = [...entries.value, { type: 'note', id, text: step.file.title }];
        draft.value = history.create({ title: step.file.title, baseHash: stateHash(base), question: '', base, steps: [step] }, conversations.current.id, id);
      }
      draftRevision.value++; saveFavorite();
    } catch (error) { notice.value = message(error); }
  }
  async function openSlate(id: string, fresh = false) {
    if (!manageable() || !deps.slates?.get(id)) return false;
    try { await deps.slates.select(id); }
    catch (error) { notice.value = message(error); return false; }
    if (!manageable()) return false;
    const owner = conversations.list().find(c => c.slateId === id);
    if (owner && !fresh) selectConversation(owner.id);
    else { if (newConversation() !== true) { notice.value = '会话已达上限，请先关闭一个会话'; return false; } conversations.current.slateId = id; const slate = deps.slates.get(id); if (slate) conversations.current.title = slate.title; listRevision.value++; }
    draftRevision.value++;
    open.value = true; deps.slates.visible.value = false; saveFavorite();
    return true;
  }
  const restored = Promise.resolve(deps.slates?.restored).then(() => restoreFavorites());

  return {
    proposeFile, openSlate,
    activeSlate: computed(() => { void conversationId.value; void draftRevision.value; return deps.slates?.get(conversations.current.slateId ?? "") ?? null; }),
    connectFileExports(port: FilePort) { filePort = port; draftRevision.value++; return () => { if (filePort === port) filePort = null; }; },
    connectReferences(source: RefSource) { referenceSource = source; stateRevision.value++; return () => { if (referenceSource === source) { referenceSource = null; stateRevision.value++; } }; },
    referencesChanged() { stateRevision.value++; },
    restored,
    externalWaiting: computed(() => { void externalRevision.value; void conversationId.value; return conversations.current.externalQueue.map(r => ({ id: r.turnId, title: r.draft.title })); }),
    externalSnapshot() {
      const d = drawing.snapshot();
      return { base: { ...readDraftState(), workspace: "image" as const }, library: snapshotPictures(d.history, d.favorites, ids), pictureScope: activeScope.id, ownerId: conversations.current.id };
    },
    reviewExternal(context: string, id: string) {
      if (!manageable()) return false;
      stash();
      const owner = conversations.list().find(c => c.entries.some(e => e.type === "note" && e.external?.origin.context === context && e.external.origin.draftId === id));
      if (!owner) return false;
      selectConversation(owner.id); open.value = true; return true;
    },
    externalRecord(context: string, id: string) {
      stash();
      for (const c of conversations.list()) for (const e of c.entries)
        if (e.type === "note" && e.external?.origin.context === context && e.external.origin.draftId === id) return e.external;
      return null;
    },
    receiveExternal(value: Draft, origin: ExternalOrigin, ownerId = conversations.current.id) {
      if (!favoritesReady.value || disposed) throw new Error("ASK 会话尚未就绪，请稍后重试");
      stash();
      const owner = conversations.get(ownerId);
      if (!owner) throw new Error("接收草稿的会话已删除");
      if (owner.externalQueue.length >= 32) throw new Error("外部草稿等待队列已满，请先处理现有草稿");
      const record = history.create({ ...value, external: origin }, owner.id, ++sequence);
      owner.externalQueue.push(record);
      const entry: AskEntry = { type: "note", id: record.turnId, text: value.title, external: { origin, status: "pending" } };
      owner.entries = [...owner.entries, entry];
      if (owner === conversations.current) entries.value = owner.entries;
      externalRevision.value++; saveFavorite(owner);
      say(draft.value || running.value ? "有外部草稿待处理" : "收到外部草稿");
    },
    dismissExternal(id: number) {
      const owner = conversations.current, record = owner.externalQueue.find(r => r.turnId === id);
      if (!record || writingDraft.value || favoriteBusy.value) return;
      externalStatus(record, "dismissed"); owner.externalQueue = owner.externalQueue.filter(r => r !== record);
      externalRevision.value++; saveFavorite(owner);
    },
    onExternal(fn: (origin: ExternalOrigin, receipt: InboxReceipt) => void) { externalEvents.add(fn); return () => externalEvents.delete(fn); },
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
    compacting,
    compactContext,
    compaction,
    memory,
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
    openAttachment(id: string, inline = false) { const a = attachments.get(id); if (a?.kind === "text") attachmentPreview.value = { id, name: a.name, text: a.text, inline }; },
    openTurn(id: TurnId, inline = false) {
      try {
        const turn = conversations.current.session.recall({ turns: [id], include: "full" }, attachments.get).turns[0];
        attachmentPreview.value = { id, turnId: id, inline, name: `${id} · 原文`, text: [
          `提问\n${turn.question}`, `回复\n${turn.reply}`,
          ...(turn.draft ? [`草稿\n${JSON.stringify(turn.draft, null, 2)}`] : []),
          `工具与状态原文\n${JSON.stringify(turn.messages, null, 2)}`,
        ].join("\n\n") };
      } catch (error) { deps.ui.toast(message(error), "err"); }
    },
    async referenceTurn() {
      const preview = attachmentPreview.value;
      if (!preview?.turnId || !manageable()) return;
      const owner = conversationId.value;
      await addFiles([new File([preview.text], `${preview.turnId}-原文.txt`, { type: "text/plain" })]);
      if (owner === conversationId.value) {
        attachmentPreview.value = null;
        await nextTick(); document.getElementById("askPrompt")?.focus({ preventScroll: true });
      }
    },
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
      if (writingDraft.value || controller || disposed || !draft.value) return;
      const next = new Set(draft.value.off);
      if (next.has(id)) next.delete(id); else next.add(id);
      draft.value.off = next;
      draftRevision.value++;
    },
    reproposeDraft() {
      if (!draft.value || writingDraft.value || controller) return;
      if (draft.value.draft.external) { notice.value = "请从外部基于最新状态重新投递"; return; }
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
        const image = chatImages(chat.snapshot()).find((p) => p.aliases.includes(label));
        const asset = image ? chat.assets.assets.get(image.assetId) : null;
        return asset ? { label, url: asset.url, width: asset.width, height: asset.height } : null;
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
      stopExternal(); externalEvents.clear();
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
