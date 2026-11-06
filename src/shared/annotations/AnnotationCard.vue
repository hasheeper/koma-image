<script setup lang="ts">
import { nextTick, shallowRef, useId } from 'vue';
import type { RegionAnnotation } from '../../domain/region-annotation.ts';
import AppIcon from '../AppIcon.vue';
import { usePopover } from '../ui/use-popover.ts';

const props = defineProps<{ regions: readonly RegionAnnotation[]; preview?: string; sent?: boolean; dim?: boolean; disabled?: boolean; inline?: boolean; singleImage?: boolean; returnEdit?: boolean }>();
const emit = defineEmits<{ comment: [key: string, text: string]; remove: []; mode: [single: boolean]; edit: [] }>();
const open = shallowRef(false), host = shallowRef<HTMLElement>(), panel = shallowRef<HTMLElement>(), id = useId();
const shapes = { point: ['i-annotation-point', '点'], rect: ['i-select-rect', '矩形'], ellipse: ['i-select-ellipse', '椭圆'], polygon: ['i-select-polygon', '多边形'] } as const;
const popover = usePopover(panel, {
  position() {
    const anchor = host.value?.getBoundingClientRect(), el = panel.value;
    if (!anchor || !el) return;
    el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, anchor.left))}px`;
    el.style.top = `${Math.max(8, anchor.top >= el.offsetHeight + 12 ? anchor.top - el.offsetHeight - 6 : Math.min(innerHeight - el.offsetHeight - 8, anchor.bottom + 6))}px`;
  }, resize: 'place', observe: () => [host.value, panel.value], visualViewport: true,
  onClose() { open.value = false; },
});
async function toggle() {
  if (props.inline) { open.value = !open.value; return; }
  if (open.value) { popover.close(); open.value = false; return; }
  open.value = true; await nextTick(); panel.value?.showPopover(); panel.value?.focus({preventScroll:true});
}
function commit(event: Event, r: RegionAnnotation) {
  const text = (event.target as HTMLTextAreaElement).value;
  if (text !== r.comment) emit('comment', r.key, text);
}
function key(event: KeyboardEvent, r: RegionAnnotation) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); commit(event, r); panel.value?.focus({preventScroll:true}); }
}
</script>

<template>
  <section ref="host" class="annotation-card" :class="{ inline, sent, dim }" aria-label="批注附件">
    <div class="annotation-card-head">
      <button type="button" class="annotation-card-open" :aria-expanded="open" :aria-controls="id" :aria-haspopup="inline ? undefined : 'dialog'" aria-label="展开或收起批注列表" @click="toggle">
        <img v-if="preview" :src="preview" alt="" /><AppIcon v-else name="i-annotate" />
        <strong>批注</strong><span class="annotation-card-count">{{ regions.length }}</span><AppIcon name="i-chevron" class="annotation-card-arrow" :class="{ open }" />
      </button>
      <div v-if="inline && !sent" class="seg" role="group" aria-label="指示方式">
        <button type="button" :aria-pressed="!singleImage" :disabled="disabled" title="发送原图和编号定位图" @click="emit('mode', false)">双图</button>
        <button type="button" :aria-pressed="!!singleImage" :disabled="disabled" title="发送原图和方位文字" @click="emit('mode', true)">仅文字</button>
      </div>
      <button v-if="!sent" type="button" class="ibtn" aria-label="移除批注" :disabled="disabled" @click="emit('remove')"><AppIcon name="i-close" /></button>
    </div>
    <div v-if="open" :id="id" ref="panel" class="annotation-card-panel" :class="{ inline }" :popover="inline ? undefined : 'auto'" :role="inline ? undefined : 'dialog'" aria-label="批注列表" tabindex="-1" @keydown.esc.stop.prevent="popover.close(); open = false; host?.querySelector<HTMLButtonElement>('button')?.focus()" @beforetoggle="popover.beforeToggle" @toggle="popover.toggled">
      <div class="annotation-card-list">
        <div v-for="(r, i) in regions" :key="r.key" class="annotation-card-row">
          <span class="annotation-card-number">{{ i + 1 }}</span>
          <span v-if="sent" class="annotation-card-text">{{ r.comment || '（无文字）' }}</span>
          <textarea v-else :value="r.comment" :aria-label="`批注 ${i + 1}`" :disabled="disabled" rows="1" maxlength="2000" placeholder="添加批注…" @change="commit($event, r)" @keydown="key($event, r)" />
          <AppIcon :name="shapes[r.shape][0]" :title="shapes[r.shape][1]" class="annotation-card-shape" />
        </div>
      </div>
      <button v-if="returnEdit && !sent" type="button" class="btn btn-quiet annotation-card-return" :disabled="disabled" @click="popover.close(); open = false; emit('edit')"><AppIcon name="i-edit" />回到 EDIT</button>
    </div>
  </section>
</template>

<style scoped>
.annotation-card { flex: none; align-self: start; max-width: 100%; color: var(--fg); background: var(--raised); border: 1px solid var(--line-2); border-radius: var(--r3); }
.annotation-card.inline { align-self: stretch; padding: 6px; border: 0; background: var(--well); }
.annotation-card-head { display: flex; align-items: center; gap: 6px; min-height: 38px; padding: 3px 4px; }
.inline .annotation-card-head { min-height: 32px; padding: 0; }
.annotation-card-open { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; padding: 0 4px 0 0; text-align: left; border-radius: var(--r2); }
.annotation-card-open img { flex: none; width: 28px; height: 28px; object-fit: cover; border-radius: var(--r1); }
.annotation-card.dim { border-style: dashed; }
.annotation-card.dim .annotation-card-open img { opacity: .4; filter: grayscale(1); }
.annotation-card-open strong { font-size: var(--fz-sm); font-weight: var(--fw-medium); white-space: nowrap; }
.annotation-card-count { padding: 0 5px; color: var(--fg-2); background: var(--hover); border-radius: var(--r1); font: var(--fz-2xs)/18px var(--mono); }
.annotation-card-arrow { --ico: var(--ico-xs); color: var(--fg-3); rotate: 90deg; }
.annotation-card-arrow.open { rotate: -90deg; }
.annotation-card-head .ibtn { flex: none; width: 28px; height: 28px; --ico: var(--ico-sm); }
.annotation-card-head .seg { flex: none; padding: 2px; border: 0; box-shadow: none; }
.annotation-card-head .seg button { padding: 3px 8px; font-size: var(--fz-xs); border-radius: var(--r1); white-space: nowrap; }
.annotation-card-panel { width: min(320px, calc(100vw - 24px)); margin: 0; padding: 6px; border: 1px solid var(--line-2); border-radius: var(--r3); color: var(--fg); background: var(--raised); box-shadow: var(--sh-2); }
.annotation-card-panel.inline { width: auto; padding: 4px 0 0; border: 0; background: transparent; box-shadow: none; }
.annotation-card-list { max-height: min(240px, 45vh); overflow: auto; overscroll-behavior: contain; }
.annotation-card-row { display: flex; align-items: flex-start; gap: 8px; min-height: 32px; padding: 6px; }
.annotation-card-number { flex: none; min-width: 20px; border-radius: var(--r1); background: var(--a-dim); color: var(--a); font: var(--fw-medium) var(--fz-2xs)/20px var(--mono); text-align: center; }
.annotation-card-row textarea, .annotation-card-text { flex: 1; min-width: 0; padding: 0; margin: 0; border: 0; border-radius: 0; background: none; box-shadow: none; color: var(--fg); font: var(--fz-sm)/20px var(--sans); overflow-wrap: anywhere; white-space: pre-wrap; }
.annotation-card-row textarea { field-sizing: content; min-height: 20px; max-height: 100px; resize: none; }
.annotation-card-row textarea:focus { outline: none; box-shadow: 0 1px var(--a-line); }
.annotation-card-shape { flex: none; margin-top: 2px; --ico: var(--ico-sm); color: var(--fg-3); }
.annotation-card-return { margin-top: 4px; padding: 5px 8px; font-size: var(--fz-xs); --ico: var(--ico-sm); }
</style>
