<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import { canonical } from './canonical.ts';
import { statusNames } from '../slate/model.ts';
import type { SlateChange, Todo, TodoStatus } from '../slate/model.ts';
import type { CheckedStep } from './draft/types.ts';
import type { BoardForm } from '../domain/drawing.ts';


const props=defineProps<{change?:SlateChange;step:CheckedStep;imageUrl?:string;initiallyOpen?:boolean}>();
const id=useId(),showAll=shallowRef(false),openRow=shallowRef<string|null>(null);
const recipeOpen=shallowRef(false);
interface Detail {key:string;label:string;before:string;after:string;image?:boolean}
interface Row {id:string;title:string;kind:'add'|'del'|'mod';details:Detail[];status?:{before:TodoStatus;after:TodoStatus}}
const different=(a:unknown,b:unknown)=>canonical(a??null)!==canonical(b??null);
const labels:Partial<Record<keyof Todo,string>>={title:'标题',description:'说明',requirements:'要求',mutation:'更改记录',status:'状态',binding:'成果',image_required:'需交图',bonus:'追加任务'};
function text(key:string,value:unknown):string {
  if(value===null||value===undefined||value==='')return '';
  if(key==='status')return statusNames[value as TodoStatus]??String(value);
  if(typeof value==='boolean')return value?'是':'否';
  if(key==='binding'){
    const b=value as NonNullable<Todo['binding']>;
    return props.change?.bindings.find(v=>v.assetId===b.assetId)?.label??b.target_path;
  }
  return typeof value==='object'?canonical(value):String(value);
}
const rows=computed<Row[]>(()=>{
  const before=props.change?.before,after=props.change?.after,out:Row[]=[];
  if(!before&&after)out.push({id:'slate-created',title:`新建「${after.title}」`,kind:'add',details:[]});
  else if(before&&!after)out.push({id:'slate-deleted',title:`删除「${before.title}」`,kind:'del',details:[]});
  else if(before&&after&&before.title!==after.title)out.push({id:'slate-title',title:after.title,kind:'mod',details:[{key:'title',label:'清单名称',before:before.title,after:after.title}]});
  const old=new Map(before?.todos.map(t=>[t.id,t])??[]),next=new Map(after?.todos.map(t=>[t.id,t])??[]);
  const ids=new Set([...old.keys(),...next.keys()]);
  for(const todoId of ids){
    const a=old.get(todoId),b=next.get(todoId);
    if(a&&b&&!different(a,b))continue;
    const kind=!a?'add':!b?'del':'mod',details:Detail[]=[];
    for(const key of Object.keys(labels) as (keyof Todo)[]){
      if(key==='title'&&(!a||!b))continue;
      if(!different(a?.[key],b?.[key]))continue;
      if(!a&&key!=='image_required'&&!b?.[key])continue;
      details.push({key,label:labels[key]!,before:text(key,a?.[key]),after:text(key,b?.[key]),image:key==='binding'});
    }
    out.push({id:todoId,title:b?.title??a!.title,kind,details,...(a&&b&&a.status!==b.status?{status:{before:a.status,after:b.status}}:{})});
  }
  return out;
});
const visibleRows=computed(()=>showAll.value?rows.value:rows.value.slice(0,3));
const activeRow=computed(()=>openRow.value??(props.initiallyOpen?rows.value.find(row=>row.details.length)?.id:null));
function toggleRow(row:Row){openRow.value=activeRow.value===row.id?'':row.id;recipeOpen.value=false;}
function hint(row:Row){return row.status?'':row.kind==='mod'?row.details[0]?.label??'':'';}
const recipeChanged=computed(()=>different(props.change?.before?.golden_recipe,props.change?.after?.golden_recipe));
const recipeLabels:Record<string,string>={model:'模型',prompt:'Prompt',negative:'Negative',width:'宽',height:'高',steps:'步数',scale:'Guidance',cfgRescale:'Guidance Rescale',seed:'Seed',sampler:'采样器',naiMode:'模式',complexity:'Complexity',qualityPreset:'质量预设',negativePreset:'负向预设',transparentBg:'透明底',characters:'角色',placement:'角色位置',naiReferences:'参考'};
const recipeRows=computed<Detail[]>(()=>{
  if(!recipeChanged.value)return [];
  const before=props.change?.before?.golden_recipe,after=props.change?.after?.golden_recipe,out:Detail[]=[];
  if(before?.locked!==after?.locked)out.push({key:'locked',label:'锁定',before:before?(before.locked?'已锁定':'可修改'):'',after:after?(after.locked?'已锁定':'可修改'):'已移除'});
  if(props.step.label.includes('解锁配方'))out.push({key:'unlock',label:'写入方式',before:'',after:after?.locked?'解锁后重新锁定':'解锁配方'});
  for(const key of new Set([...Object.keys(before?.form??{}),...Object.keys(after?.form??{})])){
    const a=before?.form[key as keyof BoardForm],b=after?.form[key as keyof BoardForm];
    if(different(a,b))out.push({key,label:recipeLabels[key]??key,before:text(key,a),after:text(key,b)});
  }
  if(props.change?.directoryRequired)out.push({key:'directory',label:'交付',before:'',after:'要求目录交付'});
  return out;
});
const recipeSummary=computed(()=>{
  const first=recipeRows.value[0];
  if(!props.change?.before?.golden_recipe)return '保存当前配方';
  if(!props.change?.after?.golden_recipe)return '移除配方';
  if(first?.key==='locked')return `${first.before} → ${first.after}`;
  if(first?.key==='unlock')return first.after;
  return first?`${first.label} 已修改`:'更新配方';
});
</script>
<template>
  <section v-if="rows.length||step.issue" class="slate-field" aria-label="任务变更">
    <header class="slate-field-head"><AppIcon name="i-tasks" /><span>任务</span></header>
    <div class="slate-lines">
      <div v-for="row in visibleRows" :key="row.id" class="slate-change">
        <button class="slate-row" :class="[row.kind,{'is-open':activeRow===row.id}]" type="button" :disabled="!row.details.length" :aria-expanded="row.details.length?activeRow===row.id:undefined" :aria-controls="row.details.length?`${id}-${row.id}`:undefined" :aria-label="`${row.title} · ${row.kind==='add'?'新增':row.kind==='del'?'删除':'修改'}详情`" @click="toggleRow(row)">
          <span class="slate-sign" aria-hidden="true"><AppIcon v-if="row.kind==='mod'" name="i-rename" /><span v-else class="diff-symbol">{{row.kind==='add'?'+':'−'}}</span></span><span class="slate-row-title" :title="row.title">{{row.title}}</span>
          <span v-if="row.status" class="slate-status-change" :title="`${statusNames[row.status.before]} → ${statusNames[row.status.after]}`"><i class="status-dot" :class="row.status.before"></i><span>→</span><i class="status-dot" :class="row.status.after"></i></span>
          <span v-else-if="hint(row)" class="slate-row-hint">{{hint(row)}}</span>
          <AppIcon v-if="row.details.length" class="slate-row-chevron" name="i-chevron" />
        </button>
        <Transition name="slate-details"><div v-if="activeRow===row.id&&row.details.length" :id="`${id}-${row.id}`" class="slate-details-drawer"><div class="slate-details-inner"><dl class="slate-details">
          <template v-for="detail in row.details" :key="detail.key"><dt>{{detail.label}}</dt><dd><del v-if="detail.before&&detail.before!==detail.after">{{detail.before}}</del><span v-if="detail.after" class="detail-after"><img v-if="detail.image&&imageUrl" :src="imageUrl" alt="待绑定的合成成果图" />{{detail.after}}</span><span v-else class="detail-empty">移除</span></dd></template>
        </dl></div></div></Transition>
      </div>
      <button v-if="rows.length>3" type="button" class="slate-more" :aria-expanded="showAll" @click="showAll=!showAll">{{showAll?'收起':`其余 ${rows.length-3} 项`}}</button>
      <p v-if="step.issue" class="slate-issue">{{step.issue}}</p>
    </div>
  </section>
  <section v-if="recipeChanged" class="slate-field recipe-field" aria-label="配方变更">
    <header class="slate-field-head"><AppIcon name="i-parameters" /><span>配方</span></header>
    <div class="slate-lines"><button class="slate-row mod recipe-toggle" type="button" :aria-expanded="recipeOpen" :aria-controls="`${id}-recipe`" aria-label="配方修改详情" @click="recipeOpen=!recipeOpen;openRow=''">
      <span class="slate-sign" aria-hidden="true"><AppIcon name="i-rename" /></span><span class="slate-row-title">{{recipeSummary}}</span><AppIcon class="slate-row-chevron" name="i-chevron" />
    </button><Transition name="slate-details"><div v-if="recipeOpen" :id="`${id}-recipe`" class="slate-details-drawer"><div class="slate-details-inner"><div class="recipe-values">
      <div v-for="detail in recipeRows" :key="detail.key" class="recipe-value"><span class="recipe-key">{{detail.label}}</span>
        <details v-if="detail.before.length+detail.after.length>160" class="recipe-long"><summary :aria-label="`查看完整 ${detail.label}`"><span>{{detail.after||detail.before}}</span><AppIcon name="i-chevron" /></summary><p><del v-if="detail.before">{{detail.before}}</del><span v-if="detail.after">{{detail.after}}</span></p></details>
        <span v-else class="recipe-short"><del v-if="detail.before&&detail.before!==detail.after">{{detail.before}}</del><span v-if="detail.after">{{detail.after}}</span></span>
      </div>
    </div></div></div></Transition></div>
  </section>
