<script setup lang="ts">
import { computed } from "vue";
import { useDrawing } from "../../app/drawing";
import { DEFAULTS, samplerName, randomSeed } from "../../domain/drawing";
import type { DrawingForm } from "../../domain/drawing";
import { naiCapabilities } from "../../domain/nai";
import AppIcon from "../../shared/AppIcon.vue";
const { drawing, view } = useDrawing();
const f = computed(() => view.value.form);
const cap = computed(() => naiCapabilities(f.value.model));
const parameterValue = (key: "steps" | "scale" | "cfgRescale") => cap.value.medium ? key === "steps" ? 14 : key === "cfgRescale" ? 0 : f.value[key] : f.value[key];
function change(key: keyof DrawingForm, event: Event) {
  const input = event.target as HTMLInputElement;
  void drawing.patch({ [key]: input.type === "checkbox" ? input.checked : input.type === "range" || (input.type === "number" && key !== "seed") ? Number(input.value) : input.value });
}
function reset() {
  void drawing.patch({
    sampler: view.value.samplers.includes(DEFAULTS.sampler)
      ? DEFAULTS.sampler
      : view.value.samplers[0],
    steps: 25,
    scale: 5,
    cfg: 10,
    cfgRescale: 0,
    seed: "",
    batchCount: 1,
    optimize: false,
  });
}
</script>
<template>
<div class="drawing-parameters">
      <div class="fld">
        <div class="fld-top"><label for="sampler">采样器</label></div>
        <select
          id="sampler"
          :value="cap.medium ? 'k_euler_ancestral' : f.sampler"
          :disabled="cap.medium"
          :title="cap.medium ? 'Medium 固定 Euler Ancestral' : undefined"
          @change="change('sampler', $event)"
        >
          <option
            v-for="sampler in view.samplers"
            :key="sampler"
            :value="sampler"
          >
            {{ samplerName(sampler) }}
          </option>
        </select>
      </div>
      <div class="scrubs">
        <label
          v-for="control in [
            { key: 'steps' as const, label: '步数', min: 1, max: 50, step: 1 },
            {
              key: 'scale' as const,
              label: 'Guidance',
              min: 0,
              max: 20,
              step: 0.5,
            },
            { key: 'cfgRescale' as const, label: 'Guidance Rescale', min: 0, max: 1, step: 0.01 },
          ]"
          :key="control.key"
          class="scrub scrub-sm"
          :style="{
            '--p':
              ((parameterValue(control.key) - control.min) /
                (control.max - control.min)) *
                100 +
              '%',
          }"
          ><span>{{ control.label }}</span
          ><output :id="`${control.key}Val`">{{ parameterValue(control.key) }}</output
          ><input
            :id="control.key"
            type="range"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :value="parameterValue(control.key)"
            :disabled="cap.medium && control.key !== 'scale'"
            :aria-label="control.label"
            :title="control.key === 'scale' ? '提示词引导强度（CFG Scale）' : control.key === 'cfgRescale' ? '缓解高 Guidance 带来的过饱和与高对比；Medium 不适用' : cap.medium ? 'Medium 固定 14 步' : undefined"
            @input="change(control.key, $event)"
        /></label>
      </div>
      <div class="fld">
        <div class="fld-top"><label for="seed">Seed</label></div>
        <div class="seed">
          <input
            id="seed"
            type="number"
            min="0"
            max="4294967295"
            placeholder="随机"
            :value="f.seed"
            @input="change('seed', $event)"
          /><button
            class="ibtn"
            id="diceBtn"
            type="button"
            data-tip="随机 Seed"
            aria-label="随机 Seed"
            @click="drawing.patch({ seed: String(randomSeed()) })"
          >
            <AppIcon name="i-dice" />
          </button>
        </div>
      </div>
      <div class="fld">
        <div class="fld-top">
          <label for="batchCount">串行批量</label
          ><span class="mono dim">1 张起</span>
        </div>
        <div class="fld-inline">
          <input
            id="batchCount"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            :value="view.batchCount"
            aria-describedby="batchHint"
            @input="change('batchCount', $event)"
            @keydown.enter.prevent
          /><span>张</span>
        </div>
        <p class="hint" id="batchHint">
          严格逐张请求；失败或取消时停止剩余队列。
        </p>
      </div>
      <div class="switches">
        <label class="check"
          ><input
            id="optimize"
            type="checkbox"
            :checked="f.optimize"
            @change="change('optimize', $event)"
          /><span></span>去除元数据<i class="sub">保持 PNG 原图</i></label
        >
      </div>
      <button
        class="btn btn-quiet btn-block btn-sm"
        id="resetAdv"
        type="button"
        @click="reset"
      >
        <AppIcon name="i-reset" />恢复默认
      </button>
    </div>
</template>
<style scoped>
.drawing-parameters { display: grid; gap: var(--sp-3); padding: var(--sp-2) 0 var(--sp-3); }
.scrub:has(input:disabled) { opacity: .45; }
</style>
