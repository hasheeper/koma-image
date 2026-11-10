<script setup lang="ts">
import type { Retrospect, RetrospectNode } from './model.ts';
import type { ReviewPicture } from './view.ts';
import { useId } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
import CompareIdentity from './CompareIdentity.vue';
defineProps<{ a: RetrospectNode | null; b: RetrospectNode; graph: Retrospect; pictures: Record<string, ReviewPicture>; automatic: boolean }>();
defineEmits<{ baseline: [id: string | null]; swap: [] }>();
const menuId = useId();
</script>
<template>
  <section class="compare-pair" aria-label="对照版本">
    <div class="current-version">
      <CompareIdentity :node="b" :sample="pictures[b.id]" :description="b.description" mark="B" hero brief><span :title="b.label">{{ b.label }}</span></CompareIdentity>
      <div v-if="$slots.controls" class="window-controls"><slot name="controls" /></div>
    </div>
    <div class="baseline-row">
      <span class="baseline-label">对比</span>
      <div class="baseline-group">
        <PopoverMenu :id="menuId" label="对比基准" side="left" compact>
          <template #trigger="{ open, toggle }">
            <button class="baseline-select" type="button" aria-label="选择对比基准" :aria-description="a ? `${a.id} · 样本 ${pictures[a.id]?.id ?? '不可用'}` : undefined" :title="a ? `A · ${a.id} · ${pictures[a.id]?.id ?? '不可用'} · ${a.label}` : '选择对比基准'" aria-haspopup="menu" :aria-expanded="open" @click="toggle">
              <CompareIdentity :node="a" :sample="a && pictures[a.id]" compact brief /><span class="baseline-caret"><AppIcon name="i-chevron" /></span>
            </button>
          </template>
          <template #default="{ close }">
            <button class="menu-item" type="button" role="menuitemradio" :aria-checked="automatic" @click="$emit('baseline', null); close(true)"><AppIcon name="i-branch" /><span>跟随父版本</span><AppIcon v-if="automatic" name="i-check" /></button><hr />
            <button v-for="node in graph.nodes.filter(n => n.id !== b.id)" :key="node.id" class="menu-item version-option" type="button" role="menuitemradio" :aria-checked="a?.id === node.id && !automatic" @click="$emit('baseline', node.id); close(true)"><img :src="pictures[node.id]?.url" alt="" /><span><b>{{ node.id }}</b> {{ node.label }}<small>{{ pictures[node.id]?.id }}</small></span><AppIcon v-if="a?.id === node.id && !automatic" name="i-check" /></button>
          </template>
        </PopoverMenu>
        <button class="ibtn pair-swap" type="button" aria-label="交换对比方向" title="交换对比方向" :disabled="!a" @click="$emit('swap')"><AppIcon name="i-swap" /></button>
      </div>
      <div v-if="$slots.aside" class="comparison-status"><slot name="aside" /></div>
    </div>
  </section>
</template>
<style scoped>
.compare-pair { min-width: 0; }
.current-version { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: var(--sp-2); min-width: 0; }
.current-version :deep(.thumb) { box-shadow: 0 0 0 1px var(--a-line); }
.window-controls { display: flex; gap: var(--sp-1); }
.baseline-label { flex: none; color: var(--fg-3); font-size: var(--fz-xs); white-space: nowrap; }
.baseline-row { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; margin-top: var(--sp-3); }
.baseline-group { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.baseline-select { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; max-width: 100%; min-height: 40px; padding: var(--sp-1) var(--sp-3) var(--sp-1) var(--sp-2); border-radius: 999px; background: var(--raised); text-align: left; }
.baseline-select :deep(.identity) { gap: var(--sp-2); }
.baseline-select:hover, .baseline-select[aria-expanded="true"] { color: var(--fg); background: var(--hover); }
.baseline-caret { display: grid; place-items: center; flex: none; width: var(--ico-md); height: var(--ico-md); color: var(--fg-3); --ico: var(--ico-sm); }
.baseline-caret .ico { transform: rotate(90deg); transform-origin: center; transition: transform var(--t1) var(--e); }
.baseline-select[aria-expanded="true"] .baseline-caret .ico { transform: rotate(-90deg); }
.pair-swap { flex: none; width: 28px; height: 28px; --ico: var(--ico-sm); border-radius: var(--r2); color: var(--fg-2); }
.pair-swap:hover:not(:disabled) { background: var(--hover); color: var(--fg); }
.pair-swap:disabled { opacity: .4; cursor: default; }
.version-option > img { width: 24px; height: 28px; object-fit: contain; border-radius: var(--r1); }
.version-option > span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.version-option b { font: var(--fz-xs) var(--mono); margin-right: 4px; }
.version-option small { margin-left: var(--sp-2); color: var(--fg-3); font: var(--fz-xs)/1.3 var(--mono); }
.comparison-status { display: flex; align-items: center; gap: var(--sp-2); margin-left: auto; }
</style>
