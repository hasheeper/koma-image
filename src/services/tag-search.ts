import { CATEGORIES, hasHan, rankTags } from "../domain/tags.ts";
import type { TagItem } from "../domain/tags.ts";
import { object } from "../domain/value.ts";
import { rememberTags } from "./tag-memory.ts";
interface Options {
  signal?: AbortSignal;
  categories?: number[];
  limit?: number;
  broad?: boolean;
  page?: number;
  pageSize?: number;
}
export function createTagSearch(
  categories: () => number[],
  fetcher: typeof fetch = fetch,
) {
  const cache = new Map<string, TagItem[]>(),
    pageCache = new Map<string, { items: TagItem[]; hasNext: boolean }>(),
    translatedCache = new Map<string, TagItem[]>();
  const remember = <T>(map: Map<string, T>, key: string, value: T) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > 120) map.delete(map.keys().next().value!);
    return structuredClone(value);
  };
  async function get(url: URL, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(8_000);
    const options = {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: "application/json" },
      credentials: "omit" as const,
      referrerPolicy: "no-referrer" as const,
    };
    try {
      return await fetcher(url, options);
    } catch (error) {
      if (options.signal.aborted || !(error instanceof TypeError)) throw error;
      return fetcher(url, options);
    }
  }
  async function search(
    query: string,
    limit: number,
    offset: number,
    official: boolean,
    signal?: AbortSignal,
  ): Promise<TagItem[]> {
    const url = new URL(
      official
        ? "https://danbooru.donmai.us/autocomplete.json"
        : "https://tagsuggest.zeabur.app/api/tags/suggest",
    );
    if (official) {
      url.searchParams.set("search[query]", query);
      url.searchParams.set("search[type]", "tag_query");
      url.searchParams.set("limit", String(limit + offset));
    } else {
      url.searchParams.set(
        "q",
        hasHan(query) ? query : query.replace(/\s+/g, "_"),
      );
      // The public bilingual API returns at most 30 candidates and has no
      // limit/offset parameters. Share that result and paginate it locally.
      const stored = translatedCache.get(url.href);
      if (stored) {
        signal?.throwIfAborted();
        return structuredClone(stored.slice(offset, offset + limit));
      }
    }
    const response = await get(url, signal);
    if (response.status === 429)
      throw new Error(
        official
          ? "Danbooru 请求过于频繁，请稍后再试"
          : "Tag 词典请求过于频繁，请稍后再试",
      );
    if (!response.ok)
      throw new Error(
        `${official ? "Danbooru" : "中文 Tag 词典"}暂不可用 (${response.status})`,
      );
    const data: unknown = await response.json().catch(() => null),
      rows = official ? data : object(data).results;
    if (!Array.isArray(rows)) throw new Error("Tag 词典返回格式异常，请稍后再试");
    signal?.throwIfAborted();
    const items = rows
      .map((raw: unknown) => {
        const r = object(raw),
          tag = object(r.tag);
        return {
          name: String(official ? r.value || tag.name || "" : r.name || ""),
          cnName: official ? "" : String(r.cn_name || ""),
          count:
            Number(official ? (r.post_count ?? tag.post_count) : r.count) || 0,
          category:
            Number(official ? (r.category ?? tag.category) : r.category) || 0,
          source: official ? "danbooru" : "translated",
        };
      })
      .filter((r: TagItem) => r.name);
    rememberTags(items);
    if (!official) remember(translatedCache, url.href, items);
    return items.slice(offset, offset + limit);
  }
  const friendly = (error: unknown) =>
    error instanceof TypeError
      ? new Error("Tag 服务暂时不可用，请稍后再试")
      : error instanceof DOMException && error.name === "TimeoutError"
        ? new Error("Tag 查询超时，请稍后再试")
        : error;
  function ids(options: Options) {
    return (
      options.categories?.length ? options.categories : categories()
    ).filter((id) => Object.hasOwn(CATEGORIES, id));
  }
  return {
    async suggest(query: string, options: Options = {}) {
      query = query.trim();
      if (!query) return [];
      const limit = Math.min(
          options.broad ? 100 : 20,
          Math.max(1, Math.floor(options.limit ?? 12)),
        ),
        allowed = ids(options);
      const key = `${options.broad}:${limit}:${[...allowed].sort().join(".")}:${query.toLowerCase()}`;
      if (cache.has(key)) return structuredClone(cache.get(key)!);
      const requestLimit = Math.min(
        options.broad ? 200 : 20,
        Math.max(limit, limit * 3),
      );
      let primary: unknown;
      try {
        const results = rankTags(
          await search(query, requestLimit, 0, false, options.signal),
          query,
          allowed,
          limit,
        );
        if (results.length || hasHan(query))
          return remember(cache, key, results);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (hasHan(query)) throw friendly(error);
        primary = error;
      }
      try {
        return remember(
          cache,
          key,
          rankTags(
            await search(query, requestLimit, 0, true, options.signal),
            query,
            allowed,
            limit,
          ),
        );
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw friendly(primary || error);
      }
    },
    async page(query: string, options: Options = {}) {
      query = query.trim();
      if (!query) return { items: [], hasNext: false };
      const page = Math.max(1, Math.floor(options.page ?? 1)),
        size = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 25))),
        offset = (page - 1) * size,
        allowed = ids(options);
      const key = `${page}:${size}:${[...allowed].sort().join(".")}:${query.toLowerCase()}`;
      if (pageCache.has(key)) return structuredClone(pageCache.get(key)!);
      let primary: unknown;
      try {
        const rows = await search(
          query,
          200,
          0,
          false,
          options.signal,
        );
        if (rows.length || hasHan(query))
          return remember(pageCache, key, {
            items: rankTags(
              rows.slice(offset, offset + size), query, allowed, size,
            ),
            hasNext: rows.length > offset + size,
          });
      } catch (error) {
        if (options.signal?.aborted || hasHan(query)) throw friendly(error);
        primary = error;
      }
      try {
        const rows = await search(
          query,
          size + 1,
          offset,
          true,
          options.signal,
        );
        return {
          items: rankTags(rows.slice(0, size), query, allowed, size),
          hasNext: rows.length > size,
        };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw friendly(primary || error);
      }
    },
  };
}
