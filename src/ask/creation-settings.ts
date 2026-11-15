import { object } from "../domain/value.ts";
import { checkReplacement, checkWord, replacementLimits, wordLimits } from "./codec.ts";
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

/** Reject the whole file on invalid entries instead of silently dropping user rules. */
export function importCreationSettings(value: unknown): CreationSettings {
  const file = object(value), settings = object(file.settings);
  if (file.app !== "koma-image" || file.kind !== "ask-creation" || file.version !== 1)
    throw new Error("请选择 Koma 创作配置文件");
  if (!Array.isArray(settings.words) || !Array.isArray(settings.replacements) ||
      settings.wordEncoding !== "alias" && settings.wordEncoding !== "unicode" ||
      settings.responseMode !== "text" && settings.responseMode !== "tool" || typeof settings.alwaysCodec !== "boolean")
    throw new Error("创作配置格式无效");
  if (settings.words.length > wordLimits.count || settings.replacements.length > replacementLimits.count)
    throw new Error("创作配置条目超过上限");
  const words: CreationSettings["words"] = [], replacements: CreationSettings["replacements"] = [];
  for (const item of settings.words) {
    if (typeof item !== "string") throw new Error("词条格式无效");
    const result = checkWord(item, words);
    if ("error" in result) throw new Error(`词条 ${words.length + 1}：${result.error}`);
    words.push(result.word);
  }
  for (const item of settings.replacements) {
    const rule = object(item);
    if (typeof rule.from !== "string" || typeof rule.to !== "string") throw new Error("替换规则格式无效");
    const result = checkReplacement(rule.from, rule.to, replacements);
    if ("error" in result) throw new Error(`替换 ${replacements.length + 1}：${result.error}`);
    replacements.push(result.replacement);
  }
  return {
    words, replacements,
    wordEncoding: settings.wordEncoding === "unicode" ? "unicode" : "alias",
    alwaysCodec: settings.alwaysCodec,
    responseMode: settings.responseMode === "tool" ? "tool" : "text",
  };
}
