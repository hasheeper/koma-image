<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import PopoverMenu from '../shared/ui/PopoverMenu.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const {
  project,
  mode,
  missingMode,
  stackTool,
  guideTool,
  erasingGuide,
  hasScalpelGuide,
  guideDiameter,
  smartSnap,
  activeLayer,
  commitMove,
  transformDraft,
  transformGhostRef,
  transformOpacity,
  transformLockAspect,
  brushDiameter,
  brushHardness,
  smudgeStrength,
  hasPendingSelection,
  scope,
  canUndo,
  canRedo,
  busy,
  showViewSwitch,
  showingReference,
  mat,
} = ws;

const hasSubBar = computed(
  () =>
    (mode.value === 'stack' &&
      ((stackTool.value === 'transform' && !!transformDraft.value) ||
        stackTool.value === 'erase' ||
        stackTool.value === 'restore' ||
        stackTool.value === 'smudge' ||
        (hasPendingSelection.value && scope.value !== 'region'))) ||
    (mode.value === 'scalpel' && !missingMode.value),
);

const matLabels = { checker: '棋盘底板', black: '纯黑底板', white: '纯白底板' } as const;
</script>

<template>
  <Teleport v-if="ws.props.dock && project" :to="ws.props.dock">
    <div class="layer-dock-wrap" :class="{ 'is-beta': ws.props.coCreate }">
      <!-- Upper contextual capsule: sits ABOVE primary dock ONLY when a tool needs sliders or confirmation -->
      <div v-if="hasSubBar" class="layer-dock-sub editor-tool-capsule" role="group" aria-label="当前工具选项">
        <template v-if="stackTool === 'transform' && transformDraft">
          <label class="layer-dock-switch" title="在底层显示锁定原图，便于手动对齐轮廓">
            <input v-model="transformGhostRef" type="checkbox" role="switch" />
            <span class="switch" aria-hidden="true"></span>
            <span>叠显原图</span>
          </label>
          <label v-if="transformGhostRef" class="layer-dock-slider">
            <span>透明</span>
            <input
              v-model.number="transformOpacity"
              type="range"
              min="0.2"
              max="1"
              step="0.05"
              aria-label="对齐图层透明度"
            />
            <output class="mono">{{ Math.round(transformOpacity * 100) }}%</output>
          </label>
          <label class="layer-dock-switch">
            <input v-model="transformLockAspect" type="checkbox" role="switch" />
            <span class="switch" aria-hidden="true"></span>
            <span>锁定比例</span>
          </label>
          <span class="layer-dock-sep" aria-hidden="true"></span>
          <button type="button" class="layer-dock-pill-btn" @click="ws.fitLayerToCanvas()">适配画布</button>
          <button type="button" class="btn btn-accent btn-sm layer-dock-confirm" @click="ws.commitTransformDraft()">
            <AppIcon name="i-check" />
            应用变换
          </button>
          <button type="button" class="layer-dock-pill-btn" @click="ws.exitTransformMode()">取消</button>
        </template>

        <template v-else-if="stackTool === 'erase' || stackTool === 'restore'">
          <label class="layer-dock-slider">
            <span>笔径</span>
            <input
              v-model.number="brushDiameter"
              type="range"
              min="4"
              max="160"
              step="2"
              aria-label="画笔直径"
            />
            <output class="mono">{{ brushDiameter }}px</output>
          </label>
          <span class="layer-dock-sep" aria-hidden="true"></span>
          <label class="layer-dock-slider">
            <span>硬度</span>
            <input
              v-model.number="brushHardness"
              type="range"
              min="0"
              max="1"
              step="0.05"
              aria-label="画笔硬度"
            />
            <output class="mono">{{ Math.round(brushHardness * 100) }}%</output>
          </label>
        </template>

        <template v-else-if="stackTool === 'smudge'">
          <label class="layer-dock-slider">
            <span>笔径</span>
            <input
              v-model.number="brushDiameter"
              type="range"
              min="4"
              max="160"
              step="2"
              aria-label="拽边笔径"
            />
            <output class="mono">{{ brushDiameter }}px</output>
          </label>
          <span class="layer-dock-sep" aria-hidden="true"></span>
          <label class="layer-dock-slider">
            <span>强度</span>
            <input
              v-model.number="smudgeStrength"
              type="range"
              min="0.1"
              max="0.98"
              step="0.02"
              aria-label="拽边强度"
            />
            <output class="mono">{{ Math.round(smudgeStrength * 100) }}%</output>
          </label>
        </template>

        <template v-else-if="mode === 'stack' && hasPendingSelection && scope !== 'region'">
          <button type="button" class="btn btn-accent btn-sm layer-dock-confirm" @click="ws.executeSplitSelection()">
            <AppIcon name="i-branch" />
            拆分为新图层
          </button>
          <button type="button" class="layer-dock-pill-btn" @click="ws.clearPendingSelection()">取消选区</button>
        </template>

        <template v-else-if="mode === 'scalpel' && !missingMode">
          <label class="layer-dock-slider">
            <span>笔径</span>
            <input
              v-model.number="guideDiameter"
              type="range"
              min="4"
              max="160"
              step="2"
              aria-label="选区笔径"
            />
            <output class="mono">{{ guideDiameter }}px</output>
          </label>
          <template v-if="guideTool === 'alpha'">
            <span class="layer-dock-sep" aria-hidden="true"></span>
            <label class="layer-dock-switch" title="自动贴合线稿边界">
              <input v-model="smartSnap" type="checkbox" role="switch" aria-label="边缘吸附" />
              <span class="switch" aria-hidden="true"></span>
              <span>边缘吸附</span>
            </label>
          </template>
        </template>
      </div>

      <!-- Lower primary glass capsule: matches EDIT editor-main-tools -->
      <div class="layer-dock editor-tool-capsule" role="toolbar" aria-label="分件画布工具">
        <template v-if="mode === 'stack'">
          <div class="layer-dock-group" role="group" aria-label="移动与对齐">
            <div class="layer-dock-split" :data-active="stackTool === 'move'">
              <button
                type="button"
                class="layer-dock-btn layer-dock-split-main"
                aria-label="移动"
                :data-tip="commitMove ? '直接移动图层（保留位置）· V' : '掀开检查（松手回弹）· V'"
                :aria-pressed="stackTool === 'move'"
                @click="
                  stackTool = 'move';
                  ws.clearPendingSelection();
                "
              >
                <AppIcon name="i-select-cursor" />
              </button>
              <PopoverMenu
                id="layerMoveModeMenu"
                label="移动模式"
                side="up"
                compact
                pointer-focus="menu"
                menu-class="editor-flyout"
              >
                <template #trigger="{ open, toggle }">
                  <button
                    type="button"
                    class="layer-dock-split-arrow"
                    aria-label="选择移动模式"
                    :data-tip="commitMove ? '当前：直接移动图层' : '切换移动模式'"
                    aria-haspopup="menu"
                    :aria-expanded="open"
                    @click="toggle"
                  >
                    <AppIcon name="i-chevron" class="layer-dock-caret" />
                    <i v-if="commitMove" class="layer-dock-mode-dot" aria-hidden="true"></i>
                  </button>
                </template>
                <template #default="{ close }">
                  <button
                    type="button"
                    class="menu-item"
                    role="menuitemradio"
                    :aria-checked="!commitMove"
                    @click="
                      commitMove = false;
                      stackTool = 'move';
                      ws.clearPendingSelection();
                      close(true);
                    "
                  >
                    <AppIcon name="i-eye" />
                    <span class="menu-label">掀开检查</span>
                    <span class="menu-meta">松手回弹</span>
                    <AppIcon class="menu-check" name="i-check" />
                  </button>
                  <button
                    type="button"
                    class="menu-item"
                    role="menuitemradio"
                    :aria-checked="commitMove"
                    @click="
                      commitMove = true;
                      stackTool = 'move';
                      ws.clearPendingSelection();
                      close(true);
                    "
                  >
                    <AppIcon name="i-select-cursor" />
                    <span class="menu-label">直接移动图层</span>
                    <span class="menu-meta">保留偏移</span>
                    <AppIcon class="menu-check" name="i-check" />
                  </button>
                </template>
              </PopoverMenu>
            </div>
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="缩放对齐"
              data-tip="缩放对齐 · T"
              :aria-pressed="stackTool === 'transform'"
              :disabled="!activeLayer || activeLayer.locked || activeLayer.archived"
              @click="ws.enterTransformMode()"
            >
              <AppIcon name="i-expand" />
            </button>
          </div>

          <span class="layer-dock-sep" aria-hidden="true"></span>

          <div class="layer-dock-group" role="group" aria-label="像素精修">
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="橡皮"
              data-tip="软硬橡皮 · E"
              :aria-pressed="stackTool === 'erase'"
              @click="
                stackTool = 'erase';
                ws.clearPendingSelection();
              "
            >
              <AppIcon name="i-eraser" />
            </button>
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="刷回原图"
              data-tip="刷回原图 · R"
              :aria-pressed="stackTool === 'restore'"
              @click="
                stackTool = 'restore';
                ws.clearPendingSelection();
              "
            >
              <AppIcon name="i-brush" />
            </button>
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="拽边笔"
              data-tip="拽边笔 · S"
              :aria-pressed="stackTool === 'smudge'"
              @click="
                stackTool = 'smudge';
                ws.clearPendingSelection();
              "
            >
              <AppIcon name="i-dt-sketch" />
            </button>
          </div>

          <span class="layer-dock-sep" aria-hidden="true"></span>

          <div class="layer-dock-group" role="group" aria-label="切分选区">
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="框选拆分"
              data-tip="框选拆分 · M"
              :aria-pressed="stackTool === 'rect'"
              @click="stackTool = 'rect'"
            >
              <AppIcon name="i-select-rect" />
            </button>
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="套索拆分"
              data-tip="套索拆分 · L"
              :aria-pressed="stackTool === 'lasso'"
              @click="stackTool = 'lasso'"
            >
              <AppIcon name="i-select-polygon" />
            </button>
          </div>
        </template>

        <template v-else>
          <div v-if="!missingMode" class="layer-dock-group" role="group" aria-label="局部补画选区">
            <button
              type="button"
              class="layer-dock-text-btn"
              :aria-pressed="guideTool === 'alpha' && !erasingGuide"
              @click="
                guideTool = 'alpha';
                erasingGuide = false;
              "
            >
              <span class="layer-swatch alpha" aria-hidden="true"></span>
              <span>保留原件</span>
            </button>
            <button
              type="button"
              class="layer-dock-text-btn"
              :aria-pressed="guideTool === 'occluded' && !erasingGuide"
              @click="
                guideTool = 'occluded';
                erasingGuide = false;
              "
            >
              <span class="layer-swatch fill" aria-hidden="true"></span>
              <span>遮挡补全</span>
            </button>
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="橡皮"
              data-tip="擦除选区"
              :aria-pressed="erasingGuide"
              @click="erasingGuide = !erasingGuide"
            >
              <AppIcon name="i-eraser" />
            </button>
            <button
              type="button"
              class="layer-dock-btn"
              aria-label="清空选区"
              data-tip="清空选区"
              :disabled="!hasScalpelGuide || busy"
              @click="ws.clearScalpelGuides()"
            >
              <AppIcon name="i-trash" />
            </button>
          </div>
          <span v-if="!missingMode" class="layer-dock-sep" aria-hidden="true"></span>
          <button
            type="button"
            class="layer-dock-text-btn"
            @click="
              ws.props.coCreate ? ws.selectBetaTab('stack') : ws.selectTraditionalMode('stack')
            "
          >
            <AppIcon name="i-back" />
            <span>返回图层</span>
          </button>
        </template>

        <span class="layer-dock-sep" aria-hidden="true"></span>

        <div class="layer-dock-group" role="group" aria-label="历史操作">
          <button
            type="button"
            class="layer-dock-btn"
            aria-label="撤销"
            data-tip="撤销 · ⌘Z"
            :disabled="!canUndo || busy"
            @click="ws.undoRedo('undo')"
          >
            <AppIcon name="i-undo" />
          </button>
          <button
            type="button"
            class="layer-dock-btn"
            aria-label="重做"
            data-tip="重做 · ⇧⌘Z"
            :disabled="!canRedo || busy"
            @click="ws.undoRedo('redo')"
          >
            <AppIcon name="i-redo" />
          </button>
        </div>

        <span class="layer-dock-sep" aria-hidden="true"></span>

        <div class="layer-dock-group" role="group" aria-label="画布视图">
          <button
            v-if="!showViewSwitch"
            type="button"
            class="layer-dock-btn"
            aria-label="对照原图"
            data-tip="对照原图 · \"
            :aria-pressed="showingReference"
            @click="ws.setReferenceView(!ws.compareReference.value)"
          >
            <AppIcon name="i-compare" />
          </button>

          <PopoverMenu
            id="layerMatMenu"
            label="画布底板"
            side="up"
            compact
            pointer-focus="menu"
            menu-class="editor-flyout"
          >
            <template #trigger="{ open, toggle }">
              <button
                type="button"
                class="layer-dock-btn"
                aria-label="画布底板"
                :data-tip="matLabels[mat]"
                aria-haspopup="menu"
                :aria-expanded="open"
                @click="toggle"
              >
                <i class="layer-mat-dot" :class="mat" aria-hidden="true"></i>
              </button>
            </template>
            <template #default="{ close }">
              <button
                v-for="item in [
                  { id: 'checker', label: '棋盘透明底' },
                  { id: 'black', label: '纯黑底板' },
                  { id: 'white', label: '纯白底板' },
                ] as const"
                :key="item.id"
                type="button"
                class="menu-item"
                role="menuitemradio"
                :aria-checked="mat === item.id"
                @click="
                  mat = item.id;
                  close(true);
                "
              >
                <i class="layer-mat-dot" :class="item.id" aria-hidden="true"></i>
                <span class="menu-label">{{ item.label }}</span>
                <AppIcon class="menu-check" name="i-check" />
              </button>
            </template>
          </PopoverMenu>

          <PopoverMenu
            id="layerZoomMenu"
            label="分件画布缩放"
            side="up"
            compact
            pointer-focus="menu"
            menu-class="editor-flyout"
          >
            <template #trigger="{ open, toggle }">
              <button
                type="button"
                class="layer-dock-btn"
                aria-label="缩放画布"
                data-tip="画布缩放"
                aria-haspopup="menu"
                :aria-expanded="open"
                @click="toggle"
              >
                <AppIcon name="i-fit" />
              </button>
            </template>
            <template #default="{ close }">
              <button type="button" class="menu-item" role="menuitem" @click="ws.emit('zoomStep', 1)">
                <AppIcon name="i-zoom-in" />
                <span class="menu-label">放大</span>
                <span class="menu-meta">⌘ +</span>
              </button>
              <button type="button" class="menu-item" role="menuitem" @click="ws.emit('zoomStep', -1)">
                <AppIcon name="i-zoom-out" />
                <span class="menu-label">缩小</span>
                <span class="menu-meta">⌘ −</span>
              </button>
              <hr />
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                @click="
                  ws.emit('zoomFit');
                  close(true);
                "
              >
                <AppIcon name="i-fit" />
                <span class="menu-label">适应窗口</span>
                <span class="menu-meta">⌘ 0</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                @click="
                  ws.emit('zoomActual');
                  close(true);
                "
              >
                <span class="layer-zoom-actual mono" aria-hidden="true">1:1</span>
                <span class="menu-label">原始大小</span>
                <span class="menu-meta">⌘ 1</span>
              </button>
            </template>
          </PopoverMenu>

          <button
            v-if="ws.props.compact"
            type="button"
            class="layer-dock-btn"
            aria-label="打开分件面板"
            data-tip="分件面板"
            @click="ws.emit('panel')"
          >
            <AppIcon name="i-sidebar" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.layer-dock-wrap {
  --dock-size: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  pointer-events: none;
}

