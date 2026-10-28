<script setup lang="ts">
import { computed } from "vue";
import { useNaiComposer } from "../../app/nai-composer";
import { naiCapabilities, complexities } from "../../domain/nai";
import NaiSelect from "./NaiSelect.vue";
import AppIcon from "../../shared/AppIcon.vue";
const props = defineProps<{ negative: boolean }>();
const { drawing, view, id } = useNaiComposer();
const f = computed(() => view.value.form), cap = computed(() => naiCapabilities(f.value.model));
const labels = { none: "关闭", low: "Low", medium: "Medium", high: "High", ultra: "Ultra", light: "Light", standard: "Standard", heavy: "Heavy", human: "Human", furry: "Furry" };
const options = (values: readonly (keyof typeof labels)[]) => values.map(value => ({ value, label: labels[value] }));
</script>
<template>
  <div v-if="cap.supported" class="prompt-options">
    <template v-if="!props.negative">
      <NaiSelect :disabled="view.locked" v-if="cap.v5" :id="id('complexity')" label="Complexity" caption="复杂度" title="画面复杂度与风格；不改变 Effort" :value="f.complexity" :options="options(complexities)" @change="drawing.patch({ complexity: $event as typeof f.complexity })" />
        <NaiSelect :disabled="view.locked" :id="id('qualityPreset')" label="质量预设" caption="质量" title="发送时追加质量标签，保留输入原文" :value="cap.quality.includes(f.qualityPreset) ? f.qualityPreset : 'none'" :options="options(cap.quality)" @change="drawing.patch({ qualityPreset: $event as typeof f.qualityPreset })" />
        <span class="transparent-wrap" v-if="view.model?.transparentBackground" :id="id('transparentBgWrap')"><button :id="id('transparentBg')" type="button" class="alpha" :disabled="view.locked" :aria-pressed="f.transparentBg" aria-label="透明底" title="透明底：生成时添加 transparent background" @click="drawing.patch({ transparentBg: !f.transparentBg })"><AppIcon name="i-alpha" />透明</button></span>
    </template>
    <template v-else>
      <span v-if="cap.medium" class="medium-note">Medium 不使用负向提示词</span>
      <NaiSelect :disabled="view.locked" v-else :id="id('negativePreset')" label="负向预设" caption="负向" title="发送时追加负向标签，保留输入原文" :value="cap.negative.includes(f.negativePreset) ? f.negativePreset : 'none'" :options="options(cap.negative)" @change="drawing.patch({ negativePreset: $event as typeof f.negativePreset })" />
    </template>
  </div>
</template>
<style scoped>
/* Cover scrolled text to the edge; the empty right inset still passes pointer events to the native resize handle. */
.prompt-options { position: absolute; z-index: 2; right: 1px; bottom: 1px; left: 1px; height: 34px; display: flex; align-items: center; gap: 2px; padding: 0 17px 0 7px; background: var(--well); border-radius: 0 0 var(--r3) var(--r3); pointer-events: none; }
.prompt-options > :deep(*) { pointer-events: auto; }
.transparent-wrap { margin-left: auto; }
.alpha { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 5px; border-radius: var(--r1); white-space: nowrap; font-size: var(--fz-xs); color: var(--fg-3); transition: background var(--t1) var(--e), color var(--t1) var(--e); }
.alpha .ico { --ico: var(--ico-sm); }
.alpha:hover { color: var(--fg); background: var(--hover); }
.alpha[aria-pressed="true"] { color: var(--a); font-weight: var(--fw-medium); }
.alpha:focus-visible { outline: 1px solid var(--a); outline-offset: 0; }
.medium-note { padding-left: 6px; font-size: var(--fz-2xs); color: var(--fg-3); }
</style>
