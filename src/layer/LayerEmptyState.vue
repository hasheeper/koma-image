<script setup lang="ts">
import AppIcon from '../shared/AppIcon.vue';
import { useLayerWorkspace } from './use-layer-workspace.ts';

const ws = useLayerWorkspace();
const { busy, progress, error, saved } = ws;
</script>

<template>
  <div class="layer-empty-stage">
    <div class="layer-empty-stack" aria-hidden="true">
      <span class="layer-empty-crop tl"></span>
      <span class="layer-empty-crop tr"></span>
      <span class="layer-empty-crop bl"></span>
      <span class="layer-empty-crop br"></span>
      <div class="layer-empty-card back"></div>
      <div class="layer-empty-card mid"></div>
      <div class="layer-empty-card front">
        <AppIcon name="i-layers" />
      </div>
    </div>

    <p v-if="progress" class="layer-empty-sub" role="status">{{ progress }}</p>
    <p v-else class="layer-empty-sub">拖入、粘贴图片或 8 位 RGB PSD</p>

    <button
      type="button"
      class="btn btn-quiet layer-empty-open"
      :disabled="busy"
      @click="ws.referenceFile.value?.click()"
    >
      <AppIcon name="i-upload" />
      打开图片或 PSD
    </button>

    <div v-if="error" class="quota-warning editor-err layer-empty-alert" role="alert">
      <AppIcon name="i-alert" />
      <span>{{ error }}</span>
      <button type="button" class="ibtn ibtn-xs layer-empty-dismiss" aria-label="关闭提示" @click="ws.clearError()">
        <AppIcon name="i-close" />
      </button>
    </div>

    <div v-if="saved.length" class="layer-empty-recent" role="region" aria-label="最近分件项目">
      <p class="layer-empty-recent-label">继续最近项目</p>
      <div class="layer-empty-recent-list">
        <button
          v-for="item in saved.slice(0, 4)"
          :key="item.id"
          type="button"
          class="layer-empty-recent-btn"
          :disabled="busy"
          :title="item.title"
          @click="ws.switchProject(item.id)"
        >
          <AppIcon name="i-layers" />
          <span>{{ item.title }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layer-empty-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  max-width: 420px;
  padding: 24px;
  text-align: center;
  color: var(--fg-2);
  pointer-events: auto;
}

.layer-empty-stack {
  position: relative;
  width: 112px;
  height: 76px;
  margin-bottom: 6px;
}

.layer-empty-crop {
  position: absolute;
  width: 9px;
  height: 9px;
  border: 0 solid var(--a-line);
}
.layer-empty-crop.tl { top: 0; left: 0; border-top-width: 1.5px; border-left-width: 1.5px; }
.layer-empty-crop.tr { top: 0; right: 0; border-top-width: 1.5px; border-right-width: 1.5px; }
.layer-empty-crop.bl { bottom: 0; left: 0; border-bottom-width: 1.5px; border-left-width: 1.5px; }
.layer-empty-crop.br { bottom: 0; right: 0; border-bottom-width: 1.5px; border-right-width: 1.5px; }

.layer-empty-card {
  position: absolute;
  inset: 12px 18px;
  border-radius: var(--r2);
  border: 1px solid var(--line-2);
  background: var(--raised);
  box-shadow: var(--sh-1);
}
.layer-empty-card.back {
  transform: translate(-10px, 7px) scale(0.94);
  opacity: 0.55;
}
.layer-empty-card.mid {
  transform: translate(10px, -6px) scale(0.96);
  background: color-mix(in srgb, var(--raised) 86%, var(--a));
  border-color: var(--a-line);
  opacity: 0.78;
}
.layer-empty-card.front {
  display: grid;
  place-items: center;
  color: var(--a);
  background: var(--a-dim);
  border-color: var(--a-line);
  --ico: var(--ico-lg);
}

.layer-empty-sub {
  margin: 0 0 2px;
  font-size: var(--fz-xs);
  color: var(--fg-3);
}

.layer-empty-open {
  min-width: 152px;
  min-height: 36px;
  padding-inline: 16px;
  --ico: var(--ico-sm);
}

.layer-empty-alert {
  max-width: 360px;
  margin-top: 6px;
  text-align: left;
  align-items: flex-start;
  font-size: var(--fz-xs);
}
.layer-empty-dismiss {
  flex: none;
  margin: -3px -4px -3px 2px;
  color: inherit;
}

.layer-empty-recent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.layer-empty-recent-label {
  margin: 0;
  font-size: var(--fz-2xs);
  color: var(--fg-4);
}
.layer-empty-recent-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-width: 100%;
}
.layer-empty-recent-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 180px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--well);
  font-size: var(--fz-xs);
  color: var(--fg-2);
  --ico: var(--ico-xs);
  transition: border-color var(--t1) var(--e), background var(--t1) var(--e), color var(--t1) var(--e);
}
.layer-empty-recent-btn:hover:not(:disabled) {
  border-color: var(--line-2);
  background: var(--hover);
  color: var(--fg);
}
.layer-empty-recent-btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
