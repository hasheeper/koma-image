import type { AskEvent } from "./messages.ts";

/** Adapter-only event. The provider unwraps it before the runner or UI sees it. */
export type ResponseEvent = AskEvent | { readonly type: "response-text"; readonly id: string; readonly text: string };

/** Read a top-level content string without requiring the rest of the JSON yet. */
export function createResponseStream() {
  let depth = 0, valueNext = false, key = "", role: "key" | "content" | "other" | null = null;
  let escaped = false, unicode: string | null = null, ended = false, invalid = false;
  let value = "", high = "";
  const escapes: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
  return {
    push(chunk: string): string {
      const out: string[] = [];
      const append = (char: string) => {
        if (role === "key") key += char;
        if (role !== "content") return;
        // Hold a high surrogate until its pair (possibly in the next SSE chunk).
        if (high) { out.push(high + char); high = ""; }
        else if (char.length === 1 && /[\uD800-\uDBFF]/.test(char)) high = char;
        else out.push(char);
      };
      for (const char of chunk) {
        if (invalid || ended) break;
        if (role) {
          if (unicode !== null) {
            if (!/[\da-f]/i.test(char)) { invalid = true; break; }
            unicode += char;
            if (unicode.length === 4) { append(String.fromCharCode(parseInt(unicode, 16))); unicode = null; }
          } else if (escaped) {
            escaped = false;
            if (char === "u") unicode = "";
            else if (escapes[char] !== undefined) append(escapes[char]);
            else invalid = true;
          } else if (char === "\\") escaped = true;
          else if (char === '"') {
            if (role === "content") { ended = true; if (high) { out.push(high); high = ""; } }
            role = null;
          } else append(char);
        } else if (char === '"') {
          role = depth === 1 ? valueNext ? key === "content" ? "content" : "other" : "key" : "other";
          if (role === "key") key = "";
        } else if (char === "{" || char === "[") depth++;
        else if (char === "}" || char === "]") depth--;
        else if (depth === 1 && char === ":") valueNext = true;
        else if (depth === 1 && char === ",") valueNext = false;
      }
      const text = out.join("");
      value += text;
      return text;
    },
    /** Also accepts relays that deliver the entire parsed argument object. */
    finish(content?: unknown): string {
      const rest = typeof content === "string" && content.startsWith(value) ? content.slice(value.length) : high;
      high = "";
      value += rest;
      return rest;
    },
  };
}
