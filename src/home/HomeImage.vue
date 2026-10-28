<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { useHome } from '../app/home.ts';
import { useDrawing } from '../app/drawing.ts';
import { useEditor } from '../app/editor.ts';
import { useAsk } from '../app/ask.ts';
import { useSlates } from '../app/slate.ts';
import { useShell } from '../app/shell.ts';
import { useServices } from '../app/services.ts';
import { useUi, message } from '../app/ui.ts';
import { createHandoff } from '../services/handoff.ts';
import type { Fields } from '../storage/records.ts';
import { sourceRecipe } from '../domain/image-parameters.ts';
import { imageFileName, reuseFields } from '../domain/drawing.ts';
import AppIcon from '../shared/AppIcon.vue';
import AskMenu from '../ask/AskMenu.vue';
import SlateDeliverable from '../slate/SlateDeliverable.vue';
const props = defineProps<{ recordId: string }>(), emit = defineEmits<{ close: [] }>();
const { home, view } = useHome(), { drawing, view: drawings } = useDrawing(), { editor } = useEditor(), ask = useAsk(), slates = useSlates(), { router } = useShell(), services = useServices(), ui = useUi();
const dialog = shallowRef<HTMLDialogElement | null>(null), busy = shallowRef(false), delivery = shallowRef<{ slateId: string; todoId: string } | null>(null);
const record = computed(() => drawings.value.favorites.find(f => f.id === props.recordId));
const info = computed(() => view.value.finals.find(f => f.recordId === props.recordId));
const label = computed(() => { void ask.libraryRevision.value; return ask.favoriteLabelFor(props.recordId); });
const validLine = computed(() => info.value?.line && view.value.allLines.some(l => l.id === info.value!.line) ? info.value.line : null);
const pinned = computed(() => !!validLine.value && view.value.preferences.covers[validLine.value] === props.recordId);
const originalFocus = document.activeElement;
async function action(kind: 'image' | 'chat' | 'edit' | 'cover' | 'remove') {
  const item = record.value; if (!item || busy.value) return;
  busy.value = true;
  try {
    if (kind === 'cover' && validLine.value) { await home.setCover(validLine.value, pinned.value ? null : item.id); ui.toast(pinned.value ? '已设置封面' : '已恢复最近图片', 'ok'); return; }
    if (kind === 'remove') { await drawing.toggleFavorite(item); emit('close'); return; }
    if (kind === 'image') {
      if (!info.value?.canRestore) return;
      router.switchWorkspace('image'); drawing.apply(reuseFields({ params: sourceRecipe(item.params) as Fields })); drawing.show(item, true);
    } else if (kind === 'chat') {
      const ticket = await createHandoff(services).queue(item.blob, imageFileName(item));
      const url = new URL(location.href); url.searchParams.set('image', ticket); history.replaceState(history.state, '', url);
      router.switchWorkspace('chat'); ui.imageDelivery.value++;
    } else {
      emit('close'); await nextTick();
      await editor.open(item.params.chatConversationId ? 'chat' : 'image', item.blob, imageFileName(item), {
        settings: item.params, sourceId: `favorite:${item.id}`, conversationId: typeof item.params.chatConversationId === 'string' ? item.params.chatConversationId : undefined,
      });
    }
    emit('close');
  } catch (e) { ui.toast(message(e), 'err'); }
  finally { busy.value = false; }
}
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => { dialog.value?.close(); if (originalFocus instanceof HTMLElement && originalFocus.isConnected) originalFocus.focus({ preventScroll: true }); });
</script>
<template>
  <dialog ref="dialog" class="home-viewer" aria-label="定稿大图" @cancel.prevent="emit('close')" @keydown.stop>
    <header><span>{{ label }}<small>{{ info?.source }}</small></span><button class="ibtn" type="button" aria-label="关闭定稿大图" @click="emit('close')"><AppIcon name="i-close" /></button></header>
    <div class="home-viewer-stage"><img v-if="record" :src="drawing.url(record)" :alt="info?.source || '定稿'" /></div>
    <footer aria-label="定稿操作">
      <button v-if="info?.canRestore" class="ibtn" type="button" aria-label="读取参数到绘图" title="读取参数到绘图" :disabled="busy" @click="action('image')"><AppIcon name="i-reuse" /></button>
      <button class="ibtn" type="button" aria-label="送去对话" title="送去对话" :disabled="busy" @click="action('chat')"><AppIcon name="i-chat" /></button>
      <button class="ibtn" type="button" aria-label="精修图片" title="精修图片" :disabled="busy" @click="action('edit')"><AppIcon name="i-edit" /></button>
      <AskMenu v-if="slates.list.value.some(s => s.todos.length)" id="homeDeliveryMenu" label="交付到任务" side="up">
        <template #trigger="{ open, toggle }"><button class="ibtn" type="button" aria-label="交付到任务" title="交付到任务" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><AppIcon name="i-tasks" /></button></template>
        <template #default="{ close }"><template v-for="slate in slates.list.value" :key="slate.id"><div v-if="slates.list.value.length > 1" class="menu-group">{{ slate.title }}</div><button v-for="todo in slate.todos" :key="todo.id" class="menu-item" type="button" role="menuitem" @click="close(); delivery = { slateId: slate.id, todoId: todo.id }"><span class="menu-label">{{ todo.title }}</span></button></template></template>
      </AskMenu>
      <button v-if="validLine" class="ibtn" type="button" :aria-label="pinned ? '恢复最近图片为封面' : '设为封面'" :title="pinned ? '恢复最近图片为封面' : '设为封面'" :aria-pressed="pinned" :disabled="busy" @click="action('cover')"><AppIcon name="i-pin" /></button>
      <button class="ibtn" type="button" aria-label="取消收藏" title="取消收藏" :disabled="busy" @click="action('remove')"><AppIcon name="i-star" /></button>
    </footer>
    <SlateDeliverable v-if="delivery" :slate-id="delivery.slateId" :todo-id="delivery.todoId" :source-id="recordId" @close="delivery = null" />
  </dialog>
</template>
<style scoped>
.home-viewer { width: min(1100px, calc(100vw - 32px)); max-width: none; height: min(900px, calc(100dvh - 32px)); max-height: none; margin: auto; padding: 12px; color: var(--fg); background: var(--chrome); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--sh-3); }
.home-viewer[open] { display: flex; flex-direction: column; gap: 12px; }
.home-viewer::backdrop { background: color-mix(in srgb, var(--canvas) 85%, transparent); }
.home-viewer header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; }
.home-viewer header > span { overflow: hidden; font: 12px/1.4 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.home-viewer small { margin-left: 12px; color: var(--fg-3); font: 12px/1.4 var(--sans); }
.home-viewer-stage { display: flex; flex: 1; align-items: center; justify-content: center; min-height: 0; }
.home-viewer-stage img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--r2); box-shadow: var(--print-shadow); }
.home-viewer footer { display: flex; flex: none; justify-content: center; gap: 8px; }
.home-viewer [aria-pressed="true"] { color: var(--a); }
@media (max-width: 560px) { .home-viewer { width: calc(100vw - 16px); height: calc(100dvh - 16px); } }
</style>
