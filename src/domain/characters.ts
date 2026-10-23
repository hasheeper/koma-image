import { object } from "./value.ts";

export type Center = { x: number; y: number };
export type Character = { id: string; on: boolean; prompt: string; negative: string; centers: Center[] };
export type Placement = "auto" | "manual";
export const characterCapability = (model: string) => /^nai-diffusion-5(?:-|$)/.test(model)
  ? { max: 22, positioning: "free" as const }
  : /^nai-diffusion-4-5(?:-|$)/.test(model) ? { max: 6, positioning: "grid5" as const } : { max: 0, positioning: "none" as const };
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(k => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
export function centersOf(value: unknown): Center[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(v => {
    const p = object(v);
    return typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? [{ x: p.x, y: p.y }] : [];
  });
}
export function readCharacters(value: unknown): Character[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((raw, i) => {
    const c = object(raw);
    let id = typeof c.id === "string" && /^c[1-9]\d*$/.test(c.id) ? c.id : `c${i + 1}`;
    while (seen.has(id)) id = `c${Number(id.slice(1)) + 1}`;
    seen.add(id);
    return { id, on: c.on !== false, prompt: String(c.prompt ?? ""), negative: String(c.negative ?? ""), centers: centersOf(c.centers) };
  });
}
export const nextCharacterId = (chars: readonly Character[]) => Math.max(0, ...chars.map(c => Number(c.id.slice(1)) || 0)) + 1;
export const gridCenter = (p: Center): Center => ({ x: (Math.min(4, Math.floor(p.x * 5)) + 0.5) / 5, y: (Math.min(4, Math.floor(p.y * 5)) + 0.5) / 5 });
export const gridLabel = (p: Center) => `${"ABCDE"[Math.min(4, Math.floor(p.x * 5))]}${Math.min(4, Math.floor(p.y * 5)) + 1}`;
export function cellCenter(cell: string): Center {
  if (!/^[A-E][1-5]$/.test(cell)) throw new Error("位置需为 A1–E5");
  return { x: ("ABCDE".indexOf(cell[0]) + 0.5) / 5, y: (Number(cell[1]) - 0.5) / 5 };
}
export function activeCharacters(chars: readonly Character[], model: string) {
  const cap = characterCapability(model);
  if (!cap.max) return [];
  const active = chars.filter(c => c.on);
  if (active.length > cap.max) throw new Error(`当前模型最多 ${cap.max} 个启用角色`);
  return active.map(c => ({ ...structuredClone(c), centers: cap.positioning === "grid5" ? c.centers.map(gridCenter) : structuredClone(c.centers) }));
}
export function characterSummary(c: Character, placement: Placement, model: string) {
  const cap = characterCapability(model);
  return { id: c.id, on: c.on, prompt: c.prompt, negative: c.negative,
    position: placement === "auto" ? "auto" : c.centers.map(p => cap.positioning === "grid5" ? gridLabel(p) : p) };
}
/** Official NAI metadata: pair the positive/negative arrays without dropping empty negatives. */
export function charactersFromNai(data: Record<string, unknown>) {
  const positive = object(data.v4_prompt), negative = object(data.v4_negative_prompt);
  const chars = object(positive.caption).char_captions, avoided = object(negative.caption).char_captions;
  if (!Array.isArray(chars)) return null;
  return { characters: chars.map((raw, i): Character => ({ id: `c${i + 1}`, on: true, prompt: String(object(raw).char_caption ?? ""),
    negative: String(object(Array.isArray(avoided) ? avoided[i] : null).char_caption ?? ""), centers: centersOf(object(raw).centers) })), placement: positive.use_coords === true ? "manual" as const : "auto" as const };
}
/** Standard gateway metadata uses one center and `uc` per role. */
export function charactersFromStandard(data: Record<string, unknown>) {
  if (!Array.isArray(data.characters)) return null;
  return { characters: data.characters.map((raw, i): Character => {
    const c = object(raw);
    return { id: `c${i + 1}`, on: true, prompt: String(c.prompt ?? ""), negative: String(c.uc ?? ""), centers: centersOf([c.center]) };
  }), placement: data.use_coords === true ? "manual" as const : "auto" as const };
}
