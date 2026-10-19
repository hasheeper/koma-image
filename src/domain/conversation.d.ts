import type {
  ConversationRecord as C,
  ConversationTurn as T,
  ConversationVersion as V,
  Fields,
  MessageBlock,
} from "../storage/records";
export function newConversation(settings?: Fields): C;
export function isBlank(c: C): boolean;
export function renameConversation(c: C, title: string): boolean;
export function sortConversations(c: C[]): C[];
export function duplicateConversation(c: C): C;
export function retainImage(c: C, id: string): void;
export function attachUpload(c: C, id: string): void;
export function forgetImage(c: C, id: string): void;
export function reorderRefs(c: C, ids: string[]): void;
export function conversationImages(
  c: C,
): { assetId: string; turnId: string | null; result: boolean }[];
export function assetRefs(c: C[]): Set<string>;
export function reviveConversation(c: C, hasAsset?: (id: string) => boolean): C;
export function ancestry(c: C, headId?: string | null): T[];
export function branchTurns(c: C): T[];
export function contextSnapshot(
  c: C,
  prompt?: string,
  limit?: number,
): T["snapshot"];
export function beginTurn(
  c: C,
  snapshot: T["snapshot"],
  prompt: string,
  settings: Fields,
): { turn: T; version: V };
export function beginVersion(t: T): V;
export function completeVersion(
  c: C,
  t: T,
  v: V,
  blocks: MessageBlock[],
  quote: Fields | null,
  revision: number,
): boolean;
export function selectSource(c: C, t: T, id: string): void;
