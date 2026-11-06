import { canonical } from '../canonical.ts';
import type { EditConfiguration, EditDraftState } from '../../domain/edit-draft.ts';
import type { CatalogModel } from '../../domain/catalog.ts';
import { acceptsParameter, validParameterKey } from '../../domain/model-parameters.ts';
import { isGenerativeEditorModel } from '../../domain/media.ts';

/** Freeze the selected source's contract, never its URL or credentials. */
export function editSourceKey(s: EditDraftState, config: EditConfiguration) {
  const model = s.models.find(m => m.id === config.chosen[config.upscaleOpen ? 'upscale' : config.mode]);
  return model && isGenerativeEditorModel(model) ? canonical([model.id, model.connection, model.sourceRevision,
    model.upstreamId, model.profileId, model.fields, model.maxImages]) : undefined;
}

/** Values use the same scalar validation as the EDIT controls/request builder. */
export function patchEditOptions(model: CatalogModel, saved: Record<string, string>, patch: unknown) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).length > 64) throw new Error('image_options 需要 1～64 个来源参数');
  const result = { ...saved };
  for (const [key, value] of Object.entries(patch)) {
    if (!validParameterKey(key) || !Object.hasOwn(model.fields, key)) throw new Error(`当前来源未声明参数 ${key}，请先在模型设置中补充字段`);
    if (value === null) { delete result[key]; continue; }
    if (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value) ||
      value !== '' && !acceptsParameter(model.fields[key], String(value))) throw new Error(`参数 ${key} 的取值不符合当前来源声明`);
    result[key] = String(value);
  }
  return result;
}

/** Also runs at confirmation: a changed source must not silently reinterpret a draft. */
export function checkEditOptions(s: EditDraftState, after: EditConfiguration, model: CatalogModel) {
  for (const id of new Set([...Object.keys(s.config.options), ...Object.keys(after.options)])) {
    const before = s.config.options[id] ?? {}, next = after.options[id] ?? {};
    const patch = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(next)])]
      .filter(key => before[key] !== next[key]).map(key => [key, next[key] ?? null]));
    if (!Object.keys(patch).length) continue;
    if (id !== model.id || !isGenerativeEditorModel(model)) return '只能修改当前通用编辑模型的来源参数';
    try { patchEditOptions(model, before, patch); } catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  return '';
}
