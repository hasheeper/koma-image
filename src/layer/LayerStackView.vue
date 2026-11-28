<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import PhotopeaIcon from '../shared/PhotopeaIcon.vue';
import PopoverMenu from '../shared/ui/PopoverMenu.vue';
import LayerThumbnail from './LayerThumbnail.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const {
  project,
  busy,
  multiSelect,
  multiIds,
  visibleLayerCount,
  upscaledLayerCount,
  stackDisplayItems,
  reversedLayers,
  renamingGroupKey,
  groupRenameDraft,
  activeLayerId,
  revealTarget,
  soloLayerId,
  dragOverLayerId,
  renamingId,
  renameDraft,
  recentChanges,
} = ws;

const searchOpen = ref(false);
const stackSearch = ref('');
const searchInput = shallowRef<HTMLInputElement>();
const treeScroll = shallowRef<HTMLElement>();

const filtering = computed(() => searchOpen.value && stackSearch.value.trim().length > 0);
const displayItems = computed(() => {
  const q = stackSearch.value.trim().toLowerCase();
  if (!searchOpen.value || !q) return stackDisplayItems.value;
  return reversedLayers.value
    .filter((layer) => {
      const full = [...(layer.groups ?? []), layer.name].join(' / ').toLowerCase();
      return full.includes(q);
    })
    .map((layer) => ({ kind: 'layer' as const, layer, depth: 0 }));
});

function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    void nextTick(() => searchInput.value?.focus({ preventScroll: true }));
  } else {
    stackSearch.value = '';
  }
}

function groupMultiState(path: readonly string[]) {
  const members = ws.groupMemberIds(path);
  if (!members.length) return { members, checked: false, partial: false };
  const picked = members.filter((id) => multiIds.value.includes(id)).length;
  return {
    members,
    checked: picked === members.length,
    partial: picked > 0 && picked < members.length,
  };
}

function toggleGroupMulti(path: readonly string[]) {
  const { members, checked } = groupMultiState(path);
  if (!members.length) return;
  multiIds.value = checked
    ? multiIds.value.filter((id) => !members.includes(id))
    : [...new Set([...multiIds.value, ...members])];
}

