<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from "vue";
import { useNaiComposer } from "../../app/nai-composer";
import { useServices } from "../../app/services";
import { useUi } from "../../app/ui";
import { message } from "../../app/ui";
import { referenceName } from "../../domain/nai-references";
import type { ReferenceKind, NaiReference } from "../../domain/nai-references";
import AppIcon from "../../shared/AppIcon.vue";
import { placeMenu, menuKeys } from "../../shared/popover";
const props = defineProps<{kind: ReferenceKind}>();
const {drawing,view,id} = useNaiComposer(), {references} = useServices(), ui = useUi();
const selected = ref(0), working = ref(false);
const upload = shallowRef<HTMLInputElement>(), importer = shallowRef<HTMLInputElement>(), menu = shallowRef<HTMLElement>(), more = shallowRef<HTMLButtonElement>();
const refs = computed(()=>view.value.form.naiReferences[props.kind]);
const thumbnailIds = new Set<string>();
function thumbnail(id: string) { thumbnailIds.add(id); return references.thumbnail(id, thumbnailIds); }
watch(()=>refs.value.map(r=>r.assetId), (next,previous)=>{ references.releaseThumbnails(previous.filter(id=>!next.includes(id)), thumbnailIds); });
const current = computed(()=>refs.value[selected.value]);
watch(()=>refs.value.map(r=>r.id).join(),()=>{selected.value=Math.max(0,Math.min(selected.value,refs.value.length-1));});
function settings() { return structuredClone(view.value.form.naiReferences); }
function edit(values: Partial<NaiReference>) {
  const next=settings(), item=next[props.kind][selected.value]; if(!item)return;
  Object.assign(item,values); void drawing.editReferences(next);
}
function slider(key: "strength"|"information"|"fidelity", event: Event) { edit({[key]:Number((event.target as HTMLInputElement).value)}); }
async function files(event: Event, imported=false) {
  const input=event.target as HTMLInputElement, files=Array.from(input.files ?? []); input.value="";
  if(!files.length || working.value)return;
  const boardId=view.value.activeBoardId, kind=props.kind, model=view.value.form.model;
  if(refs.value.length+files.length>16) { ui.toast("每组最多 16 张参考图片","warn");return; }
  working.value=true;
  try {
    const items = imported ? await references.import(files[0],kind,model) : await references.upload(files,kind,model);
    const board=drawing.board(boardId); if(!board)throw new Error("来源已关闭或切换，请重新添加参考");
    const next=structuredClone(board.form.naiReferences);
    if(next[kind].length+items.length>16)throw new Error("每组最多 16 张参考图片");
    next[kind].push(...items); await drawing.editReferences(next,boardId);
    if(view.value.activeBoardId===boardId)selected.value=next[kind].length-items.length;
  } catch(error) { ui.toast(message(error),"err"); }
  finally { working.value=false; }
}
function remove() { const next=settings();next[props.kind].splice(selected.value,1);void drawing.editReferences(next); }
async function exportGroup() {
  close();
  try {
    const blob=await references.export(structuredClone(refs.value),props.kind,view.value.form.model);
    const url=URL.createObjectURL(blob), link=document.createElement("a");link.href=url;link.download=props.kind==='vibe'?'references.naiv4vibebundle':'koma-precise-references.json';link.click();
    // Browser download consumes the URL asynchronously; the owner releases it on the next task.
    const timer=setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(timer);},1000);downloads.set(timer,url);
  } catch(error) {ui.toast(message(error),"err");}
}
const downloads = new Map<ReturnType<typeof setTimeout>,string>();
function close() {menu.value?.hidePopover();}
function position(event: ToggleEvent) {if(event.newState==='open' && menu.value && more.value){menu.value.style.display='grid';placeMenu(menu.value,more.value.getBoundingClientRect());menu.value.style.removeProperty('display');}}
function menuKey(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();more.value?.focus();}else menuKeys(event);}
function clear() { close(); const next=settings();next[props.kind]=[];void drawing.editReferences(next); }
onDeactivated(close);onBeforeUnmount(()=>{references.releaseThumbnails(thumbnailIds, thumbnailIds);for(const [timer,url]of downloads){clearTimeout(timer);URL.revokeObjectURL(url);}});
</script>
<template>
  <div class="bottom-reference-body">
    <input ref="upload" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="files($event)" />
    <input ref="importer" type="file" accept=".json,.naiv4vibe,.naiv4vibebundle,application/json" hidden @change="files($event,true)" />
    <div class="reference-filmstrip">
      <div class="editor-thumbs" :aria-label="referenceName(kind)">
        <button v-for="(item,index) in refs" :key="item.id" class="reference-thumb" :class="{selected:index===selected,off:!item.on}" type="button" :aria-label="`${referenceName(kind)} · 图片 ${index+1}`" :aria-pressed="index===selected" :title="`${referenceName(kind)} · 图片 ${index+1}${kind==='vibe' && references.pending(item,view.form.model)?' · 待编码，生成时处理':''}`" @click="selected=index">
          <img v-if="thumbnail(item.assetId)" :src="thumbnail(item.assetId)" alt="" /><AppIcon v-else name="i-image" />
          <i v-if="kind==='vibe' && references.pending(item,view.form.model)" class="pending" aria-hidden="true"></i>
        </button>
        <button type="button" class="add-thumb" :disabled="working || refs.length>=16" aria-label="添加参考图片" title="添加图片" @click="upload?.click()"><AppIcon name="i-plus" /></button>
        <p v-if="!refs.length" class="reference-empty"><b>{{working?'正在读取图片…':'添加参考图片'}}</b><span>{{kind==='vibe'?'借用整体风格与氛围':'参考角色或画风'}}</span></p>
      </div>
      <div class="reference-image-actions">
        <button ref="more" type="button" class="ibtn" :popovertarget="id(`reference-more-${kind}`)" aria-label="更多参考操作" title="更多"><AppIcon name="i-more" /></button>
        <template v-if="current"><button type="button" class="ibtn image-enable" :aria-pressed="current.on" aria-label="此图参与参考" :title="current.on?'停用此图':'启用此图'" @click="edit({on:!current.on})"><AppIcon :name="current.on?'i-eye':'i-eye-off'" /></button><button type="button" class="ibtn" aria-label="移除当前参考" title="移除图片" @click="remove"><AppIcon name="i-trash" /></button></template>
      </div>
    </div>
    <div v-if="current" class="scrubs">
      <div v-if="kind==='precise'" class="fld"><div class="fld-top"><label :for="id('reference-type')">参考类型</label></div><select :id="id('reference-type')" :value="current.type" @change="edit({type:($event.target as HTMLSelectElement).value as NaiReference['type']})"><option value="character">角色</option><option value="style">风格</option><option value="character&style">角色＋风格</option></select></div>
      <label v-for="control in [{key:'strength' as const,label:'参考强度'},{key:kind==='vibe'?'information' as const:'fidelity' as const,label:kind==='vibe'?'信息提取量':'保真度'}]" :key="control.key" class="scrub scrub-sm" :style="{'--p':`${current[control.key]*100}%`}"><span>{{control.label}}</span><output>{{current[control.key]}}</output><input type="range" min="0" max="1" step=".05" :value="current[control.key]" :aria-label="control.label" :disabled="control.key==='information' && !references.original(current.assetId)" :title="control.key==='information' && !references.original(current.assetId)?'此文件仅包含编码，调整信息提取量需要原图':undefined" @input="slider(control.key,$event)" /></label>
    </div>
    <div :id="id(`reference-more-${kind}`)" ref="menu" popover="auto" class="menu reference-menu" role="menu" aria-label="参考操作" @beforetoggle="position" @keydown="menuKey">
      <button class="menu-item" type="button" role="menuitem" @click="close();importer?.click()"><AppIcon name="i-upload" />导入参考</button>
      <button class="menu-item" type="button" role="menuitem" :disabled="!refs.length" @click="exportGroup"><AppIcon name="i-download" />导出参考</button>
      <button v-if="kind==='vibe'" class="menu-item" type="button" role="menuitemcheckbox" :aria-checked="view.form.naiReferences.normalize" @click="drawing.editReferences({...settings(),normalize:!view.form.naiReferences.normalize});close()"><AppIcon name="i-parameters" />归一化强度<AppIcon class="menu-check" name="i-check" /></button>
      <hr /><button class="menu-item danger" type="button" role="menuitem" :disabled="!refs.length" @click="clear"><AppIcon name="i-trash" />清空本组</button>
    </div>
  </div>
