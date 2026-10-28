<script setup lang="ts">
import { computed } from "vue";
import { useEditor } from "../app/editor";
import { naiCapabilities } from "../domain/nai";
import { noiseSchedules, naiNoiseSchedule, supportsNaiVariety } from "../domain/nai-parameters";
import { randomSeed, samplerName } from "../domain/drawing";
import AppIcon from "../shared/AppIcon.vue";
import GuidanceControl from "../shared/GuidanceControl.vue";
const { editor, view } = useEditor();
const session = computed(() => view.value.session);
const medium = computed(() => naiCapabilities(view.value.model?.id ?? "").medium);
const official = computed(() => view.value.model?.profileId === "nai-official-v1");
const v45 = computed(() => official.value && naiCapabilities(view.value.model?.id ?? "").supported && !naiCapabilities(view.value.model?.id ?? "").v5);
const controls = computed(() => [
  { key: "noise" as const, id: "editorNoise", label: "噪声", min: 0, max: official.value ? .99 : 1, step: .01 },
  { key: "steps" as const, id: "editorSteps", label: "步数", min: 1, max: 50, step: 1 },
  { key: "scale" as const, id: "editorScale", label: "Guidance", min: 0, max: 20, step: .5 },
  { key: "cfgRescale" as const, id: "editorCfgRescale", label: "Guidance Rescale", min: 0, max: 1, step: .01 },
].filter(c => c.key !== "noise" || session.value.mode !== "inpaint" || view.value.model?.profileId !== "nai-official-v1"));
type Key = typeof controls.value[number]["key"];
const value = (key: Key) => key === "noise" ? view.value.enhancing ? session.value.enhance.noise : session.value.noise[session.value.mode]
  : medium.value && key === "steps" ? 14 : medium.value && key === "cfgRescale" ? 0 : session.value.fields[key];
function change(key: Key, event: Event) {
  const n = Number((event.target as HTMLInputElement).value);
  if (key === "noise") editor.setNumber(key, n); else editor.patch({ [key]: n });
}
</script>
<template>
  <div class="editor-parameters">
    <div class="fld"><div class="fld-top"><label for="editorSampler">采样器</label></div>
      <select id="editorSampler" :value="medium ? 'k_euler_ancestral' : session.fields.sampler" :disabled="medium" @change="editor.patch({sampler:($event.target as HTMLSelectElement).value})">
        <option v-for="sampler in view.samplers" :key="sampler" :value="sampler">{{ samplerName(sampler) }}</option>
      </select>
    </div>
    <div v-if="v45" class="fld">
      <div class="fld-top"><label for="editorNoiseSchedule">噪声调度</label></div>
      <select id="editorNoiseSchedule" :value="session.fields.noiseSchedule" @change="editor.patch({noiseSchedule: ($event.target as HTMLSelectElement).value as typeof session.fields.noiseSchedule})">
        <option v-for="schedule in noiseSchedules" :key="schedule" :value="schedule">{{ schedule === 'auto' ? `默认 · ${naiNoiseSchedule(view.model!.id, session.fields.sampler, 'auto') === 'exponential' ? 'Exponential' : 'Karras'}` : schedule === 'polyexponential' ? 'Polyexponential' : schedule === 'exponential' ? 'Exponential' : 'Karras' }}</option>
      </select>
    </div>
    <div class="scrubs">
      <template v-for="c in controls" :key="c.key">
      <GuidanceControl v-if="c.key === 'scale'" id="editorScale" :model-value="session.fields.scale" :official="official" :variety-plus="supportsNaiVariety(view.model) ? session.fields.varietyPlus : undefined" @update:model-value="editor.patch({scale: $event})" @update:variety-plus="editor.patch({varietyPlus: $event})" />
      <label v-else class="scrub scrub-sm" :style="{'--p':`${(value(c.key)-c.min)/(c.max-c.min)*100}%`}">
        <span>{{ c.label }}</span><output>{{ value(c.key) }}</output>
        <input :id="c.id" type="range" :aria-label="c.label" :min="c.min" :max="c.max" :step="c.step" :value="value(c.key)" :disabled="medium && (c.key==='steps' || c.key==='cfgRescale')" @input="change(c.key,$event)" />
      </label>
      </template>
    </div>
    <div class="fld"><div class="fld-top"><label for="editorSeed">Seed</label></div><div class="seed">
      <input id="editorSeed" type="number" min="0" max="4294967295" placeholder="随机" :value="view.enhancing ? '' : session.fields.seed" :disabled="view.enhancing" :title="view.enhancing ? 'Enhance 每次使用新 Seed' : undefined" @input="editor.patch({seed:($event.target as HTMLInputElement).value})" />
      <button type="button" class="ibtn" aria-label="随机 Seed" :disabled="view.enhancing" @click="editor.patch({seed:String(randomSeed())})"><AppIcon name="i-dice" /></button>
    </div></div>
  </div>
</template>
<style scoped>
.editor-parameters { display: grid; gap: var(--sp-3); padding: var(--sp-2) 0 var(--sp-3); }
.scrub:has(input:disabled) { opacity: .45; }
</style>
