<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import NaiSelect from '../shared/nai/NaiSelect.vue';
import PopoverMenu from '../shared/ui/PopoverMenu.vue';
import LayerCandidatePool from './LayerCandidatePool.vue';
import LayerThumbnail from './LayerThumbnail.vue';
import LayerTreePicker, { type LayerPickerItem } from './LayerTreePicker.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const {
  project,
  busy,
  scope,
  sourceIds,
  pendingRect,
  poolBatch,
  decomposeConfigOpen,
  decomposeModels,
  decomposeChoice,
  chosenDecomposeModel,
  decomposePrompt,
  displayedSplitCount, splitCountMax, splitAllowsAuto,
  decomposeUnlimited,
  splitSizeOptions, displayedSplitSize,
  activeLayer,
  reversedLayers,
} = ws;

const targetTrigger = ref<HTMLButtonElement>();
const treePicker = ref<InstanceType<typeof LayerTreePicker>>();

const availableSplitLayers = computed(() => reversedLayers.value.filter((l) => !l.archived));

const selectedSplitLayers = computed(() =>
  availableSplitLayers.value.filter((l) => sourceIds.value.includes(l.id)),
);

const defaultSplitLayer = computed(
  () =>
    (activeLayer.value && !activeLayer.value.archived ? activeLayer.value : undefined) ??
    availableSplitLayers.value[0],
);

const splitPickerItems = computed<LayerPickerItem[]>(() =>
  availableSplitLayers.value.map((l) => ({
    id: l.id,
    name: l.name,
    path: [...(l.groups ?? []), l.name].join(' / '),
    groups: l.groups ?? [],
    groupIds: l.groupIds ?? l.groups ?? [],
    image: l,
  })),
);

// Detect if selected layers correspond exactly to one whole PSD group (e.g. 43 layers of "头部与头饰总成")
const matchedWholeGroup = computed(() => {
  const chosen = selectedSplitLayers.value;
  if (chosen.length < 2) return undefined;
  const firstIds = chosen[0].groupIds ?? chosen[0].groups ?? [];
  const firstNames = chosen[0].groups ?? firstIds;
  if (!firstIds.length) return undefined;
  let shared = firstIds.length;
  for (let i = 1; i < chosen.length; i++) {
    const g = chosen[i].groupIds ?? chosen[i].groups ?? [];
    shared = Math.min(shared, g.length);
    for (let d = 0; d < shared; d++) {
      if (g[d] !== firstIds[d]) {
        shared = d;
        break;
      }
    }
    if (!shared) return undefined;
  }
  const prefix = firstIds.slice(0, shared);
  const members = availableSplitLayers.value.filter((l) => {
    const g = l.groupIds ?? l.groups ?? [];
    return g.length >= prefix.length && prefix.every((seg, i) => g[i] === seg);
  });
  if (members.length === chosen.length) return firstNames[shared - 1];
  return undefined;
});

const targetLayerNames = computed(() =>
  (project.value?.layers ?? [])
    .filter((l) => sourceIds.value.includes(l.id))
    .map((l) => l.name)
    .join(' + '),
);

const targetDisplayTitle = computed(() => {
  if (matchedWholeGroup.value) return matchedWholeGroup.value;
  const chosen = selectedSplitLayers.value;
  if (!chosen.length) return '选择要细拆的图层';
  if (chosen.length <= 2) return targetLayerNames.value;
  return `${chosen[0].name}、${chosen[1].name} 等 ${chosen.length} 层`;
});

const splitHeading = computed(() => {
  if (scope.value === 'master') return '全身总拆';
  if (scope.value === 'region') return '细拆 · 母版框选';
  return `细拆 · ${targetLayerNames.value || '局部'}`;
});

function enterLayerSplit() {
  if (scope.value === 'layers' && selectedSplitLayers.value.length) return;
  if (defaultSplitLayer.value) ws.focusSplit('layers', [defaultSplitLayer.value.id]);
}

