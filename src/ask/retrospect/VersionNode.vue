<script setup lang="ts">
import { isStaged } from './model.ts';
import type { RetrospectNode } from './model.ts';
import type { ReviewPicture, GraphTool } from './view.ts';
import { computed } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import { recipeWorkspace } from './recipe.ts';
import { recipeDiff } from './diff.ts';

const props = defineProps<{ node: RetrospectNode; fresh?: boolean; cursor?: boolean; generating?: boolean; restoreDisabled?: boolean; final?: boolean; onFinalPath?: boolean; picture: ReviewPicture; backs: readonly ReviewPicture[]; selected: boolean; baseline: boolean; summary: string; note?: string; picked: boolean; tool: GraphTool }>();
const emit = defineEmits<{ select: [event: MouseEvent]; open: []; sample: [id: string]; restore: [] }>();
const workshop = computed(() => recipeWorkspace(props.node.recipe) !== 'image');
const rejected = computed(() => props.node.delivery?.samples[props.picture?.id ?? props.node.cover]?.kind === 'rejected');
const staged = computed(() => isStaged(props.node));
const scopes = computed(() => {
  if (!isStaged(props.node)) return '';
  const d = recipeDiff(props.node.staged.baseRecipe, props.node.recipe);
  return [d.texts.some(t => t.changed && !t.key.startsWith('c')) && '提示词', [...d.texts.filter(t => t.changed), ...d.parameters].some(t => t.key.startsWith('c')) && '角色', d.parameters.some(p => !p.key.startsWith('c')) && '参数'].filter(Boolean).join(' · ') || '完整配方';
});
const index = computed(() => Math.max(0, props.node.image_ids.indexOf(props.picture?.id ?? props.node.cover)));
const multiple = computed(() => props.node.image_ids.length > 1);
const position = computed(() => `${index.value + 1}/${props.node.image_ids.length}`);
const imageLabel = computed(() => staged.value ? `${props.node.id} ${props.node.label}，${props.generating ? '生成中' : props.cursor ? '已载入画板' : '待生成预设'}` : `${props.node.id} ${props.node.label}，${props.node.image_ids.length} 张，当前 ${props.picture?.id}${props.note ? '，有批注' : ''}`);
const hint = computed(() => props.note || [props.summary, props.tool === 'annotate' ? '点击批注' : `拖动摆放，${staged.value ? '点击查看配方' : '双击看大图'}，Shift 点击设为对比基准`].join(' · '));
function step(delta: number) {
  const id = props.node.image_ids[index.value + delta];
  if (id) emit('sample', id);
}
function keys(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowLeft' ? -1 : 1);
  }
}
</script>
<template>
  <article class="version-node" :class="{ staged, selected, baseline, picked, cursor, generating, fresh, final, 'final-path': onFinalPath }" :data-node="node.id" :data-kind="staged ? 'staged' : 'generated'" :data-sample="picture?.id" :aria-label="`${node.id} 配方节点`" @keydown="keys">
    <header class="node-meta" :title="[node.label, node.description].filter(Boolean).join(' · ')" @click="emit('select', $event)" @dblclick="emit('open')">
      <div class="node-meta-row">
        <strong class="node-version">{{ node.id }}</strong>
        <span class="node-label-space"><span class="node-label">{{ node.label }}</span></span>
      </div>
    </header>
    <div class="node-media">
      <button class="node-image" type="button" :aria-pressed="picked" :aria-label="imageLabel" :title="hint" @click="emit('select', $event)" @dblclick="emit('open')">
        <span v-for="(back, depth) in backs" :key="depth" class="node-back" :style="{ '--depth': depth + 1 }" aria-hidden="true"><img :src="back.url" alt="" draggable="false" /></span>
        <span class="node-front">
          <span v-if="staged" class="staged-content"><span class="staged-heading"><AppIcon name="i-file" /></span><span class="staged-description">{{ node.description || summary }}</span><span class="staged-scopes">{{ scopes }}</span></span><img v-else-if="picture.url" :src="picture.url" alt="" draggable="false" /><span v-else class="unavailable-image">原图已失效</span>
        </span>
      </button>
      <!-- Restore is independent of image selection, annotation and camera gestures. -->
      <button class="ibtn node-pin" type="button" data-node-control :disabled="restoreDisabled" :aria-label="workshop ? `定位 ${node.id} 原版本` : staged ? `载入 ${node.id} 预设到画板` : `从 ${node.id} 开始（恢复到画板）`" :aria-pressed="!!cursor" :title="workshop ? '定位原工作区版本' : staged ? '载入画板，手动生成后点亮此节点' : !picture.url || picture.parametersUnavailable ? '原记录已失效，无法恢复配方' : `${cursor ? '当前起点 · ' : ''}从这里开始（恢复到画板） · ${picture.id}`" @pointerdown.stop @click.stop="emit('restore')" @dblclick.stop><AppIcon :name="workshop ? 'i-expand' : 'i-pin'" /></button>
      <span v-if="note" class="node-note-dot" :title="note" aria-hidden="true"><AppIcon name="i-chat" /></span>
      <span v-if="cursor" class="node-origin-dot" aria-hidden="true"></span>
    </div>
    <div v-if="rejected || fresh || selected || baseline || final || multiple || picture?.thumbnailOnly || staged && (cursor || generating)" class="node-status-host">
      <div class="node-status" data-node-control @pointerdown.stop @click.stop @dblclick.stop>
        <span v-if="fresh || selected || baseline || final || staged && (cursor || generating)" class="node-flags">
          <span v-if="fresh" class="node-new" role="img" aria-label="新版本">NEW</span>
          <span v-if="selected || baseline" class="node-role node-mark">{{ selected ? 'B' : 'A' }}</span>
          <span v-if="staged && (cursor || generating)" class="node-loaded"><AppIcon :name="generating ? 'i-retry' : 'i-pin'" :class="{ spinning: generating }" />{{ generating ? '生成中' : '已载入' }}</span>
          <span v-if="final" class="node-final" title="定稿"><AppIcon name="i-check" /><span>定稿</span></span>
        </span>
        <span v-if="(fresh || selected || baseline || final) && multiple" class="node-status-separator" aria-hidden="true"></span>
        <span v-if="rejected" class="node-role" title="方向否定">否定</span>
        <span v-if="picture?.thumbnailOnly" class="node-role" title="原图已释放，完整配方已保留">缩略图</span>
        <div v-if="multiple" class="node-pager" role="group" :aria-label="`${node.id} 阶段样本`">
          <button class="ibtn sample-step" type="button" :aria-label="`${node.id} 上一张样本`" :disabled="index === 0" @click="step(-1)"><AppIcon name="i-back" /></button>
          <span class="sample-position" :title="`${picture?.id} · 第 ${index + 1} 张，共 ${node.image_ids.length} 张`" aria-live="polite" aria-atomic="true"><span class="sr-only">{{ node.id }} 样本 </span>{{ position }}</span>
          <button class="ibtn sample-step" type="button" :aria-label="`${node.id} 下一张样本`" :disabled="index === node.image_ids.length - 1" @click="step(1)"><AppIcon name="i-chevron" /></button>
        </div>
      </div>
    </div>
  </article>
