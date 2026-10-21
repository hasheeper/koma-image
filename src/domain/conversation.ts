import type {
  ConversationRecord,
  ConversationTurn,
  ConversationVersion,
  Fields,
  MessageBlock,
} from "../storage/records.ts";

const id = (): string => crypto.randomUUID();
export function newConversation(settings: Fields = {}): ConversationRecord {
  return {
    id: id(),
    title: "新对话",
    turns: [],
    headId: null,
    mainId: null,
    attachments: [],
    keepIds: [],
    prompt: "",
    skipTurnIds: [],
    baseFollows: true,
    selectionRevision: 0,
    pinned: false,
    renamed: false,
    updatedAt: Date.now(),
    settings: structuredClone(settings),
  };
}
/* Nothing sent, nothing typed, nothing staged: a second "new conversation"
   would only be a duplicate of this one. */
export function isBlank(conversation: ConversationRecord): boolean {
  return (
    !conversation.turns.length &&
    !conversation.prompt.trim() &&
    !conversation.attachments.length
  );
}
/* A name the user chose outranks the one taken from the first prompt. */
export function renameConversation(conversation: ConversationRecord, title: string): boolean {
  const name = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (!name) return false;
  conversation.title = name;
  conversation.renamed = true;
  return true;
}
/* Pinned first, then most recently used. Array#sort is stable, so ties keep
   their current order instead of shuffling on every render. */
export function sortConversations(conversations: ConversationRecord[]): ConversationRecord[] {
  return [...conversations].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}
/* Which list section a time falls in, counted in local calendar days: "this
   week" means the five days before yesterday, not the last 168 hours. */
export type ConversationPeriod = "today" | "yesterday" | "week" | "earlier";
export function conversationPeriod(at: number, now = Date.now()): ConversationPeriod {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (at >= day.getTime()) return "today";
  day.setDate(day.getDate() - 1);
  if (at >= day.getTime()) return "yesterday";
  day.setDate(day.getDate() - 5);
  return at >= day.getTime() ? "week" : "earlier";
}
/* The title is only the first prompt, so later prompts are searched too. */
export function matchesQuery(conversation: ConversationRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    [conversation.title, ...conversation.turns.map((t) => t.prompt)].some((s) =>
      s.toLowerCase().includes(q),
    )
  );
}
/* Turn and version ids are fresh because the page caches rendered turns by id
   across every conversation; shared ids would let the copy drive the
   original's DOM. Asset ids stay shared — images are content-addressed and
   collected by reference. The draft is not copied: a fork starts a new reply. */
export function duplicateConversation(conversation: ConversationRecord): ConversationRecord {
  const source = structuredClone({
    ...conversation,
    prompt: "",
    attachments: [],
  });
  const ids = new Map<string | null, string>(source.turns.map((t) => [t.id, id()]));
  for (const turn of source.turns) {
    // Every source turn's original ID was inserted above; only references may be missing.
    turn.id = ids.get(turn.id)!;
    turn.parentId = ids.get(turn.parentId) ?? null;
    turn.snapshot.parentId = ids.get(turn.snapshot.parentId) ?? null;
    turn.snapshot.turnIds = turn.snapshot.turnIds.map((t) => ids.get(t) ?? t);
    for (const version of turn.versions) {
      version.id = id();
      if (version.status === "pending")
        Object.assign(version, {
          status: "cancelled",
          error: "复制时仍在生成，此版本未复制结果。",
        });
    }
  }
  return {
    ...source,
    id: id(),
    title: `${conversation.title}（副本）`.slice(0, 60),
    renamed: true,
    headId: ids.get(conversation.headId) ?? null,
    skipTurnIds: source.skipTurnIds.map((t) => ids.get(t)).filter((id): id is string => Boolean(id)),
    pinned: false,
    updatedAt: Date.now(),
  };
}
/* keepIds is the set the user wants to keep travelling with the conversation,
   whatever its provenance — an upload, or a result they promoted and then
   replaced. Membership is a decision, not a fact about the image, so it lives
   here while `origin` (upload vs result) stays on the asset itself. */
