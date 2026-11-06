import { clampUnit, moveRegion, pointsBox, resizeRegion, validateRegions } from '../domain/region-annotation.ts';
import type { AnnotationShape, RegionAnnotation, UnitPoint } from '../domain/region-annotation.ts';

export type AnnotationTool = AnnotationShape | 'select' | 'hand';
export interface AnnotationViewport {
  stage: HTMLElement; content: HTMLElement;
  fit: () => void; zoom: () => number; pan: () => boolean;
  setHand: (value: boolean) => void; setSpace: (value: boolean) => void;
}
export function regionPath(r: RegionAnnotation, w: number, h: number): string {
  if(r.shape==='point') return '';
  const b=r.bbox, x=b.x*w,y=b.y*h,rw=b.w*w,rh=b.h*h;
  if(r.shape==='polygon') return `${r.points!.map((p,i)=>`${i?'L':'M'}${p.x*w},${p.y*h}`).join(' ')} Z`;
  if(r.shape==='rect') return `M${x},${y}h${rw}v${rh}h${-rw}Z`;
  return `M${x},${y+rh/2}a${rw/2},${rh/2} 0 1 0 ${rw},0a${rw/2},${rh/2} 0 1 0 ${-rw},0`;
}
/** Transient SVG children belong to this driver; Vue owns the stable annotation nodes. */
export function createRegionAnnotator(stage: HTMLElement, content: HTMLElement, preview: SVGGElement, options: {
  width: number; height: number; regions: () => readonly RegionAnnotation[]; tool: () => AnnotationTool;
  selected: () => string | null; editing: () => boolean; closeComment: () => void;
  external: AnnotationViewport; viewport: () => void; choose: (tool: AnnotationTool) => void;
  change: (regions: RegionAnnotation[], selected: string | null, edit?: boolean) => void;
  select: (key: string | null) => void; edit: (key: string) => void;
  vertex: (index: number | null) => void; undo: () => void; redo: () => void;
  error: (message: string) => void; close: () => void; polygon: (count: number) => void;
}) {
  const {width:w,height:h}=options, events=new AbortController(), signal=events.signal;
  let vertices:UnitPoint[]=[], cursor:UnitPoint|undefined, selectedVertex:number|null=null, space=false;
  const touches=new Set<number>();
  let drag: {id:number;start:UnitPoint;screen:UnitPoint;max:number;region?:RegionAnnotation;corner?:string;vertex?:number;insert?:boolean} | undefined;
  const point=(e:{clientX:number;clientY:number}):UnitPoint => {const r=content.getBoundingClientRect();return {x:clampUnit((e.clientX-r.left)/r.width),y:clampUnit((e.clientY-r.top)/r.height)};};
  const unit=()=>w/Math.max(1,content.getBoundingClientRect().width);
  const path=(d:string,css:string)=>node('path',{d,class:css});
  function node(name: string, attrs: Record<string,string|number>) {const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));preview.append(el);return el;}
  function clearPreview(){preview.replaceChildren();content.querySelectorAll('[data-moving]').forEach(el=>el.removeAttribute('data-moving'));}
  function setVertex(n:number|null){selectedVertex=n;options.vertex(n);}
  function cancel(){if(drag&&stage.hasPointerCapture(drag.id))stage.releasePointerCapture(drag.id);drag=undefined;vertices=[];cursor=undefined;clearPreview();options.polygon(0);}
  function renderPolygon(p=cursor){
    clearPreview();const u=unit(),first=vertices[0],last=vertices.at(-1);if(!first||!last)return;
    const near=!!p&&vertices.length>=3&&Math.hypot((p.x-first.x)*w,(p.y-first.y)*h)<12*u;
    const d=vertices.map((v,i)=>`${i?'L':'M'}${v.x*w},${v.y*h}`).join(' '), end=near?first:p;
    if(end&&vertices.length>1)path(`${d}L${end.x*w},${end.y*h}Z`,'annotation-draft-fill');
    path(d,'annotation-halo');path(d,'annotation-draft-line');
    if(end){const line=`M${last.x*w},${last.y*h}L${end.x*w},${end.y*h}`;path(line,'annotation-halo');path(line,'annotation-rubber');
      if(vertices.length>=2&&!near)path(`M${end.x*w},${end.y*h}L${first.x*w},${first.y*h}`,'annotation-closing');}
    vertices.forEach((v,i)=>node('circle',{cx:v.x*w,cy:v.y*h,r:(i?3.5:near?9:5.5)*u,class:i?'annotation-vertex':'annotation-start'}));
  }
  function undoPoint(){if(vertices.length){vertices.pop();options.polygon(vertices.length);renderPolygon();return true;}return false;}
  function commit(next:RegionAnnotation[], key:string|null, edit=false){try{validateRegions(next,true);options.change(next,key,edit);}catch(e){options.error((e as Error).message);}}
  function finishPolygon(){if(vertices.length<3)return;const r:RegionAnnotation={key:crypto.randomUUID(),shape:'polygon',bbox:pointsBox(vertices),points:vertices.map(p=>({...p})),comment:''};try{validateRegions([...options.regions(),r]);cancel();commit([...options.regions(),r],r.key,true);}catch(e){options.error((e as Error).message);}}
  function candidate(p:UnitPoint):RegionAnnotation {
    const d=drag!;
    if(d.region){
      if(d.vertex!==undefined){const points=d.region.points!.map((v,i)=>i===d.vertex?p:v);return {...d.region,points,bbox:pointsBox(points)};}
      if(!d.corner)return moveRegion(d.region,p.x-d.start.x,p.y-d.start.y);
      const b=d.region.bbox,anchor={x:d.corner.includes('w')?b.x+b.w:b.x,y:d.corner.includes('n')?b.y+b.h:b.y};
      return resizeRegion(d.region,pointsBox([anchor,p]));
    }
    if(options.tool()==='point')return {key:crypto.randomUUID(),shape:'point',bbox:{...p,w:0,h:0},comment:''};
    return {key:crypto.randomUUID(),shape:options.tool()==='ellipse'?'ellipse':'rect',bbox:pointsBox([d.start,p]),comment:''};
  }
  function down(e:PointerEvent){
    const el=e.target as Element;
    if(e.button!==0||touches.size>1||el.closest('button,input,textarea,select,[data-comment],[data-annotation-ui]')||options.external.pan()||space)return;
    if(options.editing()){options.closeComment();return;}
    const rect=content.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
    e.preventDefault();stage.focus({preventScroll:true});const p=point(e),tool=options.tool();
    const key=el.closest('[data-region]')?.getAttribute('data-region'),r=options.regions().find(r=>r.key===key);
    if(tool==='polygon'&&!r){
      const first=vertices[0];if(vertices.length>=3&&Math.hypot((p.x-first.x)*w,(p.y-first.y)*h)<12*unit()){finishPolygon();return;}
      if(vertices.length&&Math.hypot((p.x-vertices.at(-1)!.x)*w,(p.y-vertices.at(-1)!.y)*h)<4*unit())return;
      if(vertices.length<128){vertices.push(p);cursor=p;options.polygon(vertices.length);options.select(null);renderPolygon(p);}return;
    }
    if(!r&&tool==='select'){options.select(null);setVertex(null);return;}
    let region=r,vertex:number|undefined,insert=false;
    const v=el.getAttribute('data-vertex'),mid=el.closest('[data-midpoint]')?.getAttribute('data-midpoint');
    if(r?.shape==='polygon'&&(v!==null||mid!=null)){
      vertex=Number(v??mid);if(mid!=null){if(r.points!.length>=128)return;const points=[...r.points!];points.splice(++vertex,0,p);region={...r,points,bbox:pointsBox(points)};insert=true;}setVertex(vertex);
    }else setVertex(null);
    if(r)options.select(r.key);else options.select(null);
    drag={id:e.pointerId,start:p,screen:{x:e.clientX,y:e.clientY},max:0,region,corner:el.getAttribute('data-corner')??undefined,vertex,insert};stage.setPointerCapture(e.pointerId);
  }
  function move(e:PointerEvent){
    if(!drag){if(vertices.length){cursor=point(e);renderPolygon();}return;}if(drag.id!==e.pointerId)return;
    drag.max=Math.max(drag.max,Math.hypot(e.clientX-drag.screen.x,e.clientY-drag.screen.y));if(drag.max<4&&!drag.insert)return;
    clearPreview();if(drag.region)content.querySelector(`[data-region="${CSS.escape(drag.region.key)}"]`)?.setAttribute('data-moving','');
    const r=candidate(point(e));if(r.shape==='point')node('circle',{cx:r.bbox.x*w,cy:r.bbox.y*h,r:6*unit(),class:'annotation-pin-ring'});
    else{const d=regionPath(r,w,h);path(d,'annotation-halo');path(d,'annotation-shape');if(r.points)for(const p of r.points)node('circle',{cx:p.x*w,cy:p.y*h,r:4*unit(),class:'annotation-vertex'});}
  }
  function up(e:PointerEvent){
    if(!drag||drag.id!==e.pointerId)return;const d=drag;
    if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
    if(d.region&&d.max<4&&!d.insert){drag=undefined;options.select(d.region.key);return;}
    if(!d.region&&options.tool()!=='point'&&d.max<4){drag=undefined;clearPreview();return;}
    const r=candidate(d.max<4?d.start:point(e)),next=d.region?options.regions().map(v=>v.key===d.region!.key?r:v):[...options.regions(),r];
    drag=undefined;clearPreview();commit(next,r.key,!d.region);
  }
  function remove(){
    if(undoPoint())return;const r=options.regions().find(r=>r.key===options.selected());if(!r)return;
    if(r.shape==='polygon'&&selectedVertex!==null){if(r.points!.length<=3){options.error('多边形至少保留 3 个点');return;}const points=r.points!.filter((_,i)=>i!==selectedVertex);setVertex(null);commit(options.regions().map(v=>v.key===r.key?{...r,points,bbox:pointsBox(points)}:v),r.key);}
    else commit(options.regions().filter(v=>v.key!==r.key),null);
  }
  function key(e:KeyboardEvent){
    if(e.isComposing||(e.target as Element).closest('textarea,input,select'))return;
    const k=e.key.toLowerCase(),mod=e.metaKey||e.ctrlKey;
    if(mod&&k==='z'){e.preventDefault();e.stopPropagation();if(!undoPoint())e.shiftKey?options.redo():options.undo();return;}
    if(mod||e.altKey)return;
    const tool=({v:'select',c:'point',r:'rect',e:'ellipse',p:'polygon',h:'hand'} as const)[k as 'v'];if(tool){e.preventDefault();options.choose(tool);return;}
    if(e.code==='Space'){if(drag)cancel();space=true;options.external.setSpace(true);e.preventDefault();}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(drag||vertices.length)cancel();else if(options.selected()){options.select(null);setVertex(null);}else options.close();}
    if(e.key==='Enter'){e.preventDefault();if(vertices.length)finishPolygon();else if(options.selected())options.edit(options.selected()!);}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();remove();}
  }
  const sync=()=>{content.style.setProperty('--annotation-unit',String(unit()));options.viewport();if(vertices.length)renderPolygon();};
  // The canvas owns pinch zoom. Cancel a partial annotation before its second touch reaches that driver.
  stage.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){touches.add(e.pointerId);if(touches.size>1)cancel();}},{capture:true,signal});
  for(const event of ['pointerup','pointercancel'] as const)window.addEventListener(event,e=>{touches.delete(e.pointerId);},{capture:true,signal});
  stage.addEventListener('pointerdown',down,{signal});stage.addEventListener('pointermove',move,{signal});stage.addEventListener('pointerup',up,{signal});stage.addEventListener('pointercancel',cancel,{signal});
  stage.addEventListener('dblclick',e=>{if((e.target as Element).closest('[data-comment],[data-annotation-ui]'))return;e.preventDefault();if(vertices.length)finishPolygon();else{const key=(e.target as Element).closest('[data-region]')?.getAttribute('data-region');if(key)options.edit(key);}},{signal});
  stage.addEventListener('keydown',key,{signal});stage.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;options.external.setSpace(false);}},{signal});
  window.addEventListener('blur',()=>{space=false;touches.clear();options.external.setSpace(false);cancel();},{signal});
  const observer=new ResizeObserver(sync);observer.observe(stage);observer.observe(content);stage.addEventListener('scroll',sync,{signal,passive:true});sync();
  return {finishPolygon,cancel,undoPoint,remove,isDrawing:()=>!!drag||!!vertices.length,dispose(){events.abort();observer.disconnect();cancel();options.external.setSpace(false);content.style.removeProperty('--annotation-unit');}};
}