</template>
<style scoped>
.bottom-reference-body { padding: 0 0 12px; }
.reference-filmstrip { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
.editor-thumbs { display: flex; align-items: center; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: thin; padding: 2px; gap: 8px; }
.reference-thumb, .add-thumb { display: grid; place-items: center; position: relative; width: 64px; height: 80px; flex: none; border-radius: var(--r2); overflow: hidden; background: var(--sunken); }
.reference-thumb > img { width: 100%; height: 100%; object-fit: cover; }
.reference-thumb.selected { outline: 1.5px solid var(--a); outline-offset: -1px; }
.reference-thumb.off { opacity: .4; }
.reference-thumb > .pending { position: absolute; width: 4px; height: 4px; right: 4px; top: 4px; border-radius: 50%; background: var(--fg-2); box-shadow: 0 0 0 2px var(--chrome); }
.add-thumb { border: 1px solid var(--line-2); background: none; color: var(--fg-3); }
.add-thumb:hover { background: var(--hover); color: var(--fg); }
.add-thumb:disabled { opacity: .4; }
.reference-image-actions { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; flex: none; width: 28px; }
.reference-image-actions > .ibtn { width: 28px; height: 24px; }
.reference-image-actions .ico { --ico: var(--ico-sm); }
.image-enable[aria-pressed="true"] { color: var(--fg-2); }
.image-enable[aria-pressed="false"] { color: var(--fg-3); }
.scrubs { gap: 8px; margin-top: 14px; }
/* The empty strip explains itself beside the add tile instead of adding a row below. */
.reference-empty { display: grid; gap: 3px; min-width: 0; margin: 0 0 0 6px; }
.reference-empty b { font-size: var(--fz-xs); font-weight: var(--fw-medium); color: var(--fg-2); }
.reference-empty span { font-size: var(--fz-2xs); color: var(--fg-3); }
.reference-menu { width: 188px; }
.scrub:has(input:disabled) { opacity: .45; }
</style>
