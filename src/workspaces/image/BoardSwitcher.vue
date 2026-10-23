<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref } from "vue";
import { useDrawing } from "../../app/drawing";
import { message, useUi } from "../../app/ui";
import AppIcon from "../../shared/AppIcon.vue";
import AiNameButton from "../../shared/AiNameButton.vue";
import { menuKeys, placeMenu } from "../../shared/popover";
const { drawing, view } = useDrawing(), ui = useUi();
const pill = ref<HTMLElement>(), menu = ref<HTMLElement>(), nameInput = ref<HTMLInputElement>();
const open = ref(false), renaming = ref<string | null>(null), actions = ref<string | null>(null), name = ref("");
let actionScroll = 0;
const current = computed(() => view.value.boards.find(b => b.id === view.value.activeBoardId)!);
const index = computed(() => view.value.boards.findIndex(b => b.id === view.value.activeBoardId) + 1);
function hideActions() { menu.value?.querySelector<HTMLElement>('.bd-actions:popover-open')?.hidePopover(); actions.value = null; }
function listScrolled(event: Event) {
  // A click can follow an automatic scroll before that scroll event is delivered.
  if (actions.value && (event.currentTarget as HTMLElement).scrollTop !== actionScroll) hideActions();
}
function dismissActions(event: KeyboardEvent) {
  event.preventDefault(); event.stopPropagation();
  const trigger = menu.value?.querySelector<HTMLElement>('.bd-actions:popover-open')?.parentElement?.querySelector<HTMLButtonElement>('.bd-more');
  hideActions(); trigger?.focus({ preventScroll: true });
}
function actionKeys(event: KeyboardEvent) { if (event.key === "Escape") dismissActions(event); else menuKeys(event); }
function close() { hideActions(); menu.value?.hidePopover(); renaming.value = null; }
function outsideScroll(event: Event) { if (!menu.value?.contains(event.target as Node)) close(); }
function beforeToggle(event: ToggleEvent) {
  open.value = event.newState === "open";
  if (!open.value) { renaming.value = null; actions.value = null; }
  if (!open.value || !menu.value || !pill.value) return;
  const r = pill.value.getBoundingClientRect();
  Object.assign(menu.value.style, { width: `${Math.min(r.width, innerWidth - 16)}px`, left: `${Math.max(8, r.left)}px`, top: `${r.bottom + 6}px` });
}
function toggle() {
  open.value = !!menu.value?.matches(":popover-open");
  window.removeEventListener("resize", close); window.removeEventListener("scroll", outsideScroll, true);
  if (!open.value || !menu.value || !pill.value) return;
  const r = pill.value.getBoundingClientRect(), el = menu.value;
  el.style.width = `${Math.min(r.width, innerWidth - 16)}px`;
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8))}px`;
  window.addEventListener("resize", close); window.addEventListener("scroll", outsideScroll, true);
}
async function run(action: () => Promise<unknown>) { close(); try { await action(); } catch (e) { ui.toast(message(e), "err"); } }
function actionBefore(event: ToggleEvent, id: string) {
  if (event.newState !== "open") { if (actions.value === id) actions.value = null; return; }
  actions.value = id; renaming.value = null;
  const el = event.target as HTMLElement, r = el.parentElement!.querySelector('.bd-more')!.getBoundingClientRect();
  actionScroll = el.closest('.bd-list')!.scrollTop;
  // Measure before the opening paint so the last row's menu flips above the viewport edge.
  el.style.display = "grid";
  placeMenu(el, r);
  el.style.removeProperty("display");
}
function actionToggle(event: ToggleEvent) {
  const el = event.target as HTMLElement;
  if (!el.matches(':popover-open')) return;
  placeMenu(el, el.parentElement!.querySelector('.bd-more')!.getBoundingClientRect());
  el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}
async function rename(id: string) {
  const board = view.value.boards.find(b => b.id === id); if (!board) return;
  hideActions(); name.value = board.name; renaming.value = id;
  await nextTick();
  nameInput.value = menu.value?.querySelector<HTMLInputElement>('.bd-rename input') ?? undefined;
  nameInput.value?.focus(); nameInput.value?.select();
}
function saveName() { const id = renaming.value; if (id && name.value.trim()) void run(() => drawing.renameBoard(id, name.value)); }
async function cancelRename() {
  const id = renaming.value; renaming.value = null; await nextTick();
  menu.value?.querySelector<HTMLButtonElement>(`[data-board-id="${CSS.escape(id ?? '')}"] .bd-more`)?.focus();
}
async function remove(id: string) {
  const board = view.value.boards.find(b => b.id === id); if (!board) return;
  close();
  if (await ui.confirm({ title: `删除画板“${board.name}”？`, message: "历史与收藏会保留。", confirmLabel: "删除", tone: "danger" })) await run(() => drawing.removeBoard(board.id));
}
function keys(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "Escape" && actions.value) { dismissActions(event); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...menu.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button => !button.closest('.bd-actions'));
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (i + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault(); buttons[next]?.focus();
}
function cleanup() { close(); window.removeEventListener("resize", close); window.removeEventListener("scroll", outsideScroll, true); }
onDeactivated(cleanup); onBeforeUnmount(cleanup);
</script>
<template>
  <div class="bd" :data-open="open">
    <div ref="pill" class="bd-pill" role="group" aria-label="画板">
      <button class="bd-switch" type="button" popovertarget="boardMenu" aria-haspopup="menu" :aria-expanded="open" :title="current.name">
        <i class="bd-dot" :style="{ '--c': current.color }"></i><span class="bd-name">{{ current.name }}</span><span class="bd-count mono">{{ index }}/{{ view.boards.length }}</span><AppIcon name="i-chevron" class="bd-caret" />
      </button>
      <AiNameButton class="bd-ai" kind="board" :id="current.id" />
      <button class="bd-new" type="button" title="新建空白画板" aria-label="新建空白画板" @click="run(() => drawing.createBoard(false))"><AppIcon name="i-plus" /></button>
    </div>
    <div id="boardMenu" ref="menu" popover="auto" class="switch-menu bd-menu" role="menu" aria-label="画板" @beforetoggle="beforeToggle" @toggle="toggle" @keydown="keys">
      <div class="bd-list" role="group" aria-label="画板列表" @scroll="listScrolled">
        <div v-for="board in view.boards" :key="board.id" class="bd-row" :data-selected="board.id === view.activeBoardId" :data-board-id="board.id">
          <form v-if="renaming === board.id" class="bd-rename" @submit.prevent="saveName">
            <i class="bd-dot" :style="{ '--c': board.color }"></i>
            <input v-model="name" type="text" maxlength="80" aria-label="画板名称" @keydown.enter="($event as KeyboardEvent).isComposing && $event.preventDefault()" @keydown.esc.stop.prevent="cancelRename" />
            <button type="submit" title="保存名称" aria-label="保存名称" :disabled="!name.trim()"><AppIcon name="i-check" /></button>
          </form>
          <template v-else>
            <button class="bd-item" role="menuitemradio" :aria-checked="board.id === view.activeBoardId" type="button" @click="run(() => drawing.switchBoard(board.id))">
              <i class="bd-dot" :style="{ '--c': board.color }"></i><span class="bd-menu-name" :title="board.name">{{ board.name }}</span><small>{{ board.form.model.includes('4-5') ? 'V4.5' : board.form.model.includes('diffusion-5') ? 'V5' : board.form.model }}<template v-if="board.form.characters.length"> · {{ board.form.characters.length }} 角色</template></small><AppIcon v-if="board.id === view.activeBoardId" name="i-check" class="bd-check" />
            </button>
            <button class="bd-more" type="button" :popovertarget="`boardActions-${board.id}`" :aria-label="`管理 ${board.name}`" title="管理画板" aria-haspopup="menu" :aria-expanded="actions === board.id"><AppIcon name="i-more" /></button>
            <div :id="`boardActions-${board.id}`" popover="auto" class="switch-menu bd-actions" role="menu" :aria-label="`管理 ${board.name}`" @beforetoggle="actionBefore($event, board.id)" @toggle="actionToggle" @keydown.stop="actionKeys">
              <button role="menuitem" type="button" @click="rename(board.id)"><AppIcon name="i-rename" />重命名</button>
              <button role="menuitem" type="button" class="bd-delete" :disabled="view.boards.length === 1" @click="remove(board.id)"><AppIcon name="i-trash" />删除画板</button>
            </div>
          </template>
        </div>
      </div>
      <div class="bd-footer">
        <button class="btn btn-sm" role="menuitem" type="button" @click="run(() => drawing.createBoard(false))"><AppIcon name="i-plus" />新建空白</button>
        <button class="btn btn-sm" role="menuitem" type="button" @click="run(() => drawing.createBoard(true))"><AppIcon name="i-copy" />复制当前</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.bd { display: block; flex: none; container-type: inline-size; margin: calc(var(--sp-1) * -1) 0 calc(var(--sp-3) - var(--section)); }
.bd-pill { display: flex; align-items: stretch; width: 100%; height: 40px; overflow: hidden; color: var(--fg); background: var(--raised); border: 1px solid var(--line-2); border-radius: 999px; box-shadow: var(--sh-lip), 0 1px 2px rgb(0 0 0 / 30%), 0 6px 16px -8px rgb(0 0 0 / 50%); transition: border-color var(--t1) var(--e), box-shadow var(--t1) var(--e); }
.bd-pill:hover { border-color: color-mix(in srgb, var(--fg-3) 30%, var(--line-2)); }
.bd-pill button { transition: background var(--t1) var(--e), color var(--t1) var(--e); }
.bd-pill button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--a-line); }
.bd-switch { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; min-width: 0; padding: 0 12px 0 14px; color: var(--fg); font-size: var(--fz-sm); font-weight: var(--fw-semibold); text-align: left; border-radius: 999px 0 0 999px; }
.bd-switch:hover, .bd-new:hover { background: var(--hover); }
.bd-dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--a)); }
.bd-switch .bd-dot { width: 8px; height: 8px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 18%, transparent); }
.bd-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bd-caret { flex: none; width: 16px; height: 16px; color: var(--fg-3); transform: rotate(90deg); transition: transform var(--t2) var(--e), color var(--t1) var(--e); }
.bd-count { flex: none; padding: 2px 7px; color: var(--fg-3); font-size: var(--fz-2xs); font-weight: var(--fw-medium); line-height: 1.3; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--fg) 6%, transparent); border-radius: 999px; }
.bd-new { position: relative; display: grid; place-items: center; flex: none; width: 42px; color: var(--fg-3); border-radius: 0 999px 999px 0; --ico: 16px; }
.bd-ai { align-self: center; margin-right: 4px; border-radius: 50%; }
.bd-new::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 1px; background: color-mix(in srgb, var(--fg-3) 30%, transparent); }
.bd-new:hover { color: var(--fg); }
.bd[data-open="true"] .bd-pill { border-color: var(--a-line); box-shadow: var(--sh-lip), 0 0 0 3px color-mix(in srgb, var(--a) 10%, transparent); }
.bd[data-open="true"] .bd-switch { background: color-mix(in srgb, var(--a) 10%, var(--raised)); }
.bd[data-open="true"] .bd-caret { color: var(--a); transform: rotate(-90deg); }
.bd-menu { position: fixed; inset: auto; max-height: min(70dvh, 540px); min-width: 0; padding: 6px; overflow: hidden; border-radius: 12px; }
.bd-menu:popover-open { display: flex; flex-direction: column; gap: 0; }
.bd-list { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.bd-row { display: flex; align-items: center; min-width: 0; border-radius: 8px; }
.bd-row + .bd-row { margin-top: 2px; }
.bd-row[data-selected="true"] { background: var(--a-dim); }
.bd-item { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; height: 36px; padding: 0 8px 0 10px; border-radius: 8px; text-align: left; font-size: var(--fz-sm); }
.bd-item:hover { background: var(--hover); }
.bd-menu-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bd-item small { flex: none; color: var(--fg-3); font-size: var(--fz-2xs); }
.bd-check { flex: none; width: 13px; height: 13px; color: var(--a); }
.bd-more { display: grid; place-items: center; flex: none; width: 28px; height: 28px; margin-right: 4px; color: var(--fg-3); border-radius: 6px; }
.bd-more .ico { width: 16px; height: 16px; }
.bd-more:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--hover); }
.bd-actions { position: fixed; inset: auto; width: 144px; min-width: 0; padding: 4px; border-radius: 9px; }
.bd-actions button { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 9px; color: var(--fg-2); font-size: var(--fz-sm); text-align: left; border-radius: 5px; }
.bd-actions .ico, .bd-footer .ico, .bd-rename .ico { flex: none; width: 14px; height: 14px; }
.bd-actions button:hover:not(:disabled) { color: var(--fg); background: var(--hover); }
.bd-actions .bd-delete:hover:not(:disabled) { color: var(--err); }
.bd-actions button:disabled { opacity: 0.35; cursor: default; }
.bd-footer { display: flex; flex: none; gap: 8px; margin: 5px 2px 0; padding-top: 4px; border-top: 1px solid var(--line); }
.bd-footer button { flex: 1; height: 32px; padding: 0 8px; color: var(--fg-2); background: var(--hover); }
.bd-footer button:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 5%, var(--hover)); }
.bd-footer button:active { background: var(--raised); }
.bd-rename { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 3px 4px 3px 10px; }
.bd-rename input { min-width: 0; width: 100%; height: 28px; padding: 3px 6px; font-size: var(--fz-sm); }
.bd-rename button { display: grid; place-items: center; flex: none; width: 28px; height: 28px; color: var(--a); border-radius: 6px; }
.bd-rename button:hover { background: var(--hover); }
@media (pointer: coarse), (max-width: 860px) {
  .bd-pill { height: 44px; } .bd-new { width: 46px; }
  .bd-item, .bd-footer button, .bd-actions button, .bd-rename { min-height: 44px; }
  .bd-more { width: 40px; height: 44px; }
  .bd-rename button { width: 40px; height: 38px; } .bd-rename input { height: 34px; }
}
@container (max-width: 300px) { .bd-switch { gap: 8px; padding-left: 12px; } }
@media (max-width: 340px) { .bd-item small { display: none; } }
</style>