</template>
<style scoped>
.slate-field{margin-bottom:12px}
.slate-field-head{display:flex;align-items:center;gap:calc(var(--draft-b) - var(--draft-a) - 14px);height:30px;padding:0 var(--draft-r) 0 var(--draft-a);color:var(--fg);font-size:13px;font-weight:var(--fw-medium)}
.slate-field-head>.ico{flex:none;--ico:var(--ico-sm);color:var(--fg-2)}
.slate-lines{display:grid;gap:0;margin-top:2px;padding:0 var(--draft-r) 0 calc(var(--draft-b) - 6px)}
.slate-row{position:relative;display:flex;align-items:center;gap:0;min-width:0;width:100%;min-height:30px;padding-right:8px;border-radius:6px;text-align:left;color:var(--draft-content);font-size:13px}
.slate-row:disabled{opacity:1;cursor:default}.slate-row.add,.slate-row.del{background:transparent}.slate-row.del .slate-row-title{text-decoration:line-through;text-decoration-color:var(--err)}
.slate-row:is(:hover,:focus-visible):not(:disabled){background:var(--ask-layer,var(--hover))}.slate-row.is-open{background:var(--ask-hover,var(--hover))}.slate-row:focus{outline:none}.slate-row:focus-visible::before{content:"";position:absolute;left:4px;top:50%;width:2px;height:14px;transform:translateY(-50%);border-radius:1px;background:var(--a)}
.slate-sign{display:flex;align-items:center;justify-content:center;align-self:stretch;flex:none;width:calc(var(--draft-b) - var(--draft-a) + 6px);padding:0 8px 0 6px;color:var(--fg-3)}.slate-sign>.ico{flex:none;--ico:var(--ico-xs)}.diff-symbol{display:grid;place-items:center;flex:none;width:14px;height:14px;font:var(--fw-medium) 11px/14px var(--mono)}.add .slate-sign{color:var(--ok)}.del .slate-sign{color:var(--err)}
.slate-row-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.slate-row-hint{flex:none;max-width:84px;margin-left:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--fg-3)}
.slate-row-chevron{flex:none;margin-left:6px;--ico:var(--ico-xs);color:var(--fg-3);opacity:.6;transition:transform var(--t1) var(--e),opacity var(--t1) var(--e)}.slate-row:is(:hover,:focus-visible,.is-open)>.slate-row-chevron{opacity:1}[aria-expanded=true]>.slate-row-chevron{transform:rotate(90deg)}
.slate-status-change{display:flex;flex:none;align-items:center;gap:4px;margin-left:8px;color:var(--fg-3);font-size:10px}.status-dot{display:block;width:9px;height:9px;border:1px solid var(--fg-3);border-radius:50%}.status-dot.in_progress{border-color:var(--a);box-shadow:inset 0 0 0 2px var(--raised);background:var(--a)}.status-dot.done{background:var(--fg-3)}.status-dot.abandoned{opacity:.5}
.slate-details-drawer{display:grid;grid-template-rows:1fr;overflow:hidden}.slate-details-inner{min-height:0;overflow:hidden}.slate-details{display:grid;grid-template-columns:52px minmax(0,1fr);gap:7px 8px;max-height:170px;margin:0;padding:8px 8px 8px calc(var(--draft-b) - 6px);overflow:auto;overscroll-behavior:contain;font-size:12px;line-height:1.6}
.slate-details dt{color:var(--fg-3);font-size:11px}.slate-details dd{display:grid;gap:3px;min-width:0;margin:0;overflow-wrap:anywhere;white-space:pre-wrap;color:var(--fg-2)}.slate-details del,.recipe-values del{color:var(--fg-3);text-decoration-color:var(--err);white-space:pre-wrap;overflow-wrap:anywhere}.detail-after{display:flex;align-items:center;gap:7px;min-width:0}.detail-after>img{flex:none;width:32px;height:32px;object-fit:cover;border-radius:5px}.detail-empty{color:var(--fg-3)}
.slate-more{min-height:26px;padding-left:calc(var(--draft-b) - 6px);text-align:left;color:var(--fg-3);font-size:11px}.slate-more:hover{color:var(--fg)}.slate-issue{padding:4px 8px 4px calc(var(--draft-b) - 6px);color:var(--warn);font-size:12px;line-height:1.5}
.recipe-values{display:grid;gap:6px;max-height:160px;padding:6px 8px 8px calc(var(--draft-b) - 6px);overflow:auto;overscroll-behavior:contain}.recipe-value{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:start;gap:8px;min-height:26px;font-size:12px;line-height:1.6}.recipe-key{color:var(--fg-3);font-size:11px}.recipe-short{display:flex;flex-wrap:wrap;gap:0 6px;color:var(--fg-2);overflow-wrap:anywhere}.recipe-long{min-width:0;color:var(--fg-2)}.recipe-long>summary{display:flex;align-items:center;gap:4px;min-width:0;cursor:pointer;list-style:none}.recipe-long>summary::-webkit-details-marker{display:none}.recipe-long>summary>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recipe-long>summary>.ico{--ico:var(--ico-xs);flex:none;color:var(--fg-3)}.recipe-long[open]>summary>.ico{transform:rotate(90deg)}.recipe-long>p{display:grid;gap:6px;margin:6px 0 0;font-size:12px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.slate-details-enter-active,.slate-details-leave-active{transition:grid-template-rows var(--t2) var(--e)}.slate-details-enter-from,.slate-details-leave-to{grid-template-rows:0fr}
@media(prefers-reduced-motion:reduce){.slate-details-enter-active,.slate-details-leave-active,.slate-row-chevron{transition:none}}
</style>
