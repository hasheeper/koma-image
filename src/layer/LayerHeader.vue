<script setup lang="ts">
import AppIcon from '../shared/AppIcon.vue';
import PopoverMenu from '../shared/ui/PopoverMenu.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const { project, saved, busy, previewLayers, poolBatch, showingResult, showViewSwitch } = ws;
</script>

<template>
  <!-- Document identity + project menu: frameless canvas caption (Traditional) OR sleek glass island (BETA) -->
  <Teleport v-if="ws.props.headHost && (project || saved.length)" :to="ws.props.headHost">
    <div
      class="layer-head-chip"
      :class="{ 'is-beta': ws.props.coCreate }"
      role="group"
      aria-label="当前分件项目"
    >
      <template v-if="project">
        <div class="layer-head-meta">
          <select
            v-if="saved.length > 1"
            class="layer-head-select"
            aria-label="切换分件项目"
            :value="project.id"
            :disabled="busy"
            @change="ws.switchProject(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in saved" :key="item.id" :value="item.id">
              {{ item.title }}
            </option>
          </select>
          <strong v-else class="layer-head-title" :title="project.title">{{ project.title }}</strong>
        </div>
        <span class="layer-head-size mono" aria-label="母版尺寸">
          {{ project.reference.width }}<span class="layer-head-times">×</span>{{ project.reference.height }}
        </span>
      </template>
      <span v-else class="layer-head-empty">未打开项目</span>

      <PopoverMenu
        id="layerProjectMenu"
        label="分件项目选项"
        side="right"
        compact
        pointer-focus="menu"
        :menu-class="ws.props.coCreate ? 'canvas-collaboration' : undefined"
      >
        <template #trigger="{ open, toggle }">
          <button
            type="button"
            class="ibtn ibtn-xs layer-head-more"
            aria-label="分件项目选项"
            data-tip="项目选项"
            aria-haspopup="menu"
            :aria-expanded="open"
            :disabled="busy"
            @click="toggle"
          >
            <AppIcon name="i-more" />
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
              ws.referenceFile.value?.click();
            "
          >
            <AppIcon name="i-image-plus" />
            <span class="menu-label">换图并清理</span>
          </button>
          <button
            v-if="project?.todos?.length"
            type="button"
            class="menu-item"
            role="menuitem"
            @click="
              close();
              ws.emit('todos', project.id);
            "
          >
            <AppIcon name="i-tasks" />
            <span class="menu-label">在 ASK 查看拆件待办</span>
            <span class="menu-meta">{{ project.todos.filter((t) => t.done).length }}/{{ project.todos.length }}</span>
          </button>
          <button
            v-if="ws.rejectedCount.value"
            type="button"
            class="menu-item"
            role="menuitem"
            @click="
              close();
              ws.emit('reviewRejections');
            "
          >
            <AppIcon name="i-ask" />
            <span class="menu-label">让 ASK 查看淘汰图</span>
            <span class="menu-meta">{{ ws.rejectedCount.value }}</span>
          </button>
          <hr v-if="project || saved.length" />
          <button
            v-if="project || saved.length"
            type="button"
            class="menu-item danger"
            role="menuitem"
            :disabled="busy"
            @click="
              close();
              ws.clearLayerCache();
            "
          >
            <AppIcon name="i-trash" />
            <span class="menu-label">清空分件缓存</span>
          </button>
        </template>
      </PopoverMenu>
    </div>
  </Teleport>

  <!-- Canvas View Switch: 原图 | 拆分结果 / 图层合成 / 缺失件预览 -->
  <Teleport v-if="ws.props.viewHost && project && showViewSwitch" :to="ws.props.viewHost">
    <div
      class="seg layer-view-switch"
      :class="{ 'is-beta': ws.props.coCreate }"
      role="radiogroup"
      aria-label="分件画布视图"
    >
      <label>
        <input
          type="radio"
          name="layerCanvasView"
          :checked="!showingResult"
          @change="ws.setReferenceView(true)"
        />
        <span>原图</span>
      </label>
      <label>
        <input
          type="radio"
          name="layerCanvasView"
          :checked="showingResult"
          @change="ws.showLayerResult()"
        />
        <span>{{
          previewLayers !== undefined && poolBatch?.componentName
            ? '缺失件预览'
            : previewLayers !== undefined || !project.layers.length
              ? '拆分结果'
              : '图层合成'
        }}</span>
      </label>
    </div>
  </Teleport>
</template>

<style scoped>
/* Traditional: frameless canvas caption matching EDIT .editor-info-meta (zero outer box, zero nested size pill) */
.layer-head-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: min(360px, 52vw);
  height: 28px;
  color: var(--fg);
}

/* BETA: sleek single-layer glass island (zero thumbnail clutter, bare mono dimensions) */
.layer-head-chip.is-beta {
  height: 34px;
  max-width: min(300px, 44vw);
  gap: 7px;
  padding: 0 3px 0 11px;
  border-radius: var(--r3);
  background: var(--glass-bg);
  border: 1px solid var(--line-2);
  box-shadow: var(--sh-1);
  backdrop-filter: blur(var(--glass-blur));
}

.layer-head-meta {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.layer-head-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}

.layer-head-select {
  flex: 1 1 0;
  width: 0;
  min-width: 0;
  height: 26px;
  padding: 0 20px 0 4px;
  border: 0;
  border-radius: var(--r1);
  background-color: transparent;
  background-position: right 4px center;
  box-shadow: none;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.layer-head-select:hover:not(:focus) {
  background-color: var(--hover);
}
.layer-head-select:focus {
  background-color: var(--well);
  box-shadow: inset 0 0 0 1px var(--focus-line);
}

.layer-head-size {
  flex: none;
  font-size: var(--fz-xs);
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.layer-head-times {
  margin-inline: 1px;
}

.layer-head-empty {
  font-size: var(--fz-xs);
  color: var(--fg-3);
}

.layer-head-more {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--fg-3);
  --ico: var(--ico-sm);
}
.layer-head-more:enabled:hover {
  color: var(--fg);
}

/* View Switch: 原图 | 拆分结果 / 图层合成 */
.layer-view-switch {
  flex: none;
  gap: 2px;
  padding: 2px;
  height: 28px;
  align-items: center;
  border-radius: var(--r2);
  white-space: nowrap;
}
.layer-view-switch.is-beta {
  height: 34px;
  padding: 3px;
  border-radius: var(--r3);
  background: var(--glass-bg);
  border-color: var(--line-2);
  box-shadow: var(--sh-1);
  backdrop-filter: blur(var(--glass-blur));
}
.layer-view-switch span {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  line-height: 1;
}
.layer-view-switch.is-beta span {
  height: 26px;
  padding: 0 10px;
}

@media (max-width: 1079px) {
  .layer-head-chip.is-beta {
    height: 40px;
    max-width: min(192px, 44vw);
    gap: 4px;
    padding: 0 4px 0 10px;
  }
  .layer-head-chip.is-beta .layer-head-size {
    display: none;
  }
  .layer-view-switch.is-beta {
    height: 40px;
    padding: 3px;
  }
  .layer-view-switch.is-beta span {
    height: 32px;
    padding: 0 8px;
  }
}

@container editor-mat (max-width: 480px) {
  .layer-view-switch.is-beta span {
    padding: 0 6px;
    font-size: var(--fz-2xs);
  }
}
</style>
