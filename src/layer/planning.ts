import { shallowRef } from 'vue';
import { canonical } from '../ask/canonical.ts';
import type { Picture } from '../ask/library.ts';
import { layerVisible, type LayerProject, type ScalpelMode } from './project.ts';
import { layerPictureId, referenceSources, scalpelInputs, type ScalpelReference } from './scalpel-references.ts';

export const macroPrompt =
  '按原图实际遮挡，由前向后编号拆为可动部件。示例顺序：1. 手持配饰；2. 前置手和手臂（保留完整手指）；3. 袖子与外套；4. 前方马尾；5. 头部总成；6. 躯干内搭；7. 裙摆；8. 后方马尾；9. 腿与鞋。按画面调整左右、数量与次序。逐件自动脑补被前方遮挡的横穿缺失结构，接通头发、衣料和肢体，不得留镂空或断口，不得漏手部或配饰。严禁贴着遮挡分界线齐边截断：所有插入前方图层底下的连接端（如下巴后的颈部上端、躯干或袖口后的手臂根部、裙摆底下的大腿上端、刘海后的额头与发根），必须向遮挡物后方额外延伸绘出一截饱满的重叠出血区（Bleed Area），确保关节旋转时不露断口边角。保持各件位置、线条、比例和颜色，分层输出。';
export const headPrompt =
  '按原图实际层序从前向后编号细拆头部：1. 头饰与蝴蝶结；2. 前发刘海；3. 左右侧发；4. 左右上眼睑睫毛；5. 瞳孔高光；6. 虹膜与瞳孔；7. 眼白；8. 无五官光洁脸壳；9. 后发。自动补圆被眼睑遮住的瞳孔边缘、补齐眼白，并把干净脸壳保留为完整基底。严禁贴着遮挡分界线齐边截断：藏在刘海后的额头与发根、插在下巴后的颈部上端、被前发或头饰压住的后发与耳根连接端，必须向遮挡物后方额外延伸绘出一截饱满的重叠出血区（Bleed Area），确保转动时不露断口边角。按原位独立输出左右微件，不留镂空断口，不漏配饰，保持高光大小与睫毛尖。';
export function partPrompt(name: string) {
  if (/头部|人脸|脸部|head|face/i.test(name)) return headPrompt;
  return (
    '只细拆「' +
    name +
    '」。按该件可见结构从前向后编号列出并拆开每件，例如 1. 前置配饰；2. 表面装饰与接缝片；3. 被遮挡的主体；4. 后侧结构。依实际内容修正名称和顺序，自动补全各件被前方遮挡的横穿缺失结构，不得留镂空断口，不得漏手部或配饰。严禁贴着遮挡分界线齐边截断：所有插入前方图层底下的关节与连接端（如袖口或躯干后的手臂根部、下巴后的颈部上端、裙摆底下的大腿上端、刘海后的额头与发根），必须向遮挡物后方额外延伸绘出一截饱满的重叠出血区（Bleed Area），确保关节旋转时不露断口边角。保留各件原画布位置与精细边缘。'
  );
}
// Candidate UUIDs remain distinct across projects and after the three-round window advances.
const pictureId = (id: string) => '#lr-' + id;

function rejectionSummary(p: LayerProject) {
  return (p.generationRounds ?? []).map(({ number, source, target, model, candidateIds, rejected }) => ({
    round: number, source, target, model, generated: candidateIds.length,
    rejected: rejected.map(({ id, name, width, height, reason }) => ({
      picture: pictureId(id), name, width, height, reason,
    })),
  }));
}

/** Only visual tools receive these blobs. They never become handoff assets or ASK attachments. */
export function rejectionPictures(p: LayerProject): Map<string, Picture> {
  const pictures = new Map<string, Picture>();
  for (const round of p.generationRounds ?? []) {
    for (const item of round.rejected) {
      const label = pictureId(item.id);
      pictures.set(label, {
        id: item.id, label, aliases: [label], origins: [], blob: item.preview, thumbnailOnly: true, turnOnly: true,
        createdAt: 0, size: { width: item.width, height: item.height }, params: { model: round.model },
      });
    }
  }
  return pictures;
}

