import { CATEGORIES } from "../domain/tags.ts";
import type { createTagSearch } from "../services/tag-search.ts";
import { normalize } from "./library.ts";

export type TagSearch = ReturnType<typeof createTagSearch>["suggest"];

/** One tool call, up to five ordinary dictionary queries sharing its signal. */
export async function searchTags(input: Readonly<Record<string, unknown>>, suggest: TagSearch, signal: AbortSignal) {
  if (!Array.isArray(input.queries) || !input.queries.length || input.queries.length > 5 ||
    input.queries.some((q) => typeof q !== "string" || !q.trim() || q.length > 300))
    throw new Error("queries 需要 1–5 个非空查询词，每项最多 300 字");
  const limit = input.limit_per_query ?? 5;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("limit_per_query 需为 1–10");
  const unique = new Map<string, string>();
  for (const query of input.queries as string[]) if (!unique.has(normalize(query))) unique.set(normalize(query), query.trim());
  const queries = [...unique.values()];
  signal.throwIfAborted();
  const settled = await Promise.allSettled(queries.map((query) => suggest(query, {
    broad: true, categories: [0, 1, 3, 4, 5], limit: 30, exactFirst: true, signal,
  })));
  signal.throwIfAborted();
  return { results: settled.map((result, i) => {
    if (result.status === "rejected") return {
      query: queries[i], status: "error" as const, matches: [],
      error: result.reason instanceof Error ? result.reason.message : "词典查询失败",
    };
    const matches = result.value.slice(0, limit).map((item) => ({
      tag: item.name, category: item.category, category_label: CATEGORIES[item.category]?.className ?? "unknown",
      post_count: item.count, zh: item.cnName || null, aliases: null, source: item.source ?? null,
    }));
    return { query: queries[i], status: matches.length ? "ok" as const : "no_match" as const, matches };
  }) };
}
