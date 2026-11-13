import { boardKeys } from '../../domain/drawing.ts';
import { readCharacters } from '../../domain/characters.ts';
import type { Character } from '../../domain/characters.ts';
import { readReferences } from '../../domain/nai-references.ts';
import type { Picture } from '../library.ts';
import { canonical } from '../canonical.ts';
import { readEvolutionInput, evolutionTarget } from '../../domain/evolution-input.ts';
import type { EvolutionInput } from '../../domain/evolution-input.ts';

export interface Recipe {
  readonly input?: EvolutionInput;
  readonly prompt: string | null;
  readonly negative: string | null;
  readonly characters: readonly Omit<Character, 'id'>[] | null;
  readonly params: Readonly<Record<string, unknown>>;
}
export interface RecipeCluster {
  readonly id: string;
  readonly boardId: string | null;
  readonly images: readonly Picture[];
  readonly cover: string;
  readonly recipe: Recipe;
  readonly signature: string;
}
export const recipeWorkspace = (recipe: Recipe) => recipe.input?.workspace ?? 'image';
/** Imported aliases describe where an image is visible, not the language of its recipe. */
export function recipeTarget(p: Picture): string | null {
  const workspace = recipeWorkspace(recipeOf(p.params));
  if (workspace === 'image') return typeof p.params.boardId === 'string' ? p.params.boardId : null;
  if (workspace === 'chat') return p.scope?.kind === 'chat' ? evolutionTarget('chat', p.scope.id)
    : typeof p.params.chatConversationId === 'string' ? evolutionTarget('chat', p.params.chatConversationId) : null;
  const id = p.params.editBoardId ?? p.origins.find(o => o.source === 'edit')?.boardId;
  return typeof id === 'string' ? evolutionTarget('edit', id) : null;
}
const parameterKeys = boardKeys.filter(k => !['prompt', 'negative', 'characters', 'seed', 'batchCount', 'optimize', 'naiReferences'].includes(k));
/** Project recorded raw fields only. Unknown original text never falls back to sent text. */
export function recipeOf(p: Readonly<Record<string, unknown>>): Recipe {
  const input = readEvolutionInput(p.evolutionInput);
  if (input) return { input, prompt: input.prompt, negative: input.negative,
    characters: input.characters?.map(({ id: _id, ...c }) => c) ?? null, params: input.params };
  if (p.editId || p.tool && p.tool !== 'chat') {
    const params=Object.fromEntries(['model','modelName','width','height','steps','sampler','scale','strength','noise','directorTool','defry','emotion'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
    const legacy:EvolutionInput={workspace:'edit',operation:String(p.tool??'edit'),prompt:typeof p.basePrompt==='string'?p.basePrompt:null,negative:typeof p.baseNegative==='string'?p.baseNegative:null,
      characters:Array.isArray(p.localCharacters)?readCharacters(p.localCharacters):null,params:{...params,...(p.image_options&&typeof p.image_options==='object'?p.image_options:{})}};
    return {input:legacy,prompt:legacy.prompt,negative:legacy.negative,characters:legacy.characters?.map(({id:_id,...c})=>c)??null,params:legacy.params};
  }
  const params: Record<string, unknown> = {};
  for (const key of parameterKeys) if (p[key] !== undefined) params[key] = structuredClone(p[key]);
  if (p.naiReferences !== undefined) {
    const refs = readReferences(p.naiReferences);
    params.naiReferences = { ...refs, vibe: refs.vibe.map(({ id: _id, ...r }) => r), precise: refs.precise.map(({ id: _id, ...r }) => r) };
  }
  return {
    prompt: typeof p.basePrompt === 'string' ? p.basePrompt : null,
    negative: typeof p.baseNegative === 'string' ? p.baseNegative : null,
    characters: Array.isArray(p.localCharacters) ? readCharacters(p.localCharacters).map(({ id: _id, ...c }) => c) : null,
    params,
  };
}
export const recipeSignature = (recipe: Recipe) => canonical({ ...recipe, ...(recipe.input ? { input: {
  ...recipe.input,
  ...(recipe.input.base ? { base: { id: recipe.input.base.id } } : {}),
  ...(recipe.input.references ? { references: recipe.input.references.map(({ id }) => ({ id })) } : {}),
} } : {}) });
/** Effective identity only; restoration keeps the complete raw snapshot. */
export const effectiveSignature = (recipe: Recipe) => {
  const value = comparisonRecipe(recipe), input = value.input;
  return canonical({ ...value, ...(input ? { input: { workspace: input.workspace, operation: input.operation,
    base: input.base === null ? null : input.base?.id, references: input.references?.map(r => r.id), context: input.context,
    mask: input.mask === null ? null : input.mask?.hash, annotations: input.annotations } } : {}) });
};
/** Comparison view only: keep raw snapshots intact for exact restoration. */
export function comparisonRecipe(recipe: Recipe): Recipe {
  const { cfg: _cfg, ...values } = recipe.params; const params:Record<string,unknown>={...values}; // Historical CFG toggle is no longer sent.
  for (const [from, to] of [['cfg_rescale', 'cfgRescale'], ['noise_schedule', 'noiseSchedule']]) {
    if (params[from] !== undefined) { params[to] = params[from]; delete params[from]; }
  }
  if(params.naiReferences) {const refs=readReferences(params.naiReferences);params.naiReferences={...refs,vibe:refs.vibe.map(({id:_id,...r})=>r),precise:refs.precise.map(({id:_id,...r})=>r)};}
  return { ...recipe, params, characters: recipe.characters?.filter(c => c.on && (c.prompt.trim() || c.negative.trim())) ?? null };
}
export function isRecipePicture(p: Picture) {
  if (p.params.isComparison || p.params.editReference) return false;
  if (p.origins.some(o => o.source === 'edit' || o.source === 'chat') || readEvolutionInput(p.params.evolutionInput)) return true;
  return !p.params.tool && !p.params.editId && !p.params.editBoardId &&
    p.params.sourceWorkspace !== 'chat' && !p.params.chatConversationId &&
    (!p.lineage?.via || p.lineage.via === 'image') && typeof p.params.model === 'string' &&
    (p.origins.some(o => o.source === 'history') || typeof p.params.basePrompt === 'string');
}
/** Pure read view: independent board sequences, consecutive runs, no inferred edges. */
export function pictureTarget(p: Picture, preferred?: string | null): string | null {
  const edit = p.origins.find(o => o.source === 'edit' && evolutionTarget('edit', o.boardId ?? '') === preferred);
  if (edit) return preferred!;
  if (typeof p.params.editBoardId === 'string') return evolutionTarget('edit', p.params.editBoardId);
  if (p.scope?.kind === 'chat') return evolutionTarget('chat', p.scope.id);
  if (typeof p.params.chatConversationId === 'string') return evolutionTarget('chat', p.params.chatConversationId);
  if (p.origins.some(o => o.source === 'edit') && !p.origins.some(o => o.source === 'history')) return evolutionTarget('edit', p.origins.find(o => o.source === 'edit')!.boardId!);
  return typeof p.params.boardId === 'string' ? p.params.boardId : null;
}
export function recipeClusters(library: readonly Picture[], referencedFavorites: ReadonlySet<string>, target?: string | null): readonly RecipeCluster[] {
  const seen = new Set<string>(), sequences = new Map<string, Picture[]>();
  for (const p of library) {
    if (p.params.editReference || p.params.chatInput || seen.has(p.id) || !isRecipePicture(p)) continue;
    const history = p.origins.some(o => o.source === 'history');
    if (!history && !p.origins.some(o => o.source === 'edit' || o.source === 'chat') && !(referencedFavorites.has(p.id) && p.origins.some(o => o.source === 'favorites'))) continue;
    seen.add(p.id);
    const board = pictureTarget(p, target);
    const key = board ?? (history ? 'history:unknown' : `favorite:${p.id}`);
    const sequence = sequences.get(key) ?? [];
    sequence.push(p); sequences.set(key, sequence);
  }
  const groups: { boardId: string | null; images: Picture[]; recipe: Recipe; signature: string }[] = [];
  for (const sequence of sequences.values()) {
    let last: typeof groups[number] | undefined;
    for (const p of sequence.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
      const recipe = recipeOf(p.params);
      // Without originals, matching unknown values is not evidence of the same recipe.
      const signature = effectiveSignature(recipe) + (recipe.prompt === null || recipe.negative === null || recipe.characters === null ? `:${p.id}` : '');
      if (last?.signature === signature) last.images.push(p);
      else { last = { boardId: pictureTarget(p, target), images: [p], recipe, signature }; groups.push(last); }
    }
  }
  return groups.sort((a, b) => a.images[0].createdAt - b.images[0].createdAt || a.images[0].id.localeCompare(b.images[0].id)).map((g, i) => ({
    ...g, id: `g${i + 1}`, cover: (g.images.filter(p => p.origins.some(o => o.source === 'favorites')).at(-1) ?? g.images.at(-1)!).label,
  }));
}
