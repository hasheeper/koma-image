import type { RefEntry } from '../../ask/reference-source.ts';
import type { Mapping } from '../../slate/sync.ts';
import { refKind } from './paths.ts';
export interface ProjectResult {path:string;title:string;group:'assets'|'slates'|'refs';files:RefEntry[];missing:boolean;mapping?:Mapping}
export function projectResults(files:readonly RefEntry[],mappings:readonly Mapping[]):ProjectResult[]{
  const result:ProjectResult[]=[], paths=new Set(files.map(f=>f.path));
  for(const f of files){
    const group=f.path.split('/')[0];if(group!=='assets'&&group!=='slates'&&group!=='refs')continue;
    if(group==='assets'&&/\.(json|txt)$/.test(f.path)&&paths.has(f.path.replace(/\.(json|txt)$/,'')))continue;
    const companions=group==='assets'&&refKind(f.path)==='image'?files.filter(c=>c.path===`${f.path}.json`||c.path===`${f.path}.txt`):[];
    result.push({path:f.path,title:f.path.split('/').at(-1)!,group,files:[f,...companions],missing:false,mapping:mappings.find(m=>m.path===f.path)});
  }
  for(const m of mappings)if(!paths.has(m.path))result.push({path:m.path,title:m.path.split('/').at(-1)!,group:'slates',files:[],missing:true,mapping:m});
  return result;
}
