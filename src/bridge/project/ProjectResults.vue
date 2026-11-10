<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import ProjectImage from './ProjectImage.vue';
import type { ProjectTreeFile } from './file-tree.ts';
import { layoutPrints } from '../../shared/gallery/layout.ts';
import type { GalleryLayout } from '../../shared/gallery/layout.ts';

const props = defineProps<{ files: readonly ProjectTreeFile[]; selected?: string; layout: GalleryLayout }>();
const emit = defineEmits<{ select: [path: string] }>();
const host = shallowRef<HTMLElement>(), ratios = shallowRef<Record<string, number>>({});
const prints = shallowRef<HTMLElement>(), width = shallowRef(0);
const images = computed(() => props.files.filter(file => file.image));
const documents = computed(() => props.files.filter(file => !file.image));
const arrangement = computed(() => layoutPrints(images.value.map(file => ({ width: ratios.value[file.path] || 1.5, height: 1 })), width.value, props.layout));
const tiles = computed(() => arrangement.value.tiles.map(tile => ({ ...tile, file: images.value[tile.index]! })));
const observer = new ResizeObserver(entries => {
  const measured = entries[0]?.contentRect.width;
  // Keep the arrangement mounted when its list is hidden behind the detail view.
  if (measured && measured > 0) width.value = measured;
});
watch(prints, element => { observer.disconnect(); if (element) observer.observe(element); }, { flush: 'post' });
onBeforeUnmount(() => observer.disconnect());
function rememberRatio(path: string, ratio: number) {
  if (ratio > 0 && Number.isFinite(ratio) && ratios.value[path] !== ratio) ratios.value = { ...ratios.value, [path]: ratio };
}
function focusItem(path?: string) {
  Array.from(host.value?.querySelectorAll<HTMLButtonElement>('button[data-path]') ?? []).find(button => button.dataset.path === path)?.focus({ preventScroll: true });
}
function title(file: ProjectTreeFile) { return file.title.replace(/\.(png|jpe?g|webp|gif|avif|bmp)$/i, ''); }
defineExpose({ focusItem });
</script>

<template>
  <div ref="host" class="project-results">
    <nav v-if="documents.length" class="result-documents" aria-label="成果资料">
      <span class="documents-label">资料</span>
      <button v-for="file in documents" :key="file.path" type="button" class="result-document" :class="{selected:selected===file.path,warning:file.warning}"
        :data-path="file.path" :aria-label="file.title" :title="[file.path,file.note].filter(Boolean).join('\n')" @click="emit('select',file.path)">
        <AppIcon :name="file.warning ? 'i-warning' : file.path.startsWith('slates/') ? 'i-tasks' : 'i-file'"/>
        <span>{{ file.title }}</span><small v-if="file.warning">{{ file.note }}</small>
      </button>
    </nav>
    <nav v-if="images.length" ref="prints" class="result-prints" :data-layout="layout" :style="{height:arrangement.height+'px'}" aria-label="成果图片">
      <button v-for="tile in tiles" :key="tile.file.path" type="button" class="result-print" :class="{selected:selected===tile.file.path}"
        :style="{left:tile.x+'px',top:tile.y+'px',width:tile.w+'px',height:tile.h+'px'}" :data-path="tile.file.path" :aria-label="tile.file.title" :title="[tile.file.path,tile.file.note].filter(Boolean).join('\n')" @click="emit('select',tile.file.path)">
        <span class="result-frame"><ProjectImage :path="tile.file.image!" @ratio="rememberRatio(tile.file.path,$event)"/></span>
        <span class="print-caption">{{ title(tile.file) }}</span>
        <span v-if="tile.file.warning" class="print-warning" :title="tile.file.note"><AppIcon name="i-warning"/><span>{{ tile.file.note }}</span></span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.project-results { flex: 1; min-width: 0; min-height: 0; padding: 2px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.result-documents { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-5); }
.documents-label { margin-right: var(--sp-1); color: var(--fg-3); font-size: var(--fz-xs); }
.result-document { display: flex; align-items: center; gap: var(--sp-2); max-width: 100%; min-height: 32px; padding: var(--sp-1) var(--sp-3); color: var(--fg-2); font-size: var(--fz-xs); background: var(--chrome); border-radius: var(--r2); }
.result-document > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-document .ico { flex: none; color: var(--fg-3); --ico: var(--ico-sm); }
.result-document small { flex: none; font-size: var(--fz-2xs); }
.result-document.warning .ico, .result-document.warning small { color: var(--warn); }
.result-document:hover { color: var(--fg); background: var(--hover); }
.result-document.selected { color: var(--a); background: var(--nav-active-bg); }
.result-prints { position: relative; }
.result-print { position: absolute; overflow: hidden; line-height: 0; text-align: left; border-radius: var(--r3); }
.result-frame { display: block; width: 100%; height: 100%; }
.result-frame :deep(.project-image) { position: absolute; inset: 0; border-radius: inherit; }
.result-print:hover { outline: 1px solid var(--line-2); }
.result-print.selected { outline: 2px solid var(--a-line); outline-offset: 0; }
.result-print:focus-visible, .result-document:focus-visible { outline: 2px solid var(--a); outline-offset: 0; }
.print-caption { position: absolute; right: 0; bottom: 0; left: 0; padding: var(--sp-4) var(--sp-3) var(--sp-2); overflow: hidden; color: var(--specular); font-size: var(--fz-xs); line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; background: linear-gradient(transparent, rgb(var(--shadow-rgb) / .7)); opacity: 0; transition: opacity var(--t1); }
.result-print:hover .print-caption, .result-print:focus-visible .print-caption { opacity: 1; }
.print-warning { position: absolute; top: var(--sp-2); left: var(--sp-2); display: flex; align-items: center; gap: var(--sp-1); padding: var(--sp-1) var(--sp-2); color: var(--warn); font-size: var(--fz-xs); line-height: 1.5; background: var(--chrome); border-radius: var(--r2); --ico: var(--ico-sm); }
@media (hover: none) { .print-caption { opacity: 1; } }
</style>
