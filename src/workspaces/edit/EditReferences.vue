<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue';
import { useEditor } from '../../app/editor.ts';
import { useUi } from '../../app/ui.ts';
import AppIcon from '../../shared/AppIcon.vue';

const { editor, view } = useEditor(), ui = useUi();
const dialog = shallowRef<HTMLDialogElement>();
const dragging = shallowRef(''), selected = shallowRef('');
const refs = computed(() => view.value.references), item = computed(() => refs.value.find(r => r.id === selected.value));
const limit = computed(() => view.value.referenceCapacity);
const disabled = computed(() => view.value.busy || view.value.preparing || !!view.value.externalId);
function uploadHint() { ui.toast('请在画布批注中上传参考图'); }
async function preview(id: string) { selected.value = id; await nextTick(); dialog.value?.showModal(); }
function remove(id: string) { editor.setReferences(refs.value.filter(r => r.id !== id).map(({url: _url, ...r}) => r)); }
function move(id: string, to: number) {
  if (disabled.value) return;
  const next = refs.value.map(({url: _url, ...r}) => r), from = next.findIndex(r => r.id === id);
  if (from < 0 || to < 0 || to >= next.length || from === to) return;
  next.splice(to, 0, next.splice(from, 1)[0]); editor.setReferences(next);
}
function usage(value: string) { editor.setReferences(refs.value.map(({url: _url, ...r}) => r.id === selected.value ? {...r, usage: value} : r)); }
watch(() => view.value.session.id, () => dialog.value?.close());
watch(item, value => { if (!value) dialog.value?.close(); });
</script>

<template>
  <section class="edit-reference-composer" data-reference-composer aria-label="修改说明与参考图" @dragover.prevent.stop @drop.prevent.stop="e => { if (e.dataTransfer?.files.length) uploadHint(); dragging = ''; }" @paste.stop="e => { if (e.clipboardData?.files.length) { e.preventDefault(); uploadHint(); } }">
    <slot />
    <div v-if="refs.length" class="edit-references promptbox" aria-label="编辑参考图">
      <div class="promptbox-head">
        <span class="reference-heading">参考图</span>
        <span v-if="refs.length > limit" class="reference-limit" role="status" :title="`已添加 ${refs.length} 张，当前最多可用 ${limit} 张`">{{ refs.length }}/{{ limit }}</span>
      </div>
      <div class="reference-list">
        <div v-for="(r, index) in refs" :key="r.id" class="reference-tile" :class="{'is-dragging': dragging === r.id}" :draggable="!disabled" @dragstart.stop="e => { dragging = r.id; e.dataTransfer?.setData('text/plain', r.id); }" @dragend="dragging = ''" @drop.prevent.stop="e => { if (dragging) move(dragging, index); else if (e.dataTransfer?.files.length) uploadHint(); dragging = ''; }">
          <button class="reference-preview" type="button" :aria-label="`查看参考图 ${r.label}`" :title="`${r.label} · ${r.name}${r.usage ? ` · ${r.usage}` : ''}（点击预览与编辑用途；拖动或 Alt＋方向键排序）`" @click="preview(r.id)" @keydown.alt.left.prevent="move(r.id,index-1)" @keydown.alt.up.prevent="move(r.id,index-1)" @keydown.alt.right.prevent="move(r.id,index+1)" @keydown.alt.down.prevent="move(r.id,index+1)">
            <span class="reference-image"><img :src="r.url" alt="" draggable="false" /></span>
            <span class="reference-label">{{ r.label }}</span>
          </button>
          <button class="ibtn reference-remove" type="button" :disabled="disabled" :aria-label="`移除参考图 ${r.label}`" :title="`移除 ${r.label}`" @click="remove(r.id)"><AppIcon name="i-close" /></button>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <dialog ref="dialog" class="edit-reference-preview" aria-label="参考图预览" @close="selected = ''" @click="e => { if (e.target === dialog) dialog?.close(); }">
        <template v-if="item">
          <button class="ibtn reference-close" type="button" aria-label="关闭参考图" @click="dialog?.close()"><AppIcon name="i-close" /></button>
          <img :src="item.url" :alt="item.name" />
          <label>{{ item.label }} · {{ item.name }}<input :value="item.usage" :disabled="disabled" maxlength="500" aria-label="参考图用途" placeholder="用途，例如：参考服装，保留底图人物与构图" @change="usage(($event.target as HTMLInputElement).value)" /></label>
        </template>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.edit-reference-composer { display: contents; }
.edit-references { display: grid; align-self: flex-start; flex: none; min-width: 0; max-width: 100%; width: max-content; margin-top: calc(10px - var(--section, 20px)); }
.reference-heading { position: relative; display: inline-flex; align-items: center; color: var(--fg); font-size: var(--fz-xs); font-weight: var(--fw-bold); letter-spacing: -0.005em; }
.reference-heading::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--a); border-radius: 2px 2px 0 0; }
.reference-list { display: flex; gap: 8px; min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: thin; padding: 10px 12px; }
.reference-tile { position: relative; flex: none; border-radius: 7px; }
.reference-tile.is-dragging { opacity: .55; }
.reference-preview { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 0 0 2px; border-radius: inherit; }
.reference-preview:focus-visible { outline: 1px solid var(--a); outline-offset: -1px; }
.reference-image { display: block; width: 64px; height: 64px; overflow: hidden; border-radius: 7px; background: var(--image-checker); box-shadow: inset 0 0 0 1px var(--line); }
.reference-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
.reference-label { color: var(--fg-3); font: var(--fz-2xs)/1.4 var(--mono); }
.reference-preview:hover .reference-label { color: var(--fg); }
.reference-limit { flex: none; align-self: center; color: var(--warn); font: var(--fz-2xs)/1.5 var(--mono); }
.reference-remove { position: absolute; top: -4px; right: -4px; width: 20px; height: 20px; border: 1px solid var(--line-2); border-radius: 50%; color: var(--media-ink); background: var(--media-surface); opacity: 0; --ico: var(--ico-xs); }
.reference-tile:hover .reference-remove, .reference-tile:focus-within .reference-remove { opacity: 1; }
.edit-reference-preview { width: min(780px,calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 40px 20px 20px; color: var(--fg); background: var(--raised); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--sh-3); }
.edit-reference-preview::backdrop { background: rgb(0 0 0 / 65%); }
.edit-reference-preview > img { display: block; max-width: 100%; max-height: 65dvh; margin: 0 auto 16px; object-fit: contain; }
.reference-close { position: absolute; top: 8px; right: 8px; }
.edit-reference-preview label { display: grid; gap: 8px; font-size: var(--fz-sm); overflow-wrap: anywhere; }
@media (hover: none) { .reference-remove { opacity: 1; } }
</style>
