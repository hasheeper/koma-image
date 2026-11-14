import { object } from "../domain/value.ts";
import { parameterValue, validParameterKey, validateParameterOverrides } from "../domain/model-parameters.ts";
import type { ParameterOverrides } from "../domain/model-parameters.ts";

export interface AskParameters {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  /** OpenAI-compatible services may require the older field explicitly. */
  outputTokenField?: "max_completion_tokens" | "max_tokens";
  /** Scalar extensions use upstream names; dots address nested objects. Null disables a field. */
  custom?: ParameterOverrides;
}
const managed = new Set(["messages", "system", "systemInstruction", "tools", "tool_choice", "toolChoice", "toolConfig", "functions", "function_call", "stream_options", "generationConfig", "cachedContent", "max_tokens", "max_completion_tokens", "maxOutputTokens", "temperature", "top_p", "topP"]);
export const ASK_CUSTOM_PARAMETER_LIMIT = 64;
export const validAskParameterKey = (key: string) => validParameterKey(key) && !managed.has(key.split(".")[0]);
export const parameterPathConflict = (key: string, keys: readonly string[]) =>
  keys.some(other => key === other || key.startsWith(`${other}.`) || other.startsWith(`${key}.`));
function readCustomParameters(value: unknown): ParameterOverrides {
  const out: ParameterOverrides = {}, keys: string[] = [];
  for (const [key, field] of Object.entries(object(value)).slice(0, ASK_CUSTOM_PARAMETER_LIMIT)) {
    if (!validAskParameterKey(key) || parameterPathConflict(key, keys)) continue;
    try {
      out[key] = validateParameterOverrides({ [key]: field })[key];
      keys.push(key);
    } catch { /* Keep other valid fields when importing preferences. */ }
  }
  return out;
}
/** Only explicit, valid overrides survive persistence or a backup import. */
export function readAskParameters(value: unknown): AskParameters {
  const v = object(value), out: AskParameters = {};
  if (typeof v.maxOutputTokens === "number" && Number.isSafeInteger(v.maxOutputTokens) && v.maxOutputTokens > 0)
    out.maxOutputTokens = v.maxOutputTokens;
  if (typeof v.temperature === "number" && Number.isFinite(v.temperature) && v.temperature >= 0 && v.temperature <= 2)
    out.temperature = v.temperature;
  if (typeof v.topP === "number" && Number.isFinite(v.topP) && v.topP >= 0 && v.topP <= 1)
    out.topP = v.topP;
  if (v.outputTokenField === "max_tokens" || v.outputTokenField === "max_completion_tokens")
    out.outputTokenField = v.outputTokenField;
  const custom = readCustomParameters(v.custom);
  if (Object.keys(custom).length) out.custom = custom;
  return out;
}

/** Gemini extensions are relative to generationConfig; other protocols use body fields. */
export function customParameters(parameters?: AskParameters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(readCustomParameters(parameters?.custom)).sort(([a], [b]) => a.localeCompare(b))) {
    if (!field || !field.default) continue;
    const path = key.split("."), leaf = path.pop()!;
    let target = out;
    for (const part of path) {
      target[part] ??= {};
      target = target[part] as Record<string, unknown>;
    }
    target[leaf] = parameterValue(field, field.default);
  }
  return out;
}

export function samplingParameters(parameters?: AskParameters) {
  return {
    ...(parameters?.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters?.topP !== undefined ? { top_p: parameters.topP } : {}),
  };
}
