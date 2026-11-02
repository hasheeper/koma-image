import type { ImageMetadata } from "../native/image-meta.ts";
import { postUrl } from "./tag-samples.ts";
import { promptTag } from "./tags.ts";
import { finite, object } from "./value.ts";

/** Category groups in display and prompt order; `category` is Danbooru's tag category. */
export const POST_GROUPS = [
  { key: "artist", label: "画师", category: 1 },
  { key: "character", label: "角色", category: 4 },
  { key: "copyright", label: "作品", category: 3 },
  { key: "general", label: "通用", category: 0 },
] as const;
export type PostGroup = (typeof POST_GROUPS)[number]["key"];
export interface PostImage {
  src: string;
  width: number | null;
  height: number | null;
  ext: string;
}
export interface DanbooruPost {
  id: number;
  rating: string;
  /** Explicit user import, not an API response verified in this session. */
  imported?: true;
  width: number | null;
  height: number | null;
  tags: Record<PostGroup, string[]>;
  /** 360px preview for the dictionary. */
  preview: PostImage | null;
  /** `sample`, else the 720px variant, for ASK. */
  image: PostImage | null;
  /** Original bytes for the IMAGE import preview. */
  original: PostImage | null;
}

/** `danbooru.donmai.us/posts/<id>`, with or without scheme, query or hash; nothing else counts. */
export function postId(text: string): number | null {
  const match = /^(?:https?:\/\/)?danbooru\.donmai\.us\/posts\/(\d{1,12})\/?(?:[?#]\S*)?$/i.exec(text.trim());
  const id = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
/** The first link of a dropped `text/uri-list`, skipping its comment lines. */
export const droppedLink = (list: string) =>
  list.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#")) ?? "";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
// Only the CDN verified to send CORS headers; anything else is treated as missing.
function cdn(src: unknown): src is string {
  if (typeof src !== "string") return false;
  try {
    const url = new URL(src);
    return url.origin === "https://cdn.donmai.us" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function variant(variants: unknown, types: readonly string[]): PostImage | null {
  const list = Array.isArray(variants) ? variants.map(object) : [];
  for (const type of types) {
    for (const v of list.filter((item) => item.type === type)) {
      if (!cdn(v.url)) continue;
      const ext = String(v.file_ext || /\.([a-z0-9]+)$/i.exec(new URL(v.url).pathname)?.[1] || "").toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) return { src: v.url, width: finite(v.width), height: finite(v.height), ext };
    }
  }
  return null;
}

/** One `/posts/<id>.json`; category strings stay as supplied by Danbooru. */
export function readPost(raw: unknown): DanbooruPost {
  const post = object(raw), id = finite(post.id), rating = String(post.rating ?? "");
  if (id === null || !Number.isSafeInteger(id) || id <= 0 || rating.length !== 1 || !"gsqe".includes(rating)) throw new Error("Danbooru 返回格式异常");
  const split = (value: unknown) => typeof value === "string" ? [...new Set(value.split(/\s+/).filter(Boolean))] : [];
  const media = object(post.media_asset);
  const variants = [
    ...(Array.isArray(media.variants) ? media.variants : []),
    { type: "sample", url: post.large_file_url },
    { type: "original", url: post.file_url, file_ext: post.file_ext },
    { type: "180x180", url: post.preview_file_url },
  ];
  return {
    id,
    rating,
    width: finite(post.image_width ?? media.image_width),
    height: finite(post.image_height ?? media.image_height),
    tags: {
      artist: split(post.tag_string_artist),
      character: split(post.tag_string_character),
      copyright: split(post.tag_string_copyright),
      general: split(post.tag_string_general),
    },
    preview: variant(variants, ["360x360", "720x720", "180x180"]),
    image: variant(variants, ["sample", "720x720"]),
    original: variant(variants, ["original"]),
  };
}

export const POST_JSON_MAX_BYTES = 4 * 1024 * 1024;
/** User-supplied single-post JSON; no URLs are fetched while parsing. */
export function readPostJson(text: string, expectedId?: number | null): DanbooruPost {
  if (text.length > POST_JSON_MAX_BYTES || new TextEncoder().encode(text).byteLength > POST_JSON_MAX_BYTES)
    throw new Error("帖子 JSON 不能超过 4 MB");
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("不是有效的 JSON，请复制完整的帖子 JSON 内容"); }
  if (Array.isArray(raw)) {
    if (raw.length !== 1) throw new Error("请导入一条帖子的 JSON，不支持多帖列表");
    raw = raw[0];
  }
  const record = object(raw);
  if (POST_GROUPS.some(({ key }) => typeof record[`tag_string_${key}`] !== "string"))
    throw new Error("缺少帖子分类 Tag，请使用 Danbooru 单帖 JSON");
  const post = readPost(raw);
  if (post.id > 999_999_999_999) throw new Error("Danbooru 帖子 ID 无效");
  if (expectedId != null && post.id !== expectedId)
    throw new Error(`这份 JSON 属于 #${post.id}，当前需要 #${expectedId}`);
  if (POST_GROUPS.reduce((count, { key }) => count + post.tags[key].length, 0) > 2048)
    throw new Error("帖子 Tag 数量过多，请检查 JSON 内容");
  return { ...post, imported: true };
}

export const postName = (post: DanbooruPost, image = post.image) => `danbooru-${post.id}.${image?.ext ?? "jpg"}`;
/** Selected groups in panel order, underscores read as spaces. */
export const postPrompt = (post: DanbooruPost, groups: readonly PostGroup[]) =>
  POST_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => post.tags[g.key].map(promptTag)).join(", ");

/** Known metadata bound to an ASK attachment: Danbooru's own tag names, as posted. */
export function postParams(post: DanbooruPost): ImageMetadata {
  return {
    name: postName(post),
    dialect: "Danbooru",
    source: postUrl(post.id),
    fields: {},
    extras: [
      { label: "post_id", value: String(post.id) },
      { label: "rating", value: post.rating },
      ...(post.imported ? [{ label: "data_source", value: "用户手动导入的 Danbooru 帖子 JSON，未联网核验" }] : []),
      ...POST_GROUPS.filter((g) => post.tags[g.key].length).map((g) => ({ label: g.key, value: post.tags[g.key].join(", ") })),
    ],
  };
}
