<script setup lang="ts">
import { computed, shallowRef, nextTick, watch } from "vue";
import { useShell } from "../../app/shell";
import { useDrawing } from "../../app/drawing";
import type { ImageRecord } from "../../domain/drawing";
import { imageFileName } from "../../domain/drawing";
import { names } from "../../storage/names";
import AppIcon from "../../shared/AppIcon.vue";
import WaveHost from "./WaveHost.vue";
import { stripBar } from "./library-strip";
import { useAsk } from "../../app/ask";
const ask = useAsk(), comparing = shallowRef(false), selected = shallowRef<readonly string[]>([]);
const { image, narrow } = useShell(),
  { drawing, view } = useDrawing();
const tabs = ["history", "favorites"] as const,
  items = computed(() =>
    image.library === "favorites" ? view.value.favorites : view.value.history,
  );
const pending = computed(() =>
  image.library === "history" ? view.value.pending : null,
);
const showCompare = computed(() => !narrow.value || items.value.length > 1 || comparing.value);
const showClear = computed(() => image.library === "history" && view.value.history.length > 0);
/** The placeholder stands only for a picture still on its way; a landed one takes its slot while the stage reveals it. */
const waiting = computed(() => {
  const p = pending.value;
  return !!p && (!!p.composing || p.done < p.index);
});
/** The tile the stage shows or is about to show; none while the placeholder is current. */
const showing = computed(() =>
  pending.value && !view.value.browsing
    ? waiting.value ? null : view.value.history[0]?.id ?? null
    : view.value.current?.id ?? null,
);
const landing = computed(() =>
  pending.value && !waiting.value && !view.value.browsing ? showing.value : null,
);
function askLabel(id: string) { void ask.libraryRevision.value; return image.library === "favorites" ? ask.favoriteLabelFor(id) : ask.labelFor(id); }
function choose(id: string) {
  if (selected.value.includes(id)) selected.value = selected.value.filter((value) => value !== id);
  else if (selected.value.length < 2) selected.value = [...selected.value, id];
}
function toggleCompare() {
  comparing.value = !comparing.value;
  if (!comparing.value) selected.value = [];
}
function askDiff() {
  const labels = selected.value.map(askLabel).filter((v): v is string => !!v);
  if (labels.length !== 2) return;
  ask.show({ anchor: labels[0], question: `对比 ${labels[0]} 与 ${labels[1]}，哪些参数和画面发生了变化？` });
  if (narrow.value) image.menuOpen = false;
}
watch(() => [view.value.history, view.value.favorites], () => {
  const alive = new Set([...view.value.history, ...view.value.favorites].map((r) => r.id));
  selected.value = selected.value.filter((id) => alive.has(id));
});
const focus = computed(() =>
  waiting.value && !view.value.browsing
    ? -1
    : Math.max(
        0,
        items.value.findIndex((item) => item.id === showing.value),
      ),
);
function barStyle(
  id: string,
  size: { width: number; height: number },
  distance: number,
) {
  const bar = stripBar(id, size, distance);
  return { "--bar": `${bar.length}%`, "--age": bar.opacity };
}
const bars = computed(() =>
  items.value.map((item, index) =>
    barStyle(item.id, item.size, Math.abs(index - focus.value)),
  ),
);
const pendingBar = computed(() =>
  pending.value && waiting.value
    ? barStyle("pending", pending.value, Math.abs(-1 - focus.value))
    : undefined,
);
const tail = computed(() =>
  Array.from({ length: 24 }, (_, index) => {
    const bar = stripBar(
      `empty-${index}`,
      { width: 1024, height: 1024 },
      items.value.length + index - focus.value,
    );
    return { "--bar": `${bar.length * 0.8}%` };
  }),
);
const peek = shallowRef<ImageRecord | null>(null),
  peekNode = shallowRef<HTMLElement | null>(null),
  gallery = shallowRef<HTMLElement | null>(null);
