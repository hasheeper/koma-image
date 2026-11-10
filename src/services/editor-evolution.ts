import type { EditorSession, EditorVersion } from './editor.ts';
import type { EvolutionInput } from '../domain/evolution-input.ts';
import { evolutionMask } from '../domain/evolution-input.ts';
import { qualifiedEditLabel } from '../domain/edit-identity.ts';
import type { MaskBitmap } from '../native/edit-input.ts';
import type { AnnotationSnapshot } from '../domain/region-annotation.ts';
import { annotationSummary } from '../domain/region-annotation.ts';
import { activeCharacters } from '../domain/characters.ts';

export async function editorEvolutionInput(s: EditorSession, parent: EditorVersion, operation: string,
  model: string | null, generic: boolean, params: Readonly<Record<string, unknown>>, mask?: MaskBitmap | null, annotations?: AnnotationSnapshot): Promise<EvolutionInput> {
  const prompt = operation === 'upscale' || operation === 'photopea' ? '' : s.fields.prompt;
  const negative = generic || operation === 'upscale' || operation === 'photopea' ? '' : s.fields.negative_prompt;
  const characters = generic || !model || operation === 'upscale' ? [] : structuredClone(activeCharacters(s.characters, model));
  const keys = ['width','height','steps','sampler','scale','cfg_rescale','noise_schedule','strength','noise','varietyPlus','enhance','enhanceScale','enhanceMagnitude','transparentBg'];
  const effective = generic ? { ...(params.image_options as Record<string, unknown> ?? {}) } : Object.fromEntries(keys.filter(k => params[k] !== undefined).map(k => [k, params[k]]));
  if (!generic && operation !== 'upscale' && operation !== 'photopea') { effective.placement = s.placement; effective.naiReferences = structuredClone(s.naiReferences); }
  return { workspace: 'edit', operation, prompt, negative, characters, params: { ...(model ? { model } : {}), ...effective,
    ...(mask && operation !== 'photopea' ? { ...s.imageEdit.edges } : {}), ...(params.inpaintFocus ? { focus: params.inpaintFocus } : {}) },
    base: { id: parent.recordId, label: qualifiedEditLabel(s, parent) }, mask: await evolutionMask(mask ?? null),
    ...(annotations ? { annotations: JSON.stringify(annotationSummary(annotations.regions)) } : {}) };
}
