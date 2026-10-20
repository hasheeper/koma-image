import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = "public/fonts/index.css";
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const generics = new Set(["sans-serif", "serif", "monospace", "system-ui"]);

function requireValue(condition, message) {
  if (!condition) throw new Error(`字体配置：${message}`);
}

function uniqueIds(items, label) {
  requireValue(Array.isArray(items) && items.length > 0, `${label}不能为空`);
  const ids = new Set();
  for (const item of items) {
    requireValue(typeof item?.id === "string" && idPattern.test(item.id), `${label} ID 无效`);
    requireValue(!ids.has(item.id), `${label} ID 重复：${item.id}`);
    ids.add(item.id);
  }
}

/** Validate Unicode descriptors without changing their ordering or coverage. */
export function validateUnicodeRange(value) {
  requireValue(typeof value === "string" && value.length > 0, "缺少 Unicode 范围");
  for (const part of value.split(",")) {
    const match = /^U\+([\da-f]{1,6})(?:-([\da-f]{1,6}))?$/i.exec(part.trim());
    requireValue(match, `Unicode 范围无效：${part}`);
    const start = parseInt(match[1], 16), end = parseInt(match[2] || match[1], 16);
    requireValue(start <= end && end <= 0x10ffff, `Unicode 范围越界：${part}`);
  }
}

export async function loadFontConfiguration(root = ROOT) {
  const config = JSON.parse(await readFile(resolve(root, "config/fonts.json"), "utf8"));
  requireValue(config.version === 1, "不支持的版本");
  uniqueIds(config.families, "字体族");
  for (const family of config.families) {
    requireValue(typeof family.family === "string" && /^[a-z][a-z\d -]*$/i.test(family.family), "字体名称无效");
    requireValue(family.license === `fonts/${family.id}/LICENSE`, "许可路径无效");
    requireValue(!generics.has(family.id), "字体 ID 不能使用通用族名");
    requireValue(["normal", "italic"].includes(family.style), "字体样式无效");
    requireValue(["swap", "block", "fallback", "optional", "auto"].includes(family.display), "字体显示策略无效");
    requireValue(["woff2", "woff2-variations"].includes(family.format), "字体格式无效");
    uniqueIds(family.weights, `${family.id} 字重`);
    for (const weight of family.weights) {
      requireValue(typeof weight.descriptor === "string" && /^\d{1,4}(?: \d{1,4})?$/.test(weight.descriptor), "字重描述符无效");
      const values = weight.descriptor.split(" ").map(Number);
      requireValue(values.every((n) => n >= 1 && n <= 1000) && values[0] <= values.at(-1), "字重范围无效");
    }
    requireValue(Boolean(family.ranges) !== Boolean(family.slices), `${family.id} 只能有一个分片来源`);
    if (family.ranges) {
      requireValue(/^config\/font-ranges\/[a-z0-9-]+\.json$/.test(family.ranges), "分片配置路径无效");
      family.slices = JSON.parse(await readFile(resolve(root, family.ranges), "utf8"));
    }
    uniqueIds(family.slices, `${family.id} 分片`);
    for (const slice of family.slices) validateUnicodeRange(slice.unicodeRange);
  }
  const byId = new Map(config.families.map((family) => [family.id, family]));
  requireValue(config.roles && Object.keys(config.roles).sort().join() === "brand,mono,sans", "必须声明 sans／mono／brand 三个用途");
  for (const stack of Object.values(config.roles)) {
    requireValue(Array.isArray(stack) && stack.length >= 2 && generics.has(stack.at(-1)), "字体用途缺少通用回退");
    requireValue(stack.every((id) => byId.has(id) || generics.has(id)), "字体用途引用未知字体");
  }
  requireValue(Array.isArray(config.preloads), "缺少预加载清单");
  const urls = new Set(fontFaces(config).map((face) => face.url)), preloads = new Set();
  for (const preload of config.preloads) {
    const url = fontUrl(preload.family, preload.slice, preload.weight, byId.get(preload.family)?.style);
    requireValue(urls.has(url), "预加载引用未知字体文件");
    requireValue(!preloads.has(url), "预加载重复");
    preloads.add(url);
  }
  return config;
}

function fontUrl(family, slice, weight, style) {
  return `/fonts/${family}/files/${family}-${slice}-${weight}-${style}.woff2`;
}

