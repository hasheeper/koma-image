import { object } from "./value.ts";

/** Values stay strings in workspace preferences; conversion happens at the request boundary. */
export interface ParameterField {
  options: string[];
  /** Empty means omit the field and let the upstream choose. */
  default: string;
  type?: "string" | "number" | "boolean";
  label?: string;
  allowCustom?: boolean;
  min?: number;
  max?: number;
}
export type ParameterFields = Record<string, ParameterField>;
export type ParameterOverrides = Record<string, ParameterField | null>;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const controlled = new Set(["model", "prompt", "n", "image", "image[]", "mask", "contents", "responseModalities", "max_cost", "stream"]);
export function validParameterKey(key: string): boolean {
  const path = key.split(".");
  return key.length <= 128 && path.length <= 4 && path.every(part => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part) && !forbidden.has(part)) && !controlled.has(path[0]);
}
export function acceptsParameter(field: ParameterField, value: string): boolean {
  if (!value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) return false;
  if (field.options.length && !field.allowCustom && !field.options.includes(value)) return false;
  if (field.type === "boolean") return value === "true" || value === "false";
  if (field.type === "number") {
    const n = Number(value);
    return Number.isFinite(n) && (field.min === undefined || n >= field.min) && (field.max === undefined || n <= field.max);
  }
  return true;
}
function readField(raw: unknown): ParameterField {
  const value = object(raw);
  const options = value.options ?? [];
  if (!raw || Array.isArray(raw) || typeof raw !== "object" || !Array.isArray(options) || options.length > 128 ||
    options.some(v => !["string", "number", "boolean"].includes(typeof v) || typeof v === "number" && !Number.isFinite(v)) ||
    value.default !== undefined && value.default !== null && (!["string", "number", "boolean"].includes(typeof value.default) || typeof value.default === "number" && !Number.isFinite(value.default)) ||
    value.type !== undefined && !["string", "number", "boolean"].includes(String(value.type))) throw new Error("参数字段格式无效");
  const field: ParameterField = { options: [...new Set(options.map(String))], default: value.default === undefined || value.default === null ? "" : String(value.default) };
  if (value.type !== undefined) field.type = value.type as ParameterField["type"];
  if (typeof value.label === "string" && value.label.trim()) field.label = value.label.trim().slice(0, 80);
  if (value.allowCustom === true) field.allowCustom = true;
  for (const key of ["min", "max"] as const) {
    if (value[key] === undefined) continue;
    if (field.type !== "number" || typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new Error("参数范围无效");
    field[key] = value[key];
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max ||
    field.options.some(option => !acceptsParameter({ ...field, options: [] }, option)) ||
    field.default !== "" && !acceptsParameter(field, field.default)) throw new Error("参数选项或默认值无效");
  return field;
}
/** Persist only supported scalar schemas. Null explicitly disables an upstream/reference field. */
export function validateParameterOverrides(raw: unknown): ParameterOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 64) throw new Error("来源参数配置无效");
  const result: ParameterOverrides = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!validParameterKey(key)) throw new Error(`参数字段 ${key} 无效或由应用管理`);
    result[key] = value === null ? null : readField(value);
  }
  return result;
}
/** Discovery is optional: unsupported or malformed individual declarations remain unknown. */
export function declaredParameterFields(raw: unknown): ParameterFields {
  const result: ParameterFields = {};
  for (const [key, value] of Object.entries(object(raw)).slice(0, 64)) {
    if (!validParameterKey(key) || value === null) continue;
    try { result[key] = readField(value); } catch { /* Keep other valid declarations usable. */ }
  }
  return result;
}
export function applyParameterOverrides(fields: ParameterFields, overrides: ParameterOverrides = {}): ParameterFields {
  const result = { ...fields };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete result[key];
    else result[key] = value;
  }
  return result;
}
export function parameterValue(field: ParameterField, value: string): string | number | boolean {
  if (!acceptsParameter(field, value)) throw new Error("参数值不符合此来源的配置");
  return field.type === "number" ? Number(value) : field.type === "boolean" ? value === "true" : value;
}
/** Reject incompatible explicit options instead of silently dropping them when switching sources. */
export function requestOptions(fields: ParameterFields, raw: unknown): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(object(raw))) {
    if (value === "" || value === undefined) continue;
    const field = fields[key];
    if (!field || !acceptsParameter(field, String(value))) throw new Error(`当前来源不支持参数 ${key} 或其取值`);
    result[key] = parameterValue(field, String(value));
  }
  return result;
}
