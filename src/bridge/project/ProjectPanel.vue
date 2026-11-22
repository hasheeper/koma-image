<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useId, watch } from 'vue';
import { useBridge } from '../../app/bridge.ts';
import { useSlates } from '../../app/slate.ts';
import { useAsk } from '../../app/ask.ts';
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
import ProjectImage from './ProjectImage.vue';
import ProjectCharacter from './ProjectCharacter.vue';
import ProjectFile from './ProjectFile.vue';
import ProjectFileTree from './ProjectFileTree.vue';
import ProjectResults from './ProjectResults.vue';
import GalleryLayoutSwitch from '../../shared/gallery/GalleryLayoutSwitch.vue';
import type { GalleryLayout } from '../../shared/gallery/layout.ts';
import { projectResults } from './results.ts';
const bridge=useBridge(), slates=useSlates(), ask=useAsk(), id=useId(), originalFocus=document.activeElement;
const brandIcon=`${import.meta.env.BASE_URL}assets/favicon-image.svg`;
type Tab='characters'|'lore'|'references'|'results';
const tab=shallowRef<Tab>('characters'),selection=shallowRef<Record<Tab,string>>({characters:'',lore:'',references:'',results:''}),detail=shallowRef(false),filter=shallowRef(''),search=shallowRef(''),file=shallowRef(''),refreshing=shallowRef(false),dialog=shallowRef<HTMLDialogElement>();
const collapsedFolders=shallowRef<ReadonlySet<string>>(new Set());
const resultGallery=shallowRef<InstanceType<typeof ProjectResults>>();
const detailBack=shallowRef<HTMLButtonElement>();
const resultLayout=shallowRef<GalleryLayout>('rows');
const fileTree=computed(()=>tab.value==='lore'||tab.value==='references');
const project=computed(()=>bridge.project.value),results=computed(()=>projectResults(bridge.refFiles.value,bridge.slateMappings.value));
const tabs=computed(()=>[{id:'characters' as const,label:'角色',icon:'i-layers',count:project.value?.characters.length??0},{id:'lore' as const,label:'设定',icon:'i-file',count:project.value?.lore.length??0},{id:'references' as const,label:'参考',icon:'i-image',count:project.value?.references.length??0},{id:'results' as const,label:'成果',icon:'i-star',count:results.value.length}]);
const rows=computed(()=>{
  const p=project.value;
  const all=tab.value==='characters'?(p?.characters??[]).map(c=>({path:c.path,title:c.name,note:c.brief||c.aliases.join(' · '),image:c.portrait,group:''}))
    :tab.value==='results'?results.value.map(r=>({path:r.path,title:r.mapping?slates.get(r.mapping.id)?.title||r.title:r.title,note:r.missing?'文件缺失':r.mapping?.status==='synced'?'已同步':r.mapping?.status==='conflict'?'待审阅':r.mapping?.status==='error'?'同步异常':r.mapping?'待同步':r.group==='slates'?'任务文件':r.files.length>1?'原图 · 回执 / 打标':r.group==='refs'?'共享资料':'成果',image:/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(r.path)?r.path:null,group:r.group,warning:r.missing||r.mapping?.status==='conflict'||r.mapping?.status==='error'}))
    :(tab.value==='lore'?p?.lore:p?.references)?.map(r=>({path:r.path,title:r.title,note:r.description||r.path,image:tab.value==='references'?r.path:null,group:tab.value==='references'?r.category??'未分类':r.path.split('/').slice(0,-1).join('/')||'根目录'}))??[];
  const q=search.value.trim().toLocaleLowerCase();return all.filter(r=>(!filter.value||r.group===filter.value)&&(!q||`${r.title} ${r.note} ${r.path}`.toLocaleLowerCase().includes(q)));
});
const groups=computed(()=>tab.value==='results'?['assets','slates','refs']:tab.value==='references'?[...new Set(project.value?.references.map(r=>r.category??'未分类')??[])]:[]);
const selected=computed(()=>rows.value.find(r=>r.path===selection.value[tab.value])??rows.value[0]);
const character=computed(()=>project.value?.characters.find(c=>c.path===selected.value?.path));
const result=computed(()=>results.value.find(r=>r.path===selected.value?.path));
watch(tab,()=>{filter.value='';search.value='';detail.value=false;file.value='';});
watch(()=>selected.value?.path,()=>{file.value='';});
watch(()=>bridge.projectEpoch.value,()=>{selection.value={characters:'',lore:'',references:'',results:''};collapsedFolders.value=new Set();detail.value=false;file.value='';});
async function choose(path:string){selection.value={...selection.value,[tab.value]:path};detail.value=true;file.value='';if(tab.value==='results'){await nextTick();detailBack.value?.focus({preventScroll:true});}}
async function back(){detail.value=false;await nextTick();if(tab.value==='results')resultGallery.value?.focusItem(selected.value?.path);}
function close(){dialog.value?.close();bridge.closeProject();}
async function refresh(){refreshing.value=true;try{await bridge.refreshProject();}finally{refreshing.value=false;}}
async function task(){const r=result.value;if(!r?.mapping)return;if(r.mapping.status==='synced'&&slates.get(r.mapping.id)){if(await ask.openSlate(r.mapping.id)){close();ask.show();}}else{await bridge.resolveSlate(r.mapping.id,'review');if(!bridge.error.value){close();ask.show();}}}
onMounted(async()=>{await nextTick();dialog.value?.showModal();});
onBeforeUnmount(()=>{dialog.value?.close();if(originalFocus instanceof HTMLElement&&originalFocus.isConnected)originalFocus.focus({preventScroll:true});});
</script>
<template>
  <dialog ref="dialog" class="modal project-panel" aria-label="企划集" @cancel.prevent="close" @keydown.stop>
    <div class="project-layout" :class="[tab,{detail}]">
      <aside class="project-nav">
        <div class="nav-brand"><img :src="brandIcon" alt=""/><span class="brand-title">Koma</span></div>
        <div class="project-summary" :title="project?.description"><h2 tabindex="-1" autofocus>{{ project?.title || bridge.directory.value || '企划集' }}</h2></div>
        <nav aria-label="企划栏目"><button v-for="t in tabs" :key="t.id" type="button" :class="{active:tab===t.id}" :aria-pressed="tab===t.id" :aria-label="t.label" :title="t.label" @click="tab=t.id"><AppIcon :name="t.icon"/><span>{{ t.label }}</span><small>{{ t.count }}</small></button></nav>
        <div v-if="bridge.refs.value.limited || project?.issues.length" class="project-issues"><span v-if="bridge.refs.value.limited">资料较多，当前索引未包含全部文件。</span><details v-if="project?.issues.length"><summary>{{ project.issues.length }} 项资料需检查</summary><p v-for="issue in project.issues" :key="issue">{{ issue }}</p></details></div>
        <footer class="nav-footer"><span class="directory-name" :title="bridge.directory.value || ''">{{ bridge.directory.value }}</span><button class="ibtn" type="button" aria-label="刷新企划" title="刷新企划" :disabled="refreshing || bridge.busy.value" @click="refresh"><AppIcon name="i-retry"/></button>
          <PopoverMenu :id="id+'-manage'" label="企划目录选项" side="right"><template #trigger="{open,toggle}"><button class="ibtn" type="button" aria-label="企划目录选项" :aria-expanded="open" aria-haspopup="menu" @click="toggle"><AppIcon name="i-more"/></button></template><template #default="{close:dismiss}"><button class="menu-item" role="menuitem" :disabled="bridge.busy.value" @click="dismiss(); bridge.mount()"><AppIcon name="i-swap"/><span class="menu-label">切换企划目录</span></button><button class="menu-item" role="menuitem" @click="dismiss(); close(); ask.openSettings()"><AppIcon name="i-settings"/><span class="menu-label">协同设置</span></button><button class="menu-item danger" role="menuitem" :disabled="!bridge.canUnmount.value" @click="dismiss(); bridge.unmount()"><AppIcon name="i-close"/><span class="menu-label">卸载目录</span></button></template></PopoverMenu>
        </footer>
      </aside>
      <div v-if="bridge.phase.value !== 'active' && bridge.phase.value !== 'readonly'" class="project-notice" role="status">
        <span>{{ bridge.error.value || (bridge.phase.value === 'occupied' ? '其他页面正在使用此企划目录' : bridge.busy.value ? '正在连接企划目录…' : bridge.phase.value === 'permission' ? '请点击「恢复连接」并允许读取此企划目录。' : '企划目录未连接') }}</span>
        <button type="button" class="btn btn-quiet btn-sm" :disabled="bridge.busy.value" @click="bridge.resume()">恢复连接</button>
        <button type="button" class="btn btn-quiet btn-sm" :disabled="!bridge.canUnmount.value" @click="bridge.unmount()">卸载目录</button>
      </div>
      <template v-else>
        <section class="project-collection">
          <div v-if="bridge.phase.value === 'readonly'" class="project-readonly">
            <span>{{ bridge.temporaryReader.value ? '本次只读浏览 · 目录身份待确认' : '只读浏览' }}</span><button type="button" class="btn btn-quiet btn-sm" :disabled="bridge.busy.value" @click="bridge.resume()">启用读写同步</button>
          </div>
          <header class="collection-head"><div class="collection-heading"><h1>{{ tabs.find(t=>t.id===tab)?.label }}</h1><span>{{ rows.length }} {{ tab==='characters' ? '位' : '项' }}</span></div><select v-if="tab==='results'" v-model="filter" class="result-filter" aria-label="筛选资料"><option value="">全部</option><option value="assets">作品</option><option value="slates">任务</option><option value="refs">沉淀资料</option></select><GalleryLayoutSwitch v-if="tab==='results'" v-model="resultLayout" label="成果排列"/><label class="project-search"><AppIcon name="i-search"/><input v-model="search" aria-label="查找企划资料" placeholder="查找…" type="search"/></label></header>
          <select v-if="groups.length && tab!=='results'" v-model="filter" class="collection-filter" aria-label="筛选资料"><option value="">全部</option><option v-for="g in groups" :key="g" :value="g">{{ g }}</option></select>
          <template v-if="fileTree"><ProjectFileTree v-if="rows.length" v-model:collapsed="collapsedFolders" :files="rows" :selected="selected?.path" :search="search" @select="choose"/><p v-else class="project-empty">{{ search || filter ? '没有匹配资料' : '暂无资料' }}</p></template>
          <template v-else-if="tab==='results'"><ProjectResults v-if="rows.length" ref="resultGallery" :files="rows" :selected="selection.results" :layout="resultLayout" @select="choose"/><p v-else class="project-empty">{{ search || filter ? '没有匹配资料' : '暂无成果' }}</p></template>
          <nav v-else class="project-list casting" aria-label="企划资料列表">
            <button v-for="r in rows" :key="r.path" type="button" class="project-row" :class="{selected:selected?.path===r.path}" :aria-label="r.title" :aria-current="selected?.path===r.path?'true':undefined" :title="r.path" @click="choose(r.path)"><ProjectImage v-if="r.image" :path="r.image" class="row-image"/><AppIcon v-else name="i-layers"/><span class="row-copy"><b>{{ r.title }}</b><small v-if="tab!=='characters'">{{ r.note }}</small></span></button>
            <p v-if="!rows.length" class="project-empty">{{ search || filter ? '没有匹配资料' : '暂无资料' }}</p>
          </nav>
        </section>
        <main v-if="selected && (tab!=='results' || detail)" class="project-detail" :class="{'character-detail':tab==='characters','document-detail':tab!=='characters' && (!selected.image || !!file),'image-detail':tab!=='characters' && selected.image && !file}">
          <ProjectCharacter v-if="tab==='characters' && character" :character="character" @back="detail=false"/>
          <template v-else><div class="detail-navigation"><button ref="detailBack" class="btn btn-link btn-sm detail-back" type="button" @click="back"><AppIcon name="i-back"/>{{ tab==='results'?'返回成果':'返回列表' }}</button>
            <div v-if="tab==='results' && result && (result.missing || result.mapping || result.files.length>1)" class="result-controls"><span v-if="result.missing" class="result-warning">目录文件缺失</span><button v-if="result.mapping && !result.missing" class="btn btn-quiet btn-sm" :disabled="!ask.canManage.value || bridge.busy.value" @click="task">{{ result.mapping.status==='synced' && slates.get(result.mapping.id) ? '打开任务' : '审阅任务' }}</button><select v-if="result.files.length>1" v-model="file" aria-label="成果文件"><option value="">原图</option><option v-for="f in result.files.slice(1)" :key="f.path" :value="f.path">{{ f.path.endsWith('.txt')?'打标文本':'回执 / 配方' }}</option></select></div></div>
            <ProjectFile v-if="tab!=='results'||!result?.missing" :key="file || selected.path" :path="file || selected.path" :title="selected.title" :description="tab==='references'?project?.references.find(r=>r.path===selected?.path)?.description:undefined"/>
          </template>
        </main>
      </template>
    </div>
    <button class="ibtn project-close" type="button" aria-label="关闭企划集" title="关闭企划集" @click="close"><AppIcon name="i-close"/></button>
  </dialog>
