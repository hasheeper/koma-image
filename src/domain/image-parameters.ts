import { DEFAULTS } from "./drawing.ts";
import { readCharacters } from "./characters.ts";
import { readReferences } from "./nai-references.ts";

const parameterKeys = [...Object.keys(DEFAULTS), "basePrompt", "baseNegative", "negative_prompt", "modelName", "randomSeed", "batchIndex", "batchTotal", "seedStart", "cache", "transform_prompt", "transform_mode", "strength", "noise", "noise_schedule", "cfg_rescale", "tool", "boardId", "boardName", "boardColor", "isComparison", "comparisonTotal", "version", "image_index", "selected"];
/** Exact names/values of known snapshot fields; never copy a service or arbitrary upstream object. */
export function imageParameters(params: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = {};
  for (const key of parameterKeys) if (params[key] === null || ["string", "number", "boolean"].includes(typeof params[key])) out[key] = params[key];
  for (const key of ["characters", "localCharacters"]) if (Array.isArray(params[key])) out[key] = readCharacters(params[key]);
  if (params.placement === "auto" || params.placement === "manual") out.placement = params.placement;
  if (params.naiReferences) out.naiReferences = readReferences(params.naiReferences);
  return out;
}
