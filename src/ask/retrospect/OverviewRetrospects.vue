<script setup lang="ts">
import { computed, nextTick, shallowRef } from 'vue';
import { useDrawing } from '../../app/drawing.ts';
import { useSlates } from '../../app/slate.ts';
import AppIcon from '../../shared/AppIcon.vue';
import RetrospectCovers from './RetrospectCovers.vue';
import RetrospectActions from './RetrospectActions.vue';
import type { ReviewRecord } from './store.ts';
import { useRetrospects } from './use-retrospects.ts';
const { view } = useDrawing(), slates = useSlates(), { boardName, registry } = useRetrospects();
const retrospects = registry.records, openRetrospect = registry.open;
const historyOpen = shallowRef(false);
const active = computed(() => retrospects.value.filter(record => record.status === 'active').sort((a, b) => Number(b.boardId === view.value.activeBoardId) - Number(a.boardId === view.value.activeBoardId) || b.activatedAt - a.activatedAt));
const history = computed(() => retrospects.value.filter(record => record.status === 'ended').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)));
const rows = computed(() => [...active.value, ...(historyOpen.value ? history.value : [])]);
const count = (record: ReviewRecord) => record.value.nodes.reduce((total, node) => total + node.image_ids.length, 0);
async function open(record: ReviewRecord) { slates.visible.value = false; await nextTick(); openRetrospect(record.id); }
</script>
<template>
  <section v-if="retrospects.length" class="overview-retrospects" aria-label="演进列表">
    <h3>演进</h3>
    <template v-for="(record, index) in rows" :key="record.id">
      <button v-if="index === active.length && history.length" class="retrospect-history" type="button" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen"><AppIcon name="i-chevron" :class="{ expanded: historyOpen }" />历史<span>{{ history.length }}</span></button>
      <div class="retrospect-row" :aria-label="`${record.value.title} · ${record.status === 'active' ? '进行中' : record.final ? '已定稿' : '已解除'}`">
        <button class="retrospect-item" type="button" :aria-label="`查看演进 ${record.value.title}`" @click="open(record)">
          <RetrospectCovers :value="record.value" :picture-refs="record.pictureRefs" />
          <span class="retrospect-identity"><b>{{ record.value.title }}</b><small>{{ boardName(record) }} · {{ record.value.nodes.length }} 版 · {{ count(record) }} 张</small></span>
          <i v-if="record.status === 'active'" class="active-dot" title="进行中"></i><AppIcon v-else name="i-chevron" />
        </button>
        <RetrospectActions :record-id="record.id" />
      </div>
    </template>
    <button v-if="history.length && !historyOpen" class="retrospect-history" type="button" :aria-expanded="historyOpen" @click="historyOpen = true"><AppIcon name="i-chevron" />历史<span>{{ history.length }}</span></button>
  </section>
</template>
<style scoped>
.overview-retrospects { display: flex; flex-direction: column; gap: var(--sp-1); padding-bottom: var(--sp-2); }
.overview-retrospects h3 { margin: var(--sp-1) 6px; color: var(--fg-3); font-size: var(--fz-xs); font-weight: var(--fw-medium); }
.retrospect-row { display: flex; align-items: center; gap: 2px; min-width: 0; }
.retrospect-item { display: flex; align-items: center; gap: var(--sp-3); flex: 1; min-width: 0; padding: var(--sp-2) 6px; text-align: left; color: var(--fg-2); border-radius: var(--r2); --cover-width: 18px; --cover-height: 28px; }
.retrospect-item:hover { color: var(--fg); background: var(--hover); }
.retrospect-identity { display: grid; gap: var(--sp-1); flex: 1; min-width: 0; }
.retrospect-identity b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-size: var(--fz-xs); font-weight: var(--fw-medium); }
.retrospect-identity small { color: var(--fg-3); font-size: var(--fz-2xs); }
.retrospect-item > .ico { --ico: var(--ico-xs); flex: none; color: var(--fg-3); }
.active-dot { flex: none; width: 5px; height: 5px; background: var(--a); border-radius: 50%; }
.retrospect-history { display: flex; align-items: center; gap: var(--sp-2); min-height: 28px; padding-inline: 6px; color: var(--fg-3); font-size: var(--fz-xs); border-radius: var(--r1); }
.retrospect-history:hover { color: var(--fg); background: var(--hover); }
.retrospect-history > .ico { --ico: var(--ico-xs); }
.retrospect-history .expanded { transform: rotate(90deg); }
.retrospect-history > span { margin-left: auto; font: var(--fz-2xs)/1 var(--mono); }
</style>
