<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import LayerTreePicker, { type LayerPickerItem } from './LayerTreePicker.vue';
import type { StackLayer } from './project.ts';

const props = defineProps<{
  layers: StackLayer[];
  selected?: string[];
  excluded: string[];
  hasGuide: boolean;
  busy: boolean;
  missing?: boolean;
}>();
const emit = defineEmits<{ change: [ids: string[] | undefined]; ask: [] }>();

const pickerItems = computed<LayerPickerItem[]>(() =>
  props.layers
    .filter((l) => !l.archived)
    .map((l) => {
      const path = [...(l.groups ?? []), l.name].join(' / ');
      const disabled = props.excluded.includes(l.id);
      return {
        id: l.id,
        name: l.name,
        path,
        groups: l.groups ?? [],
        groupIds: l.groupIds ?? l.groups ?? [],
        disabled,
        title: disabled ? `${path}（已用于排除遮挡）` : path,
      };
    }),
);

function toggle(id: string) {
  const ids = props.selected ?? [];
  emit('change', ids.includes(id) ? ids.filter((key) => key !== id) : [...ids, id]);
}

function toggleGroup(ids: string[], allSelected: boolean) {
  const cur = props.selected ?? [];
  const next = allSelected ? cur.filter((id) => !ids.includes(id)) : [...new Set([...cur, ...ids])];
  emit('change', next);
}
</script>

<template>
  <section class="scalpel-source-picker" :aria-label="missing ? '缺失件底图' : '补画底图'">
    <div class="source-bar">
      <h3 class="source-label">{{ missing ? '缺失件底图' : '补画底图' }}</h3>
      <div class="source-inline-opts" role="group" aria-label="补画底图来源">
        <button
          type="button"
          class="source-pill"
          :aria-pressed="!selected"
          :disabled="busy"
          @click="selected && emit('change', undefined)"
        >
          {{ missing ? '母版原图' : '母版' }}
        </button>
        <button
          type="button"
          class="source-pill"
          :aria-pressed="!!selected"
          :disabled="busy"
          @click="!selected && emit('change', [])"
        >
          选择图层<span v-if="selected?.length" class="mono"> · {{ selected.length }}</span>
        </button>
      </div>
      <button
        type="button"
        class="source-ask"
        :aria-label="missing ? '让 ASK 选底图' : '让 ASK 选层'"
        :title="missing ? '让 ASK 选底图' : '让 ASK 选层'"
        :disabled="busy"
        @click="emit('ask')"
      >
        <AppIcon name="i-ask" />
        <span>ASK</span>
      </button>
    </div>

    <template v-if="selected">
      <div class="source-tree-box" role="group" aria-label="可选补画图层">
        <LayerTreePicker
          mode="checkbox"
          :items="pickerItems"
          :selected="selected"
          :busy="busy"
          search-label="搜索补画图层"
          search-placeholder="按图层或分组名搜索…"
          :empty-text="pickerItems.length ? '没有匹配的图层' : '当前没有可选图层'"
          max-height="13rem"
          @toggle="toggle"
          @toggle-group="toggleGroup"
          @remove="toggle"
          @clear="emit('change', [])"
        />
      </div>
      <p v-if="!pickerItems.length" class="hint">当前没有可选图层</p>
      <p v-else-if="missing" class="hint">
        {{
          selected.length
            ? `已选 ${selected.length} 层，按原位合成一张参考图。`
            : '勾选能帮助定位缺失部件的图层，如面部和头发。'
        }}
      </p>
      <p v-else-if="!selected.length" class="hint">勾选一个或多个图层作为补画底图。</p>
      <p v-else-if="hasGuide" class="hint">当前沿用画布选区。清空选区可补画整组。</p>
      <p v-else class="hint">可直接补画所选图层，也可在画布上标出局部。</p>
    </template>
  </section>
</template>

<style scoped>
.scalpel-source-picker {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding-top: 2px;
}

.source-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 26px;
}

.source-label {
  margin: 0;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
  white-space: nowrap;
}

.source-inline-opts {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.source-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--r1);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
  white-space: nowrap;
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.source-pill:hover:not(:disabled, [aria-pressed='true']) {
  color: var(--fg-2);
  background: var(--hover);
}
.source-pill[aria-pressed='true'] {
  background: var(--a-dim);
  color: var(--a);
  font-weight: var(--fw-semibold);
}
.source-pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.source-ask {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 6px;
  border-radius: var(--r1);
  font-size: var(--fz-2xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
  white-space: nowrap;
  --ico: var(--ico-xs);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.source-ask:hover:not(:disabled) {
  color: var(--a);
  background: var(--a-dim);
}
.source-ask:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.source-tree-box {
  min-width: 0;
}
</style>
