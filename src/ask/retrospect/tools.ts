import type { ReviewRecord } from './store.ts';
import type { ToolEntry } from '../tools.ts';
import type { RecipeCluster } from './recipe.ts';
import { readRetrospect, retrospectSchema, isStaged, versionCount, stagedCount } from './model.ts';
import { checkShape } from '../draft/schema-check.ts';
import { canonical } from '../canonical.ts';
import { dataBlock } from '../prompts/index.ts';
import { comparisonRecipe } from './recipe.ts';
import { parseStagedInput, BranchInputError, stagedBranchSchema } from './staged.ts';
import { recipeContext } from './context.ts';
import { workshopPending } from './workshops.ts';

const readSchema = { type: 'object', additionalProperties: false, properties: {
  retrospect_id: { type: 'string', minLength: 1, maxLength: 32 },
  scope: { type: 'string', enum: ['current', 'all'] },
  cluster_id: { type: 'string', minLength: 1, maxLength: 30 },
} };
/** Created per ASK turn, computed on first explicit read, never while generating. */
export function createRecipeReader(compute: () => readonly RecipeCluster[], boardId: string | null, reviews: readonly ReviewRecord[] = []) {
  let groups: readonly RecipeCluster[] | undefined;
  let prepared: import("./model.ts").Retrospect | undefined;
  const readIds = new Set<string>(), readReviews = new Set<string>();
  return {
    get prepared() { return prepared; },
    consume() { prepared = undefined; },
    refresh(next: readonly ReviewRecord[]) { reviews = next; },
    evidence(recordId: string) { return !!groups?.some(g => readIds.has(g.id) && g.images.some(p => p.id === recordId)) || reviews.some(r => readReviews.has(r.id) && Object.values(r.pictureRefs).some(ref => ref.record_id === recordId)); },
    read(input: Readonly<Record<string, unknown>>) {
      checkShape(input, readSchema, '候选读取');
      groups ??= compute();
      const focus = typeof input.cluster_id === 'string' ? groups.find(g => g.id === input.cluster_id) : undefined;
      if (input.cluster_id && !focus) throw new Error('候选组不存在');
      const review = typeof input.retrospect_id === 'string' ? reviews.find(r => r.id === input.retrospect_id) : undefined;
      if (input.retrospect_id && !review) throw new Error('本轮范围内没有该演进');
      const scope = input.scope ?? 'current', targetBoard = review?.boardId ?? focus?.boardId ?? boardId;
      const trees = review ? [review] : reviews.filter(r => r.status === 'active' && (r.boardId === targetBoard || r.workshops?.some(t => t.target === targetBoard)));
      trees.forEach(r => readReviews.add(r.id));
      const eligible = groups.filter(g => scope === 'all' || !targetBoard || !g.boardId || g.boardId === targetBoard || trees.some(r => g.images.some(p => Object.values(r.pictureRefs).some(ref => ref.record_id === p.id))) || g.images.some(p => p.origins.some(o => o.source === 'favorites')));
      eligible.forEach(g => readIds.add(g.id));
      return { retrospects: trees.map(r => ({ retrospect_id: r.id, expected_revision: r.revision, status: r.status, cursor: r.cursor, workshops: (r.workshops ?? []).map(t => ({ workspace: t.target.startsWith('edit:') ? 'edit' : 'chat', status: workshopPending(t) ? 'pending' : 'delivered', node_id: t.nodeId, source_image_id: Object.keys(r.pictureRefs).find(tag => r.pictureRefs[tag].record_id === t.anchorRecordId) })), final: r.final, title: r.value.title,
        nodes: r.value.nodes.map(n => isStaged(n) ? { id: n.id, kind: 'staged', label: n.label, description: n.description, base_image_id: n.staged.base.tag, recipe: n.recipe, runtime_overrides: Object.fromEntries(n.staged.overrides.map(k => [k, n.staged.form[k]])) } : ({ id: n.id, label: n.label, ...(n.delivery ? { kind: 'workshop_delivery', source_image_id: Object.keys(r.pictureRefs).find(tag => r.pictureRefs[tag].record_id === n.delivery!.sourceRecordId), deliveries: Object.fromEntries(Object.entries(n.delivery.samples).map(([tag, s]) => [tag, { kind: s.kind, workspace: s.target.startsWith('edit:') ? 'edit' : 'chat' }])) } : {}), ...(n.description ? { description: n.description } : {}), image_ids: n.image_ids, primary_id: n.cover, recipes: n.recipes ?? Object.fromEntries(n.image_ids.map(id => [id, n.recipe])) })), edges: r.value.edges, notes: r.notes })), total: eligible.length, ...(focus ? { focus_cluster_id: focus.id } : {}), clusters: eligible.map(g => ({
        cluster_id: g.id, board_id: g.boardId, cover: g.cover, count: g.images.length, image_ids: g.images.map(p => p.label), source_characters: Object.fromEntries(g.images.map(p => [p.label, p.params.localCharacters ?? null])), image_availability: Object.fromEntries(g.images.map(p => [p.label, p.thumbnailOnly ? "thumbnail_only" : "original"])),
        from: g.images[0].createdAt, to: g.images.at(-1)!.createdAt, recipe: comparisonRecipe(g.recipe),
      })), evolution: recipeContext(eligible) };
    },
    present(input: Readonly<Record<string, unknown>>) {
      if (!groups) throw new Error('请先读取候选配方组');
      const previous = typeof input.retrospect_id === 'string' ? reviews.find(r => r.id === input.retrospect_id) : reviews.find(r => r.status === 'active' && (r.boardId === boardId || r.workshops?.some(t => t.target === boardId)) && readReviews.has(r.id));
      if (input.retrospect_id && (!previous || !readReviews.has(previous.id))) throw new Error('请先读取目标版本演进');
      if (!previous && /^(edit|chat):/.test(boardId ?? '')) throw new Error('请先在 IMAGE 建立演进主干，工坊只交付选定结果');
      const data = previous && !input.retrospect_id ? { ...input, retrospect_id: previous.id, expected_revision: previous.revision } : input;
      if (previous && data.expected_revision !== previous.revision) throw new Error('演进版本不符，请使用读取时的 expected_revision');
      return prepared = readRetrospect(data, groups.filter(g => readIds.has(g.id)), previous);
    },
  };
}
export type RecipeReader = ReturnType<typeof createRecipeReader>;
export const getRecipeClusters: ToolEntry = {
  tool: { name: 'get_recipe_clusters', description: '用户请求复盘、演进或梳理修改脉络时，读取 IMAGE 候选、完整手写配方与相邻 Diff，以及已有树的预设、工坊交付和待交付关联。scope=current 读取当前 IMAGE 或关联工坊的主干，scope=all 跨画板，也可按 retrospect_id 指定树。source_characters 提供原始角色槽 ID；thumbnail_only 样本可比较及恢复 IMAGE 配方，不能用于像素编辑或定稿。画面判断配合视觉工具。', schema: readSchema },
  verb: '读取', object: () => '配方候选组',
  run(input, context) {
    if (!context.recipes) throw new Error('本轮演进读取未就绪');
    context.refreshRecipeReviews?.();
    return { content: [{ type: 'text', text: dataBlock(canonical(context.recipes.read(input))) }], stat: '候选配方' };
  },
};
export const showRetrospect: ToolEntry = {
  tool: { name: 'show_retrospect', description: '从已读取证据生成或重整 IMAGE 阶段，激活主干跟踪，不写画板表单。已有树传 retrospect_id 与 expected_revision。每个 vN 可含多张微调样本，primary_id 指定代表图；label 为 2–10 字简短阶段名，不含版本号、图号或括号；description 为不重复标题的 40 字内说明；edges 为单父无环关系。工坊交付节点、待交付关联与预设自动保留，不重划工坊样本，须保留其依赖的具体来源图。可继续同轮 stage_evolution_branch 准备多个方向，或 propose_draft 提议单一修改。', schema: retrospectSchema },
  verb: '整理', object: () => '版本演进',
  run(input, context) {
    if (!context.recipes) throw new Error('本轮演进读取未就绪');
    const retrospect = context.recipes.present(input);
    return { content: [{ type: 'text', text: dataBlock(canonical({ displayed: true, title: retrospect.title, nodes: retrospect.nodes.map(n => ({ id: n.id, image_ids: n.image_ids })), edges: retrospect.edges })) }], retrospect, stat: `${versionCount(retrospect)} 版${stagedCount(retrospect) ? ` · ${stagedCount(retrospect)} 待生成` : ''}` };
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

export const stageEvolutionBranch: ToolEntry = {
  tool: { name: 'stage_evolution_branch', description: 'IMAGE 单图打磨遇到瓶颈或用户要求多方案试跑时，在活动版本演进的具体 base_image_id 下准备一个待生成分支。每次只提交一个完整方向，通常逐次调用 2–3 次；每轮最多新增 4 个，每树最多保留 16 个待生成预设，总节点上限 80。先 get_recipe_clusters 读取配方及原始角色槽 ID；尚无树时先 show_retrospect，同轮可继续挂分支。steps 复用 IMAGE 改词、角色、参数与部分恢复，自动校验输入；失败仅拒绝本次，成功立即保存且可继续工具调用。用户可先看配方 Diff，再载入画板并手动生成；单一明确修改仍用 propose_draft。', schema: stagedBranchSchema },
  verb: '准备', object: input => `预设分支 · ${String(input.label ?? '')}`,
  async run(input, context) {
    if (!context.stageEvolutionBranch) throw new Error('本轮不能准备 IMAGE 演进分支');
    try {
      const result = await context.stageEvolutionBranch(parseStagedInput(input));
      return { retrospect: result.value, stat: result.reused ? '已有预设' : '待生成 · 已保存', content: [{ type: 'text', text: dataBlock(canonical(result.receipt)) }] };
    } catch (error) {
      if (!(error instanceof BranchInputError)) throw error;
      return { error: true, reason: error.message, stat: '输入校验未通过', content: [{ type: 'text', text: dataBlock(canonical({ error: error.message, ...typeof error.details === 'object' && error.details })) }] };
    }
  },
};