</template>
<style scoped>
.version-node.staged { --node-edge: color-mix(in srgb, var(--fg) 32%, transparent); }
.staged .node-front { border: var(--node-ring) dashed var(--node-edge); background: var(--chrome); box-shadow: var(--print-shadow); }
.version-node.staged.cursor { --node-edge: var(--a); }
.staged-content { position: absolute; top: 50%; left: 50%; width: calc(100% / var(--node-ui-scale, 1)); height: calc(100% / var(--node-ui-scale, 1)); display: flex; align-items: stretch; flex-direction: column; gap: var(--sp-3); padding: var(--sp-4); transform: translate(-50%, -50%) scale(var(--node-ui-scale, 1)); text-align: left; color: var(--fg-2); container: staged-body / size; }
.staged-heading { display: flex; align-items: center; gap: var(--sp-2); flex: none; color: var(--fg-3); --ico: var(--ico-md); }
.staged-heading small { font-size: var(--fz-xs); }
.cursor .staged-heading > .ico { color: var(--a); }
.staged-description { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 3; -webkit-box-orient: vertical; font-size: var(--fz-sm); line-height: 1.65; }
.staged-scopes { margin-top: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-3); font-size: var(--fz-xs); }
.node-loaded .spinning { animation: staged-turn 1.6s linear infinite; }
@keyframes staged-turn { to { transform: rotate(360deg); } }
.node-loaded { display: inline-flex; gap: 4px; align-items: center; color: var(--a); font-size: var(--fz-2xs); white-space: nowrap; --ico: var(--ico-xs); }
@container staged-body (width < 130px) { .staged-description { -webkit-line-clamp: 2; font-size: var(--fz-xs); } .staged-scopes { display: none; } }
@container staged-body (height < 120px) { .staged-description { -webkit-line-clamp: 1; } .staged-scopes { display: none; } }
@container staged-body (width < 90px) { .staged-description, .staged-heading small, .staged-scopes { display: none; } .staged-heading { margin: auto; --ico: var(--ico-lg); } }
[data-detail-level="overview"] .staged-content { visibility: hidden; }

