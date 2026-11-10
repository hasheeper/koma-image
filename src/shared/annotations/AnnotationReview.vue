<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { useAnnotations } from '../../app/annotations.ts';
import { useUi, message } from '../../app/ui.ts';
import { annotationAlignment, canMaskAnnotations } from '../../domain/region-annotation.ts';
import { composeAnnotatedResult } from '../../native/inpaint-result.ts';
import { usePhotopea } from '../../app/photopea.ts';
import { compositeKey } from '../../native/inpaint-result.ts';
import { annotationMask } from '../../native/annotation-canvas.ts';
import AppIcon from '../AppIcon.vue';
import PhotopeaIcon from '../PhotopeaIcon.vue';
const photopea=usePhotopea(),colorMatch=shallowRef(true);
const service=useAnnotations(),ui=useUi(),review=service.review.value!;
const hasArea=canMaskAnnotations(review.snapshot.regions);
const dialog=shallowRef<HTMLDialogElement>(),mode=shallowRef<'source'|'raw'|'preview'>('raw'),busy=shallowRef(false),compatible=shallowRef(false),checked=shallowRef(false),size=shallowRef(''),previewUrl=shallowRef('');
const originalUrl=URL.createObjectURL(review.source),rawUrl=URL.createObjectURL(review.raw),url=computed(()=>mode.value==='source'?originalUrl:mode.value==='raw'?rawUrl:previewUrl.value);
let output:Blob|undefined;const controller=new AbortController();
async function toggleColor(){output=undefined;if(previewUrl.value)URL.revokeObjectURL(previewUrl.value);previewUrl.value='';if(mode.value==='preview')await preview();}
function fusion(){try{if(!review.valid())throw new Error('改图记录已变化，请重新打开');const options={colorMatch:colorMatch.value};photopea.open({id:crypto.randomUUID(),title:'融合精修',fusion:{key:`chat:${review.key}:${compositeKey(options)}`,title:'融合精修',source:review.source,raw:review.raw,mask:annotationMask(review.snapshot),edges:{...review.snapshot.edges},options,valid:review.valid,alive:review.alive,apply:blob=>review.apply(blob,{colorMatch:options.colorMatch,method:'photopea'})}});service.review.value=null;}catch(e){ui.toast(message(e),'err');}}
async function preview(){if(!compatible.value||busy.value)return;busy.value=true;try{output??=await composeAnnotatedResult(review.source,review.raw,review.snapshot,controller.signal,{colorMatch:colorMatch.value});if(!previewUrl.value)previewUrl.value=URL.createObjectURL(output);mode.value='preview';}catch(e){if(!controller.signal.aborted)ui.toast(message(e),'err');}finally{busy.value=false;}}
async function apply(){if(!compatible.value||busy.value)return;busy.value=true;try{output??=await composeAnnotatedResult(review.source,review.raw,review.snapshot,controller.signal,{colorMatch:colorMatch.value});controller.signal.throwIfAborted();await review.apply(output,{colorMatch:colorMatch.value,method:'local'});service.review.value=null;ui.toast('已应用本地蒙版，直出图已保留','ok');}catch(e){if(!controller.signal.aborted)ui.toast(message(e),'err');}finally{busy.value=false;}}
onMounted(async()=>{dialog.value?.showModal();try{const b=await createImageBitmap(review.raw);try{compatible.value=hasArea&&!!annotationAlignment(review.snapshot,b);size.value=`${b.width}×${b.height} → ${review.snapshot.width}×${review.snapshot.height}`;}finally{b.close();}}catch(e){ui.toast(message(e),'err');}finally{checked.value=true;}});
onBeforeUnmount(()=>{controller.abort();for(const url of [originalUrl,rawUrl,previewUrl.value])if(url)URL.revokeObjectURL(url);dialog.value?.close();});
</script>
<template><Teleport to="body"><dialog ref="dialog" class="annotation-review" aria-label="审核批注改图" @keydown.stop @keyup.stop @cancel.prevent="!busy && (service.review.value=null)">
  <header><strong>{{ review.title }}</strong><span class="mono">{{ size }}</span><button class="ibtn" aria-label="关闭审核" :disabled="busy" @click="service.review.value=null"><AppIcon name="i-close" /></button></header>
  <div class="review-stage"><img v-if="url" :src="url" :alt="mode==='source'?'干净原图':mode==='raw'?'模型直出':'本地回贴预览'" /></div>
  <footer>
    <div class="seg" role="group" aria-label="对比图片">
      <button :aria-pressed="mode==='source'" @click="mode='source'">原图</button>
      <button :aria-pressed="mode==='raw'" autofocus @click="mode='raw'">AI 生成</button>
      <button :aria-pressed="mode==='preview'" :disabled="!compatible || busy" @click="preview">蒙版替换</button>
    </div>
    <label v-if="compatible" class="review-color">
      <input v-model="colorMatch" type="checkbox" role="switch" aria-label="色彩对齐" :disabled="busy" @change="toggleColor" />
      <span class="switch" aria-hidden="true" /><span>色彩对齐</span>
    </label>
    <div class="review-actions">
      <button v-if="compatible" class="btn btn-quiet btn-sm" aria-label="融合精修" title="在 Photopea 中融合精修" :disabled="busy" @click="fusion"><PhotopeaIcon />融合精修</button>
      <button class="btn btn-primary btn-sm" :disabled="!compatible || busy" @click="apply"><AppIcon name="i-check" />{{ busy?'处理中…':'应用蒙版' }}</button>
    </div>
    <span v-if="checked && !compatible" class="review-note" role="status">{{ !hasArea?'点批注没有选区范围，无法应用蒙版':'方向或宽高比不符，无法应用蒙版' }}</span>
  </footer>
