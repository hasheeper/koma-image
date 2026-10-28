import { readInpaintFocus } from "./inpaint-focus.ts";
import { DEFAULTS } from "./drawing.ts";
import { readCharacters } from "./characters.ts";
import { readReferences } from "./nai-references.ts";
import { imageOrigin } from "./image-origin.ts";

const parameterKeys = [...Object.keys(DEFAULTS), "basePrompt", "baseNegative", "negative_prompt", "modelName", "randomSeed", "batchIndex", "batchTotal", "seedStart", "cache", "transform_prompt", "transform_mode", "strength", "noise", "noise_schedule", "cfg_rescale", "enhance", "enhanceScale", "enhanceMagnitude", "tool", "directorTool", "directorVariant", "directorGroup", "directorWidth", "directorHeight", "defry", "emotion", "boardId", "boardName", "boardColor", "isComparison", "comparisonTotal", "version", "image_index", "selected"];
function recipeParameters(params: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = {};
  for (const key of parameterKeys) if (params[key] === null || ["string", "number", "boolean"].includes(typeof params[key])) out[key] = params[key];
  for (const key of ["characters", "localCharacters"]) if (Array.isArray(params[key])) out[key] = readCharacters(params[key]);
  const focus = readInpaintFocus(params.inpaintFocus);
  if (focus) out.inpaintFocus = focus;
  if (params.placement === "auto" || params.placement === "manual") out.placement = params.placement;
  if (params.naiReferences) out.naiReferences = readReferences(params.naiReferences);
  Object.assign(out, imageOrigin(params));
  if (params.tool === "chat" && params.chat_options && typeof params.chat_options === "object" && !Array.isArray(params.chat_options)) {
    out.chat_options = Object.fromEntries(Object.entries(params.chat_options).filter(([, value]) => typeof value === "string"));
  }
  return out;
}

/** A manual result has a source recipe, not a new generation seed or provider. */
export function sourceRecipe(params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return ["manual-edit", "director"].includes(String(params.tool)) && params.sourceRecipe && typeof params.sourceRecipe === "object" && !Array.isArray(params.sourceRecipe)
    ? params.sourceRecipe as Record<string, unknown> : params;
}

/** Exact known snapshot fields; no service, credential or arbitrary upstream object. */
export function imageParameters(params: Readonly<Record<string, unknown>>) {
  const out = recipeParameters(params);
  if (params.tool === "manual-edit" || params.tool === "director") {
    for (const key of ["editSource", "editId", "editParent", "editedAt"]) if (typeof params[key] === "string") out[key] = params[key];
    out.sourceRecipe = recipeParameters(sourceRecipe(params));
  }
  return out;
}
