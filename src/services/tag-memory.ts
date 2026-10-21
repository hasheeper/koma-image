import { rankTags } from "../domain/tags.ts";
import type { TagItem } from "../domain/tags.ts";

/** Page-only vocabulary already fetched by normal dictionary UI. ASK never fetches. */
const entries = new Map<string, TagItem>();
const key = (text: string) => text.toLowerCase().replaceAll(" ", "_");
export function rememberTags(items: readonly TagItem[]) {
  for (const item of items) {
    entries.delete(key(item.name));
    entries.set(key(item.name), { ...item });
  }
  while (entries.size > 4000) entries.delete(entries.keys().next().value!);
}
export const tagCategory = (tag: string) => entries.get(key(tag))?.category;
export function localTags(query: string, limit = 20) {
  const needle = key(query);
  const matches = [...entries.values()].filter((item) =>
    key(item.name).includes(needle) || item.cnName.includes(query),
  );
  return rankTags(matches, query, [0, 1, 3, 4, 5], Math.min(20, limit)).map((item) => ({ ...item }));
}
