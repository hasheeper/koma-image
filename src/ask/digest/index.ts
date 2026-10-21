import { canonical } from "../canonical.ts";
import { finite, object } from "../../domain/value.ts";
import { sections } from "./segments.ts";
import type { CategoryOf } from "./segments.ts";
import type { Ids } from "../ids.ts";

/** What the digest reads from a history or favorite record; never the blobs. */
export interface DigestImage {
  readonly id: string;
  readonly createdAt: number;
  readonly favoritedAt?: number;
  readonly params: Readonly<Record<string, unknown>>;
  readonly size: { readonly width: number; readonly height: number };
}
export interface DigestForm {
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
  readonly workspace: "image" | "chat" | "tags";
  readonly anchor: string | null;
  readonly form: DigestForm;
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
  readonly category?: CategoryOf;
}
export interface Digest {
  /** Sorted-key JSON; the same workbench always gives the same bytes. */
  readonly json: string;
  /** Hash of what drafts may change: prompt, negative and the chat composer. */
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

const clip = (text: string, limit = 120) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;
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
 * prefix. Prompts are the user's own text and stay exactly as written.
 */
export function buildDigest(input: DigestInput): Digest {
  const { form, ids } = input;
  ids.sync(input.history, input.favorites);
  const id = (image: DigestImage) =>
    ids.label(image.id) ?? `#${image.id.slice(0, 8)}`;
  const seen = new Map<string, string>();
  const history = input.history.map((image) => {
    const prompt = promptOf(image.params),
      label = id(image),
      entry: Record<string, unknown> = { id: label, ...params(image) };
    const favorite = ids.favorite(image.id);
    if (favorite) entry.favorite = favorite;
    entry.prompt =
      prompt === form.prompt.trim()
        ? "= form"
        : seen.has(prompt)
          ? `= ${seen.get(prompt)}`
          : clip(prompt);
    if (!seen.has(prompt)) seen.set(prompt, label);
    return entry;
  });
  const current = input.current
    ? {
        id: id(input.current),
        ...params(input.current),
        prompt: promptOf(input.current.params),
        negative: String(object(input.current.params).negative_prompt ?? ""),
      }
    : null;
  const generation: Record<string, unknown> = {
    state: input.generation.state,
    busy: input.generation.busy,
  };
  if (input.generation.total)
    generation.progress = `${input.generation.index ?? 1}/${input.generation.total}`;
  if (input.generation.error) generation.error = input.generation.error;
  const base = baseHash(form.prompt, form.negative, input.composer);
  const state: Record<string, unknown> = {
    v: 1,
    workspace: input.workspace,
    anchor: input.anchor,
    image: {
      form: {
        prompt: form.prompt,
        negative: form.negative,
        model: input.modelName || form.model,
        size: `${form.width}x${form.height}`,
        steps: form.steps,
        scale: form.scale,
        cfg: form.cfg,
        sampler: form.sampler,
        seed: form.seed.trim() || "random",
        batch: form.batchCount,
        // Reserved until the drawing form has them (doc 3 §3.1).
        characters: [],
        vibes: [],
      },
      prompt_sections: sections(form.prompt, input.category),
      current,
      generation,
      history,
      favorites: {
        count: input.favorites.length,
        recent: input.favorites.slice(0, 5).map(id),
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
