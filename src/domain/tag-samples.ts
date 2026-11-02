import { finite, object } from "./value.ts";

/** Danbooru's own ratings, opened one step per switch under 自由创作. */
export type SampleTier = "g" | "s" | "q" | "e";
export interface TagSample {
  id: number;
  rating: string;
  src: string;
  width: number | null;
  height: number | null;
}

export const SAMPLE_TIERS: Readonly<Record<SampleTier, { rating: string; shown: string; label: string; limit: number }>> = {
  g: { rating: "rating:g", shown: "g", label: "全年龄", limit: 8 },
  s: { rating: "rating:g,s", shown: "gs", label: "SFW", limit: 20 },
  q: { rating: "rating:g,s,q", shown: "gsq", label: "NSFW", limit: 20 },
  e: { rating: "", shown: "gsqe", label: "R18", limit: 20 },
};

/** 自由创作 off keeps general; on adds sensitive; NSFW adds questionable; R18 (only under NSFW) adds explicit. */
export function sampleTier(adult: boolean, nsfw: boolean, r18: boolean): SampleTier {
  if (!adult) return "g";
  if (!nsfw) return "s";
  return r18 ? "e" : "q";
}

/** `rating:` and `order:` stay outside the anonymous two-tag limit. */
export const samplesQuery = (name: string, tier: SampleTier) =>
  [name, SAMPLE_TIERS[tier].rating, "order:score"].filter(Boolean).join(" ");

export function postsUrl(query: string) {
  const url = new URL("https://danbooru.donmai.us/posts");
  url.searchParams.set("tags", query);
  return url.href;
}
export const postUrl = (id: number) => `https://danbooru.donmai.us/posts/${id}`;

/** Posts from `/posts.json` as 360px previews, in Danbooru's order; the tier is checked again here. */
export function readSamples(rows: unknown, tier: SampleTier): TagSample[] {
  if (!Array.isArray(rows)) throw new Error("Danbooru 返回格式异常");
  return rows.flatMap((raw: unknown) => {
    const post = object(raw), id = finite(post.id), rating = String(post.rating ?? "");
    if (id === null || !Number.isSafeInteger(id) || id <= 0 || rating.length !== 1 || !SAMPLE_TIERS[tier].shown.includes(rating)) return [];
    const variants = object(post.media_asset).variants;
    const variant = object(Array.isArray(variants) ? variants.find((v) => object(v).type === "360x360") : null);
    let src = "";
    if (typeof variant.url === "string") {
      try {
        const url = new URL(variant.url);
        if (url.origin === "https://cdn.donmai.us" && !url.username && !url.password) src = url.href;
      } catch { /* An invalid thumbnail is omitted. */ }
    }
    return src ? [{ id, rating, src, width: finite(variant.width), height: finite(variant.height) }] : [];
  });
}

export const sampleMark = (sample: { rating: string }) =>
  sample.rating === "e" ? "R18" : sample.rating === "q" ? "R15" : "";
