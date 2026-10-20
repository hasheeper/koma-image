/**
 * Read generation parameters back out of an image file.
 *
 * Two dialects are understood:
 *
 *   NovelAI  — a PNG `Comment` text chunk holding JSON, with `Software`
 *              set to NovelAI and the prompt mirrored into `Description`.
 *   WebUI    — the A1111 `parameters` text chunk: prompt, then an optional
 *              "Negative prompt:" block, then a trailing line of
 *              "Key: value, Key: value" pairs.
 *
 * `fields` holds only what this app can actually drive. Values that look
 * plausible but mean something different upstream are deliberately dropped
 * rather than guessed at — see the note on `cfg` below. Everything else worth
 * knowing about the image (character prompts, noise schedule, references…)
 * comes back in `extras` as read-only label/value pairs, so the import view
 * can show it without pretending it will carry over.
 */

export type ImageFields = {
  prompt?: string;
  negative_prompt?: string;
  model?: string;
  sampler?: string;
  width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  seed?: number;
  /** Used by in-memory history import; file parsers never map CFG Rescale here. */
  cfg?: number;
};
type Extra = { label: string; value: string };
type ParsedMetadata = {
  dialect: string;
  source?: string;
  fields: ImageFields;
  extras: Extra[];
};
export interface ImageMetadata extends ParsedMetadata { name: string }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const MAX_BYTES = 40 * 1024 * 1024;

const latin1 = new TextDecoder("latin1");
const utf8Loose = new TextDecoder("utf-8");
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

/* PNG tEXt is Latin-1 by spec, but every generator in practice writes UTF-8
   bytes into it, which matters the moment a prompt contains CJK. Try strict
   UTF-8 first and fall back only when the bytes cannot be valid UTF-8. */
function decodeText(bytes: Uint8Array): string {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function splitNul(bytes: Uint8Array<ArrayBuffer>, from = 0): [Uint8Array<ArrayBuffer>, number] {
  const at = bytes.indexOf(0, from);
  return at < 0 ? [bytes.subarray(from), bytes.length] : [bytes.subarray(from, at), at + 1];
}

/** Collect every textual chunk in a PNG, keyed by keyword. */
async function readPngText(bytes: Uint8Array<ArrayBuffer>): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;

  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = latin1.decode(bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IEND") break;
    if (length > bytes.length) break;

    try {
      if (type === "tEXt") {
        const [key, next] = splitNul(body);
        found.set(latin1.decode(key), decodeText(body.subarray(next)));
      } else if (type === "zTXt") {
        const [key, next] = splitNul(body);
        found.set(latin1.decode(key), decodeText(await inflate(body.subarray(next + 1))));
      } else if (type === "iTXt") {
        const [key, afterKey] = splitNul(body);
        const compressed = body[afterKey] === 1;
        const [, afterLang] = splitNul(body, afterKey + 2);
        const [, afterTranslated] = splitNul(body, afterLang);
        const payload = body.subarray(afterTranslated);
        found.set(latin1.decode(key), compressed ? utf8Loose.decode(await inflate(payload)) : utf8Loose.decode(payload));
      }
    } catch {
      /* A single malformed chunk should not abandon the rest of the file. */
    }
    at += 12 + length;
  }
  return found;
}

/* JPEG keeps no PNG chunks. NovelAI and most WebUI exports write the same
   payload into an EXIF UserComment, which is enough to find by scanning for
   the JSON or the parameters block rather than walking the full TIFF tree. */
function readJpegText(bytes: Uint8Array): Map<string, string> {
  const found = new Map<string, string>();
  const text = latin1.decode(bytes);
  const json = /\{"prompt":[\s\S]*?\}(?=\u0000|$)/.exec(text);
  if (json) found.set("Comment", decodeText(bytes.subarray(json.index, json.index + json[0].length)));
  const webui = /[\s\S]{0,8000}?Steps:\s*\d+[^\u0000]*/.exec(text);
  if (!json && webui) found.set("parameters", decodeText(bytes.subarray(webui.index, webui.index + webui[0].length)));
  return found;
}

const SAMPLER_ALIASES: Record<string, string | undefined> = {
  "euler a": "k_euler_ancestral",
  "euler ancestral": "k_euler_ancestral",
  euler: "k_euler",
  "dpm++ 2m": "k_dpmpp_2m",
  "dpm++ 2m karras": "k_dpmpp_2m",
  "dpm++ 2s a": "k_dpmpp_2s_ancestral",
  "dpm++ sde": "k_dpmpp_sde",
  "dpm++ sde karras": "k_dpmpp_sde",
  ddim: "ddim_v3",
  plms: "plms"
};

