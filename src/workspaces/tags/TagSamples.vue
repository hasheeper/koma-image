<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAsk } from "../../app/ask";
import { useServices } from "../../app/services";
import { message } from "../../app/ui";
import { SAMPLE_TIERS, postUrl, postsUrl, sampleMark, samplesQuery } from "../../domain/tag-samples.ts";
import type { SampleTier, TagSample } from "../../domain/tag-samples.ts";
import { promptTag } from "../../domain/tags.ts";
import AppIcon from "../../shared/AppIcon.vue";
/** Danbooru's top posts for one artist or character, hung under its card. */
const props = defineProps<{ name: string; kind: "artist" | "character"; tier: SampleTier; card: HTMLElement }>();
const emit = defineEmits<{ close: [refocus: boolean] }>();
const { tags } = useServices(), ask = useAsk();
const root = shallowRef<HTMLElement | null>(null),
  rows = shallowRef<TagSample[] | null>(null),
  failure = shallowRef(""),
  up = shallowRef(false),
  pending = shallowRef<ReadonlySet<number>>(new Set());
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = (request = new AbortController()), tier = props.tier;
  rows.value = null;
  failure.value = "";
  try {
    const found = await tags.samples(props.name, tier, controller.signal);
    if (!controller.signal.aborted) rows.value = found.slice(0, 4);
  } catch (error) {
    if (!controller.signal.aborted) failure.value = message(error);
  }
}
// Under the card with right edges level, or left edges when that runs off the
// viewport; above it when the viewport runs out below.
function place() {
  const el = root.value;
  if (!el || !props.card.isConnected) return;
  const card = props.card.getBoundingClientRect(), gap = 4, edge = 12;
  const { clientWidth: vw, clientHeight: vh } = document.documentElement;
  const { offsetWidth: w, offsetHeight: h } = el;
  up.value = card.bottom + gap + h > vh - edge && card.top - gap - h > edge;
  const x = card.right - w < edge ? card.left : card.right - w;
  el.style.left = `${Math.round(Math.min(Math.max(edge, x), vw - w - edge))}px`;
  el.style.top = `${Math.round(up.value ? card.top - gap - h : card.bottom + gap)}px`;
}
// Into the ASK tray with its tags; the user sends it from the composer.
async function send(sample: TagSample) {
  if (pending.value.has(sample.id)) return;
  pending.value = new Set(pending.value).add(sample.id);
  ask.show();
  try { await ask.addPost(sample.id); }
  finally {
    const next = new Set(pending.value);
    next.delete(sample.id);
    pending.value = next;
  }
}
const aspect = (sample: TagSample) =>
  sample.width && sample.height ? { "--ar": String(Math.min(1.6, Math.max(0.6, sample.width / sample.height))) } : undefined;
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (!root.value?.contains(target)) emit("close", false);
}
const controller = new AbortController(), observer = new ResizeObserver(place);
onMounted(() => {
  place();
  if (root.value) observer.observe(root.value);
  window.addEventListener("scroll", place, { capture: true, passive: true, signal: controller.signal });
  window.addEventListener("resize", place, { signal: controller.signal });
  document.addEventListener("pointerdown", outside, { capture: true, signal: controller.signal });
});
onBeforeUnmount(() => { request?.abort(); controller.abort(); observer.disconnect(); });
watch(() => [props.name, props.tier], load, { immediate: true });
</script>
<template>
  <div id="tagSamples" ref="root" class="tag-samples" :data-up="up || undefined" role="dialog" :aria-label="`${promptTag(name)} 的示例图`" :aria-busy="!rows && !failure">
    <div v-if="failure" class="tag-samples-note tag-samples-failure" role="status">
      <span>{{ failure }}</span><a class="tag-samples-retry" :href="postsUrl(samplesQuery(name, tier))" target="_blank" rel="noopener noreferrer">打开原站</a><button class="tag-samples-retry" type="button" @click="load">重试</button>
    </div>
    <p v-else-if="rows && !rows.length" class="tag-samples-note" role="status">
      {{ kind === "artist" ? "这位画师" : "这个角色" }}在 Danbooru 上没有{{ tier === "g" ? "全年龄" : "可显示的" }}作品
    </p>
    <template v-else>
      <div class="tag-samples-tiles">
        <template v-if="rows">
          <div v-for="sample in rows" :key="sample.id" class="tag-samples-tile" :style="aspect(sample)">
            <a :href="postUrl(sample.id)" target="_blank" rel="noopener noreferrer" :aria-label="`在 Danbooru 打开 #${sample.id}（新标签页）`"
              ><img :src="tags.imageUrl(sample.src)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a
            ><span v-if="sampleMark(sample)" class="tag-samples-mark">{{ sampleMark(sample) }}</span
            ><button class="tag-samples-ask" type="button" :disabled="pending.has(sample.id)" :aria-label="`把 #${sample.id} 发给 ASK`" @click="send(sample)">
              {{ pending.has(sample.id) ? "添加中…" : "发给 ASK" }}
            </button>
          </div>
        </template>
        <template v-else><i v-for="n in 4" :key="n" aria-hidden="true"></i></template>
      </div>
      <div class="tag-samples-bar">
        <span>Danbooru · {{ SAMPLE_TIERS[tier].label }}</span
        ><a class="ibtn ibtn-xs" :href="postsUrl(samplesQuery(name, tier))" target="_blank" rel="noopener noreferrer" data-tip="在 Danbooru 查看更多" aria-label="在 Danbooru 查看更多（新标签页）"><AppIcon name="tag-i-external" /></a>
      </div>
    </template>
  </div>