watch(revealTarget, async (target) => {
  if (!target) return;
  await nextTick();
  const root = treeScroll.value;
  if (!root) return;
  const escaped = CSS.escape(target.id);
  const row = root.querySelector<HTMLElement>(`[data-layer-id="${escaped}"]`);
  row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
</script>

<template>
  <section v-if="project" class="layer-stack" aria-label="正式图层栈">
    <!-- Clean borderless header: title + bare count + uniform bare icon buttons -->
    <header class="layer-stack-head">
      <div class="layer-stack-title">
        <h3>图层栈</h3>
        <span class="layer-count mono">{{ project.layers.length }}</span>
      </div>
      <div class="layer-stack-actions" role="group" aria-label="图层栈操作">
        <button
          v-if="project.layers.length > 6"
          type="button"
          class="ibtn ibtn-xs layer-top-ico"
          data-tip="筛选图层"
          aria-label="筛选图层"
          :aria-pressed="searchOpen"
          @click="toggleSearch"
        >
          <AppIcon name="i-search" />
        </button>
        <button
          type="button"
          class="ibtn ibtn-xs layer-top-ico"
          data-tip="导入图片或 PSD"
          aria-label="导入"
          :disabled="busy"
          @click="ws.importLayerInput.value?.click()"
        >
          <AppIcon name="i-image-plus" />
        </button>
        <button
          v-if="project.layers.length"
          type="button"
          class="ibtn ibtn-xs layer-top-ico"
          data-tip="多选图层"
          aria-label="多选"
          :aria-pressed="multiSelect"
          @click="
            multiSelect = !multiSelect;
            multiIds = [];
          "
        >
          <AppIcon name="i-tasks" />
        </button>
        <button
          v-if="ws.props.coCreate"
          type="button"
          class="ibtn ibtn-xs layer-top-ico"
          data-tip="Photopea 精修"
          aria-label="Photopea 精修"
          :disabled="busy"
          @click="ws.openInPhotopea()"
        >
          <PhotopeaIcon />
        </button>
        <PopoverMenu
          v-if="visibleLayerCount > 1"
          id="layerStackMoreMenu"
          label="整栈操作"
          side="right"
          compact
          pointer-focus="menu"
          :menu-class="ws.props.coCreate ? 'canvas-collaboration' : undefined"
        >
          <template #trigger="{ open, toggle }">
            <button
              type="button"
              class="ibtn ibtn-xs layer-top-ico layer-stack-more"
              aria-label="整栈操作"
              data-tip="更多整栈操作"
              aria-haspopup="menu"
              :aria-expanded="open"
              :disabled="busy"
              @click="toggle"
            >
              <AppIcon name="i-more" />
              <i v-if="upscaledLayerCount" class="layer-more-dot" aria-hidden="true"></i>
            </button>
          </template>
          <template #default="{ close }">
            <button
              type="button"
              class="menu-item"
              role="menuitem"
              :disabled="busy"
              @click="
                close();
                ws.onRestoreAllMaster();
              "
            >
              <AppIcon name="i-upscale" />
              <span class="menu-label">{{
                upscaledLayerCount ? `批量锐化未遮挡区` : '全栈还原可见区原画'
              }}</span>
              <span v-if="upscaledLayerCount" class="menu-meta">{{ upscaledLayerCount }} 层</span>
            </button>
          </template>
        </PopoverMenu>
        <button
          v-if="!ws.props.coCreate"
          type="button"
          class="ibtn ibtn-xs layer-top-ico"
          data-tip="收起图层栏"
          aria-label="收起图层栏"
          @click="ws.emit('collapseRail')"
        >
          <AppIcon name="i-sidebar" />
        </button>
      </div>
    </header>

    <!-- On-demand search filter bar for large 100+ layer PSDs -->
    <div v-if="searchOpen" class="layer-search-bar">
      <AppIcon name="i-search" class="layer-search-ico" />
      <input
        ref="searchInput"
        v-model="stackSearch"
        type="search"
        class="layer-search-input"
        aria-label="筛选图层栈"
        placeholder="搜索图层或分组…"
        @keydown.escape.prevent="toggleSearch"
      />
      <span v-if="filtering" class="layer-search-count mono">{{ displayItems.length }}</span>
      <button
        type="button"
        class="ibtn ibtn-xs layer-search-close"
        aria-label="关闭图层筛选"
        @click="toggleSearch"
      >
        <AppIcon name="i-close" />
      </button>
    </div>

    <!-- Contextual multi-select batch bar (flat accent tint, zero borders) -->
    <div v-if="multiSelect" class="layer-multi-bar" role="group" aria-label="批量图层操作">
      <span class="mono">已选 {{ multiIds.length }} 层</span>
      <button
        v-if="multiIds.length"
        type="button"
        class="btn-link"
        @click="
          ws.focusSplit('layers', [...multiIds]);
          multiSelect = false;
        "
      >
        细拆所选 {{ multiIds.length }} 层
      </button>
      <button
        v-if="multiIds.length"
        type="button"
        class="btn-link"
        :disabled="busy"
        @click="
          ws.chooseScalpelLayers(multiIds);
          multiSelect = false;
        "
      >
        补画所选 {{ multiIds.length }} 层
      </button>
    </div>

    <!-- Independent scrollable layer tree: fills full vertical space cleanly -->
    <div ref="treeScroll" class="layer-tree-scroll">
      <p v-if="!project.layers.length" class="layer-empty-hint">
        拆层收纳、局部补画、导入图层或进入 Photopea 后，图层会排在这里。
      </p>
      <p v-else-if="filtering && !displayItems.length" class="layer-empty-hint">没有匹配的图层。</p>

      <ul v-else class="layer-stack-list" role="list">
        <template
          v-for="(entry, entryIndex) in displayItems"
          :key="entry.kind === 'group' ? `g:${entry.key}` : entry.layer.id"
        >
          <li
            v-if="entry.kind === 'group'"
            class="layer-group-row"
            :data-hidden="!entry.visible"
            :data-solo="entry.solo"
            :data-collapsed="entry.collapsed"
            :style="{ '--depth': entry.depth }"
            @click="ws.onToggleGroupCollapse(entry.key)"
          >
            <input
              v-if="multiSelect && groupMultiState(entry.path).members.length"
              class="layer-multi-check"
              type="checkbox"
              :checked="groupMultiState(entry.path).checked"
              :indeterminate.prop="groupMultiState(entry.path).partial"
              :aria-label="`全选分组 ${entry.name}`"
              @click.stop
              @change="toggleGroupMulti(entry.path)"
            />
            <span class="layer-group-chevron" aria-hidden="true">
              <AppIcon name="i-chevron" />
            </span>
            <AppIcon name="i-folder" class="layer-group-folder" />
            <input
              v-if="renamingGroupKey === entry.key"
              v-model="groupRenameDraft"
              type="text"
              class="layer-rename-input layer-group-rename-input"
              aria-label="输入新分组名称"
              @click.stop
              @keydown.enter.prevent="ws.commitRenameGroup(entry.key)"
              @keydown.escape.prevent="renamingGroupKey = ''"
              @blur="ws.commitRenameGroup(entry.key)"
            />
            <strong
              v-else
              class="layer-group-name"
              @dblclick.stop="ws.startRenameGroup(entry.key, entry.path, entry.name)"
            >
              {{ entry.name }}
            </strong>

            <!-- Quiet resting state indicators (only abnormal states + bare count) -->
            <span class="layer-row-status" aria-hidden="true">
              <small class="layer-group-count mono">{{ entry.count }}</small>
              <AppIcon v-if="!entry.visible" name="i-eye-off" class="layer-status-ico" />
              <span v-if="entry.solo" class="layer-status-solo">S</span>
            </span>

            <!-- Hover/focus overlay controls: never steals resting text width -->
            <div class="layer-row-controls" @click.stop>
              <button
                type="button"
                class="layer-flag"
                :aria-pressed="entry.visible"
                :aria-label="`显隐分组 ${entry.name}`"
                title="显示 / 隐藏整组"
                @click="ws.onToggleGroupVisible(entry.path)"
              >
                <AppIcon :name="entry.visible ? 'i-eye' : 'i-eye-off'" />
              </button>
              <button
                type="button"
                class="layer-flag solo"
                :aria-pressed="entry.solo"
                :aria-label="`独显分组 ${entry.name}`"
                title="独显整组"
                @click="ws.onToggleGroupSolo(entry.key)"
              >
                S
              </button>
              <PopoverMenu
                compact
                pointer-focus="menu"
                close-on-scroll="outside"
                side="right"
                :id="`layer-group-menu-${entryIndex}`"
                :label="`分组操作 ${entry.name}`"
                :menu-class="ws.props.coCreate ? 'canvas-collaboration' : undefined"
              >
                <template #trigger="{ open: shown, toggle }">
                  <button
                    type="button"
                    class="layer-flag"
                    :aria-label="`分组操作 ${entry.name}`"
                    aria-haspopup="menu"
                    :aria-expanded="shown"
                    title="分组操作"
                    @click="toggle"
                  >
                    <AppIcon name="i-more" />
                  </button>
                </template>
                <template #default="{ close: dismiss }">
                  <button
                    v-if="ws.groupMemberIds(entry.path).length"
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    :disabled="busy"
                    @click="
                      dismiss();
                      ws.focusSplit('layers', ws.groupMemberIds(entry.path));
                    "
                  >
                    <AppIcon name="i-branch" />
                    <span class="menu-label">细拆整组</span>
                    <span class="menu-meta">{{ ws.groupMemberIds(entry.path).length }} 层</span>
                  </button>
                  <button
                    v-if="ws.groupMemberIds(entry.path).length"
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    :disabled="busy"
                    @click="
                      dismiss();
                      ws.chooseScalpelLayers(ws.groupMemberIds(entry.path));
                    "
                  >
                    <AppIcon name="i-dt-wand" />
                    <span class="menu-label">设为补画底图</span>
                  </button>
                  <hr v-if="ws.groupMemberIds(entry.path).length" />
                  <button
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.startRenameGroup(entry.key, entry.path, entry.name);
                    "
                  >
                    <AppIcon name="i-rename" />
                    <span class="menu-label">重命名分组</span>
                  </button>
                  <button
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.onUngroup(entry.key, entry.path, entry.name);
                    "
                  >
                    <AppIcon name="i-layers" />
                    <span class="menu-label">解散分组</span>
                  </button>
                  <hr />
                  <button
                    class="menu-item danger"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.onDeleteGroup(entry.key, entry.path, entry.name);
                    "
                  >
                    <AppIcon name="i-trash" />
                    <span class="menu-label">删除整组</span>
                  </button>
                </template>
              </PopoverMenu>
            </div>
          </li>

          <li
            v-else
            class="layer-stack-row"
            :data-layer-id="entry.layer.id"
            :data-active="entry.layer.id === activeLayerId"
            :data-hidden="!entry.layer.visible"
            :data-archived="entry.layer.archived || undefined"
            :data-solo="soloLayerId === entry.layer.id"
            :data-drop="dragOverLayerId === entry.layer.id"
            :style="{ '--depth': entry.depth }"
            draggable="true"
            @dragstart="ws.onDragStart($event, entry.layer.id)"
            @dragover="ws.onDragOver($event, entry.layer.id)"
            @drop="ws.onDrop($event, entry.layer.id)"
            @dragend="ws.onDragEnd()"
            @click="ws.selectLayer(entry.layer.id)"
          >
            <input
              v-if="multiSelect && !entry.layer.archived"
              class="layer-multi-check"
              type="checkbox"
              :checked="multiIds.includes(entry.layer.id)"
              :aria-label="`选择送拆 ${entry.layer.name}`"
              @click.stop
              @change="
                multiIds = multiIds.includes(entry.layer.id)
                  ? multiIds.filter((x) => x !== entry.layer.id)
                  : [...multiIds, entry.layer.id]
              "
            />
            <LayerThumbnail
              :image="{ width: entry.layer.width, height: entry.layer.height, data: entry.layer.pixels }"
              :alt="entry.layer.name"
              class="layer-stack-thumb"
            />
            <div class="layer-stack-meta">
              <input
                v-if="renamingId === entry.layer.id"
                v-model="renameDraft"
                type="text"
                class="layer-rename-input"
                aria-label="输入新图层名称"
                @click.stop
                @keydown.enter.prevent="ws.commitRename(entry.layer.id)"
                @keydown.escape.prevent="renamingId = ''"
                @blur="ws.commitRename(entry.layer.id)"
              />
              <strong v-else @dblclick.stop="ws.startRename(entry.layer)">{{ entry.layer.name }}</strong>
              <small class="mono">
                <span v-if="filtering && entry.layer.groups?.length" class="layer-crumb-inline">{{ entry.layer.groups.join(' / ') }} · </span>{{ entry.layer.width }}×{{ entry.layer.height }}
                <span v-if="entry.layer.archived" class="layer-tag">已归档</span>
                <span
                  v-if="recentChanges[entry.layer.id]"
                  class="layer-tag accent layer-change-badge"
                  :title="recentChanges[entry.layer.id] === 'new' ? '本次 Photopea 精修新增' : '本次 Photopea 精修已更新'"
                >
                  {{ recentChanges[entry.layer.id] === 'new' ? '新增' : '已修' }}
                </span>
                <span
                  v-if="entry.layer.rawScale && entry.layer.rawScale > 1.15"
                  class="layer-tag warn"
                  :title="`原始回图按 ${entry.layer.rawScale.toFixed(1)}× 放大落位；可打开底部「精修 → 还原可见区原画」恢复母版清晰度`"
                >
                  {{ entry.layer.rawScale.toFixed(1) }}×
                </span>
              </small>
            </div>

            <!-- Quiet resting state indicators (only abnormal states) -->
            <span class="layer-row-status" aria-hidden="true">
              <AppIcon v-if="!entry.layer.visible" name="i-eye-off" class="layer-status-ico" />
              <span v-if="soloLayerId === entry.layer.id" class="layer-status-solo">S</span>
              <AppIcon v-if="entry.layer.locked" name="i-lock" class="layer-status-ico is-locked" />
            </span>

            <!-- Hover/focus overlay controls -->
            <div class="layer-row-controls" @click.stop>
              <button
                type="button"
                class="layer-flag"
                :aria-pressed="entry.layer.visible"
                :aria-label="`显隐 ${entry.layer.name}`"
                title="显示 / 隐藏"
                @click="ws.onToggleVisible(entry.layer.id)"
              >
                <AppIcon :name="entry.layer.visible ? 'i-eye' : 'i-eye-off'" />
              </button>
              <button
                type="button"
                class="layer-flag solo"
                :aria-pressed="soloLayerId === entry.layer.id"
                :aria-label="`独显 ${entry.layer.name}`"
                title="独显此层"
                @click="ws.onToggleSolo(entry.layer.id)"
              >
                S
              </button>
              <button
                type="button"
                class="layer-flag"
                :aria-pressed="entry.layer.locked"
                :aria-label="`锁定 ${entry.layer.name}`"
                title="锁定 / 解锁"
                @click="ws.onToggleLock(entry.layer.id)"
              >
                <AppIcon name="i-lock" />
              </button>
              <PopoverMenu
                compact
                pointer-focus="menu"
                close-on-scroll="outside"
                side="right"
                :id="`layer-row-menu-${entryIndex}`"
                :label="`更多操作 ${entry.layer.name}`"
                :menu-class="ws.props.coCreate ? 'canvas-collaboration' : undefined"
              >
                <template #trigger="{ open: shown, toggle }">
                  <button
                    type="button"
                    class="layer-flag"
                    :aria-label="`更多操作 ${entry.layer.name}`"
                    aria-haspopup="menu"
                    :aria-expanded="shown"
                    title="更多操作"
                    @click="toggle"
                  >
                    <AppIcon name="i-more" />
                  </button>
                </template>
                <template #default="{ close: dismiss }">
                  <button
                    v-if="!entry.layer.archived"
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.selectLayer(entry.layer.id);
                      ws.focusSplit('layers', [entry.layer.id]);
                    "
                  >
                    <AppIcon name="i-branch" />
                    <span class="menu-label">继续细拆此件</span>
                  </button>
                  <button
                    v-if="entry.layer.archived"
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.restoreSource(entry.layer);
                    "
                  >
                    <AppIcon name="i-undo" />
                    <span class="menu-label">恢复原件</span>
                  </button>
                  <button
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.startRename(entry.layer);
                    "
                  >
                    <AppIcon name="i-rename" />
                    <span class="menu-label">重命名</span>
                  </button>
                  <button
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.onDuplicate(entry.layer.id);
                    "
                  >
                    <AppIcon name="i-copy" />
                    <span class="menu-label">复制</span>
                  </button>
                  <button
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    :disabled="entry.layer.archived || entry.layer.locked"
                    @click="
                      dismiss();
                      ws.onMergeDown(entry.layer.id);
                    "
                  >
                    <AppIcon name="i-layers" />
                    <span class="menu-label">向下合并</span>
                  </button>
                  <button
                    class="menu-item"
                    role="menuitem"
                    type="button"
                    @click="
                      dismiss();
                      ws.downloadSingleLayer(entry.layer);
                    "
                  >
                    <AppIcon name="i-download" />
                    <span class="menu-label">导出单层 PNG</span>
                  </button>
                  <hr />
                  <button
                    class="menu-item danger"
                    role="menuitem"
                    type="button"
                    :disabled="entry.layer.locked"
                    @click="
                      dismiss();
                      ws.onDelete(entry.layer.id);
                    "
                  >
                    <AppIcon name="i-trash" />
                    <span class="menu-label">删除</span>
                  </button>
                </template>
              </PopoverMenu>
            </div>
          </li>
        </template>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.layer-stack {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.layer-stack-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 8px 6px 10px;
  min-width: 0;
}

.layer-stack-title {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.layer-stack-title h3 {
  margin: 0;
  flex: none;
  white-space: nowrap;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg-2);
}

.layer-count {
  font-size: var(--fz-2xs);
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}

.layer-stack-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: none;
}

.layer-top-ico {
  position: relative;
  color: var(--fg-3);
  --ico: var(--ico-sm);
}
.layer-top-ico:enabled:hover {
  color: var(--fg);
}
.layer-top-ico[aria-pressed='true'] {
  color: var(--a);
  background: transparent;
}
.layer-top-ico:disabled {
  opacity: 0.35;
  pointer-events: none;
}

.layer-more-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--warn);
  pointer-events: none;
}