function selectSingleSplitLayer(id: string, close: (refocus?: boolean) => void) {
  ws.focusSplit('layers', [id]);
  ws.selectLayer(id);
  close(true);
}

function toggleMultiSplitLayer(id: string) {
  const cur = sourceIds.value;
  if (cur.includes(id)) {
    if (cur.length <= 1) return;
    ws.focusSplit(
      'layers',
      cur.filter((item) => item !== id),
    );
  } else {
    ws.focusSplit('layers', [...cur, id]);
  }
}

function toggleSplitGroup(ids: string[], allSelected: boolean) {
  if (!ids.length) return;
  const cur = sourceIds.value;
  if (allSelected) {
    const remaining = cur.filter((id) => !ids.includes(id));
    if (remaining.length) ws.focusSplit('layers', remaining);
    return;
  }
  const hasOverlap = ids.some((id) => cur.includes(id));
  // If currently on a single unrelated layer, picking a group replaces cleanly instead of leaving a stray layer.
  const next = cur.length <= 1 && !hasOverlap ? ids : [...new Set([...cur, ...ids])];
  ws.focusSplit('layers', next);
}

const modelOptions = computed(() => {
  const autoLabel =
    chosenDecomposeModel.value && !decomposeChoice.value?.connection
      ? `自动 · ${ws.modelOptionLabel(chosenDecomposeModel.value)}`
      : '自动选择';
  const items: { value: string; label: string; disabled?: boolean }[] = [{ value: '', label: autoLabel }];
  if (decomposeChoice.value?.connection && !chosenDecomposeModel.value) {
    items.push({ value: ws.selectValue(decomposeChoice.value), label: '所选供应商不可用', disabled: true });
  }
  for (const m of decomposeModels.value) {
    items.push({ value: ws.modelKey(m), label: ws.modelOptionLabel(m) });
  }
  return items;
});

const modelDisplay = computed(() => {
  if (decomposeChoice.value?.connection && !chosenDecomposeModel.value) return '所选供应商不可用';
  if (!chosenDecomposeModel.value) return '未配置拆层模型';
  if (!decomposeChoice.value?.connection) {
    return decomposeModels.value.length > 1
      ? `${chosenDecomposeModel.value.name} · 自动`
      : chosenDecomposeModel.value.name;
  }
  return ws.modelOptionLabel(chosenDecomposeModel.value);
});

const modelTitle = computed(() =>
  chosenDecomposeModel.value ? ws.modelOptionLabel(chosenDecomposeModel.value) : '拆层模型',
);
</script>

