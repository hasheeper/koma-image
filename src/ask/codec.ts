export const wordLimits = Object.freeze({ count: 200, chars: 64 });
export const replacementLimits = Object.freeze({ count: 200, chars: 200 });
export interface Replacement {
  from: string;
  to: string;
}
export type WordEncoding = "alias" | "unicode";
/** The stored spelling: NFKC, lower case, underscores as spaces. */
export const wordForm = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/[\s_]+/g, " ").trim();
export function checkWord(
  text: string,
  existing: readonly string[],
): { word: string } | { error: string } {
  const word = wordForm(text);
  if (!word) return { error: "请输入词条" };
  if (word.length > wordLimits.chars) return { error: "词条过长" };
  if (/[@\p{Cc}]/u.test(word)) return { error: "词条含有无效字符" };
  if (existing.includes(word))
    return { error: "词条已存在" };
  if (existing.length >= wordLimits.count) return { error: "词条已达上限" };
  return { word };
}

/** Literal, case-sensitive pairs. Only structure and reversible-map collisions are checked. */
export function checkReplacement(
  fromText: string,
  toText: string,
  existing: readonly Replacement[],
): { replacement: Replacement } | { error: string } {
  const from = fromText.trim(), to = toText.trim();
  if (!from || !to) return { error: "请填写原文与替换文本" };
  if (from.length > replacementLimits.chars || to.length > replacementLimits.chars)
    return { error: "替换文本过长" };
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(from + to) || /@[tT]_\d{3}u?/.test(from + to))
    return { error: "替换文本含有无效字符或保留代号" };
  if (from === to) return { error: "原文与替换文本不能相同" };
  if (existing.some((r) => r.from === from)) return { error: "原文已存在" };
  if (existing.some((r) => r.to === to)) return { error: "替换文本已被其他规则使用" };
  if (existing.length >= replacementLimits.count) return { error: "替换规则已达上限" };
  return { replacement: { from, to } };
}

export interface Codec {
  readonly active: boolean;
  encode(text: string): string;
  decode(text: string): string;
  /** Maps every string value inside plain JSON data; keys stay as they are. */
  encodeDeep<T>(value: T): T;
  decodeDeep<T>(value: T): T;
  /** Decodes streamed text, holding back a code split across chunks. */
  stream(): { push(chunk: string): string; flush(): string };
  /** Static transport guidance only; never includes local words or replacement pairs. */
  instructions(): string;
  /** Detect originals left in fields that cannot safely be rewritten (IDs, schemas, signatures). */
  containsOriginal(text: string): boolean;
}
const same = <T>(value: T) => value;
export const identityCodec: Codec = Object.freeze({
  active: false,
  encode: same,
  decode: same,
  encodeDeep: same,
  decodeDeep: same,
  stream: () => ({ push: same, flush: () => "" }),
  instructions: () => "",
  containsOriginal: () => false,
});
/** Explicit pairs follow free creation; automatic aliases have their own switch. */
export function codecFor(options: {
  adult: boolean;
  enabled: boolean;
  words: readonly string[];
  replacements?: readonly Replacement[];
  wordEncoding?: WordEncoding;
}): Codec {
  return options.adult
    ? createCodec(options.enabled ? options.words : [], options.replacements, options.wordEncoding)
    : identityCodec;
}

const deep =
  (fn: (text: string) => string) =>
  <T>(value: T): T => {
    if (typeof value === "string") return fn(value) as T;
    if (Array.isArray(value)) return value.map(deep(fn)) as T;
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, deep(fn)(v)]),
    ) as T;
  };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Codes look like @t_001: "T" marks an upper-case spelling, a trailing "u"
// an underscore spelling, so every encoded form decodes to its exact source.
// Boundaries are ASCII word characters, so codes sit flush against CJK text.
const edge = (form: string) =>
  `${/^\w/.test(form) ? "(?<!\\w)" : ""}${escape(form)}${/\w$/.test(form) ? "(?!\\w)" : ""}`;
const unicodeEscape = (text: string) =>
  Array.from({ length: text.length }, (_, i) => `\\u${text.charCodeAt(i).toString(16).padStart(4, "0")}`).join("");
