<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from "vue";
import { useDrawing } from "../../app/drawing";
import { message, useUi } from "../../app/ui";
import type { Character, Center, Placement } from "../../domain/characters.ts";
import AppIcon from "../../shared/AppIcon.vue";
import HighlightInput from "../../shared/HighlightInput.vue";
import CharacterPosition from "./CharacterPosition.vue";
const { drawing, view } = useDrawing(), ui = useUi();
const ownerBoardId = view.value.activeBoardId;
const open = ref(""), tab = ref<"prompt" | "negative">("prompt"), stage = ref(false), stageStyle = ref({});
const f = computed(() => view.value.form), cap = computed(() => view.value.characterCapability), boardId = computed(() => view.value.activeBoardId);
const ratio = computed(() => f.value.width / f.value.height);
const stageChars = computed(() => f.value.characters.map((c, i, all) => ({ ...c, on: c.on && all.slice(0, i + 1).filter(x => x.on).length <= cap.value.max })));
function over(i: number) { return cap.value.max > 0 && f.value.characters[i].on && f.value.characters.slice(0, i + 1).filter(c => c.on).length > cap.value.max; }
async function save(chars: Character[], placement: Placement = f.value.placement, id = ownerBoardId) { try { await drawing.editCharacters(chars, placement, id); } catch (e) { ui.toast(message(e), "err"); } }
function update(id: string, values: Partial<Character>, owner: string) { if (owner !== ownerBoardId || owner !== boardId.value) return; void save(f.value.characters.map(c => c.id === id ? { ...c, ...values } : c)); }
async function add() { const id = await drawing.addCharacter(); if (id) { open.value = id; tab.value = "prompt"; await nextTick(); document.getElementById(`char-${id}-prompt`)?.focus(); } }
function move(i: number, by: number) { const chars = [...f.value.characters]; [chars[i], chars[i + by]] = [chars[i + by], chars[i]]; void save(chars); }
function place(id: string, p: Center) { update(id, { centers: [p] }, boardId.value); }
function placement(mode: Placement) { void save(f.value.characters.map((c, i, all) => ({ ...c, centers: mode === "manual" && !c.centers.length ? [{ x: (i + .5) / all.length, y: .5 }] : c.centers })), mode); }
function positionStage() {
  const area = document.querySelector(".shell .viewport")?.getBoundingClientRect();
  if (!area) { stage.value = false; return; }
  const w = Math.min(area.width - 40, (area.height - 40) * ratio.value), h = w / ratio.value;
  stageStyle.value = { left: `${area.left + (area.width - w) / 2}px`, top: `${area.top + (area.height - h) / 2}px`, width: `${w}px`, height: `${h}px` };
}
function keys(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stage.value = false; } }
watch(stage, value => { if (value) { positionStage(); window.addEventListener("resize", positionStage); window.addEventListener("keydown", keys, true); } else { window.removeEventListener("resize", positionStage); window.removeEventListener("keydown", keys, true); } });
watch(boardId, () => { stage.value = false; open.value = f.value.characters[0]?.id ?? ""; tab.value = "prompt"; }, { immediate: true });
watch([ratio, () => f.value.placement, () => cap.value.max], () => { if (!cap.value.max || f.value.placement !== "manual") stage.value = false; else if (stage.value) positionStage(); });
function cleanup() { stage.value = false; window.removeEventListener("resize", positionStage); window.removeEventListener("keydown", keys, true); }
onDeactivated(cleanup); onBeforeUnmount(cleanup);
</script>
<template>
  <section class="fld mc" aria-label="角色">
    <div class="fld-top"><span class="composer-heading"><svg class="section-ico mc-person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7.4" r="3.6" /><path d="M2.4 20.2c0-4 2.9-6.9 6.6-6.9s6.6 2.9 6.6 6.9v.4H2.4z" /><circle cx="16.9" cy="8.5" r="2.9" /><path d="M15.7 13.3c.4-.1.8-.1 1.2-.1 2.9 0 5 2.3 5 5.5v1.9h-4.7c0-2.9-.5-5.3-1.5-7.3z" /></svg>角色<span v-if="f.characters.length" class="mc-count mono">{{ f.characters.length }}</span></span>
      <span class="mc-head-end"><span v-if="cap.max && f.characters.length" class="seg mc-pos" role="group" aria-label="位置"><button v-for="mode in (['auto', 'manual'] as const)" :key="mode" type="button" :aria-pressed="f.placement === mode" @click="placement(mode)">{{ mode === 'auto' ? '自动' : '手动' }}</button></span><button v-if="cap.max" class="ibtn ibtn-xs mc-add" type="button" aria-label="添加角色" title="添加角色" :disabled="f.characters.length >= cap.max" @click="add"><AppIcon name="i-plus" /></button></span>
    </div>
    <p v-if="!cap.max && f.characters.length" class="hint">当前模型不支持角色，生成时不发送</p>
    <ol v-if="f.characters.length" class="mc-list" :data-muted="!cap.max || undefined">
      <li v-for="(c, i) in f.characters" :key="`${boardId}:${c.id}`" class="mc-item" :data-character-id="c.id" :data-open="open === c.id || undefined" :data-off="!c.on || undefined" :data-over="over(i) || undefined">
        <div class="mc-row"><button class="mc-toggle" type="button" :aria-expanded="open === c.id" @click="open = open === c.id ? '' : c.id"><span class="mc-num">{{ i + 1 }}</span><span class="mc-text">{{ open === c.id ? `角色 ${i + 1}` : c.prompt.trim() || '空白角色' }}</span><span v-if="over(i) || !c.on" class="mc-flag">{{ over(i) ? '超出' : '停用' }}</span></button>
          <span v-if="open === c.id" class="mc-tools" role="group" :aria-label="`角色 ${i + 1}`"><button class="ibtn ibtn-xs" type="button" aria-label="上移" title="上移" :disabled="!i" @click="move(i, -1)"><AppIcon name="i-up" /></button><button class="ibtn ibtn-xs" type="button" aria-label="下移" title="下移" :disabled="i === f.characters.length - 1" @click="move(i, 1)"><AppIcon name="i-down" /></button><label class="mc-switch"><input type="checkbox" role="switch" :checked="c.on" :aria-label="`发送角色 ${i + 1}`" @change="update(c.id, { on: ($event.target as HTMLInputElement).checked }, ownerBoardId)" /><span class="switch"></span></label><button class="ibtn ibtn-xs" type="button" :aria-label="`删除角色 ${i + 1}`" title="删除" @click="save(f.characters.filter(x => x.id !== c.id))"><AppIcon name="i-trash" /></button></span><button class="mc-caret" type="button" tabindex="-1" aria-hidden="true" @click="open = open === c.id ? '' : c.id"><i class="caret"></i></button></div>
        <div v-if="open === c.id" class="mc-body"><div class="mc-tabs tabs" role="tablist"><button v-for="t in (['prompt', 'negative'] as const)" :key="t" class="tab" type="button" role="tab" :data-character-field="t" :aria-selected="tab === t" @click="tab = t"><span>{{ t === 'prompt' ? 'Prompt' : 'Negative' }}</span><span class="tab-count" :data-filled="c[t].length ? '1' : undefined">{{ c[t].length }}</span></button></div><div class="pane"><HighlightInput :id="`char-${c.id}-${tab}`" :key="`${boardId}:${c.id}:${tab}`" :model-value="c[tab]" :label="`角色 ${i + 1} ${tab}`" :placeholder="tab === 'prompt' ? 'girl, … / boy, … / other, …' : '该角色不要出现的内容'" :suggest="f.tagSuggest" @update:model-value="update(c.id, { [tab]: $event }, ownerBoardId)" /></div></div>
      </li>
    </ol>
    <div v-if="cap.max && f.characters.length && f.placement === 'manual'" class="mc-pad-row"><CharacterPosition :characters="stageChars" :ratio="ratio" :grid="cap.positioning === 'grid5'" :selected="open" @change="place" @select="open = $event"><button class="ibtn ibtn-xs mc-pad-wide" type="button" title="在画面上调整" aria-label="在画面上调整" @click="stage = true"><AppIcon name="i-expand" /></button></CharacterPosition></div>
    <p v-if="view.characterProblem" class="hint warn">当前模型最多 {{ cap.max }} 个启用角色</p>
  </section>
  <Teleport to="body"><section v-if="stage" class="mc-stage" :style="stageStyle" aria-label="调整角色位置"><CharacterPosition :characters="stageChars" :ratio="ratio" :grid="cap.positioning === 'grid5'" :selected="open" large @change="place" @select="open = $event" /><div class="mc-stage-bar"><div class="mc-stage-chips"><button v-for="c in f.characters.filter(c => c.on)" :key="c.id" class="mc-stage-chip" type="button" :aria-pressed="open === c.id" @click="open = c.id"><span class="mc-num">{{ f.characters.findIndex(x => x.id === c.id) + 1 }}</span>{{ c.prompt.split(',')[1]?.trim() || c.id }}</button></div><button class="btn btn-primary btn-sm" type="button" @click="stage = false">完成</button></div></section></Teleport>
