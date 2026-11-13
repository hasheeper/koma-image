import { stagedLoadPlan } from './retrospect/staged.ts';
import { createBranchTurn } from './retrospect/branch-turn.ts';
import { isStaged, stagedCount, versionCount } from './retrospect/model.ts';
import { evolutionTarget, evolutionTargetId, evolutionWorkspace } from '../domain/evolution-input.ts';
import { chatEvolutionInput } from '../domain/chat-evolution.ts';
import { activeReferences, referenceOperation } from '../domain/nai-references.ts';
import type { ReviewStatus, EvolutionTreeChange } from './retrospect/store.ts';
import { createRetrospects } from './retrospect/store.ts';
import { pendingWorkshopResult, workshopPending } from './retrospect/workshops.ts';
import { recipeClusters, recipeOf, recipeSignature, recipeTarget, recipeWorkspace } from './retrospect/recipe.ts';
import { createRecipeReader } from './retrospect/tools.ts';
import type { Retrospect, RetrospectNode } from './retrospect/model.ts';
import { prepareRecipe } from './retrospect/restore.ts';
import { annotationPrompt, serializeAnnotations, validateAnnotationSnapshot, validateRegions } from "../domain/region-annotation.ts";
import type { AnnotationSnapshot } from "../domain/region-annotation.ts";
import { editAwareness } from "../services/edit-awareness.ts";
import { naiAwareness,naiSourceKey,naiAccountSnapshot } from "../services/nai-awareness.ts";
import { imageEntity } from "../domain/image-identity.ts";
import type { Editor } from "../services/editor.ts";
import { editPictures, editContext, editWorkspaceContext, withEditPictures, freezePictureRefs, bindPictures } from "./edit-context.ts";
import type { ImageTagBinding } from "../domain/image-identity.ts";
import type { PictureRefs } from "./edit-context.ts";
import { homeContext } from "../home/ask-context.ts";
import type { Home } from "../home/service.ts";
import { canonical } from "./canonical.ts";
import { parseFile } from "./draft/files.ts";
import type { FilePort } from "./draft/files.ts";
import type { Slates } from "../slate/service.ts";
import { parseSlateEdit } from "../slate/edit.ts";
import { summary as slateSummary } from "../slate/model.ts";
import type { ExternalOrigin, ExternalNote, InboxReceipt } from "../bridge/protocol.ts";
import { characterCapability, characterSummary, nextCharacterId } from "../domain/characters.ts";
import { boardForm, boardColors, boardKeys } from "../domain/drawing.ts";
import { stateHash } from "./draft/validate.ts";
import { chatSnapshot, chatContext, chatDraftModel, chatModelState, chatPictures } from "./chat-context.ts";
import { createChatPictureIds } from './chat-identity.ts';
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
import { approxTokens, createSession, estimateRequest, estimateRequestBreakdown } from "./session.ts";
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
import type { Picture } from "./library.ts";
import { createVision } from "./vision.ts";
import { buildDigest, stateBlock } from "./digest/index.ts";
import type { Digest } from "./digest/index.ts";
import { dataBlock, promptVersion, systemCore, systemPreferences } from "./prompts/index.ts";
import { createCallLog } from "./debug.ts";
import type { CallLogView } from "./debug.ts";
import { createPacer, PACE } from "./pacer.ts";
import { createDraftWriter } from "./draft/apply.ts";
import { validateDraft } from "./draft/validate.ts";
import { checkNaiInput } from "./draft/nai-input.ts";
import { createDraftStack } from "./draft/stack.ts";
import type { DraftRecord } from "./draft/stack.ts";
import { draftView } from "./draft/view.ts";
import type { Draft, DraftPlan, DraftState, HandoffImage } from "./draft/types.ts";
import { ATTACHMENT_LIMITS, attachmentBlocks, attachmentCapacity, attachmentPictures, attachmentView, createAttachments, prepareAttachment } from "./attachments.ts";
import type { AttachmentView } from "./attachments.ts";
import { boardNameContent, conversationNameContent, namingRequest, readGeneratedName } from "./naming.ts";
import type { NamingContent, NamingTarget } from "./naming.ts";
import { namingPromptVersion } from "./prompts/naming.ts";
import { createAskFavorites, restoreSavedSession } from "./favorites.ts";
import type { SavedConversation } from "./favorites.ts";
import type { Writer } from "../services/data-lease.ts";
import type { RefSource, RefFile } from "./reference-source.ts";
import { createReferenceReader } from "./read-ref.ts";
import { createHandoffImages, prepareProjectHandoffs, remapHandoffDraft } from './handoff-images.ts';

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
  | { readonly kind: "pick"; readonly ids: readonly string[] }
  | { readonly kind: "retrospect"; readonly value: Retrospect };
