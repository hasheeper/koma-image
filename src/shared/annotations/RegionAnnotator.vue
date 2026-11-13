<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useId, watch } from 'vue';
import { useAnnotations } from '../../app/annotations.ts';
import { useEditor } from '../../app/editor.ts';
import { useUi, message } from '../../app/ui.ts';
import type { AnnotationTarget } from '../../services/annotations.ts';
import { createRegionAnnotator, regionPath } from '../../native/region-annotator.ts';
import type { AnnotationTool, AnnotationViewport } from '../../native/region-annotator.ts';
import { annotationTag } from '../../domain/region-annotation.ts';
import type { RegionAnnotation } from '../../domain/region-annotation.ts';
import AppIcon from '../AppIcon.vue';
import PopoverMenu from '../ui/PopoverMenu.vue';

const props = defineProps<{ embedded: AnnotationViewport; toolbar?: HTMLElement }>();
const annotations=useAnnotations(),ui=useUi(),active=computed(()=>annotations.active.value!);
const { editor, view: editorView }=useEditor();
const stage=shallowRef<HTMLElement>(),preview=shallowRef<SVGGElement>(),input=shallowRef<HTMLTextAreaElement>();
const tool=shallowRef<AnnotationTool>(active.value.target.initialTool??'point'),selected=shallowRef<string|null>(null),hovered=shallowRef<string|null>(null),vertex=shallowRef<number|null>(null);
const editing=shallowRef(false),text=shallowRef(''),polygon=shallowRef(0);
const referencePicker=shallowRef<InstanceType<typeof PopoverMenu>>(),referencePickerId=useId();
const uploadInput=shallowRef<HTMLInputElement>(),uploading=shallowRef(false),choosingFile=shallowRef(false),fileDrag=shallowRef(false);
let uploadContext:{key:string;target:AnnotationTarget}|undefined;
const undoStack=shallowRef<RegionAnnotation[][]>([]),redoStack=shallowRef<RegionAnnotation[][]>([]);
const regions=computed(()=>active.value.snapshot.regions),size=computed(()=>active.value.snapshot),region=computed(()=>regions.value.find(r=>r.key===selected.value));
const references=computed(()=>(active.value.snapshot.references??[]).map(r=>({...r,url:editorView.value.references.find(v=>v.id===r.id)?.url??''})));
const linkedReferences=computed(()=>references.value.filter(r=>region.value?.referenceIds?.includes(r.id)));
const missingReferences=computed(()=>region.value?.referenceIds?.filter(id=>!references.value.some(r=>r.id===id))??[]);
const canUpload=computed(()=>editorView.value.generative&&!editorView.value.busy&&!editorView.value.preparing&&!editorView.value.externalId&&!uploading.value&&!choosingFile.value&&references.value.length<editorView.value.referenceCapacity);
const tools=[{tool:'select',icon:'i-select-cursor',label:'选择 · V'},{tool:'point',icon:'i-annotation-point',label:'点 · C'},{tool:'rect',icon:'i-select-rect',label:'矩形 · R'},{tool:'ellipse',icon:'i-select-ellipse',label:'椭圆 · E'},{tool:'polygon',icon:'i-select-polygon',label:'多边形 · P'}] as const;
let driver:ReturnType<typeof createRegionAnnotator>|undefined,frame=0,disposed=false;
function change(next:RegionAnnotation[],key:string|null,editNew=false){
  if(JSON.stringify(next)!==JSON.stringify(regions.value)){undoStack.value=[...undoStack.value.slice(-99),structuredClone(regions.value)];redoStack.value=[];annotations.update(next);}
  editing.value=false;selected.value=key;if(editNew&&key)void edit(key);
}
function history(redo=false){
  saveComment(false);driver?.cancel();const from=redo?redoStack:undoStack,to=redo?undoStack:redoStack;
  if(!from.value.length)return;to.value=[...to.value,structuredClone(regions.value)];const next=from.value.at(-1)!;from.value=from.value.slice(0,-1);annotations.update(next);selected.value=null;vertex.value=null;hovered.value=null;
}
function placeOverlays(){
  frame=0;const host=stage.value;if(!host||disposed)return;
  const s=host.getBoundingClientRect(),c=props.embedded.content.getBoundingClientRect(),u=size.value.width/Math.max(1,c.width);
  for(const [i,r]of regions.value.entries()){
    const tag=annotationTag(r,i+1,size.value.width,size.value.height,u),group=props.embedded.content.querySelector<SVGGElement>(`[data-tag="${CSS.escape(r.key)}"]`);
    group?.setAttribute('transform',`translate(${tag.x} ${tag.y}) scale(${u})`);
    const line=props.embedded.content.querySelector<SVGPathElement>(`[data-leader="${CSS.escape(r.key)}"]`);
    if(line){const x=r.bbox.x*size.value.width,y=r.bbox.y*size.value.height;line.setAttribute('d',`M${x} ${y+(tag.below?6:-6)*u}L${tag.x+tag.w/2} ${tag.below?tag.y:tag.y+tag.h}`);}
    for(const el of host.querySelectorAll<HTMLElement>(`[data-overlay="${CSS.escape(r.key)}"]`)){
      const x=c.left-s.left+tag.x/u,y=c.top-s.top+tag.y/u,w=el.offsetWidth,h=el.offsetHeight;
      let left=x+tag.w/u+6,top=y;if(left+w>s.width-8)left=x-w-6;
      if(left<8){left=Math.max(8,Math.min(s.width-w-8,x));top=y-h-8;if(top<8)top=c.top-s.top+(r.bbox.y+r.bbox.h)*c.height+12;}
      left=Math.max(8,Math.min(left,s.width-w-8));top=Math.max(8,Math.min(top,s.height-h-64));
      el.style.transform=`translate(${left}px,${top}px)`;el.style.visibility=x+tag.w/u>=0&&x<s.width&&y+20>=0&&y<s.height-54?'visible':'hidden';
    }
  }
}
function positionOverlays(){if(!frame&&!disposed)frame=requestAnimationFrame(placeOverlays);}
function resizeComment(){if(input.value){input.value.style.height='auto';input.value.style.height=`${Math.min(100,Math.max(20,input.value.scrollHeight))}px`;}positionOverlays();}
async function edit(key:string){saveComment(false);selected.value=key;text.value=regions.value.find(r=>r.key===key)?.comment??'';editing.value=true;await nextTick();if(disposed)return;resizeComment();placeOverlays();input.value?.focus({preventScroll:true});}
function toggleReference(id:string) {
  if (!region.value) return;
  const key = region.value.key, ids = region.value.referenceIds ?? [];
  const next = regions.value.map(r => r.key === key ? {...r, comment: text.value, referenceIds: ids.includes(id) ? ids.filter(v => v !== id) : [...ids,id]} : r);
  change(next,key); editing.value = true; void nextTick(positionOverlays);
}
function chooseReferenceFile(){
  if(!canUpload.value||!region.value)return;
  uploadContext={key:region.value.key,target:active.value.target};choosingFile.value=true;uploadInput.value?.click();
}
async function uploadReferences(files:readonly File[],context=region.value?{key:region.value.key,target:active.value.target}:undefined){
  choosingFile.value=false;
  if(!context||!files.length||uploading.value)return;
  uploading.value=true;
  try{
    const added=await editor.addReferences(files,()=>!disposed&&annotations.active.value?.target===context.target&&!!annotations.active.value.snapshot.regions.some(r=>r.key===context.key));
    const keepEditing=editing.value;
    const next=regions.value.map(r=>r.key===context.key?{...r,comment:selected.value===r.key&&keepEditing?text.value:r.comment,referenceIds:[...new Set([...(r.referenceIds??[]),...added.map(a=>a.id)])]}:r);
    change(next,selected.value);editing.value=keepEditing;
  }catch(e){ui.toast(message(e),'err');}
  finally{uploading.value=false;if(uploadInput.value)uploadInput.value.value='';if(!disposed&&editing.value&&selected.value===context.key)void nextTick(()=>input.value?.focus({preventScroll:true}));}
}
function referenceFileChanged(){const files=[...(uploadInput.value?.files??[])],context=uploadContext;uploadContext=undefined;if(context)void uploadReferences(files,context);else choosingFile.value=false;}
function referenceFileCancelled(){choosingFile.value=false;uploadContext=undefined;if(editing.value)input.value?.focus({preventScroll:true});}
function saveComment(focus=true){if(!editing.value)return;referencePicker.value?.close();editing.value=false;change(regions.value.map(r=>r.key===selected.value?{...r,comment:text.value}:r),selected.value);if(focus)props.embedded.stage.focus({preventScroll:true});}
function commentKeys(e:KeyboardEvent){
  if(e.key!=='Escape'||e.isComposing)return;e.preventDefault();
  if(!referencePicker.value?.escape())saveComment();
}
function commentBlur(e:FocusEvent){
  if(choosingFile.value)return;
  const next=e.relatedTarget as HTMLElement|null;
  if(!(e.currentTarget as HTMLElement).contains(next)&&!next?.closest('#editorRun,#editorSend'))saveComment(false);
}
function choose(value:AnnotationTool){saveComment();driver?.cancel();tool.value=value;props.embedded.setHand(value==='hand');props.embedded.stage.focus({preventScroll:true});}
function remove(){driver?.remove();props.embedded.stage.focus({preventScroll:true});}
watch([regions,editing,hovered,selected,references],()=>void nextTick(positionOverlays));
onMounted(async()=>{
  await nextTick();if(disposed)return;
  driver=createRegionAnnotator(props.embedded.stage,props.embedded.content,preview.value!,{
    width:size.value.width,height:size.value.height,regions:()=>regions.value,tool:()=>tool.value,selected:()=>selected.value,editing:()=>editing.value,
    external:props.embedded,viewport:positionOverlays,choose,closeComment:saveComment,change,edit:key=>void edit(key),
    select:key=>{selected.value=key;editing.value=false;},vertex:n=>{vertex.value=n;},undo:()=>history(),redo:()=>history(true),
    close:()=>{if(!annotations.busy.value)annotations.close();},error:msg=>ui.toast(msg,'err'),polygon:n=>{polygon.value=n;},
  });props.embedded.stage.focus({preventScroll:true});positionOverlays();
});
onBeforeUnmount(()=>{disposed=true;cancelAnimationFrame(frame);driver?.dispose();});
defineExpose({choose,saveComment,tool,polygon,cancel:()=>driver?.cancel(),finishPolygon:()=>driver?.finishPolygon(),isDrawing:()=>driver?.isDrawing()??false});
</script>
<template>
  <div class="annotation-inline" aria-label="图片批注">
    <input ref="uploadInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="上传批注参考文件" @change="referenceFileChanged" @cancel="referenceFileCancelled" />
    <div ref="stage" class="annotation-stage" :data-tool="tool">
      <Teleport :to="embedded.content">
        <svg :viewBox="`0 0 ${size.width} ${size.height}`" class="annotation-svg" aria-label="区域选区">
          <g v-for="(r,index) in regions" :key="r.key" :data-region="r.key" :data-shape="r.shape" :class="{selected:r.key===selected}" role="button" tabindex="0" :aria-label="`批注 ${index+1}${r.comment?`：${r.comment}`:''}`" @pointerenter="hovered=r.key" @pointerleave="hovered=null" @keydown.enter.stop.prevent="edit(r.key)">
            <template v-if="r.shape!=='point'"><path :d="regionPath(r,size.width,size.height)" class="annotation-halo"/><path :d="regionPath(r,size.width,size.height)" class="annotation-shape"/></template>
            <template v-else>
              <path :data-leader="r.key" class="annotation-leader"/>
              <circle :cx="r.bbox.x*size.width" :cy="r.bbox.y*size.height" class="annotation-pin-halo"/>
              <circle :cx="r.bbox.x*size.width" :cy="r.bbox.y*size.height" class="annotation-pin-ring"/>
              <circle :cx="r.bbox.x*size.width" :cy="r.bbox.y*size.height" class="annotation-pin-hit"/>
            </template>
            <template v-if="r.key===selected&&r.shape==='polygon'">
              <g v-for="(p,j) in r.points" :key="`mid-${j}`" :data-midpoint="j" :transform="`translate(${(p.x+r.points![(j+1)%r.points!.length].x)/2*size.width} ${(p.y+r.points![(j+1)%r.points!.length].y)/2*size.height})`" class="annotation-midpoint"><circle/><path d="M-2.6 0h5.2M0-2.6v5.2"/></g>
              <circle v-for="(p,j) in r.points" :key="j" :data-vertex="j" :cx="p.x*size.width" :cy="p.y*size.height" class="annotation-vertex" :class="{'vertex-selected':vertex===j}"/>
            </template>
            <template v-else-if="r.key===selected&&r.shape!=='point'"><rect v-for="corner in ['nw','ne','sw','se']" :key="corner" :data-corner="corner" :x="(r.bbox.x+(corner.includes('e')?r.bbox.w:0))*size.width" :y="(r.bbox.y+(corner.includes('s')?r.bbox.h:0))*size.height" class="annotation-handle"/></template>
            <g :data-tag="r.key" class="annotation-number"><rect :width="index>8?26:20" height="20" rx="6"/><text :x="index>8?13:10" y="14">{{index+1}}</text></g>
          </g>
          <g ref="preview" class="annotation-draft"/>
        </svg>
      </Teleport>
      <template v-for="(r,index) in regions" :key="r.key">
        <div v-if="hovered===r.key&&selected!==r.key&&!polygon" class="annotation-summary" :data-overlay="r.key"><b>{{index+1}}</b>{{r.comment||'添加批注…'}}</div>
      </template>
      <div v-if="region&&!editing&&!polygon" class="annotation-selection" :data-overlay="region.key" data-annotation-ui>
        <span class="annotation-badge">{{regions.indexOf(region)+1}}</span>
        <button class="ibtn" type="button" aria-label="编辑批注" title="编辑批注 · Enter" @click="edit(region.key)"><AppIcon name="i-annotate"/></button>
        <button class="ibtn" type="button" :aria-label="vertex!==null?'删除顶点':'删除批注'" @click="remove"><AppIcon name="i-trash"/></button>
      </div>
      <section v-if="editing&&region" class="annotation-comment" :class="{'reference-dragging':fileDrag}" :data-overlay="region.key" data-comment aria-label="编辑批注" @keydown.stop="commentKeys" @focusout="commentBlur" @dragover.prevent.stop="e=>{fileDrag=canUpload&&!!e.dataTransfer?.types.includes('Files');}" @dragleave="e=>{if(!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node|null))fileDrag=false;}" @drop.prevent.stop="e=>{fileDrag=false;if(e.dataTransfer?.files.length)uploadReferences([...e.dataTransfer.files]);}" @paste.stop="e=>{if(e.clipboardData?.files.length){e.preventDefault();uploadReferences([...e.clipboardData.files]);}}">
        <textarea ref="input" v-model="text" :aria-label="`批注 ${regions.indexOf(region)+1}`" placeholder="添加批注…" maxlength="2000" rows="1" @input="resizeComment" @keydown.enter="e=>{if(!e.shiftKey&&!e.isComposing){e.preventDefault();saveComment();}}"/>
        <PopoverMenu v-if="editorView.generative||references.length||missingReferences.length" ref="referencePicker" :id="referencePickerId" label="批注参考图" side="right" orientation="horizontal" pointer-focus="menu" menu-class="annotation-reference-menu" compact>
          <template #trigger="{open,toggle}">
            <button class="ibtn annotation-reference-trigger" type="button" aria-label="批注参考图" aria-haspopup="menu" :aria-expanded="open" :aria-controls="referencePickerId" :title="missingReferences.length ? '有失效的参考关联，点击处理' : linkedReferences.length ? `已关联 ${linkedReferences.map(r=>r.label).join('、')} · 上传或选择参考图` : '上传或选择参考图'" @pointerdown.prevent @click="toggle">
              <span v-if="linkedReferences.length" class="annotation-reference-stack"><img v-for="r in linkedReferences.slice(0,2)" :key="r.id" :src="r.url" :alt="r.label" draggable="false" /><small v-if="linkedReferences.length>2">+{{linkedReferences.length-2}}</small></span>
              <AppIcon v-else name="i-image-plus" /><span v-if="missingReferences.length" class="annotation-reference-warning" />
            </button>
          </template>
          <button v-if="editorView.generative" class="annotation-reference-upload" type="button" role="menuitem" :disabled="!canUpload" :title="`当前可用 ${editorView.referenceCapacity} 张参考图；上传后自动关联本条批注`" @pointerdown.prevent @click="chooseReferenceFile"><AppIcon name="i-plus" />{{uploading?'正在上传…':'上传参考图'}}<small>{{references.length}}/{{editorView.referenceCapacity}}</small></button>
          <div v-if="references.length" class="annotation-reference-picker" :style="{'--reference-columns': Math.min(4,references.length)}">
            <button v-for="r in references" :key="r.id" type="button" role="menuitemcheckbox" :title="`${r.name}${r.usage ? ` · ${r.usage}` : ''}`" :aria-label="`批注参考 ${r.label}`" :aria-checked="region.referenceIds?.includes(r.id) ?? false" @pointerdown.prevent @click="toggleReference(r.id)">
              <span class="annotation-reference-image"><img v-if="r.url" :src="r.url" alt="" draggable="false" /><AppIcon v-else name="i-image" /><AppIcon v-if="region.referenceIds?.includes(r.id)" class="annotation-reference-check" name="i-check" /></span>
              <span>{{r.label}}</span>
            </button>
          </div>
          <div v-if="missingReferences.length" class="annotation-missing-references"><button v-for="id in missingReferences" :key="id" type="button" role="menuitem" @pointerdown.prevent @click="toggleReference(id)">移除失效关联 <AppIcon name="i-close" /></button></div>
        </PopoverMenu>
        <button class="ibtn annotation-save" type="button" aria-label="完成" title="完成 · Enter；Shift＋Enter 换行" @pointerdown.prevent @click="saveComment()"><AppIcon name="i-check" /></button>
      </section>
    </div>
    <Teleport v-if="toolbar" :to="toolbar">
      <div class="annotation-toolbar editor-tool-capsule" role="toolbar" aria-label="批注工具" data-annotation-ui>
        <button v-for="t in tools" :key="t.tool" class="ibtn" type="button" :aria-label="t.label" :data-tip="t.label" :aria-pressed="tool===t.tool" @click="choose(t.tool)"><AppIcon :name="t.icon"/></button>
        <span class="annotation-separator"/>
        <template v-if="polygon">
          <button class="ibtn" type="button" aria-label="撤销顶点" data-tip="撤销顶点 · Backspace" @click="driver?.undoPoint()"><AppIcon name="i-undo"/></button>
          <button class="ibtn" type="button" aria-label="闭合多边形" data-tip="闭合 · Enter" :disabled="polygon<3" @click="driver?.finishPolygon()"><AppIcon name="i-check"/></button>
          <button class="ibtn" type="button" aria-label="取消绘制" data-tip="取消 · Esc" @click="driver?.cancel()"><AppIcon name="i-close"/></button>
        </template>
        <template v-else>
          <button class="ibtn" type="button" aria-label="撤销批注" data-tip="撤销 · ⌘Z" :disabled="!undoStack.length" @click="history()"><AppIcon name="i-undo"/></button>
          <button class="ibtn" type="button" aria-label="重做批注" data-tip="重做 · ⇧⌘Z" :disabled="!redoStack.length" @click="history(true)"><AppIcon name="i-redo"/></button>
          <button class="ibtn" type="button" aria-label="清空批注" data-tip="清空批注" :disabled="!regions.length" @click="saveComment(false);change([],null)"><AppIcon name="i-eraser"/></button>
        </template>
        <span class="annotation-separator"/>
        <button class="editor-tool annotation-finish" type="button" aria-label="完成批注" data-tip="完成批注，返回编辑工具" @click="saveComment(false);annotations.close()"><AppIcon name="i-check"/>完成批注</button>
      </div>
    </Teleport>
  </div>
