<script setup lang="ts">
import { shallowRef, useId } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import type { FilePreview } from './draft/file-view.ts';
import { useAsk } from '../app/ask.ts';
const ask = useAsk();
function picture(source?: string) { void ask.libraryRevision.value; return source ? ask.pictureInfo(source) : null; }
defineProps<{ files: readonly FilePreview[]; issue?: string }>();
const id=useId(),open=shallowRef<string|null>(null);
</script>
<template>
  <section v-if="files.length" class="file-field" aria-label="文件变更">
    <header class="file-field-head"><AppIcon name="i-file" /><span>文件</span></header>
    <div class="file-lines">
      <div v-for="file in files" :key="file.id">
        <button class="file-row" :class="{'is-open':open===file.id}" type="button" :aria-expanded="open===file.id" :aria-controls="`${id}-${file.id}`" :aria-label="`${file.title} · 保存详情`" @click="open=open===file.id?null:file.id">
          <span class="file-sign"><AppIcon :name="!!file.source?'i-image':'i-download'" /></span><span class="file-title">{{file.title}}</span><span class="file-target">{{file.target}}</span><AppIcon class="file-chevron" name="i-chevron" />
        </button>
        <Transition name="file-details"><div v-if="open===file.id" :id="`${id}-${file.id}`" class="file-drawer"><div class="file-drawer-inner"><div class="file-detail">
          <p class="file-path">{{file.path}}</p>
          <div v-if="picture(file.source)?.url" class="file-image"><img :src="picture(file.source)?.url" alt="待交付成果" /></div>
          <dl><template v-for="detail in file.details" :key="detail.label"><dt>{{detail.label}}</dt><dd>{{detail.value}}</dd></template></dl>
          <p v-for="(paragraph,index) in file.text" :key="index" class="file-prose">{{paragraph}}</p>
          <ul v-if="file.related?.length" class="file-related"><li v-for="path in file.related" :key="path">{{path}}</li></ul>
        </div></div></div></Transition>
      </div>
      <p v-if="issue" class="file-issue" role="alert">{{issue}}</p>
    </div>
  </section>
</template>
<style scoped>
.file-field{margin-top:12px}.file-field:first-child{margin-top:0}
.file-field-head{display:flex;align-items:center;gap:calc(var(--draft-b) - var(--draft-a) - 14px);height:30px;padding:0 var(--draft-r) 0 var(--draft-a);color:var(--fg);font-size:13px;font-weight:var(--fw-medium)}
.file-field-head>.ico{flex:none;--ico:var(--ico-sm);color:var(--fg-2)}
.file-lines{display:grid;gap:0;margin-top:2px;padding:0 var(--draft-r) 0 calc(var(--draft-b) - 6px)}
.file-row{position:relative;display:flex;align-items:center;width:100%;min-width:0;min-height:30px;padding-right:8px;border-radius:6px;text-align:left;color:var(--draft-content);font-size:13px}
.file-row:is(:hover,:focus-visible),.file-row.is-open{background:var(--ask-hover,var(--hover))}.file-row:focus{outline:none}.file-row:focus-visible::before{content:'';position:absolute;left:4px;top:50%;width:2px;height:14px;transform:translateY(-50%);border-radius:1px;background:var(--a)}
.file-sign{display:flex;align-items:center;justify-content:center;align-self:stretch;flex:none;width:calc(var(--draft-b) - var(--draft-a) + 6px);padding:0 8px 0 6px;color:var(--fg-3)}.file-sign>.ico{--ico:var(--ico-xs)}
.file-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-target{flex:none;margin-left:8px;color:var(--fg-3);font-size:11px}.file-chevron{flex:none;margin-left:6px;--ico:var(--ico-xs);color:var(--fg-3);opacity:.6;transition:transform var(--t1) var(--e)}[aria-expanded=true]>.file-chevron{transform:rotate(90deg)}
.file-drawer{display:grid;grid-template-rows:1fr;overflow:hidden}.file-drawer-inner{min-height:0;overflow:hidden}.file-detail{max-height:180px;overflow:auto;overscroll-behavior:contain;padding:8px 8px 10px calc(var(--draft-b) - 6px);color:var(--fg-2);font-size:12px;line-height:1.65;overflow-wrap:anywhere}
.file-path{margin:0 0 8px;color:var(--fg-3);font:11px/1.6 var(--mono);overflow-wrap:anywhere}.file-detail dl{display:grid;grid-template-columns:42px minmax(0,1fr);gap:4px 8px;margin:0}.file-detail dt{color:var(--fg-3);font-size:11px}.file-detail dd{margin:0;min-width:0;white-space:pre-wrap}.file-prose{margin:6px 0 0;white-space:pre-wrap}.file-image>img{width:84px;height:58px;object-fit:cover;display:block;border-radius:6px;margin-bottom:8px}.file-related{display:grid;gap:3px;margin:8px 0 0;padding:0;list-style:none;color:var(--fg-3);font:11px/1.6 var(--mono)}.file-issue{padding:4px 8px 4px calc(var(--draft-b) - 6px);color:var(--warn);font-size:12px;line-height:1.5}
.file-details-enter-active,.file-details-leave-active{transition:grid-template-rows var(--t2) var(--e)}.file-details-enter-from,.file-details-leave-to{grid-template-rows:0fr}
@media(prefers-reduced-motion:reduce){.file-details-enter-active,.file-details-leave-active,.file-chevron{transition:none}}
</style>
