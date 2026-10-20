<script setup lang="ts">
import { computed, shallowRef, nextTick } from "vue";
import { useShell } from "../../app/shell";
import { useDrawing } from "../../app/drawing";
import type { ImageRecord } from "../../domain/drawing";
import { imageFileName } from "../../domain/drawing";
import { names } from "../../storage/names";
import AppIcon from "../../shared/AppIcon.vue";
import WaveHost from "./WaveHost.vue";
import { stripBar } from "./library-strip";
const { image, narrow } = useShell(),
  { drawing, view } = useDrawing();
const tabs = ["history", "favorites"] as const,
  items = computed(() =>
    image.library === "favorites" ? view.value.favorites : view.value.history,
  );
const pending = computed(() =>
  image.library === "history" ? view.value.pending : null,
);
const focus = computed(() =>
  pending.value && !view.value.browsing
    ? -1
    : Math.max(
        0,
        items.value.findIndex((item) => item.id === view.value.current?.id),
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
  pending.value
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
  if (next !== undefined && buttons[next]) {
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
          :data-tip="tab === 'history' ? '历史' : '收藏'"
          :aria-label="`${tab === 'history' ? '历史' : '收藏'}，${view[tab].length} 张`"
          @click="select(tab)"
        >
          <AppIcon :name="tab === 'history' ? 'i-history' : 'i-star'" /><b
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
        v-if="view.pending && image.library === 'history'"
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
      <button
        v-for="(item, index) in items"
        :key="item.id"
        class="tile"
        type="button"
        :data-id="item.id"
        :data-shape="shape(item.size)"
        :data-fav="has(item.id) ? '' : undefined"
        :aria-current="
          !(view.pending && image.library === 'history' && !view.browsing) &&
          view.current?.id === item.id
        "
        :aria-label="`${has(item.id) ? '已收藏，' : ''}查看 ${imageFileName(item)}`"
        :style="{
          '--thumb': `url('${drawing.url(item, true)}')`,
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
        <img :src="drawing.url(item, true)" alt="" decoding="async" /><span
          v-if="image.library === 'history' && has(item.id)"
          class="tile-favorite"
          aria-hidden="true"
          ><AppIcon name="i-star" /></span
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
        v-show="image.library === 'history'"
        class="tray-ghosts"
        aria-hidden="true"
      >
        <i></i><i></i><i></i><i></i>
      </div>
      <AppIcon
        v-show="image.library === 'favorites'"
        class="ico-lg"
        name="i-star"
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
    <footer class="library-foot">
      <button
        id="histToggle"
        class="ibtn ibtn-xs library-fold"
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
        id="clearHist"
        class="ibtn ibtn-xs library-clear"
        type="button"
        :hidden="image.library !== 'history' || !view.history.length"
        aria-label="清空历史，收藏仍保留"
        @click="drawing.clear"
      >
        <AppIcon name="i-trash" />
      </button>
    </footer>
  </aside>
</template>