export function createCodec(custom: readonly string[], rules: readonly Replacement[] = [], wordEncoding: WordEncoding = "alias"): Codec {
  const words: string[] = [];
  for (const raw of custom) {
    const checked = checkWord(raw, words);
    if ("word" in checked) words.push(checked.word);
  }
  const replacements: Replacement[] = [];
  for (const rule of rules) {
    const checked = checkReplacement(rule.from, rule.to, replacements);
    if ("replacement" in checked) replacements.push(checked.replacement);
  }
  if (!words.length && !replacements.length) return identityCodec;
  const surfaces = new Map<string, string>();
  const reverse = new Map<string, string>();
  const unicodeTargets = new Set<string>();
  words.forEach((word, i) => {
    const n = String(i + 1).padStart(3, "0");
    for (const upper of [false, true])
      for (const under of [false, true]) {
        const form = (upper ? word.toUpperCase() : word).replace(
          / /g,
          under ? "_" : " ",
        );
        const alias = wordEncoding === "unicode" ? unicodeEscape(form) : `@${upper ? "T" : "t"}_${n}${under ? "u" : ""}`;
        if (!surfaces.has(form)) surfaces.set(form, alias);
        reverse.set(alias, form);
        if (wordEncoding === "unicode") unicodeTargets.add(alias);
      }
  });
  const literal = new Set(replacements.map((r) => r.from));
  for (const { from, to } of replacements) {
    surfaces.set(from, to);
    reverse.set(to, from);
    unicodeTargets.delete(to);
  }
  const pattern = new RegExp(
    [...surfaces.keys()]
      .sort((a, b) => b.length - a.length)
      .map((s) => literal.has(s) ? escape(s) : edge(s))
      .join("|"),
    "g",
  );
  const originalPattern = new RegExp(pattern.source, "i");
  const targets = [...reverse.keys()].sort((a, b) => b.length - a.length);
  const literalTargets = new Set(replacements.map((r) => r.to));
  const reversePattern = new RegExp(targets.map((s) =>
    (unicodeTargets.has(s) ? escape(s).replace(/[a-f]/g, (c) => "[" + c + c.toUpperCase() + "]") : escape(s)) +
      (literalTargets.has(s) || unicodeTargets.has(s) ? "" : "(?![A-Za-z0-9_])"),
  ).join("|"), "g");
  const original = (match: string) => reverse.get(match) ?? (wordEncoding === "unicode" ? reverse.get(match.toLowerCase()) : undefined) ?? match;
  const decode = (text: string) => text.replace(reversePattern, original);
  const encode = (text: string) =>
    text.replace(pattern, (m) => surfaces.get(m) ?? m);
  // The reversible dictionary stays local. Only the notation is described upstream.
  const instructions = !words.length ? "" : wordEncoding === "unicode"
    ? "文本中的 \\uXXXX 是 Unicode 转义，按原字符理解；回复和草稿中可保留转义写法。"
    : "文本中形如 @t_001 的代号代表用户的本地保留标签（@T_ 为全大写，末尾 u 为下划线写法）；请根据上下文语境理解其作用，并在回复与草稿中原样保留该代号，客户端会自动还原。";
  const prefixes = new Set(targets.flatMap((s) => Array.from({ length: s.length }, (_, i) => s.slice(0, i + 1))));
  const longest = Math.max(...targets.map((s) => s.length));
  return Object.freeze({
    active: true,
    encode,
    decode,
    encodeDeep: deep(encode),
    decodeDeep: deep(decode),
    stream() {
      let held = "";
      return {
        push(chunk: string) {
          const text = held + chunk;
          let cut = text.length;
          for (let n = Math.min(longest, text.length); n > 0; n--)
            if (prefixes.has(text.slice(-n)) || wordEncoding === "unicode" && prefixes.has(text.slice(-n).toLowerCase())) { cut -= n; break; }
          // Match against the full chunk so alias boundaries and overlapping
          // literal pairs behave exactly like decoding a complete response.
          let out = "", cursor = 0;
          for (const match of text.matchAll(reversePattern)) {
            if (match.index >= cut) break;
            const end = match.index + match[0].length;
            cut = Math.max(cut, end);
            out += text.slice(cursor, match.index) + original(match[0]);
            cursor = end;
          }
          held = text.slice(cut);
          return out + text.slice(cursor, cut);
        },
        flush() {
          const text = held;
          held = "";
          return decode(text);
        },
      };
    },
    instructions: () => instructions,
    containsOriginal: (text: string) => originalPattern.test(text),
  });
}
