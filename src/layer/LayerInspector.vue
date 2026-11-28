<script setup lang="ts">
import { ref, watch } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import PopoverMenu from '../shared/ui/PopoverMenu.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const {
  project,
  busy,
  activeLayer,
  activeLayerIndex,
  visibleLayerCount,
  picker,
  transformBox,
  transformLockAspect,
  stackTool,
} = ws;

const drawer = ref<'polish' | 'transform' | null>(null);

function toggle(section: 'polish' | 'transform') {
  drawer.value = drawer.value === section ? null : section;
}

watch(
  () => activeLayer.value?.id,
  (id) => {
    if (!id) drawer.value = null;
  },
);
</script>

<template>
  <footer v-if="project" class="layer-stack-foot" aria-label="图层操作与导出">
    <!-- On-demand upward drawer content (flat, inherits panel surface, zero nested boxes) -->
    <div
      v-if="drawer && activeLayer && !activeLayer.archived"
      class="layer-drawer-body"
      role="region"
      :aria-label="drawer === 'polish' ? '单层精修' : '位置与尺寸'"
    >
      <div class="layer-drawer-caption">
        <span class="layer-drawer-target" :title="activeLayer.name">{{ activeLayer.name }}</span>
        <span class="layer-drawer-dims mono">{{ activeLayer.width }}×{{ activeLayer.height }}</span>
        <button type="button" class="ibtn ibtn-xs layer-drawer-close" aria-label="收起抽屉" @click="drawer = null">
          <AppIcon name="i-close" />
        </button>
      </div>

      <template v-if="drawer === 'polish'">
        <div class="layer-polish-list">
          <button
            type="button"
            class="layer-action-row"
            :disabled="activeLayer.locked"
            title="把当前图层未被前景遮挡的可见区无损还原为母版 1:1 清晰度（保留被遮挡的 AI 补画区）"
            @click="ws.onRestoreUnoccludedMaster()"
          >
            <AppIcon name="i-upscale" />
            <span>还原可见区原画</span>
          </button>
          <button
            type="button"
            class="layer-action-row"
            :disabled="activeLayer.locked"
            @click="ws.onAlignTone()"
          >
            <AppIcon name="i-dt-colorize" />
            <span>一键色彩对齐原画</span>
          </button>
          <button
            type="button"
            class="layer-action-row"
            :disabled="activeLayer.locked"
            title="在原图中自动搜索该图层的最佳位置与缩放比例"
            @click="ws.onAutoAlignLayer()"
          >
            <AppIcon name="i-fit" />
            <span>自动对齐原图</span>
          </button>
        </div>

        <label
          v-if="activeLayer.toneMatch"
          class="scrub scrub-sm layer-tone-scrub"
          :style="{ '--p': `${activeLayer.toneMatch.strength * 100}%` }"
        >
          <span>对色强度</span>
          <output>{{ Math.round(activeLayer.toneMatch.strength * 100) }}%</output>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            aria-label="对色强度"
            :value="activeLayer.toneMatch.strength"
            @change="ws.onAlignTone(Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </template>

      <div v-else class="layer-transform-body">
        <div class="layer-transform-grid">
          <label>
            <span>X</span>
            <input
              :value="transformBox.x"
              type="number"
              step="1"
              aria-label="图层 X 坐标"
              :disabled="activeLayer.locked"
              @input="ws.onTransformCoord('x', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label>
            <span>Y</span>
            <input
              :value="transformBox.y"
              type="number"
              step="1"
              aria-label="图层 Y 坐标"
              :disabled="activeLayer.locked"
              @input="ws.onTransformCoord('y', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label>
            <span>宽</span>
            <input
              :value="transformBox.width"
              type="number"
              min="1"
              step="1"
              aria-label="图层宽度"
              :disabled="activeLayer.locked"
              @input="ws.onTransformDimension('width', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label>
            <span>高</span>
            <input
              :value="transformBox.height"
              type="number"
              min="1"
              step="1"
              aria-label="图层高度"
              :disabled="activeLayer.locked"
              @input="ws.onTransformDimension('height', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </div>
        <div class="layer-transform-meta">
          <label class="check layer-aspect-check">
            <input v-model="transformLockAspect" type="checkbox" />
            <span></span>
            <span>锁定比例</span>
          </label>
          <button
            type="button"
            class="btn-link"
            :disabled="activeLayer.locked"
            @click="ws.fitLayerToCanvas()"
          >
            适配画布
          </button>
        </div>
        <div class="layer-transform-actions">
          <button
            type="button"
            class="btn-link"
            :disabled="activeLayer.locked"
            @click="ws.enterTransformMode()"
          >
            画布拖拽
          </button>
          <button
            type="button"
            class="btn btn-accent btn-sm layer-apply-rect"
            :disabled="activeLayer.locked"
            @click="
              stackTool === 'transform'
                ? ws.commitTransformDraft()
                : ws.applyLayerTransform({ ...transformBox })
            "
          >
            应用
          </button>
        </div>
      </div>
    </div>

    <!-- Row 1: flat bare active-layer bar (zero recessed box, zero 7-icon clutter) -->
    <div v-if="activeLayer" class="layer-foot-bar" role="toolbar" aria-label="当前图层操作">
      <div v-if="!activeLayer.archived" class="layer-foot-tabs">
        <button
          type="button"
          class="layer-bare-tab"
          :class="{ selected: drawer === 'polish' }"
          :aria-expanded="drawer === 'polish'"
          @click="toggle('polish')"
        >
          <AppIcon name="i-dt-colorize" />
          <span>精修</span>
          <i
            v-if="activeLayer.toneMatch || (activeLayer.rawScale && activeLayer.rawScale > 1.15)"
            class="layer-bare-dot"
            :class="{ warn: !activeLayer.toneMatch && !!activeLayer.rawScale && activeLayer.rawScale > 1.15 }"
            aria-hidden="true"
          ></i>
        </button>
        <button
          type="button"
          class="layer-bare-tab"
          :class="{ selected: drawer === 'transform' }"
          :aria-expanded="drawer === 'transform'"
          aria-label="调整位置与尺寸"
          @click="toggle('transform')"
        >
          <AppIcon name="i-expand" />
          <span>变换</span>
        </button>
      </div>

      <div class="layer-foot-micro">
        <button
          type="button"
          class="ibtn ibtn-xs"
          data-tip="上移一层"
          aria-label="上移一层"
          :disabled="activeLayerIndex >= project.layers.length - 1"
          @click="ws.onMoveOrder(activeLayer.id, 'up')"
        >
          <AppIcon name="i-up" />
        </button>
        <button
          type="button"
          class="ibtn ibtn-xs"
          data-tip="下移一层"
          aria-label="下移一层"
          :disabled="activeLayerIndex <= 0"
          @click="ws.onMoveOrder(activeLayer.id, 'down')"
        >
          <AppIcon name="i-down" />
        </button>
        <button
          type="button"
          class="ibtn ibtn-xs layer-op-danger"
          data-tip="删除图层"
          aria-label="删除图层"
          :disabled="activeLayer.locked"
          @click="ws.onDelete(activeLayer.id)"
        >
          <AppIcon name="i-trash" />
        </button>
      </div>
    </div>

    <!-- Row 2: single seamless split export button (primary Rig ZIP + up menu for folder / PSD) -->
    <div class="layer-export-split" :data-disabled="(busy || !project.layers.length) || undefined">
      <button
        type="button"
        class="layer-export-main"
        :disabled="busy || !visibleLayerCount"
        @click="ws.exportRigZip()"
      >
        <AppIcon name="i-download" />
        <span>导出 Rig 切片包</span>
      </button>
      <PopoverMenu
        id="layerExportMenu"
        label="更多导出方式"
        side="up"
        compact
        pointer-focus="menu"
        :menu-class="ws.props.coCreate ? 'canvas-collaboration' : undefined"
      >
        <template #trigger="{ open, toggle: toggleMenu }">
          <button
            type="button"
            class="layer-export-more"
            aria-label="更多导出方式"
            data-tip="更多导出格式"
            aria-haspopup="menu"
            :aria-expanded="open"
            :disabled="busy || !project.layers.length"
            @click="toggleMenu"
          >
            <AppIcon name="i-chevron" class="layer-export-caret" />
          </button>
        </template>
        <template #default="{ close }">
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            :disabled="busy || !visibleLayerCount"
            @click="
              close();
              ws.exportRigZip();
            "
          >
            <AppIcon name="i-download" />
            <span class="menu-label">导出 Rig 切片包</span>
            <span class="menu-meta">ZIP</span>
          </button>
          <button
            v-if="picker"
            type="button"
            class="menu-item"
            role="menuitem"
            aria-label="导出 Rig 切片目录"
            :disabled="busy || !visibleLayerCount"
            @click="
              close();
              ws.exportRigFolder();
            "
          >
            <AppIcon name="i-folder" />
            <span class="menu-label">导出切片到文件夹</span>
          </button>
          <hr />
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            :disabled="busy || !project.layers.length"
            @click="
              close();
              ws.exportPsd();
            "
          >
            <AppIcon name="i-layers" />
            <span class="menu-label">导出分层 PSD</span>
            <span class="menu-meta">PSD</span>
          </button>
        </template>
      </PopoverMenu>
    </div>
  </footer>
