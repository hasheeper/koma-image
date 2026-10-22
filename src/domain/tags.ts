export interface TagItem {
  name: string;
  cnName: string;
  category: number;
  count: number;
  source?: string;
}
export interface CartTag {
  name: string;
  cnName: string;
  category: number;
  weight: number;
}
export const CATEGORIES: Record<number, { label: string; className: string }> =
  {
    0: { label: "通用", className: "general" },
    1: { label: "画师", className: "artist" },
    3: { label: "作品", className: "copyright" },
    4: { label: "角色", className: "character" },
    5: { label: "元数据", className: "meta" },
  };
export const DEFAULT_CATEGORIES = [0, 3, 4];
export const hasHan = (text: string) =>
  /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
export const promptTag = (name: string) => name.replaceAll("_", " ");
export const normalizeCategories = (value: unknown): number[] => {
  const ids = Array.isArray(value)
    ? [
        ...new Set(
          value.map(Number).filter((n) => Object.hasOwn(CATEGORIES, n)),
        ),
      ]
    : [];
  return ids.length ? ids : [...DEFAULT_CATEGORIES];
};
export const clampWeight = (value: unknown) =>
  Number.isFinite(Number(value))
    ? Math.min(5, Math.max(0.1, Math.round(Number(value) * 10) / 10))
    : 1;
export const combinedPrompt = (cart: CartTag[]) =>
  cart
    .map((item) =>
      item.weight === 1
        ? promptTag(item.name)
        : `${item.weight}::${promptTag(item.name)}::`,
    )
    .join(", ");
export function readCart(value: unknown): CartTag[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((item) => {
      if (
        !item ||
        typeof item.name !== "string" ||
        !item.name ||
        seen.has(item.name)
      )
        return false;
      seen.add(item.name);
      return true;
    })
    .slice(0, 100)
    .map((item) => ({
      name: item.name,
      cnName: String(item.cnName || ""),
      category: Number(item.category) || 0,
      weight: clampWeight(item.weight),
    }));
}
export function formatCount(value: number) {
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return String(value || 0);
}
export function tagUrl(name: string) {
  const url = new URL("https://danbooru.donmai.us/posts");
  url.searchParams.set("tags", name);
  return url.href;
}
const normalized = (s: string) => s.toLowerCase().replaceAll("_", " ").trim();
export function rankTags(
  items: TagItem[],
  query: string,
  categories: number[],
  limit: number,
  exactFirst = false,
) {
  const allowed = new Set(categories),
    seen = new Set<string>(),
    needle = normalized(query);
  return items
    .filter(
      (item) =>
        allowed.has(item.category) &&
        !seen.has(item.name) &&
        seen.add(item.name),
    )
    .map((item, index) => {
      const en = normalized(item.name),
        cn = normalized(item.cnName);
      const relevance =
        en === needle || cn === needle
          ? 5
          : en.startsWith(needle) || cn.startsWith(needle)
            ? 4
            : en.split(" ").some((word) => word.startsWith(needle))
              ? 3
              : en.includes(needle) || cn.includes(needle)
                ? 2
                : 0;
      return { item, index, relevance };
    })
    .sort(
      (a, b) =>
        (exactFirst ? Number(b.relevance === 5) - Number(a.relevance === 5) : 0) ||
        b.item.count - a.item.count ||
        b.relevance - a.relevance ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map(({ item }) => item);
}
export function fragmentAtCaret(
  value: string,
  caret: number,
  selectionEnd = caret,
) {
  const before = value.slice(0, caret),
    segmentStart =
      Math.max(before.lastIndexOf(","), before.lastIndexOf("\n")) + 1;
  const segment = before.slice(segmentStart),
    leading =
      segment.match(/^\s*(?:(?:-?\d*\.?\d+)\s*::)?[\[{]*\s*/)?.[0] || "";
  const after = segment.slice(leading.length),
    start =
      segmentStart + leading.length + after.length - after.trimStart().length;
  let end = Math.max(caret, selectionEnd);
  while (end < value.length && !/[,\n}\]]/.test(value[end])) end++;
  return { query: after.trim(), start, end };
}
export function insertTag(
  value: string,
  caret: number,
  end: number,
  name: string,
) {
  const fragment = fragmentAtCaret(value, caret, end),
    tag = promptTag(name),
    suffix = value.slice(fragment.end),
    next = suffix.trimStart()[0] || "";
  const text = tag + ([",", "\n", "}", "]"].includes(next) ? "" : ", ");
  return {
    value: value.slice(0, fragment.start) + text + suffix,
    caret: fragment.start + text.length,
  };
}
export function togglePromptTag(text: string, name: string) {
  const tag = promptTag(name),
    want = normalized(tag);
  let at = 0;
  for (const chunk of text.split(",")) {
    const lead = chunk.length - chunk.trimStart().length,
      body = chunk.trim();
    if (body && normalized(body) === want) {
      let from = at + lead,
        to = from + body.length;
      const before = text.slice(0, from).match(/,[ \t]*$/);
      if (before) from -= before[0].length;
      else to += text.slice(to).match(/^[ \t]*,[ \t]*/)?.[0].length || 0;
      return { value: text.slice(0, from) + text.slice(to), added: false };
    }
    at += chunk.length + 1;
  }
  const trimmed = text.replace(/[\s,]+$/, "");
  return { value: trimmed ? `${trimmed}, ${tag}` : tag, added: true };
}
