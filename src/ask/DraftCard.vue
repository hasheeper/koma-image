<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, useId, watch } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import AskReference from "./AskReference.vue";
import DraftSlate from "./DraftSlate.vue";
import DraftFiles from "./DraftFiles.vue";
import { filePreviews } from "./draft/file-view.ts";
import { draftView } from "./draft/view.ts";
import type { FieldKey } from "./draft/view.ts";
import { menuKeys, placeMenu } from "../shared/popover";

const props = defineProps<{ compact?: boolean; joined?: boolean }>();
const emit = defineEmits<{ review: [] }>();
const ask = useAsk(), plan = ask.draftPlan;
// The body stays as the user last left it, across drafts.
const open = shallowRef(false), body = shallowRef<HTMLElement | null>(null), more = shallowRef(false);
const fulls = shallowRef<ReadonlySet<FieldKey>>(new Set());
const fileRows = computed(() => plan.value ? filePreviews(plan.value) : []);
const slateStep = computed(() => plan.value?.steps.find(s => s.kind === "slate"));
watch(() => !!plan.value, () => { fulls.value = new Set(); });
const view = computed(() => plan.value ? draftView(plan.value) : null);
const issues = computed(() => plan.value?.steps.some((s) => !!s.issue));
const toggles = computed(() => (plan.value?.steps.length ?? 0) > 1);
const blocked = computed(() => !plan.value || (!plan.value.edit && !plan.value.changes.length && !plan.value.branch && !plan.value.handoff && !plan.value.slate && !plan.value.files?.length) || (!!(plan.value.edit || plan.value.slate || plan.value.files?.length) && issues.value) || ask.writingDraft.value || ask.running.value);
const menuId = `draftApply-${useId()}`;
const menu = shallowRef<HTMLElement | null>(null), menuTrigger = shallowRef<HTMLButtonElement | null>(null), menuOpen = shallowRef(false);
const hasApplyMenu = computed(() => !props.compact);
const hasImageOptions = computed(() => plan.value?.workspace === "image" && !plan.value.newBoardName && !props.compact);
const canChooseBoard = computed(() => hasImageOptions.value && !!plan.value?.changes.length);
const revising = computed(() => ask.canReviseDraft.value && (!!ask.input.value.trim() || !!ask.tray.value.length));
const applyLabel = computed(() => revising.value ? ask.draftApplyLabel.value.replace('应用', '应用原稿') : ask.draftApplyLabel.value);
const destinations = [
  { newBoard: false, label: "应用到来源画板" },
  { newBoard: true, label: "应用到新画板" },
];
const applyTitle = computed(() => plan.value?.workspace === "edit" ? "写入编辑画板，不会生成 · Tab" : plan.value?.slate && !plan.value.changes.length && !plan.value.newBoardName ? "写入任务板，不会生成 · Tab" : plan.value?.newBoardName ? `新建画板「${plan.value.newBoardName}」并应用，不会生成 · Tab`
  : view.value?.destination ? "新开对话写入参考图、画幅和输入框，不会发送 · Tab"
  : `${plan.value?.workspace === 'image' ? '写入来源画板，不会生成' : '写入输入框，不会发送'} · Tab`);
const applyIcon = computed(() => plan.value?.newBoardName ? "i-copy" : view.value?.destination ? "i-compose" : "i-check");
/** Thumbnail and size of a handoff image; null once it left history, favorites or CHAT. */
function picture(label: string) { void ask.libraryRevision.value; return ask.pictureInfo(label); }
let stopLayer = () => {};
function closeMenu(refocus = false) {
  menu.value?.hidePopover();
  if (refocus) menuTrigger.value?.focus({ preventScroll: true });
}
function outsideScroll(event: Event) {
  // The sibling message stream may auto-scroll without moving this button.
  if (event.target instanceof Node && menuTrigger.value && event.target.contains(menuTrigger.value)) closeMenu();
}
function closeOnResize() { closeMenu(); }
function cleanupMenu() {
  stopLayer();
  window.removeEventListener("resize", closeOnResize);
  window.removeEventListener("scroll", outsideScroll, true);
}
function beforeMenu(event: ToggleEvent) {
  menuOpen.value = event.newState === "open";
  if (!menuOpen.value) cleanupMenu();
}
function toggleMenu() {
  if (!menu.value || !menuTrigger.value) return;
  if (menu.value.matches(":popover-open")) { closeMenu(); return; }
  // Measure in the top layer and place before the first paint, not in the queued toggle event.
  menu.value.showPopover();
  placeMenu(menu.value, menuTrigger.value.getBoundingClientRect());
  stopLayer = ask.layer(() => { closeMenu(true); return true; });
  window.addEventListener("resize", closeOnResize);
  window.addEventListener("scroll", outsideScroll, true);
  menu.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}
