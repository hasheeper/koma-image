<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import LayerThumbnail from './LayerThumbnail.vue';
import type { Raster, StackLayer } from './project.ts';

export interface LayerPickerItem {
  id: string;
  name: string;
  path: string;
  groups: readonly string[];
  groupIds: readonly string[];
  image?: Raster | StackLayer | Blob;
  disabled?: boolean;
  title?: string;
}

type TreeRow =
  | {
      kind: 'group';
      key: string;
      name: string;
      depth: number;
      collapsed: boolean;
      count: number;
      memberIds: string[];
      selectedCount: number;
    }
  | {
      kind: 'item';
      item: LayerPickerItem;
      depth: number;
      breadcrumb: string;
    };

const props = withDefaults(
  defineProps<{
    items: readonly LayerPickerItem[];
    selected?: readonly string[];
    mode: 'hybrid' | 'checkbox' | 'action';
    busy?: boolean;
    showThumbs?: boolean;
    searchLabel?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    allowClear?: boolean;
    keepOne?: boolean;
    maxHeight?: string;
  }>(),
  {
    selected: () => [],
    busy: false,
    showThumbs: false,
    searchLabel: '搜索图层',
    searchPlaceholder: '搜索图层或分组…',
    emptyText: '没有匹配的图层',
    allowClear: true,
    keepOne: false,
    maxHeight: '240px',
  },
);

const emit = defineEmits<{
  pick: [id: string];
  toggle: [id: string];
  toggleGroup: [ids: string[], allSelected: boolean];
  remove: [id: string];
  clear: [];
  keepFirst: [];
}>();

const search = ref('');
const collapsed = ref<Record<string, boolean>>({});

const selectedSet = computed(() => new Set(props.selected));
const selectedItems = computed(() => props.items.filter((item) => selectedSet.value.has(item.id)));
const defaultCollapsed = computed(() => props.items.length > 24);
const searching = computed(() => search.value.trim().length > 0);
const showSearch = computed(() => props.items.length > 6);

const matchedItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.items;
  return props.items.filter(
    (item) => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q),
  );
});

function isGroupCollapsed(key: string): boolean {
  if (searching.value) return false;
  return key in collapsed.value ? collapsed.value[key] : defaultCollapsed.value;
}

function toggleCollapse(key: string) {
  collapsed.value = { ...collapsed.value, [key]: !isGroupCollapsed(key) };
}

function groupPrefix(item: LayerPickerItem) {
  return item.groupIds.length ? item.groupIds : item.groups;
}

function isUnderGroup(item: LayerPickerItem, prefix: readonly string[]) {
  const path = groupPrefix(item);
  return path.length >= prefix.length && prefix.every((seg, i) => path[i] === seg);
}

const rows = computed<TreeRow[]>(() => {
  const list = matchedItems.value;
  if (searching.value) {
    return list.map((item) => ({
      kind: 'item',
      item,
      depth: 0,
      breadcrumb: item.groups.join(' / '),
    }));
  }

  const out: TreeRow[] = [];
  const openPaths: string[] = [];
  const hiddenByCollapse = (path: readonly string[]) => {
    for (let d = 1; d <= path.length; d++) {
      if (isGroupCollapsed(path.slice(0, d).join('\0'))) return true;
    }
    return false;
  };

  for (const item of list) {
    const names = item.groups;
    const ids = groupPrefix(item);
    let common = 0;
    while (common < openPaths.length && common < ids.length && openPaths[common] === ids[common]) {
      common++;
    }
    openPaths.length = common;
    for (let i = common; i < ids.length; i++) {
      const parentPath = ids.slice(0, i);
      const path = ids.slice(0, i + 1);
      openPaths.push(ids[i]);
      if (hiddenByCollapse(parentPath)) continue;
      const key = path.join('\0');
      const members = list.filter((it) => isUnderGroup(it, path));
      const enabledIds = members.filter((it) => !it.disabled).map((it) => it.id);
      const selectedCount = enabledIds.filter((id) => selectedSet.value.has(id)).length;
      out.push({
        kind: 'group',
        key,
        name: names[i] ?? ids[i],
        depth: i,
        collapsed: isGroupCollapsed(key),
        count: members.length,
        memberIds: enabledIds,
        selectedCount,
      });
    }
    if (!hiddenByCollapse(ids)) {
      out.push({ kind: 'item', item, depth: ids.length, breadcrumb: '' });
    }
  }
  return out;
});

