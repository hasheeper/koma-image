import test from "node:test";
import assert from "node:assert/strict";
import { builtinWords, checkWord, codecFor, createCodec, identityCodec } from "../src/ask/codec.ts";
import { excluded, exclusions, normalizeTerm } from "../src/ask/codec-exclusions.ts";
import { readAskSettings } from "../src/ask/settings.ts";

const corpus = [
  "1girl, nsfw, large breasts, {large breasts}, [[cleavage]], 1.2::huge breasts::, rating:explicit",
  "NSFW, LARGE_BREASTS, large_breasts, Large Breasts, sexy, sextant, cumulus, analysis",
  "为什么 nsfw的图 会糊？乳头外露 and see-through dress",
  "@t_ partial, @t_0, @T_, email@test.example, 50% off",
  "",
];

test("codec: every encoded string decodes to its exact source, including case and underscore spellings", () => {
  const codec = createCodec(["乳头", "see-through"]);
  for (const text of corpus) assert.equal(codec.decode(codec.encode(text)), text);
  const encoded = codec.encode(corpus[0]);
  for (const word of ["nsfw", "large breasts", "cleavage", "huge breasts", "explicit"]) assert.equal(encoded.includes(word), false, word);
  assert.match(codec.encode("NSFW"), /^@T_\d{3}$/);
  assert.match(codec.encode("large_breasts"), /^@t_\d{3}u$/);
  // Whole tags only: substrings of longer words and mixed case stay as written.
  assert.equal(codec.encode("sexy, sextant, cumulus, analysis, Large Breasts"), "sexy, sextant, cumulus, analysis, Large Breasts");
  assert.equal(codec.encode("乳头外露").startsWith("@t_"), true);
  assert.equal(codec.decodeDeep({ tags: ["@t_001", { nested: "@T_001" }], n: 1 }).tags[1].nested, "NSFW");
});

test("codec: excluded terms always leave as written, in any spelling", () => {
  const codec = createCodec(["loli", "Guro", "petite"]);
  for (const text of ["loli, nsfw", "LOLI", "ｌｏｌｉ", "toddler_body", "guro", "萝莉 nsfw", "shotas"]) {
    const out = codec.encode(text);
    for (const term of ["loli", "LOLI", "ｌｏｌｉ", "toddler_body", "guro", "萝莉", "shotas"])
      if (text.includes(term)) assert.equal(out.includes(term), true, `${term} in ${out}`);
  }
  assert.equal(codec.encode("petite"), "@t_" + String(builtinWords.length + 1).padStart(3, "0"));
  assert.ok(builtinWords.every((w) => !excluded(w)));
  assert.ok(codec.table().includes("petite") && !codec.table().includes("loli") && !codec.table().includes("guro"));
});

test("codec: custom entries are normalized, deduplicated and refused when excluded", () => {
  assert.deepEqual(checkWord("  See_Through  ", []), { word: "see through" });
  assert.deepEqual(checkWord("ＮＳＦＷ", []), { error: "词条已存在" });
  assert.deepEqual(checkWord("see through", ["see through"]), { error: "词条已存在" });
  for (const term of ["LOLI", "Loli_Body", "ｌｏｌｉ", "shota-con", "Shotacon", "children", "elementary_schooler", "幼女", "GORE", "severed_head", "リョナ"])
    assert.deepEqual(checkWord(term, []), { error: "该词不在可混淆范围" }, term);
  for (const term of ["lolita fashion", "childhood friend", "kidney", "mature female"])
    assert.ok("word" in checkWord(term, []), term);
  assert.deepEqual(checkWord("", []), { error: "请输入词条" });
  assert.deepEqual(checkWord("x".repeat(65), []), { error: "词条过长" });
  assert.deepEqual(checkWord("@t_001", []), { error: "词条含有无效字符" });
  assert.equal(normalizeTerm("Ａged_Down"), "aged down");
  assert.ok(exclusions.includes("aged down"));
  const settings = readAskSettings({ words: ["see_through", "loli", "SEE THROUGH", 5, "nsfw"], preference: "x".repeat(400), model: "has space", images: "yes" });
  assert.deepEqual(settings.words, ["see through"]);
  assert.equal(settings.preference.length, 300);
  assert.equal(settings.model, "has space");
  assert.equal(settings.images, true);
});

test("codec: gated by the adult confirmation; identity otherwise", () => {
  for (const options of [{ adult: false, enabled: true }, { adult: true, enabled: false }, { adult: false, enabled: false }]) {
    const codec = codecFor({ ...options, words: ["see through"] });
    assert.equal(codec, identityCodec);
    assert.equal(codec.encode(corpus[0]), corpus[0]);
    assert.equal(codec.table(), "");
  }
  assert.equal(codecFor({ adult: true, enabled: true, words: [] }).active, true);
});

test("codec: deterministic table and a stream decoder that holds codes split across chunks", () => {
  assert.equal(createCodec(["a b"]).table(), createCodec(["a b"]).table());
  assert.equal(createCodec(["a b"]).encode(corpus[1]), createCodec(["a b"]).encode(corpus[1]));
  const codec = createCodec([]), text = "NSFW, large_breasts! nsfw的 @t_9 end",
    encoded = codec.encode(text);
  for (const size of [1, 2, 3, 5, 7]) {
    const stream = codec.stream();
    let out = "";
    for (let i = 0; i < encoded.length; i += size) out += stream.push(encoded.slice(i, i + size));
    out += stream.flush();
    assert.equal(out, codec.decode(encoded), `chunk ${size}`);
  }
});
