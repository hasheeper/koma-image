<script setup lang="ts">
import AppIcon from '../shared/AppIcon.vue';
import CandidateFit from './CandidateFit.vue';
import LayerThumbnail from './LayerThumbnail.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const {
  project,
  busy,
  poolBatch,
  poolFrontFirst,
  poolOrder,
  poolDrag,
  poolSelected,
  poolVisibleIds,
  poolSoloId,
  poolStageActive,
  showingReference,
  allPoolVisible,
  fittingId,
  maskChoices,
  reversedLayers,
  archiveSource,
} = ws;
</script>

<template>
  <div v-if="project?.otherSplits?.length" class="fld layer-other-splits">
    <select
      aria-label="切换待筛批次"
      value=""
      @change="
        ws.switchPool(($event.target as HTMLSelectElement).value);
        ($event.target as HTMLSelectElement).value = '';
      "
    >
      <option value="">其他待筛批次（{{ project.otherSplits.length }}）</option>
      <option v-for="(entry, i) in project.otherSplits" :key="entry.batch.id" :value="entry.batch.id">
        {{ i + 1 }} · {{ entry.batch.targetName }} · {{ entry.batch.layers.length }} 层
      </option>
    </select>
  </div>

  <section
    v-if="project && poolBatch"
    :ref="(el) => (ws.candidatePool.value = (el as HTMLElement | null) ?? undefined)"
    tabindex="-1"
    class="layer-section layer-pool"
    aria-label="本次拆层候选池"
  >
    <div class="layer-section-head">
      <div class="layer-section-title">
        <h3>{{ poolBatch.componentName ? '缺失件候选 · ' + poolBatch.componentName : '候选图层' }}</h3>
        <span class="layer-count mono">{{ poolBatch.layers.length }}</span>
      </div>
      <div class="layer-inline-links">
        <button v-if="!poolBatch.componentName" type="button" class="btn-link" @click="ws.toggleAllPoolVisible()">
          {{ allPoolVisible ? '全隐' : '全显' }}
        </button>
        <button v-if="!poolBatch.componentName" type="button" class="btn-link" @click="ws.selectAllPool()">全选</button>
        <button
          type="button"
          class="btn-link"
          :disabled="busy"
          title="淘汰本批剩余候选"
          @click="ws.discardPool()"
        >
          清空
        </button>
      </div>
    </div>

    <div v-if="poolBatch.componentName" class="seg layer-pool-seg" role="group" aria-label="缺失件预览">
      <button
        type="button"
        class="layer-seg-btn"
        :disabled="!poolSelected.length"
        :aria-pressed="poolStageActive && !!poolSoloId && !showingReference"
        @click="
          poolSoloId = poolSelected[0];
          poolStageActive = true;
          ws.compareReference.value = false;
        "
      >
        单看部件
      </button>
      <button
        type="button"
        class="layer-seg-btn"
        :disabled="!poolSelected.length"
        :aria-pressed="poolStageActive && !poolSoloId && !showingReference"
        @click="
          poolSoloId = '';
          poolStageActive = true;
          ws.compareReference.value = false;
        "
      >
        {{ poolBatch.source.kind === 'master' ? '叠回母版' : '叠回图层' }}
      </button>
    </div>
    <div v-else-if="project.layers.length" class="layer-pool-view-bar">
      <span>画布预览</span>
      <button
        type="button"
        class="layer-pill-toggle"
        :aria-pressed="poolStageActive"
        @click="
          poolStageActive = !poolStageActive;
          ws.compareReference.value = false;
        "
      >
        {{ poolStageActive ? '返回图层栈' : '预览候选' }}
      </button>
    </div>

    <p v-if="poolBatch.sentSize || poolBatch.requestedSize" class="layer-pool-note mono">
      <span v-if="poolBatch.requestedSize">{{
        poolBatch.requestedSize === 'auto' ? '自动档' : poolBatch.requestedSize
      }}</span>
      <span v-if="poolBatch.sentSize">
        · 送图 {{ poolBatch.sentSize.width }}×{{ poolBatch.sentSize.height }}
        <template v-if="poolBatch.inputUpscale">（{{ poolBatch.inputUpscale }}）</template>
        <template v-if="poolBatch.inputDownscaled">（超 8MB 已缩放）</template>
      </span>
    </p>

    <ul class="layer-pool-list" @dragleave="ws.leavePool">
      <li
        v-for="(item, index) in poolFrontFirst"
        :key="item.id"
        class="layer-pool-item"
        :draggable="!busy && !poolBatch.componentName && poolFrontFirst.length > 1"
        :data-drop-edge="
          poolDrag?.over === item.id && poolDrag.from !== item.id
            ? poolOrder.indexOf(poolDrag.from) < poolOrder.indexOf(item.id)
              ? 'above'
              : 'below'
            : undefined
        "
        :data-checked="poolSelected.includes(item.id)"
        :data-visible="
          poolStageActive && (poolSoloId ? poolSoloId === item.id : poolVisibleIds.includes(item.id))
        "
        :data-solo="poolStageActive && poolSoloId === item.id"
        @dragstart.stop="ws.startPoolDrag($event, item.id)"
        @dragover="ws.overPoolRow($event, item.id)"
        @drop.stop="ws.dropPoolRow($event, item.id)"
        @dragend="poolDrag = undefined"
      >
        <div class="layer-pool-row">
          <input
            class="layer-pool-pick"
            :type="poolBatch.componentName ? 'radio' : 'checkbox'"
            :checked="poolSelected.includes(item.id)"
            :aria-label="`勾选候选层 ${item.name}`"
            @change="ws.togglePoolSelect(item.id)"
          />
          <LayerThumbnail :image="item.preview" :alt="item.name" class="layer-pool-thumb" />
          <div
            class="layer-pool-meta"
            :title="item.description || item.name"
            @click="ws.togglePoolSelect(item.id)"
          >
            <strong>{{ item.name }}</strong>
            <small class="mono">
              {{ item.box.width }}×{{ item.box.height }}
              <span v-if="item.isBase" class="layer-badge">底图</span>
              <span
                v-if="item.rawScale && item.rawScale > 1.15"
                class="layer-badge warn"
                :title="`模型原始回图 ${item.width}×${item.height} px，落位放大 ${item.rawScale.toFixed(1)}×；收纳后可用「还原可见区原画」恢复母版清晰度`"
              >
                {{ item.rawScale.toFixed(1) }}×
              </span>
            </small>
          </div>
          <div class="layer-pool-actions">
            <button
              v-if="!poolBatch.componentName"
              type="button"
              class="layer-flag"
              :aria-pressed="poolSoloId ? poolSoloId === item.id : poolVisibleIds.includes(item.id)"
              :aria-label="`显隐候选层 ${item.name}`"
              title="显示 / 隐藏"
              @click="ws.togglePoolVisible(item.id)"
            >
              <AppIcon
                :name="
                  (poolSoloId ? poolSoloId === item.id : poolVisibleIds.includes(item.id)) ? 'i-eye' : 'i-eye-off'
                "
              />
            </button>
            <button
              v-if="!poolBatch.componentName"
              type="button"
              class="layer-flag solo"
              :aria-pressed="poolStageActive && poolSoloId === item.id"
              :aria-label="`独显候选层 ${item.name}`"
              title="独显此层"
              @click="ws.togglePoolSolo(item.id)"
            >
              S
            </button>
            <button
              v-if="!poolBatch.componentName || poolSelected.includes(item.id)"
              type="button"
              class="layer-flag-text"
              :class="{ warn: item.needsPosition }"
              :disabled="busy"
              :aria-expanded="fittingId === item.id"
              :aria-label="`校准候选层 ${item.name}`"
              @click="fittingId = fittingId === item.id ? '' : item.id"
            >
              {{ item.needsPosition ? '待定位' : '校准' }}
            </button>
            <div
              v-if="!poolBatch.componentName && poolFrontFirst.length > 1"
              class="layer-pool-order"
              role="group"
              :aria-label="`${item.name} 层序`"
            >
              <button
                type="button"
                class="layer-flag layer-order-btn"
                title="上移一层"
                :aria-label="`上移候选层 ${item.name}`"
                :disabled="busy || index === 0"
                @click="ws.applyPoolOrder(item.id, poolFrontFirst[index - 1]?.id)"
              >
                <AppIcon name="i-up" />
              </button>
              <button
                type="button"
                class="layer-flag layer-order-btn"
                title="下移一层"
                :aria-label="`下移候选层 ${item.name}`"
                :disabled="busy || index === poolFrontFirst.length - 1"
                @click="ws.applyPoolOrder(item.id, poolFrontFirst[index + 1]?.id)"
              >
                <AppIcon name="i-down" />
              </button>
            </div>
            <button
              type="button"
              class="layer-flag danger"
              :aria-label="`淘汰候选层 ${item.name}`"
              title="淘汰候选"
              :disabled="busy"
              @click="ws.discardPool(item.id)"
            >
              <AppIcon name="i-trash" />
            </button>
          </div>
        </div>
        <CandidateFit
          v-if="fittingId === item.id && (!poolBatch.componentName || poolSelected.includes(item.id))"
          :item="item"
          :masks="maskChoices"
          :busy="busy"
          @fit="ws.adjustCandidate(item, { box: $event })"
          @clip="ws.adjustCandidate(item, { maskId: $event })"
        />
      </li>
    </ul>

    <details
      v-if="poolBatch.source.kind === 'region' && !project.layers.some((l) => l.batchId === poolBatch?.id)"
      class="drawer layer-fold"
    >
      <summary>
        <span>结果组名称与位置</span>
        <i class="caret" aria-hidden="true"></i>
      </summary>
      <div class="layer-region-dest">
        <label class="fld">
          <span>组名</span>
          <input
            type="text"
            :value="poolBatch.groupName ?? poolBatch.source.name"
            maxlength="120"
            @change="ws.setRegionDestination('groupName', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="fld">
          <span>插入位置</span>
          <select
            :value="poolBatch.insertAbove ?? ''"
            @change="ws.setRegionDestination('insertAbove', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">栈顶</option>
            <option v-for="l in reversedLayers.filter((l) => !l.archived)" :key="l.id" :value="l.id">
              {{ l.name }} 上方
            </option>
          </select>
        </label>
      </div>
    </details>

    <label v-if="poolBatch.source.kind === 'layers' && !poolBatch.componentName" class="check layer-archive-check">
      <input v-model="archiveSource" type="checkbox" @change="ws.savePool()" />
      <span></span>
      <span>原位建组并归档来源层</span>
    </label>

    <div class="layer-pool-footer">
      <button
        type="button"
        class="btn btn-accent btn-block"
        :disabled="busy || !poolSelected.length"
        @click="ws.admitSelectedPool()"
      >
        <AppIcon name="i-check" />
        {{ poolBatch.componentName ? '添加为独立图层' : `收纳进图层栈 (${poolSelected.length})` }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.layer-other-splits {
  margin-bottom: 4px;
}

.layer-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.layer-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.layer-section-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.layer-section-title h3 {
  margin: 0;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-count {
  font-size: var(--fz-2xs);
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}

.layer-inline-links {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.layer-pool-seg {
  grid-template-columns: repeat(2, 1fr);
}

.layer-seg-btn {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--r1);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--seg-ink);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.layer-seg-btn:hover:not(:disabled) {
  color: var(--fg-2);
}
.layer-seg-btn[aria-pressed='true'] {
  background: var(--seg-active-bg);
  color: var(--seg-active-ink);
  font-weight: var(--fw-semibold);
  box-shadow: var(--seg-active-shadow);
}
.layer-seg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.layer-pool-view-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--fz-xs);
  color: var(--fg-3);
}

