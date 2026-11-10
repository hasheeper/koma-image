import type { ReviewRecord } from './store.ts';
import type { ToolEntry } from '../tools.ts';
import type { RecipeCluster } from './recipe.ts';
import { readRetrospect, retrospectSchema } from './model.ts';
import { checkShape } from '../draft/schema-check.ts';
import { canonical } from '../canonical.ts';
import { dataBlock } from '../prompts/index.ts';
import { comparisonRecipe } from './recipe.ts';
import { recipeContext } from './context.ts';

const readSchema = { type: 'object', additionalProperties: false, properties: {
  retrospect_id: { type: 'string', minLength: 1, maxLength: 32 },
  scope: { type: 'string', enum: ['current', 'all'] },
  cluster_id: { type: 'string', minLength: 1, maxLength: 30 },
} };
/** Created per ASK turn, computed on first explicit read, never while generating. */
export function createRecipeReader(compute: () => readonly RecipeCluster[], boardId: string | null, reviews: readonly ReviewRecord[] = []) {
  let groups: readonly RecipeCluster[] | undefined;
  const readIds = new Set<string>(), readReviews = new Set<string>();
  return {
    read(input: Readonly<Record<string, unknown>>) {
      checkShape(input, readSchema, '候选读取');
      groups ??= compute();
      const focus = typeof input.cluster_id === 'string' ? groups.find(g => g.id === input.cluster_id) : undefined;
      if (input.cluster_id && !focus) throw new Error('候选组不存在');
      const review = typeof input.retrospect_id === 'string' ? reviews.find(r => r.id === input.retrospect_id) : undefined;
      if (input.retrospect_id && !review) throw new Error('本轮范围内没有该演进');
      const scope = input.scope ?? 'current', targetBoard = review?.boardId ?? focus?.boardId ?? boardId;
      const trees = review ? [review] : reviews.filter(r => r.status === 'active' && r.boardId === targetBoard);
      trees.forEach(r => readReviews.add(r.id));
      const eligible = groups.filter(g => scope === 'all' || !targetBoard || !g.boardId || g.boardId === targetBoard || g.images.some(p => p.origins.some(o => o.source === 'favorites')));
      eligible.forEach(g => readIds.add(g.id));
      return { retrospects: trees.map(r => ({ retrospect_id: r.id, expected_revision: r.revision, status: r.status, cursor: r.cursor, final: r.final, title: r.value.title,
        nodes: r.value.nodes.map(n => ({ id: n.id, label: n.label, ...(n.description ? { description: n.description } : {}), image_ids: n.image_ids, primary_id: n.cover, recipes: n.recipes ?? Object.fromEntries(n.image_ids.map(id => [id, n.recipe])) })), edges: r.value.edges, notes: r.notes })), total: eligible.length, ...(focus ? { focus_cluster_id: focus.id } : {}), clusters: eligible.map(g => ({
        cluster_id: g.id, board_id: g.boardId, cover: g.cover, count: g.images.length, image_ids: g.images.map(p => p.label),
        from: g.images[0].createdAt, to: g.images.at(-1)!.createdAt, recipe: comparisonRecipe(g.recipe),
      })), evolution: recipeContext(eligible) };
    },
    present(input: Readonly<Record<string, unknown>>) {
      if (!groups) throw new Error('请先读取候选配方组');
      const previous = typeof input.retrospect_id === 'string' ? reviews.find(r => r.id === input.retrospect_id) : reviews.find(r => r.status === 'active' && r.boardId === boardId && readReviews.has(r.id));
      if (input.retrospect_id && (!previous || !readReviews.has(previous.id))) throw new Error('请先读取目标版本演进');
      const data = previous && !input.retrospect_id ? { ...input, retrospect_id: previous.id, expected_revision: previous.revision } : input;
      if (previous && data.expected_revision !== previous.revision) throw new Error('演进版本不符，请使用读取时的 expected_revision');
      return readRetrospect(data, groups.filter(g => readIds.has(g.id)), previous);
    },
  };
}
export type RecipeReader = ReturnType<typeof createRecipeReader>;
export const getRecipeClusters: ToolEntry = {
  tool: { name: 'get_recipe_clusters', description: "当用户要求「复盘」、「演进」或梳理历史修改脉络时，一次读取当前 IMAGE／EDIT／CHAT 的候选配方组、完整手写配方、按时间排列的相邻演进 Diff（evolution）以及已有活动演进树（retrospects）。默认 scope=\"current\" 读取当前画板（含引用收藏），scope=\"all\" 跨画板；可传 retrospect_id 读取指定演进树。一次返回完整原文与有效角色/参数变化，无需再逐对调用 diff_meta 或 get_meta；需要看画面表现时仍配合视觉工具。", schema: readSchema },
  verb: '读取', object: () => '配方候选组',
  run(input, context) {
    if (!context.recipes) throw new Error('本轮演进读取未就绪');
    return { content: [{ type: 'text', text: dataBlock(canonical(context.recipes.read(input))) }], stat: '候选配方' };
  },
};
export const showRetrospect: ToolEntry = {
  tool: { name: 'show_retrospect', description: "生成或更新「版本演进」树并激活画板演进跟踪（不直接改写画板表单）。先调用 get_recipe_clusters 取证，结合对话排除无关主题、梳理阶段与分叉关系。若已有同主题活动演进，传入其 retrospect_id 与 expected_revision 更新同一棵树。每个 nodes 项代表一个语义演进阶段 vN（可包含微调词句/参数的多张真实 image_ids，用 primary_id 指定代表图）；label 写 2–10 字简短阶段名（不含 vN、图号或括号），一句改动依据写入可选 description（40 字内，不重复标题）；edges 表达单父无环的演进与分叉意图。调用后可继续在同轮回复结论或调用 propose_draft 提议回退/修改草稿。", schema: retrospectSchema },
  verb: '整理', object: () => '版本演进',
  run(input, context) {
    if (!context.recipes) throw new Error('本轮演进读取未就绪');
    const retrospect = context.recipes.present(input);
    return { content: [{ type: 'text', text: dataBlock(canonical({ displayed: true, title: retrospect.title, nodes: retrospect.nodes.map(n => ({ id: n.id, image_ids: n.image_ids })), edges: retrospect.edges })) }], retrospect, stat: `${retrospect.nodes.length} 版` };
  },
};

export const setRetrospectStatus: ToolEntry = {
  tool: { name: 'set_retrospect_status', description: "当用户明确表示当前画面问题已解决，或要求结束／继续某份版本演进时，用 workspace_state.retrospects 中对应的 retrospect_id 更新状态：active 为继续跟踪，ended 为结束跟踪。", schema: {
    type: 'object', additionalProperties: false, required: ['retrospect_id', 'status'], properties: {
      retrospect_id: { type: 'string', minLength: 1 }, status: { type: 'string', enum: ['active', 'ended'] },
    },
  } },
  verb: '更新', object: () => '版本演进状态',
  run(input, context) {
    checkShape(input, setRetrospectStatus.tool.schema, '版本演进状态');
    context.signal.throwIfAborted();
    if (!context.setRetrospectStatus) throw new Error('本轮没有可更新的演进');
    const result = context.setRetrospectStatus(String(input.retrospect_id), input.status as 'active' | 'ended');
    return { content: [{ type: 'text', text: dataBlock(canonical(result)) }], stat: '本轮成功后生效' };
  },
};
