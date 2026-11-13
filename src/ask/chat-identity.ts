/** Page-local qualified CHAT codes. Allocation follows immutable records, never branch positions. */
export function createChatPictureIds() {
  const conversations = new Map<string, { number: number; turns: Map<string, { number: number; versions: Map<string, { number: number; images: Map<string, number> }> }> }>();
  const uploads = new Map<string, Map<string, number>>();
  const conversation = (id: string) => {
    let c = conversations.get(id);
    if (!c) { c = { number: conversations.size + 1, turns: new Map() }; conversations.set(id, c); }
    return c;
  };
  return {
    input(conversationId: string, assetId: string) {
      const c = conversation(conversationId);
      let refs = uploads.get(conversationId);
      if (!refs) { refs = new Map(); uploads.set(conversationId, refs); }
      if (!refs.has(assetId)) refs.set(assetId, refs.size + 1);
      return `#c${c.number}:r${refs.get(assetId)}`;
    },
    label(conversationId: string, turnId: string, versionId: string, assetId: string) {
      const c = conversation(conversationId);
      let t = c.turns.get(turnId);
      if (!t) { t = { number: c.turns.size + 1, versions: new Map() }; c.turns.set(turnId, t); }
      let v = t.versions.get(versionId);
      if (!v) { v = { number: t.versions.size + 1, images: new Map() }; t.versions.set(versionId, v); }
      if (!v.images.has(assetId)) v.images.set(assetId, v.images.size);
      const index = v.images.get(assetId)!;
      return `#c${c.number}:${t.number}.${v.number}${index ? index < 26 ? String.fromCharCode(97 + index) : `.${index + 1}` : ''}`;
    },
  };
}
export type ChatPictureIds = ReturnType<typeof createChatPictureIds>;
