<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue';
import { useBridge } from '../../app/bridge.ts';
import { useDrawing } from '../../app/drawing.ts';
import { useUi, message } from '../../app/ui.ts';
import { characterCapability } from '../../domain/characters.ts';
import { copyText } from '../../shared/files.ts';
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
import { composeProjectTags, parseProjectTags } from './model.ts';
import type { ProjectCharacter, ProjectTags } from './model.ts';
import { useProjectActions } from './use-project-actions.ts';
import ProjectMedia from './ProjectMedia.vue';
import ProjectFile from './ProjectFile.vue';
const props=defineProps<{character:ProjectCharacter}>(), bridge=useBridge(), {drawing,view}=useDrawing(), ui=useUi(), actions=useProjectActions(), id=useId();
defineEmits<{back:[]}>();
const outfitChoices=new Map<string,string>();
const profile=shallowRef<InstanceType<typeof ProjectFile>>();
const tab=shallowRef('tags'),tags=shallowRef<ProjectTags|null>(null),outfit=shallowRef(''),error=shallowRef(''),busy=shallowRef(false);
const composed=computed(()=>tags.value?composeProjectTags(tags.value,outfit.value):null), cap=computed(()=>characterCapability(view.value.form.model));
const canAdd=computed(()=>cap.value.max>view.value.form.characters.length);
let controller:AbortController|undefined, characterKey='';
watch([()=>JSON.stringify(props.character),()=>bridge.refFiles.value.find(f=>f.path===props.character.tags.path)?.modified,()=>bridge.refFiles.value.find(f=>f.path===props.character.tags.path)?.bytes,()=>bridge.projectEpoch.value],async()=>{
  const c=props.character,key=`${bridge.projectEpoch.value}:${c.path}`,previous=outfitChoices.get(key)??(key===characterKey?outfit.value:undefined);
  controller?.abort();const own=controller=new AbortController();tags.value=null;outfit.value='';error.value='';if(key!==characterKey)tab.value='tags';characterKey=key;
  if(!c.tags.available)return;
  try{let next=c.tagContent;if(!next){const source=bridge.referenceSnapshot();if(!source||!c.tags.path)throw new Error('TAG 来源已断开');const {file}=await source.read(c.tags.path,own.signal,1024*1024);const value=await file.text();own.signal.throwIfAborted();next=parseProjectTags(value);}outfit.value=previous===undefined?(next.outfits[0]?.id??''):next.outfits.some(o=>o.id===previous)?previous:'';tags.value=next;}
  catch(e){if(!own.signal.aborted)error.value=message(e);}
},{immediate:true});
watch(outfit,value=>{if(tags.value)outfitChoices.set(characterKey,value);});
onBeforeUnmount(()=>controller?.abort());
async function fill(target:string){
  if(!composed.value||busy.value)return;busy.value=true;
  const d=drawing.snapshot(), value=composed.value;
  try{if(target==='new'){const added=await drawing.addCharacter(value.prompt,value.negative);if(!added)throw new Error('当前模型没有可用角色槽');}
    else{if(!cap.value.max||!d.form.characters.some(c=>c.id===target))throw new Error('角色槽不可用');await drawing.editCharacters(d.form.characters.map(c=>c.id===target?{...c,...value,on:true}:c),d.form.placement,d.activeBoardId);}
    ui.toast('已填入角色栏');
  }catch(e){error.value=message(e);}finally{busy.value=false;}
}
async function copy(){if(composed.value)try{await copyText(composed.value.prompt);ui.toast('TAG 已复制');}catch(e){error.value=message(e);}}
async function copySource(){if(tab.value==='profile')return profile.value?.copy();if(!composed.value)return;try{await copyText(composed.value.prompt+(composed.value.negative?'\n\nNegative\n'+composed.value.negative:''));ui.toast('已复制原文');}catch(e){ui.toast(message(e),'err');}}
function quote(){const c=props.character;actions.quote([c.tags.path,c.profile,c.brief_path].filter((p,i,a)=>p&&a.indexOf(p)===i).join('、')||`${c.path}/`,c.name);}
</script>
<template>
  <section class="project-character" aria-label="角色详情">
    <div class="character-scroll">
      <ProjectMedia :character="character"/>
      <div class="character-info">
        <header class="character-head"><div><h3>{{ character.name }}</h3><p v-if="character.aliases.length" class="character-aliases">{{ character.aliases.slice(0,2).join(' · ') }}</p></div><button class="btn btn-primary character-ask" type="button" aria-label="引用角色资料给 ASK" @click="quote"><AppIcon name="i-ask"/>ASK</button></header>
        <p v-if="character.brief" class="character-summary" :title="character.brief">{{ character.brief.split(/[。；]/)[0] }}。</p>
      </div>
      <section class="character-reading" aria-label="配方与人设">
        <header class="reading-head"><button class="ibtn detail-back" type="button" aria-label="返回角色总览" @click="$emit('back')"><AppIcon name="i-back"/></button><div class="character-tabs" role="group" aria-label="角色资料"><label v-for="t in [{id:'tags',label:'TAG'},{id:'profile',label:'人设'}]" :key="t.id"><input v-model="tab" type="radio" :name="id+'-tab'" :value="t.id"/><span>{{ t.label }}</span></label></div><button class="btn btn-link btn-sm source-copy" type="button" aria-label="复制当前原文" :disabled="tab==='tags' ? !composed : !character.profile" @click="copySource"><AppIcon name="i-copy"/>复制原文</button></header>
        <div v-if="tab==='tags' && tags?.outfits.length" class="outfit-bar" role="group" aria-label="角色服装"><label v-for="o in [...tags.outfits,{id:'',label:'仅共同 TAG'}]" :key="o.id"><input v-model="outfit" type="radio" :name="id+'-outfit'" :value="o.id"/><span>{{ o.label }}</span></label></div>
        <template v-if="tab==='tags'"><div v-if="composed" class="tag-well" role="region" aria-label="TAG原文" tabindex="0"><pre>{{ composed.prompt || '无正向 TAG' }}</pre><template v-if="composed.negative"><small>Negative</small><pre>{{ composed.negative }}</pre></template></div><p v-else class="character-hint">{{ error ? 'TAG 无法读取' : character.tags.available ? '正在读取 TAG…' : '暂无 TAG' }}</p></template>
        <ProjectFile v-else-if="character.profile" ref="profile" :path="character.profile" embedded/>
        <p v-else class="character-hint">暂无完整人设</p>
      </section>
      <div v-if="character.issues.length || error" class="character-errors"><p v-for="issue in character.issues" :key="issue">{{ issue }}</p><p v-if="error" role="status">{{ error }}</p></div>
    </div>
    <footer class="character-actions"><button class="btn btn-quiet" type="button" :disabled="!composed" @click="copy"><AppIcon name="i-copy"/>复制 TAG</button>
      <PopoverMenu :id="id+'-slots'" label="填入角色栏" side="right"><template #trigger="{open,toggle}"><button class="btn btn-primary" type="button" :disabled="!composed || busy || !cap.max" :title="cap.max ? '' : '当前 IMAGE 模型不支持角色槽'" :aria-expanded="open" aria-haspopup="menu" @click="toggle">填入角色栏<AppIcon name="i-chevron"/></button></template><template #default="{close}"><button class="menu-item" role="menuitem" :disabled="!canAdd" @click="close(); fill('new')"><AppIcon name="i-plus"/><span class="menu-label">新增角色槽</span></button><button v-for="c in view.form.characters" :key="c.id" class="menu-item" role="menuitem" @click="close(); fill(c.id)"><span class="menu-label">替换 {{ c.id }}</span></button></template></PopoverMenu>
    </footer>
  </section>
