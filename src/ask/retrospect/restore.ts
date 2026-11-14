import { boardKeys, prepareDrawingFields } from '../../domain/drawing.ts';
import { resolveModel } from '../../domain/catalog.ts';
import { characterCapability } from '../../domain/characters.ts';
import { parameterIssue, parameterSchema, parseParameters } from '../draft/parameters.ts';
import type { ParameterKey } from '../draft/parameters.ts';
import { canonical } from '../canonical.ts';
import type { Recipe } from './recipe.ts';
import type { DrawingForm } from '../../domain/drawing.ts';
import type { CatalogModel } from '../../domain/catalog.ts';

/** Pure full-recipe validation shared by explicit restore and built-in rollback drafts. */
export function prepareRecipe(recipe: Recipe, state: { form: Readonly<DrawingForm>; nextCharacterId: number; models: CatalogModel[]; samplersFor: (id: string) => readonly string[] }) {
  const missing = boardKeys.filter(k => !['prompt', 'negative', 'characters', 'seed', 'batchCount', 'optimize'].includes(k) && !(k in recipe.params));
  if (recipe.prompt === null || recipe.negative === null || recipe.characters === null || missing.length) throw new Error('原始配方字段不完整，无法完整恢复');
  const fields: Record<string, unknown> = { ...structuredClone(recipe.params), prompt: recipe.prompt, negative_prompt: recipe.negative,
    characters: recipe.characters.map((c, i) => ({ ...structuredClone(c), id: `c${state.nextCharacterId + i}` })),
  };
  const rawRefs = fields.naiReferences as { vibe: Record<string, unknown>[]; precise: Record<string, unknown>[] };
  fields.naiReferences = { ...rawRefs, vibe: rawRefs.vibe.map((r, i) => ({ ...r, id: `v${i + 1}` })), precise: rawRefs.precise.map((r, i) => ({ ...r, id: `p${i + 1}` })) };
  const model = resolveModel(state.models, String(fields.model));
  if (!model) throw new Error('配方模型已不可用');
  const { changes, applied } = prepareDrawingFields(fields, state.models, [...state.samplersFor(model.id)]);
  if (Object.keys(fields).some(k => !applied.includes(k)) || Object.entries(fields).some(([k, v]) => k !== 'model' && canonical(v) !== canonical(changes[(k === 'negative_prompt' ? 'negative' : k) as keyof typeof changes]))) throw new Error('配方含当前不支持的参数，未恢复');
  const form = { ...state.form, ...changes };
  const parameters = Object.fromEntries(Object.entries(changes).filter(([key]) => Object.hasOwn(parameterSchema.properties, key)));
  parseParameters(parameters);
  for (const key of Object.keys(parameters) as ParameterKey[]) {
    // The raw form keeps dormant NAI mode even when using another model.
    if (key === 'naiMode' && !form.model.startsWith('nai-')) continue;
    const issue = parameterIssue(key, form, model);
    if (issue) throw new Error(issue);
  }
  const cap = characterCapability(form.model);
  if (cap.max && form.characters.filter(c => c.on).length > cap.max) throw new Error('角色数量超出当前模型范围');
  return { changes, form };
}
