<script setup lang="ts">
import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  shallowRef,
} from "vue";
import { useShell } from "../../app/shell";
import AppIcon from "../../shared/AppIcon.vue";

const props = defineProps<{ viewport: HTMLElement | null }>();
const { narrow } = useShell();
const home = shallowRef<HTMLElement | null>(null);
const layout = shallowRef({
  width: 0,
  gap: 12,
  compact: false,
  rows: [] as { ar: number; width: number }[][],
});
const shapes = [1, 2 / 3, 1.5, 2 / 3, 1, 1.5, 2 / 3, 1, 1.5, 2 / 3, 1, 1.5];
let observer: ResizeObserver | undefined;
let active = false;
let measureFrame = 0;
let measured = "";

// The original justified empty shelf geometry. Populated shelves enter with M4.
function rowsFor(width: number, target: number, gap: number) {
  const rows: { ar: number; width: number }[][] = [];
  let index = 0;
  for (let r = 0; r < 2 && index < shapes.length; r++) {
    const row: number[] = [];
    let sum = 0;
    while (
      index < shapes.length &&
      (!row.length ||
        (sum + shapes[index]!) * target + row.length * gap <= width)
    ) {
      const ar = shapes[index++]!;
      row.push(ar);
      sum += ar;
    }
    const full =
      index < shapes.length ||
      sum * target + (row.length - 1) * gap > width * 0.8;
    if (!full && rows.length) break;
    const height = full ? (width - (row.length - 1) * gap) / sum : target;
    rows.push(row.map((ar) => ({ ar, width: Math.floor(ar * height) })));
  }
  return rows;
}
async function measure() {
  const viewport = props.viewport;
  if (!active || !viewport || !home.value) return;
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
  const key = `${fitWidth}:${fitHeight}:${narrow.value}`;
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
      </div>
      <div class="home-shelf">
        <div
          class="home-grid is-empty"
          :style="{ '--home-gap': `${layout.gap}px` }"
        >
          <div
            v-for="(row, index) in layout.rows"
            :key="index"
            class="home-row"
          >
            <i
              v-for="(shape, column) in row"
              :key="column"
              class="home-ghost"
              aria-hidden="true"
              :style="{
                '--w': `${shape.width}px`,
                '--ar': shape.ar.toFixed(4),
              }"
            ></i>
          </div>
        </div>
        <p class="home-empty">
          <AppIcon name="i-star" /><b>收藏的图会排在这里</b
          ><span>{{
            layout.compact
              ? "刷新后也不会丢"
              : "生成记录刷新后清空，点图片下方的星标收藏，就会一直留在这里"
          }}</span>
        </p>
      </div>
    </section>
  </div>
</template>
