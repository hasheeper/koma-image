import type { ChatDraftSnapshot, ChatOptionState } from "../chat-context.ts";
import type { WorkspaceId } from "../../app/routes.ts";
import type { ChatSelection } from "../../domain/conversation.ts";
import type { DrawingBoard, DrawingForm } from "../../domain/drawing.ts";
import type { CatalogModel } from "../../domain/catalog.ts";

export type TextTarget = "image.prompt" | "image.negative" | "chat.composer" | `image.char.c${number}.${"prompt" | "negative"}`;
export type TextMode = "replace" | "before" | "after" | "append" | "rewrite";
export const restoreKeys = ["prompt", "negative_prompt", "model", "width", "height", "steps", "scale", "cfg", "sampler", "seed", "batchCount", "characters"] as const;
export type RestoreKey = typeof restoreKeys[number];
export interface TextStep {
  readonly kind: "prompt_patch";
  readonly target: TextTarget;
  readonly mode: TextMode;
  readonly anchor: string;
  readonly text: string;
}
export interface RestoreStep {
  readonly kind: "restore_partial";
  readonly source: string;
  readonly fields: readonly RestoreKey[];
  /** Values copied from the turn's immutable library, never supplied by the model. */
  readonly values: Readonly<Record<string, unknown>>;
}
export interface BranchStep {
  readonly kind: "chat_distill_branch";
  readonly source: string;
  readonly exclude: readonly string[];
  readonly text: string;
}
/** A serializable reference; the Blob is read from IMAGE or CHAT only when writing. */
export interface HandoffImage {
  readonly label: string;
  readonly source: "history" | "favorites" | "chat";
  /** Drawing record ID for `#h`/`#f`, CHAT asset ID for `#c`. */
  readonly ref: string;
}
export interface HandoffStep {
  readonly kind: "chat_handoff";
  readonly images: readonly HandoffImage[];
  readonly options: Readonly<Record<string, string>>;
  readonly text: string;
}
/** The current CHAT model as a handoff may use it; absent while the catalog is not ready. */
export interface ChatModelDraft {
  readonly id: string;
  readonly name: string;
  readonly maxImages: number;
  readonly writable: Readonly<Record<string, ChatOptionState>>;
}
export interface CharacterStep {
  readonly kind: "character_edit";
  readonly op: "add" | "remove" | "reorder" | "set_enabled" | "set_position" | "set_placement";
  readonly id?: string;
  readonly ids?: readonly string[];
  readonly prompt?: string;
  readonly negative?: string;
  readonly on?: boolean;
  readonly cell?: string;
  readonly x?: number;
  readonly y?: number;
  readonly placement?: "auto" | "manual";
}
export interface DraftState {
  readonly boardId?: string;
  readonly boardName?: string;
  readonly boardPresent?: boolean;
  readonly nextCharacterId?: number;
  readonly chat?: ChatDraftSnapshot;
  /** Where the question was asked; absent in drafts saved before handoffs. */
  readonly workspace?: WorkspaceId;
  readonly chatModel?: ChatModelDraft | null;
  readonly form: Readonly<DrawingForm>;
  readonly composer: string;
  readonly conversationId: string;
  readonly models: CatalogModel[];
  readonly samplers: string[];
  readonly samplersByModel?: Readonly<Record<string, readonly string[]>>;
}
export interface Draft {
  readonly title: string;
  /** Present only when this proposal targets a named new IMAGE board. */
  readonly newBoardName?: string;
  readonly baseHash: string;
  /** Original request, reused by the explicit “重新提议” action. */
  readonly question: string;
  readonly steps: readonly (TextStep | RestoreStep | BranchStep | CharacterStep | HandoffStep)[];
  readonly base: DraftState;
}
export type Field = "composer" | keyof DrawingForm;
export interface Change { readonly field: Field; readonly before: DrawingForm[keyof DrawingForm]; readonly after: DrawingForm[keyof DrawingForm] }
export interface CheckedStep {
  readonly characterId?: string;
  readonly characterLabel?: string;
  readonly id: string;
  readonly label: string;
  readonly kind: "patch" | "rewrite" | "parameter" | "branch" | "handoff";
  readonly enabled: boolean;
  readonly locked?: boolean;
  readonly issue: string;
  readonly aligned: boolean;
  readonly before: string;
  readonly after: string;
  readonly displayBefore?: string;
  readonly displayAfter?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}
export interface DraftPlan {
  readonly boardId?: string;
  readonly boardName?: string;
  readonly newBoardName?: string;
  readonly createdBoard?: DrawingBoard;
  readonly branch?: { readonly before: ChatSelection; readonly after: ChatSelection; readonly key: string };
  /** Enabled handoff content; writing always opens a new CHAT conversation. */
  readonly handoff?: { readonly model: string; readonly options: Readonly<Record<string, string>>; readonly text: string; readonly images: readonly HandoffImage[] };
  readonly title: string;
  readonly workspace: "image" | "chat";
  readonly conversationId: string;
  readonly steps: readonly CheckedStep[];
  readonly changes: readonly Change[];
  readonly aligned: boolean;
  readonly fingerprint: string;
}
export interface ValidateOptions {
  readonly off: ReadonlySet<string>;
  /** Live availability of a handoff image; unknown counts as available. */
  readonly has?: (image: HandoffImage) => boolean;
}
