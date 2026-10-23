import test from "node:test";
import assert from "node:assert/strict";
import { checkReplacement, checkWord, codecFor, createCodec, identityCodec } from "../src/ask/codec.ts";
import { defaultAskSettings, readAskSettings } from "../src/ask/settings.ts";

test("codec: defaults have no vocabulary, replacement rules or codebook", () => {
  const settings = defaultAskSettings();
  assert.deepEqual(settings.words, []);
  assert.deepEqual(settings.replacements, []);
  assert.equal(settings.alwaysCodec, false);
  assert.equal(createCodec([]), identityCodec);
  assert.equal(codecFor({ adult: true, enabled: true, ...settings }).table(), "");
});

test("codec: custom vocabulary accepts arbitrary words; only normalization and structural limits apply", () => {
  assert.deepEqual(checkWord("  Soft_Light  ", []), { word: "soft light" });
  assert.deepEqual(checkWord("ＦＲＥＥ", []), { word: "free" });
  assert.deepEqual(checkWord("soft light", ["soft light"]), { error: "词条已存在" });
  for (const term of ["new topic", "unknown category", "自由设定", "separate words"])
    assert.ok("word" in checkWord(term, []), term);
  assert.deepEqual(checkWord("", []), { error: "请输入词条" });
  assert.deepEqual(checkWord("x".repeat(65), []), { error: "词条过长" });
  assert.deepEqual(checkWord("@t_001", []), { error: "词条含有无效字符" });
  const settings = readAskSettings({ words: ["Soft_Light", "new topic", "SOFT LIGHT", 5, "自由设定"], preference: "x".repeat(400) });
  assert.deepEqual(settings.words, ["soft light", "new topic", "自由设定"]);
  assert.equal(settings.preference.length, 300);
});

test("codec: automatic aliases round-trip casing, underscores, CJK and whole tag boundaries", () => {
  const codec = createCodec(["soft light", "night", "柔光", "see-through"]);
  const corpus = [
    "1girl, soft light, {night}, [[柔光]], 1.2::see-through::",
    "SOFT_LIGHT, soft_light, Soft Light, NIGHT, midnight, nightingale",
    "为什么night的图会糊？柔光外露 and see-through dress",
    "@t_ partial, @t_0, @T_, email@test.example, 50% off", "",
  ];
  for (const text of corpus) assert.equal(codec.decode(codec.encode(text)), text);
  assert.equal(codec.encode("SOFT_LIGHT"), "@T_001u");
  assert.equal(codec.encode("Soft Light, midnight, nightingale"), "Soft Light, midnight, nightingale");
  assert.equal(codec.encode("柔光效果"), "@t_003效果");
  const object = { night: ["night", { nested: "SOFT_LIGHT" }], n: 1 };
  assert.deepEqual(codec.decodeDeep(codec.encodeDeep(object)), object);
  assert.ok(Object.hasOwn(codec.encodeDeep(object), "night"), "JSON keys stay literal");
});

test("codec: explicit A → B is literal, longest-first and single-pass, then reversed for text and tool arguments", () => {
  const rules = [
    { from: "red coat", to: "amber dress" }, { from: "red", to: "amber" },
    { from: "amber", to: "gold" }, { from: "[明亮]+", to: "[替身].*" },
  ];
  const codec = createCodec(["red coat"], rules);
  const source = "red coat, red, amber, RED, [明亮]+";
  assert.equal(codec.encode(source), "amber dress, amber, gold, RED, [替身].*");
  assert.equal(codec.decode(codec.encode(source)), source);
  const draft = { red: "red coat", steps: [{ anchor: "red", text: "[明亮]+" }] };
  assert.deepEqual(codec.decodeDeep(codec.encodeDeep(draft)), draft);
  assert.equal(codec.encodeDeep(draft).red, "amber dress", "explicit pair wins over automatic alias");
  assert.equal(codec.table(), createCodec(["red coat"], rules).table(), "same rules give the same static prefix");
});

test("codec: pair settings validate structure and mapping collisions, preserving exact case and spelling", () => {
  const rules = [{ from: "Red_Coat", to: "替身 B" }];
  assert.deepEqual(checkReplacement(" Red_Coat ", " 替身 B ", []), { replacement: rules[0] });
  for (const [from, to] of [["", "B"], ["A", "A"], ["A\nB", "C"], ["A", "@t_001"], ["A".repeat(201), "B"], ["Red_Coat", "other"], ["other", "替身 B"]])
    assert.ok("error" in checkReplacement(from, to, rules), `${from} → ${to}`);
  const settings = readAskSettings({ replacements: [rules[0], { from: "Red_Coat", to: "other" }, { from: "other", to: "替身 B" }, null, 5, { from: "原文", to: "新文" }] });
  assert.deepEqual(settings.replacements, [...rules, { from: "原文", to: "新文" }]);
  assert.deepEqual(readAskSettings(JSON.parse(JSON.stringify(settings))), settings);
});

test("codec: free creation gates pairs, while automatic aliases retain their own enable/retry switch", () => {
  const rules = [{ from: "A", to: "B" }];
  for (const enabled of [true, false])
    assert.equal(codecFor({ adult: false, enabled, words: ["night"], replacements: rules }), identityCodec);
  const pairsOnly = codecFor({ adult: true, enabled: false, words: ["night"], replacements: rules });
  assert.equal(pairsOnly.encode("A night"), "B night");
  assert.equal(codecFor({ adult: true, enabled: true, words: ["night"], replacements: rules }).encode("A night"), "B @t_001");
});

test("codec: streamed restoration equals complete restoration across every split, overlapping targets and alias boundaries", () => {
  const codec = createCodec(["night", "soft light"], [
    { from: "甲", to: "ab" }, { from: "乙", to: "abcd" },
    { from: "丙", to: "bc" }, { from: "丁", to: "xyz" },
    { from: "戊", to: "[替身].*" },
  ]);
  for (const encoded of [
    "前文abcd、ab、abc、bc、[替身].*后文", "@t_001xyz @t_001x @t_001 @T_002u!",
    codec.encode("night, SOFT_LIGHT, 甲, 乙, 丙, 丁, 戊"), "a", "@t_001", "@t_0", "",
  ]) {
    const expected = codec.decode(encoded);
    for (let i = 0; i <= encoded.length; i++) {
      const stream = codec.stream();
      assert.equal(stream.push(encoded.slice(0, i)) + stream.push(encoded.slice(i)) + stream.flush(), expected, `${encoded} split ${i}`);
    }
    for (const size of [1, 2, 3, 5, 7]) {
      const stream = codec.stream();
      let out = "";
      for (let i = 0; i < encoded.length; i += size) out += stream.push(encoded.slice(i, i + size));
      assert.equal(out + stream.flush(), expected, `${encoded} chunks ${size}`);
    }
  }
});
