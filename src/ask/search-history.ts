import { canonical } from "./canonical.ts";
import { metadata, normalize, promptOf, similarity } from "./library.ts";
import type { Picture, PictureOrigin, PictureSource } from "./library.ts";

export const changedFields = ["prompt", "negative", "model", "seed", "steps", "scale", "cfg", "sampler", "width", "height", "size", "strength", "noise"] as const;
const textFields = ["prompt", "negative", "model", "modelName"] as const;
type TextField = typeof textFields[number];
type Candidate = { picture: Picture; origin: PictureOrigin };

/** Literal words only: operators are noise, never an executable query language. */
function tokens(value: string) {
  return normalize(value).split(/[^\p{L}\p{N}]+/u).filter((word) => word && !["and", "or", "not"].includes(word));
}
function textArg(input: Readonly<Record<string, unknown>>, key: string) {
  const value = input[key];
  if (value === undefined) return "";
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`${key} 需要非空文本（最多 300 字）`);
  return value.trim();
}
/** Only compare fields actually recorded; missing CHAT metadata is not a change. */
function recorded(picture: Picture) {
  const result = metadata(picture), p = picture.params;
  if (p.basePrompt === undefined && p.prompt === undefined) delete result.prompt;
  if (p.negative_prompt === undefined && p.negative === undefined) delete result.negative;
  if (result.model === undefined && typeof result.modelName === "string") result.model = result.modelName;
  return result;
}
function changes(a: Picture, b: Picture) {
  const before = recorded(a), after = recorded(b);
  const keys: string[] = changedFields.filter((key) => key !== "size" && before[key] != null && after[key] != null && canonical(before[key]) !== canonical(after[key]));
  if (keys.includes("width") || keys.includes("height")) keys.push("size");
  return keys;
}
function excerpt(value: string, query: readonly string[]) {
  if (value.length <= 180) return value;
  const normalized = normalize(value), offsets = query.map((word) => normalized.indexOf(word)).filter((i) => i >= 0);
  // Locate on the original string as well, so collapsed spaces never corrupt it.
  const first = offsets.length ? Math.min(...offsets) : 0;
  const needle = offsets.length ? query.find((word) => normalized.indexOf(word) === first) : undefined;
  const found = needle ? value.normalize("NFKC").toLowerCase().replaceAll("_", " ").indexOf(needle) : 0;
  const start = Math.max(0, found - 50);
  const end = Math.min(value.length, start + 176);
  return `${start ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`;
}
function age(createdAt: number, now: number) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
}

export function searchHistory(input: Readonly<Record<string, unknown>>, library: readonly Picture[], now: number) {
  const query = textArg(input, "query"), words = [...new Set(tokens(query))], phrase = tokens(query).join(" ");
  if (query && !words.length) throw new Error("query 没有可检索的关键词");
  const field = textArg(input, "changed_field");
  if (field && !changedFields.some((key) => key === field)) throw new Error("不支持的变化字段");
  const scope = input.scope ?? "all", limit = input.limit ?? 8;
  if (typeof scope !== "string" || !["history", "favorites", "chat", "all"].includes(scope)) throw new Error("无效检索范围");
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 15) throw new Error("limit 需为 1–15");
  const similarId = textArg(input, "similar_to"), base = similarId ? library.find((p) => p.aliases.includes(similarId)) : null;
  if (similarId && !base) throw new Error(`${similarId} 不在本轮图片快照中`);
  if (base && !promptOf(base).trim()) throw new Error("基准图片没有提示词，无法进行相似检索");

  const timelines = new Map<PictureSource, Candidate[]>();
  const unique = [...new Map(library.map((p) => [p.id, p])).values()];
  for (const picture of unique) for (const origin of picture.origins) {
    const list = timelines.get(origin.source) ?? [];
    list.push({ picture, origin }); timelines.set(origin.source, list);
  }
  const previous = new Map<PictureOrigin, Candidate>();
  for (const list of timelines.values()) {
    list.sort((a, b) => a.origin.order - b.origin.order || a.origin.label.localeCompare(b.origin.label));
    list.forEach((candidate, i) => { if (i) previous.set(candidate.origin, list[i - 1]); });
  }

  const hits = unique.flatMap((picture) => {
    const origin = scope === "all"
      ? ["history", "favorites", "chat"].flatMap((source) => picture.origins.filter((o) => o.source === source))[0]
      : picture.origins.find((o) => o.source === scope);
    if (!origin || picture.id === base?.id) return [];
    const prior = previous.get(origin), changed = prior ? changes(prior.picture, picture) : null;
    if (field && !changed?.includes(field)) return [];
    const score = base ? similarity(promptOf(base), promptOf(picture)) : 0;
    if (base && score <= 0) return [];
    const meta = metadata(picture);
    const fields = textFields.map((key) => {
      const value = typeof meta[key] === "string" ? meta[key] : "", normalized = tokens(value).join(" ");
      const bag = new Set(tokens(value)), matched = words.filter((word) => bag.has(word));
      return { key, value, matched, exact: !!phrase && normalized.includes(phrase) };
    });
    const count = new Set(fields.flatMap((f) => f.matched)).size;
    if (words.length && !count) return [];
    fields.sort((a, b) => b.matched.length - a.matched.length || Number(b.exact) - Number(a.exact));
    const best = fields[0];
    return [{ picture, origin, prior, changed, score, count, exact: fields.some((f) => f.exact), best }];
  });
  hits.sort((a, b) => b.score - a.score || b.count - a.count || Number(b.exact) - Number(a.exact) ||
    (b.picture.createdAt > 0 ? b.picture.createdAt : 0) - (a.picture.createdAt > 0 ? a.picture.createdAt : 0) ||
    (a.origin.source === "chat" && b.origin.source === "chat" ? b.origin.order - a.origin.order : 0) || a.origin.label.localeCompare(b.origin.label));
  return {
    total_matched: hits.length,
    matches: hits.slice(0, limit).map(({ picture, origin, prior, changed, score, best }) => ({
      id: origin.label, aliases: picture.aliases, source: origin.source,
      age: age(picture.createdAt, now), size: [picture.size.width, picture.size.height],
      seed: typeof picture.params.seed === "number" && Number.isFinite(picture.params.seed) ? picture.params.seed : null,
      matched_field: query ? best.key as TextField : null,
      matched_snippet: excerpt(query ? best.value : promptOf(picture), words),
      compared_to: prior?.origin.label ?? null, changed_from_prev: changed,
      ...(base ? { similarity: Math.round(score * 1000) / 1000 } : {}),
    })),
  };
}