function normalizeSampler(value: unknown): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^k_|^ddim|^plms/i.test(raw)) return raw.toLowerCase();
  return SAMPLER_ALIASES[raw.toLowerCase()];
}

function finiteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

/* "NovelAI Diffusion V4.5 C02D4F98" names the release; the trailing hash
   is the checkpoint and means nothing to a reader. */
function naiSource(name: unknown): string | undefined {
  const text = String(name || "").replace(/\s+[0-9a-f]{8}$/i, "").trim();
  return text || undefined;
}

/* Releases map onto this app's model IDs by version. The hash cannot tell
   Full from Curated, so an unlabelled V4 / V4.5 image reads as Full. */
function naiModel(source: string | undefined): string | undefined {
  const match = String(source || "").match(/NovelAI Diffusion V(\d+)(?:\.(\d+))?/i);
  if (!match) return undefined;
  return `nai-diffusion-${match[1]}${match[2] ? `-${match[2]}` : ""}-${/curated/i.test(source || "") ? "curated" : "full"}`;
}

/** JSON children stay unknown; preserve optional property access, including primitive boxing. */
function field(value: unknown, key: string | number): unknown {
  return value == null ? undefined : Reflect.get(Object(value), key);
}

/* NAI places characters on a 5×5 grid, columns A–E and rows 1–5. */
function gridCell(center: unknown): string {
  const cell = (value: unknown) => Math.min(4, Math.max(0, Math.floor(Number(value) * 5)));
  return center && Number.isFinite(Number(field(center, "x"))) && Number.isFinite(Number(field(center, "y")))
    ? `${"ABCDE"[cell(field(center, "x"))]}${cell(field(center, "y")) + 1}`
    : "";
}

function naiExtras(data: Record<string, unknown>): Extra[] {
  const extras: Extra[] = [];
  const add = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    extras.push({ label, value: String(value) });
  };
  const request = String(data.request_type || "");
  if (/img2img/i.test(request) || /infill|inpaint/i.test(request)) {
    add("生成方式", /img2img/i.test(request) ? "图生图" : "局部重绘");
    add("重绘强度", finiteNumber(data.strength));
    add("噪声", finiteNumber(data.noise));
  }
  const positioned = field(data.v4_prompt, "use_coords") === true;
  const characters: unknown = field(field(data.v4_prompt, "caption"), "char_captions") || [];
  const avoided = field(field(data.v4_negative_prompt, "caption"), "char_captions") || [];
  // The JS reader also failed here for a truthy non-array; do not silently accept it.
  if (!Array.isArray(characters)) throw new TypeError("characters.forEach is not a function");
  characters.forEach((item: unknown, index) => {
    const where = positioned ? gridCell(field(field(item, "centers"), 0)) : "";
    add(`角色 ${index + 1}${where ? ` · ${where}` : ""}`, cleanText(field(item, "char_caption")));
    add(`角色 ${index + 1} 排除`, cleanText(field(field(avoided, index), "char_caption")));
  });
  const vibes = Array.isArray(data.reference_strength_multiple) ? data.reference_strength_multiple.length : 0;
  if (vibes) add("Vibe Transfer", `${vibes} 张`);
  const directors = Array.isArray(data.director_reference_descriptions) ? data.director_reference_descriptions.length : 0;
  if (directors) add("角色参考", `${directors} 张`);
  add("噪声调度", cleanText(data.noise_schedule));
  add("CFG Rescale", finiteNumber(data.cfg_rescale));
  if (data.sm === true) add("SMEA", data.sm_dyn === true ? "开 · DYN" : "开");
  if (data.dynamic_thresholding === true) add("动态阈值", "开");
  return extras;
}

/** NovelAI: JSON in the Comment chunk. */
function fromNovelAI(comment: string, chunks: Map<string, string>): ParsedMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(comment);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as Record<string, unknown>;

  const source = naiSource(data.model_name || chunks.get("Source"));
  return {
    dialect: "NovelAI",
    source,
    extras: naiExtras(data),
    fields: {
      prompt: cleanText(data.prompt) ?? cleanText(chunks.get("Description")),
      negative_prompt: cleanText(data.uc) ?? cleanText(data.negative_prompt),
      width: finiteNumber(data.width),
      height: finiteNumber(data.height),
      steps: finiteNumber(data.steps),
      sampler: normalizeSampler(data.sampler),
      /* NAI's `scale` is guidance, which is this app's `scale`. Its
         `cfg_rescale` is a 0–1 knob and is NOT the app's 0–30 `cfg`, so it
         is left out instead of being written into the wrong control. */
      scale: finiteNumber(data.scale),
      seed: finiteNumber(data.seed),
      model: naiModel(source)
    }
  };
}

