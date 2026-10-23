import { canonical } from "../canonical.ts";
import { comparisonPrompt, differences, metadata, promptDiff, promptOf, similarity } from "../library.ts";
import type { DigestImage } from "./index.ts";

type Labeled = DigestImage & { readonly label: string };
/** Consecutive cold runs with identical prompts/model/size. No time-based noise. */
export function cluster(items: readonly Labeled[]) {
  const groups: Labeled[][] = [];
  let signature = "";
  for (const item of items) {
    const m = metadata(item), key = canonical({ prompt: m.prompt, negative: m.negative, model: m.model, width: m.width, height: m.height, characters: m.characters, placement: m.placement });
    if (!groups.length || key !== signature) groups.push([]);
    groups.at(-1)!.push(item);
    signature = key;
  }
  return groups.map((group) => {
    const reference = group[0], varying = new Map<string, unknown[]>();
    for (const image of group.slice(1))
      for (const key of Object.keys(differences(reference, image))) {
        const values = varying.get(key) ?? [metadata(reference)[key]];
        values.push(metadata(image)[key]);
        varying.set(key, values);
      }
    return {
      ids: group.map((i) => i.label), count: group.length,
      prompt: promptOf(reference).slice(0, 120),
      model: reference.params.modelName ?? reference.params.model,
      changes: Object.fromEntries([...varying].map(([key, values]) => [key,
        values.every((v) => typeof v === "number")
          ? { min: Math.min(...values as number[]), max: Math.max(...values as number[]) }
          : [...new Set(values.map((v) => String(v ?? "")))].slice(0, 5),
      ])),
    };
  });
}
export function historyIndex(items: readonly Labeled[], anchor: Labeled | null) {
  if (anchor) {
    const t1: Record<string, unknown>[] = [], t2: Record<string, unknown>[] = [], rest: Labeled[] = [];
    for (const item of items) {
      if (item.id === anchor.id) continue;
      if (comparisonPrompt(item) === comparisonPrompt(anchor))
        t1.push({ id: item.label, changes: differences(anchor, item) });
      else if (similarity(comparisonPrompt(anchor), comparisonPrompt(item)) >= 0.9)
        t2.push({ id: item.label, changes: differences(anchor, item), prompt_diff: promptDiff(promptOf(anchor), promptOf(item)) });
      else rest.push(item);
    }
    return { mode: "A", anchor: { id: anchor.label, ...metadata(anchor) }, t1, t2, cold: cluster(rest) };
  }
  return {
    mode: "B",
    count: items.length,
    latest_id: items[0]?.label ?? null,
  };
}