export function retainImage(conversation: ConversationRecord, assetId: string): void {
  if (!assetId) return;
  if (!conversation.keepIds.includes(assetId))
    conversation.keepIds.push(assetId);
}
export function attachUpload(conversation: ConversationRecord, assetId: string): void {
  retainImage(conversation, assetId);
  if (!conversation.attachments.includes(assetId))
    conversation.attachments.push(assetId);
}
export function forgetImage(conversation: ConversationRecord, assetId: string): void {
  // A held base is held to this picture; once it leaves, nothing is held.
  if (conversation.mainId === assetId)
    Object.assign(conversation, { mainId: null, baseFollows: true });
  conversation.attachments = conversation.attachments.filter(
    (x) => x !== assetId,
  );
  // Dropping it from keepIds is what makes a removal stick: otherwise the next
  // completed turn would helpfully "restore" the image the user just cut.
  conversation.keepIds = conversation.keepIds.filter((x) => x !== assetId);
}
export function reorderRefs(conversation: ConversationRecord, order: string[]): void {
  const known = new Set(order);
  conversation.keepIds = [
    ...order,
    ...conversation.keepIds.filter((x) => !known.has(x)),
  ];
  conversation.selectionRevision += 1;
}
/* Every picture the conversation has touched — what each turn sent and what
   every version of it returned, on every branch — newest first, so the panel
   can offer back anything that has left the context. `turnId` is where it
   first appeared; `result` says whether a model made it there. */
export interface ConversationImage {
  assetId: string;
  turnId: string | null;
  result: boolean;
}
export function conversationImages(conversation: ConversationRecord): ConversationImage[] {
  const seen = new Map<string, ConversationImage>();
  const note = (assetId: string | null, turnId: string | null, result: boolean) => {
    if (assetId && !seen.has(assetId))
      seen.set(assetId, { assetId, turnId, result });
  };
  for (const turn of conversation.turns) {
    turn.snapshot.imageIds.forEach((assetId) => note(assetId, turn.id, false));
    for (const version of turn.versions)
      for (const block of version.blocks)
        if (block.type === "image") note(block.assetId, turn.id, true);
  }
  [
    conversation.mainId,
    ...conversation.keepIds,
    ...conversation.attachments,
  ].forEach((assetId) => note(assetId, null, false));
  return [...seen.values()].reverse();
}
/* The picture a conversation is known by in the list: the newest result on
   the branch on screen, else the newest picture it holds at all. A retry
   that is pending or failed keeps the turn's earlier result in place. */
export function coverImage(conversation: ConversationRecord): string | null {
  for (const turn of ancestry(conversation).reverse())
    for (const version of [
      turn.versions[turn.selectedVersion],
      ...[...turn.versions].reverse(),
    ]) {
      const block = version?.blocks.find((b) => b.type === "image");
      if (block?.type === "image") return block.assetId;
    }
  return conversationImages(conversation)[0]?.assetId ?? null;
}
/* Every image a conversation still needs: what it will send next, and what
   each turn sent and returned. Nothing else needs to be kept. */
export function assetRefs(conversations: ConversationRecord[]): Set<string> {
  const used = new Set<string>();
  for (const c of conversations) {
    [c.mainId, ...c.attachments, ...c.keepIds]
      .filter((id): id is string => Boolean(id))
      .forEach((id) => used.add(id));
    for (const t of c.turns) {
      t.snapshot.imageIds.forEach((id) => used.add(id));
      t.versions
        .flatMap((v) => v.blocks)
        .filter((b) => b.type === "image")
        .forEach((b) => used.add(b.assetId));
    }
  }
  return used;
}
/* A conversation as it comes back from storage. A generation that was still
   running when the page closed will never report back, so it is marked
   interrupted instead of waiting forever. Fields added after the record was
   written get their defaults, and an image that is missing from storage is
   dropped from the next turn's context. */
export function reviveConversation(
  record: ConversationRecord,
  hasAsset: (id: string) => boolean = () => true,
): ConversationRecord {
  const conversation = { ...newConversation(record.settings), ...record };
  for (const turn of conversation.turns)
    for (const version of turn.versions) {
      if (version.status === "pending")
        Object.assign(version, {
          status: "cancelled",
          error: "页面关闭时仍在生成，结果没有保存；上游可能仍在处理或计费。",
        });
    }
  for (const assetId of [
    conversation.mainId,
    ...conversation.keepIds,
    ...conversation.attachments,
  ]) {
    if (assetId && !hasAsset(assetId)) forgetImage(conversation, assetId);
  }
  return conversation;
}
export function ancestry(
  conversation: ConversationRecord,
  headId: string | null = conversation.headId,
): ConversationTurn[] {
  const byId = new Map(conversation.turns.map((t) => [t.id, t]));
  const chain: ConversationTurn[] = [];
  const seen = new Set<string>();
  while (headId) {
    if (seen.has(headId)) throw new Error("会话分支无效");
    seen.add(headId);
    const turn = byId.get(headId);
    if (!turn) break;
    chain.unshift(turn);
    headId = turn.parentId;
  }
  return chain;
}
/* Slot 0 is not just "the first image": the request sends it as init_image, the
   picture being edited, while the rest ride along as additional_images. Keeping
   base and refs separate lets the UI say which is which instead of implying it
   through array order. `limit` mirrors the model's ceiling so the panel can show
   what would be dropped rather than failing at send time. */
