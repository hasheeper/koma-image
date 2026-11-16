<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  shallowRef,
  watch,
} from "vue";
import { useDrawing } from "../../app/drawing";
import { useShell } from "../../app/shell";
import { useUi, message } from "../../app/ui";
import { imageFileName, samplerName } from "../../domain/drawing";
import AppIcon from "../../shared/AppIcon.vue";
import ImageResultActions from "./ImageResultActions.vue";
import { useImageActions } from "./use-image-actions.ts";
import EmptyStage from "./EmptyStage.vue";
import WaveHost from "./WaveHost.vue";
import { useAsk, AskMark } from "../../app/ask";
const props = defineProps<{ visible?: boolean; paused?: boolean; compact?: boolean; historyVisible?: boolean; actionsTarget?: HTMLElement | null }>();
/* `paused`: still displayed (receded behind a canvas collaboration pane) but its drivers stop. */
const running = computed(() => props.visible !== false && !props.paused && workspaceVisible.value);
const emit = defineEmits<{ historyHost: [host: HTMLElement | null] }>();
const historyHost = shallowRef<HTMLElement | null>(null);
watch(historyHost, host => emit('historyHost', host), { flush: 'post' });
const ask = useAsk();
const { drawing, view } = useDrawing(), { narrow, workspaceVisible, image: shell, router } = useShell(), ui = useUi();
const viewport = shallowRef<HTMLElement | null>(null),
  wave = shallowRef<InstanceType<typeof WaveHost> | null>(null),
  timer = shallowRef<HTMLElement | null>(null),
  panel = shallowRef<HTMLElement | null>(null);
const current = computed(() => view.value.current), params = computed(() => current.value?.params ?? {});
const bounds = shallowRef<{ width: number; height: number } | null>(null);
// Only viewport bounds are measured. Both image frames derive from the live
// record/task sizes so a new landscape task cannot reuse a portrait frame.
const frameStyle = computed(() => {
  const area = bounds.value;
  if (!area) return {};
  const fit = (size: { width: number; height: number } | null | undefined) => {
    if (!size) return area;
    const ratio = Math.min(area.width / size.width, area.height / size.height, 1);
    return { width: Math.floor(size.width * ratio), height: Math.floor(size.height * ratio) };
  };
  const picture = fit(current.value?.size), pending = fit(view.value.pending);
  const displayed = view.value.state === 'busy' ? pending : picture;
  return {
    '--fit-w': `${picture.width}px`, '--fit-h': `${picture.height}px`,
    '--sk-w': `${pending.width}px`, '--sk-h': `${pending.height}px`,
    '--display-w': `${displayed.width}px`,
  };
});
const { annotate } = useImageActions(current);
let observer: ResizeObserver | undefined,
  frame = 0,
  active = false,
  tick: ReturnType<typeof setInterval> | undefined,
  started = 0;