function actionKeys(event: KeyboardEvent) {
  if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); closeMenu(true); }
  else menuKeys(event);
}
watch([() => plan.value?.fingerprint, () => props.compact, ask.visible, blocked], () => closeMenu());
onBeforeUnmount(() => { closeMenu(); cleanupMenu(); });
function full(key: FieldKey, on: boolean) {
  const next = new Set(fulls.value);
  if (on) next.add(key); else next.delete(key);
  fulls.value = next;
}
function fade() {
  const el = body.value;
  more.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 2;
}
watch([open, view, fulls, () => props.compact], () => void nextTick(fade), { flush: "post" });
/** Reviewing from the compact card opens the body in the window. */
function review() {
  open.value = true;
  emit("review");
}
function apply(event: MouseEvent) {
  const button = event.currentTarget as HTMLButtonElement;
  closeMenu();
  const target = button.dataset.newBoard;
  void ask.applyDraft(button.dataset.fingerprint ?? "", target === undefined ? undefined : target === "true");
}
function discard() { closeMenu(); ask.ignoreDraft(); }
</script>
<template>
  <section v-if="plan && view" class="ask-draft" :class="{ compact, joined, open: open && !compact, 'has-destination': !!view.destination }" aria-label="待确认草稿" data-status="pending" :aria-busy="ask.writingDraft.value">
      <header class="draft-head">
        <button v-if="compact" class="draft-toggle draft-review" type="button" aria-label="查看草稿修改" :title="plan.title" @click="review">
          <AppIcon name="i-edit" class="draft-lead" />
          <span class="draft-heading"><span class="draft-title"><strong>{{ plan.title }}</strong><span v-if="!fileRows.length" class="draft-stat"><span v-if="view.added" class="i">+{{ view.added }}</span><span v-if="view.removed" class="d">−{{ view.removed }}</span></span></span><span v-if="view.destination" class="draft-destination" :title="`${view.destination.label} · ${view.destination.name}`"><span>{{ view.destination.label }}</span><span aria-hidden="true">·</span><span class="draft-board-name">{{ view.destination.name }}</span></span></span>
        </button>
        <button v-else class="draft-toggle" type="button" :aria-expanded="open" aria-controls="askDraftBody" :title="plan.title" @click="open = !open">
          <AppIcon name="i-chevron" class="draft-chev" />
          <span class="draft-heading"><span class="draft-title"><strong>{{ plan.title }}</strong><span v-if="!fileRows.length" class="draft-stat" :title="`新增 ${view.added} 项 · 删除 ${view.removed} 项`"><span v-if="view.added" class="i">+{{ view.added }}</span><span v-if="view.removed" class="d">−{{ view.removed }}</span></span></span><span v-if="view.destination" class="draft-destination" :title="`${view.destination.label} · ${view.destination.name}`"><span>{{ view.destination.label }}</span><span aria-hidden="true">·</span><span class="draft-board-name">{{ view.destination.name }}</span></span></span>
        </button>
        <div class="draft-actions">
          <button v-if="compact" class="btn btn-sm draft-discard" type="button" aria-label="放弃草稿" title="放弃草稿" :disabled="ask.writingDraft.value || ask.running.value" @click="discard"><AppIcon name="i-close" /></button>
          <div class="draft-apply-group" :class="{ split: hasApplyMenu }">
            <button class="btn btn-primary btn-sm ask-draft-apply" type="button" :title="revising ? `应用原稿，补充意见尚未发送 · ${applyTitle}` : applyTitle" :data-fingerprint="plan.fingerprint" :disabled="blocked" :aria-disabled="blocked" @click="apply"><AppIcon :name="applyIcon" /><span>{{ ask.writingDraft.value ? '写入中…' : applyLabel }}</span></button>
            <button v-if="hasApplyMenu" ref="menuTrigger" class="btn btn-primary btn-sm draft-apply-more" type="button" aria-label="选择应用方式" title="选择应用方式" :popovertarget="menuId" aria-haspopup="menu" :aria-expanded="menuOpen" :disabled="ask.writingDraft.value || ask.running.value" @click.prevent="toggleMenu"><AppIcon name="i-chevron" /></button>
          </div>
        </div>
      </header>
      <div v-if="hasApplyMenu" :id="menuId" ref="menu" class="menu draft-apply-menu" popover="auto" role="menu" aria-label="应用方式" @beforetoggle="beforeMenu" @keydown.stop="actionKeys">
        <button v-for="destination in (canChooseBoard ? destinations : [])" :key="String(destination.newBoard)" class="menu-item" type="button" role="menuitem" :data-fingerprint="plan.fingerprint" :data-new-board="String(destination.newBoard)" :disabled="blocked" @click="apply">
          <AppIcon :name="destination.newBoard ? 'i-copy' : 'i-check'" /><span>{{ destination.label }}</span>
        </button>
        <hr v-if="canChooseBoard" />
        <template v-if="hasImageOptions">
          <button class="menu-item" type="button" role="menuitem" @click="closeMenu(); ask.proposeFile('recipe')"><AppIcon name="i-parameters" /><span>附加画板配方</span></button>
          <button class="menu-item" type="button" role="menuitem" @click="closeMenu(); ask.proposeFile('memo')"><AppIcon name="i-file" /><span>附加创作备忘录</span></button>
          <button v-if="ask.activeSlate.value" class="menu-item" type="button" role="menuitem" @click="closeMenu(); ask.proposeFile('slate')"><AppIcon name="i-tasks" /><span>附加任务交接资料</span></button>
          <hr />
        </template>
        <button class="menu-item" type="button" role="menuitem" :disabled="ask.writingDraft.value || ask.running.value" @click="discard"><AppIcon name="i-close" /><span>放弃草稿</span></button>
      </div>
      <p v-if="plan.aligned" class="draft-aligned">已按当前内容对齐，请核对后应用</p>
      <div v-show="open && !compact" id="askDraftBody" ref="body" class="draft-body" :class="{ more }" @scroll.passive="fade">
        <DraftSlate v-if="slateStep" :key="`${plan.title}-${slateStep.after}`" :change="plan.slate" :step="slateStep" />
        <section v-for="field in view.fields.filter(f => f.key !== 'slate')" :key="field.key" class="draft-field" :data-field="field.key">
          <header class="draft-field-head">
            <span class="draft-name"><AppIcon :name="field.icon" /><span>{{ field.label }}</span></span>
            <span v-if="field.full" class="draft-seg" role="group" :aria-label="`${field.label} 查看方式`">
              <button type="button" :aria-pressed="!fulls.has(field.key)" @click="full(field.key, false)">改动</button>
              <button type="button" :aria-pressed="fulls.has(field.key)" @click="full(field.key, true)">全文</button>
            </span>
          </header>
          <p v-if="field.full && fulls.has(field.key)" class="draft-full"><template v-for="(piece, i) in field.full" :key="i">{{ i ? ', ' : '' }}<del v-if="piece.op === 'del'">{{ piece.text }}</del><ins v-else-if="piece.op === 'ins'">{{ piece.text }}</ins><template v-else>{{ piece.text }}</template></template><template v-if="!field.full.length">（空）</template></p>
          <div v-else class="draft-diff">
            <div v-for="s in field.steps" :key="s.step.id" class="draft-step" :class="{ off: !s.step.enabled, invalid: !!s.step.issue, toggled: toggles && !s.step.locked }" :data-step="s.step.id" :title="s.step.label">
              <template v-if="s.kind === 'text'">
                <div v-for="(hunk, h) in s.hunks" :key="h" class="draft-hunk">
                  <div v-for="line in hunk" :key="line.sign" class="draft-line" :class="line.sign"><span class="draft-sign">{{ line.sign === 'del' ? '−' : '+' }}</span><span class="draft-text">{{ line.text }}</span></div>
                </div>
                <small v-if="s.step.characterId" class="draft-role-field">{{ s.step.label }}</small>
                <p v-if="!s.hunks.length" class="draft-same">无变化</p>
              </template>
              <div v-else-if="s.kind === 'param'" class="draft-kv">
                <AppIcon :name="s.icon" /><span class="draft-key" :title="s.source ? `来自 ${s.source}` : undefined">{{ s.name }}</span>
                <span class="draft-value"><template v-if="s.before !== s.after"><del>{{ s.before }}</del><AppIcon name="i-chevron" class="draft-arrow" /></template><b>{{ s.after }}</b></span>
              </div>
              <div v-else-if="s.kind === 'ref'" class="draft-kv draft-ref">
                <AppIcon name="i-image" /><span class="draft-key">{{ s.step.label }}</span>
                <span class="draft-value"><span class="draft-thumb" :class="{ gone: !picture(s.label) }"><img v-if="picture(s.label)" :src="picture(s.label)!.url" alt="" /></span><AskReference :label="s.label" /><span v-if="picture(s.label)" class="draft-dim">{{ picture(s.label)!.width }}×{{ picture(s.label)!.height }}</span></span>
              </div>
              <p v-else-if="s.kind === 'note'" class="draft-note">{{ s.text }}</p>
              <p v-if="s.step.issue" class="draft-issue">{{ s.step.issue }}</p>
              <button v-if="toggles && !s.step.locked" class="draft-undo" type="button" :disabled="!!s.step.issue || ask.writingDraft.value || ask.running.value" :aria-label="`${s.step.enabled ? '撤回' : '恢复'} ${s.step.label}`" :title="s.step.enabled ? '撤回此处' : '恢复此处'" @click="ask.toggleDraftStep(s.step.id)"><AppIcon :name="s.step.enabled ? 'i-undo' : 'i-redo'" /></button>
            </div>
          </div>
        </section>
        <DraftFiles :key="plan.files?.map(f => f.id).join(',')" :files="fileRows" :issue="plan.steps.find(s => s.kind === 'file' && s.issue)?.issue" />
      </div>
      <footer v-if="issues" class="draft-conflict"><span>冲突步骤不会写入</span><button v-if="compact" type="button" @click="review">核对草稿</button><button v-else type="button" :disabled="ask.writingDraft.value || ask.running.value" @click="ask.reproposeDraft()">基于当前内容重新提议</button></footer>
  </section>
