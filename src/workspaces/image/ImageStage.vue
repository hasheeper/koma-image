<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  shallowRef,
  watch,
} from "vue";
import { useEditor } from "../../app/editor";
import { useServices } from "../../app/services";
import { createHandoff } from "../../services/handoff";
import { useDrawing } from "../../app/drawing";
import { useShell } from "../../app/shell";
import { useUi, message } from "../../app/ui";
import { imageFileName, samplerName } from "../../domain/drawing";
import AppIcon from "../../shared/AppIcon.vue";
import EmptyStage from "./EmptyStage.vue";
import WaveHost from "./WaveHost.vue";
import { useAsk, AskMark } from "../../app/ask";
const ask = useAsk();
const { drawing, view } = useDrawing(),
  { narrow, image: shell } = useShell(),
  ui = useUi();
const { editor } = useEditor();
const services = useServices();
const { router } = useShell();
async function resultAction(id: string) {
  const item = current.value;
  if (!item) return;
  try {
    if (id === "chatBtn") {
      const ticket = await createHandoff(services).queue(
        item.blob,
        imageFileName(item),
      );
      const url = new URL(location.href);
      url.searchParams.set("image", ticket);
      history.replaceState(history.state, "", url);
      router.switchWorkspace("chat");
      ui.imageDelivery.value++;
    } else
      await editor.open("image", item.blob, imageFileName(item), {
        mode: id === "upscaleBtn" ? "upscale" : "img2img",
        settings: item.params,
      });
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
const viewport = shallowRef<HTMLElement | null>(null),
  wave = shallowRef<InstanceType<typeof WaveHost> | null>(null),
  timer = shallowRef<HTMLElement | null>(null),
  panel = shallowRef<HTMLElement | null>(null);
const current = computed(() => view.value.current),
  params = computed(() => current.value?.params ?? {}),
  saved = computed(() =>
    view.value.favorites.some((r) => r.id === current.value?.id),
  );
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
  const width = Math.floor(vp.clientWidth - px),
    height = Math.floor(
      (narrow.value
        ? parseFloat(css.maxHeight) || vp.clientHeight
        : vp.clientHeight) - py,
    );
  if (width <= 0 || height <= 0) return;
  for (const [kind, size] of [
    ["fit", current.value?.size],
    ["sk", view.value.pending],
  ] as const) {
    if (!size) continue;
    const ratio = Math.min(width / size.width, height / size.height, 1);
    vp.style.setProperty(`--${kind}-w`, `${Math.floor(size.width * ratio)}px`);
    vp.style.setProperty(`--${kind}-h`, `${Math.floor(size.height * ratio)}px`);
  }
  if (narrow.value && view.value.state !== "empty") {
    const size =
      view.value.state === "busy" ? view.value.pending : current.value?.size;
    const h =
      view.value.state === "error"
        ? 320
        : size
          ? Math.min(height, (width * size.height) / size.width)
          : 320;
    vp.style.setProperty("--vp-h", `${Math.ceil(h + py)}px`);
  } else if (!narrow.value) vp.style.removeProperty("--vp-h");
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
onActivated(() => {
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
          if (panel.value && !narrow.value) {
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
});
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
function save() {
  if (!current.value) return;
  const a = document.createElement("a");
  a.href = drawing.url(current.value);
  a.download = imageFileName(current.value);
  a.click();
}
const seed = computed(() =>
  params.value.isComparison ? params.value.seedStart : params.value.seed,
);
const askId = computed(() => { void ask.libraryRevision.value; return current.value ? ask.labelFor(current.value.id) : null; });
function openAsk() {
  if (askId.value) ask.show({ anchor: askId.value });
}
</script>
<template>
  <section class="stage">
    <div class="stage-status" role="status" aria-live="polite">
      <strong id="stageTitle">{{ view.title }}</strong
      ><span id="stageSub">{{ view.subtitle }}</span>
    </div>
    <div ref="viewport" class="viewport" id="viewport">
      <div class="layer center" data-layer="empty">
        <EmptyStage :viewport="viewport" />
      </div>
      <div class="layer center" data-layer="busy">
        <WaveHost ref="wave" class="print skeleton" id="skeleton" />
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
            alt="生成结果"
            decoding="async"
            @click="shell.zoom = true"
          />
        </figure>
      </div>
    </div>
    <footer
      ref="panel"
      class="result-panel"
      id="resultPanel"
      aria-label="图片信息"
    >
      <button class="btn btn-quiet btn-sm result-ask" type="button" :disabled="!current" aria-label="Ask 这张图" @click="openAsk"><AskMark />Ask</button>
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
          <button
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
              scale: 'Scale',
              cfg: 'CFG',
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
        <div class="result-actions" role="group" aria-label="图片操作">
          <div class="result-group">
            <button
              v-for="action in [
                { id: 'editBtn', label: '编辑这张图', icon: 'i-edit' },
                { id: 'upscaleBtn', label: '放大这张图', icon: 'i-upscale' },
                { id: 'chatBtn', label: '在对话中改这张图', icon: 'i-chat' },
              ]"
              :key="action.id"
              :id="action.id"
              class="ibtn"
              type="button"
              :aria-label="action.label"
              :data-tip="action.label"
              :disabled="!current"
              @click="resultAction(action.id)"
            >
              <AppIcon :name="action.icon" />
            </button>
          </div>
          <div class="result-group">
            <button
              class="ibtn"
              id="reuseBtn"
              type="button"
              data-tip="复用参数"
              aria-label="复用参数"
              :hidden="params.tool === 'upscale'"
              @click="drawing.reuse"
            >
              <AppIcon name="i-reuse" /></button
            ><button
              class="ibtn"
              id="copyBtn"
              type="button"
              data-tip="复制 Tag"
              aria-label="复制 Tag"
              :hidden="!params.prompt"
              @click="copy(params.basePrompt ?? params.prompt, 'Tag')"
            >
              <AppIcon name="i-copy" />
            </button>
          </div>
          <div class="result-group">
            <button
              class="ibtn"
              id="favoriteBtn"
              type="button"
              :data-tip="saved ? '取消收藏' : '收藏'"
              :aria-label="saved ? '取消收藏' : '收藏图片'"
              :aria-pressed="saved"
              :disabled="
                view.favoritesLoading ||
                view.favoritePending.includes(current?.id || '')
              "
              @click="drawing.toggleFavorite()"
            >
              <AppIcon name="i-star" /></button
            ><button
              class="ibtn ibtn-accent"
              id="saveBtn"
              type="button"
              data-tip="下载"
              aria-label="下载"
              @click="save"
            >
              <AppIcon name="i-download" />
            </button>
          </div>
        </div>
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
      /><button
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
.result-panel { position: relative; }
.result-copy { padding-right: 90px; }
.result-ask { position: absolute; top: 10px; right: 12px; gap: 6px; color: var(--a); font-weight: var(--fw-semibold); }
.result-ask-id { color: var(--a); }
.ask-why { margin-top: 8px; color: var(--a); }
@media (max-width: 860px) {
  .result-ask { top: 5px; min-height: 40px; }
}
</style>
