import type { RetrospectNode } from './model.ts';
export type TextField = ReturnType<typeof recipeDiff>['texts'][number];
export type ParameterChange = ReturnType<typeof recipeDiff>['parameters'][number];
export type RecipeGroup = ReturnType<typeof groupsOf>[number];
import { recipeDiff } from './diff.ts';
import { comparisonRecipe } from './recipe.ts';
import type { Center } from '../../domain/characters.ts';
import { sameValue } from '../../domain/characters.ts';

export interface PositionChange {
  before: readonly Center[] | null;
  after: readonly Center[] | null;
  changed: boolean;
}

// Use the same comparison projection for fields, group counts and added/deleted states.
export function groupsOf(a: RetrospectNode | null, b: RetrospectNode) {
  a = a && { ...a, recipe: comparisonRecipe(a.recipe) }; b = { ...b, recipe: comparisonRecipe(b.recipe) };
  const diff = recipeDiff(a?.recipe ?? null, b.recipe);
  const left = a ? recipeDiff(null, a.recipe).parameters : [];
  const right = recipeDiff(null, b.recipe).parameters;
  const params = [...new Set([...right.map(p => p.key), ...left.map(p => p.key)])].map(key => {
    const before = left.find(p => p.key === key), after = right.find(p => p.key === key);
    return diff.parameters.find(p => p.key === key) ?? { ...(after ?? before)!, before: before?.after ?? '未记录', after: after?.after ?? '未记录', changed: false };
  });
  const build = (id: string, label: string, texts: readonly TextField[], parameters: readonly (ParameterChange & { changed: boolean })[], state = '', position: PositionChange | null = null, unknown = false) => ({ id, label, texts, parameters, state, position, unknown, changed: !a || texts.some(f => f.changed) || parameters.some(p => p.changed) || !!position?.changed || !!state });
  const groups = [build('base', '基础', diff.texts.filter(f => !/^c\d+:|^input:/.test(f.key)), [])];
  const count = Math.max(a?.recipe.characters?.length ?? 0, b.recipe.characters?.length ?? 0);
  for (let i = 0; i < count; i++) {
    const state = a ? a.recipe.characters && !a.recipe.characters[i] ? '新增' : b.recipe.characters && !b.recipe.characters[i] ? '删除' : '' : '';
    // A known absent role is an addition/deletion, not missing metadata. Keep unknowns intact.
    const texts = diff.texts.filter(f => f.key.startsWith(`c${i}:`)).map(f => {
      const before = a?.recipe.characters && !a.recipe.characters[i] ? '' : f.before;
      const after = b.recipe.characters && !b.recipe.characters[i] ? '' : f.after;
      return { ...f, before, after, changed: before !== after };
    });
    const before = a?.recipe.characters ? a.recipe.characters[i]?.centers ?? [] : null;
    const after = b.recipe.characters ? b.recipe.characters[i]?.centers ?? [] : null;
    // Effective roles are already enabled; do not repeat their enabled flag as a change.
    groups.push(build(`c${i}`, `角色 ${i + 1}`, texts, [], state, { before, after, changed: !sameValue(before, after) }));
  }
  if (a?.recipe.input || b.recipe.input) groups.push(build('input', '操作与来源', diff.texts.filter(f => f.key.startsWith('input:')), params.filter(p => p.key.startsWith('input:')), '', null,
    [a?.recipe.input,b.recipe.input].some(input=>input&&(input.base===undefined||input.mask===undefined))));
  groups.push(build('params', '参数', [], params.filter(p => !/^c\d+:|^input:/.test(p.key))));
  return groups;
}
