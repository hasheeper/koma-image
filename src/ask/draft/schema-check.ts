/** Validate the subset used by the shared tool schema; semantic checks stay in parseDraft. */
interface Shape {
  type?: string; enum?: readonly unknown[]; anyOf?: readonly Shape[]; properties?: Record<string, Shape | undefined>;
  additionalProperties?: boolean; required?: readonly string[]; items?: Shape;
  minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; minProperties?: number;
  minimum?: number; maximum?: number;
}
export function checkShape(value: unknown, schema: Shape, path = "草稿"): void {
  if (schema.anyOf) {
    for (const branch of schema.anyOf) { try { checkShape(value, branch, path); return; } catch { /* Try the other declared step shapes. */ } }
    throw new Error(`${path} 不符合支持的步骤结构`);
  }
  const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type && (schema.type === "integer" ? !Number.isSafeInteger(value) : type !== schema.type)) throw new Error(`${path} 类型无效`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} 选项无效`);
  if (typeof value === "string" && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) throw new Error(`${path} 长度无效`);
  if (typeof value === "number" && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path} 超出范围`);
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path} 数量无效`);
    if (schema.items) value.forEach((v, i) => checkShape(v, schema.items!, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length < (schema.minProperties ?? 0)) throw new Error(`${path} 不能为空`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(obj, key)) throw new Error(`${path} 缺少 ${key}`);
    for (const [key, item] of Object.entries(obj)) {
      const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (child) checkShape(item, child, `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${path} 不支持 ${key}`);
    }
  }
}