.layer-multi-bar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 12px 6px;
  padding: 5px 10px;
  border-radius: var(--r2);
  background: var(--a-dim);
  font-size: var(--fz-xs);
  color: var(--fg);
}
.layer-multi-bar > span {
  margin-right: auto;
  color: var(--a);
  font-weight: var(--fw-semibold);
}

.layer-tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 2px 8px 8px;
}

.layer-empty-hint {
  margin: 8px 6px;
  font-size: var(--fz-xs);
  line-height: 1.55;
  color: var(--fg-3);
}

.layer-stack-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.layer-group-row,
.layer-stack-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 5px 6px;
  padding-left: calc(6px + var(--depth, 0) * 14px);
  border-radius: var(--r2);
  cursor: pointer;
  user-select: none;
  --row-bg: var(--chrome);
  transition: background var(--t1) var(--e), opacity var(--t1) var(--e);
}
.layer-group-row:hover,
.layer-stack-row:hover {
  background: var(--hover);
  --row-bg: var(--hover);
}
.layer-group-row[data-hidden='true'],
.layer-stack-row[data-hidden='true'] {
  opacity: 0.45;
}
.layer-group-row[data-solo='true'],
.layer-stack-row[data-active='true'] {
  background: var(--a-dim);
  --row-bg: color-mix(in srgb, var(--chrome) 84%, var(--a));
}
.layer-stack-row[data-active='true']::before {
  content: '';
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: 0;
  width: 2px;
  border-radius: 2px;
  background: var(--a);
}
.layer-stack-row[data-drop='true'] {
  box-shadow: inset 0 2px 0 var(--a);
}
.layer-stack-row[data-archived='true'] {
  opacity: 0.48;
}

