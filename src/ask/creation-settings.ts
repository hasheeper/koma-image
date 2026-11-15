import { object } from "../domain/value.ts";
import { checkReplacement, checkWord, replacementLimits, wordLimits } from "./codec.ts";
import type { Replacement } from "./codec.ts";
import type { AskSettings } from "./settings.ts";

export type CreationSettings = Pick<AskSettings, "words" | "wordEncoding" | "replacements" | "alwaysCodec" | "responseMode">;

/** Only the creation group travels; connection settings and the device gate stay local. */
export function exportCreationSettings(value: CreationSettings) {
  return {
    app: "koma-image",
    kind: "ask-creation",
    version: 1,
    settings: {
      words: [...value.words],
      wordEncoding: value.wordEncoding,
      replacements: value.replacements.map(({ from, to }) => ({ from, to })),
      alwaysCodec: value.alwaysCodec,
      responseMode: value.responseMode,
    },
  };
}

/** Replace the group as a whole; duplicates merge before checking the final mapping. */
export function importCreationSettings(value: unknown): CreationSettings {
  const file = object(value), settings = object(file.settings);
  if (file.app !== "koma-image" || file.kind !== "ask-creation" || file.version !== 1)
    throw new Error("请选择 Koma 创作配置文件");
  if (!Array.isArray(settings.words) || !Array.isArray(settings.replacements) ||
      settings.wordEncoding !== "alias" && settings.wordEncoding !== "unicode" ||
      settings.responseMode !== "text" && settings.responseMode !== "tool" || typeof settings.alwaysCodec !== "boolean")
    throw new Error("创作配置格式无效");
  const words: CreationSettings["words"] = [], replacements: CreationSettings["replacements"] = [];
  const seenWords = new Set<string>();
  for (const [index, item] of settings.words.entries()) {
    if (typeof item !== "string") throw new Error("词条格式无效");
    const result = checkWord(item, []);
    if ("error" in result) throw new Error(`词条 ${index + 1}：${result.error}`);
    if (seenWords.has(result.word)) continue;
    seenWords.add(result.word);
    words.push(result.word);
  }
  const bySource = new Map<string, { replacement: Replacement; position: number }>();
  for (const [index, item] of settings.replacements.entries()) {
    const rule = object(item);
    if (typeof rule.from !== "string" || typeof rule.to !== "string") throw new Error("替换规则格式无效");
    const replacement = { from: rule.from.trim(), to: rule.to.trim() };
    bySource.set(replacement.from, { replacement, position: index + 1 });
  }
  if (words.length > wordLimits.count || bySource.size > replacementLimits.count)
    throw new Error("创作配置条目超过上限");
  for (const { replacement, position } of bySource.values()) {
    const result = checkReplacement(replacement.from, replacement.to, replacements);
    if ("error" in result) throw new Error(`替换 ${position}：${result.error}`);
    replacements.push(result.replacement);
  }
  return {
    words, replacements,
    wordEncoding: settings.wordEncoding === "unicode" ? "unicode" : "alias",
    alwaysCodec: settings.alwaysCodec,
    responseMode: settings.responseMode === "tool" ? "tool" : "text",
  };
}
