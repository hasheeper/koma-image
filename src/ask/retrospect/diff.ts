import { canonical } from '../canonical.ts';
import type { Recipe } from './recipe.ts';
import { comparisonRecipe, recipeWorkspace } from './recipe.ts';
import { textDiff } from './text-diff.ts';
import type { TextChange } from './text-diff.ts';
export { textDiff } from './text-diff.ts';
export type { TextChange } from './text-diff.ts';
export const displayValue = (v: unknown): string => v === undefined || v === null ? '未记录' : typeof v === 'boolean' ? v ? '开启' : '关闭' : typeof v === 'object' ? canonical(v) : String(v);
function parameterChange(key: string, label: string, before: unknown, after: unknown, format = displayValue) {
  const changed = canonical(before) !== canonical(after);
  let left = format(before), right = format(after);
  // Formatting must not hide distinct raw values (5 vs "5", null vs missing, etc.).
  if (changed && left === right) { left = canonical(before) ?? '未记录'; right = canonical(after) ?? '未记录'; }
  return { key, label, before: left, after: right, changed };
}
const labels: Record<string, string> = { model: '模型', sampler: '采样器', steps: '步数', scale: 'Guidance', cfgRescale: 'Guidance Rescale', noiseSchedule: '噪声调度', varietyPlus: 'Variety+', naiMode: '模式', complexity: 'Complexity', qualityPreset: '质量预设', negativePreset: '负向预设', transparentBg: '透明底', placement: '角色定位', naiReferences: '参考图' };
Object.assign(labels, { strength: '强度', noise: '噪声', dilate: '外扩', feather: '羽化', colorMatch: '色彩对齐', mode: '编辑模式', focus: '聚焦范围', quality: '质量', resolution: '分辨率', aspect_ratio: '画幅', output_format: '输出格式', size: '尺寸', defry: '变化强度', emotion: '表情' });
export function recipeDiff(a: Recipe | null, b: Recipe) {
  a = a && comparisonRecipe(a); b = comparisonRecipe(b);
  const transition = a && (recipeWorkspace(a) !== 'image' || recipeWorkspace(b) !== 'image') ? { from: recipeWorkspace(a), to: recipeWorkspace(b), before: a, after: b } : null;
  if (transition) return {
    transition, parameters: [] as ReturnType<typeof parameterChange>[],
    texts: [] as { key: string; label: string; before: string | null; after: string | null; parts: TextChange[]; changed: boolean }[],
    charactersUnknown: a?.characters === null || b.characters === null,
  };
  const left: Record<string, unknown> = { ...a?.params }, right: Record<string, unknown> = { ...b.params };
  for (const params of [left, right]) {
    if ('width' in params || 'height' in params) params.size = { width: params.width, height: params.height };
    delete params.width; delete params.height;
  }
  const sizeValue = (v: unknown) => {
    if (!v || typeof v !== 'object') return displayValue(v);
    const size = v as { width?: unknown; height?: unknown };
    return `${displayValue(size.width)}×${displayValue(size.height)}`;
  };
  const parameters = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .map(key => parameterChange(key, key === 'size' ? '尺寸' : labels[key] ?? key, left[key], right[key], key === 'size' ? sizeValue : displayValue))
    .filter(p => p.changed);
  const texts: { key: string; label: string; before: string | null; after: string | null; parts: TextChange[]; changed: boolean }[] = [];
  const add = (key: string, label: string, before: string | null, after: string | null) => texts.push({ key, label, before, after, parts: textDiff(before ?? '', after ?? ''), changed: before !== after });
  add('prompt', 'Prompt', a?.prompt ?? null, b.prompt);
  if (!b.input || b.negative || a?.negative) add('negative', 'Negative', a?.negative ?? null, b.negative);
  if (a?.input || b.input) {
    const x = a?.input, y = b.input;
    const operations: Record<string, string> = { img2img: '图生图', inpaint: '局部重绘', upscale: '放大', photopea: 'Photopea 修改', composite: '蒙版回贴', fusion: 'Photopea 融合', chat: '对话生成', source: '原图' };
    const rows = [
      parameterChange('input:operation', '操作', x?.operation, y?.operation, v => typeof v === 'string' ? operations[v] ?? v : displayValue(v)),
      parameterChange('input:base', '底图', x?.base===null?null:x?.base?.id, y?.base===null?null:y?.base?.id, v => v === null ? '无底图' : v === undefined ? '未记录' : v === x?.base?.id ? x.base.label : y?.base?.label ?? String(v)),
      parameterChange('input:references', '参考图', x?.references?.map(r => r.id), y?.references?.map(r => r.id), v => v === undefined ? '未记录' : canonical(v) === canonical(x?.references?.map(r => r.id)) ? x!.references!.map(r => r.label).join('、') || '无' : y!.references!.map(r => r.label).join('、') || '无'),
    ];
    if (x || y) {
      const changed = canonical(x?.mask?.hash ?? x?.mask) !== canonical(y?.mask?.hash ?? y?.mask);
      const maskText = (input: typeof y) => input?.mask === undefined ? '未记录' : input.mask === null ? '无蒙版' : '已记录蒙版';
      rows.push({ key: 'input:mask', label: '蒙版', before: maskText(x), after: changed && x?.mask && y?.mask ? '蒙版已修改' : maskText(y), changed });
      rows.push(parameterChange('input:maskBounds','蒙版范围',x?.mask?.summary.pixel_bbox,y?.mask?.summary.pixel_bbox));
      rows.push(parameterChange('input:maskCoverage','覆盖率',x?.mask?.summary.coverage_ratio,y?.mask?.summary.coverage_ratio,v=>typeof v==='number'?`${Number((v*100).toFixed(2))}%`:'未记录'));
    }
    parameters.push(...rows.filter(p => p.changed || !a));
    if (x?.context || y?.context) add('input:context', '历史文字', x?.context?.map(t => t.text).join('\n\n') ?? null, y?.context?.map(t => t.text).join('\n\n') ?? null);
    if (x?.annotations || y?.annotations) add('input:annotations', '区域批注', x?.annotations ?? null, y?.annotations ?? null);
  }
  const count = Math.max(a?.characters?.length ?? 0, b.characters?.length ?? 0);
  for (let i = 0; i < count; i++) {
    const old = a?.characters?.[i], current = b.characters?.[i], title = `角色 ${i + 1}`;
    add(`c${i}:prompt`, `${title} · Prompt`, old?.prompt ?? null, current?.prompt ?? null);
    add(`c${i}:negative`, `${title} · Negative`, old?.negative ?? null, current?.negative ?? null);
    for (const key of ['on', 'centers'] as const) {
      const change = parameterChange(`c${i}:${key}`, `${title} · ${key === 'on' ? '启用' : '位置'}`, old?.[key], current?.[key]);
      if (change.changed) parameters.push(change);
    }
  }
  // Different workspaces have different prompt and parameter contracts. Keep both
  // originals, but never present a handoff as deletion/replacement of the source recipe.
  return { parameters, texts, transition, charactersUnknown: a?.characters === null || b.characters === null };
}