.layer-pill-toggle {
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--r1);
  background: transparent;
  color: var(--fg-3);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.layer-pill-toggle:hover {
  background: var(--hover);
  color: var(--fg);
}
.layer-pill-toggle[aria-pressed='true'] {
  color: var(--a);
}
.layer-pill-toggle[aria-pressed='true']:hover {
  background: var(--a-dim);
}

.layer-pool-note {
  margin: 0;
  font-size: var(--fz-2xs);
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}

.layer-pool-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.layer-pool-item {
  display: flex;
  flex-direction: column;
  border-radius: var(--r2);
  transition: background var(--t1) var(--e);
}
.layer-pool-item:hover {
  background: var(--hover);
}
.layer-pool-item[draggable='true'] {
  cursor: grab;
}
.layer-pool-item[data-drop-edge='above'] {
  box-shadow: inset 0 2px var(--a);
}
.layer-pool-item[data-drop-edge='below'] {
  box-shadow: inset 0 -2px var(--a);
}
.layer-pool-item[data-visible='false'] .layer-pool-row {
  opacity: 0.52;
}
.layer-pool-item[data-solo='true'] {
  background: var(--a-dim);
}
.layer-pool-item[data-solo='true'] .layer-pool-row {
  opacity: 1;
}

.layer-pool-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 6px;
}

