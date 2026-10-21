import { excluded } from "./codec-exclusions.ts";

/**
 * Adult terms that keyword filters on relays commonly block. Body-type and
 * age-adjacent words are left to the user; minors and R18G never appear.
 */
export const builtinWords: readonly string[] = Object.freeze([
  "nsfw", "explicit", "nude", "naked", "completely nude", "nipples",
  "areolae", "breasts", "large breasts", "huge breasts", "cleavage",
  "pussy", "penis", "sex", "cum", "anal", "fellatio", "paizuri",
]);
export const wordLimits = Object.freeze({ count: 200, chars: 64 });
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
  if (excluded(word)) return { error: "该词不在可混淆范围" };
  if (builtinWords.includes(word) || existing.includes(word))
    return { error: "词条已存在" };
  if (existing.length >= wordLimits.count) return { error: "词条已达上限" };
  return { word };
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
  /** Appended to the static system prompt; empty when inactive. */
  table(): string;
}
const same = <T>(value: T) => value;
export const identityCodec: Codec = Object.freeze({
  active: false,
  encode: same,
  decode: same,
  encodeDeep: same,
  decodeDeep: same,
  stream: () => ({ push: same, flush: () => "" }),
  table: () => "",
});
/** Only a confirmed adult user with the codec switched on gets encoding. */
export function codecFor(options: {
  adult: boolean;
  enabled: boolean;
  words: readonly string[];
}): Codec {
  return options.adult && options.enabled
    ? createCodec(options.words)
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
const code = /@([tT])_(\d{3})(u?)(?![A-Za-z0-9_])/g;
const partial = /@(?:[tT](?:_\d{0,3}u?)?)?$/;
const edge = (form: string) =>
  `${/^\w/.test(form) ? "(?<!\\w)" : ""}${escape(form)}${/\w$/.test(form) ? "(?!\\w)" : ""}`;
export function createCodec(custom: readonly string[]): Codec {
  const words: string[] = [];
  for (const raw of [...builtinWords, ...custom]) {
    const word = wordForm(raw);
    if (words.length < 999 && word && !/[@\p{Cc}]/u.test(word) && !excluded(word) && !words.includes(word))
      words.push(word);
  }
  const surfaces = new Map<string, string>();
  words.forEach((word, i) => {
    const n = String(i + 1).padStart(3, "0");
    for (const upper of [false, true])
      for (const under of [false, true]) {
        const form = (upper ? word.toUpperCase() : word).replace(
          / /g,
          under ? "_" : " ",
        );
        if (!surfaces.has(form))
          surfaces.set(form, `@${upper ? "T" : "t"}_${n}${under ? "u" : ""}`);
      }
  });
  const pattern = new RegExp(
    [...surfaces.keys()]
      .sort((a, b) => b.length - a.length)
      .map(edge)
      .join("|"),
    "g",
  );
  const decode = (text: string) =>
    text.replace(code, (match, t: string, n: string, under: string) => {
      const word = words[Number(n) - 1];
      if (!word) return match;
      const cased = t === "T" ? word.toUpperCase() : word;
      return under ? cased.replace(/ /g, "_") : cased;
    });
  const encode = (text: string) =>
    text.replace(pattern, (m) => surfaces.get(m) ?? m);
  const table = [
    "<codebook>",
    "以下代号代表原始标签，按原词理解；回复和草稿中保留代号。@T_ 为全大写写法，末尾 u 为下划线写法。",
    ...words.map((word, i) => `@t_${String(i + 1).padStart(3, "0")} ${word}`),
    "</codebook>",
  ].join("\n");
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
          const text = held + chunk,
            tail = partial.exec(text);
          held = tail ? tail[0] : "";
          return decode(tail ? text.slice(0, tail.index) : text);
        },
        flush() {
          const text = held;
          held = "";
          return decode(text);
        },
      };
    },
    table: () => table,
  });
}