<template>
  <section
    v-if="project"
    :ref="(el) => (ws.splitForm.value = (el as HTMLElement | null) ?? undefined)"
    class="layer-section layer-decompose"
    tabindex="-1"
    aria-label="自动拆层"
  >
    <!-- Compact collapsible header when Candidate Pool is active -->
    <div v-if="poolBatch" class="layer-decompose-head">
      <h3>{{ splitHeading }}</h3>
      <button
        type="button"
        class="btn-link"
        @click="decomposeConfigOpen = !decomposeConfigOpen"
      >
        {{ decomposeConfigOpen ? '收起参数' : '展开参数' }}
      </button>
    </div>

    <!-- Model bar sits first (matching IMAGE/EDIT ModelField) when form is open -->
    <div
      v-if="(decomposeConfigOpen || !poolBatch) && (decomposeModels.length || decomposeChoice?.connection)"
      class="model-row"
    >
      <NaiSelect
        id="layerDecomposeModel"
        label="拆层模型"
        variant="model"
        :value="ws.selectValue(decomposeChoice)"
        :display="modelDisplay"
        :title="modelTitle"
        :disabled="busy"
        :options="modelOptions"
        @change="ws.chooseLayerModel('decompose', $event)"
      >
        <AppIcon class="model-ico" name="i-model" />
      </NaiSelect>
    </div>

    <!-- Unified 3-way scope segmented control -->
    <div class="seg layer-scope-seg" role="group" aria-label="拆层范围">
      <button
        type="button"
        class="layer-seg-btn"
        :aria-pressed="scope === 'master'"
        @click="ws.focusSplit('master')"
      >
        全身总拆
      </button>
      <button
        type="button"
        class="layer-seg-btn"
        :aria-pressed="scope === 'layers'"
        :disabled="busy || !chosenDecomposeModel || !defaultSplitLayer"
        :title="defaultSplitLayer ? `细拆「${defaultSplitLayer.name}」或指定图层／分组` : '当前没有可细拆图层'"
        aria-label="↳ 继续细拆此件"
        @click="enterLayerSplit()"
      >
        细拆此件
      </button>
      <button
        type="button"
        class="layer-seg-btn"
        :aria-pressed="scope === 'region'"
        aria-label="框选母版细拆"
        @click="ws.focusSplit('region')"
      >
        框选区域
      </button>
    </div>

    <!-- Plan 1: Frameless interactive object row for layer / group split -->
    <div v-if="!poolBatch && scope === 'layers'" class="layer-target-row">
      <div
        class="layer-target-main"
        title="点击更换图层或分组；也可在画布右键穿透选层"
        @click="targetTrigger?.click()"
      >
        <LayerThumbnail
          v-if="selectedSplitLayers.length === 1"
          :image="selectedSplitLayers[0]"
          class="layer-target-thumb"
        />
        <span v-else class="layer-target-ico" aria-hidden="true">
          <AppIcon :name="matchedWholeGroup ? 'i-folder' : 'i-layers'" />
        </span>
        <div class="layer-target-text">
          <h3 class="layer-target-title" :aria-label="splitHeading" :title="targetLayerNames || '未选择图层'">
            {{ targetDisplayTitle }}
          </h3>
          <span v-if="selectedSplitLayers.length === 1" class="layer-target-meta mono">
            {{ selectedSplitLayers[0].width }}×{{ selectedSplitLayers[0].height }}
          </span>
          <span v-else-if="matchedWholeGroup" class="layer-target-meta">
            整组细拆 · {{ selectedSplitLayers.length }} 层
          </span>
          <span v-else-if="selectedSplitLayers.length > 1" class="layer-target-meta">
            合并细拆 · {{ selectedSplitLayers.length }} 层
          </span>
        </div>
      </div>

      <PopoverMenu
        id="layerSplitTargetMenu"
        label="选择细拆图层"
        side="right"
        compact
        menu-class="layer-tree-popover"
        pointer-focus="menu"
        @opened="treePicker?.reset()"
      >
        <template #trigger="{ open, toggle }">
          <button
            ref="targetTrigger"
            type="button"
            class="layer-target-btn"
            aria-haspopup="menu"
            :aria-expanded="open"
            :disabled="busy || !availableSplitLayers.length"
            title="选择单层、整组或多选合并细拆"
            @click="toggle"
          >
            <span>{{ selectedSplitLayers.length > 1 ? '编辑' : '更换' }}</span>
            <AppIcon name="i-chevron" class="layer-target-caret" />
          </button>
        </template>
        <template #default="{ close }">
          <LayerTreePicker
            ref="treePicker"
            mode="hybrid"
            :items="splitPickerItems"
            :selected="sourceIds"
            :busy="busy"
            show-thumbs
            keep-one
            search-label="搜索细拆图层"
            search-placeholder="搜索图层或分组名…"
            @pick="selectSingleSplitLayer($event, close)"
            @toggle="toggleMultiSplitLayer"
            @toggle-group="toggleSplitGroup"
            @remove="toggleMultiSplitLayer"
            @keep-first="selectedSplitLayers[0] && selectSingleSplitLayer(selectedSplitLayers[0].id, close)"
          />
        </template>
      </PopoverMenu>
    </div>

    <!-- Plan 1: Frameless interactive object row for region split -->
    <div v-else-if="!poolBatch && scope === 'region'" class="layer-target-row is-region" :class="{ 'is-ready': !!pendingRect }">
      <div class="layer-target-main is-static">
        <span class="layer-target-ico" aria-hidden="true">
          <AppIcon name="i-select-rect" />
        </span>
        <div class="layer-target-text">
          <h3 class="layer-target-title" aria-label="细拆 · 母版框选">
            {{ pendingRect ? '母版框选' : '在画布上拖框选择区域' }}
          </h3>
          <span v-if="pendingRect" class="layer-target-meta mono">
            {{ pendingRect.width }}×{{ pendingRect.height }} · ({{ pendingRect.x }}, {{ pendingRect.y }})
          </span>
        </div>
      </div>
      <button
        v-if="pendingRect"
        type="button"
        class="layer-target-btn"
        :disabled="busy"
        @click="
          ws.clearPendingSelection();
          ws.stackTool.value = 'rect';
        "
      >
        清除
      </button>
    </div>

    <template v-if="decomposeConfigOpen || !poolBatch">
      <!-- Koma promptbox card matching EDIT promptbox -->
      <div class="fld promptbox layer-promptbox">
        <div class="promptbox-head layer-promptbox-head">
          <label for="layerDecomposePrompt">拆层说明</label>
          <button
            type="button"
            class="btn-link layer-template-btn"
            title="填入标准编号拆层模板"
            @click="ws.usePromptTemplate()"
          >
            填入模板
          </button>
        </div>
        <div class="promptbox-body">
          <textarea
            id="layerDecomposePrompt"
            v-model="decomposePrompt"
            rows="3"
            placeholder="从前向后编号，写出每件应补全的遮挡结构"
            @change="ws.syncFields()"
          ></textarea>
        </div>
      </div>

      <!-- Clean slider row: label + value + inline unlimited toggle above track -->
      <div v-if="splitCountMax" class="fld layer-slider-fld">
        <div class="layer-slider-head">
          <label for="layerDecomposeMax">最多层数</label>
          <div class="layer-slider-end">
            <output v-if="!splitAllowsAuto || !decomposeUnlimited" for="layerDecomposeMax" class="layer-slider-val mono">
              {{ displayedSplitCount }}
            </output>
            <button
              v-if="splitAllowsAuto"
              type="button"
              class="layer-inline-toggle"
              :aria-pressed="decomposeUnlimited"
              @click="
                decomposeUnlimited = !decomposeUnlimited;
                ws.syncFields();
              "
            >
              不限制
            </button>
          </div>
        </div>
        <input
          id="layerDecomposeMax"
          v-model.number="displayedSplitCount"
          type="range"
          min="2"
          :max="splitCountMax"
          step="1"
          :disabled="splitAllowsAuto && decomposeUnlimited"
          aria-label="最多拆出层数"
          class="layer-range"
          @change="ws.syncFields()"
        />
      </div>

      <small v-else class="hint">此来源自动决定拆层数量。</small>

      <!-- Output resolution segmented control -->
      <div class="fld">
        <label>输出分辨率</label>
        <div class="seg layer-size-seg" role="group" aria-label="拆层输出分辨率">
          <button
            v-for="size in splitSizeOptions"
            :key="size"
            type="button"
            class="layer-seg-btn"
            :aria-pressed="displayedSplitSize === size"
            title="每层独立渲染目标分辨率；大面积图层建议选 2K 减少放大发虚"
            @click="displayedSplitSize = size"
          >
            {{ size === 'auto' ? '自动' : size }}
          </button>
        </div>
      </div>

      <p v-if="!chosenDecomposeModel" class="hint">
        需在「设置 → 连接」配置支持拆层的 Seedream 图像来源。
      </p>
    </template>
  </section>

  <!-- Active Candidate Pool renders right below form in Decompose view -->
  <LayerCandidatePool />