.layer-pool-pick {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--a);
  cursor: pointer;
}

.layer-pool-thumb {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--r1);
}

.layer-pool-meta {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 1px;
  cursor: pointer;
}
.layer-pool-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.layer-pool-meta small {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}

.layer-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--well);
  color: var(--fg-3);
  font-family: var(--sans);
  font-size: 10px;
  font-weight: var(--fw-medium);
}
.layer-badge.warn {
  background: color-mix(in srgb, var(--warn) 16%, transparent);
  color: var(--warn);
}

.layer-pool-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: none;
}

.layer-flag {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--r1);
  color: var(--fg-3);
  font-size: var(--fz-2xs);
  font-weight: var(--fw-bold);
  --ico: var(--ico-sm);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-flag:enabled:hover {
  color: var(--fg);
  background: var(--raised);
}
.layer-flag[aria-pressed='true'] {
  color: var(--fg);
}
.layer-flag.solo[aria-pressed='true'] {
  color: var(--a);
}
.layer-flag.danger:enabled:hover {
  color: var(--err);
  background: var(--err-dim);
}
.layer-flag:disabled {
  opacity: 0.3;
  cursor: default;
}

.layer-flag-text {
  height: 22px;
  padding: 0 5px;
  border-radius: var(--r1);
  font-size: var(--fz-2xs);
  color: var(--fg-3);
  white-space: nowrap;
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-flag-text:hover,
.layer-flag-text[aria-expanded='true'] {
  color: var(--a);
  background: var(--a-dim);
}
.layer-flag-text.warn {
  color: var(--warn);
}

.layer-pool-order {
  display: inline-flex;
  flex-direction: column;
  flex: none;
}
.layer-order-btn {
  width: 18px;
  height: 14px;
  --ico: var(--ico-xs);
}

.layer-region-dest {
  display: grid;
  gap: 8px;
  padding: 8px 0 4px;
}

.layer-archive-check {
  font-size: var(--fz-xs);
}

.layer-pool-footer {
  padding-top: 2px;
}
.layer-pool-footer .btn {
  --ico: var(--ico-sm);
}

@media (pointer: coarse) {
  .layer-pool-order {
    flex-direction: row;
    gap: 2px;
  }
  .layer-order-btn {
    width: 28px;
    height: 30px;
    --ico: var(--ico-sm);
  }
  .layer-flag {
    width: 28px;
    height: 30px;
  }
}
</style>
