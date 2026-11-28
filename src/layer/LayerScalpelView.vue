<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../shared/AppIcon.vue';
import NaiSelect from '../shared/nai/NaiSelect.vue';
import LayerThumbnail from './LayerThumbnail.vue';
import LayerTreePicker, { type LayerPickerItem } from './LayerTreePicker.vue';
import ScalpelReferences from './ScalpelReferences.vue';
import ScalpelSourcePicker from './ScalpelSourcePicker.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const {
  project,
  busy,
  missingMode,
  missingLayerIds,
  scalpelLayerIds,
  scalpelOccluderIds,
  hasScalpelGuide,
  scalpelName,
  scalpelInstruction,
  missingModels,
  decomposeChoice,
  chosenMissingModel,
  rerollModels,
  rerollChoice,
  chosenRerollModel,
  scalpelFraming,
  referenceChoices,
  excludedReferences,
  inputLayout,
  reversedLayers,
  rerollCandidates,
  activeCandidateId,
  activeCandidate,
  rerollResultMode,
  candidateSize,
} = ws;

const missingModelOptions = computed(() => {
  const autoLabel =
    chosenMissingModel.value && !decomposeChoice.value?.connection
      ? `自动 · ${ws.modelOptionLabel(chosenMissingModel.value)}`
      : '自动选择';
  const items: { value: string; label: string; disabled?: boolean }[] = [{ value: '', label: autoLabel }];
  if (decomposeChoice.value?.connection && !chosenMissingModel.value) {
    items.push({ value: ws.selectValue(decomposeChoice.value), label: '所选供应商不可用', disabled: true });
  }
  for (const m of missingModels.value) {
    items.push({ value: ws.modelKey(m), label: ws.modelOptionLabel(m) });
  }
  return items;
});

const missingModelDisplay = computed(() => {
  if (decomposeChoice.value?.connection && !chosenMissingModel.value) return '所选供应商不可用';
  if (!chosenMissingModel.value) return '未配置拆层来源';
  if (!decomposeChoice.value?.connection) {
    return missingModels.value.length > 1
      ? `${chosenMissingModel.value.name} · 自动`
      : chosenMissingModel.value.name;
  }
  return ws.modelOptionLabel(chosenMissingModel.value);
});

const rerollModelOptions = computed(() => {
  const autoLabel =
    chosenRerollModel.value && !rerollChoice.value?.connection
      ? `自动 · ${ws.modelOptionLabel(chosenRerollModel.value)}`
      : '自动选择';
  const items: { value: string; label: string; disabled?: boolean }[] = [{ value: '', label: autoLabel }];
  if (rerollChoice.value?.connection && !chosenRerollModel.value) {
    items.push({ value: ws.selectValue(rerollChoice.value), label: '所选供应商不可用', disabled: true });
  }
  for (const m of rerollModels.value) {
    items.push({
      value: ws.modelKey(m),
      label: `${ws.modelOptionLabel(m)}${m.fields.background?.options.includes('transparent') ? '（透明底）' : ''}`,
    });
  }
  return items;
});

const rerollModelDisplay = computed(() => {
  if (rerollChoice.value?.connection && !chosenRerollModel.value) return '所选供应商不可用';
  if (!chosenRerollModel.value) return '未配置补画模型';
  if (!rerollChoice.value?.connection) {
    return rerollModels.value.length > 1
      ? `${chosenRerollModel.value.name} · 自动`
      : chosenRerollModel.value.name;
  }
  return ws.modelOptionLabel(chosenRerollModel.value);
});

const framingLabels = {
  auto: '自动',
  full: '整图原比例',
  local: '局部裁框',
} as const;

const occluderItems = computed<LayerPickerItem[]>(() =>
  reversedLayers.value.map((layer) => {
    const path = [...(layer.groups ?? []), layer.name].join(' / ');
    const disabled =
      !!scalpelLayerIds.value?.includes(layer.id) ||
      !!project.value?.scalpelReferences?.some((r) => r.picture === ws.layerPictureId(layer.id));
    return {
      id: layer.id,
      name: layer.name,
      path,
      groups: layer.groups ?? [],
      groupIds: layer.groupIds ?? layer.groups ?? [],
      disabled,
      title: disabled ? `${path}（已用于补画底图或参考）` : path,
    };
  }),
);