export interface LayerTodo {
  id: string;
  parent?: string;
  name: string;
  prompt: string;
  max?: number;
  subPrompt?: string;
  subMax?: number;
  layerId?: string;
  done: boolean;
}
export interface SplitForm {
  prompt: string;
  max: number;
  unlimited: boolean;
}
export interface LayerContext {
  projectId: string;
  selectedId?: string;
  title: string;
  width: number;
  height: number;
  picture: string;
  stage: string;
  focus: string;
  rect?: import('./project.ts').Rect;
  stack: {
    id: string;
    name: string;
    groups: string[];
    visible: boolean;
    locked: boolean;
    archived: boolean;
  }[];
  forms: Record<string, SplitForm>;
  scalpel: {
    target: string;
    mode: ScalpelMode;
    missingModel?: string;
    missingLayerIds: string[] | null;
    sourceLayerIds: string[] | null;
    references: ScalpelReference[];
    sources: Omit<ReturnType<typeof referenceSources>[number], 'image'>[];
    excluded: { picture: string; name: string }[];
    model?: { name: string; maxImages: number };
  };
  todos: LayerTodo[];
  recent?: LayerProject['lastSplit'];
  generationRounds: ReturnType<typeof rejectionSummary>;
}
export interface ScalpelSetup {
  mode: ScalpelMode;
  target: string;
  layerIds: string[] | null;
}
/** Freeze the selection for the proposed mode, including when the other mode is currently open. */
export function scalpelSetup(s: LayerContext['scalpel'], sourceMode: ScalpelMode): ScalpelSetup {
  return { mode: s.mode ?? 'paint', target: s.target,
    layerIds: sourceMode === 'missing' ? s.missingLayerIds ?? null : s.sourceLayerIds ?? null };
}
export type LayerEdit =
  | { kind: 'scalpelSource'; key: 'scalpel'; label: string; before: string[] | null; after: string[] | null }
  | { kind: 'scalpelSetup'; key: 'scalpel'; sourceMode: ScalpelMode; label: string; before: ScalpelSetup; after: ScalpelSetup }
  | { kind: 'prompt'; key: string; label: string; before: SplitForm; after: SplitForm }
  | { kind: 'references'; key: string; label: string; before: ScalpelReference[]; after: ScalpelReference[] }
  | { kind: 'todos'; key: string; label: string; before: LayerTodo[]; after: LayerTodo[] }
  | { kind: 'name'; key: string; label: string; before: string; after: string };