export interface CheckpointView {
  readonly id: number;
  readonly editBoardId?: string;
  readonly title: string;
  readonly status: "applied" | "reverted" | "dismissed";
  readonly added: number;
  readonly removed: number;
  readonly receipts?: readonly ToolRow[];
}
export interface AskTurnView {
  readonly pictureRefs?: PictureRefs;
  /** Unapplied proposal carried into an ordinary follow-up, including retries. */
  readonly draftFeedback?: string;
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
export type RetryMode = "plain" | "metadata" | "images" | "codec";
interface ConversationScope {
  readonly id: string;
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
  items: ({ kind: "text"; text: string } | { kind: "tools"; rows: Mutable<ToolRow>[] } | { kind: "pick"; ids: readonly string[] } | { kind: "retrospect"; value: Retrospect })[];
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
  home?: Home;
  editor?: Editor;
  photopea?: import('../services/photopea.ts').Photopea;
  fetch?: typeof fetch;
  ui: Pick<Ui, "toast">;
}) {
  const { services, router, drawing, chat } = deps;
  const retrospects = createRetrospects((record, undo) => deps.ui.toast('演进已移至历史', 'info', { label: '撤销', run: async () => { if (currentEvolutionTarget() === record.boardId) undo(); else deps.ui.toast('请先切回演进所在画板', 'warn'); } }));
  const { preferences, connections } = services;
  let filePort: FilePort | null = null;
  const scopes = new Map<string, ConversationScope>();
  const handoffImages = createHandoffImages(id => scopes.get(id)?.attachments);
  const writer = createDraftWriter(drawing, chat, router, deps.slates, () => filePort, deps.editor, {
    moveIssue: retrospects.moveIssue, commitMove: retrospects.commitMove,
    treeIssue: retrospects.treeIssue, commitTree: retrospects.commitTree, treeKey: retrospects.treeKey, treeSnapshot: retrospects.get,
    prepareHandoff: (plan, receipt) => {
      const image = plan.editHandoff?.image ?? plan.handoff?.images[0];
      const recordId = image?.binding?.record_id;
      const target = plan.edit ? evolutionTarget('edit', plan.edit.id) : receipt ? evolutionTarget('chat', String(JSON.parse(receipt)[0])) : null;
      if (!recordId || !target) return null;
      const pictures = evolutionPictures();
      return retrospects.prepareDispatch(target, recordId, evolutionName(target), pictures, freezePictureRefs(pictures, pictureScopes()),
        plan.edit ? deps.editor?.askSnapshot(plan.edit.id)?.source?.recordId : recordId);
    },
    stagedAvailable: load => {
      const r = retrospects.get(load.evolution.id, load.evolution.boardId), node = r?.value.nodes.find(n => n.id === load.evolution.after.cursor.nodeId);
      if (!r || !node || currentEvolutionTarget() !== r.boardId) return false;
      const source = boundPicture(load.source.tag, { [load.source.tag]: load.source });
      if (!source || activeReferences(load.references).length && (!referenceOperation(load.model, load.references.active!) || services.references.cachedCost(load.references, load.model) === undefined)) return false;
      return !isStaged(node) || node.staged.signature === load.signature && recipeSignature(recipeOf(source.params)) === recipeSignature(node.staged.baseRecipe);
    },
    available: base => {
      const p = boundPicture(base.image.label, base.image.binding ? { [base.image.label]: base.image.binding } : {});
      return !!p && recipeSignature(recipeOf(p.params)) === recipeSignature(base.recipe) &&
        (!activeReferences(base.fields.naiReferences!).length || services.references.cachedCost(base.fields.naiReferences!, String(base.fields.model)) !== undefined);
    },
  }, handoffImages, id => drawing.original(id)),
    history = createDraftStack(writer),
    vision = createVision(),
    tools = createTools(),
    toolList = [...tools.values()].map((entry) => entry.tool);
  const pageScope = crypto.randomUUID(), ids = createIds();
  const chatIds = createChatPictureIds();
  let pendingResourcePictures: readonly Picture[] = [];
  let referenceSource: RefSource | null = null;
  const pageAttachmentBytes = () => [...scopes.values()].reduce((sum, c) => sum + c.attachments.bytes, 0);
  function scope(id: string = crypto.randomUUID()) {
    let value = scopes.get(id);
    if (!value) { value = { id, attachments: createAttachments(id => vision.forget(id)) }; scopes.set(id, value); }
    return value;
  }
  let activeScope = scope(), attachments = activeScope.attachments;
  const favorites = createAskFavorites(services), favoritesReady = shallowRef(false), favoriteBusy = shallowRef(false);
  const readSettings = () => readAskSettings(preferences.get(names.ask, null)),
    readAdult = () => preferences.get<unknown>(names.askAdult, false) === true;
  const debug = shallowRef<CallLogView>({ calls: [], dropped: 0 }),
    callLog = createCallLog(view => { debug.value = view; });
  const naming = shallowRef<NamingTarget | null>(null);
  let namingController: AbortController | null = null;
  type NamingJob = { target: NamingTarget; source: NamingContent; automatic: boolean; valid: () => boolean; apply: (name: string) => boolean | Promise<boolean> };
  const namingQueue: NamingJob[] = [], autoNamed = new WeakSet<Conversation>(), titleRevisions = new WeakMap<Conversation, number>();
  let activeNaming: NamingJob | null = null;

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
    appliedDraft = shallowRef<{ id: number; workspace: "image" | "chat" | "edit" } | null>(null),
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
    make: (id) => ({ id, slateId: null, title: UNTITLED, named: false, favorite: false, createdAt: Date.now(), scope: scope(), origin: null, session: createSession(addUsage), entries: [], input: "", anchor: null, draft: null, externalQueue: [], tray: [], preparing: 0 }),
    // Callers stash the refs first, so the records are current.
    empty: (c) => !c.favorite && !c.entries.length && !c.slateId,
  });
  const slateLinkRevisions = new WeakMap<Conversation, number>();
  const removedSlateLinks = new WeakMap<DraftPlan, readonly { owner: Conversation; revision: number }[]>();
  function setSlateLink(owner: Conversation, id: string | null) {
    if (owner.slateId === id) return;
    owner.slateId = id;
    slateLinkRevisions.set(owner, (slateLinkRevisions.get(owner) ?? 0) + 1);
    stateRevision.value++; draftRevision.value++; saveFavorite(owner);
  }
  function pruneSlateLinks() {
    if (!deps.slates?.ready.value) return;
    for (const owner of conversations.list()) if (owner.slateId && !deps.slates.get(owner.slateId)) setSlateLink(owner, null);
  }
  function rememberSlateLinks(plan: DraftPlan, undo = false) {
    if (!plan.slate || (undo ? plan.slate.before : plan.slate.after)) return;
    removedSlateLinks.set(plan, conversations.list().filter(c => c.slateId === plan.slate!.id)
      .map(owner => ({ owner, revision: (slateLinkRevisions.get(owner) ?? 0) + 1 })));
  }
  function restoreSlateLinks(plan: DraftPlan) {
    if (!plan.slate || !deps.slates?.get(plan.slate.id)) return;
    for (const { owner, revision } of removedSlateLinks.get(plan) ?? []) {
      // Undo restores only links cleared by this deletion, never a later user choice.
      if (conversations.get(owner.id) === owner && !owner.slateId && slateLinkRevisions.get(owner) === revision) setSlateLink(owner, plan.slate.id);
    }
  }
  activeScope=conversations.current.scope; attachments=activeScope.attachments;
  conversationId.value = conversations.current.id;
  function stash() {
    Object.assign(conversations.current, { entries: entries.value, input: input.value, anchor: anchor.value, draft: draft.value });
  }
  function load() {
    const c = conversations.current;
    activeScope = c.scope; attachments = activeScope.attachments;
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
    if (!tray.value.includes(id) || running.value) return;
    const source = attachments.read(tray.value).find(a => a.kind === 'image' && (a.id === id || a.annotations?.guideId === id || a.annotations?.snapshot.references?.some(r=>r.image===id)) && a.annotations);
    const ids = source?.kind === 'image' && source.annotations ? [source.id, source.annotations.guideId, ...source.annotations.snapshot.references?.flatMap(r=>r.image ? [r.image] : [])??[]] : [id];
    if (ids.includes(anchor.value ?? '')) selectAnchor(null);
    setTray(tray.value.filter(value => !ids.includes(value))); attachments.release(ids);
  }

  const editorOpen = computed(() => { void stateRevision.value; return !!deps.editor?.snapshot().externalId || !!deps.photopea?.task.value; }),
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
  function readDraftState(boardId?: string, slateId?: string, editId?:string): DraftState {
    const d = drawing.snapshot(), c = chat.snapshot().current;
    const board = d.boards.find(b => b.id === (boardId ?? d.activeBoardId));
    return { edit: deps.editor?.askSnapshot(editId), editBoards:deps.editor?.boards().map(b=>deps.editor!.askSnapshot(b.id)!), fileContext: filePort?.context(), slate: deps.slates?.get(slateId ?? conversations.current.slateId ?? "") ?? null, boardId: boardId ?? d.activeBoardId, boardName: board?.name, boardPresent: !!board, nextCharacterId: board?.nextCharacterId, form: structuredClone({ ...d.form, ...board?.form }), composer: c.prompt, conversationId: c.id, chat: chatSnapshot(chat.snapshot(),true,chatIds), models: [...d.models], samplers: [...d.samplers], samplersByModel: Object.fromEntries(d.models.map((m) => [m.id, drawing.samplersFor(m.id)])),
      workspace: router.route.value.workspace, chatModel: chatDraftModel(chat.snapshot()) };
  }
  /** Handoff images are checked live: IMAGE records by ID, CHAT pictures by asset. */
  function hasImage(image: HandoffImage) {
    if (image.source === 'project' || image.source === 'attachment') return !!handoffImages.get(image.ref);
    if (image.source === "chat") return chat.assets.assets.has(image.ref);
    if (image.source === "edit" && deps.editor?.record(image.ref)) return true;
    return !!drawing.original(image.ref);
  }
  function hasRecord(image: HandoffImage) {
    const p = boundPicture(image.label, image.binding ? { [image.label]: image.binding } : undefined);
    return p?.id === image.ref;
  }
  const draftPlan = computed(() => {
    void draftRevision.value;
    return draft.value ? validateDraft(draft.value.draft, readDraftState(draft.value.draft.base.boardId, draft.value.draft.steps.find(s => s.kind === "slate_edit")?.change.before?.id, draft.value.draft.base.edit?.id), { off: draft.value.off, has: hasImage, hasRecord }) : null;
  });
  const canReviseDraft = computed(() => {
    const record = draft.value;
    return !!record && !record.draft.external && !record.draft.synthetic && entries.value.some(e =>
      e.type === "turn" && e.id === record.turnId && e.turn.turnId !== null);
  });
  const undoTarget = computed(() => {
    void draftRevision.value;
    return history.top?.origin?.kind === 'evolution' || history.top?.conversationId === conversationId.value ? history.top : null;
  });
  const redoTarget = computed(() => {
    void draftRevision.value;
    return history.redo?.origin?.kind === 'evolution' || history.redo?.conversationId === conversationId.value ? history.redo : null;
  });
  const canUndoDraft = computed(() => {
    void draftRevision.value;
    const record = undoTarget.value;
    return !!record?.plan && writer.canUndo(record.plan, record.receipt);
  });
  function checkpoint(record: DraftRecord) {
    if (record.origin) return;
    const owner = conversations.get(record.conversationId);
    if (!owner || !record.plan || record.status === "pending") return;
    restoreSlateLinks(record.plan);
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
    const view: CheckpointView = { id: record.id, editBoardId:record.plan.edit?.id, title: record.plan.title, status: record.status, added, removed, ...(receipts.length ? { receipts } : {}) };
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
    const to = router.route.value.workspace === "home" ? "切到" : "切回";
    if (workspace === "edit" || plan?.files?.length) return "应用";
    if (plan?.slate && !plan.changes.length && !plan.newBoardName) return "应用到任务板";
    if (plan?.handoff?.current) return "应用到当前对话";
    if (plan?.steps.some((s) => s.kind === "handoff")) return router.route.value.workspace === "chat" ? "新开对话并应用" : "切到对话并新开";
    if (workspace === "image" && plan?.newBoardName) return router.route.value.workspace === "image" ? "新建并应用" : `${to}绘图并新建`;
    if (workspace === "image" && router.route.value.workspace !== "home" && plan?.boardId && drawing.snapshot().activeBoardId !== plan.boardId) return `切回${drawing.board(plan.boardId)?.name ?? "源画板"}并应用`;
    return workspace && router.route.value.workspace !== workspace ? `${to}${workspace === "image" ? "绘图" : "对话"}并应用` : "应用";
  });
  async function focusWritten(plan: DraftPlan) {
    if(plan.workspace === "edit") return;
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
    let plan = validateDraft(record.draft, readDraftState(record.draft.base.boardId, record.draft.steps.find(s => s.kind === "slate_edit")?.change.before?.id, record.draft.base.edit?.id), { off: record.off, has: hasImage, hasRecord });
    if (plan.fingerprint !== fingerprint) { draftRevision.value++; notice.value = "内容已变化，请核对更新后的草稿再应用"; return; }
    if (!plan.edit && !plan.changes.length && !plan.branch && !plan.handoff && !plan.slate && !plan.files?.length && !plan.rollbackBase && !plan.newBoardName) return;
    if ((plan.workspace === "edit" || plan.files?.length || plan.newBoardName) && plan.steps.some(step => step.issue)) { notice.value = "草稿有冲突，请先核对"; return; }
    writingDraft.value = true; notice.value = "";
    try {
      if (newBoard && plan.rollbackBase) throw new Error('回退草稿只能应用到当前跟踪画板');
      if ((!!plan.newBoardName || newBoard === true) && plan.workspace === "image" && plan.boardId) {
        const source = drawing.board(plan.boardId);
        if (!source) throw new Error("来源画板已删除");
        const form = boardForm({ ...drawing.snapshot().form, ...structuredClone(source.form), ...Object.fromEntries(plan.changes.map(c => [c.field, c.after])) });
        plan = { ...plan, createdBoard: { ...structuredClone(source), id: crypto.randomUUID(), name: plan.newBoardName ?? `${source.name} 副本`.slice(0, 80), color: boardColors[drawing.snapshot().boards.length % boardColors.length], nextCharacterId: Math.max(source.nextCharacterId, nextCharacterId(form.characters)), form } };
      }
      if (!record.draft.external && !plan.createdBoard && plan.workspace === 'image' && !plan.edit && !plan.handoff && plan.changes.length && plan.boardId && retrospects.activeForBoard(plan.boardId)) {
        const evolution = retrospects.prepareNext(plan.boardId, 'ask', plan.rollbackBase?.evolution);
        plan = plan.rollbackBase ? { ...plan, rollbackBase: { ...plan.rollbackBase, evolution } } : { ...plan, evolution };
      }
      rememberSlateLinks(plan);
      await history.apply(record, plan);
      if (plan.slate?.after) setSlateLink(conversations.current, plan.slate.id);
      checkpoint(record);
      if (plan.slate) notice.value = deps.slates?.error.value ?? "";
      externalStatus(record, "applied", notice.value || undefined);
      draft.value = null;
      appliedDraft.value = { id: record.id, workspace: plan.workspace };
      const count = plan.handoff ? plan.steps.filter((s) => s.enabled && !s.issue && s.id !== "0:new").length : (plan.edit ? 1:0) + plan.changes.length + (plan.createdBoard ? 1 : 0) + (plan.slate ? 1 : 0) + (plan.files?.length ?? 0);
      say(`已应用草稿 ${plan.title} · ${count} 项 · ${plan.workspace !== "chat" ? "未生成" : "未发送"}`);
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
      if (record.plan) rememberSlateLinks(record.plan, !restore);
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
  function ignoreDraft(quiet = false) {
    if (!draft.value || writingDraft.value || controller || disposed) return;
    const record = draft.value;
    const entry = entries.value.find(e => e.type === "turn" && e.id === record.turnId);
    if (entry?.type === "turn") {
      if (entry.turn.turnId) conversations.current.session.updateDraft(entry.turn.turnId, "dismissed");
      const plan = draftPlan.value;
      const { added, removed } = plan ? draftView(plan) : { added: 0, removed: 0 };
      const view: CheckpointView = { id: record.id, title: record.draft.title, status: "dismissed", added, removed };
      entries.value = entries.value.map(e => e === entry ? { ...entry, turn: { ...entry.turn, checkpoint: view } } : e);
    }
    externalStatus(record, "dismissed");
    draft.value = null; notice.value = "";
    if (!quiet) say("已放弃草稿，内容未修改");
  }

  function currentEvolutionTarget() {
    const w=router.route.value.workspace;
    return w==='edit'&&deps.editor?evolutionTarget('edit',deps.editor.session.id):w==='chat'?evolutionTarget('chat',chat.snapshot().current.id):drawing.snapshot().activeBoardId;
  }
  function evolutionName(target:string|null) {
    if(!target)return '画板';const id=evolutionTargetId(target),w=evolutionWorkspace(target);
    return w==='edit'?deps.editor?.board(id)?.name??'编辑画板':w==='chat'?chat.snapshot().conversations.find(c=>c.id===id)?.title??'对话':drawing.snapshot().boards.find(b=>b.id===id)?.name??'画板';
  }
  function chatLibrary(evolution = false) {
    const state = chat.snapshot();
    const related = referencedPictureIds();
    return state.conversations.flatMap(current => {
      const all = chatPictures({ ...state, current }, chat, true, chatIds);
      if (!evolution && current.id === state.current.id) {
        const active = chatPictures(state, chat, false, chatIds), visible = new Set(active.map(p => p.id));
        return [...active, ...all.filter(p => !visible.has(p.id) && related.has(p.id)).map(p => ({ ...p, aliases: [p.label] }))];
      }
      return all
        .filter(p => evolution || related.has(p.id))
        .map(p => current.id === state.current.id ? p : { ...p, aliases: [p.label] });
    });
  }
  function evolutionPictures() {return withEditPictures(pictureLibrary(),chatLibrary(true));}
  function dispatchEvolution(target: string, recordId: string, inputRecordId?: string) {
    const pictures = evolutionPictures(); retrospects.relabel(pictures);
    const change = retrospects.prepareDispatch(target, recordId, evolutionName(target), pictures, freezePictureRefs(pictures, pictureScopes()), inputRecordId);
    if (change) retrospects.commitTree(change);
  }
  function trackEvolution(target: string, parentId: string | null, _advance: boolean, references: readonly string[] = []) { return retrospects.collectWorkshop(target, parentId, references); }
  async function applyTreeChange(change: EvolutionTreeChange, title: string, nodeId = '', beforeCommit?: () => Promise<void>, notify = true) {
    if (controller || writingDraft.value || disposed) throw new Error('请等待当前操作完成');
    writingDraft.value = true;
    try {
      await chat.warm();
      const issue = retrospects.treeIssue(change); if (issue) throw new Error(issue);
      await beforeCommit?.();
      const base = readDraftState(change.before.boardId ?? undefined);
      const plan: DraftPlan = { title, workspace: 'image', conversationId: base.conversationId, boardId: change.before.boardId ?? undefined,
        changes: [], steps: [], aligned: true, fingerprint: change.id, treeChange: change };
      const operation = history.create({ title, question: '', baseHash: stateHash(base), base, steps: [], synthetic: true }, '', 0,
        { kind: 'evolution', retrospectId: change.id, nodeId });
      await history.apply(operation, plan);
      if (notify) deps.ui.toast(title, 'info', { label: '撤销', run: () => undoDraft(operation.id) });
    } finally { writingDraft.value = false; draftRevision.value++; }
  }

  function pictureLibrary() {
    const d = drawing.snapshot();
    return withEditPictures(snapshotPictures(d.history, d.favorites, ids), editPictures(deps.editor, ids, chatLibrary()));
  }
  function referencedPictureIds() {
    const wanted = new Set<string>();
    const add = (tags: readonly string[], refs?: PictureRefs) => { for (const tag of tags) if (refs?.[tag]) wanted.add(refs[tag].record_id); };
    for (const r of retrospects.records.value) add(r.value.nodes.flatMap(n => n.image_ids), r.pictureRefs);
    for (const c of conversations.list()) {
      for (const turn of c.session.records) add(turn.targets, turn.pictureRefs);
      for (const e of c === conversations.current ? entries.value : c.entries) if (e.type === 'turn') {
        add([...(e.turn.question.match(idPattern) ?? []), ...e.turn.anchor ? [e.turn.anchor] : [], ...e.turn.items.flatMap(i => i.kind === 'text' ? i.text.match(idPattern) ?? [] : i.kind === 'pick' ? i.ids : i.kind === 'retrospect' ? i.value.nodes.flatMap(n => n.image_ids) : [])], e.turn.pictureRefs);
      }
    }
    return wanted;
  }
  function syncPictureResources() {
    if (disposed) return;
    const wanted = referencedPictureIds();
    drawing.retainHistory('evolution', new Set(retrospects.records.value.flatMap(r => r.value.nodes.flatMap(n => n.image_ids.flatMap(tag => r.pictureRefs[tag] ? [r.pictureRefs[tag].record_id] : [])))));
    const drafts = conversations.list().flatMap(c => [...c.externalQueue, ...((c === conversations.current ? draft.value : c.draft) ? [(c === conversations.current ? draft.value : c.draft)!] : [])]).filter(r => r.status === 'pending');
    drawing.retainHistory('drafts', new Set(drafts.flatMap(r => [...r.draft.editHandoff ? [r.draft.editHandoff.image.ref] : [], ...r.draft.steps.flatMap(s => s.kind === 'edit_references' ? s.items.map(i=>i.image.ref) : s.kind === 'chat_handoff' ? s.images.map(i => i.ref) : s.kind === 'slate_edit' ? s.change.bindings.map(b => b.ref) : [])])));
    deps.editor?.retainRecords(new Set([...wanted, ...writer.retainedRecords(), ...pendingResourcePictures.map(p => p.id)]));
    libraryRevision.value++;
  }
  const pictureScope = () => pageScope;
  const pictureScopes = () => ({page:pageScope,favorites:drawing.favoritesScopeId,ask:activeScope.id,chat:chat.snapshot().current.id});
  function boundPicture(label: string, refs?: PictureRefs): Picture | null {
    const all = [...pictureLibrary(), ...chatLibrary(), ...attachmentPictures(attachments.read([...new Set([...entryAttachments(entries.value), ...tray.value])]), activeScope.id)];
    if (!refs) return all.find(p => p.aliases.includes(label)) ?? null;
    const ref = refs[label];
    if (!ref) return null;
    const scope = ref.scope;
    const scopeValid = scope.kind === "page" ? scope.id===pageScope : scope.kind === "favorites" ? scope.id===drawing.favoritesScopeId : scope.kind === "ask" ? scope.id===activeScope.id : scope.id===chat.snapshot().current.id;
    if (scope.kind==="chat" && scope.turn_id && scope.version_id && scope.asset_id) {
      const c = chat.snapshot().conversations.find(c=>c.id===scope.id), t=c?.turns.find(t=>t.id===scope.turn_id), v=t?.versions.find(v=>v.id===scope.version_id), asset=chat.assets.assets.get(scope.asset_id);
      if (c && t && v?.status==="done" && asset && (v.blocks.some(b=>b.type==="image" && b.assetId===scope.asset_id) || Object.values(v.composites??{}).includes(scope.asset_id)) && (!ref.entity_key || ref.entity_key===`sha256:${asset.id}`)) return {
        id:ref.record_id,entity_key:`sha256:${asset.id}`,scope, label,aliases:[label],createdAt:v.completedAt ?? 0,
        blob:asset.blob,size:{width:asset.width,height:asset.height},params:{evolutionInput:JSON.parse(JSON.stringify(chatEvolutionInput(c,t,v,asset.id,asset))),chatConversationId:c.id},origins:[{source:"chat" as const,label,order:0}],
      };
    }
    if (scope.kind === 'chat' && !scope.turn_id && scope.asset_id) {
      const state = chat.snapshot(), c = state.conversations.find(c => c.id === scope.id);
      const p = c && chatPictures({ ...state, current: c }, chat, false, chatIds).find(p => p.id === ref.record_id && p.entity_key === ref.entity_key);
      if (p) return { ...p, label, aliases: [label] };
    }
    const exact = all.find(p => p.id===ref.record_id && (!ref.entity_key || p.entity_key===ref.entity_key));
    // Original persisted record is readable across refresh; no label is resolved anew.
    if (exact && (scopeValid || exact.origins.some(o=>o.source==="favorites"))) return exact;
    return ref.entity_key ? all.find(p=>p.entity_key===ref.entity_key && p.origins.some(o=>o.source==="favorites")) ?? null : null;
  }
  /** Preview URLs stay with the source owner and survive original-pixel release. */
  function pictureUrl(item: Picture): string | null {
    const same = (record: { blob?: Blob; entity_key?: string }) => record.blob === item.blob || !!item.entity_key && record.entity_key === item.entity_key;
    if (item.scope?.kind === "chat" && item.scope.asset_id) {
      const asset = chat.assets.assets.get(item.scope.asset_id);
      if (asset && same(asset)) return asset.url;
    }
    const d = drawing.snapshot();
    const record = [...d.history, ...d.favorites].find(r => r.id === item.id && same(r));
    if (record) return drawing.url(record, true);
    const version = deps.editor?.boards().flatMap(b => b.versions).find(v => v.recordId === item.id && same(v));
    if (version) return version.url;
    const attachment = attachments.get(item.id);
    return attachment?.kind === "image" && same(attachment) ? attachment.url : null;
  }
  function digestNow(anchorLabel: string | null, formText = false, metadataOnly = !settings.value.images): Digest {
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
        (workspace === "chat" || workspace === "home")
          ? {
              title: conversation.title,
              turns: ancestry(conversation).length,
              head: conversation.headId ? chatLabel(conversation, conversation.headId) : null,
              composer: conversation.prompt,
              input_images: chatContext(c, chatLibrary()).input_images,
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
    const state = JSON.parse(digest.json);
    return { ...digest, baseHash:stateHash(readDraftState()), json: JSON.stringify({ ...state, base_hash:stateHash(readDraftState()),
      ...(workspace === "home" && deps.home ? { home: homeContext(deps.home, ids, chat) } : {}),
      image: state.image.form ? { ...state.image, ...naiAwareness({form: d.form, models:d.models, samplers:d.samplers, quote:d.quote, quoteKey:d.quoteKey,quoteAt:d.quoteAt,account:d.quota?.media.subscription, accountAt:d.quotaAt,accountSource:naiSourceKey(d.model),referenceCosts:Object.fromEntries(d.models.map(m=>[m.id,services.references.cachedCost(d.form.naiReferences,m.id)]))}).snapshot } : state.image,
      picture_ref_version: 2, picture_scope_id: pictureScope(), favorites_scope_id:drawing.favoritesScopeId,
      edit: (()=>{const directory=editWorkspaceContext(deps.editor,pictureLibrary()); const edit=deps.editor?.askSnapshot(); return workspace==='edit'&&edit?.ready ? {...directory,...editAwareness(edit).snapshot}:directory;})(),
      image_input: { enabled: !metadataOnly, mode: metadataOnly ? "metadata_only" : "on_demand",
        ...(metadataOnly ? { note: "本轮不发送任何图片，view_image、view_sheet 与 refs 图片读取不可用；请基于元数据回答，不要重复尝试看图。" } : {}) },
      active_slate: slateSummary(deps.slates?.get(conversations.current.slateId ?? "") ?? null),
      ...(referenceSource ? { refs_index: referenceSource.index() } : {}),
      ...(inline.value ? { inline_selection: inline.value } : {}) }) };
  }
  const currentHash = () => stateHash(readDraftState());
  // Numbers are handed out as images arrive, so every #h keeps its order.
  let previousBoardId = drawing.snapshot().activeBoardId;
  let previousEditId=deps.editor?.session.id, previousChatId=chat.snapshot().current.id;
  let boardTrackingEpoch = 0;
  function syncDrawing() {
    const d = drawing.snapshot();
    if (previousBoardId !== d.activeBoardId) { retrospects.detachBoard(previousBoardId); previousBoardId = d.activeBoardId; boardTrackingEpoch++; }
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
    drawing.onRemove(() => { libraryRevision.value++; }),
    watch([entries, draft, externalRevision, draftRevision, retrospects.records], syncPictureResources, { flush: 'sync' }),
    drawing.onClear(boardId => { boardTrackingEpoch++; retrospects.detachBoard(boardId); }),
    drawing.onGeneration(boardId => {
      const binding = retrospects.begin(boardId);
      if (!binding) return null;
      return Object.assign((record: import('../domain/drawing.ts').ImageRecord) => {
        const p = pictureLibrary().find(p => p.id === record.id);
        if (!p) return;
        const warning = retrospects.land(binding, p, freezePictureRefs([p], pictureScopes()));
        if (warning) deps.ui.toast(warning, "warn");
      }, { finish: () => retrospects.finish(binding) });
    }),
    ...(deps.editor ? [deps.editor.onEvolution(trackEvolution),deps.editor.onEvolutionHandoff(dispatchEvolution), deps.editor.subscribe(() => { const id=deps.editor!.session.id;if(previousEditId!==id){previousEditId=id;boardTrackingEpoch++;} if(deps.editor?.snapshot().externalId) open.value=false; stateRevision.value++; libraryRevision.value++; draftRevision.value++; })] : []),
    ...(deps.slates ? [deps.slates.subscribe(() => { pruneSlateLinks(); stateRevision.value++; draftRevision.value++; })] : []),
    chat.onEvolution(trackEvolution),chat.onEvolutionHandoff(dispatchEvolution),
    chat.onFirstPrompt(id => queueAutomaticName({ kind: "chat", id })),
    chat.subscribe(() => { const id=chat.snapshot().current.id;if(previousChatId!==id){previousChatId=id;boardTrackingEpoch++;} draftRevision.value++; libraryRevision.value++; }),
    watch(open, (shown) => { if (shown) void chat.warm(); }, { immediate: true }),
    preferences.subscribe((key) => {
      if (!key || key === names.ask) {
        settings.value = readSettings();
        if (activeNaming?.automatic && !namingEnabled(activeNaming)) namingController?.abort();
        for (let i = namingQueue.length - 1; i >= 0; i--) if (!namingEnabled(namingQueue[i]!)) namingQueue.splice(i, 1);
      }
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
      scope: { id: c.scope.id, labels: ids.snapshot(), attachmentCounters:c.scope.attachments.counters }, session, entries: savedEntries,
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
      const saved = await Promise.all((await favorites.read()).map(async record=>({ ...record, attachments: await Promise.all(record.attachments.map(async a=>a.kind==="image" ? {...a,entity_key:await imageEntity(a.blob)} : a)) })));
      if (disposed) return;
      let checkpointId = 0;
      const restoredScopes = new Map<string, ConversationScope>();
      const restored = saved.map((record): Conversation => {
        // Each page extends its own copy, so two tabs can both allocate #a2 without mixing them later.
        let context = restoredScopes.get(record.scope.id);
        if (!context) { context = scope(); restoredScopes.set(record.scope.id, context); }
        context.attachments.restoreCounters(record.scope.attachmentCounters);
        context.attachments.restore(record.attachments, [...record.tray, ...entryAttachments(record.entries)]);
        const restoreRefs = (refs?: PictureRefs): PictureRefs | undefined => refs ? Object.fromEntries(Object.entries(refs).map(([tag,ref])=>[tag,ref.scope.kind === "ask" && ref.scope.id === record.scope.id ? {...ref,scope:{...ref.scope,id:context.id}} : ref])) : undefined;
        const session = restoreSavedSession({...record,session:{...record.session,
          turns:record.session.turns.map(t=>({...t,pictureRefs:restoreRefs(t.pictureRefs)})),
          ...(record.session.archive ? {archive:record.session.archive.map(t=>({...t,pictureRefs:restoreRefs(t.pictureRefs)}))} : {}),
        }}, addUsage);
        const legacyRefs: Record<string, PictureRefs[string]> = Object.fromEntries((["history","favorites"] as const).flatMap((kind) => (kind === "favorites" && record.scope.labels.favoriteSeqs ? record.scope.labels.favoriteSeqs : record.scope.labels[kind].map((id,i)=>({id,seq:i+1}))).map(({id:recordId,seq}) => {
          const tag = `#${kind === "history" ? "h" : "f"}${seq}`, stored = drawing.snapshot().favorites.find(r=>r.id===recordId);
          return [tag,{tag,record_id:recordId,entity_key:stored?.entity_key ?? "",scope:{kind:kind==="history" ? "page" as const : "favorites" as const,id:`legacy:${record.scope.id}`}}];
        })));
        for (const a of record.attachments) if (a.kind === "image") legacyRefs[a.id] = {tag:a.id,record_id:a.id,entity_key:a.entity_key ?? "",scope:{kind:"ask",id:context.id}};
        const restoredEntries = record.entries.map(e => e.type === "note" ? { ...e, checkpoint: e.checkpoint ? { ...e.checkpoint, id: --checkpointId } : null } : { ...e, turn: { ...e.turn,
          pictureRefs: restoreRefs(e.turn.pictureRefs) ?? legacyRefs,
          turnId: e.turn.turnId ?? (e.turn.committed ? session.records[e.turn.committed - 1]?.turnId ?? null : null),
          // Historical checkpoints remain visible, but can never alias a new page's undo record.
          checkpoint: e.turn.checkpoint ? { ...e.turn.checkpoint, id: --checkpointId } : null,
          attachments: context.attachments.read(e.turn.attachments.map(a => a.id)).map(attachmentView),
        } });
        for (const entry of restoredEntries) sequence = Math.max(sequence, entry.id);
        const pending = record.draft ? history.create(remapHandoffDraft(record.draft.value, record.scope.id, context.id), record.id, record.draft.turnId) : null;
        if (pending && record.draft) pending.off = new Set(record.draft.off);
        return { id: record.id, slateId: record.slateId ?? null, title: record.title, named: record.named, favorite: true, createdAt: record.createdAt, origin: record.origin,
          scope: context, session, entries: restoredEntries,
          input: record.input, anchor: record.anchor, tray: record.tray, draft: pending, preparing: 0, externalQueue: (record.externalQueue ?? []).map(r => history.create(r.value, record.id, r.turnId)) };
      });
      conversations.restore(restored);
      for (const owner of restored) if (owner.session.turns) autoNamed.add(owner);
      for (const owner of restored) for (const entry of owner.entries) if (entry.type === 'turn' && entry.turn.status === 'done')
        for (const item of entry.turn.items) if (item.kind === 'retrospect') retrospects.register(item.value, entry.turn.pictureRefs ?? {}, { conversationId: owner.id, turnId: entry.id, boardId: null, boardName: '历史画板' }, 'ended');
      if (restored.length) load();
    } catch (error) { if (!disposed) deps.ui.toast(`收藏读取失败：${message(error)}`, "err"); }
    finally { favoritesReady.value = true; pruneSlateLinks(); }
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
    () => estimateRequestBreakdown({ tools: toolList, system: system.value, messages: [] }),
  );
  const stateTokens = computed(() => {
    void stateRevision.value;
    void entries.value;
    void conversationId.value;
    return visible.value && ready.value === "ok"
      ? estimateRequestBreakdown({
          tools: [],
          system: ["", ""],
          messages: [
            ...conversations.current.session.requestHistory(!settings.value.images),
            { role: "user", content: [{ type: "text", text: stateBlock(digestNow(anchor.value)) }, ...attachmentBlocks(attachments.read(tray.value), !settings.value.images), ...attachments.read(tray.value).flatMap(a => a.kind === "image" && a.annotations ? [{ type: "text" as const, text: serializeAnnotations(a.annotations.snapshot, a.id, a.annotations.guideId) }] : [])] },
          ],
        }).messages
      : 0;
  });
  /** All categories describe the same next-send estimate, never cumulative usage. */
  const contextTokens = computed(() => {
    if (!stateTokens.value) return null;
    const { system, tools } = staticTokens.value, messages = stateTokens.value + approxTokens(input.value);
    return { system, tools, messages, total: system + tools + messages };
  });
  const estimate = computed(() => contextTokens.value?.total ?? 0);
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
  const selectedAnchors = new WeakSet<Conversation>();
  function selectAnchor(label: string | null) {
    anchor.value = label;
    if (label) selectedAnchors.add(conversations.current);
    else selectedAnchors.delete(conversations.current);
  }
  type SendOptions = { metadataOnly?: boolean; anchor?: string | null; anchorBefore?: string | null; anchorRefs?: PictureRefs; preserveInput?: boolean; attachments?: readonly string[]; replaceId?: number; draftFeedback?: string };
  async function send(text = input.value, options: SendOptions = {}) {
    if ((!text.trim() && !(options.attachments ?? tray.value).length) || !manageable() || preparing.value) return;
    if (draft.value && !canReviseDraft.value) { notice.value = "请先应用或放弃当前草稿"; return; }
    const provider = providerForSend();
    if (!provider) return;
    if (draft.value) {
      const previous = draft.value.draft, plan = draftPlan.value;
      const feedback = dataBlock(canonical({
        original_request: previous.question,
        proposal: { title: previous.title, steps: previous.steps, new_board_name: previous.newBoardName },
        target: { workspace: plan?.workspace ?? previous.base.workspace, board_id: previous.base.boardId, edit_board_id: previous.base.edit?.id, chat_id: previous.base.conversationId },
        withdrawn_steps: plan?.steps.filter(s => !s.enabled).map(s => ({ label: s.label, before: s.before, after: s.after })) ?? [],
      }));
      options = { ...options, draftFeedback: `用户正在补充上一份内置草稿。下面的旧稿已忽略、尚未应用，不能当作已写入状态；请结合原需求与本次补充，依据本轮真实工作区状态重新整理完整草稿。用户已撤回的步骤不要默认加回。\n${feedback}` };
      ignoreDraft(true);
    }
    await dispatch(text, options, provider);
  }
  /** One controller covers pre-send compaction, persistence and the following answer. */
  async function dispatch(text: string, options: SendOptions, provider: ReturnType<typeof createProvider>) {
    const owner = conversations.current, abort = new AbortController(), fromTray = options.attachments === undefined;
    const selected = [...(options.attachments ?? tray.value)], pool = owner.scope.attachments;
    const typedAnchor = [...text.matchAll(idPattern)][0]?.[0];
    const selectedAnchor = typedAnchor ?? (options.anchor !== undefined ? options.anchor : anchor.value);
    const previous = [...entries.value].reverse().find(e => e.type === "turn" && e.turn.status === "done" && e.turn.anchor === selectedAnchor);
    const captured = { ...options, attachments: selected, anchor: selectedAnchor, anchorBefore: anchor.value,
      anchorRefs: typedAnchor && typedAnchor !== options.anchor ? undefined
        : options.anchorRefs ?? (options.anchor === undefined && !selectedAnchors.has(owner) && previous?.type === "turn" ? previous.turn.pictureRefs : undefined) };
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
    const codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words, replacements: config.replacements, wordEncoding: config.wordEncoding });
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
            protocol: provider!.protocol,
            model: config.model, promptVersion }, event.body);
          else if (call) callLog.finish(call, event);
        } });
      if (result.status === "compacted") say("上下文已压缩");
      return result.status;
    } catch (error) {
      if (call) callLog.fail(call, abort.signal.aborted, message(error));
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
    let question = text.trim();
    notice.value = "";
    // The compact success pill belongs to the write, not later replies.
    appliedDraft.value = null;
    const owner = conversations.current;
    const attached = attachments.read(options.attachments ?? tray.value);
    const annotated = attached.filter(a => a.kind === 'image' && a.annotations);
    if (!question && annotated.length) question = '请按这些批注逐条处理。';
    const questionBody = [question, ...annotated.flatMap(a => a.kind === 'image' && a.annotations ? [serializeAnnotations(a.annotations.snapshot, a.id, a.annotations.guideId)] : [])].join('\n\n');
    if (!entries.value.some(e => e.id !== options.replaceId) && !owner.named) {
      owner.title = titleOf(question, attached[0]?.name); listRevision.value++;
    }
    const config = settings.value, anchorBefore = options.anchorBefore !== undefined ? options.anchorBefore : anchor.value,
      requestedAnchor = options.anchor !== undefined ? options.anchor : anchor.value,
      metadataOnly = !!options.metadataOnly || !config.images,
      codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words, replacements: config.replacements, wordEncoding: config.wordEncoding });
    await deps.editor?.prepareAsk();
    abort.signal.throwIfAborted();
    // The snapshot is fixed for the whole turn; get_state appends newer ones.
    retrospects.relabel(evolutionPictures());
    const snapshotBoardEpoch = boardTrackingEpoch, target=currentEvolutionTarget();
    const frozenEvolutionChat=chatLibrary(true);
    const snapshotTime = Date.now(), snapshot = drawing.snapshot(),
      frozenBoards = structuredClone(snapshot.boards),
      library = bindPictures([...withEditPictures(pictureLibrary(), chatLibrary()), ...attachmentPictures(attachments.read([...new Set([...entryAttachments(entries.value), ...attached.map(a => a.id)])]), owner.scope.id)], pictureScopes()),
      turnChatContext = chatContext(chat.snapshot(), library),
      known = owner.session.viewed(),
      turnViewed = new Set(known),
      draftBase = readDraftState();
    // A continued label must still bind the same accessible record. In particular,
    // a restored #h or a CHAT/EDIT shorthand must never silently select a new image.
    const previousRef = requestedAnchor ? options.anchorRefs?.[requestedAnchor] : undefined;
    const turnAnchor = requestedAnchor && library.some(p => p.aliases.includes(requestedAnchor) &&
      (!options.anchorRefs || previousRef && p.id === previousRef.record_id &&
        p.bindings?.[requestedAnchor]?.entity_key === previousRef.entity_key &&
        canonical(p.bindings?.[requestedAnchor]?.scope) === canonical(previousRef.scope))) ? requestedAnchor : null;
    const reviewScope = structuredClone(retrospects.records.value.filter(r => r.sources.some(s => s.conversationId === owner.id) || retrospects.relatedTo(r, target)).map(r => retrospects.get(r.id, target)!).slice(-20));
    const recipeRecords = owner.session.records;
    const recipes = createRecipeReader(() => {
      for (const p of bindPictures(frozenEvolutionChat, pictureScopes())) {
        const at = library.findIndex(existing => existing.id === p.id);
        if (at < 0) library.push(p);
        else library[at] = { ...library[at], label: p.label, aliases: [...new Set([...library[at].aliases, ...p.aliases])], bindings: { ...library[at].bindings, ...p.bindings } };
      }
      working.pictureRefs=freezePictureRefs(library,pictureScopes());
      const referencedFavorites = new Set<string>();
      for (const record of recipeRecords) {
        const mentioned = record.messages.filter(m => m.role === 'assistant').flatMap(m => m.content.flatMap(b => b.type === 'text' ? b.text.match(idPattern) ?? [] : []));
        for (const tag of [...record.targets ?? [], ...mentioned]) {
          const ref = record.pictureRefs?.[tag];
          if (ref && library.some(p => p.id === ref.record_id && (!ref.entity_key || p.entity_key === ref.entity_key) && p.origins.some(o => o.source === 'favorites'))) referencedFavorites.add(ref.record_id);
        }
      }
      for (const tag of (`${question} ${turnAnchor ?? ''}`.match(idPattern) ?? [])) {
        const p = library.find(p => p.aliases.includes(tag) && p.origins.some(o => o.source === 'favorites'));
        if (p) referencedFavorites.add(p.id);
      }
      return recipeClusters(library.filter(p => recipeWorkspace(recipeOf(p.params)) === 'image'), referencedFavorites, target);
    }, reviewScope.find(r => r.status === 'active' && retrospects.relatedTo(r, target))?.boardId ?? target, reviewScope);
    const digest = digestNow(turnAnchor, false, metadataOnly), initialState = digestNow(turnAnchor, true, metadataOnly);
    const frozenReferenceCosts = new Map(frozenBoards.map(b=>[b.id,Object.fromEntries(snapshot.models.map(m=>[m.id,services.references.cachedCost(b.form.naiReferences,m.id)]))]));
    const frozenEditContexts=new Map(deps.editor?.boards().map(b=>[b.id,editWorkspaceContext(deps.editor,library,b.id)])??[]);
    const frozenEdits = new Map(deps.editor?.boards().map(b=>[b.id, deps.editor!.askSnapshot(b.id)!]) ?? []);
    const frozenEvolutionEdits = new Map(library.map(p=>[p.id,deps.editor?.evolutionDraftState(p.id)]));
    const includeImageForm = !!JSON.parse(digest.json).image.form;
    const readBoards = new Set(draftBase.boardId && includeImageForm ? [draftBase.boardId] : []);
    if (!metadataOnly) for (const a of attached) if (a.kind === "image") turnViewed.add(a.entity_key ?? a.id);
    const frozenNai = structuredClone({ form: draftBase.form, models: draftBase.models, samplers: draftBase.samplers,
      account:naiAccountSnapshot(snapshot.quota?.media.subscription), accountAt:snapshot.quotaAt,accountSource:naiSourceKey(snapshot.model), quoteKey:snapshot.quoteKey,quoteAt:snapshot.quoteAt,referenceCosts:Object.fromEntries(snapshot.models.map(m=>[m.id,services.references.cachedCost(draftBase.form.naiReferences,m.id)])), quote:snapshot.quote.status === 'error' ? undefined : snapshot.quote });
    const awareness = includeImageForm ? await naiAwareness(frozenNai).counted() : undefined;
    const initialEdit = frozenEdits.get(draftBase.edit?.id ?? '');
    const editInput = draftBase.workspace === 'edit' && initialEdit?.ready ? await editAwareness(initialEdit).counted() : undefined;
    abort.signal.throwIfAborted();
    const pendingReviewStatus = new Map<string, ReviewStatus>();
    const reviewSummary = () => reviewScope.map(r => ({ retrospect_id: r.id, title: r.value.title, status: pendingReviewStatus.get(r.id) ?? retrospects.get(r.id)?.status ?? r.status, board_id: r.boardId, versions: versionCount(r.value), staged: stagedCount(r.value), expected_revision: r.revision, cursor: r.cursor, pending: retrospects.pending(r.id), workshops: r.workshops.map(t => ({ workspace: evolutionWorkspace(t.target), status: workshopPending(t) ? 'pending' : 'delivered', node_id: t.nodeId })), final: r.final }));
    for (const value of [digest, initialState]) {
      const state = JSON.parse(value.json);
      if (awareness) state.image = {...state.image,...awareness};
      if(state.workspace==='edit'&&editInput) state.edit={...state.edit,...editInput};
      state.retrospects = reviewSummary();
      state.conversation_history = {
        archived_through: owner.session.memory?.through ?? null,
        retained_verbatim: owner.session.retained.map(t => t.turnId),
      };
      Object.assign(value,{json:JSON.stringify(state)});
    }
    const user: AskMessage = {
      role: "user",
      content: [
        { type: "text", text: stateBlock(digest), source: { kind: "workspace_state" } },
        ...(options.draftFeedback ? [{ type: "text" as const, text: options.draftFeedback }] : []),
        ...attachmentBlocks(attached, metadataOnly),
        { type: "text", text: questionBody },
      ],
    };
    const turn = owner.session.begin(user, { metadataOnly }), pacer = createPacer();
    abort.signal.addEventListener("abort", pacer.cancel, { once: true });
    transfer();
    if (!options.preserveInput && text === input.value) input.value = "";
    const working: WorkingTurn = {
      id: ++sequence,
      question,
      ...(options.draftFeedback ? { draftFeedback: options.draftFeedback } : {}),
      anchor: turnAnchor,
      pictureRefs: freezePictureRefs(library, pictureScopes()),
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
    const branchTurn = createBranchTurn({ store: retrospects, reader: recipes, reviews: reviewScope, base: draftBase,
      owner: { conversationId: owner.id, turnId: working.id, boardId: target, boardName: evolutionName(target) }, library,
      refs: () => working.pictureRefs ?? {}, signal: abort.signal,
      current: () => currentEvolutionTarget() === target && boardTrackingEpoch === snapshotBoardEpoch && router.route.value.workspace === 'image',
      available: source => boundPicture(source.label, working.pictureRefs)?.id === source.id,
      check: candidate => checkNaiInput(candidate, { image: form => naiAwareness({ ...frozenNai, form, samplers: draftBase.samplersByModel?.[form.model] ?? frozenNai.samplers, quote: undefined }).counted(), edit: state => editAwareness(state).counted() }),
    });
    const visual = { signal: abort.signal, metadataOnly, budget: turn.budget.vision, viewed: turnViewed };
    const readRef = createReferenceReader({ source: referenceSource?.snapshot() ?? null, pool: owner.scope.attachments,
      attached, limits: config.textAttachments, pageBytes: pageAttachmentBytes, visual, vision,
      added(item) {
        working.attachments = [...working.attachments, attachmentView(item)];
        library.push(...bindPictures(attachmentPictures([item], owner.scope.id),pictureScopes()));
        working.pictureRefs = freezePictureRefs(library,pictureScopes()); libraryRevision.value++;
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
            connection: config.connectionId, protocol: provider.protocol,
            model: request.model, promptVersion }, event.body);
          else { observedUsage = event.usage; if (call) callLog.finish(call, event); }
        } })) { if (event.type === "done") done = true; yield event; }
      } catch (error) {
        if (!done) turn.record(observedUsage);
        if (call) callLog.fail(call, signal.aborted, message(error));
        throw error;
      }
    }
    try {
      pendingResourcePictures = library;
      drawing.retainHistory('running', new Set(library.map(p => p.id)));
      syncPictureResources();
      for await (const event of run({
        stream: tracedStream,
        responseMode: config.responseMode,
        request: { model: config.model, tools: toolList, system: system.value, maxTokens: MAX_OUTPUT },
        turn,
        tools,
        context: {
          signal: abort.signal,
          metadataOnly,
          library,
          recipes,
          refreshRecipeReviews: branchTurn.refresh,
          stageEvolutionBranch: branchTurn.stage,
          evolutionBase: recordId => {
            if (draftBase.workspace === 'edit') return { edit: structuredClone(frozenEvolutionEdits.get(recordId)) };
            const frozen = reviewScope.find(r => r.boardId === target && r.status === 'active');
            if (!frozen || retrospects.get(frozen.id)?.revision !== frozen.revision) throw new Error('版本演进已变化，请重新读取后提议回退');
            return retrospects.prepareMove(target,recordId);
          },
          setRetrospectStatus(id, status) {
            const base = reviewScope.find(r => r.id === id), current = retrospects.get(id);
            if (!base || current?.revision !== base.revision) throw new Error('演进状态已变化，请重新确认当前状态');
            if (status === 'active' && (!retrospects.relatedTo(base, currentEvolutionTarget()) || !base.cursor || !boundPicture(base.cursor.imageId, base.pictureRefs))) throw new Error('请先切回原画板，并选择仍有效的演进基底');
            pendingReviewStatus.set(id, status);
            return { retrospect_id: id, status, pending_until_turn_success: true, history_retained: true };
          },
          vision,
          visual,
          readRef,
          prepareDraftImages: value => prepareProjectHandoffs(value, path => readRef.prepareImage(path)),
          checkNaiInput: draft => checkNaiInput(draft, {
            image: form => naiAwareness({...frozenNai,form,quote:undefined}).counted(),
            edit: state => editAwareness(state).counted(),
          }),
          tags: services.tags.suggest,
          snapshotTime,
          chatContext: turnChatContext,
          draftBase,
          readSlate: scope => scope === "latest" ? deps.slates?.get(conversations.current.slateId ?? "") ?? null : draftBase.slate ?? null,
          question,
          recall: input => owner.session.recall(input, id => owner.scope.attachments.get(id)),
          state: async (scope, boardId, editBoardId) => {
            if(editBoardId) {
              if(scope==='latest') await deps.editor?.prepareAsk();
              const edit=scope==='initial'?frozenEdits.get(editBoardId):deps.editor?.askSnapshot(editBoardId);
              if(!edit)throw new Error('编辑画板不在该状态快照中');
              return {text:JSON.stringify({edit:{...(scope==='initial'?frozenEditContexts.get(editBoardId):editWorkspaceContext(deps.editor,pictureLibrary(),editBoardId)),...await editAwareness(edit).counted()},draft_base_hash:digest.baseHash}),images:0};
            }
            if (boardId) {
              const boards = scope === "latest" ? drawing.snapshot().boards : frozenBoards;
              const board = boards.find(b => b.id === boardId);
              if (!board) throw new Error("画板不在该状态快照中");
              readBoards.add(board.id);
              const input=scope==='initial'?{...frozenNai,referenceCosts:frozenReferenceCosts.get(board.id)}:(()=>{const d=drawing.snapshot();return {models:d.models,samplers:d.samplers,account:d.quota?.media.subscription,accountAt:d.quotaAt,accountSource:naiSourceKey(d.model),referenceCosts:Object.fromEntries(d.models.map(m=>[m.id,services.references.cachedCost(board.form.naiReferences,m.id)]))};})();
              const awareness=await naiAwareness({...input,form:{...frozenNai.form,...board.form},quote:undefined}).counted();
              return { text: JSON.stringify({ ...awareness, board_id: board.id, name: board.name, form: { ...board.form, characters: board.form.characters.map(c => ({ ...characterSummary(c, board.form.placement, board.form.model), centers: c.centers })) }, character_capability: characterCapability(board.form.model), draft_base_hash: digest.baseHash }), images: snapshot.history.length };
            }
            if (scope === "initial") return { text: stateBlock(initialState), images: snapshot.history.length };
            await deps.editor?.prepareAsk();
            const d = drawing.snapshot(), latest = digestNow(turnAnchor, true, metadataOnly), state = JSON.parse(latest.json);
            const edit = deps.editor?.askSnapshot();
            if (state.image.form) state.image = {...state.image,...await naiAwareness({form:d.form,models:d.models,samplers:d.samplers,
              quote:d.quote,quoteKey:d.quoteKey,quoteAt:d.quoteAt,account:d.quota?.media.subscription,accountAt:d.quotaAt,
              accountSource:naiSourceKey(d.model),referenceCosts:Object.fromEntries(d.models.map(m=>[m.id,services.references.cachedCost(d.form.naiReferences,m.id)]))}).counted()};
            if (state.workspace === 'edit' && edit?.ready) state.edit = {...state.edit,...await editAwareness(edit).counted()};
            state.retrospects = reviewSummary();
            state.conversation_history = {archived_through:owner.session.memory?.through??null,retained_verbatim:owner.session.retained.map(t=>t.turnId)};
            return {text:stateBlock({...latest,json:JSON.stringify(state)}),images:d.history.length};
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
          if (event.retrospect) {
            for (const node of event.retrospect.nodes) for (const id of node.image_ids) readTargets.add(id);
            const previous = reviewScope.find(r => r.id === event.retrospect!.target?.id);
            if (previous) working.pictureRefs = { ...previous.pictureRefs, ...working.pictureRefs };
          }
          last = "end";
          pacer.push(() => {
            const row = rows.get(event.id);
            if (row) {
              row.state = event.ok ? "done" : "error";
              row.stat = event.stat;
              row.reason = event.reason;
            }
            if (event.picks?.length) working.items.push({ kind: "pick", ids: event.picks });
            if (event.retrospect) {
              working.items = working.items.filter(i => i.kind !== 'retrospect');
              working.items.push({ kind: 'retrospect', value: event.retrospect });
            }
            commit();
          }, PACE.toolMin);
        } else if (event.type === "usage") { usage.value = { ...total }; conversationUsage.value = owner.session.usage; }
        else if (event.type === "done") working.truncated = event.reason === "length";
      }
      if (proposed) pacer.push(() => {}, PACE.beforeDraft);
      await pacer.settled();
      abort.signal.throwIfAborted();
      working.turnId = turn.commit({ pictureRefs: working.pictureRefs, viewed: [...turnViewed].filter((id) => !known.has(id)), question,
        attachments: attached.map(a => a.id), targets: [...new Set([...(`${turnAnchor ?? ""} ${question}`.match(idPattern) ?? []),
          ...attached.filter(a => a.kind === "image").map(a => a.id), ...readTargets])],
        boards: [...readBoards],
        ...(proposed ? { draft: recordDraft(proposed, validateDraft(proposed, draftBase, { off: new Set(), has: hasImage, hasRecord })) } : {}) });
      working.committed = owner.session.turns;
      // Successful ordinary turns retain their anchor just like forkTurn. A failed
      // turn, or a new selection made while waiting, must not replace the lock.
      if (anchor.value === anchorBefore) {
        owner.anchor = anchor.value = turnAnchor;
        selectedAnchors.delete(owner);
      }
      if (proposed) draft.value = history.create(proposed, owner.id, working.id);
      working.status = "done";
      const updatedReviews = new Set<string>();
      for (const item of working.items) if (item.kind === 'retrospect') {
        if (branchTurn.committed.has(item.value)) continue;
        const reviewOwner = { conversationId: owner.id, turnId: working.id, boardId: target, boardName: evolutionName(target) };
        try {
          if (item.value.target) {
            retrospects.update(item.value.target.id, item.value.target.revision, item.value, working.pictureRefs ?? {}, reviewOwner);
            updatedReviews.add(item.value.target.id);
          } else {
            retrospects.register(item.value, working.pictureRefs ?? {}, reviewOwner, currentEvolutionTarget() === target && boardTrackingEpoch === snapshotBoardEpoch ? 'active' : 'ended', library);

          }
        } catch (error) { working.items.push({ kind: 'text', text: `版本演进未更新：${message(error)}` }); }
      }
      for (const [id, status] of pendingReviewStatus) {
        const base = reviewScope.find(r => r.id === id)!;
        const current = retrospects.get(id);
        if (status === 'active' && (!retrospects.relatedTo(base, currentEvolutionTarget()) || !current?.cursor || !(current.cursor.kind === 'staged' ? current.value.nodes.some(n => n.id === current.cursor!.nodeId && isStaged(n) && boundPicture(n.staged.base.tag, current.pictureRefs)) : boundPicture(current.cursor.imageId, current.pictureRefs)))) continue;
        retrospects.setStatus(id, status, base.revision + (updatedReviews.has(id) ? 1 : 0));
      }
      const reply = working.items.flatMap((i) => (i.kind === "text" ? [i.text.trim()] : [])).filter(Boolean).join("\n\n");
      say([reply, proposed ? "草稿已就绪，等待确认" : ""].filter(Boolean).join("\n"));
      settle(working);
      if (!autoNamed.has(owner)) {
        autoNamed.add(owner);
        if (!owner.origin && owner.session.turns === 1) queueAutomaticName({ kind: "conversation", id: owner.id });
      }
      if (currentHash() !== digest.baseHash)
        push({ type: "note", id: ++sequence, text: "提示词已在外部修改" });
    } catch (error) {
      pacer.cancel();
      await pacer.settled();
      turn.rollback();
      if (branchTurn.count) working.items.push({ kind: 'text', text: `本轮未完成，已保留 ${branchTurn.count} 个预设分支，可在版本演进中查看。` });
      const stopped = abort.signal.aborted;
      working.status = stopped ? "stopped" : "failed";
      working.failure = stopped
        ? null
        : { kind: error instanceof ProviderError ? error.kind : "local", message: message(error) };
      for (const row of rows.values()) if (row.state === "run") row.state = stopped ? "stopped" : "error";
      say(stopped ? "已停止" : `未能完成：${working.failure!.message}`);
      settle(working);
    } finally {
      pendingResourcePictures = [];
      syncPictureResources();
      drawing.retainHistory('running', new Set());
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
    titleRevisions.set(owner, (titleRevisions.get(owner) ?? 0) + 1);
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
  function captureNaming(target: NamingTarget, automatic = false): NamingJob | null {
    stash();
    if (target.kind === "chat") {
      const snapshot = chat.captureName(target.id);
      if (!snapshot || automatic && snapshot.renamed) return null;
      return { target, automatic, source: conversationNameContent(snapshot.turns), valid: snapshot.valid, apply: snapshot.apply };
    }
    if (target.kind === "board") {
      const board = drawing.board(target.id);
      if (!board) return null;
      const original = board.name;
      return { target, automatic, source: boardNameContent(board.form),
        valid: () => drawing.board(target.id) === board && board.name === original,
        apply: async name => { await drawing.renameBoard(target.id, name); return true; } };
    }
    const owner = conversations.get(target.id);
    if (!owner || automatic && owner.named) return null;
    const original = owner.title, revision = titleRevisions.get(owner);
    return { target, automatic,
      source: conversationNameContent(owner.entries.flatMap(e => e.type === "turn" && e.turn.status === "done"
        ? [{ question: e.turn.question, reply: e.turn.items.flatMap(i => i.kind === "text" ? [i.text] : []).join("\n") }] : [])),
      valid: () => conversations.get(owner.id) === owner && owner.title === original && titleRevisions.get(owner) === revision,
      apply: name => { renameConversation(owner.id, name); return true; } };
  }
  const sameNamingTarget = (a: NamingTarget, b: NamingTarget) => a.kind === b.kind && a.id === b.id;
  function namingEnabled(job: NamingJob) {
    return !job.automatic || settings.value.autoNaming;
  }
  function queueAutomaticName(target: NamingTarget) {
    if (disposed || !settings.value.autoNaming) return;
    const job = captureNaming(target, true);
    if (job) { namingQueue.push(job); drainNaming(); }
  }
  function drainNaming() {
    if (disposed || namingController) return;
    let job: NamingJob | undefined;
    while ((job = namingQueue.shift())) {
      if (!namingEnabled(job) || !job.valid()) continue;
      void runNaming(job);
      break;
    }
  }
  /** Manual naming can cancel its current request; automatic jobs share this lane. */
  async function generateName(target: NamingTarget) {
    if (disposed) return;
    if (naming.value) {
      if (sameNamingTarget(naming.value, target)) namingController?.abort();
      return;
    }
    for (let i = namingQueue.length - 1; i >= 0; i--) if (sameNamingTarget(namingQueue[i]!.target, target)) namingQueue.splice(i, 1);
    const job = captureNaming(target);
    if (job) await runNaming(job);
  }
  /** Text-only requests never join ASK context or block generation / reply completion. */
  async function runNaming(job: NamingJob) {
    if (disposed || !job.valid() || !namingEnabled(job)) return;
    const { target } = job, config = settings.value, choice = config.naming ?? config;
    let call = 0, received = false;
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(new ProviderError("timeout", "命名超时，请重试")), 60_000);
    namingController = abort; naming.value = target; activeNaming = job;
    try {
      const request = namingRequest(choice.model, job.source);
      if (!reasoningConnections(routing.value).some(c => c.id === choice.connectionId) || !choice.model)
        throw new Error("请先在设置 → ASK 配置命名模型或当前 ASK 模型");
      const provider = createProvider(connections.context(choice.connectionId), deps.fetch),
        codec = codecFor({ adult: adult.value, enabled: codecActive.value, words: config.words, replacements: config.replacements, wordEncoding: config.wordEncoding });
      let text = "";
      for await (const event of provider.stream(request, { signal: abort.signal, codec, observe(event) {
        if (event.type === "request") call = callLog.start({ conversation: target.kind === "conversation" ? target.id : `${target.kind}:${target.id}`, turn: 0, step: 1, question: `AI 命名 · ${target.kind === "conversation" ? "ASK" : target.kind === "chat" ? "CHAT" : "画板"}`,
          connection: choice.connectionId, protocol: provider.protocol, model: choice.model, promptVersion: namingPromptVersion }, event.body);
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
      const name = readGeneratedName(text, target.kind === "board" ? 80 : 60);
      if (disposed || !job.valid() || !namingEnabled(job)) return;
      if (await job.apply(name) && !disposed && !job.automatic) deps.ui.toast("名称已更新");
    } catch (error) {
      if (call && !received) callLog.fail(call, abort.signal.aborted && !(abort.signal.reason instanceof ProviderError), message(error));
      if (!disposed && (!abort.signal.aborted || abort.signal.reason instanceof ProviderError))
        deps.ui.toast(`${job.automatic ? "自动命名" : "命名"}失败：${message(abort.signal.aborted ? abort.signal.reason : error)}`, "err");
    } finally {
      clearTimeout(timeout);
      if (namingController === abort) { namingController = null; naming.value = null; activeNaming = null; }
      drainNaming();
    }
  }
  /** Stays on (or returns to) the one empty conversation; "limit" at 20. */
  function newConversation(): boolean | "limit" {
    if (!manageable()) return false;
    stash();
    const before = conversations.current;
    if (conversations.fresh() === "limit") return "limit";
    if (conversations.current !== before) load();
    selectAnchor(null);
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
    retrospects.removeSource(id);
    draftRevision.value++;
    if (conversations.current !== before) load();
    else listRevision.value++;
    syncPictureResources();
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
        const record = history.records.find(r => r.id === recordId);
        if (record?.plan) rememberSlateLinks(record.plan, true);
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
      retrospects.removeSource(conversationId.value, turnIds);
      if (draft.value && turnIds.has(draft.value.turnId)) draft.value = null;
      appliedDraft.value = null;
      anchor.value = entry.turn.anchor;
      selectedAnchors.delete(conversations.current);
      if (order.length) deps.ui.toast(`已撤回 ${order.length} 份草稿`);
      writingDraft.value = false;
      void dispatch(text, { anchor: entry.turn.anchor, anchorRefs: entry.turn.pictureRefs, metadataOnly: entry.turn.metadataOnly, preserveInput: true,
        draftFeedback: entry.turn.draftFeedback,
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
    // Restoring pixels after a privacy retry requires a separately labelled click.
    if (mode === "images" && !settings.value.images) return;
    if (mode === "codec") {
      if (!adult.value || !settings.value.words.length) return;
      sessionCodec.value = true;
    }
    const provider = providerForSend();
    if (!provider) return;
    void dispatch(entry.turn.question, { metadataOnly: mode === "metadata" || mode !== "images" && entry.turn.metadataOnly, anchor: entry.turn.anchor, anchorRefs: entry.turn.pictureRefs,
      draftFeedback: entry.turn.draftFeedback,
      preserveInput: true, attachments: entry.turn.attachments.filter(a => !a.toolRead).map(a => a.id), replaceId: entry.id }, provider);
  }
  /** Esc closes popovers, stops an active turn, or hides the window without discarding a draft. */
  function escape() {
    for (const layer of [...layers].reverse()) if (layer()) return;
    if (writingDraft.value) return;
    if (controller) stop();
    else { open.value = false; dismissCompact(); }
  }
  function onKey(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    const modal = () => retrospects.blocksAsk();
    const active = document.activeElement;
    const inside = !!root?.contains(active);
    const body = !active || active === document.body;
    const typing = active instanceof HTMLElement && (active.matches("input,textarea,select") || active.isContentEditable);
    if (event.defaultPrevented || modal() || editorOpen.value) return;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
      if (!(active instanceof HTMLTextAreaElement) || !["prompt", "negative", "chatPrompt"].includes(active.id) || controller || writingDraft.value) return;
      event.preventDefault();
      if (draft.value) { inline.value = null; open.value = true; notice.value = canReviseDraft.value ? "可在输入框补充修改意见" : "请先应用或放弃当前草稿"; return; }
      inlineElement = active;
      inline.value = { target: active.id === "chatPrompt" ? "chat.composer" : active.id === "negative" ? "image.negative" : "image.prompt", text: (active.value.slice(active.selectionStart, active.selectionEnd) || active.value).slice(0, 24000) };
      open.value = true;
      void nextTick(() => { placeInline(); document.getElementById("askPrompt")?.focus(); });
      return;
    }
    const compact = !editorOpen.value && !!root && root.dataset.mode !== "idle";
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && (visible.value || compact) && (inside || body) && !typing && window.getSelection()?.isCollapsed !== false) {
      if (canReviseDraft.value && (input.value.trim() || tray.value.length)) return;
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
      // Photopea and modal overlays keep their own keys.
      if (editorOpen.value || modal()) return;
      event.preventDefault();
      inline.value = null;
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
  const canManageTasks = computed(() => !running.value && manageable() && !preparing.value && !draft.value && !!deps.slates?.ready.value && !deps.slates.busy.value && !deps.slates.recovery.value);
  function detachSlate() {
    if (!canManageTasks.value) return;
    setSlateLink(conversations.current, null);
  }
  function proposeSlateAction(id: string, action: 'delete' | 'remove' | 'abandon' | 'reopen', todoId?: string) {
    if (!canManageTasks.value) return false;
    try {
      const base = readDraftState(undefined, id), slate = base.slate;
      if (!slate) throw new Error('任务清单已不存在');
      const todo = slate.todos.find(t => t.id === todoId);
      if (action !== 'delete' && !todo) throw new Error('待办已不存在');
      const title = `${action === 'delete' ? '删除清单' : action === 'remove' ? '删除待办' : action === 'abandon' ? '放弃任务' : '重新打开任务'} · ${todo?.title ?? slate.title}`;
      const step = parseSlateEdit({ kind: 'slate_edit', op: action === 'delete' ? 'delete' : 'update', slate_id: slate.id, expected_version: slate.version,
        ...(action === 'delete' ? {} : { todos: [{ op: action === 'remove' ? 'remove' : 'update', id: todo!.id,
          ...(action === 'remove' ? {} : { status: action === 'abandon' ? 'abandoned' : 'todo' }) }] }) }, slate, base.form, [], base.fileContext?.id ?? null);
      const entryId = ++sequence;
      entries.value = [...entries.value, { type: 'note', id: entryId, text: title }];
      draft.value = history.create({ title, baseHash: stateHash(base), question: '', base, steps: [step] }, conversations.current.id, entryId);
      draftRevision.value++; saveFavorite(); open.value = true;
      return true;
    } catch (error) { notice.value = message(error); return false; }
  }
  async function openSlate(id: string, fresh = false) {
    if (!manageable() || !deps.slates?.get(id)) return false;
    try { await deps.slates.select(id); }
    catch (error) { notice.value = message(error); return false; }
    if (!manageable()) return false;
    const owner = conversations.list().find(c => c.slateId === id);
    if (owner && !fresh) selectConversation(owner.id);
    else { if (newConversation() !== true) { notice.value = '会话已达上限，请先关闭一个会话'; return false; } setSlateLink(conversations.current, id); const slate = deps.slates.get(id); if (slate) conversations.current.title = slate.title; listRevision.value++; }
    draftRevision.value++;
    open.value = true; deps.slates.visible.value = false; saveFavorite();
    return true;
  }
  const restored = Promise.resolve(deps.slates?.restored).then(() => restoreFavorites());

  return {
    proposeFile, openSlate, canManageTasks, detachSlate, proposeSlateAction,
    activeSlate: computed(() => { void conversationId.value; void draftRevision.value; return deps.slates?.get(conversations.current.slateId ?? "") ?? null; }),
    connectFileExports(port: FilePort) { filePort = port; draftRevision.value++; return () => { if (filePort === port) filePort = null; }; },
    connectReferences(source: RefSource) { referenceSource = source; stateRevision.value++; return () => { if (referenceSource === source) { referenceSource = null; stateRevision.value++; } }; },
    referencesChanged() { stateRevision.value++; },
    restored,
    externalWaiting: computed(() => { void externalRevision.value; void conversationId.value; return conversations.current.externalQueue.map(r => ({ id: r.turnId, title: r.draft.title })); }),
    externalSnapshot() {
      return { base: { ...readDraftState(), workspace: "image" as const }, library: bindPictures(pictureLibrary(),pictureScopes()), edit: editContext(deps.editor, pictureLibrary()), pictureScope: pictureScope(), favoritesScope: drawing.favoritesScopeId, pictureRefVersion: 2 as const, ownerId: conversations.current.id };
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
    goEdit(id:string) {deps.editor?.gotoAskBoard(id);},
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
    retrospects,
    evolutionTarget: computed(()=>{libraryRevision.value;return currentEvolutionTarget();}),
    evolutionName,
    startEvolution() { if(!input.value.trim()) input.value='请整理当前创作的版本演进，结合提示词、参数、蒙版与实际编辑来源分析各阶段变化。';open.value=true; },
    setEvolutionStatus(id: string, status: ReviewStatus) {
      try {
        const r = retrospects.get(id, currentEvolutionTarget());
        if (!r) throw new Error('版本演进已失效');
        if (status === 'active' && (!retrospects.relatedTo(r, currentEvolutionTarget()) || !r.cursor || !(r.cursor.kind === 'staged' ? r.value.nodes.some(n => n.id === r.cursor!.nodeId && isStaged(n) && boundPicture(n.staged.base.tag, r.pictureRefs)) : boundPicture(r.cursor.imageId, r.pictureRefs)))) throw new Error('请先切回原画板，并选择仍有效的演进基底');
        return retrospects.setStatus(id, status);
      } catch (error) { deps.ui.toast(message(error), 'warn'); return false; }
    },
    async finalizeEvolution(id: string, node: RetrospectNode) {
      if (controller || writingDraft.value) throw new Error('请等待当前操作完成');
      const r = retrospects.get(id), p = r && boundPicture(node.cover, r.pictureRefs);
      if (p?.thumbnailOnly) throw new Error('原图已释放，仅保留缩略图和配方，无法设为定稿');
      if (!r || r.status !== 'active' || !p || !r.value.nodes.some(n => n.id === node.id && n.image_ids.includes(node.cover))) throw new Error('定稿样本已失效');
      await applyTreeChange({ id, before: r, after: { ...r, final: { nodeId: node.id, imageId: node.cover }, status: 'ended', endedAt: Date.now(), imageAttached: false, epoch: r.epoch + 1 } }, '已设为定稿并收藏', node.id, async () => {
        const source = drawing.original(p.id) ?? deps.editor?.record(p.id) ??
          (p.scope?.kind === 'chat' && p.scope.turn_id && p.scope.version_id && p.scope.asset_id ? await chat.favoriteRecord(p.scope.id, p.scope.turn_id, p.scope.version_id, p.scope.asset_id) : undefined);
        if (!source || recipeSignature(recipeOf(source.params)) !== recipeSignature(node.recipe)) throw new Error('定稿样本已失效');
        await drawing.ensureFavorite(source);
      }, retrospects.opened.value?.id !== id);
    },
    canManage: computed(() => favoritesReady.value && !favoriteBusy.value && !running.value && !writingDraft.value),
    newConversation,
    selectConversation,
    deleteConversation,
    editTurn,
    forkTurn,
    tray: computed(() => attachments.read(tray.value).map(attachmentView)),
    preparing,
    addFiles,
    addReference(path: string) {
      const source = referenceSource?.snapshot();
      if (!source) { deps.ui.toast('请先连接企划目录', 'warn'); return Promise.resolve(); }
      return addInputs([() => source.read(path, new AbortController().signal, ATTACHMENT_LIMITS.bytes)]);
    },
    pictureBinding(recordId: string, tag?: string): ImageTagBinding | undefined {
      const picture = [...pictureLibrary(), ...chatLibrary()].find(p => p.id === recordId);
      if (!picture) return;
      const label = tag && picture.aliases.includes(tag) ? tag : picture.label;
      return structuredClone(freezePictureRefs([picture], pictureScopes())[label]);
    },
    async prepareEditorImages(source: Blob, references: readonly import('../domain/edit-references.ts').ReferenceImage[]) {
      if(disposed||!favoritesReady.value||editorOpen.value)throw new Error('ASK 暂不可用');
      const owner=conversations.current,pool=owner.scope.attachments;owner.preparing++;preparing.value=owner.preparing;
      const work=importing.then(async()=>{
        if(pool.read(owner.tray).filter(a=>a.kind==='image').length+1+references.length>ATTACHMENT_LIMITS.images)throw new Error('ASK 每轮最多 4 张图片（含底图），请先精简参考图');
        const prepared=await Promise.all([prepareAttachment(new File([source],'编辑底图.png',{type:source.type})),...references.map(r=>prepareAttachment(new File([r.blob],`${r.label} · ${r.usage||r.name}`,{type:r.blob.type})))]);
        if(disposed||conversations.current!==owner)throw new Error('ASK 会话已切换，未添加图片');
        if(pool.read(owner.tray).filter(a=>a.kind==='image').length+prepared.length>ATTACHMENT_LIMITS.images)throw new Error('ASK 每轮最多 4 张图片，请先精简参考图');
        if([...scopes.values()].reduce((n,s)=>n+s.attachments.bytes,prepared.reduce((n,a)=>n+a.bytes,0))>ATTACHMENT_LIMITS.pageBytes)throw new Error('本页附件已超过 200 MB');
        const ids:string[]=[];
        try{for(const a of prepared)ids.push(pool.add(a).id);setTray([...owner.tray,...ids],owner);selectAnchor(ids[0]);inline.value=null;open.value=true;}
        catch(error){pool.release(ids);throw error;}
      });importing=work.catch(()=>{});
      try{await work;}finally{owner.preparing--;if(owner===conversations.current)preparing.value=owner.preparing;saveFavorite(owner);}
    },
    /** Atomically prepare a clean attachment + guide; the clean #a reference remains crop-able after source disposal. */
    async prepareAnnotations(source: Blob, preview: Blob, snapshot: AnnotationSnapshot, references: readonly import('../domain/edit-references.ts').ReferenceImage[] = []) {
      validateAnnotationSnapshot(snapshot);
      annotationPrompt(snapshot.regions,true,'',undefined,references);
      if (disposed || !favoritesReady.value || editorOpen.value) throw new Error("ASK 暂不可用");
      const owner = conversations.current, pool = owner.scope.attachments;
      owner.preparing++; preparing.value = owner.preparing;
      const work = importing.then(async () => {
        if (pool.read(owner.tray).filter(a=>a.kind==='image').length + 2 + references.length > ATTACHMENT_LIMITS.images) throw new Error('ASK 每轮最多 4 张图片；批注原图与定位图占两张，请先精简参考图');
        const refAttachments = await Promise.all(references.map(r=>prepareAttachment(new File([r.blob], r.name, {type:r.blob.type}))));
        const clean = await prepareAttachment(new File([source], "批注原图.png", { type: source.type }));
        const guide = await prepareAttachment(new File([preview], "编号定位图.png", { type: preview.type }));
        if (disposed || conversations.current !== owner) throw new Error("ASK 会话已切换，未添加批注");
        if (pool.read(owner.tray).filter(a => a.kind === "image").length + 2 + references.length > ATTACHMENT_LIMITS.images) throw new Error("ASK 每轮最多 4 张图片，请先精简参考图");
        if ([...scopes.values()].reduce((n, c) => n + c.attachments.bytes, clean.bytes + guide.bytes + refAttachments.reduce((n,a)=>n+a.bytes,0)) > ATTACHMENT_LIMITS.pageBytes) throw new Error("本页附件已超过 200 MB");
        const added: string[] = [];
        try {
          const original = pool.add(clean); added.push(original.id);
          const marked = pool.add(guide); added.push(marked.id);
          const frozen = structuredClone(snapshot);
          frozen.references = references.map(({blob:_blob,...r},i)=>{ const attachment=pool.add(refAttachments[i]); added.push(attachment.id); return {...r,image:attachment.id}; });
          pool.annotate(original.id, { snapshot: frozen, guideId: marked.id });
          setTray([...owner.tray, ...added], owner);
          selectAnchor(original.id); inline.value = null; open.value = true;
        } catch (error) { pool.release(added); throw error; }
      });
      importing = work.catch(() => {});
      try { await work; } finally { owner.preparing--; if (owner === conversations.current) preparing.value = owner.preparing; saveFavorite(owner); }
    },
    addPastedText(text: string) { return addFiles([new File([text], "粘贴的文本", { type: "text/plain" })], true); },
    removeAttachment,
    annotationSource(id: string) { const a=attachments.get(id); if(a?.kind!=='image'||!a.annotations)return null;const references=(a.annotations.snapshot.references??[]).map(r=>{const asset=r.image&&attachments.get(r.image);if(!asset||asset.kind!=='image')throw new Error('批注参考图已失效');return {...r,blob:asset.blob};});return {source:a.blob,snapshot:structuredClone(a.annotations.snapshot),references}; },
    updateAnnotationComment(id: string, key: string, comment: string) {
      if (!tray.value.includes(id) || running.value) return;
      const a=attachments.get(id); if (a?.kind !== 'image' || !a.annotations) return;
      const snapshot=structuredClone(a.annotations.snapshot);
      snapshot.regions=snapshot.regions.map(r=>r.key===key?{...r,comment}:r);validateRegions(snapshot.regions);
      attachments.annotate(id,{...a.annotations,snapshot});setTray([...tray.value]);saveFavorite();
    },
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
    canReviseDraft,
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
    contextTokens,
    estimate,
    setInput(text: string) {
      input.value = text;
      if (notice.value) notice.value = "";
    },
    /** For workspaces (A1 entries): open with an image already referenced. */
    show(options: { anchor?: string; question?: string } = {}) {
      if (editorOpen.value) return;
      inline.value = null;
      if (options.anchor !== undefined) selectAnchor(options.anchor);
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
      selectAnchor(null);
    },
    labelFor(id: string) { return ids.label(id); },
    favoriteLabelFor(id: string) { return ids.favorite(id); },
    pictureCandidates(prefix: string) {
      const library = withEditPictures(pictureLibrary(),chatLibrary());
      const attached = attachmentPictures(attachments.read([...new Set([...entryAttachments(entries.value),...tray.value])]), activeScope.id);
      const workspace=router.route.value.workspace;
      const priority = (p: import("./library.ts").Picture) => workspace==="edit" ? p.origins.some(o=>o.source==="edit"&&o.boardId===deps.editor?.session.id)?0:p.origins.some(o=>o.source==="edit")?1:p.origins.some(o=>o.source==="history")?2:3 : workspace==="chat" ? p.origins.some(o=>o.source==="chat") ? 0 : 1 : /^#e/.test(anchor.value ?? "") ? p.origins.some(o=>o.source==="edit") ? 0 : 1 : p.origins.some(o=>o.source==="history") ? 0 : 1;
      return [...library,...attached].sort((a,b)=>priority(a)-priority(b) || b.createdAt-a.createdAt).flatMap(p=>{
        const label = workspace==="edit" ? p.aliases.find(tag=>/^#e\d+[a-z]?$/.test(tag))??p.label : workspace==="chat" ? p.origins.find(o=>o.source==="chat")?.label ?? p.label : p.aliases.find(tag=>/^#e\d+\./.test(tag)) && /^#e/.test(anchor.value ?? "") ? p.aliases.find(tag=>/^#e\d+[a-z]?$/.test(tag)) ?? p.label : p.label;
        if (!label.toLowerCase().startsWith(prefix.toLowerCase()) && !p.aliases.some(tag=>tag.toLowerCase().startsWith(prefix.toLowerCase()))) return [];
        const matched = label.toLowerCase().startsWith(prefix.toLowerCase()) ? label : p.aliases.find(tag=>tag.toLowerCase().startsWith(prefix.toLowerCase()))!;
        const url = pictureUrl(p);
        return url ? [{label:matched,url,size:`${p.size.width}×${p.size.height}`}] : [];
      }).slice(0,7);
    },
    pictureInfo(label: string, refs?: PictureRefs) {
      const item = boundPicture(label, refs);
      const url = item && pictureUrl(item);
      return item && url ? { label, url, width:item.size.width,height:item.size.height, thumbnailOnly:!!item.thumbnailOnly,
        expired: !!refs?.[label] && refs[label].scope.kind==="page" && refs[label].scope.id!==pageScope,
        parametersUnavailable:!!refs?.[label] && refs[label].record_id!==item.id } : null;
    },
    async promoteEvolution(recordId: string, imageRecordId: string) {
      const change = retrospects.preparePromote(recordId, imageRecordId);
      await applyTreeChange(change, '立为阶段', change.after.cursor!.nodeId);
    },
    workshopChoices(target: string, imageRecordId: string) {
      return retrospects.workshopsFor(target, imageRecordId).filter(({ ticket }) => ticket.results.includes(imageRecordId));
    },
    async deliverEvolution(id: string, ticketId: string, recordId: string, mode: 'append' | 'next', kind: 'stage' | 'rejected' | 'final' = 'stage') {
      if (controller || writingDraft.value) throw new Error('请等待当前操作完成');
      const pictures = evolutionPictures(); retrospects.relabel(pictures);
      const p = pictures.find(p => p.id === recordId); if (!p || p.thumbnailOnly) throw new Error('交付原图已失效');
      const change = retrospects.prepareDelivery(id, ticketId, p, freezePictureRefs([p], pictureScopes()), mode, kind === 'rejected' ? 'rejected' : 'stage');
      if (kind === 'final') {
        const node = change.after.value.nodes.find(n => n.image_ids.some(tag => change.after.pictureRefs[tag]?.record_id === p.id))!;
        const imageId = node.image_ids.find(tag => change.after.pictureRefs[tag]?.record_id === p.id)!;
        await applyTreeChange({ ...change, after: { ...change.after, final: { nodeId: node.id, imageId }, status: 'ended', endedAt: Date.now(), imageAttached: false, epoch: change.after.epoch + 1 } }, '已设为最终定稿', node.id, async () => {
          const source = deps.editor?.record(p.id) ?? (p.scope?.kind === 'chat' && p.scope.turn_id && p.scope.version_id && p.scope.asset_id ? await chat.favoriteRecord(p.scope.id, p.scope.turn_id, p.scope.version_id, p.scope.asset_id) : undefined);
          if (!source) throw new Error('定稿原图已失效');
          await drawing.ensureFavorite(source);
        });
      } else if (change.after !== change.before) await applyTreeChange(change, kind === 'rejected' ? '已记入方向否定' : '已记入演进', change.after.workshops.find(t => t.id === ticketId)?.nodeId ?? '');
      else {
        const node = change.before.value.nodes.find(n => n.image_ids.includes(p.label));
        retrospects.open(id, node?.id);
        deps.ui.toast(`这张图已记入 ${node?.id ?? '演进'}，已打开对应阶段`);
      }
    },
    async cancelWorkshop(id: string, ticketId: string) { await applyTreeChange(retrospects.prepareCancel(id, ticketId), '已取消工坊挂靠'); },
    workshopAvailable(target: string) {
      void libraryRevision.value;
      const id = evolutionTargetId(target);
      return evolutionWorkspace(target) === 'edit' ? !!deps.editor?.askSnapshot(id) : chat.snapshot().conversations.some(c => c.id === id);
    },
    async openWorkshop(id: string, ticketId: string) {
      const ticket = retrospects.get(id)?.workshops.find(t => t.id === ticketId); if (!ticket) throw new Error('工坊关联已失效');
      if (!workshopPending(ticket)) throw new Error('当前没有待交付结果，请从演进节点查看历史图片');
      const target = evolutionTargetId(ticket.target);
      const resultId = pendingWorkshopResult(ticket);
      if (evolutionWorkspace(ticket.target) === 'edit') {
        if (!deps.editor?.askSnapshot(target)) throw new Error('原编辑板已关闭');
        if (resultId) { if (!deps.editor.locate(resultId, target)) throw new Error('当前待交付结果已不存在'); }
        else deps.editor.gotoAskBoard(target);
      } else {
        const c = chat.snapshot().conversations.find(c => c.id === target); if (!c) throw new Error('原对话已删除');
        if (resultId) {
          const scope = evolutionPictures().find(p => p.id === resultId)?.scope;
          if (scope?.kind !== 'chat' || !scope.turn_id || !scope.version_id || !scope.asset_id || !chat.locateImage(scope.id, scope.turn_id, scope.version_id, scope.asset_id)) throw new Error('当前待交付结果已不存在');
        } else chat.switchConversation(c);
        router.switchWorkspace('chat');
      }
      retrospects.close();
    },
    promoteTarget(imageRecordId: string) {
      return retrospects.records.value.find(r => r.status === 'active' && r.value.nodes.some(n => !isStaged(n) && n.image_ids.length > 1 && recipeWorkspace(n.recipe) === 'image' && n.image_ids.some(tag => r.pictureRefs[tag]?.record_id === imageRecordId)))?.id;
    },
    async editEvolution(recordId: string) {
      const r = retrospects.get(recordId);
      if (!r?.boardId || !drawing.board(r.boardId)) throw new Error('原 IMAGE 画板已不存在');
      await drawing.switchBoard(r.boardId); router.switchWorkspace('image'); open.value = false;
    },
    evolutionHistory(id: string) {
      void draftRevision.value;
      const undo = history.top?.origin?.retrospectId === id ? history.top : null;
      const redo = history.redo?.origin?.retrospectId === id ? history.redo : null;
      return { undo: undo?.id, redo: redo?.id, undoLabel: undo?.plan?.stagedLoad ? '撤销载入' : '撤销演进操作', redoLabel: redo?.plan?.stagedLoad ? '重做载入' : '重做演进操作', canUndo: !!undo?.plan && writer.canUndo(undo.plan, undo.receipt),
        canRedo: !!redo?.plan && !writer.conflict(redo.plan, 'before', redo.receipt) };
    },
    removeEvolutionBranch(id: string, nodeId: string) {
      if (controller || writingDraft.value) throw new Error('请等待当前操作完成');
      retrospects.removeStaged(id, nodeId); draftRevision.value++;
    },
    async loadEvolutionBranch(id: string, nodeId: string) {
      if (controller || writingDraft.value || disposed) throw new Error('请等待当前操作完成');
      const r = retrospects.get(id, currentEvolutionTarget()), node = r?.value.nodes.find(n => n.id === nodeId);
      if (!r || !node || !isStaged(node) || currentEvolutionTarget() !== r.boardId || router.route.value.workspace !== 'image') throw new Error('请先切回该预设所在的 IMAGE 画板');
      const base = readDraftState(r.boardId!), move = retrospects.prepareStagedMove(id, nodeId, r.boardId!);
      const plan = stagedLoadPlan(node.staged, base, move, `载入分支：${node.label}`);
      writingDraft.value = true;
      try {
        await chat.warm(); await services.references.ready();
        const operation = history.create({ title: plan.title, question: '', baseHash: stateHash(base), base, steps: [], synthetic: true }, '', 0,
          { kind: 'evolution', retrospectId: id, nodeId });
        await history.apply(operation, plan);
        if (retrospects.opened.value?.id !== id) deps.ui.toast(`已载入分支：${node.label}`, 'info', { label: '撤销', run: () => undoDraft(operation.id) });
      } finally { writingDraft.value = false; draftRevision.value++; }
    },
    async restoreRetrospect(node: RetrospectNode, refs: PictureRefs, reviewId?: string) {
      if (controller || writingDraft.value) throw new Error('请等待当前操作完成');
      const source = boundPicture(node.cover, refs);
      const matches = () => { const p = boundPicture(node.cover, refs); return !!p && node.image_ids.includes(node.cover) && refs[node.cover]?.record_id === p.id && p.id === source?.id && recipeSignature(recipeOf(p.params)) === recipeSignature(node.recipe); };
      if (!matches()) throw new Error('原记录已失效，无法恢复配方');
      const review = reviewId ? retrospects.get(reviewId) : undefined;
      const workspace = recipeWorkspace(node.recipe), nativeTarget = recipeTarget(source!);
      const target = workspace === 'image' ? review?.boardId ?? nativeTarget : nativeTarget;
      if (workspace === 'image' && (!target || !drawing.board(target))) throw new Error('原 IMAGE 画板已不存在');
      if (!target) throw new Error('来源工作区已失效');
      writingDraft.value = true;
      try {
        if (workspace === 'image') {
          await services.references.ready();
          const base = readDraftState(target), prepared = prepareRecipe(node.recipe, { form: base.form, nextCharacterId: base.nextCharacterId ?? 1, models: base.models, samplersFor: drawing.samplersFor });
          if (activeReferences(prepared.form.naiReferences).length && services.references.cachedCost(prepared.form.naiReferences, prepared.form.model) === undefined) throw new Error('配方参考资源已不可用');
          if (!matches()) throw new Error('原记录已失效');
          const changes = boardKeys.map(field => ({ field, before: structuredClone(base.form[field]), after: structuredClone(prepared.form[field]) }));
          const plan: DraftPlan = { title: '恢复 IMAGE 配方', workspace: 'image', conversationId: base.conversationId, boardId: target, steps: [], changes, aligned: true, fingerprint: canonical(changes),
            ...(review ? { treeChange: retrospects.prepareRestore(review.id, source!.id) } : {}) };
          const operation = history.create({ title: plan.title, question: '', baseHash: stateHash(base), base, steps: [], synthetic: true }, '', 0,
            review ? { kind: 'evolution', retrospectId: review.id, nodeId: node.id } : undefined);
          await history.apply(operation, plan);
          if (drawing.snapshot().activeBoardId !== target) await drawing.switchBoard(target);
        } else if (workspace === 'edit') {
          if (!deps.editor?.locate(source!.id, evolutionTargetId(target))) throw new Error('原编辑版本已不存在');
        } else {
          const scope = source!.scope;
          if (scope?.kind !== 'chat' || !scope.turn_id || !scope.version_id || !scope.asset_id || !chat.locateImage(scope.id, scope.turn_id, scope.version_id, scope.asset_id)) throw new Error('原对话版本已不存在');
        }
        router.switchWorkspace(workspace);
      } finally { writingDraft.value = false; draftRevision.value++; }
    },

    openRetrospectAsk(recordId: string, node: RetrospectNode, baseline: RetrospectNode | null, noteKeys: readonly string[]) {
      if (input.value.trim() || controller || writingDraft.value) { open.value = true; return; }
      const record = retrospects.get(recordId);
      if (!record) throw new Error('演进已失效');
      const liveLibrary = evolutionPictures();
      const resolve = (n: RetrospectNode) => {
        const p = boundPicture(n.cover, record.pictureRefs);
        return p && n.image_ids.includes(n.cover) && record.pictureRefs[n.cover]?.record_id === p.id ? liveLibrary.find(current => current.id === p.id) : undefined;
      };
      const source = isStaged(node) ? boundPicture(node.staged.base.tag, record.pictureRefs) : resolve(node);
      if (!source) { open.value = true; return; }
      const describe = (n: RetrospectNode) => `${n.id}（${isStaged(n) ? '待生成预设' : resolve(n)?.label ?? '原记录已失效'} · ${n.label}）`;
      const notes = [...new Set(noteKeys)].filter(key => record.notes[key]).map(key => `${key.startsWith('node:') ? key.slice(5) : key.slice(5).replace(':', ' → ')}：${record.notes[key]}`);
      selectAnchor(source.label);
      input.value = [`演进「${record.value.title}」`, `当前对照：${baseline ? `${describe(baseline)} → ` : ''}${describe(node)}`, ...(notes.length ? ['我的批注：', ...notes] : []), '请结合原始配方继续分析；涉及画板改动时，先提出草稿。'].join('\n');
      open.value = true;
    },
    locate(label: string, refs?: PictureRefs) {
      const item = boundPicture(label,refs);
      if (!item) { notice.value = `${label} 已失效或原图不可用`; return; }
      if (refs?.[label] && refs[label].record_id!==item.id) { notice.value="原图仍可预览，原记录参数已不可用"; return; }
      const editBoard = refs?.[label]?.scope.board_id ?? item.origins.find(o=>o.label===label && o.source==="edit")?.boardId;
      if (label.startsWith("#e") && item.origins.some(o=>o.source==="edit") && deps.editor?.locate(item.id,editBoard)) {
        if (window.matchMedia("(max-width: 860px)").matches) open.value=false;
        return;
      }
      if (item.scope?.kind==="chat") { if(item.scope.turn_id&&item.scope.version_id)chat.locateImage(item.scope.id,item.scope.turn_id,item.scope.version_id,item.scope.asset_id!);else {const c=chat.snapshot().conversations.find(c=>c.id===item.scope!.id);if(c)chat.switchConversation(c);} router.switchWorkspace("chat"); return; }
      const d = drawing.snapshot(), record = [...d.history,...d.favorites].find(r=>r.id===item.id);
      if (record) { router.switchWorkspace("image"); drawing.show(record,true); }
      if (window.matchMedia("(max-width: 860px)").matches) open.value=false;
    },
    pick(label: string, refs?: PictureRefs) {
      const item = boundPicture(label,refs);
      if (!item) return;
      if (refs?.[label] && refs[label].record_id!==item.id) { notice.value="原图仍可预览，原记录参数已不可用"; return; }
      // Use a current unambiguous alias only when it still binds this exact record.
      const current = [...pictureLibrary(),...chatLibrary()].find(p=>p.id===item.id);
      if (!current) return;
      const boardId = refs?.[label]?.scope.board_id;
      label = current.origins.find(o=>o.source==="edit" && (!boardId || o.boardId===boardId) && /^#e\d+\./.test(o.label))?.label ?? current.label;
      selectAnchor(label);
      if (!input.value.trim()) input.value=`请分析 ${label}`;
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
      retrospects.dispose();
      saveFavorite();
      void flushFavorites().catch(() => {});
      disposed = true;
      stopExternal(); externalEvents.clear();
      stopFavoriteSave();
      unregisterFavorites();
      clearTimeout(favoriteTimer);
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnLeave);
      namingQueue.length = 0;
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
      for (const owner of ['evolution', 'drafts', 'running', 'draft-undo']) drawing.retainHistory(owner, new Set());
      deps.editor?.retainRecords(new Set());
      for (const context of scopes.values()) context.attachments.dispose();
      scopes.clear();
      attachmentPreview.value = null;
      root = null;
    },
  };
}
export type Ask = ReturnType<typeof createAsk>;
