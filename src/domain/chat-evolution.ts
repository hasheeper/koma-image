import { chatSizeKeys, chatReadOnlyKeys } from './chat-options.ts';
import type { ConversationRecord, ConversationTurn, ConversationVersion } from '../storage/records.ts';
import type { EvolutionInput, InputImage } from './evolution-input.ts';
import { chatImageId } from './image-origin.ts';
import { ancestry } from './conversation.ts';
import { object } from './value.ts';

/** Current labels first; off-branch turns follow without reusing a visible short code. */
export const evolutionTurns = (c: ConversationRecord) => { const active = ancestry(c); return [...active, ...c.turns.filter(t => !active.includes(t))]; };
export function chatInputImage(c: ConversationRecord, assetId: string, currentSelection = false): InputImage {
  const turns=evolutionTurns(c);
  const matches=c.turns.flatMap(t=>t.versions.filter(v=>v.blocks.some(b=>b.type==='image'&&b.assetId===assetId)||Object.values(v.composites??{}).includes(assetId)));
  if(!currentSelection&&matches.length>1)return {id:`asset:${assetId}`,label:'来源版本未记录'};
  const ordered=currentSelection?[...turns].sort((a,b)=>Number(b.id===c.headId)-Number(a.id===c.headId)):c.turns;
  for (const t of ordered) for (const [j,v] of currentSelection?[...t.versions.entries()].sort(([a],[b])=>Number(b===t.selectedVersion)-Number(a===t.selectedVersion)):t.versions.entries()) {
    const i=turns.indexOf(t);
    const images = v.blocks.flatMap(b => b.type === 'image' ? [b.assetId] : []);
    const formal = images.map(id => v.composites?.[id] ?? id), extra = images.filter(id => !formal.includes(id));
    const index = [...formal,...extra].indexOf(assetId);
    if (index >= 0) {
      const suffix = index >= formal.length ? String.fromCharCode(97+Math.max(1,formal.length)+index-formal.length)
        : formal.length > 1 ? String.fromCharCode(97+index) : '';
      return { id: chatImageId(c.id,t.id,v.id,assetId), label: `#c${i+1}.${j+1}${suffix}` };
    }
  }
  return { id: `asset:${assetId}`, label: '用户参考图' };
}
export function chatEvolutionInput(c: ConversationRecord, t: ConversationTurn, v: ConversationVersion, assetId?: string, size?: {width:number;height:number}): EvolutionInput {
  const raw = assetId && Object.keys(v.composites ?? {}).find(id => v.composites![id] === assetId);
  const composite = raw && v.compositeSettings?.[raw];
  const a = t.snapshot.annotation;
  const base = v.evolutionInput ?? { workspace: 'chat', operation: 'chat', prompt: a?.text ? t.prompt.replace(a.text,'').trim() : t.prompt,
    negative: '', characters: [], params: { model: t.settings.model, ...Object.fromEntries([...chatSizeKeys,...chatReadOnlyKeys].flatMap(key=>typeof object(t.settings.options)[key]==='string'?[[key,object(t.settings.options)[key]]]:[])) },
    base: (a?.sourceAssetId ?? t.snapshot.base) ? chatInputImage(c,(a?.sourceAssetId ?? t.snapshot.base)!) : null,
    references: t.snapshot.refs.filter(id => id !== a?.guideAssetId).map(id => chatInputImage(c,id)),
    context: t.snapshot.turnIds.map(id => { const previous=c.turns.find(t=>t.id===id); return {id,text:previous?.prompt??'原轮次已移除'}; }),
    ...(a ? { annotations: a.snapshot.regions.map(r=>`${r.key}: ${r.comment}`).join('\n') } : {}) } satisfies EvolutionInput;
  return structuredClone({ ...base,params:{...base.params,...(size?{width:size.width,height:size.height}:{})}, ...(composite ? { operation: composite.method === 'photopea' ? 'fusion' : 'composite', base: chatInputImage(c,raw),references:[...base.references??[],...base.base?[base.base]:[]], params:{...base.params,...(size?{width:size.width,height:size.height}:{}),colorMatch:composite.colorMatch} } : {}) });
}
