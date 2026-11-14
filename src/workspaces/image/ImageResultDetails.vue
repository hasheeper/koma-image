<script setup lang="ts">
import { computed, shallowRef, useId, watch } from 'vue';
import type { HistoryRecord } from '../../domain/drawing';
import { imageFileName, samplerName } from '../../domain/drawing';
import { useAsk } from '../../app/ask';
import { message, useUi } from '../../app/ui';
import AppIcon from '../../shared/AppIcon.vue';
import { usePopover } from '../../shared/ui/use-popover';

const props = defineProps<{ item: HistoryRecord }>();
const ask = useAsk(), ui = useUi(), id = useId();
const trigger = shallowRef<HTMLButtonElement | null>(null), panel = shallowRef<HTMLElement | null>(null);
const label = computed(() => { void ask.libraryRevision.value; return ask.labelFor(props.item.id); });
const dimensions = computed(() => `${props.item.size.width}×${props.item.size.height}`);
const rows = computed(() => {
  const p = props.item.params, seed = p.isComparison ? p.seedStart : p.seed;
  return [
    { label: '图片 ID', value: label.value },
    { label: '型号', value: p.modelName || p.model },
    { label: '文件名', value: imageFileName(props.item) },
    { label: '尺寸', value: dimensions.value },
    ...(p.tool !== 'manual-edit' && p.tool !== 'director' ? [{ label: 'Seed', value: p.isComparison ? seed != null ? `${seed}+` : '多个' : seed }] : []),
    { label: '步数', value: p.steps },
    { label: 'Guidance', value: p.scale },
    { label: 'Rescale', value: p.cfgRescale },
    { label: '采样器', value: p.sampler ? samplerName(p.sampler) : null },
    { label: '透明底', value: p.transparentBg ? '开启' : null },
    { label: '原图', value: props.item.blob ? null : '仅保留缩略图' },
  ].filter(row => row.value != null && row.value !== '');
});
const popover = usePopover(panel, { position() {
  const button = trigger.value?.getBoundingClientRect(), el = panel.value;
  if (!button || !el) return;
  el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, button.left))}px`;
  el.style.top = `${Math.max(8, button.top - el.offsetHeight - 8)}px`;
}, resize: 'close', closeOnScroll: 'outside' });
watch(() => props.item.id, popover.close);
async function copy(value: unknown, name: string) {
  try { await navigator.clipboard.writeText(String(value)); ui.toast(`${name} 已复制`, 'ok'); }
  catch (error) { ui.toast(message(error), 'err'); }
}
</script>
<template>
  <button ref="trigger" class="result-summary" type="button" :popovertarget="id" :aria-expanded="popover.open.value" aria-label="图片参数">
    <AppIcon name="i-info" /><span class="result-size">{{ dimensions }}</span>
  </button>
  <div ref="panel" :id="id" class="result-details" popover="auto" role="dialog" aria-label="图片参数" @beforetoggle="popover.beforeToggle" @toggle="popover.toggled">
    <button v-for="row in rows" :key="row.label" type="button" class="detail-row" :aria-label="`复制 ${row.label}`" :title="String(row.value)" @click="copy(row.value, row.label)">
      <span class="detail-label">{{ row.label }}</span><span class="detail-value">{{ row.value }}</span><AppIcon name="i-copy" />
    </button>
  </div>
</template>
<style scoped>
.result-summary { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px; color: var(--fg-3); font: var(--fz-2xs) var(--mono); white-space: nowrap; border-radius: 999px; }
.result-summary .ico { --ico: var(--ico-sm); }
.result-summary:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--hover); }
.result-details { position: fixed; width: 320px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 96px); margin: 0; padding: 6px; overflow: auto; border: 1px solid var(--line-2); border-radius: 14px; color: var(--fg-2); background: var(--glass-pop-bg); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)); box-shadow: var(--glass-pop-shadow); }
.detail-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 6px 8px; border-radius: 8px; text-align: left; font-size: var(--fz-xs); }
.detail-row:hover { background: var(--hover); }
.detail-label { flex: 0 0 60px; color: var(--fg-3); }
.detail-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.detail-row .ico { flex: none; color: var(--fg-3); opacity: 0; --ico: var(--ico-sm); }
.detail-row:is(:hover, :focus-visible) .ico { opacity: 1; }
@container canvas-workspace (max-width: 820px) { .result-size { display: none; } .result-summary { padding-inline: 6px; } }
</style>
