import type { RefEntry } from '../../ask/reference-source.ts';

export interface ProjectTags { prompt: string; negative: string; outfits: { id: string; label: string; prompt: string; negative: string }[] }
export interface ProjectReference extends RefEntry { title: string; category?: string; description?: string }
export interface ProjectCharacter {
  id: string; path: string; name: string; aliases: string[]; brief: string; brief_path: string | null;
  tags: { available: boolean; path: string | null; field?: 'tags' };
  profile: string | null; portrait: string | null; refs: ProjectReference[];
  tagContent?: ProjectTags; issues: string[];
}
export interface ProjectData {
  title: string; description: string; paths: { characters: string; lore: string; references: string };
  characters: ProjectCharacter[]; lore: ProjectReference[]; references: ProjectReference[]; issues: string[];
}
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function parseProjectTags(value: unknown): ProjectTags {
  if (typeof value === 'string') return { prompt: value, negative: '', outfits: [] };
  const v = record(value);
  if (!Object.keys(v).length || v.prompt !== undefined && typeof v.prompt !== 'string' || v.negative !== undefined && typeof v.negative !== 'string' || v.outfits !== undefined && !Array.isArray(v.outfits)) throw new Error('TAG 需为文本或 prompt / negative / outfits 对象');
  const seen = new Set<string>();
  const outfits = (Array.isArray(v.outfits) ? v.outfits : []).map((raw): ProjectTags['outfits'][number] => {
    const o = record(raw);
    if (typeof o.id !== 'string' || !o.id.trim() || seen.has(o.id) || typeof o.prompt !== 'string' || o.negative !== undefined && typeof o.negative !== 'string' || o.label !== undefined && typeof o.label !== 'string') throw new Error('服装 TAG 需要唯一 id 和 prompt');
    seen.add(o.id);
    return { id: o.id, label: typeof o.label === 'string' ? o.label : o.id, prompt: o.prompt, negative: typeof o.negative === 'string' ? o.negative : '' };
  });
  return { prompt: typeof v.prompt === 'string' ? v.prompt : '', negative: typeof v.negative === 'string' ? v.negative : '', outfits };
}
export function composeProjectTags(tags: ProjectTags, outfitId = '') {
  const outfit = tags.outfits.find(o => o.id === outfitId);
  if (outfitId && !outfit) throw new Error('服装已不存在，请重新选择');
  const join = (base: string, extra: string | undefined) => base.trim() && extra?.trim() ? `${base}, ${extra}` : extra?.trim() ? extra : base;
  return { prompt: join(tags.prompt, outfit?.prompt), negative: join(tags.negative, outfit?.negative) };
}
export const projectObject = record;
