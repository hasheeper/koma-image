import { analyze } from "../../domain/highlight.ts";

export type SegmentKind =
  | "artist_mix"
  | "style_tags"
  | "subject"
  | "modifier"
  | "freeform";
/** One comma-separated piece of a prompt, located by offsets into the source. */
export interface Segment {
  readonly kind: SegmentKind;
  /** As written, weight syntax included. */
  readonly text: string;
  /** Without weight syntax, lower case. */
  readonly tag: string;
  readonly weight: number;
  readonly start: number;
  readonly end: number;
}
/** Danbooru category of a tag where the dictionary knows it; 1 is artist. */
export type CategoryOf = (tag: string) => number | undefined;

const style =
  /^(?:masterpiece|best quality|(?:high|amazing|great|good|normal|low|worst) quality|very aesthetic|aesthetic|absurdres|highres|lowres|year \d{4}|(?:[a-z-]+ )?(?:art style|style|coloring|colouring|shading|lineart|painting|illustration|sketch|rendering|medium)|watercolor(?: \(medium\))?|flat colou?r|monochrome|greyscale|grayscale|realistic|photorealistic|semi-realistic|anime|chibi|pixel art|3d|2d|traditional media|official art|game cg|limited palette|retro artstyle|ukiyo-e|impressionism|jpeg artifacts|blurry|watermark|signature|text)$/;
const modifier =
  /^(?:backlighting|backlit|sunlight|moonlight|light rays|light particles|bloom|lens flare|bokeh|depth of field|chromatic aberration|sunset|sunrise|night|dusk|dawn|golden hour|overcast|from (?:above|below|side|behind)|close-up|cowboy shot|full body|upper body|lower body|portrait|wide shot|dutch angle|pov|foreshortening|looking at viewer|looking (?:away|back|up|down)|perspective|fisheye|cinematic|dramatic|atmospheric|volumetric lighting|high contrast|vignette|silhouette|reflection|outdoors|indoors|scenery|landscape)$|(?:^| )(?:light|lighting|shadows?|background)$/;
const sentence = /[.!?。！？]$/;
const cjk = /[぀-ヿ㐀-鿿豈-﫿]/g;

function classify(tag: string, category?: CategoryOf): SegmentKind {
  if (/^artist\s*:/.test(tag) || category?.(tag.replaceAll(" ", "_")) === 1)
    return "artist_mix";
  const words = tag.split(/\s+/).filter(Boolean).length;
  if (
    (words >= 6 && !tag.includes("_")) ||
    sentence.test(tag) ||
    (tag.match(cjk)?.length ?? 0) >= 8
  )
    return "freeform";
  if (style.test(tag)) return "style_tags";
  if (modifier.test(tag)) return "modifier";
  return "subject";
}
/**
 * Splits a prompt at commas and line breaks and tags each piece with a kind.
 * Weights come from the highlighter's own tokens, so `{blue eyes}` and
 * `1.3::blue eyes::` read the same as they do in the prompt box.
 */
export function segments(text: string, category?: CategoryOf): Segment[] {
  const weights = new Float64Array(text.length).fill(1),
    syntax = new Uint8Array(text.length);
  let at = 0;
  for (const token of analyze(text)) {
    weights.fill(token.weight, at, at + token.text.length);
    if (token.syntax) syntax.fill(1, at, at + token.text.length);
    at += token.text.length;
  }
  const out: Segment[] = [];
  const pieces = /[^,，\n]+/g;
  for (const match of text.matchAll(pieces)) {
    const raw = match[0],
      lead = raw.length - raw.trimStart().length,
      start = match.index + lead,
      end = match.index + raw.trimEnd().length;
    if (end <= start) continue;
    let bare = "",
      weight = 1,
      first = -1;
    for (let i = start; i < end; i++) {
      if (syntax[i]) continue;
      if (first < 0 && text[i].trim()) first = i;
      bare += text[i];
    }
    const tag = bare.trim().replace(/\s+/g, " ").toLowerCase();
    if (!tag) continue;
    if (first >= 0) weight = Math.round(weights[first] * 100) / 100;
    out.push({
      kind: classify(tag, category),
      text: text.slice(start, end),
      tag,
      weight,
      start,
      end,
    });
  }
  return out;
}
/** Consecutive pieces of one kind merged back into source spans, for the digest. */
export function sections(text: string, category?: CategoryOf) {
  const out: { kind: SegmentKind; text: string }[] = [];
  let run: { kind: SegmentKind; start: number; end: number } | null = null;
  for (const s of segments(text, category)) {
    if (run && run.kind === s.kind) {
      run.end = s.end;
      continue;
    }
    if (run) out.push({ kind: run.kind, text: text.slice(run.start, run.end) });
    run = { kind: s.kind, start: s.start, end: s.end };
  }
  if (run) out.push({ kind: run.kind, text: text.slice(run.start, run.end) });
  return out;
}