/* Scene positions are frame-exact, including when reduced motion sets a global duration. */
.version-node { position: absolute; transition: none; width: var(--node-width); height: var(--node-height); --node-edge: color-mix(in srgb, var(--fg) 18%, transparent); --node-ring: calc(1px / var(--graph-scale, 1)); --node-radius: min(calc(14px * var(--node-ui-scale, 1)), calc(var(--image-min) * .1)); }
.node-meta { position: absolute; left: 0; bottom: calc(100% - var(--node-meta-room) + 4px * var(--node-ui-scale, 1)); z-index: 3; width: calc(var(--node-width) / var(--node-ui-scale, 1)); height: 22px; transform: scale(var(--node-ui-scale, 1)); transform-origin: left bottom; container: node-meta / inline-size; cursor: pointer; user-select: none; }
.node-meta-row { display: flex; align-items: center; gap: 6px; height: 100%; min-width: 0; font-size: var(--fz-xs); color: var(--fg-3); }
.node-version { flex: none; display: flex; align-items: center; gap: 4px; color: var(--fg-2); font: var(--fw-medium) var(--fz-xs)/1 var(--mono); }
.cursor .node-version::before { content: ''; width: 4px; height: 4px; flex: none; border-radius: 50%; background: var(--a); }
.node-label-space { flex: 1; min-width: 0; container: node-title / inline-size; }
.node-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-role { flex: none; color: var(--fg-2); font: var(--fw-medium) var(--fz-xs)/1 var(--mono); }
.node-mark { text-box-trim: trim-both; text-box-edge: cap alphabetic; }
.selected .node-role { color: var(--a); }
.node-final { flex: none; display: inline-flex; align-items: center; gap: 2px; font-size: var(--fz-2xs); --ico: var(--ico-sm); }
.node-new { display: inline-flex; align-items: center; flex: none; color: var(--a); font: var(--fw-semibold) var(--fz-2xs)/1 var(--mono); letter-spacing: .06em; }
.node-pager { display: flex; align-items: center; flex: none; gap: 2px; }
.node-status-host { position: absolute; z-index: 3; right: calc((100% - var(--image-width)) / 2); top: calc(var(--node-meta-room) + var(--image-height) + var(--node-stack-room) + var(--node-status-gap, 4px) * var(--node-ui-scale, 1)); width: calc(var(--image-width) / var(--node-ui-scale, 1)); height: var(--node-status-height, 26px); transform: scale(var(--node-ui-scale, 1)); transform-origin: right top; container: node-status / inline-size; pointer-events: none; }
.node-status { display: flex; align-items: center; gap: var(--sp-2); width: max-content; max-width: 100%; height: 100%; margin-left: auto; padding: 0 2px 0 var(--sp-2); border: 1px solid var(--line-2); border-radius: var(--r2); background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); box-shadow: inset 0 1px 0 var(--glass-edge), var(--sh-1); color: var(--fg-2); user-select: none; pointer-events: auto; }
.node-status:not(:has(.node-flags)) { padding-left: 2px; }
.node-status:not(:has(.node-pager)) { padding-inline: var(--sp-2); }
.node-status-separator { flex: none; width: 1px; height: 12px; background: var(--line-2); }
.node-flags { display: inline-flex; align-items: center; flex: none; gap: var(--sp-2); }
.sample-position { min-width: 26px; text-align: center; color: var(--fg-3); font: var(--fz-2xs)/1 var(--mono); font-variant-numeric: tabular-nums; }
.sample-step { flex: none; width: 22px; height: 22px; border-radius: var(--r1); color: var(--fg-3); --ico: var(--ico-sm); }
.sample-step:hover:not(:disabled), .sample-step:focus-visible { background: var(--hover); color: var(--fg-2); }
.sample-step:focus-visible { outline: 1px solid var(--a); outline-offset: 1px; }
.sample-step:disabled { opacity: .3; cursor: default; }
.node-media { position: absolute; top: var(--node-meta-room); left: calc((100% - var(--image-width)) / 2); width: var(--image-width); height: var(--image-height); border-radius: var(--node-radius); }
.node-image { position: absolute; inset: 0; width: 100%; height: 100%; isolation: isolate; border-radius: inherit; text-align: left; cursor: pointer; }
.node-front { position: absolute; inset: 0; z-index: 2; isolation: isolate; overflow: hidden; border-radius: inherit; background: var(--canvas); box-shadow: 0 0 0 var(--node-ring) var(--node-edge), var(--print-shadow); }
.version-node:hover { --node-edge: var(--fg-3); }
.version-node.node-drag-active .node-front { box-shadow: 0 0 0 var(--node-ring) var(--node-edge), var(--sh-2); }
.version-node.final-path { --node-edge: color-mix(in srgb, var(--a) 65%, var(--line)); }
.version-node.picked { --node-edge: var(--fg-2); --node-ring: calc(1.5px / var(--graph-scale, 1)); }
.version-node.selected { --node-edge: var(--a); --node-ring: calc(1.5px / var(--graph-scale, 1)); }
.node-image:focus-visible { outline: none; }
.node-image:focus-visible .node-front { outline: calc(2px / var(--graph-scale, 1)) solid var(--fg-2); outline-offset: calc(3px / var(--graph-scale, 1)); }
.unavailable-image { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fg-3); font-size: var(--fz-xs); }
.node-front > img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; }
.node-back { position: absolute; inset: 0; z-index: calc(2 - var(--depth)); width: calc(100% - var(--depth) * 8%); margin-inline: auto; overflow: hidden; border-radius: inherit; background: var(--raised); transform: translateY(calc(var(--depth) * 6px)); transition: transform var(--t1) var(--e); pointer-events: none; box-shadow: 0 0 0 1px var(--line-2); }
.node-back img { width: 100%; height: 100%; object-fit: cover; object-position: center bottom; opacity: calc(.85 - var(--depth) * .2); }
.version-node:is(:hover, :focus-within) .node-back { transform: translateY(calc(var(--depth) * 6px + 2px)); }
.node-pin { --pin-size: min(calc(26px * var(--node-ui-scale, 1)), max(calc(22px / var(--graph-scale, 1)), calc(var(--image-min) * .28))); position: absolute; z-index: 3; top: calc(6px * var(--node-ui-scale, 1)); right: calc(6px * var(--node-ui-scale, 1)); width: var(--pin-size); height: var(--pin-size); border-radius: 999px; background: color-mix(in srgb, var(--media-surface) 74%, transparent); color: color-mix(in srgb, var(--media-ink) 80%, transparent); backdrop-filter: blur(8px); box-shadow: inset 0 0 0 calc(1px / var(--graph-scale, 1)) color-mix(in srgb, var(--media-ink) 10%, transparent); opacity: 0; pointer-events: none; --ico: var(--ico-md); }
.version-node:is(:hover, :focus-within) .node-pin { opacity: 1; pointer-events: auto; }
.node-pin :deep(svg) { width: 54%; height: 54%; }
.node-pin:hover:not(:disabled) { background: color-mix(in srgb, var(--media-surface) 90%, transparent); color: var(--media-ink); }
.node-pin:focus-visible { outline: calc(2px / var(--graph-scale, 1)) solid var(--media-accent); outline-offset: calc(2px / var(--graph-scale, 1)); }
.node-pin[aria-pressed="true"] { color: var(--media-accent); box-shadow: inset 0 0 0 calc(1px / var(--graph-scale, 1)) color-mix(in srgb, var(--media-accent) 60%, transparent); }
.node-pin:disabled { cursor: default; }
.version-node:is(:hover, :focus-within) .node-pin:disabled { opacity: .35; }
.node-note-dot { position: absolute; z-index: 3; left: calc(7px * var(--node-ui-scale, 1)); bottom: calc(7px * var(--node-ui-scale, 1)); width: 22px; height: 22px; display: grid; place-items: center; border-radius: 999px; background: color-mix(in srgb, var(--media-surface) 74%, transparent); color: var(--media-ink); transform: scale(var(--node-ui-scale, 1)); transform-origin: left bottom; --ico: var(--ico-sm); pointer-events: none; }
.node-origin-dot { display: none; position: absolute; z-index: 3; top: calc(4px / var(--graph-scale, 1)); left: calc(4px / var(--graph-scale, 1)); width: calc(5px / var(--graph-scale, 1)); height: calc(5px / var(--graph-scale, 1)); border-radius: 50%; background: var(--a); pointer-events: none; }
@container node-title (width < 4em) {
  .node-label { visibility: hidden; }
}
@container node-status (max-width: 200px) {
  .node-final span { display: none; }
}
@container node-status (max-width: 150px) {
  .sample-position { display: none; }
  .node-new { width: 5px; height: 5px; border-radius: 50%; background: var(--a); overflow: hidden; font-size: 0; }
}
@container node-status (max-width: 110px) {
  .node-loaded { font-size: 0; gap: 0; }
  .node-flags:has(.node-new, .node-role) .node-final { display: none; }
  .node-status { gap: var(--sp-1); padding-left: 6px; }
  .node-flags { gap: var(--sp-1); }
}
@container node-status (max-width: 80px) {
  .node-pager, .node-status-separator { display: none; }
  .node-status { padding-inline: var(--sp-1); }
  .node-status:not(:has(.node-flags)) { display: none; }
}
@container node-status (max-width: 30px) {
  .node-status { display: none; }
}
[data-detail-level="compact"] .node-meta { height: 16px; bottom: calc(100% - var(--node-meta-room) + 2px * var(--node-ui-scale, 1)); }
[data-detail-level="compact"] .node-label-space, [data-detail-level="compact"] .node-final span, [data-detail-level="compact"] .node-pager { display: none; }
[data-detail-level="compact"] .version-node:not(.selected, .baseline, .fresh, .final, .cursor, .generating) .node-status-host { display: none; }
[data-detail-level="compact"] .node-status { gap: var(--sp-1); padding-inline: var(--sp-1); border-radius: var(--r1); backdrop-filter: none; }
[data-detail-level="compact"] .node-status-separator { display: none; }
[data-detail-level="compact"] .node-new { width: 5px; height: 5px; border-radius: 50%; background: var(--a); overflow: hidden; font-size: 0; }
[data-detail-level="compact"] .node-note-dot { width: 5px; height: 5px; background: var(--media-ink); }
[data-detail-level="compact"] .node-note-dot :deep(svg) { display: none; }
[data-detail-level="overview"] .node-meta, [data-detail-level="overview"] .node-pin, [data-detail-level="overview"] .node-note-dot, [data-detail-level="overview"] .node-status-host { display: none; }
[data-detail-level="overview"] .node-origin-dot { display: block; }
@media (prefers-reduced-motion: reduce) {
  .node-back { transition: none; }
  .node-loaded .spinning { animation: none; }
  .version-node:is(:hover, :focus-within) .node-back { transform: translateY(calc(var(--depth) * 6px)); }
}
</style>
