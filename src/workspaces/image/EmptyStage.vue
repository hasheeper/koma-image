<script setup lang="ts">
import {
  nextTick,
  watch,
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  shallowRef,
} from "vue";
import { useShell } from "../../app/shell";
import AppIcon from "../../shared/AppIcon.vue";

const props = defineProps<{ viewport: HTMLElement | null }>();
const { narrow, image } = useShell();
import { useDrawing } from "../../app/drawing";
import type { ImageRecord } from "../../domain/drawing";
import { imageFileName } from "../../domain/drawing";
const { drawing, view } = useDrawing();
type Cell = { ar: number; width: number; item?: ImageRecord };
const shown = computed(
  () => layout.value.rows.flat().filter((r) => r.item).length,
);

const home = shallowRef<HTMLElement | null>(null);
const layout = shallowRef({
  width: 0,
  gap: 12,
  compact: false,
  rows: [] as Cell[][],
});
const shapes = [1, 2 / 3, 1.5, 2 / 3, 1, 1.5, 2 / 3, 1, 1.5, 2 / 3, 1, 1.5];
let observer: ResizeObserver | undefined;
let active = false;
let measureFrame = 0;
let measured = "";

// Original justified shelf geometry, with persisted favorites before the ghosts.
function rowsFor(width: number, target: number, gap: number) {
  const rows: Cell[][] = [];
  const entries = [
    ...view.value.favorites
      .slice(0, 12)
      .map((item) => ({ ar: item.size.width / item.size.height, item })),
    ...shapes.map((ar) => ({ ar, item: undefined })),
  ];
  let index = 0;
  for (let r = 0; r < 2 && index < entries.length; r++) {
    const row: typeof entries = [];
    let sum = 0;
    while (
      index < entries.length &&
      (!row.length ||
        (sum + entries[index]!.ar) * target + row.length * gap <= width)
    ) {
      const cell = entries[index++]!;
      row.push(cell);
      sum += cell.ar;
    }
    const full =
      index < entries.length ||
      sum * target + (row.length - 1) * gap > width * 0.8;
    if (!full && rows.length) break;
    const height = full ? (width - (row.length - 1) * gap) / sum : target;
    rows.push(
      row.map((cell) => ({ ...cell, width: Math.floor(cell.ar * height) })),
    );
  }
  return rows;
}
async function measure() {
  const viewport = props.viewport;
  if (!active || !viewport || !home.value || view.value.state !== "empty")
    return;
  const css = getComputedStyle(viewport);
  const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
  const fitWidth = Math.floor(
    viewport.clientWidth -
      parseFloat(css.paddingLeft) -
      parseFloat(css.paddingRight),
  );
  const fitHeight = Math.floor(
    (narrow.value
      ? parseFloat(css.maxHeight) || viewport.clientHeight
      : viewport.clientHeight) - padding,
  );
  if (fitWidth <= 0 || fitHeight <= 0) return;
  const key = `${fitWidth}:${fitHeight}:${narrow.value}:${view.value.favorites.map((r) => r.id).join(",")}`;
  if (key !== measured) {
    measured = key;
    const inset = Math.round(Math.max(0, Math.min(72, (fitWidth - 480) / 4)));
    const width = Math.min(800, fitWidth - inset * 2),
      compact = fitWidth <= 600,
      gap = compact ? 6 : 12;
    const target = Math.max(
      56,
      Math.min(150, width / 6, narrow.value ? Infinity : (fitHeight - 190) / 2),
    );
    layout.value = { width, compact, gap, rows: rowsFor(width, target, gap) };
  }
  await nextTick();
  if (!active || !home.value) return;
  // This single CSS property is delegated to the native viewport sizing driver.
  // Node creation and shelf contents remain Vue-owned.
  if (narrow.value)
    viewport.style.setProperty(
      "--vp-h",
      `${Math.ceil(Math.max(200, home.value.offsetHeight + padding))}px`,
    );
  else viewport.style.removeProperty("--vp-h");
}
watch(
  [() => view.value.favorites, () => view.value.state, narrow],
  () => {
    measured = "";
    void measure();
  },
  { flush: "post" },
);
function pause() {
  active = false;
  cancelAnimationFrame(measureFrame);
  observer?.disconnect();
  observer = undefined;
}
onActivated(() => {
  active = true;
  observer = new ResizeObserver(() => {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => void measure());
  });
  if (props.viewport) observer.observe(props.viewport);
  if (home.value) observer.observe(home.value);
  void measure();
});
onDeactivated(pause);
onBeforeUnmount(pause);
</script>
<template>
  <div
    ref="home"
    class="home"
    :style="layout.width ? { '--home-w': `${layout.width}px` } : undefined"
  >
    <div class="home-top">
      <span class="home-lock"
        ><svg class="home-mark" viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="3"
            y="3"
            width="3"
            height="3"
            rx="1.1"
            opacity="0.24"
            style="--d: 0"
          />
          <rect
            x="9.8"
            y="2.3"
            width="4.4"
            height="4.4"
            rx="1.1"
            opacity="0.5"
            style="--d: 1"
          />
          <rect x="16.5" y="1.5" width="6" height="6" rx="1.7" style="--d: 2" />
          <rect
            x="2.3"
            y="9.8"
            width="4.4"
            height="4.4"
            rx="1.1"
            opacity="0.5"
            style="--d: 1"
          />
          <rect x="9" y="9" width="6" height="6" rx="1.7" style="--d: 2" />
          <rect
            x="17.3"
            y="9.8"
            width="4.4"
            height="4.4"
            rx="1.1"
            opacity="0.5"
            style="--d: 3"
          />
          <rect x="1.5" y="16.5" width="6" height="6" rx="1.7" style="--d: 2" />
          <rect
            x="9.8"
            y="17.3"
            width="4.4"
            height="4.4"
            rx="1.1"
            opacity="0.5"
            style="--d: 3"
          />
          <rect
            x="18"
            y="18"
            width="3"
            height="3"
            rx="1.1"
            opacity="0.24"
            style="--d: 4"
          /></svg
        ><span class="home-word"
          ><span class="brand-title">Koma</span
          ><span class="brand-subtitle">IMAGE</span></span
        ></span
      >
      <p class="home-hint">
        <span class="blank-keyed"
          >写下描述，按 <span class="sr-only">Command + Enter</span
          ><span class="blank-keys" aria-hidden="true"
            ><kbd><AppIcon name="i-cmd" /></kbd
            ><kbd><AppIcon name="i-enter" /></kbd
          ></span>
          生成</span
        ><span class="blank-touch">写下描述后点「生成」</span
        ><small class="blank-keyed">拖入图片可读取它的生成参数</small>
      </p>
    </div>
    <section class="home-favs" aria-labelledby="homeFavsTitle">
      <div class="home-head">
        <h2 id="homeFavsTitle"><AppIcon name="i-star" />最近收藏</h2>
        <span class="home-n" :hidden="!shown || shown < view.favorites.length"
          >{{ view.favorites.length }} 张</span
        ><button
          class="home-all"
          type="button"
          :hidden="!shown || shown >= view.favorites.length"
          @click="
            image.library = 'favorites';
            image.historyOpen = true;
            if (narrow) image.menuOpen = true;
          "
        >
          全部 {{ view.favorites.length }} 张<AppIcon name="i-chevron" />
        </button>
      </div>
      <div class="home-shelf">
        <div
          class="home-grid"
          :class="{ 'is-empty': !shown && !view.favoritesLoading }"
          :style="{ '--home-gap': `${layout.gap}px` }"
        >
          <div
            v-for="(row, index) in layout.rows"
            :key="index"
            class="home-row"
          >
            <template
              v-for="(shape, column) in row"
              :key="shape.item?.id || column"
              ><button
                v-if="shape.item"
                class="home-fav"
                type="button"
                :aria-label="`查看收藏 ${imageFileName(shape.item)}`"
                :style="{
                  '--w': `${shape.width}px`,
                  '--ar': shape.ar.toFixed(4),
                  '--thumb': `url('${drawing.url(shape.item, true)}')`,
                }"
                @click="drawing.show(shape.item, true)"
              ></button
              ><i
                v-else
                class="home-ghost"
                aria-hidden="true"
                :style="{
                  '--w': `${shape.width}px`,
                  '--ar': shape.ar.toFixed(4),
                  '--g': column,
                }"
              ></i
            ></template>
          </div>
        </div>
        <p class="home-empty" :hidden="!!shown || view.favoritesLoading">
          <AppIcon name="i-star" /><b>收藏的图会排在这里</b
          ><span>{{
            view.favoritesError
              ? "打开右侧的收藏可以重试"
              : layout.compact
                ? "刷新后也不会丢"
                : "生成记录刷新后清空，点图片下方的星标收藏，就会一直留在这里"
          }}</span>
        </p>
      </div>
    </section>
  </div>
</template>
