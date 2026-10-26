<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useSlates } from "../app/slate.ts";
import { useAsk } from "../app/ask.ts";
import { useDrawing } from "../app/drawing.ts";
import { message } from "../app/ui.ts";
import AppIcon from "../shared/AppIcon.vue";
import { download } from "../shared/files.ts";
import { parseSlateEdit } from "./edit.ts";
import { assetReceipt } from "./documents.ts";
import { captionText } from "./captions.ts";
import type { Binding } from "./model.ts";
const props = defineProps<{ slateId: string; todoId: string; complete?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const slates = useSlates(), ask = useAsk(), { drawing } = useDrawing();
const dialog = shallowRef<HTMLDialogElement | null>(null), preview = shallowRef(''), source = shallowRef(''), error = shallowRef('');
const slate = computed(() => slates.get(props.slateId)), todo = computed(() => slate.value?.todos.find(t => t.id === props.todoId));
const pictures = ask.externalSnapshot().library, urls = new Map<string, string>();
for (const p of pictures) urls.set(p.label, URL.createObjectURL(p.blob));
const binding = computed(() => todo.value?.binding), selected = computed(() => pictures.find(p => p.label === source.value));
const captionKey = shallowRef('');
const captions = computed(() => {
  const params = selected.value?.params;
  const options: { key: string; label: string; caption: Binding['caption'] }[] = [];
  if (typeof params?.basePrompt === 'string') options.push({ key: 'base', label: '画板原文', caption: { source: 'base', mode: 'full' } });
  if (typeof params?.prompt === 'string') options.push({ key: 'sent', label: '实际发送', caption: { source: 'sent', mode: 'full' } });
  if (Array.isArray(params?.localCharacters)) for (const c of params.localCharacters) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    if (typeof c.id === 'string' && typeof c.prompt === 'string') options.push({ key: `character:${c.id}`, label: `角色 · ${typeof c.name === 'string' && c.name ? c.name : c.id}`, caption: { source: 'character', characterId: c.id, mode: 'full' } });
  }
  return options;
});
watch(source, () => { captionKey.value = ''; });
let version = 0;
const originalFocus = document.activeElement;
watch([source, binding], async () => {
  const token = ++version; if (preview.value) URL.revokeObjectURL(preview.value); preview.value = '';
  const blob = selected.value?.blob ?? (binding.value ? (await slates.asset(binding.value.assetId))?.blob : null);
  if (blob && token === version) preview.value = URL.createObjectURL(blob);
}, { immediate: true });
async function apply() {
  const base = slate.value, task = todo.value; if (!base || !task || slates.busy.value) return;
  try {
    const p = selected.value;
    const caption = captions.value.find(c => c.key === captionKey.value)?.caption;
    if (p && !caption) throw new Error('请选择标注来源');
    await slates.commit(parseSlateEdit({ kind: 'slate_edit', op: 'update', slate_id: base.id, expected_version: base.version, todos: [{ op: 'update', id: task.id,
      ...(props.complete ? { status: 'done' } : {}), ...(p && caption ? { bind: { source: p.label, caption_source: caption.source, caption_mode: caption.mode, ...(caption.characterId ? { character_id: caption.characterId } : {}) } } : {}) }] }, base, drawing.snapshot().form, pictures).change);
    emit('close');
  } catch (e) { error.value = message(e); }
}
async function exportAsset(kind: 'image' | 'receipt' | 'caption') {
  try {
    const b = binding.value, a = b ? await slates.asset(b.assetId) : null; if (!a || !b) throw new Error('成果不可用');
    const name = b.target_path.split('/').at(-1)!;
    download(kind === 'image' ? a.blob : new Blob([kind === 'receipt' ? JSON.stringify(assetReceipt(a), null, 2) : captionText(a, b.caption)], { type: kind === 'receipt' ? 'application/json' : 'text/plain' }), name + (kind === 'image' ? '' : kind === 'receipt' ? '.json' : '.txt'));
  } catch (e) { error.value = message(e); }
}
onMounted(async () => { await nextTick(); dialog.value?.showModal(); });
onBeforeUnmount(() => { version++; if (preview.value) URL.revokeObjectURL(preview.value); urls.forEach(url => URL.revokeObjectURL(url)); dialog.value?.close(); if (originalFocus instanceof HTMLElement && originalFocus.isConnected) originalFocus.focus({ preventScroll: true }); });
</script>
<template>
  <dialog ref="dialog" class="modal slate-delivery" aria-label="交付成果" @cancel.prevent="emit('close')" @keydown.stop @paste.stop @drop.prevent.stop>
    <header><b>交付成果</b><button class="ibtn" type="button" aria-label="关闭成果" @click="emit('close')"><AppIcon name="i-close" /></button></header>
    <p class="delivery-title">{{ todo?.title }}</p>
    <img v-if="preview" class="delivery-preview" :src="preview" alt="任务成果" />
    <div v-if="binding && !source" class="delivery-actions"><span>已交付</span><button class="ibtn" type="button" aria-label="下载原图" title="下载原图" @click="exportAsset('image')"><AppIcon name="i-download" /></button><button class="ibtn" type="button" aria-label="下载参数回执" title="参数回执" @click="exportAsset('receipt')"><AppIcon name="i-file" /></button><button class="ibtn" type="button" aria-label="下载标注文本" title="标注文本" @click="exportAsset('caption')"><AppIcon name="i-tags" /></button></div>
    <div class="delivery-pictures" aria-label="选择交付图片"><button v-for="p in pictures" :key="p.id" type="button" :aria-label="`选择 ${p.label}`" :aria-pressed="source === p.label" @click="source = p.label"><img :src="urls.get(p.label)" alt="" /><span>{{ p.label }}</span></button></div>
    <label v-if="source" class="delivery-caption"><span>标注来源</span><select v-model="captionKey" aria-label="标注来源"><option disabled value="">选择来源</option><option v-for="c in captions" :key="c.key" :value="c.key">{{ c.label }}</option></select></label>
    <p v-if="!pictures.length && !binding" class="delivery-empty">暂无可交付的图片</p>
    <p v-if="error" class="delivery-error" role="alert">{{ error }}</p>
    <footer v-if="source || complete"><button class="btn btn-quiet btn-sm" type="button" @click="emit('close')">取消</button><button class="btn btn-primary btn-sm" type="button" :disabled="slates.busy.value || (!source && !binding) || (!!source && !captionKey)" @click="apply">{{ complete ? '交付并完成' : '交付到任务' }}</button></footer>
  </dialog>