function toggleOccluderGroup(ids: string[], allSelected: boolean) {
  const cur = scalpelOccluderIds.value;
  scalpelOccluderIds.value = allSelected
    ? cur.filter((id) => !ids.includes(id))
    : [...new Set([...cur, ...ids])];
  ws.syncFields();
}

function clearOccluders() {
  scalpelOccluderIds.value = [];
  ws.syncFields();
}
</script>

<template>
  <section v-if="project" class="layer-scalpel" aria-label="局部补画">
    <!-- Model bar sits first (matching 自动拆层 & EDIT ModelField — zero layout jump across tabs) -->
    <template v-if="missingMode">
      <div v-if="missingModels.length || decomposeChoice?.connection" class="model-row">
        <NaiSelect
          id="layerMissingModel"
          label="缺失件模型来源"
          variant="model"
          :value="ws.selectValue(decomposeChoice)"
          :display="missingModelDisplay"
          :title="chosenMissingModel ? ws.modelOptionLabel(chosenMissingModel) : '缺失件模型来源'"
          :disabled="busy"
          :options="missingModelOptions"
          @change="ws.chooseLayerModel('decompose', $event)"
        >
          <AppIcon class="model-ico" name="i-model" />
        </NaiSelect>
      </div>
      <p v-if="!chosenMissingModel" class="hint">请选择支持 Seedream 5.5 拆层的图像来源。</p>
    </template>
    <template v-else>
      <div v-if="rerollModels.length || rerollChoice?.connection" class="model-row">
        <NaiSelect
          id="layerRerollModel"
          label="局部补画模型"
          variant="model"
          :value="ws.selectValue(rerollChoice)"
          :display="rerollModelDisplay"
          :title="chosenRerollModel ? ws.modelOptionLabel(chosenRerollModel) : '局部补画模型'"
          :disabled="busy"
          :options="rerollModelOptions"
          @change="ws.chooseLayerModel('reroll', $event)"
        >
          <AppIcon class="model-ico" name="i-model" />
        </NaiSelect>
      </div>
      <p v-if="!chosenRerollModel" class="hint">需在「设置 → 连接」配置支持局部补画的图像连接。</p>
    </template>

    <!-- Clean 2-way mode switch -->
    <div class="seg layer-scalpel-mode" role="group" aria-label="补画方式">
      <button
        type="button"
        class="layer-seg-btn"
        :aria-pressed="!missingMode"
        :disabled="busy"
        @click="ws.setScalpelMode(false)"
      >
        局部重绘
      </button>
      <button
        type="button"
        class="layer-seg-btn"
        :aria-pressed="missingMode"
        :disabled="busy"
        title="使用 Seedream 5.5 拆层能力独立生成缺失部件"
        @click="ws.setScalpelMode(true)"
      >
        补缺失件
      </button>
    </div>

    <!-- Core authoring fields: component name + Koma promptbox with ASK helper in header -->
    <div class="fld layer-name-fld">
      <label for="layerScalpelName">部件名称</label>
      <input
        id="layerScalpelName"
        v-model="scalpelName"
        type="text"
        :placeholder="missingMode ? '如：画面左侧的耳朵' : '如：左马尾、外套左袖'"
        @blur="ws.syncFields()"
      />
    </div>

    <div class="fld promptbox layer-promptbox">
      <div class="promptbox-head layer-promptbox-head">
        <label for="layerScalpelPrompt">补充描述</label>
        <button
          v-if="!missingMode"
          type="button"
          class="btn-link layer-prompt-act"
          :disabled="busy"
          @click="ws.emit('askScalpel')"
        >
          让 ASK 拟词
        </button>
      </div>
      <div class="promptbox-body">
        <textarea
          id="layerScalpelPrompt"
          v-model="scalpelInstruction"
          rows="2"
          placeholder="可选，说明需要补全的遮挡部位"
          @blur="ws.syncFields()"
        ></textarea>
      </div>
    </div>

    <!-- Lightweight single-row source picker (no stacked .seg bar) -->
    <ScalpelSourcePicker
      v-if="missingMode || project.layers.length || scalpelLayerIds"
      :layers="reversedLayers"
      :missing="missingMode"
      :selected="missingMode ? missingLayerIds : scalpelLayerIds"
      :excluded="missingMode ? [] : scalpelOccluderIds"
      :has-guide="hasScalpelGuide"
      :busy="busy"
      @change="ws.chooseScalpelLayers"
      @ask="ws.emit('askScalpel', missingMode ? 'missing' : 'layers')"
    />

    <template v-if="!missingMode">
      <ScalpelReferences
        :sources="referenceChoices"
        :selected="project.scalpelReferences ?? []"
        :excluded="excludedReferences"
        :first-image="inputLayout.firstReference"
        :busy="busy"
        @files="ws.importScalpelFiles"
        @change="ws.queueSave({ ...project, scalpelReferences: $event })"
        @remove="ws.removeScalpelReference"
      />

      <details v-if="project.layers.length" class="drawer layer-fold">
        <summary>
          <span>排除遮挡图层</span>
          <span v-if="scalpelOccluderIds.length" class="badge">{{ scalpelOccluderIds.length }}</span>
          <i class="caret" aria-hidden="true"></i>
        </summary>
        <div class="layer-occluder-chips">
          <LayerTreePicker
            mode="checkbox"
            :items="occluderItems"
            :selected="scalpelOccluderIds"
            :busy="busy"
            search-label="搜索排除遮挡图层"
            search-placeholder="按图层或分组名搜索…"
            max-height="13rem"
            @toggle="ws.toggleOccluder"
            @toggle-group="toggleOccluderGroup"
            @remove="ws.toggleOccluder"
            @clear="clearOccluders"
          />
        </div>
      </details>

      <details class="drawer layer-framing-fold">
        <summary>
          <span>送图画幅</span>
          <span class="layer-fold-val">{{ framingLabels[scalpelFraming] }}</span>
          <i class="caret" aria-hidden="true"></i>
        </summary>
        <div class="layer-framing-body">
          <div class="seg layer-framing-seg" role="group" aria-label="局部补画送图画幅">
            <button
              type="button"
              class="layer-seg-btn"
              :aria-pressed="scalpelFraming === 'auto'"
              title="大件自动整图原比例，小件贴边局部框（不产生画布外空边）"
              @click="scalpelFraming = 'auto'"
            >
              自动
            </button>
            <button
              type="button"
              class="layer-seg-btn"
              :aria-pressed="scalpelFraming === 'full'"
              title="始终按整张母版原比例送图，四边锚定最稳"
              @click="scalpelFraming = 'full'"
            >
              整图原比例
            </button>
            <button
              type="button"
              class="layer-seg-btn"
              :aria-pressed="scalpelFraming === 'local'"
              title="仅裁选区周围局部画幅（限制在画布内），适合五官等小件"
              @click="scalpelFraming = 'local'"
            >
              局部裁框
            </button>
          </div>
        </div>
      </details>

      <p
        v-if="chosenRerollModel && (scalpelLayerIds?.length || project.scalpelReferences?.length || scalpelOccluderIds.length)"
        class="hint"
        :class="{ warn: !!inputLayout.issue }"
        aria-live="polite"
      >
        {{
          inputLayout.issue ||
          `本轮送图 ${inputLayout.count} / ${chosenRerollModel.maxImages} 张 · ${scalpelLayerIds?.length && !hasScalpelGuide ? '所选图层合成图' : inputLayout.context ? '含补画底图和选区' : '以选区图定位'}${scalpelOccluderIds.length ? ' · 含遮挡排除图' : ''}`
        }}
      </p>

      <!-- Candidate Comparison Strip -->
      <div v-if="rerollCandidates.length" class="layer-candidates">
        <div class="layer-cand-head">
          <h3>候选结果</h3>
          <div class="layer-cand-links">
            <button v-if="activeCandidate" type="button" class="btn-link" :disabled="busy" @click="ws.discardActiveCandidate()">
              淘汰当前候选
            </button>
            <button v-if="activeCandidateId" type="button" class="btn-link" @click="activeCandidateId = ''">
              返回涂抹
            </button>
          </div>
        </div>

        <div class="layer-candidate-strip">
          <button
            v-for="(cand, idx) in rerollCandidates"
            :key="cand.id"
            type="button"
            :aria-pressed="activeCandidateId === cand.id"
            @click="
              ws.compareReference.value = false;
              activeCandidateId = activeCandidateId === cand.id ? '' : cand.id;
            "
          >
            <LayerThumbnail :image="ws.candidateVariant(cand).preview" :alt="`候选 #${idx + 1}`" class="layer-cand-thumb" />
            <span class="mono">#{{ idx + 1 }}</span>
          </button>
        </div>

        <div v-if="activeCandidate" class="seg layer-result-seg" role="group" aria-label="补画结果模式">
          <button
            type="button"
            class="layer-seg-btn"
            :aria-pressed="rerollResultMode === 'raw'"
            @click="rerollResultMode = 'raw'"
          >
            仅 AI 生成图
          </button>
          <button
            type="button"
            class="layer-seg-btn"
            :aria-pressed="rerollResultMode === 'overlay'"
            :disabled="!activeCandidate.overlayRaster"
            title="在 AI 透明轮廓内，用本次补画底图还原蓝色保留区细节"
            @click="rerollResultMode = 'overlay'"
          >
            叠加蓝区原图
          </button>
        </div>

        <div v-if="candidateSize" class="layer-cand-meta">
          <p class="mono">
            {{ candidateSize.framing === 'full' ? '整图原比例' : '局部裁框' }} {{ candidateSize.frameWidth }} ×
            {{ candidateSize.frameHeight }} · 送图 {{ candidateSize.inputWidth }} × {{ candidateSize.inputHeight }} ·
            请求 {{ candidateSize.requested || '模型自动' }} · 实际回图 {{ candidateSize.width }} ×
            {{ candidateSize.height }} px
          </p>
          <p
            v-if="Math.max(candidateSize.frameWidth, candidateSize.frameHeight) > Math.max(candidateSize.width, candidateSize.height)"
            class="hint warn"
          >
            回图小于画幅，补画区已等比放大至原位，细节受回图分辨率限制。
          </p>
          <div class="layer-cand-links">
            <button type="button" class="btn-link" :disabled="busy" @click="ws.alignActiveCandidate()">
              {{ activeCandidate?.sourceReference ? '自动对齐补画底图' : '自动对齐原图' }}
            </button>
            <button type="button" class="btn-link" @click="ws.downloadRawCandidate()">下载模型原始回图</button>
          </div>
        </div>

        <button
          v-if="activeCandidate"
          type="button"
          class="btn btn-accent btn-block"
          @click="ws.admitActiveCandidate()"
        >
          <AppIcon name="i-check" />
          收纳当前候选进图层栈
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.layer-scalpel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
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