function measure() {
  const vp = viewport.value;
  if (!active || !vp) return;
  const css = getComputedStyle(vp),
    px = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight),
    py = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
  const width = Math.floor(vp.clientWidth - px - (props.historyVisible ? 76 : 0)),
    height = Math.floor(vp.clientHeight - py);
  if (width <= 0 || height <= 0) return;
  if (bounds.value?.width !== width || bounds.value?.height !== height) bounds.value = { width, height };
}
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measure);
}
function clock() {
  clearInterval(tick);
  tick = undefined;
  if (active && view.value.busy) {
    if (!started) started = performance.now();
    tick = setInterval(() => {
      if (timer.value)
        timer.value.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
    }, 100);
  } else if (!view.value.busy) started = 0;
}
watch(
  [
    () => view.value.state,
    () => view.value.current,
    () => view.value.pending,
    narrow,
    () => props.historyVisible,
  ],
  () => {
    schedule();
    clock();
  },
  { flush: "post" },
);
function pause() {
  active = false;
  window.visualViewport?.removeEventListener("resize", schedule);
  observer?.disconnect();
  observer = undefined;
  cancelAnimationFrame(frame);
  clearInterval(tick);
  tick = undefined;
  drawing.setReveal(undefined);
}
function activate() {
  if (active || !running.value || router.route.value.workspace !== "image") return;
  active = true;
  observer = new ResizeObserver(schedule);
  if (viewport.value) observer.observe(viewport.value);
  window.visualViewport?.addEventListener("resize", schedule);
  schedule();
  clock();
  drawing.setReveal(async (record) => {
    if (!active || view.value.browsing) return;
    await nextTick();
    measure();
    const img = new Image();
    img.src = drawing.url(record);
    try {
      await img.decode();
      if (!active || view.value.browsing) return;
      const played = await wave.value?.reveal(img);
      if (played && active && !view.value.browsing) {
        shell.swap = true;
        await nextTick();
        requestAnimationFrame(() => {
          shell.swap = false;
          wave.value?.reset();
          if (panel.value && !narrow.value && !props.compact) {
            const p = panel.value,
              cs = getComputedStyle(p);
            p.animate(
              [
                {
                  height: "0px",
                  paddingTop: 0,
                  paddingBottom: 0,
                  borderTopWidth: 0,
                  opacity: 0,
                },
                {
                  height: `${p.offsetHeight}px`,
                  paddingTop: cs.paddingTop,
                  paddingBottom: cs.paddingBottom,
                  borderTopWidth: cs.borderTopWidth,
                  opacity: 1,
                },
              ],
              { duration: 420, easing: "cubic-bezier(0.16,1,0.3,1)" },
            );
          }
        });
      }
    } catch {
      /* A hidden or disposed stage does not invalidate a decoded result. */
    }
  });
}
onMounted(activate);
onActivated(activate);
watch(running, value => { if (!value) { pause(); shell.zoom = false; } else activate(); }, { flush: "post" });
onDeactivated(pause);
onBeforeUnmount(pause);
async function copy(value: unknown, label: string) {
  try {
    await navigator.clipboard.writeText(String(value ?? ""));
    ui.toast(`${label} 已复制`, "ok");
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
function scrollParams(event: WheelEvent) {
  if (event.ctrlKey || event.shiftKey || event.deltaX || !event.deltaY) return;
  const strip = event.currentTarget as HTMLElement,
    unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1,
    next = Math.max(
      0,
      Math.min(
        strip.scrollWidth - strip.clientWidth,
        strip.scrollLeft + event.deltaY * unit,
      ),
    );
  if (next === strip.scrollLeft) return;
  event.preventDefault();
  strip.scrollLeft = next;
}
const seed = computed(() =>
  params.value.isComparison ? params.value.seedStart : params.value.seed,
);
const askId = computed(() => { void ask.libraryRevision.value; return current.value ? ask.labelFor(current.value.id) : null; });
</script>
<template>
  <section v-show="visible !== false" class="stage" :class="{ 'compact-stage': compact }">
    <div class="stage-status" role="status" aria-live="polite">
      <strong id="stageTitle">{{ view.title }}</strong
      ><span id="stageSub">{{ view.subtitle }}</span>
    </div>
    <div ref="viewport" class="viewport" id="viewport" :style="frameStyle">
      <div class="stage-presentation" :class="{ 'with-history': historyVisible }">
        <div ref="historyHost" v-show="historyVisible" class="history-slot"></div>
        <div class="stage-layers">
      <div class="layer center" data-layer="empty">
        <EmptyStage :viewport="viewport" />
      </div>
      <div class="layer center" data-layer="busy">
        <WaveHost :active="running" ref="wave" class="print skeleton" id="skeleton" />
        <div class="skeleton-info sr-only">
          <p ref="timer" class="mono" id="timer">0.0s</p>
          <p class="skeleton-note">
            {{
              view.pending
                ? `${view.pending.width}×${view.pending.height} · 第 ${view.pending.index} 张`
                : ""
            }}
          </p>
        </div>
      </div>
      <div class="layer center" data-layer="error">
        <div class="blank">
          <AppIcon class="ico-xl err" name="i-alert" />
          <p class="blank-s" id="errBody">{{ view.error }}</p>
          <button
            class="btn btn-quiet btn-sm"
            id="retryBtn"
            type="button"
            @click="drawing.run"
          >
            <AppIcon name="i-retry" />重试
          </button>
          <button class="btn btn-quiet btn-sm ask-why" type="button" @click="ask.show({ question: '为什么这次生成失败？' })"><AskMark />Ask Why</button>
        </div>
      </div>
      <div class="layer center" data-layer="image">
        <figure class="print" id="print">
          <img
            v-if="current"
            id="image"
            :src="drawing.url(current)"
            :alt="current.params.tool === 'manual-edit' ? '手动编辑结果' : '生成结果'"
            decoding="async"
            @click="shell.zoom = true"
          />
        </figure>
      </div>
        </div>
      </div>
      <Teleport v-if="compact && visible !== false && view.state === 'done' && actionsTarget" :to="actionsTarget">
        <ImageResultActions :item="current" compact legacy-ids />
      </Teleport>
    </div>
    <footer
      v-if="!compact"
      ref="panel"
      class="result-panel"
      id="resultPanel"
      aria-label="图片信息"
    >
      <div class="result-copy">
        <strong class="result-title" id="resultModel">{{
          params.modelName || params.model || "结果"
        }}</strong
        ><span class="result-file mono" id="resultName">{{
          current ? imageFileName(current) : ""
        }}</span>
      </div>
      <div class="result-bottom">
        <div
          class="result-params"
          role="group"
          aria-label="生成参数"
          tabindex="0"
          @wheel="scrollParams"
        >
          <button v-if="askId" class="result-param result-ask-id" type="button" title="复制图片 ID" @click="copy(askId, '图片 ID')">{{ askId }}</button>
          <span v-if="current && !current.blob" class="result-param" title="原图已释放；可查看缩略图、对照及恢复配方">仅缩略图</span>
          <button
            v-if="params.tool !== 'manual-edit' && params.tool !== 'director'"
            class="result-param result-seed"
            id="resultSeed"
            type="button"
            title="复制 Seed"
            :disabled="seed == null"
            @click="copy(seed, 'Seed')"
          >
            <i>Seed</i>
            {{
              params.isComparison ? (seed != null ? `${seed}+` : "多个") : seed
            }}</button
          ><span class="result-param"
            >{{ params.width || current?.size.width }}×{{
              params.height || current?.size.height
            }}</span
          ><span
            v-for="(label, key) in {
              steps: '步数',
              scale: 'Guidance',
              cfgRescale: 'Rescale',
            }"
            :key="key"
            class="result-param"
            :hidden="params[key] == null"
            ><i>{{ label }}</i> {{ params[key] }}</span
          ><span class="result-param" :hidden="!params.sampler">{{
            samplerName(params.sampler)
          }}</span
          ><span class="result-param" :hidden="!params.transparentBg"
            >透明底</span
          >
        </div>
        <ImageResultActions :item="current" legacy-ids />
      </div>
    </footer>
  </section>
  <Teleport to="body"
    ><div
      class="lightbox"
      id="lightbox"
      :hidden="!shell.zoom"
      @click.self="shell.zoom = false"
    >
      <img
        v-if="shell.zoom && current"
        id="lightboxImg"
        :src="drawing.url(current)"
        alt="放大查看"
      /><button class="btn lightbox-annotate" :disabled="!current?.blob" @click="annotate"><AppIcon name="i-annotate" />批注</button><button
        class="ibtn lightbox-x"
        type="button"
        aria-label="关闭"
        @click="shell.zoom = false"
      >
        <AppIcon name="i-close" />
      </button></div
  ></Teleport>
</template>
<style scoped>
.lightbox-annotate { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); }
.result-panel { position: relative; }
.compact-stage { grid-template-rows: minmax(0, 1fr); background: transparent; }
/* History owns its scrolling; its content must not enlarge the preview's grid row. */
.compact-stage .viewport { grid-template-rows: minmax(0, 1fr); padding: 16px 24px; background: transparent; }
.compact-stage .print img { width: var(--fit-w); height: var(--fit-h); object-fit: contain; }
.stage-presentation, .stage-layers { display: contents; }
.stage-presentation.with-history { display: grid; grid-template-columns: 72px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 4px; width: calc(var(--display-w) + 76px); height: 100%; min-height: 0; }
.with-history .stage-layers { display: grid; min-width: 0; min-height: 0; }
.history-slot { min-width: 0; min-height: 0; }
.result-ask-id { color: var(--a); background: var(--result-id-bg); }
.result-ask-id:hover { background: var(--hover); }
.ask-why { margin-top: 8px; color: var(--a); }
/* A narrow stage keeps its width for the parameters; Ask returns to the title row. */
@container image-stage (max-width: 640px) {
  .stage:not(.compact-stage) .result-copy { padding-right: 90px; }
  .stage:not(.compact-stage) :deep(.result-group-ask) { position: absolute; top: 10px; right: 12px; }
  .stage:not(.compact-stage) :deep(.result-group-ask + .result-group)::before { display: none; }
  .stage:not(.compact-stage) :deep(.result-ask) { height: 32px; }
}
</style>