</template>

<style scoped>
.layer-stack-foot {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--line);
  min-width: 0;
}

.layer-drawer-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}

.layer-drawer-caption {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 2px;
}
.layer-drawer-target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg-2);
}
.layer-drawer-dims {
  flex: none;
  font-size: var(--fz-2xs);
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}
.layer-drawer-close {
  margin-left: auto;
  flex: none;
}

.layer-polish-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.layer-action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 6px;
  border-radius: var(--r2);
  color: var(--fg-2);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  text-align: left;
  white-space: nowrap;
  --ico: var(--ico-sm);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.layer-action-row > .ico {
  color: var(--fg-3);
  flex: none;
}
.layer-action-row:enabled:hover {
  background: var(--hover);
  color: var(--fg);
}
.layer-action-row:enabled:hover > .ico {
  color: var(--a);
}
.layer-action-row:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.layer-tone-scrub {
  margin-top: 2px;
}

.layer-transform-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.layer-transform-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
@container (min-width: 380px) {
  .layer-transform-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.layer-transform-grid label {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
}
.layer-transform-grid input {
  min-width: 0;
  padding: 4px 6px;
  font-size: var(--fz-xs);
  font-variant-numeric: tabular-nums;
}

.layer-transform-meta,
.layer-transform-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.layer-aspect-check {
  font-size: var(--fz-xs);
}
.layer-apply-rect {
  padding: 4px 12px;
}

/* Row 1: flat bare active-layer bar */
.layer-foot-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 26px;
}