.layer-scalpel-mode,
.layer-result-seg {
  grid-template-columns: repeat(2, 1fr);
}
.layer-framing-seg {
  grid-template-columns: repeat(3, 1fr);
}

.layer-seg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--r1);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--seg-ink);
  --ico: var(--ico-sm);
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
  opacity: 0.4;
  cursor: not-allowed;
}

.layer-name-fld > label {
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  color: var(--fg-3);
}

.layer-promptbox-head {
  align-items: stretch;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 12px;
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
.layer-prompt-act {
  align-self: center;
  font-size: var(--fz-xs);
  color: var(--fg-3);
}
.layer-prompt-act:hover:not(:disabled) {
  color: var(--a);
}
.layer-promptbox .promptbox-body textarea {
  border: 0;
  background: transparent;
  box-shadow: none;
  border-radius: 0 0 calc(var(--r3) - 1px) calc(var(--r3) - 1px);
  padding: 8px 12px;
  min-height: 68px;
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

.layer-fold-val {
  margin-left: auto;
  font-size: var(--fz-2xs);
  font-weight: var(--fw-normal);
  color: var(--fg-3);
}
.layer-framing-fold > summary > .caret {
  margin-left: 4px;
}
.layer-framing-body {
  padding: 6px 0 4px;
}

.layer-occluder-chips {
  padding: 6px 0 4px;
}

.layer-candidates {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.layer-cand-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.layer-cand-head h3 {
  margin: 0;
  font-size: var(--fz-xs);
  font-weight: var(--fw-semibold);
  color: var(--fg-2);
}
.layer-cand-links {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.layer-candidate-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.layer-candidate-strip button {
  flex: 0 0 60px;
  display: grid;
  justify-items: center;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--line-2);
  border-radius: var(--r2);
  background: var(--well);
  color: var(--fg-2);
  font-size: var(--fz-2xs);
  transition: border-color var(--t1) var(--e), background var(--t1) var(--e);
}
.layer-candidate-strip button[aria-pressed='true'] {
  border-color: var(--a-line);
  background: var(--a-dim);
  color: var(--fg);
}
.layer-cand-thumb {
  width: 48px;
  height: 48px;
  border-radius: var(--r1);
}

.layer-cand-meta {
  display: grid;
  gap: 4px;
}
.layer-cand-meta p {
  margin: 0;
  font-size: var(--fz-2xs);
  line-height: 1.5;
  color: var(--fg-3);
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
