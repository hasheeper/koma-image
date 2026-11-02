import { CATEGORIES, hasHan, rankTags } from "../domain/tags.ts";
import type { TagItem } from "../domain/tags.ts";
import { SAMPLE_TIERS, readSamples, samplesQuery } from "../domain/tag-samples.ts";
import type { SampleTier, TagSample } from "../domain/tag-samples.ts";
import { postName, readPost } from "../domain/danbooru-post.ts";
import type { DanbooruPost } from "../domain/danbooru-post.ts";
import { object } from "../domain/value.ts";
import type { LocalTagProxy } from "../config/runtime.ts";
interface Options {
  signal?: AbortSignal;
  categories?: number[];
  limit?: number;
  broad?: boolean;
  exactFirst?: boolean;
  page?: number;
  pageSize?: number;
}
interface SuggestionOptions extends Options { dataset?: "anime" | "furry" }
export function createTagSearch(
  categories: () => number[],
  fetcher: typeof fetch = fetch,
  local?: LocalTagProxy,
) {
  const cache = new Map<string, TagItem[]>(),
    pageCache = new Map<string, { items: TagItem[]; hasNext: boolean }>(),
    translatedCache = new Map<string, TagItem[]>(),
    sampleCache = new Map<string, TagSample[]>(),
    postCache = new Map<string, DanbooruPost>();
  const imageUrl = (src: string) => local
    ? new URL(`media${new URL(src).pathname}`, local.baseUrl).href : src;
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
    let response: Response;
    try {
      response = await fetcher(url, options);
    } catch (error) {
      if (options.signal.aborted || !(error instanceof TypeError)) throw error;
      response = await fetcher(url, options);
    }
    return { response, signal: options.signal };
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
    const { response, signal: requestSignal } = await get(url, signal);
    requestSignal.throwIfAborted();
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
    let data: unknown;
    try { data = await response.json(); }
    catch (error) {
      requestSignal.throwIfAborted();
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error("Tag 词典返回格式异常，请稍后再试");
    }
    requestSignal.throwIfAborted();
    const rows = official ? data : object(data).results;
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
    if (!official) remember(translatedCache, url.href, items);
    return items.slice(offset, offset + limit);
  }
  // Public NovelAI Furry vocabulary endpoint; no connection credentials or full prompt.
  // It returns no Danbooru categories, so those preferences must not filter this dataset.
  async function furry(query: string, signal?: AbortSignal): Promise<TagItem[]> {
    const url = new URL("https://image.novelai.net/ai/generate-image/suggest-tags");
    url.searchParams.set("model", "nai-diffusion-furry-3");
    url.searchParams.set("prompt", query);
    const { response, signal: requestSignal } = await get(url, signal);
    requestSignal.throwIfAborted();
    if (!response.ok) throw new Error(response.status === 429 ? "Furry 标签请求过于频繁，请稍后再试" : `Furry 标签暂不可用 (${response.status})`);
    let data: Record<string, unknown>;
    try { data = object(await response.json()); }
    catch (error) {
      requestSignal.throwIfAborted();
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error("Furry 标签返回格式异常，请稍后再试");
    }
    requestSignal.throwIfAborted();
    if (!Array.isArray(data.tags)) throw new Error("Furry 标签返回格式异常，请稍后再试");
    const seen = new Set<string>();
    return data.tags.flatMap(raw => {
      const row = object(raw);
      if (typeof row.tag !== "string" || !row.tag.trim() || seen.has(row.tag)) return [];
      seen.add(row.tag);
      return [{ name: row.tag, cnName: "", category: 0, count: Number(row.count) || 0, source: "nai-furry" }];
    });
  }
  // Samples and post links share one wording; failures are not kept and never retried.
  async function danbooru(url: URL, signal?: AbortSignal, missing = "") {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(8_000),
      requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    const networkFailure = (error: unknown) => new Error(
      requestSignal.aborted || (error instanceof DOMException && error.name === "TimeoutError")
        ? "Danbooru 请求超时，请稍后重试"
        : local ? "本地词典服务连接失败，请检查服务并刷新页面"
          : "无法读取 Danbooru，可能是网络问题或 Cloudflare 验证拦截。请打开原站检查后重试",
      { cause: error },
    );
    const target = local ? new URL(url.pathname.slice(1) + url.search, local.baseUrl) : url;
    try {
      response = await fetcher(target, {
        signal: requestSignal,
        headers: { Accept: "application/json", ...(local ? { "X-Koma-Local-Token": local.token } : {}) },
        credentials: "omit", referrerPolicy: "no-referrer",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw networkFailure(error);
    }
    signal?.throwIfAborted();
    if (local && !response.ok) {
      const detail = object(await response.json().catch(() => null)).error;
      signal?.throwIfAborted();
      if (typeof detail === "string" && detail) throw new Error(detail.slice(0, 300));
    }
    if (response.status === 404 && missing) throw new Error(missing);
    if (response.status === 429) throw new Error("Danbooru 请求过于频繁，请稍后再试");
    if (response.headers.get("cf-mitigated") === "challenge") {
      await response.body?.cancel();
      throw new Error(`Danbooru 被 Cloudflare 验证拦截（${response.status}）。请打开原站完成验证后重试`);
    }
    if (response.status === 403) throw new Error("Danbooru 拒绝了请求（403），可能需要 Cloudflare 验证。请打开原站检查后重试");
    if (!response.ok) throw new Error(`Danbooru 暂不可用 (${response.status})`);
    if (response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      throw new Error("Danbooru 返回了网页，可能需要 Cloudflare 验证。请打开原站检查后重试");
    }
    let data: unknown;
    try { data = await response.json(); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw error instanceof SyntaxError && !requestSignal.aborted ? new Error("Danbooru 返回格式异常", { cause: error }) : networkFailure(error);
    }
    signal?.throwIfAborted();
    return data;
  }
  const friendly = (error: unknown) =>
    error instanceof TypeError
      ? new Error("Tag 服务暂时不可用，请稍后再试")
      : error instanceof DOMException && error.name === "TimeoutError"
        ? new Error("Tag 查询超时，请稍后再试")
        : error;
  const fallbackFailure = (primary: unknown, secondary: unknown) => {
    const detail = (error: unknown) => {
      const value = friendly(error);
      return value instanceof Error ? value.message : "查询失败";
    };
    return new Error(`中英词典${primary === undefined ? "未命中" : `：${detail(primary)}`}；Danbooru：${detail(secondary)}`);
  };
  function ids(options: Options) {
    return (
      options.categories?.length ? options.categories : categories()
    ).filter((id) => Object.hasOwn(CATEGORIES, id));
  }
  return {
    imageUrl,
    async suggest(query: string, options: SuggestionOptions = {}) {
      options.signal?.throwIfAborted();
      query = query.trim();
      if (!query) return [];
      const limit = Math.min(
          options.broad ? 100 : 20,
          Math.max(1, Math.floor(options.limit ?? 12)),
        ),
        allowed = ids(options);
      const key = `${options.dataset ?? "anime"}:${!!options.exactFirst}:${options.broad}:${limit}:${[...allowed].sort().join(".")}:${query.toLowerCase()}`;
      if (cache.has(key)) return structuredClone(cache.get(key)!);
      if (options.dataset === "furry") {
        if (hasHan(query)) throw new Error("Furry 补全使用英文标签，请输入英文查询");
        try { return remember(cache, key, (await furry(query, options.signal)).slice(0, limit)); }
        catch (error) { if (options.signal?.aborted) throw error; throw friendly(error); }
      }
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
          options.exactFirst,
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
            options.exactFirst,
          ),
        );
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw fallbackFailure(primary, error);
      }
    },
    /** Danbooru posts for one artist/character, opened on demand; failures are not kept and never retried. */
    async samples(name: string, tier: SampleTier, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const key = `${tier}:${name}`;
      if (sampleCache.has(key)) return structuredClone(sampleCache.get(key)!);
      const url = new URL("https://danbooru.donmai.us/posts.json");
      url.searchParams.set("tags", samplesQuery(name, tier));
      url.searchParams.set("limit", String(SAMPLE_TIERS[tier].limit));
      return remember(sampleCache, key, readSamples(await danbooru(url, signal), tier));
    },
    /** One pasted post link; kept for the page like samples, never retried. */
    async post(id: number, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Danbooru 帖子 ID 无效");
      const key = String(id);
      if (postCache.has(key)) return structuredClone(postCache.get(key)!);
      const post = readPost(await danbooru(new URL(`https://danbooru.donmai.us/posts/${id}.json`), signal, "Danbooru 上没有这条帖子"));
      if (post.id !== id) throw new Error("Danbooru 返回的帖子 ID 不一致");
      return remember(postCache, key, post);
    },
    /** ASK uses sample/720px; IMAGE explicitly asks for the original. */
    async postImage(post: DanbooruPost, signal?: AbortSignal, original = false) {
      signal?.throwIfAborted();
      const image = original ? post.original : post.image;
      if (!image) throw new Error(original ? "该帖没有可用的原图" : "该帖没有可用的图片");
      const timeout = AbortSignal.timeout(20_000),
        requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let blob: Blob;
      try {
        const response = await fetcher(imageUrl(image.src), { signal: requestSignal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) {
          const detail = local ? object(await response.json().catch(() => null)).error : undefined;
          throw new Error(typeof detail === "string" && detail ? detail.slice(0, 300) : response.status === 403
            ? "Danbooru 图片请求被拒绝（403），可能需要 Cloudflare 验证。请打开原站检查后重试"
            : `Danbooru 图片暂不可用 (${response.status})`);
        }
        blob = await response.blob();
      } catch (error) {
        if (signal?.aborted) throw error;
        throw error instanceof Error && /^(?:Danbooru|本地服务)/.test(error.message) ? error
          : new Error(requestSignal.aborted ? "Danbooru 图片读取超时，请稍后重试" : "无法读取 Danbooru 图片，可能是网络问题或 Cloudflare 验证拦截。请打开原站检查后重试", { cause: error });
      }
      signal?.throwIfAborted();
      if (!blob.type.startsWith("image/")) throw new Error("Danbooru 返回的不是图片");
      return new File([blob], postName(post, image), { type: blob.type });
    },
    /** Exact Chinese names from the bilingual dictionary, four at a time; misses stay blank and the first failure ends the rest. */
    async translate(names: readonly string[], signal?: AbortSignal) {
      const found = new Map<string, TagItem>(), queue = [...new Set(names)];
      let failed = false;
      const worker = async () => {
        for (let name = queue.shift(); name !== undefined && !failed; name = queue.shift()) {
          try {
            const hit = (await search(name, 30, 0, false, signal)).find((item) => item.name === name);
            if (hit) found.set(name, hit);
          } catch (error) {
            if (signal?.aborted) throw error;
            failed = true;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
      return found;
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
        throw fallbackFailure(primary, error);
      }
    },
  };
}
