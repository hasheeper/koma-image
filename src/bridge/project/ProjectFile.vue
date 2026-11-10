<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { useBridge } from '../../app/bridge.ts';
import { useUi, message } from '../../app/ui.ts';
import { copyText } from '../../shared/files.ts';
import AppIcon from '../../shared/AppIcon.vue';
import { refKind } from './paths.ts';
import { projectObject } from './model.ts';
import { useProjectActions } from './use-project-actions.ts';
import ProjectImageFile from './ProjectImageFile.vue';
import ProjectActions from './ProjectActions.vue';
const props=defineProps<{path:string;title?:string;description?:string; embedded?:boolean}>(), bridge=useBridge(), actions=useProjectActions();
const ui=useUi();
const text=shallowRef(''),error=shallowRef(''),loading=shallowRef(false),label=shallowRef(''),documentTitle=shallowRef('');
const image=computed(()=>refKind(props.path)==='image');let controller:AbortController|undefined;
watch([()=>props.path,()=>bridge.refFiles.value.find(f=>f.path===props.path)?.modified,()=>bridge.refFiles.value.find(f=>f.path===props.path)?.bytes,()=>bridge.projectEpoch.value],async()=>{
  controller?.abort();const own=controller=new AbortController();text.value='';error.value='';label.value='';documentTitle.value='';loading.value=false;if(image.value)return;
  loading.value=true;
  try {
    const source=bridge.referenceSnapshot();if(!source)throw new Error('目录已断开');
    const {file}=await source.read(props.path,own.signal,8*1024*1024),value=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());own.signal.throwIfAborted();text.value=value;
    if(props.path.endsWith('.json')){try{const data=projectObject(JSON.parse(value));
      if(data.schema==='koma.bridge.recipe.v1'){label.value='画板配方';documentTitle.value=String(projectObject(data.board).name??'');}
      if(data.schema==='koma.bridge.slate.v1'){const s=projectObject(data.slate),todos=Array.isArray(s.todos)?s.todos:[];label.value=`${props.path.startsWith('refs/')?'任务快照':'任务文件'} · ${todos.filter(t=>projectObject(t).status==='done').length}/${todos.length}`;documentTitle.value=String(s.title??'');}
    }catch{/* Unknown JSON remains readable as original text. */}}
  }catch(e){if(!own.signal.aborted)error.value=message(e);}finally{if(!own.signal.aborted)loading.value=false;}
},{immediate:true});
async function copy(){if(loading.value||error.value)return;try{await copyText(text.value);ui.toast('已复制原文');}catch(e){ui.toast(message(e),'err');}}
defineExpose({copy});
onBeforeUnmount(()=>controller?.abort());
</script>
<template>
  <ProjectImageFile v-if="image" class="project-file" :path="path" :title="title" :description="description"/>
  <section v-else class="project-file" :class="{embedded,document:!embedded}">
    <div v-if="!embedded" class="file-top"><header class="file-head"><div class="file-heading"><h3 :title="documentTitle || title || path.split('/').at(-1)">{{ documentTitle || title || path.split('/').at(-1) }}</h3><small :title="path">{{ path }}</small><span v-if="label" class="file-label">{{ label }}</span></div><div class="file-tools"><button class="btn btn-primary file-ask" type="button" @click="actions.quote(path,title || documentTitle || path)"><AppIcon name="i-ask"/>ASK</button><button v-if="!image" class="ibtn" type="button" aria-label="复制原文" title="复制原文" :disabled="loading || !!error" @click="copy"><AppIcon name="i-copy"/></button><ProjectActions :path="path" :image="image"/></div></header></div>
    <p v-if="description && !embedded" class="description">{{ description }}</p>
    <div class="file-body">
      <p v-if="error" class="file-error" role="status">{{ error }}</p><p v-else-if="loading" class="file-hint">读取中…</p>
      <pre v-if="!loading && !error" class="file-raw" role="region" :aria-label="embedded ? '人设原文' : '资料原文'" tabindex="0">{{ text }}</pre>
    </div>
  </section>
</template>
<style scoped>
.project-file { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.file-top { flex: none; min-width: 0; }
.file-body { display: flex; flex-direction: column; min-height: 0; }
.file-head { display: flex; flex: none; align-items: flex-start; gap: var(--sp-4); }
.file-heading { flex: 1; min-width: 0; }
.file-heading h3 { margin: 0 0 var(--sp-1); overflow: hidden; font-size: var(--fz-lg); line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.file-heading small { display: block; overflow: hidden; color: var(--fg-3); font: var(--fz-xs)/1.5 var(--mono), var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.file-label { display: block; margin-top: var(--sp-1); color: var(--fg-3); font-size: var(--fz-xs); }
.file-tools { display: flex; flex: none; align-items: center; gap: var(--sp-1); }
.file-ask { min-width: 0; min-height: 32px; margin-right: var(--sp-1); padding: var(--sp-1) var(--sp-3); border-radius: var(--r3); --ico: var(--ico-md); }
.file-tools :deep(.ibtn) { width: 32px; height: 32px; color: var(--fg-3); border-radius: var(--r3); }
.file-tools :deep(.ibtn:hover) { color: var(--fg); }
.description { flex: none; margin: 0; color: var(--fg-2); line-height: 1.6; overflow-wrap: anywhere; }
.file-raw { min-height: 0; margin: 0; overflow: auto; color: var(--fg-2); font: var(--fz-sm)/1.85 var(--mono), var(--sans); font-variant-ligatures: none; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; overscroll-behavior: contain; scrollbar-width: thin; }
.file-raw:focus-visible { outline: 1px solid var(--a-line); outline-offset: -1px; }
.file-error { margin: 0; color: var(--warn); font-size: var(--fz-sm); overflow-wrap: anywhere; }
.file-hint { margin: 0; color: var(--fg-3); font-size: var(--fz-sm); }
.project-file.document { gap: 0; }
.document .file-top { padding-inline: var(--document-gutter, var(--sp-6)); overflow: hidden; scrollbar-gutter: stable; scrollbar-width: thin; }
.document .file-head { max-width: 820px; margin-inline: auto; padding-bottom: var(--sp-4); border-bottom: 1px solid var(--line); }
.document .file-body { display: block; flex: 1; padding: var(--sp-5) var(--document-gutter, var(--sp-6)) var(--sp-7); overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; }
.document .file-raw, .document .file-hint, .document .file-error { max-width: 820px; margin-inline: auto; }
.document .file-raw { overflow: visible; }
.project-file.embedded { flex: 1; overflow: hidden; }
.embedded .file-body { flex: 1; overflow: hidden; }
.embedded .file-raw { flex: 1; min-height: 0; padding: 12px 16px 16px; background: none; border: 0; border-radius: 0; }
.embedded .file-hint, .embedded .file-error { padding: 12px 16px; }
@container project-window (max-width: 760px) {
  .file-head { gap: var(--sp-3); }
}
@media (max-width: 640px) {
  .file-tools :deep(.ibtn) { width: 44px; height: 44px; }
  .file-tools { gap: 0; }
}
</style>
