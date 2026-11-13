import { boardKeys } from '../../domain/drawing.ts';
import type { DrawingForm } from '../../domain/drawing.ts';
import { readCharacters, nextCharacterId } from '../../domain/characters.ts';
import type { Picture } from '../library.ts';
import type { Draft, DraftState, DraftPlan, Change } from '../draft/types.ts';
import { draftSchema } from '../draft/schema.ts';
import { parseDraft, stateHash, validateDraft } from '../draft/validate.ts';
import { checkShape } from '../draft/schema-check.ts';
import { checkNaiInput } from '../draft/nai-input.ts';
import type { NaiDraftCheck } from '../draft/nai-input.ts';
import { canonical } from '../canonical.ts';
import { prepareRecipe } from './restore.ts';
import { recipeOf } from './recipe.ts';
import type { StagedRecipe } from './model.ts';

const allowed = new Set(['prompt_patch', 'params_patch', 'character_edit', 'restore_partial']);
// Reuse the public IMAGE step shapes; execution below enforces IMAGE-only targets.
export const stagedBranchSchema = {
  type: 'object', additionalProperties: false, required: ['base_image_id', 'label', 'steps'], properties: {
    retrospect_id: { type: 'string', minLength: 1, maxLength: 32 },
    base_image_id: { type: 'string', minLength: 1, maxLength: 32 },
    label: { type: 'string', minLength: 2, maxLength: 10 },
    description: { type: 'string', maxLength: 40 },
    edge_summary: { type: 'string', minLength: 1, maxLength: 100 },
    steps: { ...draftSchema.properties.steps, items: { anyOf: draftSchema.properties.steps.items.anyOf.filter(s => s.properties.kind.enum.some(k => allowed.has(k))) } },
  },
};
export interface StagedInput {
  retrospect_id?: string; base_image_id: string; label: string; description?: string; edge_summary?: string;
  steps: readonly Readonly<Record<string, unknown>>[];
}
export function parseStagedInput(value: Readonly<Record<string, unknown>>): StagedInput {
  checkShape(value, stagedBranchSchema, '预设分支');
  const input = value as unknown as StagedInput;
  if (input.label.trim().length < 2) throw new Error('分支名需要 2–10 字');
  for (const step of input.steps) {
    if (!allowed.has(String(step.kind)) || step.kind === 'prompt_patch' && !String(step.target).startsWith('image.')) throw new Error('预设分支仅支持 IMAGE 配方步骤');
  }
  return { ...input, label: input.label.trim(), description: input.description?.trim() };
}
export class BranchInputError extends Error {
  readonly details: unknown;
  constructor(message: string, details: unknown) { super(message); this.details = details; }
}
export function recipeFromForm(form: DrawingForm) {
  return recipeOf({ ...form, basePrompt: form.prompt, baseNegative: form.negative, localCharacters: form.characters });
}
/** Isolated candidate: no form writes, cursor moves, or real role-ID allocation. */
export async function prepareStagedRecipe(input: StagedInput, source: Picture, base: DraftState, library: readonly Picture[],
  check: (draft: Draft) => Promise<NaiDraftCheck | null> = checkNaiInput) {
  if (base.workspace !== 'image' || !/^#[hf]\d+$/.test(input.base_image_id) || source.params.tool || source.params.editId) throw new Error('预设分支需要 IMAGE 的真实配方基底');
  const baseRecipe = recipeOf(source.params);
  const prepared = prepareRecipe(baseRecipe, { form: base.form, nextCharacterId: 1, models: base.models, samplersFor: id => base.samplersByModel?.[id] ?? base.samplers });
  const form = { ...prepared.form, characters: readCharacters(source.params.localCharacters) };
  const frozen: DraftState = { ...base, form, nextCharacterId: nextCharacterId(form.characters) };
  const draft = parseDraft({ base_hash: stateHash(frozen), draft_title: input.label, steps: input.steps }, frozen, library);
  let candidate: DrawingForm | undefined;
  const plan = validateDraft(draft, frozen, { off: new Set(), inspectInput(value) { candidate = value; } });
  const issues = plan.steps.filter(s => s.enabled && s.issue);
  if (issues.length || !candidate) throw new BranchInputError(issues.map(s => s.issue).join('；') || '候选配方未就绪', { step_errors: issues.map(s => s.anchorIssue ?? { step: s.id, message: s.issue }) });
  const checked = await check(draft);
  if (checked && !checked.ok) throw new BranchInputError(checked.errors.join('；'), checked);
  const overrides = (['seed', 'batchCount'] as const).filter(k => draft.steps.some(s => s.kind === 'params_patch' && k in s.params || s.kind === 'restore_partial' && s.fields.some(f => f === k)));
  const target = structuredClone(candidate);
  const recipe = recipeFromForm(target);
  const signature = canonical({ source: source.id, recipe, overrides: Object.fromEntries(overrides.map(k => [k, target[k]])) });
  return { recipe, target, baseRecipe, overrides, signature, checked };
}
/** Reallocate role IDs only at the actual user write boundary. */
export function prepareStagedLoad(staged: StagedRecipe, state: DraftState) {
  const prepared = prepareRecipe(recipeFromForm(staged.form), { form: state.form, nextCharacterId: state.nextCharacterId ?? nextCharacterId(state.form.characters), models: state.models, samplersFor: id => state.samplersByModel?.[id] ?? state.samplers });
  const form = { ...prepared.form };
  for (const key of staged.overrides) Object.assign(form, { [key]: staged.form[key] });
  return { form, fields: Object.fromEntries(boardKeys.map(k => [k, form[k]])) as Partial<DrawingForm> };
}

/** Full form boundary, including equal fields, so asynchronous loads cannot overwrite a later edit. */
export function stagedLoadPlan(staged: StagedRecipe, state: DraftState, evolution: NonNullable<DraftPlan['stagedLoad']>['evolution'], title: string): DraftPlan {
  const { form } = prepareStagedLoad(staged, state);
  const changes: Change[] = boardKeys.map(field => ({ field, before: structuredClone(state.form[field]), after: structuredClone(form[field]) }));
  return { title, workspace: 'image', conversationId: state.conversationId, boardId: state.boardId, boardName: state.boardName,
    steps: [], changes, aligned: true, fingerprint: canonical(changes), stagedLoad: { evolution, signature: staged.signature, source: staged.base, model: form.model, references: structuredClone(form.naiReferences) } };
}