/* Settings the WebUI line carries that `fields` already covers. */
const WEBUI_USED = new Set(["steps", "sampler", "cfg scale", "seed", "size"]);

/** A1111 / WebUI: freeform text in the parameters chunk. */
function fromWebUI(text: string): ParsedMetadata | null {
  const body = String(text || "");
  if (!body.trim()) return null;

  const negativeAt = body.search(/(^|\n)Negative prompt:/);
  const lines = body.split("\n");
  /* The settings line is the last one that reads as "Key: value" pairs. */
  let settingsAt = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/(^|,\s*)(Steps|Sampler|CFG scale|Seed|Size|Model):\s*/.test(lines[i])) { settingsAt = i; break; }
  }
  if (settingsAt < 0 && negativeAt < 0) return null;

  const settingsLine = settingsAt >= 0 ? lines[settingsAt] : "";
  const head = lines.slice(0, settingsAt >= 0 ? settingsAt : lines.length).join("\n");
  const negativeMarker = head.search(/(^|\n)Negative prompt:/);
  const prompt = negativeMarker < 0 ? head : head.slice(0, negativeMarker);
  const negative = negativeMarker < 0
    ? ""
    : head.slice(negativeMarker).replace(/(^|\n)Negative prompt:/, "").trim();

  const settings = new Map<string, string>(), extras: Extra[] = [];
  for (const pair of settingsLine.split(/,\s*(?=[A-Za-z][\w +/-]*:)/)) {
    const at = pair.indexOf(":");
    if (at <= 0) continue;
    const key = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
    settings.set(key.toLowerCase(), value);
    if (!WEBUI_USED.has(key.toLowerCase()) && value) extras.push({ label: key, value });
  }
  const size = (settings.get("size") || "").match(/(\d+)\s*[x×]\s*(\d+)/);
  const sampler = normalizeSampler(settings.get("sampler"));
  /* A sampler we cannot map still belongs on the sheet, just not in the form. */
  if (settings.get("sampler") && !sampler) extras.unshift({ label: "Sampler", value: `${settings.get("sampler")}（本站无对应）` });

  return {
    dialect: "WebUI",
    source: cleanText(settings.get("model")) || undefined,
    extras,
    fields: {
      prompt: cleanText(prompt),
      negative_prompt: cleanText(negative),
      width: size ? finiteNumber(size[1]) : undefined,
      height: size ? finiteNumber(size[2]) : undefined,
      steps: finiteNumber(settings.get("steps")),
      sampler,
      /* WebUI's "CFG scale" is guidance, same role as NAI's `scale`. */
      scale: finiteNumber(settings.get("cfg scale")),
      seed: finiteNumber(settings.get("seed"))
    }
  };
}

function pruned(fields?: ImageFields): ImageFields {
  const out = { ...fields };
  for (const key of Object.keys(out) as (keyof ImageFields)[]) {
    const value = out[key];
    if (value === undefined || value === null || value === "") delete out[key];
  }
  return out;
}

/**
 * @throws {Error} with a message meant to be shown to the reader
 */
export async function readImageParams(file: Blob & { name?: string }): Promise<ImageMetadata> {
  if (!file) throw new Error("没有文件");
  const name = file.name || "图片";
  if (file.size > MAX_BYTES) throw new Error("文件超过 40 MB，未读取");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let chunks;
  if (startsWith(bytes, PNG_SIGNATURE)) chunks = await readPngText(bytes);
  else if (startsWith(bytes, JPEG_SIGNATURE)) chunks = readJpegText(bytes);
  else throw new Error("只支持 PNG 与 JPEG");

  const comment = chunks.get("Comment");
  const parsed = (comment && fromNovelAI(comment, chunks))
    || fromWebUI(chunks.get("parameters") || chunks.get("Parameters") || "")
    || (comment ? fromWebUI(comment) : null);

  const fields = pruned(parsed?.fields);
  if (!parsed || !Object.keys(fields).length) {
    throw new Error(chunks.size ? "图片里没有可识别的生成参数" : "图片没有附带参数信息");
  }
  return { dialect: parsed.dialect, source: parsed.source, fields, extras: parsed.extras || [], name };
}

export const DIALECTS = { NAI: "NovelAI", WEBUI: "WebUI" };
