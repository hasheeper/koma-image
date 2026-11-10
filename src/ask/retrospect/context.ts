import type { Picture } from '../library.ts';
import { recipeDiff } from './diff.ts';
import { comparisonRecipe, recipeOf } from './recipe.ts';
import type { RecipeCluster } from './recipe.ts';

/** Recorded effective parameters for context only; never a source for restoring the form. */
function evolutionRecipe(p: Picture) {
  const recipe = comparisonRecipe(recipeOf(p.params));
  return { ...recipe, params: { ...recipe.params,
    ...(typeof p.params.noise_schedule === 'string' ? { noiseSchedule: p.params.noise_schedule } : {}),
  } };
}

/** Complete chronological evidence, not inferred semantic parent/child relationships. */
export function recipeContext(groups: readonly RecipeCluster[]) {
  const previous = new Map<string, Picture>();
  const sequence = groups.flatMap(g => g.images.map(p => ({ p, g })))
    .sort((a, b) => a.p.createdAt - b.p.createdAt || a.p.id.localeCompare(b.p.id));
  return sequence.map(({ p, g }) => {
    const key = g.boardId ?? (p.origins.some(o => o.source === 'history') ? 'history:unknown' : `favorite:${p.id}`);
    const before = previous.get(key), recipe = evolutionRecipe(p);
    previous.set(key, p);
    const diff = before ? recipeDiff(evolutionRecipe(before), recipe) : null;
    return {
      id: p.label, cluster_id: g.id, board_id: g.boardId, previous_id: before?.label ?? null,
      seed: p.params.seed ?? null, effective_params: recipe.params,
      ...(recipe.input ? {input:recipe.input,parent_id:groups.flatMap(g=>g.images).find(image=>image.id===recipe.input!.base?.id)?.label??null} : {}),
      ...(diff ? { diff: { parameters: diff.parameters,
        texts: diff.texts.filter(t => t.changed).map(t => ({ key: t.key, label: t.label,
          before_known: t.before !== null, after_known: t.after !== null, parts: t.parts })),
        characters_unknown: diff.charactersUnknown,
      } } : { baseline: recipe }),
    };
  });
}
