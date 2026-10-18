import { CATEGORIES, hasHan, rankTags } from "../domain/tags.ts";
import type { TagItem } from "../domain/tags.ts";
import { object } from "../domain/value.ts";
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
    pageCache = new Map<string, { items: TagItem[]; hasNext: boolean }>();
  const remember = <T>(map: Map<string, T>, key: string, value: T) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > 120) map.delete(map.keys().next().value!);
    return structuredClone(value);
  };
  async function get(url: URL, signal?: AbortSignal) {
    const options = { signal, headers: { Accept: "application/json" } };
    try {
      return await fetcher(url, options);
    } catch (error) {
      if (signal?.aborted) throw error;
      return fetcher(url, options);
    }
  }
  async function search(
    query: string,
    limit: number,
    offset: number,
    broad: boolean,
    official: boolean,
    signal?: AbortSignal,
  ): Promise<TagItem[]> {
    const url = new URL(
      official
        ? "https://danbooru.donmai.us/autocomplete.json"
        : `https://tagsuggest.zeabur.app/api${broad ? "/tags" : "/tags/suggest"}`,
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
      if (broad) {
        url.searchParams.set("limit", String(Math.min(200, limit)));
        url.searchParams.set("offset", String(Math.max(0, offset)));
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
    const data = await response.json(),
      rows = official
        ? Array.isArray(data)
          ? data.slice(offset, offset + limit)
          : []
        : Array.isArray(data?.results)
          ? data.results.slice(0, limit)
          : [];
    return rows
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
  }
  const friendly = (error: unknown) =>
    error instanceof TypeError
      ? new Error("Tag 服务暂时不可用，请稍后再试")
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
          await search(
            query,
            requestLimit,
            0,
            !!options.broad,
            false,
            options.signal,
          ),
          query,
          allowed,
          limit,
        );
        if (results.length || hasHan(query))
          return remember(cache, key, results);
      } catch (error) {
        if (options.signal?.aborted || hasHan(query)) throw error;
        primary = error;
      }
      try {
        return remember(
          cache,
          key,
          rankTags(
            await search(query, requestLimit, 0, false, true, options.signal),
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
          size + 1,
          offset,
          true,
          false,
          options.signal,
        );
        if (rows.length || hasHan(query))
          return remember(pageCache, key, {
            items: rankTags(rows.slice(0, size), query, allowed, size),
            hasNext: rows.length > size,
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
          false,
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
