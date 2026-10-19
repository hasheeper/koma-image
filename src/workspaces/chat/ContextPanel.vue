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
} from "../../domain/conversation.js";
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
  known = computed(() => conversationImages(c.value)),
  turns = computed(() => branchTurns(c.value));
const extra = computed(() =>
  known.value.filter(
    (v) =>
      !full.value.imageIds.includes(v.assetId) &&
      chat.assets.assets.has(v.assetId),
  ),
);
const cap = computed(() => view.value.model?.maxImages ?? Infinity);
const url = (id: string) => chat.assets.assets.get(id)?.url;
function origin(id: string) {
  const info = known.value.find((v) => v.assetId === id),
    a = chat.assets.assets.get(id);
  if (info?.result && info.turnId) {
    const n = c.value.turns.findIndex((t) => t.id === info.turnId) + 1;
    return { text: `第 ${n} 轮结果`, badge: `#${n}`, icon: "" };
  }
  return a?.origin === "result"
    ? { text: "编辑结果", badge: "", icon: "i-edit" }
    : a?.origin === "image"
      ? { text: "来自绘图", badge: "", icon: "i-image" }
      : { text: "上传", badge: "", icon: "i-upload" };
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
function tile(id: string, kind: string, e: MouseEvent) {
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
        "底图、参考图和历史文字都不再带入下一轮；对话记录保留，图片仍可从「可加入」找回。",
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
    </header>
    <div class="context-body" id="contextContent">
      <section class="context-section" aria-label="图片">
        <div class="context-section-head">
          <h3>图片</h3>
          <span v-if="view.context.dropped.length" class="context-over"
            >{{ view.context.dropped.length }} 张超出上限</span
          ><span
            class="context-count mono"
            :data-state="view.context.dropped.length ? 'over' : undefined"
            >{{ view.context.imageIds.length }}/{{
              Number.isFinite(cap) ? cap : "∞"
            }}</span
          >
        </div>
        <div
          class="context-base"
          data-drop="base"
          @dragover.prevent
          @drop="drop($event, 'base')"
        >
          <button
            v-if="full.base"
            class="context-tile"
            data-kind="base"
            type="button"
            :aria-label="`底图：${origin(full.base).text}`"
            @click="tile(full.base, 'base', $event)"
          >
            <img :src="url(full.base)" alt="" width="96" height="96" /><span
              class="context-tile-origin"
              >{{ origin(full.base).badge
              }}<AppIcon
                v-if="origin(full.base).icon"
                :name="origin(full.base).icon"
            /></span>
          </button>
          <div v-else class="context-tile context-tile-empty">
            <AppIcon name="i-image" />
          </div>
          <div class="context-base-meta">
            <p class="context-base-label">
              <b>{{ full.base ? "底图" : "无底图" }}</b
              ><span>{{
                full.base ? origin(full.base).text : "按文字生成"
              }}</span>
            </p>
            <label v-if="full.base" class="context-follow"
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
              ><span>跟随最新结果</span></label
            >
          </div>
        </div>
        <div v-if="full.refs.length" class="context-group">
          <p class="context-sub">
            {{ cap === 1 ? "参考图 · 本模型只带底图" : "参考图" }}
          </p>
          <div
            class="context-grid"
            role="list"
            aria-label="参考图"
            @dragover.prevent
            @drop.self="drop($event, full.refs.length)"
          >
            <div v-for="(id, i) in full.refs" :key="id" role="listitem">
              <button
                type="button"
                class="context-tile"
                data-kind="ref"
                :data-dropped="!view.context.imageIds.includes(id) || undefined"
                :aria-label="`参考 ${i + 1}：${origin(id).text}`"
                draggable="true"
                @dragstart="drag(id, $event)"
                @dragover.prevent
                @drop.stop="drop($event, i)"
                @click="tile(id, 'ref', $event)"
              >
                <img
                  :src="url(id)"
                  alt=""
                  width="96"
                  height="96"
                  draggable="false"
                /><span class="context-tile-origin"
                  >{{ origin(id).badge
                  }}<AppIcon
                    v-if="origin(id).icon"
                    :name="origin(id).icon" /></span
                ><span class="context-tile-no mono">{{
                  view.context.imageIds.includes(id) ? i + 1 : "—"
                }}</span>
              </button>
            </div>
          </div>
        </div>
        <div v-if="extra.length" class="context-group">
          <p class="context-sub">{{ cap === 1 ? "可换为底图" : "可加入" }}</p>
          <div
            class="context-grid context-pool"
            role="list"
            aria-label="可加入的图片"
          >
            <div v-for="a in extra" :key="a.assetId" role="listitem">
              <button
                class="context-tile"
                data-kind="add"
                type="button"
                :aria-label="`加入参考图：${origin(a.assetId).text}`"
                draggable="true"
                @dragstart="drag(a.assetId, $event)"
                @click="tile(a.assetId, 'add', $event)"
              >
                <img
                  :src="url(a.assetId)"
                  alt=""
                  width="96"
                  height="96"
                  draggable="false"
                /><span class="context-tile-origin">{{
                  origin(a.assetId)
                }}</span
                ><span class="context-tile-add"><AppIcon name="i-plus" /></span>
              </button>
            </div>
          </div>
        </div>
      </section>
      <section class="context-section" aria-label="文字">
        <div class="context-section-head">
          <h3>文字</h3>
          <span v-if="turns.length" class="context-count mono"
            >{{ view.context.turnIds.length }}/{{ turns.length }}</span
          >
        </div>
        <div class="context-turns">
          <label
            v-for="turn in turns"
            :key="turn.id"
            class="check context-turn"
            :title="turn.prompt"
            ><input
              type="checkbox"
              :checked="!c.skipTurnIds.includes(turn.id)"
              @change="
                chat.mutate((c) => {
                  c.skipTurnIds = ($event.target as HTMLInputElement).checked
                    ? c.skipTurnIds.filter((id) => id !== turn.id)
                    : [...c.skipTurnIds, turn.id];
                })
              "
            /><span></span
            ><span class="context-turn-no mono"
              >#{{ c.turns.indexOf(turn) + 1 }}</span
            ><span class="context-turn-text">{{ turn.prompt }}</span></label
          >
          <div class="context-turn context-now">
            <span class="context-now-mark"></span
            ><span class="context-turn-no">本轮</span
            ><span
              class="context-turn-text"
              :data-empty="!c.prompt.trim() || undefined"
              >{{ c.prompt.trim() || "输入框为空" }}</span
            >
          </div>
        </div>
        <details v-if="turns.length" class="context-raw">
          <summary>
            <AppIcon name="i-chevron" /><span>实际发送的文字</span>
          </summary>
          <pre>{{ view.context.text || "（空）" }}</pre>
        </details>
      </section>
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