.layer-dock-wrap.is-beta {
  --dock-size: 36px;
}

.layer-dock,
.layer-dock-sub {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border-radius: 999px;
}

.layer-dock {
  gap: 0;
  padding: 4px;
}

.layer-dock-sub {
  gap: 10px;
  padding: 4px 12px;
  min-height: calc(var(--dock-size) + 8px);
  font-size: var(--fz-xs);
  color: var(--fg-2);
  flex-wrap: wrap;
  justify-content: center;
}

.layer-dock-group {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 1px;
}

.layer-dock-sep {
  flex: none;
  width: 1px;
  height: 16px;
  margin-inline: 4px;
  background: color-mix(in srgb, var(--fg) 16%, transparent);
}

.layer-dock-btn,
.layer-dock-text-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: var(--dock-size);
  color: var(--fg-2);
  border-radius: 999px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--t1) var(--e),
    background var(--t1) var(--e),
    box-shadow var(--t1) var(--e),
    transform var(--t1) var(--e);
}

.layer-dock-btn {
  width: var(--dock-size);
  --ico: var(--ico-md);
}

.layer-dock-text-btn {
  gap: 6px;
  padding: 0 10px;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  --ico: var(--ico-sm);
}

.layer-dock-btn:enabled:hover,
.layer-dock-text-btn:enabled:hover {
  color: var(--fg);
  background: var(--layer-dock-hover, var(--glass-hover));
  box-shadow: var(--layer-dock-hover-shadow, none);
}