function reset() {
  search.value = '';
  collapsed.value = {};
}

defineExpose({ reset });
</script>

<template>
  <div class="ltp" :class="`is-${mode}`">
    <!-- Search bar (shown whenever > 6 layers; filters by name & folder path) -->
    <div v-if="showSearch" class="ltp-search-wrap" @keydown.stop>
      <AppIcon name="i-search" class="ltp-search-ico" />
      <input
        v-model="search"
        type="search"
        class="ltp-search"
        :aria-label="searchLabel"
        :placeholder="searchPlaceholder"
      />
      <button
        v-if="search"
        type="button"
        class="ltp-search-clear"
        aria-label="清空搜索"
        @click="search = ''"
      >
        <AppIcon name="i-close" />
      </button>
    </div>

    <!-- Pinned selected summary bar: instantly inspect/unpick selections in large PSDs -->
    <div
      v-if="mode !== 'action' && selectedItems.length > 0 && (selectedItems.length > 1 || items.length > 8)"
      class="ltp-pinned"
    >
      <div class="ltp-pinned-head">
        <span class="ltp-pinned-count">已选 {{ selectedItems.length }} 层</span>
        <button
          v-if="mode === 'hybrid' && selectedItems.length > 1"
          type="button"
          class="btn-link"
          :disabled="busy"
          @click="emit('keepFirst')"
        >
          仅保留首层
        </button>
        <button
          v-else-if="mode === 'checkbox' && allowClear"
          type="button"
          class="btn-link"
          :disabled="busy"
          @click="emit('clear')"
        >
          清空
        </button>
      </div>
      <div v-if="selectedItems.length <= 6 || mode === 'checkbox'" class="ltp-pinned-chips">
        <span
          v-for="item in selectedItems.slice(0, 6)"
          :key="item.id"
          class="ltp-pin-chip"
          :title="item.path"
        >
          <span>{{ item.name }}</span>
          <button
            v-if="!keepOne || selectedItems.length > 1"
            type="button"
            class="ltp-pin-x"
            aria-label="取消选择"
            :title="`移出 ${item.name}`"
            :disabled="busy"
            @click="emit('remove', item.id)"
          >
            <AppIcon name="i-close" />
          </button>
        </span>
        <span v-if="selectedItems.length > 6" class="ltp-pin-more mono">
          +{{ selectedItems.length - 6 }}
        </span>
      </div>
    </div>

    <!-- Grouped collapsible tree list -->
    <div class="ltp-list" :style="{ maxHeight }">
      <template v-for="row in rows" :key="row.kind === 'group' ? `g:${row.key}` : row.item.id">
        <!-- Group folder row -->
        <div
          v-if="row.kind === 'group'"
          class="ltp-group"
          :data-collapsed="row.collapsed"
          :style="{ '--depth': row.depth }"
        >
          <button
            type="button"
            class="ltp-group-toggle"
            :aria-expanded="!row.collapsed"
            @click="toggleCollapse(row.key)"
          >
            <AppIcon name="i-chevron" class="ltp-chevron" />
            <AppIcon name="i-folder" class="ltp-folder-ico" />
            <span class="ltp-group-name" :title="row.name">{{ row.name }}</span>
            <span class="ltp-group-count mono">
              {{ row.selectedCount > 0 && mode !== 'action' ? `${row.selectedCount}/${row.count}` : row.count }}
            </span>
          </button>

          <input
            v-if="mode === 'checkbox' && row.memberIds.length"
            type="checkbox"
            class="ltp-group-check"
            :aria-label="`全选分组 ${row.name}`"
            :title="row.selectedCount === row.memberIds.length ? `取消全选 ${row.name}` : `全选 ${row.name}（${row.memberIds.length} 层）`"
            :checked="row.selectedCount === row.memberIds.length"
            :indeterminate.prop="row.selectedCount > 0 && row.selectedCount < row.memberIds.length"
            :disabled="busy"
            @change="emit('toggleGroup', row.memberIds, row.selectedCount === row.memberIds.length)"
          />
          <button
            v-else-if="mode === 'hybrid' && row.memberIds.length"
            type="button"
            class="ltp-group-pick"
            :aria-label="`选择整组 ${row.name}`"
            :aria-pressed="row.selectedCount === row.memberIds.length"
            :data-partial="row.selectedCount > 0 && row.selectedCount < row.memberIds.length ? 'true' : undefined"
            :title="row.selectedCount === row.memberIds.length ? `取消整组 ${row.name}` : `选择整组 ${row.name}（${row.memberIds.length} 层）`"
            :disabled="busy"
            @click.stop="emit('toggleGroup', row.memberIds, row.selectedCount === row.memberIds.length)"
          >
            {{ row.selectedCount === row.memberIds.length ? '已选整组' : '整组' }}
          </button>
        </div>

        <!-- Leaf item: hybrid mode (1-click switch + right multi-pick toggle) -->
        <div
          v-else-if="mode === 'hybrid'"
          class="ltp-hybrid-row"
          :data-selected="selectedSet.has(row.item.id) || undefined"
          :style="{ '--depth': row.depth }"
        >
          <button
            type="button"
            class="menu-item ltp-hybrid-pick"
            role="menuitemradio"
            :aria-checked="selectedSet.has(row.item.id)"
            :disabled="busy || row.item.disabled"
            @click="emit('pick', row.item.id)"
          >
            <LayerThumbnail v-if="showThumbs && row.item.image" :image="row.item.image" class="ltp-thumb" />
            <span class="ltp-item-text" :title="row.item.title ?? row.item.path">
              <small v-if="row.breadcrumb" class="ltp-crumb">{{ row.breadcrumb }} / </small>{{ row.item.name }}
            </span>
            <AppIcon v-if="items.length <= 1" class="menu-check" name="i-check" />
          </button>
          <button
            v-if="items.length > 1"
            type="button"
            class="ltp-multi-btn"
            :aria-label="
              selectedSet.has(row.item.id) ? `移出合并细拆 ${row.item.name}` : `加入合并细拆 ${row.item.name}`
            "
            :aria-pressed="selectedSet.has(row.item.id)"
            :title="selectedSet.has(row.item.id) ? '移出合并细拆' : '加入合并细拆（多选）'"
            :disabled="busy || (keepOne && selected.length === 1 && selectedSet.has(row.item.id))"
            @click.stop="emit('toggle', row.item.id)"
          >
            <AppIcon :name="selectedSet.has(row.item.id) ? 'i-check' : 'i-plus'" />
          </button>
        </div>

        <!-- Leaf item: checkbox mode (inline Scalpel source & occluders) -->
        <label
          v-else-if="mode === 'checkbox'"
          class="ltp-check-row"
          :data-checked="selectedSet.has(row.item.id)"
          :data-disabled="busy || row.item.disabled || undefined"
          :style="{ '--depth': row.depth }"
          :title="row.item.title ?? row.item.path"
        >
          <input
            type="checkbox"
            :aria-label="row.item.path"
            :checked="selectedSet.has(row.item.id)"
            :disabled="busy || row.item.disabled"
            @change="emit('toggle', row.item.id)"
          />
          <span class="ltp-item-text">
            <small v-if="row.breadcrumb" class="ltp-crumb">{{ row.breadcrumb }} / </small>{{ row.item.name }}
          </span>
        </label>

        <!-- Leaf item: action mode (ScalpelReferences PopoverMenu) -->
        <button
          v-else
          type="button"
          class="menu-item ltp-action-row"
          role="menuitem"
          :style="{ '--depth': row.depth }"
          :disabled="busy || row.item.disabled"
          :title="row.item.title ?? row.item.path"
          @click="emit('pick', row.item.id)"
        >
          <LayerThumbnail v-if="showThumbs && row.item.image" :image="row.item.image" class="ltp-thumb" />
          <span class="menu-label ltp-item-text">
            <small v-if="row.breadcrumb" class="ltp-crumb">{{ row.breadcrumb }} / </small>{{ row.item.name }}
          </span>
        </button>
      </template>

      <p v-if="!rows.length" class="ltp-empty">{{ emptyText }}</p>
    </div>
  </div>
