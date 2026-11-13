import type { Picture } from '../library.ts';
import type { PictureRefs } from '../edit-context.ts';
import type { Draft, DraftState } from '../draft/types.ts';
import type { NaiDraftCheck } from '../draft/nai-input.ts';
import type { RecipeReader } from './tools.ts';
import type { Retrospects, ReviewOwner, ReviewRecord } from './store.ts';
import { isStaged, MAX_EVOLUTION_NODES, MAX_STAGED_BRANCHES, MAX_STAGED_PER_TURN, stagedCount } from './model.ts';
import type { Retrospect, RetrospectNode } from './model.ts';
import { prepareStagedRecipe } from './staged.ts';
import type { StagedInput } from './staged.ts';

/** Per-turn append boundary. Successful plans survive a later inference failure. */
export function createBranchTurn(options: {
  store: Retrospects; reader: RecipeReader; reviews: ReviewRecord[]; base: DraftState; owner: ReviewOwner;
  library: readonly Picture[]; refs: () => PictureRefs; signal: AbortSignal;
  current: () => boolean; available: (source: Picture) => boolean;
  check: (draft: Draft) => Promise<NaiDraftCheck | null>;
}) {
  const { store, reader, reviews, base, owner, signal } = options;
  const committed = new WeakSet<Retrospect>();
  let count = 0;
  function remember(r: ReviewRecord) {
    const at = reviews.findIndex(old => old.id === r.id), snapshot = structuredClone(r);
    if (at < 0) reviews.push(snapshot); else reviews[at] = snapshot;
    reader.refresh(reviews);
  }
  return {
    committed,
    get count() { return count; },
    refresh() { for (const r of [...reviews]) { const current = store.get(r.id, owner.boardId ?? undefined); if (current) remember(current); } },
    async stage(input: StagedInput) {
      signal.throwIfAborted();
      if (base.workspace !== 'image' || !owner.boardId || !options.current()) throw new Error('请在当前 IMAGE 画板准备分支');
      const prepared = reader.prepared;
      const id = input.retrospect_id ?? prepared?.target?.id ?? store.activeForBoard(owner.boardId)?.id;
      const existing = id ? store.get(id, owner.boardId) : undefined;
      const read = existing && reviews.find(r => r.id === existing.id);
      if (input.retrospect_id && !existing || existing && (existing.boardId !== owner.boardId || existing.status !== 'active' || !read || read.revision !== existing.revision)) throw new Error('演进已变化，请先重新读取候选配方组');
      if (prepared?.target && prepared.target.id !== id) throw new Error('本轮准备树与目标演进不一致');
      if (prepared?.target && prepared.target.revision !== existing?.revision) throw new Error('准备树已过期，请重新整理');
      const value = prepared ?? existing?.value;
      if (!value) throw new Error('请先读取候选并调用 show_retrospect 建立演进');
      const source = options.library.find(p => p.aliases.includes(input.base_image_id));
      if (!source || !reader.evidence(source.id) || !options.available(source)) throw new Error('分支基底未读取或原记录已失效');
      const refs = { ...existing?.pictureRefs, ...options.refs() };
      const parent = value.nodes.find(n => !isStaged(n) && n.image_ids.some(tag => refs[tag]?.record_id === source.id));
      if (!parent) throw new Error('基底必须是目标树中的真实样本');
      const preparedRecipe = await prepareStagedRecipe(input, source, base, options.library, options.check);
      signal.throwIfAborted();
      if (!options.current() || !options.available(source) || (existing ? store.get(existing.id)?.revision !== existing.revision : store.activeForBoard(owner.boardId))) throw new Error('准备期间演进或画板已变化，请重新读取');
      const duplicate = existing?.value.nodes.find(n => isStaged(n) && n.staged.signature === preparedRecipe.signature && n.label === input.label && n.description === input.description);
      if (duplicate && !prepared) {
        committed.add(existing!.value);
        return { value: existing!.value, reused: true, receipt: { retrospect_id: existing!.id, expected_revision: existing!.revision, node_id: duplicate.id, saved: true, reused: true } };
      }
      if (count >= MAX_STAGED_PER_TURN) throw new Error('本轮已新增 4 个预设，请先比较这些方向');
      if (stagedCount(value) >= MAX_STAGED_BRANCHES || value.nodes.length >= MAX_EVOLUTION_NODES) throw new Error('每树最多 16 个待生成预设、80 个总节点，请先清理或归纳');
      const nodeId = `v${Math.max(existing?.nextVersion ?? 1, ...value.nodes.map(n => Number(n.id.slice(1)) + 1))}`;
      const baseTag = parent.image_ids.find(tag => refs[tag]?.record_id === source.id)!;
      const node: RetrospectNode = { id: nodeId, kind: 'staged', label: input.label, description: input.description, image_ids: [], cover: '', recipe: preparedRecipe.recipe,
        staged: { base: structuredClone(refs[baseTag]), baseRecipe: preparedRecipe.baseRecipe, form: preparedRecipe.target, overrides: preparedRecipe.overrides, signature: preparedRecipe.signature } };
      const edge = { from: parent.id, to: nodeId, summary: input.edge_summary ?? input.label };
      const result = existing ? store.stage(existing.id, existing.revision, node, edge, owner, prepared, refs)
        : store.register({ ...value, nodes: [...value.nodes, node], edges: [...value.edges, edge] }, refs, owner, 'active', options.library);
      count++; remember(result); reader.consume(); committed.add(result.value);
      return { value: result.value, receipt: { retrospect_id: result.id, expected_revision: result.revision, node_id: nodeId, base_image_id: baseTag, label: node.label, saved: true,
        remaining_this_turn: MAX_STAGED_PER_TURN - count, remaining_staged: MAX_STAGED_BRANCHES - stagedCount(result.value),
        ...(preparedRecipe.checked ? { input_budget: preparedRecipe.checked.input_budget, warnings: preparedRecipe.checked.warnings } : {}) } };
    },
  };
}