.layer-dock-btn:enabled:active,
.layer-dock-text-btn:enabled:active {
  transform: scale(0.96);
}

.layer-dock-btn[aria-pressed='true'],
.layer-dock-btn[aria-expanded='true'],
.layer-dock-text-btn[aria-pressed='true'] {
  color: var(--a);
  background: var(--a-dim);
}

/* Seamless split tool (icon + arrow, zero divider, matching EDIT EditToolMode) */
.layer-dock-split {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  transition: background var(--t1) var(--e);
}
.layer-dock-split[data-active='true'] {
  background: var(--a-dim);
}
.layer-dock-split[data-active='true'] > .layer-dock-split-main {
  background: transparent;
}
.layer-dock-split-arrow {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: var(--dock-size);
  padding-right: 3px;
  border-radius: 999px;
  color: var(--fg-3);
  cursor: pointer;
  --ico: var(--ico-xs);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-dock-split[data-active='true'] .layer-dock-split-arrow {
  color: var(--a);
}
.layer-dock-split-arrow:hover,
.layer-dock-split-arrow[aria-expanded='true'] {
  color: var(--fg);
  background: var(--layer-dock-hover, var(--glass-hover));
}
.layer-dock-split[data-active='true'] .layer-dock-split-arrow:is(:hover, [aria-expanded='true']) {
  color: var(--a);
}
.layer-dock-caret {
  transform: rotate(-90deg);
  transition: transform var(--t1) var(--e);
}
.layer-dock-split-arrow[aria-expanded='true'] .layer-dock-caret {
  transform: rotate(90deg);
}
.layer-dock-mode-dot {
  position: absolute;
  top: 6px;
  right: 3px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--warn);
  pointer-events: none;
}