</template>

<style scoped>
.ltp {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ltp.is-hybrid,
.ltp.is-action {
  width: 100%;
}
:global(.popover-menu.layer-tree-popover) {
  width: 276px;
  max-width: min(320px, calc(100vw - 16px));
}

.ltp-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  padding: 2px 4px 4px;
}
.ltp.is-checkbox .ltp-search-wrap {
  padding: 0 0 2px;
}
.ltp-search-ico {
  position: absolute;
  left: 12px;
  color: var(--fg-4);
  pointer-events: none;
  --ico: var(--ico-xs);
}
.ltp.is-checkbox .ltp-search-ico {
  left: 8px;
}
.ltp-search {
  width: 100%;
  height: 28px;
  padding: 0 24px 0 26px;
  font-size: var(--fz-xs);
}
.ltp-search-clear {
  position: absolute;
  right: 8px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  color: var(--fg-4);
  --ico: var(--ico-xs);
}
.ltp.is-checkbox .ltp-search-clear {
  right: 5px;
}
.ltp-search-clear:hover {
  color: var(--fg);
  background: var(--hover);
}

.ltp-pinned {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 4px 6px 6px;
  border-bottom: 1px solid var(--line);
}
.ltp.is-checkbox .ltp-pinned {
  padding: 2px 0 6px;
}
.ltp-pinned-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
}
.ltp-pinned-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ltp-pin-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 140px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--a-dim);
  color: var(--a);
  font-size: var(--fz-2xs);
  font-weight: var(--fw-medium);
}
.ltp-pin-chip > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltp-pin-x {
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
  margin-right: -2px;
  border-radius: 999px;
  color: inherit;
  opacity: 0.72;
  --ico: var(--ico-xs);
}
.ltp-pin-x:hover:not(:disabled) {
  opacity: 1;
  background: color-mix(in srgb, var(--a) 18%, transparent);
}
.ltp-pin-more {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 5px;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
}