</template>
<style scoped>
.slate-delivery { --modal-w: 320px; max-height: min(620px, calc(100dvh - 32px)); overflow: auto; padding: 12px; }
.slate-delivery header { display: flex; align-items: center; justify-content: space-between; color: var(--fg); font-size: 13px; }
.delivery-title { margin: 6px 0 12px; color: var(--fg-2); font-size: 12px; }
.delivery-preview { display: block; width: 100%; max-height: 220px; object-fit: contain; background: var(--canvas); border-radius: var(--r2); }
.delivery-actions { display: flex; align-items: center; margin-top: 6px; }
.delivery-actions > span { flex: 1; color: var(--fg-3); font-size: 11px; }
.delivery-pictures { display: flex; gap: 8px; margin-top: 12px; overflow: auto; }
.delivery-pictures button { flex: none; width: 54px; padding: 2px; color: var(--fg-3); font: 11px var(--mono); border: 1px solid transparent; border-radius: var(--r2); }
.delivery-pictures [aria-pressed="true"] { color: var(--a); border-color: var(--a); }
.delivery-pictures img { display: block; width: 48px; height: 56px; margin-bottom: 4px; object-fit: cover; border-radius: var(--r1); }
.delivery-caption { display: flex; align-items: center; gap: 12px; margin-top: 12px; color: var(--fg-3); font-size: 12px; }
.delivery-caption select { flex: 1; min-width: 0; font-size: 12px; }
.slate-delivery footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.delivery-empty, .delivery-error { margin-top: 12px; color: var(--fg-3); font-size: 12px; }
.delivery-error { color: var(--warn); }
</style>
