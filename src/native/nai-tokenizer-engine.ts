import { Tokenizer } from "@huggingface/tokenizers";

/** Use the licensed T5/Qwen vocabulary with the public client's normalization
 * and special-token behavior, without importing any third-party application code. */
export function createNaiTokenizer(config: object, encoder: "t5" | "qwen35") {
  if (encoder === "t5") return t5Counter(config as { model: { vocab: [string, number][]; unk_id: number } });
  const tokenizer = new Tokenizer(config, {});
  return (text: string) => tokenizer.encode(text).ids.length;
}

/** Unigram maximum-likelihood segmentation. NAI's T5 path uses identity
 * normalization, per-word metaspace, UTF-16 unknown units and one final EOS. */
function t5Counter(config: { model: { vocab: [string, number][]; unk_id: number } }) {
  interface Node { children: Map<string, Node>; score?: number }
  const root: Node = { children: new Map() };
  let min = Infinity;
  for (const [token, score] of config.model.vocab) {
    min = Math.min(min, score);
    let node = root;
    for (const char of token) { let child = node.children.get(char); if (!child) { child = { children: new Map() }; node.children.set(char, child); } node = child; }
    node.score = score;
  }
  return (text: string) => {
    if (!text) return 1;
    const cleaned = text.replace(/[[\]{}]/g, "").replace(/-?\d*\.?\d*::/g, "");
    let total = 1;
    for (let word of cleaned.split(/\s+/)) {
      if (!word.startsWith("▁")) word = `▁${word}`;
      const scores = new Float64Array(word.length + 1).fill(-Infinity), counts = new Uint32Array(word.length + 1);
      scores[0] = 0;
      const update = (start: number, end: number, score: number) => {
        if (scores[start] + score > scores[end]) { scores[end] = scores[start] + score; counts[end] = counts[start] + 1; }
      };
      for (let start = 0; start < word.length; start++) {
        let node = root, single = false;
        for (let end = start; end < word.length; end++) {
          const next = node.children.get(word[end]); if (!next) break; node = next;
          if (node.score !== undefined) { update(start, end + 1, node.score); if (end === start) single = true; }
        }
        if (!single) update(start, start + 1, min - 10);
      }
      total += counts[word.length];
    }
    return total;
  };
}