</template>
<style scoped>
.mc-person { fill: currentColor; stroke: none; }
.mc-num { display: grid; place-items: center; flex: none; width: 18px; height: 18px; font: var(--fw-medium) 10.5px/1 var(--mono); color: var(--fg-3); border: 1px solid var(--line-2); border-radius: 50%; }
.mc-count { margin-left: 1px; color: var(--fg-3); font-size: var(--fz-2xs); font-weight: var(--fw-regular); }
.mc > .fld-top { min-height: 28px; }
.mc-head-end { display: inline-flex; align-items: center; gap: 6px; }
.mc-pos.seg { display: inline-flex; padding: 2px; gap: 2px; }
.mc-pos button { padding: 3px 9px; font-size: var(--fz-2xs); border-radius: var(--r1); color: var(--fg-3); }
.mc-pos button[aria-pressed="true"] { color: var(--fg); background: var(--raised); box-shadow: var(--sh-lip); }
.mc-list { display: grid; gap: 1px; margin: 0; padding: 0; list-style: none; }
.mc-list[data-muted] { opacity: .5; }
.mc-row { display: flex; align-items: center; gap: 2px; min-height: 34px; margin: 0 calc(-1 * var(--sp-2)); padding: 0 4px 0 var(--sp-2); border-radius: var(--r2); transition: background var(--t1) var(--e); }
.mc-row:hover { background: var(--hover); }
.mc-item[data-open] > .mc-row:hover { background: none; }
.mc-toggle { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; height: 34px; color: var(--fg-2); font-size: var(--fz-sm); text-align: left; }
.mc-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-flag { flex: none; margin-left: auto; padding-right: 2px; color: var(--fg-4); font-size: var(--fz-2xs); }
.mc-item[data-over] .mc-flag { color: var(--warn); }
.mc-item[data-off] :is(.mc-text, .mc-num), .mc-item[data-over] :is(.mc-text, .mc-num) { opacity: .45; }
.mc-item[data-open] .mc-toggle { color: var(--fg); font-weight: var(--fw-semibold); }
.mc-item[data-open] .mc-num, .mc-stage-chip[aria-pressed="true"] .mc-num { color: var(--a); background: var(--a-dim); border-color: var(--a-line); }
.mc-caret { display: grid; place-items: center; flex: none; width: 24px; height: 28px; }
.mc-caret .caret { margin: 0; }
.mc-item[data-open] .caret { transform: rotate(225deg) translate(-1px, -1px); }
.mc-tools { display: inline-flex; align-items: center; gap: 0; }
.mc-tools .ibtn { --ico: 15px; }
.mc-tools .ibtn:disabled { opacity: .3; cursor: default; }
.mc-switch { position: relative; display: inline-flex; align-items: center; height: 28px; padding: 0 6px; cursor: pointer; }
.mc-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.mc-switch .switch { --sw-w: 24px; --sw-h: 14px; }
.mc-body { display: grid; padding: 2px 0 var(--sp-2); }
.mc-tabs { border-bottom: 1px solid var(--line); }
.mc-tabs .tab { padding: 5px 10px 6px; }
.mc-body :deep(.hl-wrap) { min-height: 92px; max-height: 240px; overflow-y: auto; }
.mc-body :deep(textarea), .mc-body :deep(.hl-mirror) { font-size: var(--fz-sm); line-height: 1.6; padding: 10px 12px; }
.mc-pad-row { display: flex; justify-content: center; margin-top: calc(var(--sp-1) * -1); }
.mc-pad-wide { position: absolute; top: 2px; right: 2px; --ico: 15px; }
.mc-stage { position: fixed; z-index: 40; border-radius: var(--r3); background: rgb(10 10 12 / 55%); box-shadow: 0 0 0 1px var(--a-line); }
.mc-stage-bar { position: absolute; left: 50%; bottom: 12px; translate: -50% 0; display: flex; align-items: center; gap: 4px; max-width: calc(100% - 16px); padding: 4px; background: var(--raised); border-radius: var(--r3); box-shadow: inset 0 0 0 1px var(--line-2), var(--sh-2); }
.mc-stage-chips { display: flex; gap: 4px; min-width: 0; overflow-x: auto; }
.mc-stage-chip { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 30px; padding: 0 10px 0 6px; color: var(--fg-3); font-size: var(--fz-xs); border-radius: var(--r2); }
.mc-stage-chip[aria-pressed="true"] { color: var(--fg); background: var(--a-dim); }
.mc-stage-bar > .btn { flex: none; }
</style>