.layer-group-chevron {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--fg-4);
  --ico: var(--ico-xs);
  transform: rotate(90deg);
  transition: transform var(--t1) var(--e);
}
.layer-group-row[data-collapsed='true'] .layer-group-chevron {
  transform: rotate(0deg);
}

.layer-group-folder {
  flex: none;
  color: var(--fg-3);
  --ico: var(--ico-sm);
}

.layer-group-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}

.layer-multi-check {
  width: 14px;
  height: 14px;
  margin: 0;
  flex: none;
  accent-color: var(--a);
}

.layer-stack-thumb {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--r1);
}

.layer-stack-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1 1 auto;
  min-width: 0;
}
.layer-stack-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.layer-stack-row[data-active='true'] .layer-stack-meta strong {
  font-weight: var(--fw-semibold);
}
.layer-stack-meta small {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fz-2xs);
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}

.layer-rename-input {
  width: 100%;
  min-width: 0;
  padding: 2px 6px;
  font-size: var(--fz-xs);
}

.layer-tag {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--well);
  font-family: var(--sans);
  font-size: var(--fz-2xs);
  color: var(--fg-3);
}
.layer-tag.accent {
  background: var(--a-dim);
  color: var(--a);
}
.layer-tag.warn {
  background: color-mix(in srgb, var(--warn) 16%, transparent);
  color: var(--warn);
}