</template>
<style scoped>
/* Menu material and geometry: 4px inset, 12/8 concentric radii, 4px off the card. */
.tag-samples { position: fixed; z-index: var(--z-pop); min-width: 276px; max-width: min(520px, calc(100vw - 24px)); padding: 4px; background: var(--menu-bg); border: 1px solid var(--menu-line); border-radius: 12px; box-shadow: var(--sh-3), var(--sh-lip); backdrop-filter: var(--menu-backdrop); animation: tagSamplesIn var(--t1) var(--e-out); }
.tag-samples[data-up] { animation-name: tagSamplesUp; }
@keyframes tagSamplesIn { from { opacity: 0; transform: translateY(-4px); } }
@keyframes tagSamplesUp { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .tag-samples, .tag-samples[data-up] { animation-name: tagSamplesFade; } @keyframes tagSamplesFade { from { opacity: 0; } } }
/* One row at the posts' own proportions and one height; past the width cap the tiles share the squeeze. */
.tag-samples-tiles { display: flex; gap: 4px; }
.tag-samples-tiles > * { position: relative; display: block; flex: 0 1 auto; min-width: 0; height: 148px; aspect-ratio: var(--ar, .75); overflow: hidden; background: var(--hover); border-radius: 8px; }
.tag-samples-tile > a { display: block; height: 100%; border-radius: inherit; }
.tag-samples-tiles img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform var(--t2) var(--e); }
.tag-samples-tile:hover img { transform: scale(1.03); }
.tag-samples-tile > a:focus-visible { outline: 2px solid var(--focus-line); outline-offset: -2px; }
/* Glass on the picture: the rating mark and the hover-revealed 发给 ASK share one recipe. */
.tag-samples-mark, .tag-samples-ask { position: absolute; color: #fff; background: rgb(16 16 20 / .28); box-shadow: inset 0 0 0 .5px rgb(255 255 255 / .28); backdrop-filter: blur(8px) saturate(1.4); }
.tag-samples-mark { top: 6px; left: 6px; height: 16px; padding: 0 4px; font: var(--fw-semibold) 10px/16px var(--mono); letter-spacing: .02em; border-radius: 4px; pointer-events: none; }
.tag-samples-ask { bottom: 6px; left: 50%; height: 24px; padding: 0 8px; font-size: var(--fz-2xs); font-weight: var(--fw-semibold); white-space: nowrap; border-radius: 6px; opacity: 0; transform: translateX(-50%); transition: opacity var(--t1) var(--e), background var(--t1) var(--e); }
.tag-samples-tile:hover .tag-samples-ask, .tag-samples-ask:focus-visible, .tag-samples-ask:disabled { opacity: 1; }
.tag-samples-ask:hover:not(:disabled) { background: rgb(16 16 20 / .48); }
.tag-samples-ask:disabled { cursor: default; }
@media (hover: none) { .tag-samples-ask { opacity: 1; } }
.tag-samples-bar { display: flex; align-items: center; gap: 8px; height: 28px; margin-top: 4px; padding-left: 6px; }
.tag-samples-bar span { flex: 1; min-width: 0; overflow: hidden; color: var(--fg-3); font-size: var(--fz-2xs); text-overflow: ellipsis; white-space: nowrap; }
.tag-samples-bar .ibtn { --ico: var(--ico-sm); }
.tag-samples-bar [data-tip]::after { left: auto; right: 0; transform: translate(0, -3px); }
.tag-samples-bar [data-tip]:hover::after { transform: translate(0, 0); }
.tag-samples-note { display: flex; align-items: center; justify-content: center; gap: 4px; min-height: 64px; margin: 0; padding: 0 16px; color: var(--fg-3); font-size: var(--fz-xs); text-align: center; }
.tag-samples-failure { flex-wrap: wrap; padding-block: 12px; }
.tag-samples-failure > span { flex-basis: 100%; }
.tag-samples-retry { height: 24px; padding: 0 6px; color: var(--a); font-size: var(--fz-2xs); border-radius: var(--r1); }
.tag-samples-retry:hover { background: var(--hover); }
</style>
