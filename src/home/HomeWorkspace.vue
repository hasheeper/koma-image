<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import HomeHead from './HomeHead.vue';
import HomeEmpty from './HomeEmpty.vue';
import HomeImage from './HomeImage.vue';
import AppIcon from '../shared/AppIcon.vue';
import RepoLink from '../shared/RepoLink.vue';
import { draftView } from '../ask/draft/view.ts';
import { enterWithPicture } from './transition.ts';
import { useAskPresentation } from '../ask/presentation.ts';
import { useEditor } from '../app/editor.ts';
import { dragHomePicture as dragPicture } from './transfer.ts';
import { useHome } from '../app/home.ts';
import { useDrawing } from '../app/drawing.ts';
import { useChat } from '../app/chat.ts';
import { useSlates } from '../app/slate.ts';
import { useAsk } from '../app/ask.ts';
import { useUi, message } from '../app/ui.ts';
import { useWorkspaceLifecycle } from '../app/workspace-lifecycle.ts';
import { useHomeNavigation } from './navigation.ts';
import { resolvedLayout, finalLayouts } from './model.ts';
import { layoutPrints } from './layout.ts';
import { pictureUrl, activityTime } from './pictures.ts';
import type { HomeLine, HomePicture } from './derive.ts';
const { home, view } = useHome(), { drawing } = useDrawing(), { chat } = useChat(), slates = useSlates(), ask = useAsk(), ui = useUi(), navigation = useHomeNavigation();
const presentation = useAskPresentation(), { dock, reserve } = presentation, { editor } = useEditor();
const empty = computed(() => view.value.loaded && view.value.firstUse);
const welcome = computed(() => empty.value && dock.value === 'off');
const dropping = shallowRef(false);
let dragDepth = 0;
function clearDrop() { dragDepth = 0; dropping.value = false; }
function drag(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  if (event.type === 'dragleave') { if (--dragDepth <= 0) clearDrop(); return; }
  event.preventDefault();
  if (event.type === 'dragenter') dragDepth++;
  dropping.value = true;
  event.dataTransfer.dropEffect = 'copy';
}
async function openPicture(file: File) {
  try { await editor.open('edit', file, file.name); } catch (e) { ui.toast(message(e), 'err'); }
}
async function drop(event: DragEvent) {
  clearDrop();
  const data = event.dataTransfer; if (!data?.files.length) return;
  const file = [...data.files].find(f => /^image\/(png|jpeg|webp)$/.test(f.type));
  if (!file) return; event.preventDefault();
  await openPicture(file);
}
function paste(event: ClipboardEvent) {
  if (!welcome.value || event.defaultPrevented || document.querySelector('dialog[open], :popover-open')) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .home-ask')) return;
  const file = [...(event.clipboardData?.files ?? [])].find(f => /^image\/(png|jpeg|webp)$/.test(f.type));
  if (file) { event.preventDefault(); void openPicture(file); }
}
const root = shallowRef<HTMLElement | null>(null), strip = shallowRef<HTMLElement | null>(null);
const width = shallowRef(0), viewport = shallowRef({ width: innerWidth, height: innerHeight }), selected = shallowRef<string | null>(null);
const lifecycle = useWorkspaceLifecycle('home', [strip]);
lifecycle.whileActive(signal => {
  const measure = () => {
    if (root.value) width.value = root.value.clientWidth;
    viewport.value = { width: innerWidth, height: innerHeight };
  };
  const stopMeasure = presentation.measureWith(measure);
  const observer = new ResizeObserver(measure); if (root.value) observer.observe(root.value);
  window.addEventListener('dragend', clearDrop, { signal });
  window.addEventListener('paste', paste, { signal });
  window.addEventListener('resize', measure, { signal }); measure();
  signal.addEventListener('abort', () => { observer.disconnect(); stopMeasure(); selected.value = null; clearDrop(); }, { once: true });
});
const mode = computed(() => resolvedLayout(view.value.preferences.layout, viewport.value.width));
const arrangement = computed(() => layoutPrints(view.value.finals.map(f => f.size), width.value, mode.value, viewport.value.width <= 860));
const layoutNames = { rows: '行对齐', cols: '列对齐', mosaic: '拼图' };
const lead = computed(() => view.value.current);
const leadDraft = computed(() => {
  const plan = ask.draftPlan.value;
  return plan && (plan.workspace === 'image' ? plan.boardId === lead.value?.sourceId : plan.conversationId === lead.value?.sourceId)
    && (plan.changes.length || plan.newBoardName) ? { plan, diff: draftView(plan) } : null;
});
const ratio = (picture: HomePicture | null) => picture ? picture.width / picture.height : .684;
const height = computed(() => Math.min(370, Math.max(330, viewport.value.height - 530)));
const stacked = computed(() => !!lead.value && ratio(lead.value.face) * (height.value - 2) + 394 > width.value);
const leadHeight = computed(() => stacked.value ? Math.min(Math.min(320, Math.max(220, viewport.value.height - 520)), Math.floor((width.value - 2) / ratio(lead.value?.face ?? null))) : height.value - 2);
// Without a picture the stacked lead keeps a short watermark panel instead of an empty portrait.
const faceSize = computed(() => stacked.value && !lead.value?.face ? { width: '100%', height: '160px' }
  : { width: `${leadHeight.value * ratio(lead.value?.face ?? null)}px`, height: `${leadHeight.value}px` });