/* Resting status: only bare count + abnormal states (hidden/solo/locked) */
.layer-row-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  margin-left: auto;
  padding-right: 2px;
}
.layer-group-count {
  font-size: var(--fz-2xs);
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}
.layer-status-ico {
  color: var(--fg-3);
  --ico: var(--ico-xs);
}
.layer-status-ico.is-locked {
  color: var(--fg-2);
}
.layer-status-solo {
  font-family: var(--mono);
  font-size: var(--fz-2xs);
  font-weight: var(--fw-bold);
  color: var(--a);
}

.layer-row-controls {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: none;
}

@media (hover: hover) {
  .layer-row-controls {
    position: absolute;
    top: 50%;
    right: 4px;
    padding-left: 14px;
    background: linear-gradient(90deg, transparent, var(--row-bg) 14px);
    transform: translateY(-50%);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--t1) var(--e);
  }
  .layer-row-controls > * {
    pointer-events: auto;
  }
  .layer-group-row:is(:hover, :focus-within) .layer-row-controls,
  .layer-stack-row:is(:hover, :focus-within) .layer-row-controls,
  .layer-row-controls:has([aria-expanded='true']) {
    opacity: 1;
  }
  .layer-group-row:is(:hover, :focus-within) .layer-row-status,
  .layer-stack-row:is(:hover, :focus-within) .layer-row-status,
  .layer-group-row:has([aria-expanded='true']) .layer-row-status,
  .layer-stack-row:has([aria-expanded='true']) .layer-row-status {
    opacity: 0;
  }
}

.layer-flag {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--r1);
  color: var(--fg-3);
  font-size: var(--fz-2xs);
  --ico: var(--ico-sm);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
@media (hover: none) {
  .layer-row-status {
    display: none;
  }
  .layer-flag {
    width: 28px;
    height: 28px;
  }
}
.layer-flag:hover {
  color: var(--fg);
  background: var(--ghost-hover);
}
.layer-flag.solo {
  font-family: var(--mono);
  font-weight: var(--fw-semibold);
}
.layer-flag.solo[aria-pressed='true'] {
  color: var(--a);
}
.layer-flag[aria-pressed='true']:not(.solo) {
  color: var(--fg-2);
}

.layer-search-bar {
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 6px;
  border-bottom: 1px solid var(--line);
}
.layer-search-ico {
  position: absolute;
  left: 18px;
  color: var(--fg-4);
  pointer-events: none;
  --ico: var(--ico-xs);
}
.layer-search-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px 0 24px;
  font-size: var(--fz-xs);
}
.layer-search-count {
  flex: none;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
}
.layer-search-close {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--fg-3);
  --ico: var(--ico-xs);
}
.layer-crumb-inline {
  font-family: var(--sans);
  color: var(--fg-4);
}
</style>
