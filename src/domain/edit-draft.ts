import type { EditorSession } from '../services/editor.ts';
import type { CatalogModel } from './catalog.ts';
import type { MaskSummary } from './mask-summary.ts';
import { DEFAULTS } from './drawing.ts';
import type { DrawingForm } from './drawing.ts';
import { canonical } from '../ask/canonical.ts';
import { hash } from '../ask/digest/index.ts';

export type EditConfiguration = Pick<EditorSession,'mode'|'chosen'|'strength'|'noise'|'focus'|'enhance'|'fields'|'characters'|'placement'|'naiReferences'|'director'|'options'> & {upscaleOpen:boolean;directorOpen:boolean};
export interface EditDraftState {
 pricing?: { sourceKey:string; configKey:string; account?:unknown; accountAt?:number; quote?:import('../services/quote-preview.ts').QuoteState; quoteAt?:number; referenceCosts:Record<string,number|undefined> };
 sourceKey?:string;recordIds?:string[];
 id:string;name:string;boardSeq:number;present:boolean;ready:boolean;baseId:number;viewId:number;maskRevision:number;
 sourceTag?:string;
 source:{width:number;height:number;bytes:number;recordId:string}|null;
 viewing?:{width:number;height:number;bytes:number;recordId:string}|null;
 config:EditConfiguration;nextCharacterId:number;models:CatalogModel[];samplers:string[];
 mask:MaskSummary;blocked:string;photopeaUsed:boolean;
}
export const editStateHash=(s:EditDraftState)=>hash(canonical({id:s.id,baseId:s.baseId,config:s.config,maskRevision:s.maskRevision}));
export function editDrawingForm(s:EditDraftState, config=s.config):DrawingForm {
 const mode=config.upscaleOpen?'upscale':config.mode;
 return {...structuredClone(DEFAULTS),...config.fields,model:config.chosen[mode],negative:config.fields.negative_prompt,
   width:s.source?.width??0,height:s.source?.height??0,characters:structuredClone(config.characters),placement:config.placement,naiReferences:structuredClone(config.naiReferences)};
}
