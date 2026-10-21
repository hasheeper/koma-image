/**
 * A deep copy whose object keys are inserted in sorted order, so JSON.stringify
 * gives the same bytes for equal values. Prefix caching depends on this.
 */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort())
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  return out;
}
export const canonical = (value: unknown) => JSON.stringify(sortKeys(value));