</template>
<style scoped>
/* stylelint-disable declaration-property-value-allowed-list -- Approved media overlays use screen-space drawing strokes, independent of toolbar icon weights. */
.annotation-inline { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
.annotation-stage { position: absolute; inset: 0; pointer-events: none; }
.annotation-svg { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; touch-action: none; overflow: visible; user-select: none; }
.annotation-svg :deep(path), .annotation-svg :deep(circle) { vector-effect: non-scaling-stroke; }
.annotation-svg :deep(.annotation-halo) { fill: none; stroke: rgb(10 8 22 / 55%); stroke-width: 3.5; stroke-linejoin: round; }
.annotation-svg :deep(.annotation-shape) { fill: rgb(179 161 255 / 8%); stroke: var(--media-accent); stroke-width: 1.5; stroke-linejoin: round; cursor: move; }
[data-region]:hover .annotation-shape { fill: rgb(179 161 255 / 13%); }
.selected .annotation-shape { fill: rgb(179 161 255 / 16%); stroke-width: 2; }
.selected .annotation-halo { stroke-width: 4.5; }
.annotation-number { cursor: pointer; filter: drop-shadow(0 1px 2px rgb(0 0 0 / 40%)); }
.annotation-number rect { fill: var(--media-accent); }
.annotation-number text { fill: #17122b; font: 650 11.5px var(--mono); text-anchor: middle; pointer-events: none; }
.selected .annotation-number rect { stroke: #fff; stroke-width: 2; }
.annotation-pin-halo { r: calc(6px * var(--annotation-unit)); fill: none; stroke: rgb(10 8 22 / 55%); stroke-width: 4.5; }
.annotation-svg :deep(.annotation-pin-ring) { r: calc(6px * var(--annotation-unit)); fill: none; stroke: var(--media-accent); stroke-width: 2; }
.annotation-pin-hit { r: calc(12px * var(--annotation-unit)); fill: transparent; cursor: move; }
.annotation-leader { fill: none; stroke: var(--media-accent); stroke-width: 1.5; }
.annotation-handle { width: calc(8px * var(--annotation-unit)); height: calc(8px * var(--annotation-unit)); rx: calc(2px * var(--annotation-unit)); transform: translate(calc(-4px * var(--annotation-unit)),calc(-4px * var(--annotation-unit))); fill: #fff; stroke: #5b4bb7; stroke-width: 1.25; vector-effect: non-scaling-stroke; cursor: nwse-resize; }
[data-corner="ne"], [data-corner="sw"] { cursor: nesw-resize; }
.annotation-svg :deep(.annotation-vertex) { r: calc(4px * var(--annotation-unit)); fill: #fff; stroke: #5b4bb7; stroke-width: 1.5; cursor: move; }
.annotation-vertex.vertex-selected { fill: var(--media-accent); stroke: #fff; stroke-width: 2; }
.annotation-midpoint { cursor: copy; }
.annotation-midpoint circle { r: calc(5.5px * var(--annotation-unit)); fill: rgb(255 255 255 / 60%); stroke: rgb(20 16 40 / 55%); stroke-width: 1; }
.annotation-midpoint path { scale: var(--annotation-unit); stroke: #2a2350; stroke-width: 1.4; }
[data-moving] { opacity: 0; }
.annotation-draft { pointer-events: none; }
.annotation-svg :deep(.annotation-draft-fill) { fill: rgb(179 161 255 / 7%); }
.annotation-svg :deep(.annotation-draft-line), .annotation-svg :deep(.annotation-rubber) { fill: none; stroke: var(--media-accent); stroke-width: 1.5; }
.annotation-svg :deep(.annotation-rubber) { stroke-dasharray: 5 4; }
.annotation-svg :deep(.annotation-closing) { fill: none; stroke: rgb(255 255 255 / 60%); stroke-width: 1.2; stroke-dasharray: 2 4; }
.annotation-svg :deep(.annotation-start) { fill: rgb(179 161 255 / 22%); stroke: #fff; stroke-width: 1.5; }
.annotation-summary, .annotation-selection, .annotation-comment { position: absolute; top: 0; left: 0; visibility: hidden; }
.annotation-summary { max-width: 232px; padding: 5px 9px; border-radius: 8px; color: #fff; background: rgb(16 14 24 / 84%); box-shadow: 0 0 0 1px rgb(255 255 255 / 10%), var(--sh-1); font-size: var(--fz-xs); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.annotation-summary b { color: var(--media-accent); margin-right: 6px; }
.annotation-selection, .annotation-comment { display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: var(--r3); background: var(--raised); box-shadow: 0 0 0 1px var(--line-2), var(--sh-1); pointer-events: auto; }
.annotation-selection .ibtn { flex: none; width: 28px; height: 28px; --ico: var(--ico-sm); }
.annotation-badge { flex: none; margin-inline: 4px; min-width: 20px; border-radius: var(--r1); color: var(--a); background: var(--a-dim); font: var(--fw-medium) var(--fz-2xs)/20px var(--mono); text-align: center; }
.annotation-comment { z-index: 2; align-items: flex-end; gap: 4px; width: min(288px,calc(100% - 16px)); padding: 5px 5px 5px 10px; }
.annotation-comment textarea { display: block; flex: 1; min-width: 0; min-height: 20px; max-height: 100px; margin: 4px 0; padding: 0; resize: none; background: none; border: 0; border-radius: 0; outline: none; color: var(--fg); font: var(--fz-sm)/20px var(--sans); box-shadow: none; }
.annotation-comment:focus-within { box-shadow: 0 0 0 1px var(--a-line),var(--sh-1); }
.annotation-comment.reference-dragging { outline: 1px dashed var(--a); outline-offset: -1px; }
.annotation-comment .ibtn { flex: none; width: 28px; height: 28px; --ico: var(--ico-sm); }
.annotation-comment :deep(.popover-menu-host) { flex: none; }
.annotation-comment .annotation-reference-trigger { position: relative; width: auto; min-width: 28px; padding: 0 4px; color: var(--fg-3); }
.annotation-reference-trigger[aria-expanded="true"] { color: var(--a); background: var(--a-dim); }
.annotation-reference-stack { display: inline-flex; align-items: center; }
.annotation-reference-stack img { width: 18px; height: 18px; border-radius: 4px; background: var(--well); object-fit: cover; box-shadow: 0 0 0 1px var(--raised); }
.annotation-reference-stack img+img { margin-left: -10px; }
.annotation-reference-stack small { margin-left: 4px; font: var(--fz-2xs)/1 var(--mono); }
.annotation-reference-warning { position: absolute; top: 3px; right: 1px; width: 5px; height: 5px; border-radius: 50%; background: var(--warn); }
.annotation-save { color: var(--a); }
.annotation-save:hover { background: var(--a-dim); }
.annotation-comment :deep(.annotation-reference-menu) { min-width: 156px; }
/* The shell receives pointer focus; individual choices keep their keyboard focus rings. */
.annotation-comment :deep(.annotation-reference-menu:focus) { outline: none; }
.annotation-reference-picker { display: grid; grid-template-columns: repeat(var(--reference-columns),44px); gap: 8px; max-height: 190px; overflow-y: auto; padding: 5px; }
.annotation-reference-upload { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 30px; padding: 4px 6px; border-radius: var(--r1); color: var(--fg-2); font-size: var(--fz-xs); white-space: nowrap; --ico: var(--ico-sm); }
.annotation-reference-upload:hover:enabled { color: var(--fg); background: var(--hover); }
.annotation-reference-upload:disabled { opacity: .45; cursor: default; }
.annotation-reference-upload small { margin-left: auto; color: var(--fg-3); font: var(--fz-2xs)/1 var(--mono); }
.annotation-reference-picker > button { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 2px; border-radius: var(--r1); color: var(--fg-3); font: var(--fz-2xs)/1.2 var(--mono); }
.annotation-reference-image { position: relative; display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--r2); background: var(--well); box-shadow: 0 0 0 1px var(--line); --ico: var(--ico-sm); }
.annotation-reference-image img { width: 100%; height: 100%; border-radius: inherit; object-fit: contain; }
.annotation-reference-picker > button:hover { color: var(--fg); }
.annotation-reference-picker > button[aria-checked="true"] { color: var(--a); }
.annotation-reference-picker > button[aria-checked="true"] .annotation-reference-image { box-shadow: 0 0 0 1.5px var(--a); }
.annotation-reference-check { position: absolute; right: -3px; bottom: -3px; padding: 2px; border-radius: 50%; color: var(--media-surface); background: var(--media-accent); --ico: var(--ico-sm); }
.annotation-missing-references { display: flex; flex-direction: column; gap: 6px; padding: 6px; }
.annotation-missing-references button { display: inline-flex; align-items: center; gap: 4px; color: var(--warn); font-size: var(--fz-xs); --ico: var(--ico-xs); }
.annotation-toolbar { gap: 2px; overflow-x: auto; scrollbar-width: none; }
.annotation-toolbar > * { flex-shrink: 0; }
.annotation-finish { color: var(--a); --ico: var(--ico-sm); }
.annotation-separator { width: 1px; height: 16px; margin-inline: 3px; background: var(--line-2); }
@media (max-width: 600px) {
  .annotation-toolbar { --editor-tool-size: 28px; gap: 0; }
  .annotation-comment textarea { font-size: var(--fz-md); }
}
@media (pointer: coarse) { .annotation-comment .ibtn { min-width: 32px; height: 32px; } }
</style>
