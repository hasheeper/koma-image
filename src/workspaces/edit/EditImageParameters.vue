<script setup lang="ts">
import { computed } from 'vue';
import { useEditor } from '../../app/editor';
import { normalizeOptions } from '../../domain/catalog';
import { chatOptionLabel, chatOptionNames } from '../../domain/chat-options';
import AppIcon from '../../shared/AppIcon.vue';
import ModelParameterInput from '../../shared/ModelParameterInput.vue';
const { editor, view } = useEditor();
const options = computed(() => view.value.model ? normalizeOptions(view.value.model, view.value.session.options[view.value.model.id]) : {});
const locked = computed(() => view.value.busy || view.value.preparing);
const edges = { dilate: '外扩', feather: '羽化' } as const;
type Edge = keyof typeof edges;
const percent = (key: Edge) => Math.round(view.value.session.imageEdit.edges[key] * 1000) / 10;
function edge(key: Edge, event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.value.trim()) { input.value = String(percent(key)); return; }
  if (input.reportValidity()) editor.setImageEdit({ edges: { ...view.value.session.imageEdit.edges, [key]: input.valueAsNumber / 100 } });
}
</script>
<template>
  <div class="image-edit-parameters">
    <div v-if="Object.keys(view.model?.fields ?? {}).length" class="image-edit-fields">
      <div v-for="(field, key) in view.model?.fields" :key="key" class="image-edit-field">
        <label :for="`editorImageOption-${key}`">{{ field.label || chatOptionNames[key] || key }}</label>
        <ModelParameterInput :id="`editorImageOption-${key}`" :field="field" :value="options[key]" :format="chatOptionLabel" :disabled="locked" @change="editor.setOption(key, $event, view.session.mode)" />
      </div>
    </div>
    <details class="image-edit-edges">
      <summary><span>蒙版边缘</span><AppIcon name="i-chevron" /></summary>
      <div class="scrubs image-edit-edge-controls">
        <div v-for="(name, key) in edges" :key="key" class="scrub scrub-sm" :style="{ '--p': `${percent(key) / 2.5 * 100}%` }">
          <span>{{ name }}</span>
          <div class="image-edit-edge-value">
            <input type="number" :aria-label="`蒙版${name}百分比`" :title="`${name}占原图短边的百分比`" min="0" max="2.5" step="0.1" :value="percent(key)" :disabled="locked" @change="edge(key, $event)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
            <span aria-hidden="true">%</span>
          </div>
          <input type="range" :aria-label="`蒙版${name}`" min="0" max="2.5" step="0.1" :value="percent(key)" :aria-valuetext="`${percent(key)}%`" :disabled="locked" @input="edge(key, $event)" />
        </div>
      </div>
    </details>
    <label v-if="view.model && view.model.maxImages < 2" class="check"><input type="checkbox" :checked="view.session.imageEdit.textOnly" @change="editor.setImageEdit({textOnly: ($event.target as HTMLInputElement).checked})" /><span aria-hidden="true" /><span>仅方位文字</span></label>
  </div>
</template>
<style scoped>
.image-edit-parameters { display: grid; gap: var(--sp-3); min-width: 0; padding-bottom: var(--sp-2); }
.image-edit-fields { display: grid; gap: var(--sp-2); }
.image-edit-field { display: grid; grid-template-columns: minmax(0, 80px) minmax(0, 1fr); gap: var(--sp-2); align-items: center; }
/* Row names read like the drawer's field labels, a step below the section heading. */
.image-edit-field > label { color: var(--fg-3); font-size: var(--fz-xs); font-weight: var(--fw-medium); letter-spacing: 0.01em; line-height: 1.4; overflow-wrap: anywhere; }
.image-edit-field :deep(.model-parameter-input) { min-height: 34px; }
.image-edit-edges { min-width: 0; }
.image-edit-fields + .image-edit-edges { margin-top: var(--sp-1); }
/* Same heading voice as 角色; spacing, not a rule, separates it from the rows. */
.image-edit-edges summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); min-height: 30px; color: var(--fg-2); font-size: var(--fz-xs); font-weight: var(--fw-semibold); letter-spacing: 0.01em; list-style: none; cursor: pointer; transition: color var(--t1) var(--e); }
.image-edit-edges summary::-webkit-details-marker { display: none; }
.image-edit-edges summary:hover { color: var(--fg); }
.image-edit-edges summary > .ico { --ico: var(--ico-sm); color: var(--fg-3); transition: transform var(--t1) var(--e); }
.image-edit-edges[open] summary > .ico { transform: rotate(90deg); }
.image-edit-edge-controls { padding-top: var(--sp-1); }
.image-edit-edge-value { position: relative; z-index: 1; display: flex; align-items: center; gap: 1px; font: var(--fw-semibold) var(--fz-sm)/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--fg); }
.image-edit-edge-value > input { width: 4ch; min-width: 0; height: 24px; padding: 0; border: 0; border-radius: var(--r1); background: transparent; box-shadow: none; font: inherit; text-align: right; }
.image-edit-edge-value > input:focus { background: var(--well-focus); box-shadow: var(--ring); }
.image-edit-edge-value > span { color: var(--fg-3); font-size: var(--fz-xs); font-weight: var(--fw-regular); pointer-events: none; }
</style>
