<script setup lang="ts">
import { computed, shallowRef, watch, onDeactivated, nextTick } from "vue";
import { useChat } from "../../app/chat";
import { useShell } from "../../app/shell";
import { useUi } from "../../app/ui";
import {
  contextSnapshot,
  conversationImages,
  branchTurns,
  retainImage,
} from "../../domain/conversation.ts";
import { placeMenu, menuKeys } from "../../shared/popover";
import { names } from "../../storage/names";
import AppIcon from "../../shared/AppIcon.vue";
const emit = defineEmits<{ view: [id: string] }>();
const { chat, view } = useChat(),
  shell = useShell(),
  ui = useUi();
const dialog = shallowRef<HTMLDialogElement | null>(null),
  menu = shallowRef<HTMLElement | null>(null),
  choice = shallowRef({ id: "", kind: "" });
const c = computed(() => view.value.current),
  full = computed(() => contextSnapshot(c.value)),
  turns = computed(() => branchTurns(c.value));
const cap = computed(() => view.value.model?.maxImages ?? Infinity);
const url = (id: string) => chat.assets.assets.get(id)?.url;
/* Each picture sits on the floor where it first appeared — the turn that sent
   or made it — so a turn's text and pictures read together. A picture with no
   floor on this branch (an upload not yet sent, one from the drawing page or
   another branch) waits on this turn's floor. */
const floors = computed(() => {
  const shown = new Set(turns.value.map((t) => t.id)),
    held = new Set(full.value.imageIds),
    images = conversationImages(c.value)
      .reverse()
      .filter((v) => held.has(v.assetId) || chat.assets.assets.has(v.assetId));
  const on = (floor: string | null) =>
    images
      .filter(
        (v) => (v.turnId && shown.has(v.turnId) ? v.turnId : null) === floor,
      )
      .map((v) => v.assetId);
  return [
    ...turns.value.map((turn) => ({
      key: turn.id,
      turn,
      n: c.value.turns.indexOf(turn) + 1,
      images: on(turn.id),
    })),
    { key: "now", turn: null, n: 0, images: on(null) },
  ];
});
/* What the next turn does with a picture: edits it, sends it as reference n,
   drops it past the model's cap, or leaves it out (and offers it back). */
