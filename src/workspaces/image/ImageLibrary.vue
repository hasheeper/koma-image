<script setup lang="ts">
import { computed, shallowRef, nextTick, onDeactivated, onBeforeUnmount, watch } from "vue";
import { useShell } from "../../app/shell";
import { useDrawing } from "../../app/drawing";
import type { HistoryRecord } from "../../domain/drawing";
import { imageFileName } from "../../domain/drawing";
import { names } from "../../storage/names";
import HistoryRetrospectMenu from "../../ask/retrospect/HistoryRetrospectMenu.vue";
import AppIcon from "../../shared/AppIcon.vue";
import PopoverMenu from "../../shared/ui/PopoverMenu.vue";
import WaveHost from "./WaveHost.vue";
import { stripBar } from "./library-strip";
import { useAsk } from "../../app/ask";
const props = defineProps<{ horizontal?: boolean; mobile?: boolean; compact?: boolean; collapsed?: boolean; trayTarget?: HTMLElement | null }>();
const emit = defineEmits<{ browse: []; expand: [open: boolean] }>();
const { image } = useShell(), { drawing, view } = useDrawing();
const expanded = computed(() => props.horizontal || image.historyOpen);
const ask = useAsk();
const folded = computed(() => props.horizontal ? !!props.collapsed || !!props.compact : !image.historyOpen);
const mobileDialog = shallowRef<HTMLDialogElement | null>(null), mobileToggle = shallowRef<HTMLButtonElement | null>(null);
const mobileHead = shallowRef<HTMLElement | null>(null), mobileActions = shallowRef<HTMLElement | null>(null), mobileTray = shallowRef<HTMLElement | null>(null);
const trayHost = computed(() => props.mobile ? mobileTray.value : props.trayTarget);
let dialogRevision = 0;
watch([mobileDialog, () => props.mobile, folded], async ([dialog, mobile, closed]) => {
  const revision = ++dialogRevision;
  if (!mobile || closed) { dialog?.close(); return; }
  await nextTick();
  if (revision === dialogRevision && dialog?.isConnected && !dialog.open) {
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }
}, { flush: 'post' });
async function closeBrowser() {
  emit('expand', false);
  await nextTick();
  if (props.mobile && folded.value && !document.querySelector('dialog:modal')) mobileToggle.value?.focus({ preventScroll: true });
}
onBeforeUnmount(() => { dialogRevision++; mobileDialog.value?.close(); });
function fold() {
  if (props.horizontal) { emit('expand', folded.value); if (props.compact && folded.value) emit('browse'); }
  else image.historyOpen = !image.historyOpen;
  peek.value = null;
}
const tabs = ["history", "favorites"] as const;
const olderOpen = shallowRef(false), olderCount = shallowRef(60);
const recentCount = computed(() => view.value.form.historyLimit || view.value.history.length);
const older = computed(() => view.value.history.slice(recentCount.value));
const groups = computed(() => image.library === 'favorites' ? [{ key: 'favorites', items: view.value.favorites, offset: 0 }] : [
  { key: 'recent', items: view.value.history.slice(0, recentCount.value), offset: 0 },
  ...(older.value.length ? [{ key: 'older', items: olderOpen.value ? older.value.slice(0, olderCount.value) : [], offset: recentCount.value }] : []),
]);
const items = computed(() => groups.value.flatMap(g => g.items));
const olderOriginals = computed(() => older.value.filter(r => r.blob).length);
const pending = computed(() =>
  image.library === "history" ? view.value.pending : null,
);
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
function askRetrospect() {
  if (props.mobile) closeBrowser();
  const anchor = view.value.current ? askLabel(view.value.current.id) : null;
  ask.show({ ...(anchor ? { anchor } : {}), question: `请梳理${anchor ? ` ${anchor} 所属主题` : '当前画板'}刚才的配方演进，排除无关主题，整理分支并分析下一步如何调整。` });
}
watch(() => [view.value.history, view.value.favorites], () => {
  if (peek.value) peek.value = [...view.value.history, ...view.value.favorites].find(r => r.id === peek.value?.id) ?? null;
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
watch(() => view.value.current?.id, id => {
  const at = older.value.findIndex(r => r.id === id);
  if (at >= 0) { olderOpen.value = true; olderCount.value = Math.max(olderCount.value, at + 1); }
});
const peek = shallowRef<HistoryRecord | null>(null),
  peekNode = shallowRef<HTMLElement | null>(null),
  gallery = shallowRef<HTMLElement | null>(null);
onDeactivated(() => { peek.value = null; dialogRevision++; mobileDialog.value?.close(); });
watch(() => [props.horizontal, props.mobile, props.compact, props.collapsed], () => { peek.value = null; });
watch(() => image.library, () => { mobileTray.value?.scrollTo({ top: 0 }); });
const has = (id: string) => view.value.favorites.some((r) => r.id === id),
  shape = (r: { width: number; height: number }) =>
    r.height / r.width > 1.2
      ? "tall"
      : r.height / r.width < 0.8
        ? "wide"
        : "square";
function select(tab: "history" | "favorites") {
  image.library = tab;
  if (!props.horizontal) image.historyOpen = true;
  else { emit('expand', true); if (props.compact) emit('browse'); }
  if (tab === "favorites" && view.value.favoritesError)
    void drawing.reloadFavorites();
}
function keydown(e: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End", ...(props.horizontal ? ["ArrowUp", "ArrowDown"] : [])].includes(e.key)) return;
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
function drag(e: DragEvent, item: HistoryRecord) {
  if (item.params.tool === "upscale") {
    e.preventDefault();
    return;
  }
  e.dataTransfer?.setData(names.historyDragType, item.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
}
async function preview(item: HistoryRecord, e: Event) {
  if (props.mobile || e instanceof PointerEvent && e.pointerType === 'touch' || !props.horizontal && expanded.value) return;
  // currentTarget is cleared when the event handler yields.
  const target = e.currentTarget as HTMLElement;
  peek.value = item;
  await nextTick();
  if (
    !peekNode.value ||
    !gallery.value ||
    !target.isConnected ||
    peek.value?.id !== item.id ||
    !props.horizontal && (image.historyOpen)
  )
    return;
  const tile = target.getBoundingClientRect(),
    rail = gallery.value.getBoundingClientRect();
  if (props.horizontal) {
    peekNode.value.style.left = `${Math.max(8, Math.min(innerWidth - 248, tile.right + 8))}px`;
    peekNode.value.style.top = `${Math.max(8, Math.min(innerHeight - peekNode.value.offsetHeight - 8, tile.top + tile.height / 2 - peekNode.value.offsetHeight / 2))}px`;
    return;
  }
  peekNode.value.style.left = '';
  peekNode.value.style.top = `${Math.max(72, Math.min(rail.height - peekNode.value.offsetHeight - 8, tile.top + tile.height / 2 - rail.top - peekNode.value.offsetHeight / 2))}px`;
}
</script>
<template>
  <aside ref="gallery" class="gallery" :class="{ 'filmstrip editor-tool-capsule': horizontal, 'mobile-library-trigger': mobile, 'mobile-library-open': mobile && !folded, 'filmstrip-compact': horizontal && (folded || !items.length && !pending) }" id="gallery" aria-label="历史与收藏图片">
    <Teleport :to="mobileHead || 'body'" :disabled="!mobile || !mobileHead">
    <header class="library-head">
      <div
        class="library-tabs"
        role="tablist"
        aria-label="图片分类"
        aria-orientation="horizontal"
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
          :data-tip="mobile ? undefined : tab === 'history' ? '历史' : '收藏'"
          :aria-label="`${tab === 'history' ? '历史' : '收藏'}，${view[tab].length} 张`"
          @click="select(tab)"
        >
          <AppIcon v-if="!horizontal || mobile" :name="tab === 'history' ? 'i-history' : 'i-star'" /><span v-if="horizontal" class="library-tab-label">{{ tab === 'history' ? '历史' : '收藏' }}</span><b
            class="mono"
            >{{ view[tab].length > 99 ? "99+" : view[tab].length }}</b
          >
        </button>
      </div>
    </header>
    </Teleport>
    <Teleport :to="trayHost || 'body'" :disabled="!horizontal || !trayHost">
    <div
      class="tray"
      :class="{ 'canvas-tray': horizontal, 'mobile-tray': mobile }"
      v-show="!horizontal || !folded && (items.length || pending)"
      id="tray"
      :role="horizontal ? 'region' : 'tabpanel'"
      :aria-labelledby="horizontal ? undefined : `${image.library}Tab`"
      :aria-label="horizontal ? `${image.library === 'history' ? '历史' : '收藏'}图片` : undefined"
      @keydown="tileKey"
      @pointerleave="peek = null"
      @focusout="peek = null"
      @scroll="peek = null"
    >
      <button
        v-if="pending && waiting"
        class="tile tile-pending"
        type="button"
        :data-shape="shape(pending)"
        :style="{ ...pendingBar, '--image-ratio': pending.width / pending.height }"
        :aria-current="!view.browsing"
        :aria-label="
          pending.composing
            ? '正在合成对比图'
            : `正在生成 ${pending.index}/${pending.total}，点击返回`
        "
        @click="drawing.live(); emit('browse')"
      >
        <WaveHost small style="position: absolute; inset: 0" />
      </button>
      <template v-for="group in groups" :key="group.key">
      <button v-if="group.key === 'older'" class="history-section history-older" type="button" :aria-expanded="olderOpen" :title="`更早历史 ${older.length} 张 · ${olderOriginals} 张保留原图`" @click="olderOpen = !olderOpen">
        <AppIcon name="i-history" /><span>更早历史</span><small>{{ older.length }}</small>
      </button>
      <div v-else-if="group.key === 'recent' && older.length && expanded && !horizontal" class="history-section"><span>最近历史</span><small>{{ group.items.length }}</small></div>
      <div v-for="(item, index) in group.items" :key="item.id" class="library-item" :style="horizontal ? { '--image-ratio': item.size.width / item.size.height } : undefined">
      <button
        class="tile"
        type="button"
        :data-id="item.id"
        :data-shape="shape(item.size)"
        :data-fav="has(item.id) ? '' : undefined"
        :aria-current="showing === item.id"
        :data-landing="landing === item.id ? '' : undefined"
        :aria-label="`${has(item.id) ? '已收藏，' : ''}查看 ${imageFileName(item)}`"
        :title="horizontal && !mobile ? askLabel(item.id) ?? undefined : undefined"
        :style="{
          '--thumb': `url('${drawing.url(item, true)}')`,
          '--image-ratio': item.size.width / item.size.height,
          ...bars[index + group.offset],
        }"
        :draggable="!mobile && item.params.tool !== 'upscale'"
        @dragstart="drag($event, item)"
        @click="
          drawing.show(item, true); emit('browse');
        "
        @pointerenter="preview(item, $event)"
        @focus="preview(item, $event)"
      >
        <span v-if="expanded && !horizontal" class="library-ask-id"><i v-if="item.params.boardColor" class="library-board-dot" :style="{ background: String(item.params.boardColor) }" :title="String(item.params.boardName || '画板')"></i>{{ askLabel(item.id) }}<small v-if="!item.blob">缩略图</small><small v-else-if="group.key === 'older'">原图</small></span>
        <img :src="drawing.url(item, true)" alt="" decoding="async" /><span
          v-if="!horizontal && image.library === 'history' && has(item.id)"
          class="tile-favorite"
          aria-hidden="true"
          ><AppIcon name="i-star" /><small>{{ ask.favoriteLabelFor(item.id) }}</small></span
        ><span
          v-if="!horizontal && image.library === 'history'"
          class="tile-x"
          role="button"
          tabindex="-1"
          aria-label="从历史移除"
          @click.stop="drawing.remove(item.id)"
          >×</span
        >
      </button>

      </div>
      <button v-if="group.key === 'older' && olderOpen && olderCount < older.length" class="history-section history-more" type="button" @click="olderCount += 60">更多历史 · {{ older.length - olderCount }}</button>
      </template>
      <div
        v-if="!expanded && (items.length || pending)"
        class="library-tail"
        aria-hidden="true"
      >
        <i v-for="(style, index) in tail" :key="index" :style="style"></i>
      </div>
    </div>
    </Teleport>
    <Teleport to="body" :disabled="!horizontal">
    <div
      ref="peekNode"
      class="library-peek"
      :class="{ 'filmstrip-peek': horizontal }"
      :hidden="!peek || !horizontal && expanded"
      aria-hidden="true"
    >
      <img v-if="peek" :src="drawing.url(peek, true)" alt="" decoding="async" />
      <p>
        <span>{{
          peek
            ? `${horizontal ? askLabel(peek.id) : new Date(peek.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · ${peek.size.width}×${peek.size.height}`
            : ""
        }}</span
        ><i :hidden="!peek || !has(peek.id)">★</i>
      </p>
    </div>
    </Teleport>
    <Teleport :to="mobileTray || 'body'" :disabled="!mobile || !mobileTray">
    <div
      class="tray-empty"
      id="trayEmpty"
      :hidden="
        !!items.length || (image.library === 'history' && !!view.pending)
      "
    >
      <div
        v-show="image.library === 'history' && !horizontal"
        class="tray-ghosts"
        aria-hidden="true"
      >
        <i></i><i></i><i></i><i></i>
      </div>
      <AppIcon
        v-show="mobile || image.library === 'favorites'"
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
    </Teleport>
    <footer class="library-foot">
      <button v-if="mobile" ref="mobileToggle" id="canvasHistoryToggle" class="library-browse" type="button" aria-label="浏览历史与收藏" aria-haspopup="dialog" aria-controls="mobileImageLibrary" :aria-expanded="!folded" @click="fold">
        <AppIcon :name="image.library === 'history' ? 'i-history' : 'i-star'" /><span>{{ image.library === 'history' ? '历史' : '收藏' }}</span><b>{{ view[image.library].length }}</b><AppIcon class="library-browse-caret" name="i-up" />
      </button>
      <Teleport :to="mobileActions || 'body'" :disabled="!mobile || !mobileActions">
      <PopoverMenu v-if="horizontal" id="canvasLibraryOptions" label="图片历史选项" side="up" compact>
        <template #trigger="{ open, toggle }">
          <button class="library-more" type="button" aria-label="图片历史选项" aria-haspopup="menu" :aria-expanded="open" @click="toggle">
            <span class="library-current">{{ image.library === 'history' ? '历史' : '收藏' }}<b>{{ view[image.library].length > 99 ? '99+' : view[image.library].length }}</b></span>
            <AppIcon class="library-more-icon" name="i-more" /><AppIcon class="library-down-icon" name="i-down" />
          </button>
        </template>
        <template #default="{ close }">
          <div v-if="!mobile" class="canvas-library-choices">
            <button v-for="tab in tabs" :key="tab" class="menu-item" type="button" role="menuitemradio" :aria-checked="image.library === tab" :aria-label="`${tab === 'history' ? '历史' : '收藏'}，${view[tab].length} 张`" @click="select(tab); close(true)">
              <AppIcon :name="tab === 'history' ? 'i-history' : 'i-star'" /><span class="menu-label">{{ tab === 'history' ? '历史' : '收藏' }}</span><span class="menu-meta">{{ view[tab].length }}</span>
            </button>
          </div>
          <button v-if="!mobile && (items.length || pending)" class="menu-item" type="button" role="menuitem" @click="fold(); close(true)"><AppIcon name="i-sidebar" /><span class="menu-label">{{ folded ? '展开图片栏' : '收起图片栏' }}</span></button>
          <button v-if="image.library === 'history' && view.history.length > 1" class="menu-item" type="button" role="menuitem" @click="close(); askRetrospect()"><AppIcon name="i-branch" /><span class="menu-label">请 ASK 发起演进</span></button>
          <button class="menu-item" type="button" role="menuitem" :disabled="!showClear" @click="close(); drawing.clear()"><AppIcon name="i-trash" /><span class="menu-label">清空历史，收藏仍保留</span></button>
        </template>
      </PopoverMenu>
      </Teleport>
      <button
        v-if="!horizontal"
        id="histToggle"
        class="ibtn library-fold"
        type="button"
        aria-controls="tray"
        :aria-expanded="!folded"
        :aria-label="folded ? '展开图片栏' : '收起图片栏'"
        :title="folded ? '展开图片栏' : '收起图片栏'"
        @click="fold"
      >
        <AppIcon :name="horizontal ? 'i-chevron' : 'i-sidebar'" /></button
      ><button
        id="clearHist"
        v-if="!horizontal"
        class="ibtn library-clear"
        type="button"
        :hidden="!showClear"
        aria-label="清空历史，收藏仍保留"
        @click="drawing.clear"
      >
        <AppIcon name="i-trash" />
      </button>
      <HistoryRetrospectMenu v-if="!horizontal && image.library === 'history' && view.history.length > 1 && expanded" @start="askRetrospect" />
    </footer>
    <dialog ref="mobileDialog" id="mobileImageLibrary" class="mobile-library" aria-label="历史与收藏" @cancel.prevent="closeBrowser" @close="mobile && !folded && closeBrowser()" @click.self="closeBrowser">
      <div class="mobile-library-bar">
        <div ref="mobileHead"></div>
        <div ref="mobileActions" class="mobile-library-actions"></div>
        <button class="ibtn mobile-library-close" type="button" aria-label="收起历史与收藏" @click="closeBrowser"><AppIcon name="i-close" /></button>
      </div>
      <div ref="mobileTray" class="mobile-library-scroll" :class="{ 'is-empty': !items.length && !pending }"></div>
    </dialog>
  </aside>
</template>
<style scoped>
.history-section { display: flex; flex: none; grid-column: 1 / -1; align-items: center; justify-content: space-between; gap: 6px; padding: 10px 4px 6px; color: var(--fg-3); font-size: var(--fz-2xs); }
.history-section small { margin-left: auto; font-variant-numeric: tabular-nums; }
.history-section .ico { flex: none; }
.history-older:hover, .history-more:hover { color: var(--a); }
.library-ask-id small { color: var(--fg-3); font-size: inherit; }
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
/* The shared footer owns folding, clearing and evolution entry points. */
.library-foot { justify-content: flex-end; gap: 2px; }
@media (min-width: 861px) {
  :global(body[data-hist="off"]) .gallery:not(.filmstrip) .history-section > span { display: none; }
  :global(body[data-hist="off"]) .gallery:not(.filmstrip) .library-item { display: contents; }
}
@media (max-width: 860px) {
  .gallery .library-foot .library-clear { flex: none; width: 44px; height: 44px; padding: 0; justify-content: center; }
  .library-tab-label { font-size: var(--fz-xs); }
  .library-ask-id { height: 22px; padding: 0 7px; font-size: var(--fz-xs); }
}
.library-board-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; }
.gallery.filmstrip { position: relative; display: flex; flex-direction: row; align-items: center; gap: 2px; width: max-content; max-width: 100%; height: 44px; padding: 4px; border: 0; border-radius: 999px; overflow: visible; }
.filmstrip .library-head { padding: 0; flex: none; min-width: 0; }
.filmstrip .library-tabs { display: flex; flex-direction: row; width: max-content; gap: 2px; padding: 0; border: 0; background: transparent; box-shadow: none; }
.filmstrip .library-tabs .library-tab { flex-direction: row; justify-content: flex-start; gap: 5px; width: auto; height: 36px; padding: 0 12px; border: 0; border-radius: 999px; color: var(--fg-3); background: transparent; box-shadow: none; }
.filmstrip .library-tabs .library-tab[aria-selected="true"] { color: var(--a); background: var(--a-dim); }
.filmstrip .library-tabs .library-tab:hover { color: var(--fg); background: var(--glass-hover); }
.filmstrip .library-tab b { font-size: var(--fz-2xs); color: var(--fg-3); }
.filmstrip .library-tab-label { font-size: var(--fz-sm); }
.canvas-tray { display: flex; flex-direction: column; align-items: stretch; gap: 4px; width: 100%; min-width: 0; height: 100%; min-height: 0; padding: 0; overflow: hidden auto; overscroll-behavior-y: contain; scrollbar-width: thin; }
/* Spare space centers short desktop lists; overflowing lists keep their top reachable. */
.canvas-tray:not(.mobile-tray) > :first-child { margin-top: auto; }
.canvas-tray:not(.mobile-tray) > :last-child { margin-bottom: auto; }
.canvas-tray .library-item { display: block; flex: none; width: 100%; height: auto; }
.canvas-tray .tile { display: block; flex: none; width: 100%; height: auto; min-height: 0; padding: 2px; aspect-ratio: auto; border-radius: 6px; box-shadow: inset 0 0 0 1px var(--line-2); }
.canvas-tray .tile:hover { transform: none; box-shadow: inset 0 0 0 1px var(--fg-3); }
.canvas-tray .tile[aria-current="true"] { box-shadow: inset 0 0 0 2px var(--a); }
.canvas-tray .tile::before { display: none; }
.canvas-tray .tile-pending { aspect-ratio: var(--image-ratio, 1); }
.canvas-tray .tile > img { position: static; display: block; width: 100%; height: auto; aspect-ratio: var(--image-ratio, 1); object-fit: contain; border-radius: 4px; }
.filmstrip .library-foot { flex-direction: row; gap: 0; margin: 0; padding: 0; }
.library-more { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; width: 36px; border-radius: 999px; color: var(--fg-2); --ico: var(--ico-md); }
.library-more:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--glass-hover); }
.library-current, .library-down-icon, .canvas-library-choices { display: none; }
.library-current { align-items: baseline; gap: 5px; font-size: var(--fz-sm); }
.library-current b { color: var(--fg-3); font-size: var(--fz-xs); font-weight: var(--fw-regular); font-variant-numeric: tabular-nums; }
.filmstrip .tray-empty { display: none; }
.canvas-tray .history-section { flex-direction: column; justify-content: center; padding: 6px; white-space: nowrap; }
.filmstrip-peek { position: fixed; right: auto; z-index: var(--z-drawer); width: 240px; max-height: 300px; pointer-events: none; background: var(--glass-pop-bg); backdrop-filter: blur(var(--glass-blur)); }
.filmstrip-peek img { max-height: 265px; object-fit: contain; }
@container canvas-workspace (max-width: 820px) {
  .filmstrip .library-head, .library-more-icon { display: none; }
  .library-more { width: auto; min-width: 82px; padding: 0 9px; }
  .library-current { display: inline-flex; }
  .library-down-icon { display: inline-block; --ico: var(--ico-sm); }
  .canvas-library-choices { display: flex; flex-direction: column; margin-bottom: 4px; }
}
.library-browse { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 0 12px; color: var(--fg-2); border-radius: 999px; font-size: var(--fz-sm); --ico: var(--ico-md); }
.library-browse b { color: var(--fg-3); font-size: var(--fz-xs); font-weight: var(--fw-regular); font-variant-numeric: tabular-nums; }
.library-browse-caret { color: var(--fg-3); --ico: var(--ico-sm); }
.gallery.mobile-library-trigger { height: 44px; }
.gallery.mobile-library-open { visibility: hidden; }
.mobile-library-open > .library-foot { opacity: 0; }
</style>

<style scoped src="../../shared/canvas-history.css"></style>
