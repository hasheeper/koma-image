import { checkShape } from '../draft/schema-check.ts';
import { recipeOf, recipeWorkspace } from './recipe.ts';
import type { Recipe, RecipeCluster } from './recipe.ts';
import { preserveDeliveries, assertForest } from './workshops.ts';
import type { PictureRefs } from '../edit-context.ts';

export interface StagedRecipe {
  readonly base: import("../../domain/image-identity.ts").ImageTagBinding;
  readonly baseRecipe: Recipe;
  readonly form: import("../../domain/drawing.ts").DrawingForm;
  readonly overrides: readonly ("seed" | "batchCount")[];
  readonly signature: string;
}
interface NodeFields {
  readonly delivery?: import('./workshops.ts').WorkshopDelivery;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly image_ids: readonly string[];
  readonly cover: string;
  readonly recipe: Recipe;
  /** Absent only on older cards, whose samples were required to share one recipe. */
  readonly recipes?: Readonly<Record<string, Recipe>>;
}
export type RetrospectNode = NodeFields & (
  | { readonly kind?: 'generated'; readonly staged?: never }
  | { readonly kind: 'staged'; readonly staged: StagedRecipe }
);
export const isStaged = (node: RetrospectNode): node is RetrospectNode & { kind: 'staged'; staged: StagedRecipe } => node.kind === 'staged';
export const versionCount = (value: Retrospect) => value.nodes.filter(n => !isStaged(n)).length;
export const stagedCount = (value: Retrospect) => value.nodes.filter(isStaged).length;
export const MAX_STAGED_BRANCHES = 16;
export const MAX_STAGED_PER_TURN = 4;
/** A version is a semantic stage; actions and Diff always use one concrete sample. */
export function selectRetrospectSample(node: RetrospectNode, id = node.cover): RetrospectNode {
  if (isStaged(node)) return node;
  if (!node.image_ids.includes(id)) throw new Error('图片不属于当前版本');
  const recipe = node.recipes ? node.recipes[id] : node.recipe;
  if (!recipe) throw new Error('该图片的配方未记录');
  return { ...node, cover: id, recipe };
}
export interface RetrospectEdge { readonly from: string; readonly to: string; readonly summary: string }
export interface Retrospect {
  readonly target?: { readonly id: string; readonly revision: number };
  readonly title: string; readonly nodes: readonly RetrospectNode[]; readonly edges: readonly RetrospectEdge[];
  /** Recorded by successful generation only; ASK cannot submit or invent this provenance. */
  readonly sampleBases?: Readonly<Record<string, string>>;
}
/** Follow same-stage rolls to the concrete parent sample; older/inferred links use the cover. */
export function selectRetrospectBaseline(value: Retrospect, b: RetrospectNode, id: string, preferred?: string): RetrospectNode | null {
  const node = value.nodes.find(n => n.id === id);
  if (!node) return null;
  if (isStaged(b) && value.edges.some(e => e.from === id && e.to === b.id) && node.image_ids.includes(b.staged.base.tag) && !preferred) return selectRetrospectSample(node, b.staged.base.tag);
  if (preferred && node.image_ids.includes(preferred)) return selectRetrospectSample(node, preferred);
  if (value.edges.some(e => e.from === id && e.to === b.id)) {
    const seen = new Set<string>();
    for (let image = value.sampleBases?.[b.cover]; image && !seen.has(image); image = value.sampleBases?.[image]) {
      if (node.image_ids.includes(image)) return selectRetrospectSample(node, image);
      if (!b.image_ids.includes(image)) break;
      seen.add(image);
    }
  }
  return selectRetrospectSample(node);
}
/** Preserve trusted facts by record identity when ASK regroups stages or changes aliases. */
export function remapSampleBases(previous: { value: Retrospect; pictureRefs: PictureRefs }, nodes: readonly RetrospectNode[], recordOf: (id: string) => string | undefined) {
  const labels = new Map(nodes.flatMap(n => n.image_ids.map(id => [recordOf(id), id] as const)).filter(([record]) => !!record));
  const result: Record<string, string> = {};
  for (const [image, base] of Object.entries(previous.value.sampleBases ?? {})) {
    const target = labels.get(previous.pictureRefs[image]?.record_id), source = labels.get(previous.pictureRefs[base]?.record_id);
    if (target && source && target !== source) result[target] = source;
  }
  return result;
}
export const MAX_EVOLUTION_NODES = 80;
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
export const retrospectSchema = {
  type: 'object', additionalProperties: false, required: ['retrospect_title', 'nodes', 'edges'], properties: {
    retrospect_id: text(32), expected_revision: { type: 'integer', minimum: 0 },
    retrospect_title: text(80),
    nodes: { type: 'array', minItems: 1, maxItems: MAX_EVOLUTION_NODES, items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'image_ids'], properties: {
      id: text(24), label: { ...text(24), description: '简短阶段名，通常 2–10 个汉字；不要阶段编号、图片编号或括号解释。' },
      description: { ...text(160), description: '可选的一句补充说明，通常 40 字以内；写本阶段的调整或意图，不重复标题。' },
      primary_id: text(32), image_ids: { type: 'array', minItems: 1, items: text(32) },
    } } },
    edges: { type: 'array', maxItems: MAX_EVOLUTION_NODES - 1, items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'summary'], properties: { from: text(24), to: text(24), summary: text(100) } } },
  },
};
/** Validate evidence and forest shape, never replace ASK's semantic relationships. */
export function readRetrospect(value: unknown, clusters: readonly RecipeCluster[], previous?: { value: Retrospect; pictureRefs: PictureRefs }): Retrospect {
  checkShape(value, retrospectSchema, '版本演进');
  const input = value as { retrospect_id?: string; expected_revision?: number; retrospect_title: string; nodes: { id: string; label: string; description?: string; image_ids: string[]; primary_id?: string }[]; edges: RetrospectEdge[] };
  if ((input.retrospect_id === undefined) !== (input.expected_revision === undefined)) throw new Error('更新演进须提供演进 ID 和读取版本');
  const byAlias = new Map<string, { id: string; label: string; createdAt: number; recipe: Recipe; favorite: boolean }>();
  if (previous) for (const n of previous.value.nodes) for (const label of n.image_ids) {
    const ref = previous.pictureRefs[label]; if (!ref) continue;
    const fact = { id: ref.record_id, label, createdAt: 0, recipe: selectRetrospectSample(n, label).recipe, favorite: label.startsWith('#f') };
    for (const [alias, binding] of Object.entries(previous.pictureRefs)) if (binding.record_id === ref.record_id) byAlias.set(alias, fact);
  }
  for (const g of clusters) for (const p of g.images) for (const alias of p.aliases) {
    if (byAlias.has(alias) && byAlias.get(alias)!.id !== p.id) throw new Error('图片编号作用域已变化，请重新读取');
    byAlias.set(alias, { id: p.id, label: p.label, createdAt: p.createdAt, recipe: recipeOf(p.params), favorite: p.origins.some(o => o.source === 'favorites') });
  }
  const ids = new Set<string>(), records = new Set<string>();
  const nodes = input.nodes.map(node => {
    if (!/^v[1-9]\d*$/.test(node.id) || ids.has(node.id)) throw new Error('版本编号须为不重复的 v1、v2…');
    ids.add(node.id);
    const samples = node.image_ids.map(label => {
      const sample = byAlias.get(label);
      if (!sample) throw new Error(`${label} 不在本轮已读取的候选组中`);
      if (records.has(sample.id)) throw new Error(`${label} 重复计入演进`);
      records.add(sample.id);
      return sample;
    });
    if (samples.some(p => recipeWorkspace(p.recipe) !== 'image') && !previous?.value.nodes.some(n => n.delivery && n.id === node.id)) throw new Error('演进主干只整理 IMAGE；EDIT／CHAT 请在工坊中交付选定结果');
    if (new Set(samples.map(p => recipeWorkspace(p.recipe))).size > 1) throw new Error('IMAGE、EDIT、CHAT 应分别归入阶段，跨工作区用连线表达交接');
    if (node.primary_id && !samples.some(p => p.id === byAlias.get(node.primary_id!)?.id)) throw new Error('代表图必须属于该版本');
    const ordered = samples.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const cover = node.primary_id ? samples.find(p => p.id === byAlias.get(node.primary_id!)?.id)!.label : (ordered.filter(p => p.favorite).at(-1) ?? ordered.at(-1)!).label;
    const recipes = Object.fromEntries(ordered.map(p => [p.label, p.recipe]));
    return { ...node, image_ids: ordered.map(p => p.label), cover, recipe: recipes[cover], recipes };
  });
  const parents = new Map<string, string>();
  for (const edge of input.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) throw new Error('连线端点无效');
    if (parents.has(edge.to)) throw new Error('每个版本最多有一个父节点');
    parents.set(edge.to, edge.from);
  }
  for (const id of ids) {
    const path = new Set<string>();
    for (let cursor: string | undefined = id; cursor; cursor = parents.get(cursor)) {
      if (path.has(cursor)) throw new Error('演进连线不能成环');
      path.add(cursor);
    }
  }
  const recordLabels=new Map(nodes.flatMap(n=>n.image_ids.map(id=>[byAlias.get(id)?.id,id] as const)));
  const facts=Object.fromEntries(nodes.flatMap(n=>n.image_ids.flatMap(id=>{
    const parent=byAlias.get(id)?.recipe.input?.base?.id, label=parent?recordLabels.get(parent):undefined;
    return label&&label!==id?[[id,label]]:[];
  })));
  const result: Retrospect = { ...(input.retrospect_id ? { target: { id: input.retrospect_id, revision: input.expected_revision! } } : {}), title: input.retrospect_title, nodes, edges: structuredClone(input.edges),
    sampleBases:{...facts,...(previous?remapSampleBases(previous,nodes,id=>byAlias.get(id)?.id):{})} };
  return previous ? preserveStaged(result, previous, Object.fromEntries([...byAlias].map(([tag,p]) => [tag, { ...previous.pictureRefs[tag], record_id: p.id }]))) : result;
}