const thumbHeight = computed(() => Math.min(124, Math.max(84, height.value - 244)));
const others = computed(() => view.value.lines.filter(l => l !== lead.value && l.id !== lead.value?.id));
// With no other cards beside it, the lead's text column may take the rest of the row for recent pictures.
const bodyMax = computed(() => others.value.length || stacked.value ? 400 : Math.max(400, Math.floor(width.value - 3 - leadHeight.value * ratio(lead.value?.face ?? null))));
const recent = computed(() => {
  let used = 0;
  return (lead.value?.recent ?? []).filter(p => { used += ratio(p) * thumbHeight.value + (used ? 8 : 0); return used <= bodyMax.value - 40; });
});
const alone = computed(() => !others.value.length && !view.value.finals.length);
const activeSlate = computed(() => slates.list.value.find(s => s.id === slates.activeId.value));
const completed = computed(() => activeSlate.value?.todos.filter(t => t.status === 'done').length ?? 0);
const continueLabel = computed(() => view.value.preferences.lastLocation?.workspace === 'tags' ? '继续查词' : lead.value?.workspace === 'edit' ? '继续编辑' : lead.value?.workspace === 'chat' ? '继续对话' : '继续绘图');
const source = (p: HomePicture) => pictureUrl(p, { home, drawing, chat });
const label = (id: string) => { void ask.libraryRevision.value; return ask.favoriteLabelFor(id) ?? ''; };
const meta = (line: HomeLine) => [line.count !== null ? `${line.count} ${line.workspace === 'chat' ? '轮' : '张'}` : '', activityTime(line.updatedAt)].filter(Boolean).join(' · ');
async function enter(line: HomeLine, p?: HomePicture, event?: MouseEvent) { try { await enterWithPicture(event?.currentTarget instanceof HTMLElement && (p ?? line.face)?.kind !== 'preview' ? event.currentTarget.querySelector('img') : null, () => navigation.enter(line, p)); } catch (e) { ui.toast(message(e), 'err'); } }
async function resume(event?: MouseEvent) { try { await enterWithPicture(event?.currentTarget instanceof HTMLElement && lead.value?.face?.kind !== 'preview' ? event.currentTarget.querySelector('img') : null, () => navigation.resume()); } catch (e) { ui.toast(message(e), 'err'); } }
watch(() => view.value.finals, finals => { if (selected.value && !finals.some(f => f.recordId === selected.value)) selected.value = null; });
watch(dock, clearDrop);
</script>
<template>
  <div class="home-shell" :class="{ 'is-empty': welcome }" :data-ask="dock" :inert="dock === 'full'" :style="{ paddingRight: `${reserve}px`, '--home-reserve': `${reserve}px` }" @dragenter="drag" @dragover="drag" @dragleave="drag" @drop="drop">
  <main ref="root" class="home-page" :class="{ 'is-empty': welcome }" data-workspace-root="home" tabindex="-1">
    <HomeHead :empty="welcome" />
    <HomeEmpty v-if="welcome" :dropping="dropping" />
    <section v-if="lead" class="home-section" :class="{ 'is-single': alone }" aria-label="进行中">
      <div class="home-section-head"><h2>进行中 <span class="home-count">{{ view.lines.length }}</span></h2>
        <button v-if="activeSlate" type="button" class="home-slate" @click="slates.visible.value = true"><span>{{ activeSlate.title }}</span><i class="home-bars" aria-hidden="true"><i v-for="todo in activeSlate.todos.slice(0, 12)" :key="todo.id" :data-done="todo.status === 'done' || undefined" :data-now="todo.status === 'in_progress' || undefined"></i></i><small>{{ completed }}/{{ activeSlate.todos.length }}</small></button>
      </div>
      <div ref="strip" class="home-progress" :class="{ stacked, solo: !others.length }" :style="{ '--lead-h': `${height}px`, '--body-max': `${bodyMax}px` }">
        <article class="home-lead">
          <button class="home-face" :class="{ 'text-face': !lead.face }" type="button" :style="faceSize" :aria-label="`${continueLabel} · ${lead.title}`" @click="resume">
            <img v-if="lead.face" :draggable="lead.face.kind !== 'preview'" @dragstart="dragPicture($event, lead.face)" :src="source(lead.face)" :alt="lead.title" />
            <AppIcon v-else :name="`mk-${lead.workspace}`" />
          </button>
          <div class="home-lead-body" :class="{ 'is-short': !recent.length }">
            <div class="home-lead-title">
              <p v-if="lead.delivery" class="home-todo" :title="lead.delivery.title"><AppIcon name="i-tasks" /><span>{{ lead.delivery.title }}</span></p>
              <h3>{{ lead.title }}</h3>
              <div class="home-facts"><span v-if="meta(lead)">{{ meta(lead) }}</span><span v-if="lead.status && !leadDraft && !/^第 \d+ 轮$/.test(lead.status)" class="home-status"><i></i>{{ lead.status }}</span></div>
            </div>
            <div v-if="recent.length" class="home-recent"><button v-for="(p, index) in recent" :key="index" type="button" :aria-label="`查看最近图片 ${index + 1}`" :style="{ width: `${ratio(p) * thumbHeight}px`, height: `${thumbHeight}px` }" @click="enter(lead, p, $event)"><img :draggable="p.kind !== 'preview'" @dragstart="dragPicture($event, p)" :src="source(p)" alt="" /></button></div>
            <div class="home-lead-foot"><button v-if="leadDraft" class="home-draft" type="button" @click="ask.show()"><i></i><b>草稿待确认</b><span>{{ leadDraft.plan.title }}</span><small>+{{ leadDraft.diff.added }} −{{ leadDraft.diff.removed }}</small></button><button class="btn btn-primary home-continue" type="button" @click="resume">{{ continueLabel }}<kbd><AppIcon name="i-enter" /></kbd></button></div>
          </div>
        </article>
        <div v-if="others.length" class="home-other-lines">
          <button v-for="line in others" :key="line.id" class="home-line" type="button" :style="{ width: `${ratio(line.face) * (stacked ? 174 : height - 66) + 2}px` }" :aria-label="`打开${line.workspace === 'chat' ? '对话' : '画板'} · ${line.title}`" @click="enter(line, undefined, $event)">
            <img v-if="line.face" :draggable="line.face.kind !== 'preview'" @dragstart="dragPicture($event, line.face)" :src="source(line.face)" :alt="line.title" :style="{ height: `${stacked ? 174 : height - 66}px` }" />
            <span class="home-line-caption"><b>{{ line.title }}</b><small>{{ line.status || meta(line) }}</small></span>
          </button>
        </div>
      </div>
    </section>
    <section v-if="view.finals.length" class="home-section" aria-label="定稿">
      <div class="home-section-head"><h2>定稿 <span class="home-count">{{ view.finals.length }}</span></h2><div class="seg home-layout" aria-label="定稿排列"><button v-for="layout in finalLayouts" :key="layout" type="button" :aria-pressed="mode === layout" @click="home.store.setLayout(layout).catch(e => ui.toast(message(e), 'err'))">{{ layoutNames[layout] }}</button></div></div>
      <div class="home-finals" :data-layout="mode" :style="{ height: `${arrangement.height}px` }">
        <button v-for="tile in arrangement.tiles" :key="view.finals[tile.index]!.recordId" class="home-print" type="button" :aria-label="`查看定稿 ${label(view.finals[tile.index]!.recordId)}`" :style="{ left: `${tile.x}px`, top: `${tile.y}px`, width: `${tile.w}px`, height: `${tile.h}px` }" @click="selected = view.finals[tile.index]!.recordId">
          <img draggable="true" @dragstart="dragPicture($event, { kind: 'favorite', recordId: view.finals[tile.index]!.recordId, ...view.finals[tile.index]!.size })" :src="source({ kind: 'favorite', recordId: view.finals[tile.index]!.recordId, ...view.finals[tile.index]!.size })" alt="" loading="lazy" />
          <span class="home-print-caption"><b>{{ label(view.finals[tile.index]!.recordId) }} <AppIcon v-if="view.finals[tile.index]!.source.includes('→')" name="i-edit" /></b><span>{{ view.finals[tile.index]!.source }}</span><small v-if="view.finals[tile.index]!.deliveries.length">{{ view.finals[tile.index]!.deliveries.map(d => d.title).join(' · ') }}</small></span>
        </button>
      </div>
    </section>
    <footer class="home-footer"><RepoLink><AppIcon name="i-github" />hasheeper/koma-image</RepoLink></footer>
    <HomeImage v-if="selected" :record-id="selected" @close="selected = null" />
  </main>
  </div>
