<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import PopoverMenu from '../shared/ui/PopoverMenu.vue';
import LayerThumbnail from './LayerThumbnail.vue';
import LayerTreePicker, { type LayerPickerItem } from './LayerTreePicker.vue';
import type { ReferenceSource, ScalpelReference } from './scalpel-references.ts';

const props = defineProps<{
  sources: ReferenceSource[];
  selected: ScalpelReference[];
  excluded: string[];
  firstImage: number;
  busy: boolean;
}>();
const emit = defineEmits<{
  files: [files: File[]];
  change: [references: ScalpelReference[]];
  remove: [source: ReferenceSource];
}>();
const picker = ref<HTMLInputElement>();
const treePicker = ref<InstanceType<typeof LayerTreePicker>>();
const rows = computed(() =>
  props.selected.flatMap((ref) => {
    const source = props.sources.find((s) => s.picture === ref.picture);
    return source ? [{ ...ref, source }] : [];
  }),
);
const available = computed(() =>
  props.sources.filter(
    (source) => !props.selected.some((r) => r.picture === source.picture) && !props.excluded.includes(source.picture),
  ),
);
const availableLayers = computed<LayerPickerItem[]>(() =>
  available.value
    .filter((s) => s.kind === 'layer')
    .map((s) => {
      const parts = s.name.split(' / ');
      const leaf = parts.at(-1) ?? s.name;
      const groups = parts.length > 1 ? parts.slice(0, -1) : [];
      return {
        id: s.picture,
        name: leaf,
        path: s.name,
        groups,
        groupIds: groups,
        image: s.image,
      };
    }),
);
const availableFiles = computed(() => available.value.filter((s) => s.kind === 'file'));

function addPicture(picture: string) {
  emit('change', [...props.selected, { picture, usage: '' }]);
}
function importFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length) emit('files', files);
}
function setUsage(picture: string, event: Event) {
  const usage = (event.target as HTMLInputElement).value;
  emit(
    'change',
    props.selected.map((r) => (r.picture === picture ? { picture, usage } : r)),
  );
}
</script>

<template>
  <section class="scalpel-references" aria-label="补画参考">
    <input
      ref="picker"
      type="file"
      multiple
      hidden
      aria-label="导入补画参考图"
      accept="image/png,image/jpeg,image/webp"
      @change="importFiles"
    />

    <div class="ref-bar">
      <h3 class="ref-label">
        补画参考
        <span v-if="rows.length" class="ref-count mono">{{ rows.length }}</span>
      </h3>
      <div class="ref-actions">
        <PopoverMenu
          id="scalpelRefLayerMenu"
          label="添加参考图层"
          side="right"
          compact
          menu-class="layer-tree-popover"
          pointer-focus="menu"
          @opened="treePicker?.reset()"
        >
          <template #trigger="{ open, toggle }">
            <button
              type="button"
              class="ref-act-btn"
              aria-label="添加参考图层"
              aria-haspopup="menu"
              :aria-expanded="open"
              :disabled="busy || !available.length"
              @click="toggle"
            >
              <AppIcon name="i-layers" />
              <span>图层</span>
              <AppIcon name="i-chevron" class="ref-caret" />
            </button>
          </template>
          <template #default="{ close }">
            <div v-if="availableLayers.length" class="ref-menu-group">
              <p class="ref-menu-title">正式图层</p>
              <LayerTreePicker
                ref="treePicker"
                mode="action"
                :items="availableLayers"
                :busy="busy"
                show-thumbs
                search-label="搜索参考图层"
                search-placeholder="搜索图层或分组…"
                max-height="220px"
                @pick="
                  addPicture($event);
                  close(true);
                "
              />
            </div>
            <hr v-if="availableLayers.length && availableFiles.length" />
            <div v-if="availableFiles.length" class="ref-menu-group">
              <p class="ref-menu-title">已导入参考图</p>
              <button
                v-for="s in availableFiles"
                :key="s.picture"
                type="button"
                class="menu-item"
                role="menuitem"
                @click="
                  addPicture(s.picture);
                  close(true);
                "
              >
                <span class="menu-label">{{ s.name }}</span>
              </button>
            </div>
          </template>
        </PopoverMenu>

        <button
          type="button"
          class="ref-act-btn"
          :disabled="busy"
          aria-label="添加参考图"
          @click="picker?.click()"
        >
          <AppIcon name="i-upload" />
          <span>上传</span>
        </button>
      </div>
    </div>

    <div v-for="(row, i) in rows" :key="row.picture" class="scalpel-reference-row">
      <LayerThumbnail :image="row.source.image" class="ref-thumb" />
      <div class="ref-body">
        <div class="ref-row-head">
          <span class="ref-name" :title="row.source.name">图 {{ firstImage + i }} · {{ row.source.name }}</span>
          <button
            type="button"
            class="btn-link"
            :disabled="busy"
            :aria-label="'移除参考 ' + row.source.name"
            @click="emit('remove', row.source)"
          >
            移除
          </button>
        </div>
        <input
          type="text"
          :aria-label="'参考用途 ' + row.source.name"
          :value="row.usage"
          maxlength="500"
          :disabled="busy"
          placeholder="参考用途，如只参考发梢颜色"
          @input="setUsage(row.picture, $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.scalpel-references {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.ref-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}

.ref-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
  white-space: nowrap;
}

.ref-count {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--well);
  font-size: var(--fz-2xs);
  color: var(--fg-2);
}

.ref-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.ref-act-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border-radius: var(--r1);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-2);
  white-space: nowrap;
  --ico: var(--ico-xs);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.ref-act-btn:hover:not(:disabled),
.ref-act-btn[aria-expanded='true'] {
  color: var(--fg);
  background: var(--hover);
}
.ref-act-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ref-caret {
  color: var(--fg-3);
  transform: rotate(90deg);
  transition: transform var(--t1) var(--e);
}
.ref-act-btn[aria-expanded='true'] .ref-caret {
  transform: rotate(-90deg);
}

.ref-menu-group {
  display: grid;
}
.ref-menu-title {
  margin: 0;
  padding: 4px 10px 2px;
  font-size: var(--fz-2xs);
  font-weight: var(--fw-medium);
  color: var(--fg-4);
}

.scalpel-reference-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 2px 0;
}
.ref-thumb {
  width: 38px;
  height: 38px;
  border-radius: var(--r1);
}
.ref-body {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.ref-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.ref-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--fz-xs);
  color: var(--fg-2);
}
.ref-body input {
  padding: 5px 8px;
  font-size: var(--fz-xs);
}
</style>
