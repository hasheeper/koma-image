<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, shallowRef, ref, watch } from "vue";
import { useDrawing } from "../../app/drawing";
import { samplerName } from "../../domain/drawing";
import { naiCapabilities } from "../../domain/nai";
import { referenceName } from "../../domain/nai-references";
import type { ReferenceKind } from "../../domain/nai-references";
import AppIcon from "../../shared/AppIcon.vue";
import DrawingParameters from "./DrawingParameters.vue";
import NaiReferenceEditor from "./NaiReferenceEditor.vue";
const { drawing, view } = useDrawing();
const section = ref<"parameters" | ReferenceKind>("parameters"), open = ref(false), mounted = ref(false);
const shell = shallowRef<HTMLElement>(), content = shallowRef<HTMLElement>();
const supported = computed(() => view.value.referenceSupported);
const parameterPreview = computed(() => {
  const form = view.value.form, medium = naiCapabilities(form.model).medium;
  const sampler = samplerName(medium ? "k_euler_ancestral" : form.sampler);
  return { sampler, shortSampler: sampler.replace("Ancestral", "A"), steps: medium ? 14 : form.steps };
});
let animation: Animation | undefined, target = 0, observer: ResizeObserver | undefined, active = false;
let returnFocus: HTMLElement | undefined;
function animate(height: number) {
  const el = shell.value; if (!el || (target === height && !el.hidden)) return;
  const from = el.hidden ? 0 : el.getBoundingClientRect().height;
  animation?.cancel(); animation = undefined; target = height;
  el.hidden = false; el.style.height = `${height}px`;
  const finish = () => { if (!open.value && !target) el.hidden = true; };
  if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(from-height)<1) { finish(); return; }
  const next = el.animate([{height:`${from}px`},{height:`${height}px`}],{duration:height?260:210,easing:height?"cubic-bezier(.2,.75,.25,1)":"cubic-bezier(.4,0,.6,1)"});
  animation = next;
  void next.finished.then(()=>{ if (animation === next) { animation = undefined; finish(); } },()=>{});
}
function measure() {
  if (!active || !content.value || !shell.value) return;
  const footer = shell.value.closest(".composer-foot")!.getBoundingClientRect();
  const collapsedTop = footer.top + shell.value.getBoundingClientRect().height;
  content.value.style.maxHeight = `${Math.max(100,Math.min(460,innerHeight*.58,collapsedTop-72))}px`;
  animate(open.value ? content.value.getBoundingClientRect().height + 12 : 0);
}
async function toggle(next: typeof section.value, event: MouseEvent) {
  returnFocus = event.currentTarget as HTMLElement;
  if (section.value === next) open.value = !open.value;
  else { section.value = next; open.value = true; }
  mounted.value = true; await nextTick(); measure();
}
function close() {
  if (!open.value) return false;
  open.value = false; measure(); returnFocus?.focus({preventScroll:true}); return true;
}
function enable(kind: ReferenceKind) {
  const next = structuredClone(view.value.form.naiReferences); next.active = next.active === kind ? null : kind;
  void drawing.editReferences(next);
}
watch(supported, value => { if (!value && section.value !== "parameters") { section.value = "parameters"; open.value = false; } });
watch([open,section], async () => { await nextTick(); measure(); });
function pause() { active = false; observer?.disconnect(); observer = undefined; animation?.cancel(); animation=undefined; window.removeEventListener("resize",measure); window.visualViewport?.removeEventListener("resize",measure); }
onActivated(async()=>{ active=true; await nextTick(); observer=new ResizeObserver(measure); if(content.value)observer.observe(content.value); window.addEventListener("resize",measure); window.visualViewport?.addEventListener("resize",measure); measure(); });
watch(mounted, async()=>{ await nextTick(); if(active && content.value)observer?.observe(content.value); });
onDeactivated(pause); onBeforeUnmount(pause);
defineExpose({close, drawerHeight:()=>shell.value?.getBoundingClientRect().height ?? 0});
</script>
<template>
  <div class="drawing-bottom-panel">
    <div v-if="view.referenceProblem" class="reference-problem" role="status"><span>{{ view.referenceProblem }}</span><button type="button" @click="drawing.editReferences({...view.form.naiReferences,active:null})">停用参考</button></div>
    <nav class="bottom-controls" :class="{'is-single':!supported}" aria-label="底部面板导航">
      <button id="parametersToggle" type="button" class="bottom-tab" :class="{selected:open && section==='parameters'}" :aria-expanded="open && section==='parameters'" aria-controls="drawing-bottom-content" :title="supported ? '生成参数' : `生成参数 · ${parameterPreview.sampler} · ${parameterPreview.steps} 步`" @click="toggle('parameters',$event)">
        <AppIcon name="i-parameters" /><span>参数</span>
        <template v-if="!supported">
          <span class="parameter-preview"><span class="parameter-sampler">{{ parameterPreview.shortSampler }}</span><span class="parameter-steps"><b>{{ parameterPreview.steps }}</b> 步</span></span>
          <AppIcon name="i-chevron" class="single-chevron" />
        </template>
      </button>
      <template v-if="supported">
        <div v-for="kind in (['vibe','precise'] as const)" :key="kind" class="bottom-reference-segment" :class="{selected:open && section===kind}">
          <button type="button" class="bottom-tab" :aria-label="referenceName(kind)" :aria-expanded="open && section===kind" aria-controls="drawing-bottom-content" :title="`${referenceName(kind)} · ${view.form.naiReferences.active===kind?'已启用':'未启用'} · ${view.form.naiReferences[kind].length} 张图片`" @click="toggle(kind,$event)"><AppIcon :name="kind==='vibe'?'i-layers':'i-image'" /><span>{{ kind==='vibe'?'Vibe':'Precise' }}</span><i v-if="!open || section!==kind" class="reference-active" :class="{'is-enabled':view.form.naiReferences.active===kind}" aria-hidden="true"></i></button>
          <button v-if="open && section===kind" class="bottom-group-enable" type="button" role="switch" :aria-checked="view.form.naiReferences.active===kind" :aria-label="`启用 ${referenceName(kind)}`" :title="`${view.form.naiReferences.active===kind?'停用':'启用'} ${referenceName(kind)}`" @click="enable(kind)"><span aria-hidden="true"></span></button>
        </div>
      </template>
    </nav>
    <div ref="shell" class="drawer-shell" hidden :inert="!open" :aria-hidden="!open">
      <div v-if="mounted" id="drawing-bottom-content" ref="content" class="bottom-panel-content" role="region" :aria-label="section==='parameters'?'生成参数':referenceName(section)">
        <DrawingParameters v-if="section==='parameters'" />
        <NaiReferenceEditor v-else :key="section" :kind="section" />
      </div>
    </div>
  </div>
