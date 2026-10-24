import { boardKeys } from "../../domain/drawing.ts";
import { characterCapability, characterSummary } from "../../domain/characters.ts";
import type { Character, Placement } from "../../domain/characters.ts";
import { canonical } from "../canonical.ts";
import { finite, object } from "../../domain/value.ts";
import type { Ids } from "../ids.ts";
import { historyIndex } from "./history.ts";
import type { Fields } from "../../storage/records.ts";

/** What the digest reads from a history or favorite record; never the blobs. */
export interface DigestImage {
  readonly id: string;
  readonly createdAt: number;
  readonly favoritedAt?: number;
  readonly params: Readonly<Fields>;
  readonly size: { readonly width: number; readonly height: number };
}
export interface DigestForm {
  readonly characters?: readonly Character[];
  readonly placement?: Placement;
  readonly prompt: string;
  readonly negative: string;
  readonly model: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly scale: number;
  readonly cfg: number;
  readonly sampler: string;
  readonly seed: string;
  readonly batchCount: number;
}
export interface DigestChat {
  readonly title: string;
  readonly turns: number;
  readonly head: string | null;
  readonly composer: string;
  readonly context: { readonly turns: number; readonly images: number; readonly dropped: number };
  readonly busy: string | null;
  readonly model: string | null;
}
export interface DigestInput {
  readonly askTurnId?: string;
  readonly workspace: "image" | "chat" | "tags";
  readonly anchor: string | null;
  readonly form: DigestForm;
  readonly boardId?: string;
  readonly boards?: readonly { id: string; name: string; form: DigestForm }[];
  readonly modelName: string | null;
  readonly history: readonly DigestImage[];
  readonly favorites: readonly DigestImage[];
  readonly current: DigestImage | null;
  readonly generation: {
    readonly state: string;
    readonly busy: boolean;
    readonly index?: number;
    readonly total?: number;
    readonly error?: string;
  };
  /** Present in every digest so a changed chat composer also moves base_hash. */
  readonly composer: string;
  readonly chat: DigestChat | null;
  readonly ids: Ids;
}
export interface Digest {
  /** Sorted-key JSON; the same workbench always gives the same bytes. */
  readonly json: string;
  /** Hash of the source board identity, generation form and chat composer. */
  readonly baseHash: string;
  /** Highest `#h` number at snapshot time. */
  readonly cursor: number;
}

/** Two 32-bit FNV-1a passes; enough to notice an edit, not a security boundary. */
export function hash(text: string) {
  let a = 0x811c9dc5,
    b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
export const baseHash = (prompt: string, negative: string, composer: string) =>
  hash(canonical({ composer, negative, prompt }));

export const workspaceHash = (form: DigestForm, composer: string, boardId?: string) => boardId
  ? hash(canonical({ boardId, form: Object.fromEntries(boardKeys.map(k => [k, (form as unknown as Record<string, unknown>)[k]])), composer }))
  : baseHash(form.prompt, form.negative, composer);

const promptOf = (p: Readonly<Record<string, unknown>>) =>
  String(p.basePrompt ?? p.prompt ?? "");

function params(image: DigestImage) {
  const p = object(image.params);
  const out: Record<string, unknown> = {
    model: String(p.modelName || p.model || ""),
    size: `${image.size.width}x${image.size.height}`,
  };
  for (const key of ["seed", "steps", "scale", "cfg"] as const) {
    const n = finite(p[key]);
    if (n !== null) out[key] = n;
  }
  if (typeof p.sampler === "string" && p.sampler) out.sampler = p.sampler;
  if (p.isComparison) out.comparison = finite(p.comparisonTotal ?? p.batchTotal) ?? true;
  return out;
}
/**
 * L0: the workbench at the moment of sending. It travels at the tail of the
 * user's message, never in the system prompt, so edits never touch the cached
 * prefix. Active-board text is always present; unanchored historical image
 * text and inactive-board text stay behind explicit read tools.
 */
export function buildDigest(input: DigestInput, _options: { readonly formText?: boolean } = {}): Digest {
  const { form, ids } = input;
  ids.sync(input.history, input.favorites);
  const id = (image: DigestImage) =>
    ids.label(image.id) ?? `#${image.id.slice(0, 8)}`;
  const anchor = [...input.history, ...input.favorites].find((image) => image.id === ids.resolve(input.anchor ?? ""));

  const history = historyIndex(input.history.map((image) => ({ ...image, label: id(image) })), anchor ? { ...anchor, label: id(anchor) } : null);
  const current = input.current
    ? {
        id: id(input.current),
        ...(anchor?.id === input.current.id ? {
          ...params(input.current),
          prompt: promptOf(input.current.params),
          negative: String(object(input.current.params).negative_prompt ?? ""),
        } : {}),
      }
    : null;
  const generation: Record<string, unknown> = {
    state: input.generation.state,
    busy: input.generation.busy,
  };
  if (input.generation.total)
    generation.progress = `${input.generation.index ?? 1}/${input.generation.total}`;
  if (input.generation.error) generation.error = input.generation.error;
  const base = workspaceHash(form, input.composer, input.boardId);
  const state: Record<string, unknown> = {
    v: 5,
    ...(input.askTurnId ? { ask_turn_id: input.askTurnId } : {}),
    workspace: input.workspace,
    anchor: input.anchor,
    history_cursor: ids.cursor(),
    image: {
      active_board_id: input.boardId,
      boards: input.boards?.map(b => ({ id: b.id, name: b.name, model: b.form.model, characters_count: b.form.characters?.length ?? 0 })),
      character_capability: characterCapability(form.model),
      form: {
        text_included: true,
        prompt: form.prompt, negative: form.negative,
        model: input.modelName || form.model,
        size: `${form.width}x${form.height}`,
        steps: form.steps,
        scale: form.scale,
        cfg: form.cfg,
        sampler: form.sampler,
        seed: form.seed.trim() || "random",
        batch: form.batchCount,
        placement: form.placement ?? "auto",
        characters: (form.characters ?? []).map(c => ({ ...characterSummary(c, form.placement ?? "auto", form.model), centers: c.centers })),
        vibes: [],
      },
      current,
      generation,
      history,
      favorites: {
        count: input.favorites.length,
      },
    },
    base_hash: base,
  };
  if (input.chat) state.chat = input.chat;
  return { json: canonical(state), baseHash: base, cursor: ids.cursor() };
}
/** `<` never reaches the model raw, so state text cannot close the tag. */
export const stateBlock = (digest: Pick<Digest, "json">) =>
  `<workspace_state>\n${digest.json.replaceAll("<", "\\u003c")}\n</workspace_state>`;