.layer-dock-btn:disabled,
.layer-dock-text-btn:disabled {
  opacity: 0.35;
  pointer-events: none;
}

/* Tooltips open upward from the bottom floating dock */
.layer-dock-wrap :deep([data-tip]::after) {
  top: auto;
  bottom: calc(100% + 9px);
  transform: translate(-50%, 3px);
}
.layer-dock-wrap :deep([data-tip]:hover::after) {
  transform: translate(-50%, 0);
}

.layer-dock-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--fg-2);
  user-select: none;
}
.layer-dock-switch:hover {
  color: var(--fg);
}
.layer-dock-switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.layer-dock-slider {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  color: var(--fg-2);
}
.layer-dock-slider input[type='range'] {
  width: 82px;
}
.layer-dock-slider output {
  min-width: 34px;
  text-align: right;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}

.layer-dock-pill-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-2);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-dock-pill-btn:hover {
  color: var(--fg);
  background: var(--layer-dock-hover, var(--glass-hover));
}

.layer-dock-confirm {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  --ico: var(--ico-sm);
}

.layer-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.layer-swatch.alpha {
  background: var(--layer-keep, #38bdf8);
}
.layer-swatch.fill {
  background: var(--layer-extend, #fb923c);
}

.layer-mat-dot {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: 4px;
  border: 1.5px solid var(--fg-3);
}
.layer-mat-dot.checker {
  background: var(--image-checker);
  background-size: 6px 6px;
}
.layer-mat-dot.black {
  background: var(--scrim-neutral);
}
.layer-mat-dot.white {
  background: var(--specular);
}

.layer-zoom-actual {
  flex: none;
  min-width: var(--ico-sm);
  color: var(--fg-3);
  font-size: var(--fz-2xs);
  text-align: center;
}

:global([data-theme='light']) .layer-dock-wrap {
  --layer-dock-hover: var(--raised);
  --layer-dock-hover-shadow: var(--sh-1);
}

@media (pointer: coarse) {
  .layer-dock-wrap {
    --dock-size: 36px;
  }
}

@container editor-mat (max-width: 480px) {
  .layer-dock-wrap,
  .layer-dock-wrap.is-beta {
    --dock-size: 26px;
    gap: 6px;
  }
  .layer-dock {
    padding: 3px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .layer-dock-group {
    gap: 0;
  }
  .layer-dock-sep {
    margin-inline: 1px;
  }
  .layer-dock-btn {
    --ico: var(--ico-sm);
  }
  .layer-dock-split-arrow {
    width: 14px;
    padding-right: 2px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .layer-dock-btn,
  .layer-dock-text-btn {
    transition: none;
  }
  .layer-dock-btn:enabled:active,
  .layer-dock-text-btn:enabled:active {
    transform: none;
  }
}
</style>