/* The turns whose text can ride along: done turns on the current branch. */
export function branchTurns(conversation: ConversationRecord): ConversationTurn[] {
  return ancestry(conversation).filter(
    (t) => t.versions[t.selectedVersion]?.status === "done",
  );
}
export function contextSnapshot(
  conversation: ConversationRecord,
  prompt = conversation.prompt,
  limit = Infinity,
): ConversationTurn["snapshot"] {
  const skip = new Set(conversation.skipTurnIds);
  const turns = branchTurns(conversation).filter((t) => !skip.has(t.id));
  const base = conversation.mainId || null;
  // The user's own uploads stay in context across turns: a result image should
  // not silently evict the original everything is being edited from.
  const refs = [
    ...new Set(
      [...conversation.keepIds, ...conversation.attachments].filter(
        (assetId) => assetId && assetId !== base,
      ),
    ),
  ];
  const wanted = [...(base ? [base] : []), ...refs];
  const imageIds = wanted.slice(0, Math.max(0, limit));
  const dropped = wanted.slice(imageIds.length);
  const text = turns.length
    ? [
        "此前的绘图要求（按顺序）：",
        ...turns.map((t, i) => `${i + 1}. ${t.prompt}`),
        "",
        "本轮要求（以本轮修改为准）：",
        prompt,
      ].join("\n")
    : prompt;
  return {
    text,
    imageIds,
    base: imageIds[0] ?? null,
    refs: imageIds.slice(1),
    dropped,
    turnIds: turns.map((t) => t.id),
    parentId: conversation.headId,
  };
}
export function beginTurn(
  conversation: ConversationRecord,
  snapshot: ConversationTurn["snapshot"],
  prompt: string,
  settings: Fields,
): { turn: ConversationTurn; version: ConversationVersion } {
  const turn: ConversationTurn = {
    id: id(),
    parentId: snapshot.parentId,
    prompt,
    settings: structuredClone(settings),
    snapshot: structuredClone(snapshot),
    selectedVersion: 0,
    versions: [],
  };
  conversation.turns.push(turn);
  // Sending spends the uploads: from here on the turn's reference strip owns
  // them, so failure or cancellation must not put them back in the composer.
  const sent = new Set(snapshot.imageIds);
  conversation.attachments = conversation.attachments.filter(
    (assetId) => !sent.has(assetId),
  );
  conversation.updatedAt = Date.now();
  if (conversation.turns.length === 1 && !conversation.renamed)
    conversation.title = prompt.replace(/\s+/g, " ").slice(0, 36);
  return { turn, version: beginVersion(turn) };
}
export function beginVersion(turn: ConversationTurn): ConversationVersion {
  if (turn.versions.some((v) => v.status === "pending"))
    throw new Error("该轮仍在生成");
  const version: ConversationVersion = {
    id: id(),
    status: "pending",
    blocks: [],
    error: "",
    quote: null,
  };
  turn.versions.push(version);
  turn.selectedVersion = turn.versions.length - 1;
  return version;
}
export function completeVersion(
  conversation: ConversationRecord,
  turn: ConversationTurn,
  version: ConversationVersion,
  blocks: MessageBlock[],
  quote: Fields | null,
  selectionRevision: number,
): boolean {
  if (version.status !== "pending") return false;
  const image = blocks.find((b) => b.type === "image");
  if (!image) throw new Error("结果没有图片");
  Object.assign(version, { status: "done", blocks, quote });
  if (conversation.selectionRevision === selectionRevision) {
    conversation.headId = turn.id;
    // A held base stays put while the text moves on; with nothing to hold,
    // the result becomes the base as usual.
    if (conversation.baseFollows || !conversation.mainId)
      conversation.mainId = image.assetId;
  }
  return true;
}
export function selectSource(conversation: ConversationRecord, turn: ConversationTurn, assetId: string): void {
  conversation.headId = turn.id;
  conversation.mainId = assetId;
  conversation.selectionRevision += 1;
}

export type ChatSelection = Pick<ConversationRecord, "headId" | "mainId" | "skipTurnIds" | "baseFollows" | "prompt">;
export function chatSelection(c: ConversationRecord): ChatSelection {
  return { headId: c.headId, mainId: c.mainId, skipTurnIds: [...c.skipTurnIds], baseFollows: c.baseFollows, prompt: c.prompt };
}
/** Includes context/version changes and generation completions, excludes cosmetic titles. */
export function chatDraftKey(c: ConversationRecord): string {
  return JSON.stringify([c.id, chatSelection(c), c.selectionRevision, c.keepIds, c.attachments, c.settings,
    c.turns.map((t) => [t.id, t.parentId, t.prompt, t.selectedVersion, t.versions.map((v) => [v.id, v.status, v.blocks.filter((b) => b.type === "image").map((b) => b.assetId)])])]);
}