export interface LayerPatch {
  projectId: string;
  edits: LayerEdit[];
}
export const defaultForm = (key: string): SplitForm => ({
  prompt: '',
  max: key === 'master' ? 8 : 12,
  unlimited: false,
});
export function layerContext(
  p: LayerProject,
  stage: string,
  focus: string,
  rect?: LayerContext['rect'],
  model?: LayerContext['scalpel']['model'],
): LayerContext {
  return {
    projectId: p.id,
    selectedId: p.activeLayerId,
    title: p.title,
    width: p.reference.width,
    height: p.reference.height,
    picture: '#layer',
    stage,
    focus,
    rect,
    scalpel: {
      target: p.scalpelName, references: p.scalpelReferences ?? [], model,
      mode: p.scalpelMode ?? 'paint', missingLayerIds: p.missingLayerIds?.slice().sort() ?? null,
      sourceLayerIds: p.scalpelLayerIds?.slice().sort() ?? null,
      sources: referenceSources(p).map(({ image: _image, ...meta }) => meta),
      excluded: p.layers.filter(l => p.scalpelOccluderIds.includes(l.id)).map(l => ({ picture: layerPictureId(l.id), name: l.name })),
    },
    stack: [...p.layers].reverse().map((l) => ({
      id: l.id,
      name: l.name,
      groups: l.groups ?? [],
      visible: layerVisible(l),
      locked: l.locked,
      archived: !!l.archived,
    })),
    forms: {
      ...p.subForms,
      master: {
        prompt: p.decomposePrompt ?? '',
        max: p.decomposeMax ?? 8,
        unlimited: !!p.decomposeUnlimited,
      },
      scalpel: { ...defaultForm('scalpel'), prompt: p.scalpelInstruction },
    },
    todos: p.todos ?? [],
    recent: p.lastSplit,
    generationRounds: rejectionSummary(p),
  };
}
type Side = 'before' | 'after';
/** Apply only the proposed fields, both for committing a card and for undoing it. */
export function patchedForm(
  current: SplitForm | undefined,
  edit: Extract<LayerEdit, { kind: 'prompt' }>,
  side: Side,
): SplitForm {
  const form = current ?? defaultForm(edit.key);
  const { before, after } = edit;
  const value = edit[side];
  return {
    ...form,
    ...(before.prompt !== after.prompt ? { prompt: value.prompt } : {}),
    ...(before.max !== after.max || before.unlimited !== after.unlimited
      ? { max: value.max, unlimited: value.unlimited }
      : {}),
  };
}
export function layerConflict(s: LayerContext | undefined, patch: LayerPatch, side: Side): string {
  if (!s || s.projectId !== patch.projectId) return '分件项目已切换或关闭';
  for (const e of patch.edits) {
    if (e.kind === 'scalpelSource' || e.kind === 'scalpelSetup') {
      const current = e.kind === 'scalpelSetup' ? scalpelSetup(s.scalpel, e.sourceMode) : s.scalpel.sourceLayerIds ?? null;
      if (canonical(current) !== canonical(e[side])) return e.label + '选择已变化';
      const next = side === 'before' ? 'after' : 'before';
      const ids = e.kind === 'scalpelSetup' ? e[next].layerIds : e[next];
      for (const id of ids ?? []) {
        if (!s.stack.some(l => l.id === id && !l.archived)) return '所选补画图层已删除或归档';
        if ((e.kind === 'scalpelSource' || e.sourceMode === 'paint') && s.scalpel.excluded.some(l => l.picture === layerPictureId(id))) return '所选补画图层已用于排除遮挡';
      }
      continue;
    }
    if (e.kind === 'references') {
      if (canonical(s.scalpel.references) !== canonical(e[side])) return '局部补画参考已变化';
      const desired = e[side === 'before' ? 'after' : 'before'];
      for (const r of desired) {
        if (!s.scalpel.sources.some(source => source.picture === r.picture)) return '补画参考源已删除或归档';
        if (s.scalpel.excluded.some(l => l.picture === r.picture)) return '同一图层已用于排除遮挡';
      }
      if (s.scalpel.model && side === 'before') {
        const { issue } = scalpelInputs(s.scalpel.model.maxImages, desired.length, !!s.scalpel.excluded.length);
        if (issue) return issue;
      }
      continue;
    }
    const l = s.stack.find((l) => l.id === e.key);
    if (e.kind === 'name' && (!l || l.locked)) return '目标层已删除或锁定';
    if (
      e.kind === 'prompt' &&
      e.key.startsWith('[') &&
      (JSON.parse(e.key) as string[]).some((id) => !s.stack.some((l) => l.id === id && !l.archived))
    )
      return '细拆目标已变化';
    const value =
      e.kind === 'name'
        ? l?.name
        : e.kind === 'todos'
          ? s.todos
          : (s.forms[e.key] ?? defaultForm(e.key));
    const expected = e.kind === 'prompt' ? patchedForm(s.forms[e.key], e, side) : e[side];
    if (canonical(value) !== canonical(expected)) return e.label + ' 已变化';
  }
  return '';
}
export function applyLayerEdits(p: LayerProject, patch: LayerPatch, undo: boolean, model?: LayerContext['scalpel']['model']): LayerProject {
  const current = layerContext(p, '', '', undefined, model);
  const reason = layerConflict(current, patch, undo ? 'after' : 'before');
  if (reason) throw new Error(reason);
  let next = { ...p };
  const side = undo ? 'before' : 'after';
  for (const e of patch.edits) {
    if (e.kind === 'name')
      next.layers = next.layers.map((l) => (l.id === e.key ? { ...l, name: e[side] } : l));
    else if (e.kind === 'todos') next.todos = e[side];
    else if (e.kind === 'references') next.scalpelReferences = e[side];
    else if (e.kind === 'scalpelSource') next.scalpelLayerIds = e[side] ?? undefined;
    else if (e.kind === 'scalpelSetup') {
      const setup = e[side];
      next.scalpelMode = setup.mode;
      next.scalpelName = setup.target;
      if (e.sourceMode === 'missing') next.missingLayerIds = setup.layerIds ?? undefined;
      else next.scalpelLayerIds = setup.layerIds ?? undefined;
    } else {
      const f = patchedForm(current.forms[e.key], e, side);
      if (e.key === 'master')
        next = {
          ...next,
          decomposePrompt: f.prompt,
          decomposeMax: f.max,
          decomposeUnlimited: f.unlimited,
        };
      else if (e.key === 'scalpel') next.scalpelInstruction = f.prompt;
      else next.subForms = { ...next.subForms, [e.key]: f };
    }
  }
  return next;
}

export interface LayerPort {
  read(): LayerContext | undefined;
  picture(): Picture | undefined;
  rejectionPictures(): ReadonlyMap<string, Picture> | undefined;
  referencePictures(): ReadonlyMap<string, () => Picture> | undefined;
  write(p: LayerPatch, undo: boolean): Promise<void>;
  checklist(): {
    projectId: string;
    title: string;
    todos: LayerTodo[];
    layers: { id: string; name: string }[];
    busy: boolean;
  } | undefined;
  updateTodo(projectId: string, id: string, patch: Partial<Pick<LayerTodo, 'done' | 'layerId'>>): Promise<void>;
  useTodo(projectId: string, id: string, target: 'master' | 'layers' | 'region'): Promise<void>;
}
const active = shallowRef<LayerPort>();
export const layerPort = () => active.value;
export function attachLayer(port: LayerPort) {
  active.value = port;
  return () => {
    if (active.value === port) active.value = undefined;
  };
}