</template>
<style scoped>
.project-character { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; background: var(--chrome); }
.character-scroll { display: flex; flex: 1; flex-direction: column; min-height: 0; padding-bottom: 16px; overflow: auto; overscroll-behavior: contain; }
.character-info { flex: none; padding: 12px 24px; }
.character-head { display: flex; align-items: center; gap: 16px; }
.character-head > div { flex: 1; min-width: 0; }
.character-head h3 { margin: 0; font-size: 22px; line-height: 1.45; overflow-wrap: anywhere; }
.character-aliases { margin: 4px 0 0; color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.6; overflow-wrap: anywhere; }
.character-ask { flex: none; gap: 8px; min-width: 88px; min-height: 36px; padding: 8px 16px; border-radius: var(--r3); --ico: var(--ico-md); }
.character-summary { margin: 8px 0 0; overflow: hidden; color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.8; text-overflow: ellipsis; white-space: nowrap; }
.character-reading { display: flex; flex: 1; flex-direction: column; min-height: 280px; margin: 0 16px; overflow: hidden; background: color-mix(in srgb, var(--chrome) 50%, var(--raised)); border: 1px solid var(--line-2); border-radius: var(--r4); }
.reading-head { display: flex; flex: none; align-items: center; gap: 12px; padding: 8px 16px 4px; }
.character-tabs { display: flex; gap: 20px; }
.character-tabs label, .outfit-bar label { position: relative; flex: none; cursor: pointer; }
.character-tabs input, .outfit-bar input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.character-tabs span { display: block; min-height: 28px; padding: 4px 0; color: var(--fg-3); font-size: var(--fz-sm); }
.character-tabs input:checked + span { color: var(--fg); }
.character-tabs input:focus-visible + span, .outfit-bar input:focus-visible + span { outline: 1px solid var(--a-line); outline-offset: -1px; }
.source-copy { margin-left: auto; padding: 4px 0; color: var(--fg-3); --ico: var(--ico-sm); }
.outfit-bar { display: flex; flex: none; gap: 4px; padding: 2px 12px 8px; overflow-x: auto; scrollbar-width: thin; }
.outfit-bar span { display: block; min-height: 28px; padding: 5px 12px; color: var(--fg-3); font-size: var(--fz-xs); line-height: 18px; white-space: nowrap; border-radius: var(--r2); }
.outfit-bar label:hover span { color: var(--fg-2); background: var(--hover); }
.outfit-bar input:checked + span { color: var(--fg); background: var(--raised); }
.tag-well { flex: 1; min-height: 0; padding: 12px 16px 16px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.tag-well pre { margin: 0; color: var(--fg-2); font: var(--fz-sm)/1.8 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
.tag-well small { display: block; margin: 16px 0 4px; color: var(--fg-3); }
.tag-well:focus-visible { outline: 1px solid var(--a-line); outline-offset: -1px; }
.character-actions { display: grid; grid-template-columns: 1fr 1fr; flex: none; gap: 12px; min-height: 64px; padding: 12px 16px; }
.character-actions > button, .character-actions :deep(.popover-menu-host > button) { width: 100%; min-height: 40px; border-radius: var(--r3); }
.character-hint { margin: 0; padding: 12px 16px; color: var(--fg-3); font-size: var(--fz-sm); }
.character-errors { flex: none; margin: 12px 24px 0; color: var(--warn); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.character-errors p { margin: 4px 0; }
.detail-back { display: none; }
@container project-window (max-width: 760px) { .detail-back { display: flex; } .character-info { padding: 16px 24px; } .character-reading { min-height: 240px; } }
</style>
