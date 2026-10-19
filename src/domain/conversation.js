const id = () => crypto.randomUUID();
export function newConversation(settings = {}) {
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
export function isBlank(conversation) {
  return (
    !conversation.turns.length &&
    !conversation.prompt.trim() &&
    !conversation.attachments.length
  );
}
/* A name the user chose outranks the one taken from the first prompt. */
export function renameConversation(conversation, title) {
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
export function sortConversations(conversations) {
  return [...conversations].sort(
    (a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt,
  );
}
/* Turn and version ids are fresh because the page caches rendered turns by id
   across every conversation; shared ids would let the copy drive the
   original's DOM. Asset ids stay shared — images are content-addressed and
   collected by reference. The draft is not copied: a fork starts a new reply. */
export function duplicateConversation(conversation) {
  const source = structuredClone({
    ...conversation,
    prompt: "",
    attachments: [],
  });
  const ids = new Map(source.turns.map((t) => [t.id, id()]));
  for (const turn of source.turns) {
    turn.id = ids.get(turn.id);
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
    skipTurnIds: source.skipTurnIds.map((t) => ids.get(t)).filter(Boolean),
    pinned: false,
    updatedAt: Date.now(),
  };
}
/* keepIds is the set the user wants to keep travelling with the conversation,
   whatever its provenance — an upload, or a result they promoted and then
   replaced. Membership is a decision, not a fact about the image, so it lives
   here while `origin` (upload vs result) stays on the asset itself. */
export function retainImage(conversation, assetId) {
  if (!assetId) return;
  if (!conversation.keepIds.includes(assetId))
    conversation.keepIds.push(assetId);
}
export function attachUpload(conversation, assetId) {
  retainImage(conversation, assetId);
  if (!conversation.attachments.includes(assetId))
    conversation.attachments.push(assetId);
}
export function forgetImage(conversation, assetId) {
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
export function reorderRefs(conversation, order) {
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
export function conversationImages(conversation) {
  const seen = new Map();
  const note = (assetId, turnId, result) => {
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
/* Every image a conversation still needs: what it will send next, and what
   each turn sent and returned. Nothing else needs to be kept. */
export function assetRefs(conversations) {
  const used = new Set();
  for (const c of conversations) {
    [c.mainId, ...c.attachments, ...c.keepIds]
      .filter(Boolean)
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
export function reviveConversation(record, hasAsset = () => true) {
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
export function ancestry(conversation, headId = conversation.headId) {
  const byId = new Map(conversation.turns.map((t) => [t.id, t]));
  const chain = [],
    seen = new Set();
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
export function branchTurns(conversation) {
  return ancestry(conversation).filter(
    (t) => t.versions[t.selectedVersion]?.status === "done",
  );
}
export function contextSnapshot(
  conversation,
  prompt = conversation.prompt,
  limit = Infinity,
) {
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
export function beginTurn(conversation, snapshot, prompt, settings) {
  const turn = {
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
export function beginVersion(turn) {
  if (turn.versions.some((v) => v.status === "pending"))
    throw new Error("该轮仍在生成");
  const version = {
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
  conversation,
  turn,
  version,
  blocks,
  quote,
  selectionRevision,
) {
  if (version.status !== "pending") return false;
  if (!blocks.some((b) => b.type === "image")) throw new Error("结果没有图片");
  Object.assign(version, { status: "done", blocks, quote });
  if (conversation.selectionRevision === selectionRevision) {
    conversation.headId = turn.id;
    // A held base stays put while the text moves on; with nothing to hold,
    // the result becomes the base as usual.
    if (conversation.baseFollows || !conversation.mainId)
      conversation.mainId = blocks.find((b) => b.type === "image").assetId;
  }
  return true;
}
export function selectSource(conversation, turn, assetId) {
  conversation.headId = turn.id;
  conversation.mainId = assetId;
  conversation.selectionRevision += 1;
}