</template>
<style scoped>
/* One grid: column A (14px chevron, icons, ± signs) at 12px, column B (text) at 34px, right edge at 8px. */
.ask-draft { --draft-content: color-mix(in srgb, var(--fg) 72%, var(--fg-2)); --draft-a: 12px; --draft-b: 34px; --draft-r: 8px; --draft-del: rgba(232, 135, 135, .1); --draft-ins: rgba(116, 207, 155, .085); --draft-del-hi: rgba(232, 135, 135, .17); --draft-ins-hi: rgba(116, 207, 155, .15); display: flex; flex: 0 1 auto; flex-direction: column; min-height: 0; margin-bottom: 8px; overflow: hidden; color: var(--fg-2); background: var(--ask-layer, var(--raised)); border: 1px solid var(--line-2); border-radius: 14px; }
.draft-head { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 0 8px; min-height: 44px; padding: 6px var(--draft-r) 6px 0; }
.draft-toggle { display: flex; flex: 1; align-items: center; gap: 8px; min-width: min(140px, 100%); min-height: 32px; align-self: stretch; padding-left: var(--draft-a); text-align: left; }
.draft-chev { flex: none; --ico: var(--ico-sm); color: var(--fg-3); transform: rotate(-90deg); transition: transform var(--t1) var(--e), color var(--t1) var(--e); }
.open .draft-chev { transform: rotate(90deg); }
.draft-toggle:hover .draft-chev { color: var(--fg); }
.draft-lead { flex: none; --ico: var(--ico-sm); color: var(--a); }
.draft-heading { display: grid; flex: 1; gap: 3px; min-width: 0; }
.has-destination .draft-toggle { padding-block: 4px; }
.draft-destination { display: flex; align-items: baseline; gap: 5px; color: var(--fg-3); font-size: 12px; font-weight: var(--fw-regular); }
.draft-destination > span:first-child { flex: none; color: var(--a); }
.draft-board-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-title { display: flex; flex: 1; align-items: baseline; gap: 8px; min-width: 0; }
.draft-title strong { min-width: 0; overflow: hidden; color: var(--fg); font-size: 13px; font-weight: var(--fw-medium); text-overflow: ellipsis; white-space: nowrap; }
.draft-review:hover strong { color: var(--a); }
.draft-stat { display: flex; flex: none; gap: 6px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.draft-stat .i { color: var(--ok); }
.draft-stat .d { color: var(--err); }
.draft-actions { display: flex; flex: 0 1 auto; align-items: center; gap: 4px; max-width: 100%; margin-left: auto; padding-left: 8px; }
.draft-actions .btn { min-height: 30px; padding: 0 9px; font-size: 13px; font-weight: var(--fw-medium); border: 0; border-radius: 8px; box-shadow: none; }
.draft-discard { flex: none; color: var(--fg-3); }
.draft-discard:hover:not(:disabled) { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.draft-apply-group { display: flex; align-items: stretch; min-width: 0; border-radius: 8px; background: var(--a); }
.draft-actions .ask-draft-apply { gap: 4px; padding-inline: 10px; white-space: normal; overflow-wrap: anywhere; }
.draft-apply-group .ico { --ico: var(--ico-sm); }
.split .ask-draft-apply:not(:disabled) { background: transparent; }
.split .ask-draft-apply { border-radius: 8px 0 0 8px; }
.split .ask-draft-apply:hover:not(:disabled) { background: var(--a-hover); }
.draft-actions .draft-apply-more { position: relative; flex: none; width: 28px; padding: 0; border-radius: 0 8px 8px 0; }
.draft-actions .draft-apply-more:hover:not(:disabled), .draft-apply-more[aria-expanded="true"] { background: rgb(255 255 255 / 18%); }
.draft-apply-more::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 1px; background: rgb(23 19 42 / 16%); }
.draft-apply-more .ico { transform: rotate(90deg); }
.joined { margin-bottom: 0; background: transparent; border: 0; border-radius: 14px 14px 0 0; }
/* Measured coordinates must not transition, including under the global reduced-motion duration. */
.draft-apply-menu { width: min(184px, calc(100vw - 16px)); transition-property: none; }
.draft-aligned { flex: none; padding: 0 var(--draft-r) 8px var(--draft-b); color: var(--warn); font-size: var(--fz-xs); }
.draft-body { display: grid; flex: 0 1 auto; grid-auto-rows: max-content; min-height: 0; max-height: min(44dvh, 340px); padding: 6px 0 10px; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--line); }
.draft-body.more { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); }
.draft-field + .draft-field { margin-top: 6px; }
.draft-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; padding: 4px var(--draft-r) 4px var(--draft-a); }
.draft-name { display: flex; align-items: center; gap: calc(var(--draft-b) - var(--draft-a) - 14px); min-width: 0; color: var(--fg); font-size: 13px; font-weight: var(--fw-medium); }
.draft-name .ico, .draft-kv > .ico { flex: none; --ico: var(--ico-sm); color: var(--fg-3); }
/* The site's .seg language: a well with one raised pill. */
.draft-seg { display: inline-grid; grid-auto-flow: column; gap: 2px; padding: 2px; background: var(--ask-field, var(--well)); border: 1px solid var(--line); border-radius: var(--r2); }
.draft-seg button { height: 22px; padding: 0 9px; color: var(--fg-3); font-size: 12px; border-radius: var(--r1); }
.draft-seg button:hover { color: var(--fg-2); }
.draft-seg button[aria-pressed="true"] { color: var(--fg); background: var(--raised); box-shadow: 0 1px 2px rgba(0, 0, 0, .3); }
.draft-seg button:focus-visible { outline: 1.5px solid var(--a); outline-offset: -1.5px; }
.draft-diff { display: grid; gap: 4px; padding: 0 var(--draft-r) 0 calc(var(--draft-b) - 6px); }
/* A step is one rounded block; its − and + rows touch. */
.draft-step { position: relative; display: grid; gap: 4px; transition: opacity var(--t1) var(--e); }
.draft-step.off { opacity: .38; }
.draft-hunk { overflow: hidden; border-radius: 6px; }
.draft-line { display: grid; grid-template-columns: calc(var(--draft-b) - var(--draft-a) + 6px) 1fr; padding: 4px 8px 4px 0; color: var(--fg); font-size: 13px; line-height: 1.6; }
.toggled .draft-hunk:first-child .draft-line { padding-right: 34px; }
.draft-sign { padding-left: 7px; font-weight: var(--fw-medium); }
.draft-text { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.draft-line.del { color: var(--fg-2); background: var(--draft-del); }
.draft-line.ins { background: var(--draft-ins); }
.draft-line.del .draft-sign { color: var(--err); }
.draft-line.ins .draft-sign { color: var(--ok); }
.off .draft-line { background: transparent; }
.draft-same, .draft-note { padding: 4px 34px 4px calc(var(--draft-b) - var(--draft-a) + 6px); color: var(--fg-3); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.draft-note { color: var(--fg-2); }
.draft-kv { display: grid; grid-template-columns: calc(var(--draft-b) - var(--draft-a) + 6px) 64px 1fr; align-items: center; min-height: 34px; padding-right: 34px; font-size: 13px; }
.draft-kv > .ico { margin-left: 6px; }
.draft-key { min-width: 0; overflow: hidden; color: var(--fg-2); text-overflow: ellipsis; white-space: nowrap; }
.draft-value { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.draft-value del { color: var(--fg-3); text-decoration-color: var(--fg-4); }
.draft-value b { color: var(--fg); font-weight: var(--fw-medium); }
.draft-arrow { flex: none; --ico: var(--ico-xs); color: var(--fg-4); }
/* A handoff image: the ASK attachment tile at row size, then its live ID and size. */
.draft-ref .draft-value { flex-wrap: nowrap; gap: 8px; }
.draft-thumb { flex: none; width: 26px; height: 26px; overflow: hidden; background: var(--ask-field); border: 1px solid var(--line-2); border-radius: 7px; }
.draft-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.draft-thumb.gone { border-style: dashed; }
/* AskReference has two roots (button and Teleport), so it does not take this scope. */
.draft-ref :deep(.ask-id) { flex: none; margin-left: -3px; white-space: nowrap; }
.draft-dim { min-width: 0; overflow: hidden; color: var(--fg-3); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.draft-issue { padding: 0 34px 2px calc(var(--draft-b) - var(--draft-a) + 6px); color: var(--warn); font-size: var(--fz-xs); line-height: 1.5; overflow-wrap: anywhere; }
.draft-step.invalid { opacity: .6; }
.draft-undo { position: absolute; top: 3px; right: 3px; display: grid; place-items: center; width: 28px; height: 28px; color: var(--fg-3); border-radius: 6px; opacity: 0; transition: opacity var(--t1) var(--e); }
.draft-undo .ico { --ico: var(--ico-sm); }
.draft-step:is(:hover, .off, :focus-within) .draft-undo { opacity: 1; }
.draft-undo:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.draft-undo:disabled { display: none; }
.draft-full { padding: 0 var(--draft-r) 0 var(--draft-b); color: var(--fg-3); font: var(--fw-regular) 13px/1.85 var(--sans); overflow-wrap: anywhere; }
.draft-full :is(del, ins) { padding: 1px 2px; border-radius: 3px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.draft-full del { color: var(--fg-2); text-decoration: line-through; text-decoration-color: rgba(232, 135, 135, .55); background: var(--draft-del-hi); }
.draft-full ins { color: var(--fg); text-decoration: none; background: var(--draft-ins-hi); }
.draft-conflict { display: flex; flex: none; flex-wrap: wrap; justify-content: space-between; gap: 6px; padding: 8px var(--draft-r) 10px var(--draft-b); color: var(--fg-3); font-size: var(--fz-xs); }
.draft-conflict button { color: var(--a); text-decoration: underline; text-underline-offset: 3px; }
.compact { flex: none; margin-bottom: 0; border: 0; border-radius: 12px; }
.compact .draft-head { padding-right: 6px; }
.compact .draft-toggle { padding-left: 10px; }
.compact .draft-actions { gap: 2px; }
.compact .draft-actions .btn { min-height: 28px; padding: 0 9px; font-size: 12.5px; }
.compact .draft-aligned, .compact .draft-conflict { padding-left: 32px; }
@media (max-width: 860px) {
  .draft-actions .btn { min-height: 36px; }
  .draft-actions .draft-apply-more { width: 36px; }
  .draft-undo { width: 32px; height: 32px; opacity: 1; }
  .draft-seg button { height: 30px; }
}
@media (max-width: 360px) {
  .draft-head { flex-wrap: nowrap; gap: 0; padding-bottom: 6px; }
  .draft-toggle { min-width: 0; min-height: 36px; }
  .draft-actions { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .draft-step, .draft-chev { transition: none; }
}
.draft-role-field { order: -1; padding-left: 28px; color: var(--fg-3); font-size: var(--fz-xs); }
.draft-field[data-field^="character:"] .draft-diff { gap: 0; padding-block: 4px; border: 1px solid var(--line); border-radius: 8px; margin-inline: 8px; }
</style>