</template>
<style scoped>
.bottom-controls { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); align-items: stretch; gap: 2px; height: 40px; padding: 3px; margin: 0 0 8px; background: var(--sunken); border: 1px solid var(--line); border-radius: var(--r3); }
.bottom-reference-segment { display: flex; align-items: center; min-width: 0; height: 32px; border-radius: var(--r2); }
.bottom-reference-segment > .bottom-tab { flex: 1; gap: 5px; }
.bottom-reference-segment.selected { background: var(--raised); box-shadow: var(--sh-lip), 0 1px 2px #0004; }
.bottom-reference-segment.selected > .bottom-tab { color: var(--fg); }
.bottom-reference-segment.selected > .bottom-tab .ico { color: var(--a); }
.bottom-group-enable { display: grid; place-items: center; width: 24px; height: 32px; flex: none; border-radius: var(--r2); }
.bottom-group-enable:hover { background: var(--hover); }
.bottom-group-enable > span { position: relative; width: 20px; height: 12px; border-radius: 8px; background: var(--line-2); transition: background 120ms; }
.bottom-group-enable > span::after { content: ""; position: absolute; width: 8px; height: 8px; left: 2px; top: 2px; border-radius: 50%; background: var(--fg-3); transition: transform 120ms, background 120ms; }
.bottom-group-enable[aria-checked="true"] > span { background: var(--a); }
.bottom-group-enable[aria-checked="true"] > span::after { transform: translateX(8px); background: var(--chrome); }
.bottom-tab { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; height: 32px; font-size: var(--fz-sm); font-weight: var(--fw-semibold); line-height: 16px; color: var(--fg-3); white-space: nowrap; border-radius: var(--r2); transition: background 120ms, color 120ms; }
.bottom-tab:hover { color: var(--fg); }
.bottom-tab > .ico { --ico: var(--ico-sm); color: var(--fg-3); flex: none; }
.bottom-tab.selected { color: var(--fg); background: var(--raised); box-shadow: var(--sh-lip), 0 1px 2px #0004; }
.bottom-tab.selected .ico { color: var(--a); }
.reference-active { width: 4px; height: 4px; border-radius: 50%; background: var(--a); visibility: hidden; flex: none; margin-left: -2px; }
.reference-active.is-enabled { visibility: visible; }
.bottom-controls.is-single { display: block; height: 40px; padding: 0; border: 0; border-radius: 0; background: none; }
.is-single .bottom-tab { width: 100%; height: 40px; justify-content: flex-start; gap: 8px; padding: 0 12px; color: var(--fg-2); background: var(--sunken); border-radius: var(--r3); box-shadow: none; }
.is-single .bottom-tab:hover { background: var(--sunken-focus); color: var(--fg); }
.is-single .bottom-tab.selected { color: var(--fg); }
.is-single .bottom-tab > .ico { --ico: var(--ico-md); color: var(--a); }
.parameter-preview { display: flex; align-items: center; gap: 8px; min-width: 0; margin-left: auto; font-size: var(--fz-xs); font-weight: var(--fw-medium); color: var(--fg-3); }
.parameter-sampler { overflow: hidden; text-overflow: ellipsis; }
.parameter-steps { display: flex; align-items: center; gap: 4px; flex: none; }
.parameter-steps::before { content: ""; width: 2px; height: 2px; margin-right: 4px; border-radius: 50%; background: var(--fg-4); }
.parameter-steps b { font-family: var(--mono); font-weight: var(--fw-medium); color: var(--fg-2); }
.is-single .bottom-tab > .single-chevron { --ico: var(--ico-xs); margin-left: 4px; transform: rotate(90deg); color: var(--fg-3); transition: transform 160ms var(--e); }
.is-single .bottom-tab[aria-expanded="true"] > .single-chevron { transform: rotate(-90deg); }
.drawer-shell { display: block; height: 0; overflow: clip; }
.drawer-shell[hidden] { display: none; }
.bottom-panel-content { overflow: auto; scrollbar-width: thin; overscroll-behavior: contain; background: inherit; }
.reference-problem { display: flex; gap: 8px; align-items: center; font-size: var(--fz-2xs); color: var(--warn); padding-bottom: 8px; }
.reference-problem button { flex: none; color: var(--fg-2); text-decoration: underline; }
@media (prefers-reduced-motion: reduce) { .bottom-tab, .is-single .bottom-tab > .single-chevron, .bottom-group-enable > span, .bottom-group-enable > span::after { transition: none; } }
</style>
