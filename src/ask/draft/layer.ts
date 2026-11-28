import { canonical } from '../canonical.ts';
import { hash } from '../digest/index.ts';
import {
  defaultForm,
  layerConflict,
  scalpelSetup,
  type LayerContext,
  type LayerEdit,
  type LayerPatch,
  type LayerTodo,
} from '../../layer/planning.ts';
import type { Draft, DraftPlan, DraftState } from './types.ts';

const word = { type: 'string', minLength: 1, maxLength: 120 };
const promptText = { type: 'string', minLength: 1, maxLength: 24000 };
const cap = {
  type: 'integer',
  minimum: 2,
  maximum: 99,
  description:
    '本轮最多返回的层数。默认给预计独立部件多留 3 层，如 9 件填 12，最高 99。用户指定上限时按指定值。',
};
const todoFields = { id: word, name: word, prompt: promptText, max: cap };
const leaf = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'prompt'],
  properties: todoFields,
};
export const layerSchemas = [
  {
    type: 'object', additionalProperties: false, required: ['kind', 'layer_ids'],
    description: '给出 layer.stack 中的未归档图层 ID，按层序合成一张图。空列表使用母版原图。paint 为普通补画，missing 让 Seedream 5.5 Layer 生成指定的新部件。component 填部件名称，补充说明用 layer_prompt 的 scalpel 目标。',
    properties: {
      kind: { type: 'string', enum: ['layer_scalpel_source'] },
      layer_ids: { type: 'array', items: word },
      mode: { type: 'string', enum: ['paint', 'missing'] },
      component: word,
    },
  },
  {
    type: 'object', additionalProperties: false, required: ['kind', 'references'],
    description: '局部补画的完整正向参考列表，按送图顺序填写。picture 来自 layer.scalpel.sources，usage 说明借鉴的细节。空列表清空参考。',
    properties: {
      kind: { type: 'string', enum: ['layer_references'] },
      references: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['picture', 'usage'],
        properties: { picture: word, usage: { type: 'string', maxLength: 500 } },
      } },
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    description:
      '更新目标栏的拆层说明或最多层数，至少提供 prompt、max 之一。仅调整上限时只提供 max；单件补画仅支持 prompt。',
    required: ['kind', 'target'],
    properties: {
      kind: { type: 'string', enum: ['layer_prompt'] },
      target: { type: 'string', enum: ['master', 'sub', 'scalpel'] },
      layer_id: word,
      prompt: promptText,
      max: cap,
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'parts'],
    properties: {
      kind: { type: 'string', enum: ['layer_todos'] },
      parts: {
        type: 'array',
        minItems: 1,
        maxItems: 48,
        items: {
          ...leaf,
          properties: {
            ...todoFields,
            sub_prompt: promptText,
            sub_max: cap,
            children: { type: 'array', maxItems: 48, items: leaf },
          },
        },
      },
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'layer_id', 'name'],
    properties: { kind: { type: 'string', enum: ['layer_rename'] }, layer_id: word, name: word },
  },
];
function object(v: unknown, allowed: readonly string[]) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    throw new Error('分件草稿包含未知字段');
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 120) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('分件草稿文字为空或过长');
  return v.trim();
}
function limit(v: unknown) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 2 || v > 99)
    throw new Error('拆层上限应为 2–99');
  return v;
}
function extendTodos(state: LayerContext, raw: unknown): LayerTodo[] {
  const todos = structuredClone(state.todos);
  const updated = new Set<string>();
  function add(list: unknown, parent?: string) {
    if (!Array.isArray(list) || (!parent && !list.length) || list.length > 48)
      throw new Error('请按两级清单提供部件');
    for (const item of list) {
      const row = object(
        item,
        parent
          ? ['id', 'name', 'prompt', 'max']
          : ['id', 'name', 'prompt', 'max', 'sub_prompt', 'sub_max', 'children'],
      );
      const prior =
        row.id === undefined ? undefined : todos.find((t) => t.id === row.id && t.parent === parent);
      if (row.id !== undefined && !prior) throw new Error('备忘目标已变化');
      const id = prior?.id ?? crypto.randomUUID();
      if (updated.has(id)) throw new Error('重复备忘项');
      updated.add(id);
      const next = {
        ...prior,
        id,
        parent,
        name: text(row.name),
        prompt: text(row.prompt, 24000),
        done: prior?.done ?? false,
        ...(row.sub_prompt !== undefined ? { subPrompt: text(row.sub_prompt, 24000) } : {}),
        ...(row.sub_max !== undefined ? { subMax: limit(row.sub_max) } : {}),
        ...(row.max !== undefined ? { max: limit(row.max) } : {}),
      };
      if (prior) todos[todos.indexOf(prior)] = next;
      else todos.push(next);
      if (row.children !== undefined) add(row.children, id);
    }
  }
  add(raw);
  return todos;
}
export function parseLayerPatch(base: LayerContext, steps: unknown[], question: string): LayerPatch {
  if (!steps.length || steps.length > 12) throw new Error('分件草稿需要 1–12 个步骤');
  const edits: LayerEdit[] = [];
  for (const raw of steps) {
    const kind = (raw as { kind?: string })?.kind;
    if (kind === 'layer_prompt') {
      const s = object(raw, ['kind', 'target', 'layer_id', 'prompt', 'max']);
      const layer =
        s.layer_id === undefined
          ? undefined
          : base.stack.find((l) => l.id === s.layer_id && !l.archived);
      if (s.layer_id !== undefined && (!layer || s.target !== 'sub')) throw new Error('细拆目标层无效');
      const key =
        s.target === 'master'
          ? 'master'
          : s.target === 'scalpel'
            ? 'scalpel'
            : s.target === 'sub'
              ? layer
                ? JSON.stringify([layer.id])
                : base.focus
              : '';
      if (!key || (s.target === 'sub' && !key.startsWith('region:') && !key.startsWith('[')))
        throw new Error('请指定细拆目标层');
      if (key === 'scalpel' && s.max !== undefined) throw new Error('单件补画没有拆层上限');
      if (s.prompt === undefined && s.max === undefined) throw new Error('请提供拆层说明或最多层数');
      const before = base.forms[key] ?? defaultForm(key);
      const target =
        key === 'master'
          ? '全身总拆'
          : key === 'scalpel'
            ? '单件补画'
            : key.startsWith('region:')
              ? '母版框选 ' + key.slice(7)
              : base.stack
                  .filter((l) => (JSON.parse(key) as string[]).includes(l.id))
                  .map((l) => l.name)
                  .join(' + ');
      edits.push({
        kind: 'prompt',
        key,
        label: (s.prompt === undefined ? '最多层数 · ' : '拆层词 · ') + target,
        before,
        after: {
          ...before,
          ...(s.prompt === undefined ? {} : { prompt: text(s.prompt, 24000) }),
          ...(s.max === undefined ? {} : { max: limit(s.max), unlimited: false }),
        },
      });
    } else if (kind === 'layer_scalpel_source') {
      const s = object(raw, ['kind', 'layer_ids', 'mode', 'component']);
      if (!Array.isArray(s.layer_ids)) throw new Error('请列出补画底图的图层 ID');
      const ids = s.layer_ids.map(id => text(id)).sort();
      if (new Set(ids).size !== ids.length) throw new Error('补画底图包含重复图层');
      const beforeMode = base.scalpel.mode ?? 'paint';
      const mode = s.mode === undefined ? beforeMode : s.mode;
      if (mode !== 'paint' && mode !== 'missing') throw new Error('请选择有效的局部补画方式');
      const edit: LayerEdit = mode === 'missing' || s.mode !== undefined || s.component !== undefined
        ? { kind: 'scalpelSetup', key: 'scalpel', sourceMode: mode, label: '补画方式、部件与底图',
            before: scalpelSetup(base.scalpel, mode),
            after: { mode, target: s.component === undefined ? base.scalpel.target : text(s.component),
              layerIds: ids.length ? ids : null } }
        : { kind: 'scalpelSource', key: 'scalpel', label: '补画底图', before: base.scalpel.sourceLayerIds ?? null, after: ids.length ? ids : null };
      const issue = layerConflict(base, { projectId: base.projectId, edits: [edit] }, 'before');
      if (issue) throw new Error(issue);
      edits.push(edit);
    } else if (kind === 'layer_references') {
      const s = object(raw, ['kind', 'references']);
      if (!Array.isArray(s.references)) throw new Error('请按送图顺序列出补画参考');
      const after = s.references.map(item => {
        const r = object(item, ['picture', 'usage']);
        if (typeof r.usage !== 'string' || r.usage.length > 500) throw new Error('补画参考用途最多 500 字');
        return { picture: text(r.picture), usage: r.usage.trim() };
      });
      if (new Set(after.map(r => r.picture)).size !== after.length) throw new Error('补画参考重复');
      const edit = { kind: 'references' as const, key: 'scalpel', label: '局部补画参考', before: base.scalpel.references, after };
      const issue = layerConflict(base, { projectId: base.projectId, edits: [edit] }, 'before');
      if (issue) throw new Error(issue);
      edits.push(edit);
    } else if (kind === 'layer_todos') {
      const s = object(raw, ['kind', 'parts']);
      edits.push({
        kind: 'todos',
        key: 'todos',
        label: '两级拆件备忘',
        before: base.todos,
        after: extendTodos(base, s.parts),
      });
    } else if (kind === 'layer_rename') {
      const s = object(raw, ['kind', 'layer_id', 'name']);
      if (
        !/命名|改名|重命名|更名|名称|名字|rename|naming/i.test(question) ||
        /(?:不要|禁止|不许|不用|别|无需)\s*(?:批量)?(?:重命名|改名|更名)|(?:do not|don't)\s+rename/i.test(
          question,
        )
      )
        throw new Error('批量改名需要用户提出命名要求');
      const layer = base.stack.find((l) => l.id === s.layer_id && !l.locked);
      if (!layer) throw new Error('目标图层不存在或已锁定');
      edits.push({
        kind: 'name',
        key: layer.id,
        label: [...layer.groups, layer.name].join(' / '),
        before: layer.name,
        after: text(s.name),
      });
    } else throw new Error('分件项目只接受填词、补画底图与参考、两级备忘和按需改名');
  }
  if (new Set(edits.map((e) => (e.kind === 'scalpelSetup' ? 'scalpelSource' : e.kind) + ':' + e.key)).size !== edits.length)
    throw new Error('同一字段只需投递一次');
  return {
    projectId: base.projectId,
    edits: edits.filter((e) => canonical(e.before) !== canonical(e.after)),
  };
}
function describe(e: LayerEdit, side: 'before' | 'after', layer?: LayerContext) {
  if (e.kind === 'scalpelSource' || e.kind === 'scalpelSetup') {
    const ids = e.kind === 'scalpelSetup' ? e[side].layerIds : e[side];
    const names = ids?.map(id => {
      const item = layer?.stack.find(l => l.id === id);
      return item ? [...item.groups, item.name].join(' / ') : id;
    }).join('\n') ?? '母版';
    if (e.kind === 'scalpelSource') return names || '尚未选择图层';
    const setup = e[side], sourceLabel = e.sourceMode === 'missing' ? '缺失件底图' : '补画底图';
    return [setup.mode === 'missing' ? '补缺失件 · SD Layer' : '局部重绘', setup.target || '尚未命名', sourceLabel + ' · ' + (names || '尚未选择图层')].join('\n');
  }
  if (e.kind === 'references') return e[side].map((r, i) => {
    const name = layer?.scalpel?.sources.find(s => s.picture === r.picture)?.name ?? r.picture;
    return (i + 1) + '. ' + name + (r.usage ? ' · ' + r.usage : '');
  }).join('\n') || '无参考';
  if (e.kind === 'name') return e[side];
  if (e.kind === 'prompt') {
    const f = e[side];
    const limitText = f.unlimited ? '不限层数' : '上限 ' + f.max;
    if (e.before.prompt === e.after.prompt) return limitText;
    if (e.before.max === e.after.max && e.before.unlimited === e.after.unlimited) return f.prompt;
    return limitText + '\n' + f.prompt;
  }
  return e[side].length + ' 项拆件待办';
}
export function validateLayer(draft: Draft, now: DraftState, off: ReadonlySet<string>): DraftPlan {
  const patch = draft.layerPatch!;
  const edits = patch.edits.filter((_, i) => !off.has('layer:' + i));
  const steps = patch.edits.map((e, i) => ({
    id: 'layer:' + i,
    ...(e.kind === 'todos'
      ? { kind: 'slate' as const, layerTodos: e }
      : { kind: 'parameter' as const }),
    label: e.label,
    enabled: !off.has('layer:' + i),
    issue: off.has('layer:' + i) ? '' : layerConflict(now.layer, { ...patch, edits: [e] }, 'before'),
    aligned: false,
    before: describe(e, 'before', draft.base?.layer),
    after: describe(e, 'after', draft.base?.layer),
  }));
  const plan = {
    title: draft.title,
    layerTitle: draft.base?.layer?.title ?? patch.projectId,
    workspace: 'edit' as const,
    conversationId: now.conversationId,
    changes: [],
    aligned: false,
    steps,
    ...(edits.length ? { layerPatch: { ...patch, edits } } : {}),
  };
  return { ...plan, fingerprint: hash(canonical(plan)) };
}