</template>
<style scoped>
.home-shell { position: relative; isolation: isolate; min-height: 100dvh; overflow: clip; background: var(--page-bg); }
.home-shell::before, .home-shell::after { z-index: -1; content: ''; pointer-events: none; }
/* With pictures the light falls from the top centre of the content column and scrolls away with the first screen; the empty page lights its question instead (HomeHead). */
.home-shell::before { position: absolute; top: 0; right: var(--home-reserve, 0); left: 0; height: min(1040px, 115vh); background: radial-gradient(ellipse 62% 78% at 50% -6%, color-mix(in srgb, var(--ambient-ink) 9.4%, transparent), color-mix(in srgb, var(--ambient-ink) 5.5%, transparent) 20%, color-mix(in srgb, var(--ambient-ink) 2.9%, transparent) 40%, color-mix(in srgb, var(--ambient-ink) 1%, transparent) 66%, transparent 90%); transition: opacity var(--t3) var(--e); }
.home-shell.is-empty::before { opacity: 0; }
.home-shell::after { position: fixed; inset: 0; opacity: .03; background: url('./grain.svg') repeat; background-size: 160px 160px; }
.home-page.is-empty { position: relative; display: grid; grid-template-rows: minmax(48px, 2fr) auto 32px auto minmax(48px, 3fr); padding: 32px 0 36px; }
.home-shell[data-ask="full"] { visibility: hidden; transition: visibility 0s .52s; }
.home-page { width: min(84%, 1080px); min-height: 100dvh; margin: 0 auto; padding: var(--sp-6) 0 72px; outline: none; }
.home-section + .home-section { margin-top: var(--sp-6); }
/* One quiet line closing the page: the source repository. The empty page pins it to the bottom of its grid. */
.home-footer { display: flex; justify-content: center; margin-top: 64px; }
.home-footer a { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-3); font-size: var(--fz-xs); text-decoration: none; transition: color var(--t1) var(--e); }
.home-footer a:hover { color: var(--fg); }
.home-footer .ico { --ico: var(--ico-sm); }
.home-page.is-empty .home-footer { grid-row: 5; align-self: end; margin-top: 0; }
.home-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.home-section-head h2 { display: inline-flex; flex: none; align-items: center; gap: 10px; margin: 0; font-size: 18px; font-weight: var(--fw-semibold); line-height: 32px; }
.home-count { display: inline-flex; align-items: center; justify-content: center; height: 22px; min-width: 22px; padding: 0 7px; color: var(--fg-2); margin-top: 2px; font: var(--fw-medium) var(--fz-xs)/1 var(--mono); background: var(--raised); border-radius: 11px; }
.home-slate { display: inline-flex; align-items: center; gap: 10px; max-width: 65%; height: 30px; padding: 0 12px; color: var(--fg-3); font-size: var(--fz-xs); background: color-mix(in srgb, var(--chrome) 78%, transparent); border: 1px solid var(--line); border-radius: 15px; }
.home-slate > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-bars { display: inline-flex; flex: none; gap: 3px; }
.home-bars i { width: 12px; height: 3px; border-radius: 2px; background: var(--line-2); }
.home-bars i[data-done] { background: var(--fg-3); }
.home-bars i[data-now] { background: var(--a); }
.home-slate small { font: 11px/1 var(--mono); }
.home-slate .ico { flex: none; --ico: var(--ico-sm); }
.home-progress { display: flex; gap: 16px; margin: -6px -6px 0; padding: 6px 6px 4px; overflow-x: auto; scrollbar-width: none; scroll-padding-inline: 6px; scroll-snap-type: x proximity; }
.home-progress:not(.stacked), .stacked .home-other-lines { mask-image: linear-gradient(90deg, #000 calc(100% - 40px), transparent); }
/* With nothing to scroll the lone lead needs no fade. */
.home-progress.solo { mask-image: none; }
/* A lone lead on an otherwise empty page follows the centred wide head; narrow screens keep it left with the brand. */
@media (min-width: 561px) { .home-section.is-single { width: fit-content; max-width: 100%; margin-inline: auto; } }
.home-lead { display: flex; flex: none; height: var(--lead-h); border: 1px solid transparent; scroll-snap-align: start; }
.home-face { display: block; flex: none; }
.home-face img, .home-line > img, .home-recent img { display: block; width: 100%; height: 100%; object-fit: contain; background: var(--image-checker); border-radius: var(--r3); box-shadow: var(--print-shadow); }
/* A line without pictures shows its workspace mark as a faint watermark; the title stays in the text column. */
.text-face { display: grid; place-items: center; color: var(--line-2); background: var(--chrome); border: 1px solid var(--line); border-radius: var(--r3); }
.text-face > svg { width: 80px; height: 80px; fill: currentColor; }
/* The column hugs its content (title, recent row, button), so a line without recent pictures leaves no empty band. */
.home-lead-body { display: flex; flex-direction: column; justify-content: space-between; gap: 16px; width: max-content; min-width: 200px; max-width: var(--body-max, 400px); padding: 6px 0 0 40px; }
/* Without recent pictures the text and button sit together at the bottom, so nothing is left hanging in the middle. */
.home-lead-body.is-short { justify-content: flex-end; gap: var(--sp-5); }
.home-lead-title { min-width: 0; }
.home-todo { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0 0 8px; color: var(--fg-3); font-size: var(--fz-xs); line-height: 18px; }
.home-todo > .ico { flex: none; --ico: var(--ico-sm); }
.home-todo > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-lead h3 { display: -webkit-box; margin: 0; overflow: hidden; font-size: 22px; font-weight: var(--fw-semibold); line-height: 1.35; letter-spacing: .01em; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.home-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.home-facts > span { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; color: var(--fg-2); font-size: var(--fz-xs); background: var(--raised); border-radius: 14px; }
.home-status i { width: 5px; height: 5px; background: var(--a); border-radius: 50%; }
.home-lead-foot { display: grid; gap: 12px; }
.home-draft { display: flex; align-items: center; gap: 8px; min-width: 0; height: 32px; padding: 0 14px 0 12px; font-size: var(--fz-xs); color: var(--fg-3); background: var(--raised); border-radius: 20px; text-align: left; }
.home-draft > i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
.home-draft b { flex: none; font-weight: var(--fw-medium); color: var(--fg); }
.home-draft > span { overflow: hidden; color: var(--fg-2); white-space: nowrap; text-overflow: ellipsis; }
.home-draft small { flex: none; margin-left: auto; font: var(--fz-2xs)/1 var(--mono); }
.home-recent { display: flex; gap: 8px; }
.home-recent button { flex: none; }
.home-recent img { border-radius: var(--r2); }
.home-continue { justify-self: start; width: fit-content; height: 40px; min-height: 40px; padding: 0 16px 0 20px; gap: 10px; font-size: var(--fz-md); border-radius: var(--r3); }
.home-continue kbd { display: inline-grid; place-items: center; width: 22px; height: 20px; padding: 0; border: 0; box-shadow: none; background: color-mix(in srgb, var(--a-ink) 12%, transparent); color: var(--a-ink); }
.home-continue .ico { --ico: 12px; } /* stylelint-disable-line declaration-property-value-allowed-list -- The approved HOME keycap uses a 12px Enter glyph inside its 22×20px cap. */
.home-other-lines { display: flex; flex: none; gap: 16px; }
/* The lead's own text column sits 40px from its picture, so the next card stands a little further off to keep the lead one group. */
.home-lead + .home-other-lines { margin-left: 16px; }
.home-line { border: 1px solid transparent; display: flex; flex: none; flex-direction: column; scroll-snap-align: start; text-align: left; transition: transform var(--t1) var(--e); }
.home-line > img { flex: none; }
.home-line:hover { transform: translateY(-1px); }
.home-line-caption { display: grid; flex: 1; align-content: center; min-width: 0; gap: 5px; padding: 0 2px; }
.home-line-caption b, .home-line-caption small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-line-caption b { font-size: 13px; font-weight: var(--fw-medium); }
.home-line-caption small { color: var(--fg-3); font-size: var(--fz-xs); }
.home-progress.stacked { display: block; margin: 0; padding: 0; overflow: visible; }
.stacked .home-lead { flex-direction: column; height: auto; }
.stacked .home-face { align-self: center; }
.stacked .text-face > svg { width: 64px; height: 64px; }
.stacked .home-lead-body { width: 100%; min-width: 0; max-width: none; padding: 16px 0 0; gap: 12px; }
.stacked .home-recent { display: none; }
.stacked .home-continue { width: 100%; justify-content: center; }
.stacked .home-other-lines { margin: 10px -6px 0; padding: 6px 6px 4px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; }
.home-layout { flex: none; }
.home-layout button { display: block; padding: 3px 10px; color: var(--fg-3); font-size: var(--fz-xs); border-radius: var(--r1); transition: background var(--t1) var(--e), color var(--t1) var(--e); }
.home-layout [aria-pressed="true"] { color: var(--nav-active-ink); background: var(--nav-active-bg); box-shadow: var(--sh-1); }
.home-finals { position: relative; }
.home-print { position: absolute; border-radius: var(--r2); box-shadow: var(--print-shadow); }
.home-print > img { display: block; width: 100%; height: 100%; object-fit: contain; background: var(--image-checker); border-radius: inherit; }
.home-print-caption { position: absolute; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; padding: 9px; opacity: 0; color: var(--fg); background: color-mix(in srgb, var(--canvas) 90%, transparent); border-radius: 0 0 var(--r2) var(--r2); text-align: left; transition: opacity var(--t1) var(--e); }
.home-print-caption > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-print-caption b { display: flex; align-items: center; gap: 6px; font: 11px/1.5 var(--mono); }
.home-print-caption .ico { --ico: var(--ico-xs); }
.home-print-caption > span, .home-print-caption small { font-size: 11px; color: var(--fg-2); }
.home-print:is(:hover, :focus-visible) .home-print-caption { opacity: 1; }
@media (hover: none) { .home-print-caption { opacity: 1; } }
@media (max-width: 860px) {
  .home-page.is-empty { grid-template-rows: minmax(56px, 1fr) auto 28px auto minmax(48px, 2fr); padding-top: 24px; }
  .home-page { width: calc(100% - 32px); padding-top: var(--sp-5); }
  .home-section + .home-section { margin-top: var(--sp-5); }
  .home-section-head h2 { line-height: 30px; }
  .home-count { height: 20px; min-width: 20px; font-size: var(--fz-2xs); }
  .home-slate { height: 28px; padding: 0 10px; }
}
@media (max-height: 640px) { .home-page.is-empty { grid-template-rows: minmax(48px, 1fr) auto 24px auto minmax(24px, 2fr); padding-bottom: 24px; } }
@media (max-width: 400px) { .home-slate > i { display: none; } .home-section-head { gap: 6px; } }
@media (prefers-reduced-motion: reduce) { .home-shell[data-ask="full"], .home-shell::before { transition: none; } .home-line, .home-print-caption { transition: none; } }
</style>

<!-- View Transition pseudo-elements belong to the document, never a component scope. -->
<style>
html[data-home-vt]::view-transition-group(*) { animation-duration: .52s; animation-timing-function: cubic-bezier(.32, .72, 0, 1); }
html[data-home-vt]::view-transition-group(home-ask) { z-index: 2; }
html[data-home-vt]::view-transition-group(home-question) { z-index: 3; }
html[data-home-vt]::view-transition-image-pair(home-ask) { overflow: clip; animation: home-vt-surface .52s cubic-bezier(.32, .72, 0, 1) both; }
html[data-home-vt]::view-transition-image-pair(home-question) { overflow: clip; }
html[data-home-vt]::view-transition-old(home-ask), html[data-home-vt]::view-transition-new(home-ask) { width: 100%; height: 100%; object-fit: none; object-position: 0 0; }
/* Text keeps its size while its box moves; only pictures scale. */
html[data-home-vt]::view-transition-old(*.home-text), html[data-home-vt]::view-transition-new(*.home-text) { width: 100%; height: 100%; object-fit: none; object-position: 0 0; }
html[data-home-vt]::view-transition-image-pair(*.home-text) { overflow: clip; }
/* The capsule loses its folder from the left; the settings end stays put. */
html[data-home-vt]::view-transition-old(home-settings.home-text), html[data-home-vt]::view-transition-new(home-settings.home-text) { object-position: 100% 50%; }
html[data-home-vt]::view-transition-image-pair(home-settings) { border-radius: 17px; }
html[data-home-vt]::view-transition-old(home-question), html[data-home-vt]::view-transition-new(home-question) { width: 100%; height: 100%; object-fit: none; object-position: 0 50%; }
html[data-home-vt]::view-transition-old(home-ask) { animation: home-vt-out .16s var(--e) both; }
/* Opening shows the window live, so its own ask-layer-in plays as it does from the island. */
html[data-home-vt="open"]::view-transition-new(home-ask) { animation: none; }
html[data-home-vt="flow"]::view-transition-old(home-ask), html[data-home-vt="flow"]::view-transition-new(home-ask) { animation: none; }
html[data-home-vt="close"]::view-transition-new(home-ask) { animation: home-vt-fade-in var(--t2) var(--e) .2s both; }
/* Pieces that only leave or only arrive: fade out; fade in with the 4px rise. */
html[data-home-vt]::view-transition-old(*):only-child { animation: home-vt-out var(--t2) var(--e) both; }
html[data-home-vt]::view-transition-new(*):only-child { animation: home-vt-rise var(--t3) var(--e-out) .12s both; }
@keyframes home-vt-surface {
  from { border-radius: var(--home-vt-r0); background: var(--home-vt-bg0); box-shadow: inset 0 0 0 1px var(--home-vt-ring0); }
  to { border-radius: var(--home-vt-r1); background: var(--home-vt-bg1); box-shadow: inset 0 0 0 1px var(--home-vt-ring1); }
}
@keyframes home-vt-out { to { opacity: 0; } }
@keyframes home-vt-rise { from { opacity: 0; transform: translateY(4px); } }

@keyframes home-vt-fade-in { from { opacity: 0; } }
</style>

<style>
html[data-home-picture-transition]::view-transition-group(home-picture) { animation-duration: .52s; animation-timing-function: cubic-bezier(.32, .72, 0, 1); }
html[data-home-picture-transition]::view-transition-image-pair(home-picture) { overflow: clip; border-radius: var(--r3); }
</style>
