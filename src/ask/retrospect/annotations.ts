import type { Retrospect, RetrospectEdge } from './model.ts';
export type ReviewNotes = Readonly<Record<string, string>>;
export const nodeNoteKey = (id: string) => `node:${id}`;
export const edgeNoteKey = (edge: RetrospectEdge) => `edge:${edge.from}:${edge.to}`;
/** Notes are explicit user comments. They never alter a recipe or an inferred edge. */
export function editNotes(graph: Retrospect, notes: ReviewNotes, keys: readonly string[], text: string | null): ReviewNotes {
  const allowed = new Set([...graph.nodes.map(n => nodeNoteKey(n.id)), ...graph.edges.map(edgeNoteKey)]);
  const targets = [...new Set(keys)];
  if (!targets.length || targets.some(k => !allowed.has(k))) throw new Error('批注对象已失效');
  if (text !== null && text.length > 2000) throw new Error('批注最多 2000 字');
  const mixed = new Set(targets.map(k => notes[k] ?? '')).size > 1;
  if (text === null && mixed) throw new Error('请单独选择对象删除不同批注');
  if (targets.length > 1 && text !== null && !text.trim()) return notes;
  const next = { ...notes };
  for (const key of targets) {
    if (text?.trim()) {
      const value = mixed && next[key] ? `${next[key]}\n${text}` : text;
      if (value.length > 2000) throw new Error('追加后批注超过 2000 字，请单独编辑');
      next[key] = value;
    } else delete next[key];
  }
  return next;
}
