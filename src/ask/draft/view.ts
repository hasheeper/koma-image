import type { CheckedStep, DraftPlan } from "./types.ts";

/** Display-only model for the draft card; validation and writing never read it. */
export type FieldKey = "handoff" | "branch" | "prompt" | "negative" | "composer" | "params" | "characters" | `character:${string}`;
export interface Piece { readonly op: "keep" | "del" | "ins"; readonly text: string }
export interface Line { readonly sign: "del" | "ins"; readonly text: string }
export type StepView =
  | { readonly kind: "text"; readonly step: CheckedStep; readonly hunks: readonly (readonly Line[])[]; readonly added: number; readonly removed: number }
  | { readonly kind: "param"; readonly step: CheckedStep; readonly name: string; readonly source: string; readonly icon: string; readonly before: string; readonly after: string; readonly added: number; readonly removed: number }
  | { readonly kind: "note"; readonly step: CheckedStep; readonly text: string; readonly added: 0; readonly removed: 0 }
  | { readonly kind: "ref"; readonly step: CheckedStep; readonly label: string; readonly added: 0; readonly removed: 0 };
export interface FieldView {
  readonly key: FieldKey;
  readonly label: string;
  readonly icon: string;
  readonly steps: readonly StepView[];
  /** The whole field after the enabled steps, as a tag-level diff. */
  readonly full: readonly Piece[] | null;
}
/** Where a creating draft writes, shown under its title. */
export interface Destination { readonly label: "新画板" | "新对话"; readonly name: string }
export interface DraftView { readonly fields: readonly FieldView[]; readonly added: number; readonly removed: number; readonly destination: Destination | null }

const fields: Record<Exclude<FieldKey, `character:${string}`>, { label: string; icon: string }> = {
  handoff: { label: "新对话", icon: "i-chat" },
  branch: { label: "对话分支", icon: "i-branch" },
  prompt: { label: "Prompt", icon: "i-brush" },
  negative: { label: "Negative", icon: "i-ban" },
  composer: { label: "对话输入框", icon: "i-chat" },
  characters: { label: "角色组", icon: "i-model" },
  params: { label: "参数", icon: "i-parameters" },
};
const order: readonly FieldKey[] = ["handoff", "branch", "prompt", "negative", "composer", "characters", "params"];
const paramIcons: Record<string, string> = { Seed: "i-dice", 模型: "i-model", 宽: "i-frame", 高: "i-frame" };

export const tagsOf = (text: string) => text.split(/[,\n，]/).map((s) => s.trim()).filter(Boolean);
const norm = (tag: string) => tag.toLowerCase().replace(/[_\s]+/g, " ");
/** Above this many LCS cells the middle is shown as one replacement. */
const CELLS = 250_000;

/** Tag-level LCS; case, underscores and spacing are not changes. */
export function diffTags(a: readonly string[], b: readonly string[]): Piece[] {
  const A = a.map(norm), B = b.map(norm);
  let head = 0, tail = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
  const out: Piece[] = b.slice(0, head).map((text) => ({ op: "keep", text }));
  const n = A.length - head - tail, m = B.length - head - tail;
  if (n * m > CELLS) {
    for (let i = 0; i < n; i++) out.push({ op: "del", text: a[head + i] });
    for (let j = 0; j < m; j++) out.push({ op: "ins", text: b[head + j] });
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = A[head + i] === B[head + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[head + i] === B[head + j]) { out.push({ op: "keep", text: b[head + j] }); i++; j++; }
      else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) out.push({ op: "del", text: a[head + i++] });
      else out.push({ op: "ins", text: b[head + j++] });
    }
  }
  for (const text of b.slice(B.length - tail)) out.push({ op: "keep", text });
  return out;
}
/** Consecutive changes form one hunk: its removed tags, then its added tags. */
export function hunksOf(pieces: readonly Piece[]): Line[][] {
  const out: { del: string[]; ins: string[] }[] = [];
  let open: { del: string[]; ins: string[] } | null = null;
  for (const p of pieces) {
    if (p.op === "keep") { open = null; continue; }
    if (!open) out.push((open = { del: [], ins: [] }));
    open[p.op].push(p.text);
  }
  return out.map((h) => [
    ...(h.del.length ? [{ sign: "del" as const, text: h.del.join(", ") }] : []),
    ...(h.ins.length ? [{ sign: "ins" as const, text: h.ins.join(", ") }] : []),
  ]);
}

