<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from "vue";
import { useEditor } from "../../app/editor";
import { directorTools, directorEmotions, directorLevels } from "../../domain/director-tools";
import { quoteLabel } from "../../domain/quote";
import AppIcon from "../../shared/AppIcon.vue";
import { menuKeys } from "../../shared/popover";
import { placeEditorPanel } from "./panels";

const { editor, view } = useEditor();
const trigger = shallowRef<HTMLButtonElement>(), panel = shallowRef<HTMLElement>(), choices = shallowRef<HTMLElement>();
const choice = shallowRef<"emotion" | "level">("emotion"), choiceOpen = shallowRef(false);
let choiceTrigger: HTMLButtonElement | undefined, events: AbortController | undefined;
const s = computed(() => view.value.session.director), tool = computed(() => directorTools.find(t => t.id === s.value.tool)!);
const options = computed(() => s.value.tool === "colorize" ? s.value.colorize : s.value.emotion);
const locked = computed(() => view.value.busy || view.value.preparing || view.value.reading);
const emotionLabel = computed(() => directorEmotions.find(([v]) => v === s.value.emotion.emotion)?.[1]);
const items = computed(() => choice.value === "emotion" ? directorEmotions.map(([value, label]) => ({ value, label })) : directorLevels.map((label, i) => ({ value: String(i), label })));
const selected = computed(() => choice.value === "emotion" ? s.value.emotion.emotion : String(s.value.emotion.defry));
function place() { if (panel.value?.matches(":popover-open") && trigger.value) placeEditorPanel(panel.value, trigger.value); if (choiceOpen.value) placeChoices(); }
function close(restore = false) { choices.value?.hidePopover(); panel.value?.hidePopover(); if (view.value.directorOpen) editor.directorToggle(false); if (restore) trigger.value?.focus({ preventScroll: true }); }
function beforeToggle(e: ToggleEvent) {
  if (e.newState !== "open" || !panel.value || !trigger.value) return;
  panel.value.style.display = "flex"; placeEditorPanel(panel.value, trigger.value); panel.value.style.removeProperty("display");
}
function toggled(e: Event) {
  const open = (e as ToggleEvent).newState === "open";
  if (open !== view.value.directorOpen) editor.directorToggle(open);
  events?.abort(); events = undefined;
  if (!open) { choices.value?.hidePopover(); return; }
  place(); events = new AbortController();
  // Quotes, fonts and viewport changes can resize the intrinsic-width panel after resize fires.
  const sizing = new ResizeObserver(place);
  sizing.observe(panel.value!);
  const toolbar = trigger.value?.closest(".editor-toolbar");
  if (toolbar) sizing.observe(toolbar);
  events.signal.addEventListener("abort", () => sizing.disconnect(), { once: true });
  window.addEventListener("resize", place, { signal: events.signal });
  document.addEventListener("scroll", place, { capture: true, passive: true, signal: events.signal });
}
function placeChoices() {
  if (!choices.value || !choiceTrigger) return;
  const r = choiceTrigger.getBoundingClientRect(), p = choices.value;
  p.style.left = `${Math.round(Math.max(8, Math.min(r.right - p.offsetWidth, document.documentElement.clientWidth - p.offsetWidth - 8)))}px`;
  p.style.top = `${Math.round(Math.max(8, r.top - p.offsetHeight - 4))}px`; p.dataset.placement = "top";
}
async function openChoices(kind: "emotion" | "level", e: Event) {
  if (choiceOpen.value && choice.value === kind) { choices.value?.hidePopover(); return; }
  choices.value?.hidePopover(); choice.value = kind; choiceTrigger = e.currentTarget as HTMLButtonElement;
  await nextTick(); choices.value?.showPopover(); placeChoices();
  choices.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
}
function choose(value: string) { editor.patchDirector(choice.value === "emotion" ? { emotion: value } : { defry: Number(value) }); choices.value?.hidePopover(); choiceTrigger?.focus({ preventScroll: true }); }
function choiceKey(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); choices.value?.hidePopover(); choiceTrigger?.focus({ preventScroll: true }); } else menuKeys(e); }
async function selectTool(value: string) { choices.value?.hidePopover(); editor.setDirectorTool(value); await nextTick(); place(); panel.value?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" }); }
function stripKey(e: KeyboardEvent) {
  const index = directorTools.findIndex(t => t.id === s.value.tool);
  const to = e.key === "ArrowLeft" ? (index + 5) % 6 : e.key === "ArrowRight" ? (index + 1) % 6 : e.key === "Home" ? 0 : e.key === "End" ? 5 : -1;
  if (to < 0) return; e.preventDefault(); void selectTool(directorTools[to].id).then(() => panel.value?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true }));
}
function panelKey(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); } }
watch(() => view.value.directorOpen, async open => { await nextTick(); if (open && view.value.open) { if (!panel.value?.matches(":popover-open")) panel.value?.showPopover(); place(); } else panel.value?.hidePopover(); });
watch([() => view.value.open, () => view.value.contextId, () => view.value.externalId], () => close());
watch(() => s.value.tool, () => void nextTick(place));
onBeforeUnmount(() => { events?.abort(); close(); });
defineExpose({ close });
</script>