</template>

<style scoped>
.layer-decompose {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.layer-decompose-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.layer-decompose-head h3 {
  margin: 0;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-decompose .fld > label {
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
}

.model-row {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 34px;
  padding: 3px;
  background: var(--well);
  border: 1px solid var(--line);
  border-radius: var(--r3);
}
.model-row :deep(.choice-model) {
  gap: 7px;
  height: 26px;
}
.model-ico {
  flex: none;
  --ico: var(--ico-sm);
  color: var(--a);
  fill: currentColor;
  stroke: none;
}

.layer-scope-seg {
  grid-template-columns: repeat(3, 1fr);
}

/* Plan 1: Frameless lightweight object row directly on panel surface */
.layer-target-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: -4px;
  padding: 2px 0 8px;
  border-bottom: 1px solid var(--line);
}

.layer-target-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.layer-target-main.is-static {
  cursor: default;
}

.layer-target-thumb {
  width: 26px;
  height: 26px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: var(--r1);
}

.layer-target-ico {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--r1);
  background: var(--well);
  color: var(--fg-3);
  --ico: var(--ico-sm);
}
.layer-target-row.is-ready .layer-target-ico {
  background: var(--a-dim);
  color: var(--a);
}

.layer-target-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.layer-target-title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg);
  line-height: 1.3;
  transition: color var(--t1) var(--e);
}
.layer-target-main:not(.is-static):hover .layer-target-title {
  color: var(--a);
}
.layer-target-row.is-region:not(.is-ready) .layer-target-title {
  color: var(--fg-3);
  font-weight: var(--fw-regular);
}

