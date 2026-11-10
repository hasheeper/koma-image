<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import type { ProjectCharacter } from './model.ts';
import AppIcon from '../../shared/AppIcon.vue';
import ProjectImage from './ProjectImage.vue';
import ProjectActions from './ProjectActions.vue';
const props = defineProps<{ character: ProjectCharacter }>();
const viewing = shallowRef(false), selected = shallowRef(''), viewer = shallowRef<HTMLDialogElement>();
const images = computed(() => [
  ...(props.character.portrait ? [{ path: props.character.portrait, title: '主立绘', portrait: true }] : []),
  ...props.character.refs.map(r => ({ path: r.path, title: r.title, portrait: false })),
]);
const current = computed(() => images.value.find(i => i.path === selected.value) ?? images.value[0]);
watch(() => props.character.path, () => { selected.value = ''; viewer.value?.close(); });
function openViewer(){viewing.value=true;viewer.value?.showModal();}
onBeforeUnmount(() => viewer.value?.close());
</script>
<template>
  <div class="character-visual">
    <button v-if="current" class="character-main-image" type="button" aria-label="查看当前图片大图" @click="openViewer">
      <ProjectImage :path="current.path" full :ambient="current.portrait ? 'portrait' : 'reference'" class="character-art"/>
    </button>
    <ProjectImage v-else :path="null" class="character-art"/>
    <div v-if="images.length" class="character-media-rail" role="group" aria-label="角色图片">
      <button v-for="image in images" :key="image.path" type="button" :class="{selected:current?.path===image.path}" :aria-pressed="current?.path===image.path" :aria-label="'查看'+image.title" :title="image.title" @click="selected=image.path"><ProjectImage :path="image.path"/></button>
    </div>
    <div v-if="current" class="character-image-tools"><button class="ibtn" type="button" aria-label="查看大图" title="查看大图" @click="openViewer"><AppIcon name="i-expand"/></button><ProjectActions :path="current.path" image/></div>
  </div>
  <dialog ref="viewer" class="project-viewer" aria-label="角色大图" @cancel.prevent="viewer?.close()" @close="viewing=false" @keydown.stop>
    <template v-if="viewing && current"><header><span>{{ character.name }} · {{ current.title }}</span><div><ProjectActions :path="current.path" image/><button class="ibtn" type="button" aria-label="关闭大图" @click="viewer?.close()"><AppIcon name="i-close"/></button></div></header><ProjectImage :path="current.path" full class="viewer-image"/></template>
  </dialog>
</template>
<style scoped>
.character-visual { position: relative; isolation: isolate; flex: 0 1 auto; min-height: 360px; height: clamp(440px, 54dvh, 600px); margin: 16px 16px 0; overflow: clip; background: var(--chrome); border: 1px solid var(--line); border-radius: var(--r4); }
.character-main-image { display: block; width: 100%; height: 100%; padding: 0; cursor: zoom-in; }
.character-art { --project-image-inset: 16px 16px 16px 80px; height: 100%; border-radius: inherit; }
.character-media-rail { position: absolute; top: 12px; bottom: 12px; left: 12px; display: flex; flex-direction: column; gap: 8px; width: 56px; padding: 2px; overflow: auto; overscroll-behavior: contain; scrollbar-width: none; }
.character-media-rail button { flex: none; height: 64px; padding: 3px; background: var(--chrome); border-radius: var(--r2); outline: 1px solid transparent; }
.character-media-rail button.selected { background: var(--a-glow); outline-color: var(--a); }
.character-image-tools { position: absolute; top: 12px; right: 12px; display: flex; gap: 4px; opacity: 0; }
.character-visual:hover .character-image-tools, .character-visual:focus-within .character-image-tools { opacity: 1; }
.project-viewer { width: 100%; max-width: none; height: 100dvh; max-height: none; margin: 0; padding: 0; color: var(--fg); background: var(--canvas); border: 0; }
.project-viewer[open] { display: flex; flex-direction: column; }
.project-viewer header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 8px 24px; background: var(--chrome); }
.project-viewer header > span { min-width: 0; overflow: hidden; font-size: var(--fz-sm); text-overflow: ellipsis; white-space: nowrap; }
.project-viewer header > div { display: flex; flex: none; gap: 4px; }
.viewer-image { flex: 1; min-height: 0; border-radius: 0; }
@container project-window (max-width: 1020px) { .character-art { --project-image-inset: 16px 12px 16px 72px; } .character-media-rail { width: 48px; } .character-media-rail button { height: 58px; } }
@container project-window (max-width: 760px) { .character-visual { flex: none; height: 46dvh; min-height: 340px; } .character-image-tools { opacity: 1; } .character-media-rail button { height: 56px; } }
@media (hover: none) { .character-image-tools { opacity: 1; } }
</style>
