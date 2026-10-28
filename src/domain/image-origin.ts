import type { Fields, ConversationRecord, ConversationTurn, ConversationVersion } from "../storage/records.ts";

export type CreativeWorkspace = "image" | "chat" | "edit";
export type LineId = `${CreativeWorkspace}:${string}`;
const strings = ["boardId", "boardName", "boardColor", "chatConversationId", "chatConversationTitle", "chatTurnId", "chatVersionId", "chatAssetId", "editBoardId", "editBoardName", "editId", "editParent", "editSource", "editedAt", "editOriginId", "editVariant"] as const;

/** Only stable, non-secret provenance. Display tags are never identities. */
export function imageOrigin(params: Readonly<Record<string, unknown>>): Fields {
  const out: Fields = {};
  for (const key of strings) if (typeof params[key] === "string") out[key] = params[key];
  if (params.sourceWorkspace === "image" || params.sourceWorkspace === "chat") out.sourceWorkspace = params.sourceWorkspace;
  if (Number.isSafeInteger(params.chatTurnNumber) && Number(params.chatTurnNumber) > 0) out.chatTurnNumber = Number(params.chatTurnNumber);
  if (Number.isSafeInteger(params.editBoardSeq) && Number(params.editBoardSeq)>0) out.editBoardSeq=Number(params.editBoardSeq);
  if (Number.isSafeInteger(params.editVersion) && Number(params.editVersion) > 0) out.editVersion = Number(params.editVersion);
  return out;
}
export function imageLine(params: Readonly<Record<string, unknown>>): LineId | null {
  if (typeof params.chatConversationId === "string" && params.chatConversationId) return `chat:${params.chatConversationId}`;
  if (typeof params.boardId === "string" && params.boardId) return `image:${params.boardId}`;
  return null;
}
export const chatImageId = (conversationId: string, turnId: string, versionId: string, assetId: string) =>
  `chat:${conversationId}:${turnId}:${versionId}:${assetId}`;

export function chatImageOrigin(conversation: ConversationRecord, turn: ConversationTurn, version: ConversationVersion, assetId: string): Fields {
  return { sourceWorkspace: "chat", chatConversationId: conversation.id, chatConversationTitle: conversation.title,
    chatTurnId: turn.id, chatVersionId: version.id, chatAssetId: assetId, chatTurnNumber: conversation.turns.indexOf(turn) + 1 };
}

/** CHAT text/options are not a drawing recipe. Edited NAI results still have their own recipe. */
export function canReuseDrawingParams(params: Readonly<Record<string, unknown>>): boolean {
  const recipe = ["manual-edit", "director"].includes(String(params.tool)) && params.sourceRecipe && typeof params.sourceRecipe === "object" && !Array.isArray(params.sourceRecipe)
    ? params.sourceRecipe as Record<string, unknown> : params;
  return recipe.tool !== "chat";
}