export function fontFaces(config) {
  return config.families.flatMap((family) => family.weights.flatMap((weight) =>
    family.slices.map((slice) => ({
      family: family.family,
      style: family.style,
      display: family.display,
      weight: weight.descriptor,
      format: family.format,
      unicodeRange: slice.unicodeRange,
      url: fontUrl(family.id, slice.id, weight.id, family.style),
    })),
  ));
}

export function renderFontCss(config) {
  const families = new Map(config.families.map((family) => [family.id, family.family]));
  const roles = Object.entries(config.roles).map(([role, stack]) =>
    `  --${role}: ${stack.map((id) => families.has(id) ? `"${families.get(id)}"` : id).join(", ")};`,
  );
  const blocks = fontFaces(config).map((face) => [
    "@font-face {",
    `  font-family: '${face.family}';`,
    `  font-style: ${face.style};`,
    `  font-display: ${face.display};`,
    `  font-weight: ${face.weight};`,
    `  src: url(.${face.url.slice("/fonts".length)}) format('${face.format}');`,
    `  unicode-range: ${face.unicodeRange};`,
    "}",
  ].join("\n"));
  return [
    "/* Generated from config/fonts.json and its range files. Do not edit.",
    "   Rebuild: npm run fonts:build */",
    "",
    ":root {",
    ...roles,
    "}",
    "",
    blocks.join("\n\n"),
    "",
  ].join("\n");
}

function htmlLinks(html) {
  return [...html.matchAll(/<link\b([^>]+)>/gi)].map(([, text]) =>
    Object.fromEntries([...text.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
      .map(([, name, double, single, plain]) => [name.toLowerCase(), double ?? single ?? plain ?? ""])),
  );
}

export function validateFontHtml(config, html) {
  const links = htmlLinks(html);
  const css = links.filter((link) => link.rel === "stylesheet" && /^\/fonts\//.test(link.href));
  requireValue(css.length === 1 && css[0].href === "/fonts/index.css", "HTML 必须仅引用统一字体入口 /fonts/index.css");
  const actual = links.filter((link) => link.rel === "preload" && link.as === "font");
  const expected = config.preloads.map((item) => fontUrl(
    item.family, item.slice, item.weight,
    config.families.find((family) => family.id === item.family).style,
  )).sort();
  requireValue(actual.every((link) => link.type === "font/woff2" && Object.hasOwn(link, "crossorigin") && ["", "anonymous"].includes(link.crossorigin)), "字体预加载必须设置 type 与匿名 crossorigin");
  requireValue(JSON.stringify(actual.map((link) => link.href).sort()) === JSON.stringify(expected), "HTML 预加载与清单不一致");
}

async function validateAssets(config, root) {
  const faces = fontFaces(config);
  for (const face of faces) {
    const bytes = await readFile(resolve(root, `public${face.url}`));
    requireValue(bytes.subarray(0, 4).toString() === "wOF2", `WOFF2 文件无效：${face.url}`);
  }
  for (const family of config.families) {
    const directory = `public/fonts/${family.id}`;
    const license = await readFile(resolve(root, "public", family.license), "utf8");
    requireValue(license.trim().length > 0, `${family.id} 缺少许可`);
    const expected = faces.filter((face) => face.url.startsWith(`/fonts/${family.id}/`)).map((face) => face.url.split("/").at(-1)).sort();
    const actual = (await readdir(resolve(root, directory, "files"))).sort();
    requireValue(JSON.stringify(actual) === JSON.stringify(expected), `${family.id} 分片文件与清单不一致`);
    // Obsolete declarations must not remain alongside the generated entry.
    try {
      await readFile(resolve(root, directory, "index.css"));
      throw new Error(`字体配置：请移除旧声明 ${directory}/index.css`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function buildFontCss({ root = ROOT, check = false } = {}) {
  const config = await loadFontConfiguration(root);
  await validateAssets(config, root);
  validateFontHtml(config, await readFile(resolve(root, "index.html"), "utf8"));
  const css = renderFontCss(config), target = resolve(root, OUTPUT);
  const existing = await readFile(target, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (check) requireValue(existing === css, "生成文件过期，请执行 npm run fonts:build");
  else if (existing !== css) {
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, css);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return { faces: fontFaces(config).length, families: config.families.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.every((arg) => arg === "--check"), "未知参数");
    const result = await buildFontCss({ check: args.includes("--check") });
    console.log(`字体${args.includes("--check") ? "检查" : "生成"}通过：${result.families} 个字体族，${result.faces} 条声明`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