.layer-target-meta {
  font-size: var(--fz-2xs);
  color: var(--fg-3);
  line-height: 1.2;
}
.layer-target-row.is-ready .layer-target-meta {
  color: var(--a);
}

.layer-target-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  height: 24px;
  padding: 0 7px;
  border-radius: var(--r1);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
  white-space: nowrap;
  --ico: var(--ico-xs);
  transition: background var(--t1) var(--e), color var(--t1) var(--e);
}
.layer-target-btn:hover:not(:disabled),
.layer-target-btn[aria-expanded='true'] {
  color: var(--fg);
  background: var(--hover);
}
.layer-target-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--a-line);
}
.layer-target-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.layer-target-caret {
  transform: rotate(90deg);
  transition: transform var(--t1) var(--e);
}
.layer-target-btn[aria-expanded='true'] .layer-target-caret {
  transform: rotate(-90deg);
}

.layer-promptbox-head {
  align-items: stretch;
  min-height: 34px;
  padding: 0 10px 0 12px;
}
.layer-promptbox-head label {
  position: relative;
  display: inline-flex;
  align-items: center;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.layer-promptbox-head label::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--a);
}
.layer-template-btn {
  align-self: center;
  padding: 2px 4px;
  color: var(--fg-3);
}
.layer-template-btn:hover {
  color: var(--fg);
}
.layer-promptbox .promptbox-body textarea {
  border: 0;
  background: transparent;
  box-shadow: none;
  border-radius: 0 0 calc(var(--r3) - 1px) calc(var(--r3) - 1px);
  padding: 9px 12px;
  min-height: 92px;
  max-height: 45vh;
  resize: vertical;
  overflow-y: auto;
  font-size: var(--fz-sm);
  line-height: 1.55;
}
.layer-promptbox .promptbox-body textarea:focus {
  background: transparent;
  box-shadow: none;
}

.layer-slider-fld {
  gap: 4px;
}
.layer-slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.layer-slider-end {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.layer-slider-val {
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.layer-inline-toggle {
  padding: 2px 7px;
  border-radius: var(--r1);
  color: var(--fg-3);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-inline-toggle:hover {
  color: var(--fg);
  background: var(--hover);
}
.layer-inline-toggle[aria-pressed='true'] {
  color: var(--a);
  background: var(--a-dim);
  font-weight: var(--fw-semibold);
}
.layer-range:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.layer-size-seg {
  grid-template-columns: repeat(4, 1fr);
}
.layer-seg-btn {
  height: 28px;
  padding: 0 6px;
  border-radius: var(--r1);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--seg-ink);
  white-space: nowrap;
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
.layer-seg-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--a-line);
}
.layer-seg-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

@media (pointer: coarse), (max-width: 860px) {
  .model-row {
    height: 40px;
  }
  .model-row :deep(.choice-model) {
    height: 32px;
  }
}
</style>
