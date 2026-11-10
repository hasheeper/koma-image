<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useTemplateRef } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import { usePopover } from '../../shared/ui/use-popover.ts';

import type { NoteTarget } from './view.ts';
const props = defineProps<{ target: NoteTarget; value: string; mixed: boolean }>();
const emit = defineEmits(['save', 'remove', 'close']);
const panel = useTemplateRef<HTMLElement>('panel'), field = useTemplateRef<HTMLTextAreaElement>('field');
const text = shallowRef(props.value ?? '');
const multiple = computed(() => props.target.items.length > 1);
const badge = computed(() => multiple.value ? props.target.items.length : props.target.items[0].kind === 'node' ? props.target.items[0].node.id : '→');
const description = computed(() => `${props.target.title}${props.mixed ? ' · 已有不同批注，提交后追加' : ''}`);
function place() {
  const el = panel.value, anchor = props.target.bounds(), host = props.target.viewport;
  if (!el || !anchor || !host) return;
  const room = host.getBoundingClientRect(), toolbar = host.parentElement?.querySelector('.graph-tools')?.getBoundingClientRect();
  const left = Math.max(8, room.left + 8), right = Math.min(innerWidth - 8, room.right - 8);
  const top = Math.max(8, room.top + 8), bottom = Math.min(innerHeight - 8, toolbar ? toolbar.top - 8 : room.bottom - 8);
  const x = (anchor.left + anchor.right - el.offsetWidth) / 2;
  const below = !multiple.value && props.target.items[0].kind === 'node';
  let y = below ? anchor.bottom + 8 : anchor.top - el.offsetHeight - 8;
  if (y + el.offsetHeight > bottom) y = anchor.top - el.offsetHeight - 8;
  if (y < top) y = anchor.bottom + 8;
  el.style.left = `${Math.max(left, Math.min(x, right - el.offsetWidth))}px`;
  el.style.top = `${Math.max(top, Math.min(y, bottom - el.offsetHeight))}px`;
}
function resize() {
  if (!field.value) return;
  field.value.style.height = 'auto';
  field.value.style.height = `${Math.min(80, Math.max(20, field.value.scrollHeight))}px`;
  place();
}
const popover = usePopover(panel, { position: place, resize: 'place', observe: () => [panel.value, props.target.viewport], visualViewport: true,
  onOpen() { field.value?.focus(); }, onClose() { emit('close', props.target.key); } });
function close() { popover.close(); props.target.viewport?.focus({ preventScroll: true }); }
function save() { emit('save', text.value); }
function remove() { emit('remove'); }
function keys(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save(); }
}
onMounted(async () => { await nextTick(); panel.value?.showPopover(); resize(); });
</script>
<template>
  <section ref="panel" class="annotation-comment" popover="auto" role="dialog" :aria-label="`${target.title} 批注`" @beforetoggle="popover.beforeToggle" @toggle="popover.toggled" @keydown="keys" @pointerdown.stop @wheel.stop>
    <span class="annotation-badge" :title="description">{{ badge }}</span>
    <textarea ref="field" v-model="text" aria-label="批注内容" :placeholder="multiple ? '添加共同批注…' : '添加批注…'" :title="description" maxlength="2000" rows="1" @input="resize"></textarea>
    <button type="button" class="ibtn annotation-delete" aria-label="删除当前批注" :title="mixed ? '请单独选择对象删除不同批注' : '删除当前批注'" :disabled="mixed || !text.trim() && !value" @pointerdown.prevent @click="remove"><AppIcon name="i-trash" /></button>
    <button type="button" class="ibtn annotation-save" :aria-label="multiple ? `保存 ${target.items.length} 项批注` : '保存批注'" title="完成 · Enter" :disabled="multiple && !text.trim()" @pointerdown.prevent @click="save"><AppIcon name="i-check" /></button>
  </section>
</template>
<style scoped>
/* RegionAnnotator's inline editor; only positioning belongs to the graph. */
.annotation-comment { position: fixed; inset: auto; margin: 0; width: min(248px, calc(100vw - 16px)); padding: 4px 4px 4px 8px; border: 0; border-radius: var(--r3); background: var(--raised); color: var(--fg); box-shadow: 0 0 0 1px var(--line-2), var(--sh-1); }
.annotation-comment:popover-open { display: flex; align-items: flex-start; gap: 8px; }
.annotation-badge { flex: none; min-width: 20px; margin: 4px 0; padding-inline: 2px; border-radius: var(--r1); color: var(--a); background: var(--a-dim); font: var(--fw-medium) var(--fz-2xs)/20px var(--mono); text-align: center; }
.annotation-comment textarea { flex: 1; min-width: 0; min-height: 20px; max-height: 80px; margin: 4px 0; padding: 0; resize: none; background: none; border: 0; border-radius: 0; outline: none; color: var(--fg); font: var(--fz-sm)/20px var(--sans); box-shadow: none; }
.annotation-comment:focus-within { box-shadow: 0 0 0 1px var(--a-line), var(--sh-1); }
.annotation-comment .ibtn { flex: none; width: 28px; height: 28px; --ico: var(--ico-sm); }
.annotation-save { color: var(--a); }
.annotation-delete:hover:not(:disabled) { color: var(--err); }
</style>
