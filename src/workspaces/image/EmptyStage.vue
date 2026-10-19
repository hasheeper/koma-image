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
type Cell = { width: number; item: ImageRecord };
const shown = computed(() => layout.value.rows.flat().length);

const home = shallowRef<HTMLElement | null>(null);
const layout = shallowRef({
  width: 0,
  height: 0,
  gap: 16,
  rows: [] as Cell[][],
});
let observer: ResizeObserver | undefined;
let active = false;
let measureFrame = 0;
let measured = "";

// Favourites keep their own proportions at one shared height, in up to two
// centred rows. A row ends before it would overflow; it is never stretched.
function rowsFor(width: number, height: number, gap: number) {
  const rows: Cell[][] = [];
  const items = view.value.favorites.slice(0, 12);
  let index = 0;
  for (let r = 0; r < 2 && index < items.length; r++) {
    const row: Cell[] = [];
    let used = 0;
    while (index < items.length) {
      const item = items[index]!;
      const cell = Math.min(
        width,
        Math.floor((item.size.width / item.size.height) * height),
      );
      if (row.length && used + gap + cell > width) break;
      used += (row.length ? gap : 0) + cell;
      row.push({ width: cell, item });
      index++;
    }
    rows.push(row);
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
      gap = fitWidth <= 600 ? 8 : 16;
    // Large previews: up to 240px on desktop, about three 3:4 portraits per
    // row on a phone. Short desktop windows shrink them to fit both rows.
    const height = Math.floor(
      Math.max(
        56,
        Math.min(
          240,
          (width - gap * 2) / (3 * 0.75),
          narrow.value ? 240 : (fitHeight - 250) / 2,
        ),
      ),
    );
    layout.value = { width, height, gap, rows: rowsFor(width, height, gap) };
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
// The parent's viewport ref arrives after the first activation; observe it
// then, or resizes that leave this block's own size alone are never measured.
watch(
  () => props.viewport,
  (viewport, previous) => {
    if (previous) observer?.unobserve(previous);
    if (viewport) observer?.observe(viewport);
  },
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
    <p class="home-hint blank-keyed">
      写下描述，按 <span class="sr-only">Command + Enter</span
      ><span class="blank-keys" aria-hidden="true"
        ><kbd><AppIcon name="i-cmd" /></kbd
        ><kbd><AppIcon name="i-enter" /></kbd
      ></span>
      生成
    </p>
    <section v-if="shown" class="home-favs" aria-label="最近收藏">
      <div
        class="home-grid"
        :style="{
          '--home-gap': `${layout.gap}px`,
          '--home-h': `${layout.height}px`,
        }"
      >
        <div v-for="(row, index) in layout.rows" :key="index" class="home-row">
          <button
            v-for="cell in row"
            :key="cell.item.id"
            class="home-fav"
            type="button"
            :aria-label="`查看收藏 ${imageFileName(cell.item)}`"
            :style="{
              '--w': `${cell.width}px`,
              '--thumb': `url('${drawing.url(cell.item)}')`,
            }"
            @click="drawing.show(cell.item, true)"
          ></button>
        </div>
      </div>
      <button
        v-if="shown < view.favorites.length"
        class="home-all"
        type="button"
        @click="
          image.library = 'favorites';
          image.historyOpen = true;
          if (narrow) image.menuOpen = true;
        "
      >
        全部 {{ view.favorites.length }} 张<AppIcon name="i-chevron" />
      </button>
    </section>
  </div>
</template>
