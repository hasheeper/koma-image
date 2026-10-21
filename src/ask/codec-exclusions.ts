/**
 * Terms the codec never encodes and never accepts as custom entries: minors
 * and R18G. Reviewed in code; matching is whole-word for Latin terms and
 * substring for CJK terms, after the same normalization as custom entries.
 */
const minors = [
  "loli", "lolicon", "shota", "shotacon", "toddler", "toddlercon",
  "child", "children", "kid", "infant", "baby", "babies", "underage",
  "preteen", "prepubescent", "aged down", "elementary school",
  "elementary schooler", "kindergarten", "kindergartener",
  "萝莉", "蘿莉", "正太", "幼女", "幼童", "儿童", "兒童", "幼儿", "幼兒",
  "小学生", "小學生", "未成年", "ロリ", "ショタ", "児童",
];
const grotesque = [
  "guro", "gore", "snuff", "vore", "ryona", "necrophilia", "cannibalism",
  "dismemberment", "decapitation", "disembowelment", "evisceration",
  "mutilation", "amputation", "intestines", "internal organs", "corpse",
  "torture", "severed head", "severed limb",
  "猎奇", "獵奇", "血腥", "肢解", "断肢", "斷肢", "尸体", "屍體", "虐杀",
  "虐殺", "内脏", "內臟", "斩首", "斬首", "食人", "グロ", "リョナ",
];
/** Case, full/half width, underscores, hyphens and spacing all compare equal. */
export const normalizeTerm = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, " ").trim();
const cjk = /[\u3040-\u30ff\u3400-\u9fff]/;
export const exclusions: readonly string[] = Object.freeze(
  [...minors, ...grotesque].map(normalizeTerm),
);
// Latin terms match as whole words, plurals included.
const latin = new RegExp(
    `(?:^| )(?:${exclusions.filter((term) => !cjk.test(term)).join("|")})(?:e?s)?(?= |$)`,
  ),
  wide = exclusions.filter((term) => cjk.test(term));
export function excluded(text: string): boolean {
  const norm = normalizeTerm(text);
  return (
    latin.test(norm.replace(/[^\p{L}\p{N}]+/gu, " ")) ||
    wide.some((term) => norm.includes(term))
  );
}
