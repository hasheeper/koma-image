import type { AskRequest } from "./messages.ts";
import { namingPrompt } from "./prompts/naming.ts";

export type NamingTarget = { kind: "conversation" | "board"; id: string };
export type NamingTurn = { question: string; reply: string };
export type NamingContent =
  | { kind: "conversation"; content: NamingTurn[] }
  | { kind: "board"; content: { prompt: string; characters: { prompt: string }[] } };

/** First goal plus the recent discussion; no tools, state, pixels or other conversations. */
export function conversationNameContent(turns: readonly NamingTurn[]): NamingContent {
  const selected = turns.length > 5 ? [turns[0]!, ...turns.slice(-4)] : turns;
  return { kind: "conversation", content: selected.map(t => ({ question: t.question.trim().slice(0, 1400), reply: t.reply.trim().slice(0, 1000) })) };
}
/** Only positive descriptions of this board and its enabled characters are relevant. */
export function boardNameContent(form: { prompt: string; characters: readonly { on: boolean; prompt: string }[] }): NamingContent {
  return { kind: "board", content: { prompt: form.prompt.trim().slice(0, 6000), characters: form.characters.filter(c => c.on && c.prompt.trim()).slice(0, 6).map(c => ({ prompt: c.prompt.trim().slice(0, 1000) })) } };
}
export function namingRequest(model: string, source: NamingContent): AskRequest {
  const hasText = source.kind === "board"
    ? source.content.prompt || source.content.characters.some(c => c.prompt)
    : source.content.some(t => t.question || t.reply);
  if (!hasText) throw new Error(source.kind === "board" ? "先填写画板描述，再生成名称" : "先开始对话，再生成名称");
  return { model, tools: [], system: [namingPrompt, ""], messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(source) }] }], maxTokens: 256 };
}
/** Tolerate a wrapped title; never silently install multiple suggestions or a truncated reply. */
export function readGeneratedName(text: string, limit: number): string {
  let name = text.trim();
  for (const [start, end] of [["**", "**"], ["\"", "\""], ["“", "”"], ["「", "」"], ["`", "`"]] as const)
    if (name.startsWith(start) && name.endsWith(end)) name = name.slice(start.length, -end.length).trim();
  if (!name || name.length > limit || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(name))
    throw new Error("未返回有效的单行名称，请重试");
  return name;
}
