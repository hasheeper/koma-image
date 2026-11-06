import type { AnnotationSnapshot } from "../domain/region-annotation.ts";
import type { ImageLineage } from "../domain/image-identity.ts";
import type { Json } from "../domain/value.ts";
export type Fields = Record<string, Json>;
export interface FavoriteRecord {
  entity_key?: string;
  favSeq?: number;
  lineage?: ImageLineage;
  id: string;
  createdAt: number;
  favoritedAt: number;
  blob: Blob;
  thumbBlob: Blob | null;
  params: Fields;
  size: { width: number; height: number };
  quote?: Fields | null;
  ms?: number;
}
export type MessageBlock =
  | { type: "image"; assetId: string }
  | { type: "text"; text: string };
export interface ChatAnnotation {
  snapshot: AnnotationSnapshot;
  sourceAssetId: string;
  inputAssetId: string;
  guideAssetId: string;
  text: string;
  singleImage?: boolean;
}
export interface ConversationVersion {
  composites?: Record<string, string>;
  via?: { connection: string; upstreamId: string };
  completedAt?: number;
  id: string;
  status: "pending" | "done" | "error" | "cancelled";
  blocks: MessageBlock[];
  error?: string;
  quote?: Fields | null;
}
export interface ConversationTurn {
  id: string;
  parentId: string | null;
  prompt: string;
  settings: Fields;
  snapshot: {
    annotation?: ChatAnnotation;
    text: string;
    imageIds: string[];
    turnIds: string[];
    parentId: string | null;
    base: string | null;
    refs: string[];
    dropped: string[];
  };
  selectedVersion: number;
  versions: ConversationVersion[];
}
export interface ConversationRecord {
  pendingAnnotation?: ChatAnnotation;
  id: string;
  title: string;
  prompt: string;
  settings: Fields;
  turns: ConversationTurn[];
  headId: string | null;
  mainId: string | null;
  attachments: string[];
  keepIds: string[];
  skipTurnIds: string[];
  baseFollows: boolean;
  selectionRevision: number;
  pinned: boolean;
  renamed: boolean;
  updatedAt: number;
}
export interface AssetRecord {
  lineage?: import("../domain/image-identity.ts").ImageLineage;
  entity_key?: string;
  id: string;
  name: string;
  origin: "upload" | "result" | "image";
  width: number;
  height: number;
  blob: Blob;
}
export interface HandoffRecord {
  blob: Blob;
  name: string;
  at: number;
}
export const HANDOFF_MAX_AGE = 30 * 60 * 1000;
export function assetRefs(conversations: ConversationRecord[]): Set<string> {
  const refs = new Set<string>();
  const annotation = (a?: ChatAnnotation) => { if(a) for(const id of [a.sourceAssetId,a.inputAssetId,a.guideAssetId]) refs.add(id); };
  for (const c of conversations) {
    annotation(c.pendingAnnotation);
    for (const id of [c.mainId, ...c.attachments, ...c.keepIds])
      if (id) refs.add(id);
    for (const t of c.turns) {
      annotation(t.snapshot.annotation);
      for (const id of t.snapshot.imageIds) refs.add(id);
      for (const v of t.versions) {
        for (const id of Object.values(v.composites ?? {})) refs.add(id);
        for (const block of v.blocks)
          if (block.type === "image") refs.add(block.assetId);
      }
    }
  }
  return refs;
}