const fieldOf = (step: CheckedStep): FieldKey =>
  step.characterId ? `character:${step.characterId}` : step.kind === "handoff" || step.id.startsWith("0:option:") ? "handoff" : step.label.startsWith("角色组") ? "characters" : step.kind === "parameter" ? "params" : step.kind === "branch" ? "branch"
    : step.label.startsWith("Prompt") ? "prompt" : step.label.startsWith("Negative") ? "negative" : "composer";

function stepView(step: CheckedStep, handoff: boolean): StepView {
  if (step.kind === "parameter") {
    const [name, source = ""] = step.label.split(" · "), changed = step.before !== step.after ? 1 : 0;
    return { kind: "param", step, name, source, icon: step.id.startsWith("0:option:") ? "i-frame" : paramIcons[name] ?? "i-parameters",
      before: step.displayBefore ?? (step.before || "随机"), after: step.displayAfter ?? (step.after || "随机"), added: changed, removed: changed };
  }
  if (step.kind === "handoff") return { kind: "ref", step, label: step.after, added: 0, removed: 0 };
  // A new conversation has no text to compare; show its input verbatim.
  if (handoff && step.kind === "rewrite")
    return { kind: "text", step, hunks: step.after ? [[{ sign: "ins", text: step.after }]] : [], added: tagsOf(step.after).length, removed: 0 };
  if (step.kind === "branch")
    return { kind: "note", step, text: step.locked ? step.label : `${step.label} · ${step.after}`, added: 0, removed: 0 };
  if (step.kind === "rewrite") {
    const pieces = diffTags(tagsOf(step.before), tagsOf(step.after));
    return { kind: "text", step, hunks: hunksOf(pieces), added: pieces.filter((p) => p.op === "ins").length, removed: pieces.filter((p) => p.op === "del").length };
  }
  // A patch replaces one exact span; show it verbatim, without its joining commas.
  const edge = (text: string) => text.replace(/^[\s,，]+|[\s,，]+$/g, "");
  const before = edge(step.before), after = edge(step.after);
  const lines: Line[] = [...(before ? [{ sign: "del" as const, text: before }] : []), ...(after ? [{ sign: "ins" as const, text: after }] : [])];
  return { kind: "text", step, hunks: lines.length ? [lines] : [], added: tagsOf(after).length, removed: tagsOf(before).length };
}

export function draftView(plan: DraftPlan): DraftView {
  const groups = new Map<FieldKey, StepView[]>();
  // The new conversation is named in the header, so its locked step has no row.
  const opened = plan.steps.find((s) => s.kind === "handoff" && s.locked);
  for (const step of plan.steps) {
    if (step === opened) continue;
    const key = fieldOf(step);
    groups.set(key, [...(groups.get(key) ?? []), stepView(step, !!opened)]);
  }
  let added = 0, removed = 0;
  const out: FieldView[] = [];
  for (const key of [...order, ...[...groups.keys()].filter(k => k.startsWith("character:"))]) {
    const steps = groups.get(key);
    if (!steps) continue;
    for (const s of steps) if (s.step.enabled && !s.step.issue) { added += s.added; removed += s.removed; }
    const change = opened || key === "params" || key === "branch" || key === "characters" ? undefined : plan.changes.find((c) => c.field === key);
    out.push({ key, ...(key.startsWith("character:") ? { label: steps[0].step.characterLabel ?? key, icon: "i-model" } : fields[key as keyof typeof fields]), steps, full: change ? diffTags(tagsOf(String(change.before)), tagsOf(String(change.after))) : null });
  }
  const destination: Destination | null = plan.newBoardName ? { label: "新画板", name: plan.newBoardName } : opened ? { label: "新对话", name: opened.after } : null;
  return { fields: out, added, removed, destination };
}
