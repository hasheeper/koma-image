import type { ChatDraftSnapshot } from "../chat-context.ts";
import type { ChatSelection } from "../../domain/conversation.ts";
import type { DrawingForm } from "../../domain/drawing.ts";
import type { CatalogModel } from "../../domain/catalog.ts";
import type { CategoryOf } from "../digest/segments.ts";

export type TextTarget = "image.prompt" | "image.negative" | "chat.composer" | `image.char.${number}.${"prompt" | "negative"}`;
export type TextMode = "replace" | "before" | "after" | "append" | "rewrite";
export const restoreKeys = ["prompt", "negative_prompt", "model", "width", "height", "steps", "scale", "cfg", "sampler", "seed", "batchCount"] as const;
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
export interface DraftState {
  readonly chat?: ChatDraftSnapshot;
  readonly form: Readonly<DrawingForm>;
  readonly composer: string;
  readonly conversationId: string;
  readonly models: CatalogModel[];
  readonly samplers: string[];
  readonly samplersByModel?: Readonly<Record<string, readonly string[]>>;
}
export interface Draft {
  readonly title: string;
  readonly baseHash: string;
  readonly question: string;
  readonly steps: readonly (TextStep | RestoreStep | BranchStep)[];
  readonly base: DraftState;
}
export type Field = "composer" | keyof DrawingForm;
export interface Change { readonly field: Field; readonly before: string | number | boolean; readonly after: string | number | boolean }
export interface CheckedStep {
  readonly id: string;
  readonly label: string;
  readonly kind: "patch" | "rewrite" | "parameter" | "branch";
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
  readonly branch?: { readonly before: ChatSelection; readonly after: ChatSelection; readonly key: string };
  readonly title: string;
  readonly workspace: "image" | "chat";
  readonly conversationId: string;
  readonly steps: readonly CheckedStep[];
  readonly changes: readonly Change[];
  readonly aligned: boolean;
  readonly fingerprint: string;
}
export interface ValidateOptions { readonly off: ReadonlySet<string>; readonly category?: CategoryOf }