const has = (id: string) => view.value.favorites.some((r) => r.id === id),
  shape = (r: { width: number; height: number }) =>
    r.height / r.width > 1.2
      ? "tall"
      : r.height / r.width < 0.8
        ? "wide"
        : "square";
function select(tab: "history" | "favorites") {
  image.library = tab;
  image.historyOpen = true;
  if (tab === "favorites" && view.value.favoritesError)
    void drawing.reloadFavorites();
}
function keydown(e: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  select(
    e.key === "Home"
      ? "history"
      : e.key === "End"
        ? "favorites"
        : image.library === "history"
          ? "favorites"
          : "history",
  );
  document.getElementById(`${image.library}Tab`)?.focus();
}
function tileKey(e: KeyboardEvent) {
  const buttons = [
      ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        ".tile",
      ),
    ],
    at = buttons.indexOf(e.target as HTMLElement),
    next = (
      {
        ArrowUp: at - 1,
        ArrowDown: at + 1,
        Home: 0,
        End: buttons.length - 1,
      } as Record<string, number>
    )[e.key];
  if (at >= 0 && next !== undefined && buttons[next]) {
    e.preventDefault();
    buttons[next].focus();
  }
}
function drag(e: DragEvent, item: ImageRecord) {
  if (item.params.tool === "upscale") {
    e.preventDefault();
    return;
  }
  e.dataTransfer?.setData(names.historyDragType, item.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
}
async function preview(item: ImageRecord, e: Event) {
  if (image.historyOpen || narrow.value) return;
  // currentTarget is cleared when the event handler yields.
  const target = e.currentTarget as HTMLElement;
  peek.value = item;
  await nextTick();
  if (
    !peekNode.value ||
    !gallery.value ||
    !target.isConnected ||
    peek.value?.id !== item.id ||
    image.historyOpen ||
    narrow.value
  )
    return;
  const tile = target.getBoundingClientRect(),
    rail = gallery.value.getBoundingClientRect();
  peekNode.value.style.top = `${Math.max(72, Math.min(rail.height - peekNode.value.offsetHeight - 8, tile.top + tile.height / 2 - rail.top - peekNode.value.offsetHeight / 2))}px`;
}
</script>
<template>
  <aside ref="gallery" class="gallery" id="gallery" aria-label="历史与收藏图片">
    <header class="library-head">
      <div
        class="library-tabs"
        role="tablist"
        aria-label="图片分类"
        @keydown="keydown"
      >
        <button
          v-for="tab in tabs"
          :key="tab"
          :id="`${tab}Tab`"
          class="ibtn library-tab"
          type="button"
          role="tab"
          aria-controls="tray"
          :aria-selected="image.library === tab"
          :tabindex="image.library === tab ? 0 : -1"
          :data-tip="narrow ? undefined : tab === 'history' ? '历史' : '收藏'"
          :aria-label="`${tab === 'history' ? '历史' : '收藏'}，${view[tab].length} 张`"
          @click="select(tab)"
        >
          <AppIcon :name="tab === 'history' ? 'i-history' : 'i-star'" /><span v-if="narrow" class="library-tab-label">{{ tab === 'history' ? '历史' : '收藏' }}</span><b
            class="mono"
            >{{ view[tab].length > 99 ? "99+" : view[tab].length }}</b
          >
        </button>
      </div>
    </header>
    <div
      class="tray"
      id="tray"
      role="tabpanel"
      :aria-labelledby="`${image.library}Tab`"
      @keydown="tileKey"
      @pointerleave="peek = null"
      @focusout="peek = null"
    >
      <button
        v-if="view.pending && waiting"
        class="tile tile-pending"
        type="button"
        :data-shape="shape(view.pending)"
        :style="pendingBar"
        :aria-current="!view.browsing"
        :aria-label="
          view.pending.composing
            ? '正在合成对比图'
            : `正在生成 ${view.pending.index}/${view.pending.total}，点击返回`
        "
        @click="drawing.live"
      >
        <WaveHost small style="position: absolute; inset: 0" />
      </button>
      <div v-for="(item, index) in items" :key="item.id" class="library-item">
      <button
        class="tile"
        type="button"
        :data-id="item.id"
        :data-shape="shape(item.size)"
        :data-fav="has(item.id) ? '' : undefined"
        :aria-current="showing === item.id"
        :data-landing="landing === item.id ? '' : undefined"
        :aria-label="`${has(item.id) ? '已收藏，' : ''}查看 ${imageFileName(item)}`"
        :style="{
          '--thumb': `url('${drawing.url(item, true)}')`,
          '--image-ratio': item.size.width / item.size.height,
          ...bars[index],
        }"
        :draggable="item.params.tool !== 'upscale'"
        @dragstart="drag($event, item)"
        @click="
          drawing.show(item, true);
          if (narrow) image.menuOpen = false;
        "
        @pointerenter="preview(item, $event)"
        @focus="preview(item, $event)"
      >
        <span v-if="image.historyOpen || narrow" class="library-ask-id"><i v-if="item.params.boardColor" class="library-board-dot" :style="{ background: String(item.params.boardColor) }" :title="String(item.params.boardName || '画板')"></i>{{ askLabel(item.id) }}</span>
        <img :src="drawing.url(item, true)" alt="" decoding="async" /><span
          v-if="image.library === 'history' && has(item.id)"
          class="tile-favorite"
          aria-hidden="true"
          ><AppIcon name="i-star" /><small>{{ ask.favoriteLabelFor(item.id) }}</small></span
        ><span
          v-if="image.library === 'history'"
          class="tile-x"
          role="button"
          tabindex="-1"
          aria-label="从历史移除"
          @click.stop="drawing.remove(item.id)"
          >×</span
        >
      </button>
      <button v-if="comparing && (image.historyOpen || narrow)" class="library-pick" type="button" :aria-label="`选择 ${askLabel(item.id)} 对比`" :aria-pressed="selected.includes(item.id)" :disabled="selected.length === 2 && !selected.includes(item.id)" @click="choose(item.id)">
        <span>{{ selected.includes(item.id) ? selected.indexOf(item.id) + 1 : '' }}</span>
      </button>
      </div>
      <div
        v-if="!image.historyOpen && !narrow && (items.length || pending)"
        class="library-tail"
        aria-hidden="true"
      >
        <i v-for="(style, index) in tail" :key="index" :style="style"></i>
      </div>
    </div>
    <div
      ref="peekNode"
      class="library-peek"
      :hidden="!peek || image.historyOpen || narrow"
      aria-hidden="true"
    >
      <img v-if="peek" :src="drawing.url(peek, true)" alt="" decoding="async" />
      <p>
        <span>{{
          peek
            ? `${new Date(peek.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · ${peek.size.width}×${peek.size.height}`
            : ""
        }}</span
        ><i :hidden="!peek || !has(peek.id)">★</i>
      </p>
    </div>
    <div
      class="tray-empty"
      id="trayEmpty"
      :hidden="
        !!items.length || (image.library === 'history' && !!view.pending)
      "
    >
      <div
        v-show="image.library === 'history' && !narrow"
        class="tray-ghosts"
        aria-hidden="true"
      >
        <i></i><i></i><i></i><i></i>
      </div>
      <AppIcon
        v-show="narrow || image.library === 'favorites'"
        class="ico-lg"
        :name="image.library === 'history' ? 'i-history' : 'i-star'"
      />
      <p>
        <span>{{
          image.library === "history"
            ? "生成的图会排在这里"
            : view.favoritesLoading
              ? "正在读取收藏"
              : view.favoritesError
                ? "暂时无法读取收藏"
                : "暂无收藏"
        }}</span
        ><span>{{
          image.library === "history"
            ? "刷新页面后清空"
            : view.favoritesError
              ? "再次点击收藏重试"
              : "点图片下方的星标即可收藏"
        }}</span>
      </p>
    </div>
    <div v-if="comparing && (image.historyOpen || narrow)" class="library-diff" role="group" aria-label="图片对比选择">
      <span>已选 {{ selected.length }} 张 · <button type="button" @click="selected = []">清空</button></span>
      <button class="btn btn-quiet btn-sm" type="button" :disabled="selected.length !== 2" @click="askDiff">Ask Diff</button>
    </div>
    <footer v-if="!narrow || showCompare || showClear" class="library-foot">
      <button
        v-if="!narrow"
        id="histToggle"
        class="ibtn library-fold"
        type="button"
        aria-controls="tray"
        :aria-expanded="image.historyOpen"
        :aria-label="image.historyOpen ? '收起图片栏' : '展开图片栏'"
        @click="
          image.historyOpen = !image.historyOpen;
          peek = null;
        "
      >
        <AppIcon name="i-sidebar" /></button
      ><button
        v-if="(image.historyOpen || narrow) && showCompare"
        class="ibtn library-compare"
        type="button"
        :aria-pressed="comparing"
        :aria-label="comparing ? '退出对比' : '对比'"
        :data-tip="comparing ? '退出对比' : '对比'"
        @click="toggleCompare"
      >
        <AppIcon name="i-compare" /></button
      ><button
        id="clearHist"
        class="ibtn library-clear"
        type="button"
        :hidden="!showClear"
        aria-label="清空历史，收藏仍保留"
        @click="drawing.clear"
      >
        <AppIcon name="i-trash" />
      </button>
    </footer>
  </aside>
