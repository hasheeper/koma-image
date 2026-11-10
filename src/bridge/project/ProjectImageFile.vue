<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import ProjectImage from './ProjectImage.vue';
import ProjectActions from './ProjectActions.vue';
import { useProjectActions } from './use-project-actions.ts';

const props = defineProps<{ path:string; title?:string; description?:string }>();
const actions = useProjectActions();
const size = shallowRef<{width:number;height:number}|null>(null), information = shallowRef(false);
const title = computed(() => props.title || props.path.split('/').at(-1) || props.path);
const directory = computed(() => props.path.split('/').slice(0, -1).join(' / ') || '根目录');
const format = computed(() => props.path.split('.').at(-1)?.toUpperCase());
watch(() => props.path, () => { size.value = null; information.value = false; });
</script>

<template>
  <section class="project-image-file">
    <div class="image-stage"><ProjectImage :path="path" :alt="title" full @size="size=$event"/></div>
    <section v-if="information" class="image-information" aria-label="文件信息与说明">
      <div class="information-heading"><span>文件信息</span><button class="ibtn" type="button" aria-label="收起文件信息" title="收起文件信息" @click="information=false"><AppIcon name="i-close"/></button></div>
      <p class="information-path">{{ path }}</p>
      <p v-if="description" class="information-description">{{ description }}</p>
    </section>
    <footer class="image-footer">
      <div class="image-identity">
        <h3 :title="title">{{ title }}</h3>
        <div class="image-meta"><span class="image-directory" :title="path">{{ directory }}</span><span v-if="size" class="image-size">{{ size.width }} × {{ size.height }}</span><span>{{ format }}</span></div>
      </div>
      <div class="image-tools">
        <button class="btn image-ask" type="button" @click="actions.quote(path,title)"><AppIcon name="i-ask"/>ASK</button>
        <ProjectActions :path="path" image shortcuts>
          <template #extra="{close}"><button class="menu-item" role="menuitem" @click="close(); information=!information"><AppIcon name="i-file"/><span class="menu-label">{{ information ? '收起文件信息' : '文件信息与说明' }}</span></button></template>
        </ProjectActions>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.project-image-file { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.image-stage { display: flex; flex: 1; min-width: 0; min-height: 0; padding: 0 var(--sp-5) var(--sp-5); }
.image-information { flex: 0 1 auto; max-height: 30%; margin: 0 var(--sp-5); padding: var(--sp-3) 0 var(--sp-4); overflow: auto; border-top: 1px solid var(--line); overscroll-behavior: contain; scrollbar-width: thin; }
.information-heading { display: flex; align-items: center; justify-content: space-between; color: var(--fg-3); font-size: var(--fz-xs); }
.information-heading .ibtn { flex: none; width: 28px; height: 28px; border-radius: var(--r2); }
.information-path { margin: var(--sp-1) 0 0; color: var(--fg-3); font: var(--fz-xs)/1.6 var(--mono), var(--sans); overflow-wrap: anywhere; }
.information-description { margin: var(--sp-2) 0 0; color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.image-footer { display: flex; flex: none; align-items: center; gap: var(--sp-5); margin: 0 var(--sp-5); padding: var(--sp-4) 0 20px; border-top: 1px solid var(--line); }
.image-identity { flex: 1; min-width: 0; }
.image-identity h3 { margin: 0; overflow: hidden; font-size: var(--fz-md); font-weight: var(--fw-medium); line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
.image-meta { display: flex; align-items: center; gap: var(--sp-3); margin-top: var(--sp-1); color: var(--fg-3); font-size: var(--fz-2xs); }
.image-directory { min-width: 0; overflow: hidden; font-family: var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.image-size { flex: none; font-family: var(--mono); white-space: nowrap; }
.image-tools { display: flex; flex: none; align-items: center; gap: var(--sp-2); }
.image-tools :deep(.ibtn) { width: 32px; height: 32px; color: var(--fg-3); border-radius: var(--r2); }
.image-tools :deep(.ibtn:hover) { color: var(--fg); }
.image-ask { min-height: 32px; padding: var(--sp-1) var(--sp-3); color: var(--a); font-size: var(--fz-sm); font-weight: var(--fw-medium); background: var(--a-dim); border-radius: var(--r3); }
.image-ask:hover { background: var(--a-line); }
@container project-window (max-width: 1020px) {
  .image-footer { flex-wrap: wrap; gap: var(--sp-3); }
  .image-identity { flex-basis: 100%; }
  .image-tools { margin-left: auto; }
}
@container project-window (max-width: 760px) {
  .image-stage { padding: 0 var(--sp-4) var(--sp-4); }
  .image-footer, .image-information { margin-inline: var(--sp-4); }
  .image-tools :deep(.ibtn) { width: 44px; height: 44px; }
  .image-ask { min-height: 40px; }
}
</style>