/** Regroup only measured versions; keep each plan attached to its exact source record. */
export function preserveStaged(value: Retrospect, previous: { value: Retrospect; pictureRefs: PictureRefs }, refs: PictureRefs): Retrospect {
  value = preserveDeliveries(value, previous, { ...previous.pictureRefs, ...refs });
  refs = { ...previous.pictureRefs, ...refs };
  const nodes = [...value.nodes], edges = [...value.edges];
  for (const old of previous.value.nodes.filter(isStaged)) {
    const reused = nodes.find(n => n.id === old.id);
    if (reused && (!isStaged(reused) || reused.staged.signature !== old.staged.signature)) throw new Error(`节点 ${old.id} 已由待生成预设占用`);
    const parent = nodes.find(n => !isStaged(n) && n.image_ids.some(tag => refs[tag]?.record_id === old.staged.base.record_id));
    if (!parent) throw new Error(`整理不能移除预设「${old.label}」的基底，请先删除该预设或保留来源样本`);
    const tag = parent.image_ids.find(tag => refs[tag]?.record_id === old.staged.base.record_id)!;
    const node = { ...old, staged: { ...old.staged, base: { ...old.staged.base, tag } } };
    if (reused) nodes[nodes.indexOf(reused)] = node; else nodes.push(node);
    const existing = edges.findIndex(e => e.to === old.id);
    const edge = { from: parent.id, to: old.id, summary: previous.value.edges.find(e => e.to === old.id)?.summary ?? old.label };
    if (existing >= 0) edges[existing] = edge; else edges.push(edge);
  }
  if (nodes.length > MAX_EVOLUTION_NODES) throw new Error('版本与预设合计最多 80 个节点');
  const result = { ...value, nodes, edges };
  assertForest(result);
  return result;
}