</dialog></Teleport></template>
<style scoped>
.annotation-review { width: min(1100px, calc(100vw - 32px)); height: min(900px, calc(100dvh - 32px)); max-width: none; max-height: none; margin: auto; padding: 0; background: var(--chrome); color: var(--fg); border: 1px solid var(--line-2); border-radius: var(--r4); overflow: hidden; }
.annotation-review[open] { display: flex; flex-direction: column; }
.annotation-review::backdrop { background: rgb(0 0 0 / .6); }
.annotation-review header, .annotation-review footer { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); }
.annotation-review header strong { font-size: var(--fz-md); }
.annotation-review header span { flex: 1; color: var(--fg-3); font-size: var(--fz-xs); }
.review-stage { min-height: 0; flex: 1; display: grid; place-items: center; background: var(--stage); padding: var(--sp-4); }
.review-stage img { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; }
.annotation-review footer { flex-wrap: wrap; }
.annotation-review .seg button { padding: 6px 10px; border-radius: var(--r1); color: var(--seg-ink); font-size: var(--fz-sm); }
.annotation-review .seg button[aria-pressed="true"] { background: var(--seg-active-bg); color: var(--seg-active-ink); box-shadow: var(--seg-active-shadow); }
.review-color { position: relative; display: inline-flex; align-items: center; gap: var(--sp-2); flex: none; font-size: var(--fz-xs); color: var(--fg-2); cursor: pointer; }
.review-color input { position: absolute; opacity: 0; width: 0; height: 0; }
.review-actions { display: flex; align-items: center; gap: var(--sp-2); margin-left: auto; }
.review-note { flex-basis: 100%; color: var(--fg-3); font-size: var(--fz-xs); }
@media (max-width: 600px) { .annotation-review { width: 100vw; height: 100dvh; border: 0; border-radius: 0; } .annotation-review footer { padding-bottom: max(var(--sp-3), env(safe-area-inset-bottom)); } .annotation-review .seg { flex: 1 0 100%; } }
</style>
