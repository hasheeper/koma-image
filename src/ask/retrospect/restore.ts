import { boardKeys, prepareDrawingFields } from '../../domain/drawing.ts';
import { resolveModel } from '../../domain/catalog.ts';
import { characterCapability } from '../../domain/characters.ts';
import { activeReferences, referenceOperation } from '../../domain/nai-references.ts';
import type { ApplicationServices } from '../../services/application.ts';
import type { Drawing } from '../../services/drawing.ts';
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
/** Explicit UI restore; associated cursor commits only after the leased write succeeds. */
export async function restoreRecipe(recipe: Recipe, drawing: Drawing, references: ApplicationServices['references'], available: () => boolean, commit?: () => void, targetBoardId?: string) {
  if (recipe.input) throw new Error('此配方应恢复到其来源工作区');
  const snapshot = drawing.snapshot(), boardId = targetBoardId ?? snapshot.activeBoardId, board = snapshot.boards.find(b => b.id === boardId);
  if (!board) throw new Error('目标画板已删除');
  const expected = structuredClone(Object.fromEntries(boardKeys.map(k => [k, board.form[k]])));
  const { changes, form } = prepareRecipe(recipe, { form: { ...snapshot.form, ...board.form }, nextCharacterId: board.nextCharacterId, models: snapshot.models, samplersFor: drawing.samplersFor });
  await references.ready();
  if (activeReferences(form.naiReferences).length && (!referenceOperation(form.model, form.naiReferences.active!) || references.cachedCost(form.naiReferences, form.model) === undefined)) throw new Error('配方参考图或编码已不可用');
  if (!available()) throw new Error('原记录已失效，无法恢复配方');
  if (drawing.snapshot().activeBoardId !== snapshot.activeBoardId) throw new Error('活动画板已切换，请重新恢复');
  await drawing.writeDraft(changes, expected, boardId);
  try { commit?.(); } catch (error) {
    await drawing.writeDraft(Object.fromEntries(Object.keys(changes).map(k => [k, expected[k]])), changes, boardId);
    throw error;
  }
}