.ltp-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0;
}

.ltp-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: calc(var(--depth, 0) * 12px);
  min-height: 26px;
  border-radius: var(--r1);
}
.ltp-group:hover {
  background: var(--hover);
}
.ltp-group-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 4px;
  text-align: left;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-2);
}
.ltp-chevron {
  flex: none;
  color: var(--fg-4);
  --ico: var(--ico-xs);
  transform: rotate(90deg);
  transition: transform var(--t1) var(--e);
}
.ltp-group[data-collapsed='true'] .ltp-chevron {
  transform: rotate(0deg);
}
.ltp-folder-ico {
  flex: none;
  color: var(--fg-3);
  --ico: var(--ico-xs);
}
.ltp-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltp-group-count {
  flex: none;
  font-size: var(--fz-2xs);
  color: var(--fg-4);
}
.ltp-group-check {
  flex: none;
  width: 13px;
  height: 13px;
  margin: 0 6px 0 2px;
  accent-color: var(--a);
  cursor: pointer;
}
.ltp-group-pick {
  flex: none;
  height: 20px;
  margin-right: 4px;
  padding: 0 6px;
  border-radius: var(--r1);
  font-size: var(--fz-2xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
  white-space: nowrap;
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.ltp-group-pick:hover:not(:disabled) {
  color: var(--fg);
  background: var(--well);
}
.ltp-group-pick[aria-pressed='true'],
.ltp-group-pick[data-partial='true'] {
  color: var(--a);
  background: var(--a-dim);
}

.ltp-hybrid-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: calc(var(--depth, 0) * 12px);
}
.ltp-hybrid-pick {
  flex: 1;
  min-width: 0;
  gap: 7px;
}
.ltp-action-row {
  width: 100%;
  gap: 7px;
  padding-left: calc(10px + var(--depth, 0) * 12px);
}

.ltp-thumb {
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 4px;
}

.ltp-item-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltp-crumb {
  font-size: var(--fz-2xs);
  color: var(--fg-4);
}

.ltp-multi-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  margin-right: 4px;
  border-radius: var(--r1);
  color: var(--fg-4);
  --ico: var(--ico-xs);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.ltp-multi-btn:hover:not(:disabled) {
  color: var(--fg);
  background: var(--hover);
}
.ltp-multi-btn[aria-pressed='true'] {
  color: var(--a);
  background: var(--a-dim);
}
.ltp-multi-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ltp-check-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 25px;
  padding: 2px 6px 2px calc(6px + var(--depth, 0) * 12px);
  border-radius: var(--r1);
  font-size: var(--fz-xs);
  color: var(--fg-2);
  cursor: pointer;
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.ltp-check-row:hover:not([data-disabled='true']) {
  background: var(--hover);
  color: var(--fg);
}
.ltp-check-row[data-checked='true'] {
  background: var(--a-dim);
  color: var(--fg);
}
.ltp-check-row[data-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.ltp-check-row input {
  width: 13px;
  height: 13px;
  flex: none;
  margin: 0;
  accent-color: var(--a);
}

.ltp-empty {
  margin: 0;
  padding: 10px 8px;
  font-size: var(--fz-xs);
  color: var(--fg-3);
  text-align: center;
}
</style>