function state(id: string) {
  const at = view.value.context.imageIds.indexOf(id);
  if (at === 0) return "base";
  if (at > 0) return "ref";
  return view.value.context.dropped.includes(id) ? "dropped" : "pool";
}
function include(turnId: string, on: boolean) {
  chat.mutate((c) => {
    c.skipTurnIds = on
      ? c.skipTurnIds.filter((id) => id !== turnId)
      : [...c.skipTurnIds, turnId];
  });
}
function badge(id: string) {
  const s = state(id);
  return s === "base"
    ? "底图"
    : s === "ref"
      ? String(view.value.context.imageIds.indexOf(id))
      : "超出";
}
function label(id: string) {
  const s = state(id);
  if (s === "base") return "底图";
  if (s === "ref") return `参考 ${view.value.context.imageIds.indexOf(id)}`;
  if (s === "dropped") return "超出上限，不会发送";
  return cap.value === 1 ? "换为底图" : "加入参考图";
}
function close() {
  menu.value?.hidePopover();
  dialog.value?.close();
  shell.chat.contextOpen = false;
}
function toggle() {
  if (dialog.value?.open) {
    close();
    return;
  }
  if (shell.narrow.value) dialog.value?.showModal();
  else dialog.value?.show();
  shell.chat.contextOpen = true;
}
function tile(id: string, e: MouseEvent) {
  const kind = { base: "base", ref: "ref", dropped: "ref", pool: "add" }[
    state(id)
  ];
  if (kind === "add") {
    if (cap.value === 1) chat.setBase(id);
    else chat.mutate((c) => retainImage(c, id), true);
    return;
  }
  choice.value = { id, kind };
  menu.value?.showPopover();
  placeMenu(
    menu.value!,
    (e.currentTarget as HTMLElement).getBoundingClientRect(),
  );
  void nextTick(() =>
    menu.value
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus(),
  );
}
function action(kind: string) {
  const id = choice.value.id,
    index = full.value.refs.indexOf(id);
  menu.value?.hidePopover();
  if (kind === "view") emit("view", id);
  else if (kind === "base") chat.setBase(id);
  else if (kind === "earlier") chat.placeRef(id, index - 1);
  else if (kind === "later") chat.placeRef(id, index + 1);
  else chat.removeReference(id);
}
function drag(id: string, e: DragEvent) {
  e.dataTransfer?.setData(names.contextDragType, id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function accept(e: DragEvent) {
  if (e.dataTransfer?.types.includes(names.contextDragType)) e.preventDefault();
}
function drop(e: DragEvent, to: number | "base") {
  const id = e.dataTransfer?.getData(names.contextDragType);
  if (!id || !chat.assets.assets.has(id)) return;
  e.preventDefault();
  if (to === "base" || cap.value === 1) chat.setBase(id);
  else chat.placeRef(id, to);
}
async function reset() {
  const id = c.value.id;
  if (
    !(await ui.confirm({
      title: "清空上下文？",
      message:
        "底图、参考图和历史文字都不再带入下一轮；对话记录保留，图片仍可在这里点 ＋ 加回。",
      confirmLabel: "清空",
      tone: "danger",
    }))
  )
    return;
  if (c.value.id === id)
    chat.mutate(
      (c) =>
        Object.assign(c, {
          headId: null,
          mainId: null,
          attachments: [],
          keepIds: [],
          skipTurnIds: [],
          baseFollows: true,
        }),
      true,
    );
}
watch(shell.narrow, close);
onDeactivated(close);
defineExpose({ toggle, close });
</script>
<template>
  <dialog
    ref="dialog"
    id="contextPanel"
    class="context-panel"
    aria-labelledby="contextTitle"
    @close="shell.chat.contextOpen = false"
    @keydown.esc="
      (e) => {
        if (!menu?.matches(':popover-open')) {
          e.preventDefault();
          close();
        }
      }
    "
  >
    <header class="context-head">
      <div class="context-title">
        <h2 id="contextTitle">上下文</h2>
        <button
          class="ibtn"
          type="button"
          aria-label="清空上下文"
          :disabled="!full.imageIds.length && !turns.length"
          @click="reset"
        >
          <AppIcon name="i-eraser" /></button
        ><button
          class="ibtn"
          type="button"
          aria-label="关闭上下文"
          autofocus
          @click="close"
        >
          <AppIcon name="i-close" />
        </button>
      </div>
      <!-- The composer's context button in words: same icons, same order, the same −n past the cap. -->
      <p class="context-stats">
        <span v-if="turns.length" class="context-stat"
          ><AppIcon name="i-layers" /><span>文字</span
          ><span class="mono"
            >{{ view.context.turnIds.length }}/{{ turns.length }}</span
          ></span
        ><span
          class="context-stat"
          :data-over="view.context.dropped.length || undefined"
          ><AppIcon name="i-image" /><span>图片</span
          ><span class="mono"
            >{{ view.context.imageIds.length }}/{{
              Number.isFinite(cap) ? cap : "∞"
            }}</span
          ><span
            v-if="view.context.dropped.length"
            class="context-minus"
            :aria-label="`${view.context.dropped.length} 张超出上限`"
            >−{{ view.context.dropped.length }}</span
          ></span
        >
      </p>
    </header>
    <div
      class="context-body"
      id="contextContent"
      @dragover="accept"
      @drop="drop($event, full.refs.length)"
    >
      <ol class="context-floors">
        <li
          v-for="f in floors"
          :key="f.key"
          class="context-floor"
          :class="{ 'context-now': !f.turn }"
          :data-off="c.skipTurnIds.includes(f.key) || undefined"
        >
          <label v-if="f.turn" class="check context-text" :title="f.turn.prompt"
            ><input
              type="checkbox"
              :checked="!c.skipTurnIds.includes(f.key)"
              @change="
                include(f.key, ($event.target as HTMLInputElement).checked)
              "
            /><span></span
            ><span class="context-prompt">{{ f.turn.prompt }}</span></label
          >
          <div v-else class="context-text">
            <span class="context-dot"></span
            ><span class="context-prompt"
              ><b>本轮</b
              ><span :data-empty="!c.prompt.trim() || undefined">{{
                c.prompt.trim() || "输入框为空"
              }}</span></span
            >
          </div>
          <div
            v-if="f.images.length"
            class="context-tiles"
            role="list"
            :aria-label="f.turn ? `第 ${f.n} 轮的图片` : '本轮的图片'"
          >
            <div v-for="id in f.images" :key="id" role="listitem">
              <button
                type="button"
                class="context-tile"
                :data-state="state(id)"
                :data-dropped="state(id) === 'dropped' || undefined"
                :aria-label="label(id)"
                :draggable="state(id) !== 'base'"
                @dragstart="drag(id, $event)"
                @dragover="accept"
                @drop.stop="
                  drop(
                    $event,
                    state(id) === 'base'
                      ? 'base'
                      : Math.max(0, full.refs.indexOf(id)),
                  )
                "
                @click="tile(id, $event)"
              >
                <img
                  :src="url(id)"
                  alt=""
                  width="96"
                  height="96"
                  draggable="false"
                /><span class="context-badge"
                  ><AppIcon v-if="state(id) === 'pool'" name="i-plus" /><template
                    v-else
                    >{{ badge(id) }}</template
                  ></span
                >
              </button>
            </div>
          </div>
          <div
            v-if="!f.turn && (full.base || turns.length)"
            class="context-now-foot"
          >
            <label v-if="full.base" class="context-follow"
              ><span>底图跟随最新结果</span
              ><input
                type="checkbox"
                role="switch"
                :checked="c.baseFollows || !c.mainId"
                @change="
                  chat.mutate((c) => {
                    const on = ($event.target as HTMLInputElement).checked;
                    if (!on && !c.mainId) c.mainId = full.base;
                    c.baseFollows = on;
                  })
                "
              /><span class="switch" aria-hidden="true"></span
            ></label>
            <details v-if="turns.length" class="context-raw">
              <summary>
                <span>实际发送的文字</span><AppIcon name="i-chevron" />
              </summary>
              <pre>{{ view.context.text || "（空）" }}</pre>
            </details>
          </div>
        </li>
      </ol>
    </div>
    <div
      ref="menu"
      class="conv-menu"
      popover
      role="menu"
      aria-label="图片操作"
      @keydown="menuKeys"
    >
      <button type="button" role="menuitem" @click="action('view')">
        <AppIcon name="i-zoom-in" /><span>查看大图</span></button
      ><button
        v-if="choice.kind !== 'base'"
        type="button"
        role="menuitem"
        @click="action('base')"
      >
        <AppIcon name="i-edit" /><span>设为底图</span></button
      ><button
        v-if="choice.kind !== 'base'"
        type="button"
        role="menuitem"
        :disabled="full.refs.indexOf(choice.id) <= 0"
        @click="action('earlier')"
      >
        <AppIcon name="i-up" /><span>前移一位</span></button
      ><button
        v-if="choice.kind !== 'base'"
        type="button"
        role="menuitem"
        :disabled="full.refs.indexOf(choice.id) >= full.refs.length - 1"
        @click="action('later')"
      >
        <AppIcon name="i-down" /><span>后移一位</span>
      </button>
      <hr />
      <button
        type="button"
        role="menuitem"
        class="danger"
        @click="action('remove')"
      >
        <AppIcon name="i-close" /><span>移出上下文</span>
      </button>
    </div>
  </dialog>
</template>