<template>
  <div class="editor-director-tool">
    <button ref="trigger" id="editorDirector" class="editor-tool director-op" type="button" aria-label="Director Tools" data-tip="Director Tools" aria-haspopup="dialog" aria-controls="editorDirectorPanel" popovertarget="editorDirectorPanel" :aria-expanded="view.directorOpen" :disabled="locked || !view.viewed">
      <AppIcon name="i-dt-wand" /><AppIcon name="i-chevron" class="editor-caret" />
    </button>
    <section ref="panel" id="editorDirectorPanel" class="menu editor-mini director-panel" popover role="dialog" aria-label="Director Tools" @beforetoggle="beforeToggle" @toggle="toggled" @keydown="panelKey">
      <div v-if="s.tool === 'colorize' || s.tool === 'emotion'" class="editor-mini-params">
        <div v-if="s.tool === 'colorize'" class="editor-mini-row">
          <span class="editor-mini-label" title="减轻过强的色彩与噪点">Defry</span>
          <div class="seg director-num" role="radiogroup" aria-label="Defry">
            <label v-for="n in [0, 1, 2, 3, 4, 5]" :key="n"><input type="radio" name="directorDefry" :value="n" :checked="s.colorize.defry === n" :disabled="locked" @change="editor.patchDirector({ defry: n })" /><span>{{ n }}</span></label>
          </div>
        </div>
        <template v-else>
          <div class="editor-mini-row"><span class="editor-mini-label">表情</span><button class="editor-mini-chip" type="button" aria-label="表情" aria-haspopup="menu" :aria-expanded="choiceOpen && choice === 'emotion'" :disabled="locked" @click="openChoices('emotion', $event)">{{ emotionLabel }}<AppIcon name="i-chevron" /></button></div>
          <div class="editor-mini-row"><span class="editor-mini-label">强度</span><button class="editor-mini-chip" type="button" aria-label="表情强度" aria-haspopup="menu" :aria-expanded="choiceOpen && choice === 'level'" :disabled="locked" @click="openChoices('level', $event)">{{ directorLevels[s.emotion.defry] }}<AppIcon name="i-chevron" /></button></div>
        </template>
        <input class="director-prompt" type="text" maxlength="24000" placeholder="提示词（可选）" aria-label="工具提示词" :value="options.prompt" :disabled="locked" @input="editor.patchDirector({ prompt: ($event.target as HTMLInputElement).value })" />
      </div>
      <div v-if="view.director.warning || view.director.error" class="quota-warning" :role="view.director.error ? 'alert' : 'status'"><AppIcon name="i-alert" /><span>{{ view.director.error || view.director.warning }}</span></div>
      <div class="editor-mini-run">
        <span class="editor-mini-facts"><span v-if="view.director.size" class="editor-mini-cap mono">{{ view.director.size.width }}×{{ view.director.size.height }}</span><span v-if="s.tool === 'bg-removal'" class="editor-mini-cap">3 种结果</span></span>
        <button id="editorDirectorRun" class="btn btn-primary btn-go" type="button" data-tip="⌘↵" :disabled="locked || !view.director.canRun || !!view.director.error" @click="editor.runDirector()"><AppIcon :name="tool.icon" /><span>{{ tool.name }}</span><span v-if="view.director.quote && quoteLabel(view.director.quote)" class="cost-tag"><AppIcon name="i-points" /><b>{{ quoteLabel(view.director.quote) }}</b></span></button>
      </div>
      <div class="director-strip" role="radiogroup" aria-label="Director Tools 工具" @keydown="stripKey">
        <button v-for="t in directorTools" :key="t.id" class="editor-tool" type="button" role="radio" :aria-checked="s.tool === t.id" :aria-pressed="s.tool === t.id" :tabindex="s.tool === t.id ? 0 : -1" :disabled="locked" @click="selectTool(t.id)"><AppIcon :name="t.icon" /><span>{{ t.name }}</span></button>
      </div>
      <div ref="choices" id="editorDirectorChoices" class="menu director-choices" popover role="menu" :aria-label="choice === 'emotion' ? '表情' : '表情强度'" @toggle="choiceOpen = ($event as ToggleEvent).newState === 'open'" @keydown="choiceKey">
        <button v-for="item in items" :key="item.value" class="menu-item" type="button" role="menuitemradio" :aria-checked="selected === item.value" @click="choose(item.value)"><span class="menu-label">{{ item.label }}</span><AppIcon class="menu-check" name="i-check" /></button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor-director-tool { display: flex; flex: none; }
.director-op { display: grid; grid-template-columns: 32px 14px; width: 46px; padding: 0; gap: 0; justify-items: center; }
.director-panel { width: max-content; }
.director-num.seg { grid-auto-flow: column; grid-auto-columns: 26px; gap: 2px; padding: 2px; }
.director-num.seg span { padding: 3px 0; font: 500 var(--fz-xs)/1.4 var(--mono); }
.director-prompt { width: 100%; height: 32px; padding: 0 10px; font-size: var(--fz-xs); }
.director-strip { display: flex; flex: none; gap: 2px; margin: 0 -4px -4px; padding: 4px; border-top: 1px solid var(--line-2); overflow-x: auto; scrollbar-width: none; }
.director-strip .editor-tool[aria-pressed="false"] { color: var(--fg-2); }
.director-strip .editor-tool:hover { color: var(--fg); background: var(--hover); }
.director-choices { width: 148px; max-height: min(280px, calc(100vh - 16px)); }
@media (max-width: 860px) {
  .director-op { grid-template-columns: 40px 18px; width: 58px; height: 40px; }
  .director-num.seg { grid-auto-columns: 30px; }
  .director-num.seg span { padding: 6px 0; }
  .director-prompt { height: 38px; }
  .director-strip { mask-image: linear-gradient(90deg, #000 calc(100% - 20px), transparent); }
}
@media (max-width: 420px) { .director-num.seg { grid-auto-columns: 26px; } }
</style>