.layer-foot-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.layer-bare-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 7px;
  border-radius: var(--r1);
  color: var(--fg-3);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  --ico: var(--ico-sm);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.layer-bare-tab:hover {
  color: var(--fg);
  background: var(--hover);
}
.layer-bare-tab.selected {
  color: var(--a);
  background: var(--a-dim);
  font-weight: var(--fw-semibold);
}

.layer-bare-dot {
  width: 4px;
  height: 4px;
  flex: none;
  border-radius: 50%;
  background: var(--a);
}
.layer-bare-dot.warn {
  background: var(--warn);
}

.layer-foot-micro {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  flex: none;
}
.layer-foot-micro .ibtn:disabled {
  opacity: 0.3;
  pointer-events: none;
}
.layer-op-danger:enabled:hover {
  color: var(--err);
  background: var(--err-dim);
}

/* Row 2: single unified seamless split export control (outer border owns hairline) */
.layer-export-split {
  display: flex;
  align-items: stretch;
  height: 34px;
  border: 1px solid var(--a-line);
  border-radius: var(--r2);
  background: var(--a-dim);
  min-width: 0;
  transition: border-color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-export-split[data-disabled] {
  opacity: 0.45;
}

.layer-export-main {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  padding: 0 10px;
  border: 0;
  border-radius: calc(var(--r2) - 1px) 0 0 calc(var(--r2) - 1px);
  background: transparent;
  color: var(--a);
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  --ico: var(--ico-sm);
  transition: background var(--t1) var(--e);
}
.layer-export-main > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.layer-export-main:enabled:hover {
  background: color-mix(in srgb, var(--a) 14%, transparent);
}
.layer-export-main:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.layer-export-more {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 100%;
  border: 0;
  border-left: 1px solid var(--a-line);
  border-radius: 0 calc(var(--r2) - 1px) calc(var(--r2) - 1px) 0;
  background: transparent;
  color: var(--a);
  --ico: var(--ico-xs);
  transition: background var(--t1) var(--e);
}
.layer-export-more:enabled:hover,
.layer-export-more[aria-expanded='true'] {
  background: color-mix(in srgb, var(--a) 14%, transparent);
}
.layer-export-more:disabled {
  cursor: not-allowed;
}
.layer-export-caret {
  transform: rotate(-90deg);
  transition: transform var(--t1) var(--e);
}
.layer-export-more[aria-expanded='true'] .layer-export-caret {
  transform: rotate(90deg);
}
</style>