</template>
<style scoped>
.project-panel { position: fixed; inset: 0; width: min(1480px, calc(100% - 64px)); max-width: none; height: min(940px, calc(100dvh - 64px)); max-height: calc(100dvh - 64px); margin: auto; padding: 0; background: var(--canvas); border: 1px solid var(--line-2); border-radius: var(--r4); container: project-window / inline-size; }
.project-panel .project-close { position: absolute; top: 12px; right: 12px; z-index: 1; width: 32px; height: 32px; color: var(--fg-3); border-radius: var(--r2); }
.project-layout { --project-nav-width: 184px; display: grid; grid-template-columns: var(--project-nav-width) 230px minmax(0, 1fr); flex: 1; min-height: 0; overflow: hidden; }
.project-layout.characters { grid-template-columns: var(--project-nav-width) minmax(0, 1fr) clamp(440px, 32vw, 520px); }
.project-layout.results { grid-template-columns: var(--project-nav-width) minmax(0, 1fr); }
.project-nav { display: flex; flex-direction: column; min-height: 0; padding: 16px 12px 12px; background: var(--chrome); }
.nav-brand { display: flex; flex: none; align-items: center; gap: 8px; height: 32px; padding: 0 12px; }
.nav-brand img { width: 22px; height: 22px; }
.nav-brand .brand-title { font-size: 20px; }
.project-summary { margin: 20px 0; padding: 0 12px; }
.project-summary h2 { margin: 0; font-size: var(--fz-md); line-height: 1.6; overflow-wrap: anywhere; outline: none; }
.project-nav nav { display: flex; flex-direction: column; gap: 4px; }
.project-nav nav button { display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 8px 12px; color: var(--fg-2); font-size: var(--fz-sm); text-align: left; border-radius: var(--r3); }
.project-nav nav button:hover { background: var(--raised); }
.project-nav nav button.active { color: var(--a); background: var(--raised); }
.project-nav nav small { margin-left: auto; color: var(--fg-3); font: var(--fz-2xs) var(--mono); }
.nav-footer { display: flex; flex: none; align-items: center; gap: 4px; margin-top: auto; padding: 24px 0 0; }
.directory-name { flex: 1; min-width: 0; overflow: hidden; color: var(--fg-3); font-size: var(--fz-2xs); text-overflow: ellipsis; white-space: nowrap; }
.nav-footer .ibtn { flex: none; width: 28px; height: 28px; color: var(--fg-3); border-radius: var(--r2); }
.project-collection { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 24px 16px 20px; background: var(--chrome); }
.characters .project-collection { padding: 24px 24px 20px; background: var(--canvas); }
.results .project-collection { padding: var(--sp-5) var(--sp-6) var(--sp-6); background: var(--canvas); }
.results .collection-head { justify-content: flex-start; padding-right: 32px; }
.results .project-search { margin-left: auto; }
.result-filter { flex: none; max-width: 120px; height: 32px; padding-block: var(--sp-1); font-size: var(--fz-xs); }
.collection-head { display: flex; flex: none; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
.collection-heading { display: flex; align-items: baseline; gap: 10px; }
.collection-head h1 { margin: 0; font-size: var(--fz-lg); }
.collection-head span { color: var(--fg-3); font-size: var(--fz-2xs); white-space: nowrap; }
.project-search { position: relative; flex: 1; min-width: 100px; max-width: 220px; }
.project-search .ico { position: absolute; top: 50%; left: 12px; color: var(--fg-3); transform: translateY(-50%); }
.project-search input { width: 100%; height: 36px; padding: 8px 12px 8px 36px; font-size: var(--fz-xs); background: var(--canvas); border-color: var(--line-2); }
.collection-filter { flex: none; align-self: flex-start; max-width: 100%; margin-bottom: 16px; }
.project-list { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.project-row { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; min-height: 48px; padding: 8px 12px; color: var(--fg-2); text-align: left; border-radius: var(--r2); }
.project-row:hover, .project-row.selected { background: var(--raised); }
.project-row.selected b { color: var(--fg); }
.project-row > .ico { flex: none; color: var(--fg-3); }
.project-row .row-image { flex: none; width: 40px; height: 44px; }
.row-copy { display: grid; flex: 1; gap: 4px; min-width: 0; }
.row-copy b { overflow: hidden; font-size: var(--fz-sm); font-weight: var(--fw-medium); text-overflow: ellipsis; white-space: nowrap; }
.row-copy small { overflow: hidden; color: var(--fg-3); font-size: var(--fz-xs); text-overflow: ellipsis; white-space: nowrap; }
.project-list.casting { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: clamp(390px, 46dvh, 470px); flex: 1; align-content: start; gap: 16px 12px; padding: 2px; }
.casting .project-row { flex-direction: column; align-items: stretch; min-height: 0; padding: 12px; background: var(--chrome); border: 1px solid var(--line); border-radius: var(--r4); }
.casting .project-row:hover { background: var(--raised); border-color: var(--line-2); }
.casting .project-row.selected { background: var(--raised); border-color: var(--a); }
.casting .project-row .row-image { flex: 1; width: 100%; height: auto; min-height: 0; background: none; }
.casting .row-copy { flex: none; padding-top: 4px; }
.project-detail { min-width: 0; min-height: 0; padding: 56px clamp(24px, 5vw, 80px) 32px; overflow: auto; }
.project-detail :deep(.project-file) { max-width: 960px; }
.project-detail.document-detail { --document-gutter: var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-4); padding: 40px 0 0; overflow: hidden; }
.document-detail :deep(.project-file) { flex: 1; width: 100%; max-width: none; overflow: hidden; }
.document-detail > .detail-navigation { margin: 0 var(--document-gutter); }
.project-detail.image-detail { display: flex; flex-direction: column; padding: var(--sp-7) 0 0; overflow: hidden; }
.image-detail :deep(.project-file) { flex: 1; width: 100%; max-width: none; }
.detail-navigation { display: none; flex: none; align-items: center; flex-wrap: wrap; gap: var(--sp-3); }
.results .detail-navigation { display: flex; }
.image-detail > .detail-navigation { margin: 0 56px var(--sp-4) var(--sp-5); }
.project-detail.character-detail { padding: 36px 0 0; overflow: hidden; }
.detail-back { display: none; }
.results.detail .project-collection { display: none; }
.results .project-detail { grid-column: 2; }
.results .detail-back { display: inline-flex; }
.results .project-detail :deep(.project-file) { margin-inline: auto; }
.result-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-left: auto; }
.result-warning { color: var(--warn); font-size: var(--fz-sm); }
.project-notice { display: flex; grid-column: 2 / -1; align-items: center; justify-content: center; gap: 16px; padding: 24px; color: var(--warn); }
.project-readonly { display: flex; align-items: center; gap: 8px; color: var(--fg-2); font-size: var(--fz-xs); }
.project-empty { margin: 24px 12px; color: var(--fg-3); font-size: var(--fz-sm); }
.project-issues { flex: 0 1 auto; max-height: 120px; margin-top: 24px; overflow: auto; color: var(--warn); font-size: var(--fz-xs); }
.project-issues p { margin: 8px 0; overflow-wrap: anywhere; }
@container project-window (max-width: 1320px) and (min-width: 761px) {
  .project-layout { --project-nav-width: 72px; }
  .project-layout.characters { grid-template-columns: var(--project-nav-width) minmax(0, 1fr) clamp(460px, 40cqw, 520px); }
  .project-nav { padding: 16px 8px; }
  .project-summary, .directory-name, .nav-brand .brand-title, .project-nav nav span, .project-nav nav small { display: none; }
  .nav-brand { justify-content: center; margin-bottom: 24px; padding: 0; }
  .nav-footer { flex-direction: column; gap: 8px; }
  .project-nav nav button { justify-content: center; padding: 12px; }
  .characters .project-collection { padding: 20px 16px; }
  .project-list.casting { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 440px; }
}
@container project-window (max-width: 1020px) and (min-width: 761px) { .project-layout { --project-nav-width: 64px; } .project-layout.characters { grid-template-columns: var(--project-nav-width) minmax(0, 1fr) 360px; } .project-list.casting { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 420px; } }
@container project-window (max-width: 760px) {
  .project-layout, .project-layout.characters, .project-layout.results { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); position: relative; }
  .project-nav { flex-direction: row; align-items: center; gap: 4px; padding: 12px 56px 12px 12px; }
  .nav-brand, .project-summary, .directory-name, .nav-footer > button[aria-label='刷新企划'], .project-nav nav small, .project-issues { display: none; }
  .project-nav nav { flex: 1; flex-direction: row; gap: 4px; }
  .project-nav nav button { flex: 1; justify-content: center; gap: 6px; min-height: 36px; padding: 8px 6px; font-size: var(--fz-xs); }
  .nav-footer { margin: 0; padding: 0; }
  .nav-footer .ibtn { width: 32px; height: 36px; }
  .project-collection, .characters .project-collection, .results .project-collection { padding: 12px 16px 24px; }
  .collection-head { gap: 12px; margin: 8px 0 16px; }
  .project-search { max-width: 55%; }
  .project-list { flex: 1; }
  .project-list.casting { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 360px; gap: 16px 12px; }
  .casting .project-row { padding: 12px 8px; }
  .casting .row-copy b { font-size: var(--fz-xs); }
  .project-layout:not(.detail) .project-detail, .project-layout.detail .project-collection { display: none; }
  .project-layout.detail .character-detail { grid-row: 2; }
  .project-detail { padding: 16px; }
  .project-detail.document-detail { --document-gutter: var(--sp-4); padding: var(--sp-4) 0 0; }
  .project-detail.image-detail { padding-top: var(--sp-2); }
  .detail-navigation { display: flex; }
  .image-detail > .detail-navigation { margin-inline: var(--sp-4); }
  .project-detail.character-detail { padding: 0; }
  .results .collection-head { padding-right: 0; }
  .results .project-detail { grid-column: 1; grid-row: 2; }
  .detail-back { display: inline-flex; }
  .project-notice { grid-column: 1; flex-wrap: wrap; }
}
@container project-window (max-width: 420px) { .project-nav nav span { display: none; } }
@media (max-width: 760px) { .project-panel { width: calc(100% - 24px); height: calc(100dvh - 24px); max-height: calc(100dvh - 24px); } }
</style>
