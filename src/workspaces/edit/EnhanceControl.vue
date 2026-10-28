<script setup lang="ts">
import { computed } from "vue";
import { useEditor } from "../../app/editor";
import { naiEnhanceSize } from "../../domain/nai-enhance";
const { editor, view } = useEditor();
const settings = computed(() => view.value.session.enhance);
const size = computed(() => {
  if (!view.value.base) return "";
  try { const s = naiEnhanceSize(view.value.base, settings.value.scale, view.value.session.chosen.img2img); return `${s.width}×${s.height}`; }
  catch { return ""; }
});
const scaleLabel = (scale: number | "max") => scale === "max" ? "Max" : `${scale}×`;
</script>
<template>
  <div v-if="view.session.mode === 'img2img' && (view.enhanceAvailable || settings.on)" class="fld enhance-control">
    <div class="fld-top">
      <label for="editorEnhance">Enhance</label>
      <label class="enhance-toggle">
        <input id="editorEnhance" type="checkbox" role="switch" :checked="settings.on" :disabled="!view.base" aria-label="Enhance" @change="editor.setEnhance(($event.target as HTMLInputElement).checked)" />
        <span class="switch" aria-hidden="true"></span>
      </label>
    </div>
    <div v-if="settings.on" class="enhance-options">
      <div class="fld">
        <div class="fld-top"><label for="editorEnhanceScale">倍率</label><output class="mono">{{ size }}</output></div>
        <select id="editorEnhanceScale" :value="settings.scale" @change="editor.setEnhanceScale(($event.target as HTMLSelectElement).value)">
          <option v-if="!view.enhanceScales.includes(settings.scale)" :value="settings.scale" disabled>{{ scaleLabel(settings.scale) }} · 不可用</option>
          <option v-for="scale in view.enhanceScales" :key="scale" :value="scale">{{ scaleLabel(scale) }}</option>
        </select>
      </div>
      <div class="fld">
        <div class="fld-top"><label for="editorEnhanceMagnitude">Magnitude</label></div>
        <select id="editorEnhanceMagnitude" :value="settings.magnitude ?? 0" @change="editor.setEnhanceMagnitude(Number(($event.target as HTMLSelectElement).value))">
          <option v-if="settings.magnitude === null" :value="0" disabled>自定义</option>
          <option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
    </div>
  </div>
</template>
<style scoped>
.enhance-toggle { position: relative; display: flex; align-items: center; padding: 3px 0 3px 8px; cursor: pointer; }
.enhance-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.enhance-options { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: var(--sp-3); }
.enhance-options .fld { min-width: 0; }
.enhance-options output { font-size: var(--fz-2xs); color: var(--fg-3); }
</style>