</template>
<style scoped>
.library-item { position: relative; flex: none; min-width: 0; }
.library-item > .tile { display: block; }
/* The favourite star's chip, on the same bottom row; the top of a portrait stays clear. */
.library-ask-id {
  position: absolute; bottom: 5px; left: 5px; z-index: 1;
  display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 6px;
  color: var(--fg-2); font: var(--fw-medium) var(--fz-2xs)/1 var(--sans); font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--chrome) 72%, transparent);
  border-radius: var(--r1); backdrop-filter: blur(3px); pointer-events: none;
}
.tile[aria-current="true"] .library-ask-id { color: var(--a); }
/* A landed picture surfaces in the placeholder's slot while the stage's crest plays. */
.tile[data-landing] > :is(img, .library-ask-id), .tile[data-landing]::before { animation: tile-land 900ms var(--e-out) both; }
@keyframes tile-land { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .tile[data-landing] > :is(img, .library-ask-id), .tile[data-landing]::before { animation: none; }
}
.library-pick { position: absolute; right: 0; bottom: 0; display: grid; place-items: center; width: 44px; height: 44px; }
.library-pick span { display: grid; place-items: center; width: 24px; height: 24px; color: var(--a-ink); font-size: var(--fz-xs); background: var(--sunken); border: 1px solid var(--fg-3); border-radius: 50%; }
.library-pick[aria-pressed="true"] span { background: var(--a); border-color: var(--a); }
.library-pick:disabled { opacity: .35; }
.library-diff { display: grid; flex: none; gap: 7px; justify-items: center; margin: 6px 8px; padding: 9px 6px; font-size: var(--fz-xs); background: var(--raised); border: 1px solid var(--line-2); border-radius: 10px; }
.library-diff > span { color: var(--fg-3); }
.library-diff .btn { min-height: 30px; padding: 0 8px; }
/* Fold on the left; compare and clear share the right, clear at the edge. */
.library-foot { justify-content: flex-end; gap: 2px; }
.library-foot:has(.library-compare) .library-fold { margin-right: auto; }
.library-foot .library-compare[aria-pressed="true"] { color: var(--a); }
@media (min-width: 861px) {
  :global(body[data-hist="off"]) .library-item { display: contents; }
}
@media (max-width: 860px) {
  .gallery .library-foot :is(.library-clear, .library-compare) { flex: none; width: 44px; height: 44px; padding: 0; justify-content: center; }
  .library-tab-label { font-size: var(--fz-xs); }
  .library-diff { display: flex; justify-content: center; margin: 6px 0; }
  .library-ask-id { height: 22px; padding: 0 7px; font-size: var(--fz-xs); }
}
.library-board-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; }
</style>
