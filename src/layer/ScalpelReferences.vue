<script setup lang="ts">
import { computed, ref } from 'vue';
import LayerThumbnail from './LayerThumbnail.vue';
import type { ReferenceSource, ScalpelReference } from './scalpel-references.ts';

const props = defineProps<{
  sources: ReferenceSource[];
  selected: ScalpelReference[];
  excluded: string[];
  firstImage: number;
  busy: boolean;
}>();
const emit = defineEmits<{
  files: [files: File[]];
  change: [references: ScalpelReference[]];
  remove: [source: ReferenceSource];
  ask: [];
}>();
const picker = ref<HTMLInputElement>();
const rows = computed(() => props.selected.flatMap(ref => {
  const source = props.sources.find(s => s.picture === ref.picture);
  return source ? [{ ...ref, source }] : [];
}));
const available = computed(() => props.sources.filter(source =>
  !props.selected.some(r => r.picture === source.picture) && !props.excluded.includes(source.picture)));

function choose(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (select.value) emit('change', [...props.selected, { picture: select.value, usage: '' }]);
  select.value = '';
}
function importFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length) emit('files', files);
}
function setUsage(picture: string, event: Event) {
  const usage = (event.target as HTMLInputElement).value;
  emit('change', props.selected.map(r => r.picture === picture ? { picture, usage } : r));
}
</script>

<template>
  <section class="scalpel-references" aria-label="补画参考">
    <div class="layer-section-title">
      <h3>补画参考</h3>
      <button type="button" class="layer-link" :disabled="busy" @click="emit('ask')">让 ASK 拟词</button>
    </div>
    <div class="layer-action-row">
      <input ref="picker" type="file" multiple hidden aria-label="导入补画参考图"
        accept="image/png,image/jpeg,image/webp" @change="importFiles" />
      <button type="button" class="layer-secondary" :disabled="busy" @click="picker?.click()">添加参考图</button>
      <label class="layer-field">
        <select aria-label="添加参考图层" :disabled="busy || !available.length" @change="choose">
          <option value="">添加参考图层…</option>
          <optgroup v-if="available.some(s => s.kind === 'layer')" label="正式图层">
            <option v-for="s in available.filter(s => s.kind === 'layer')" :key="s.picture" :value="s.picture">{{ s.name }}</option>
          </optgroup>
          <optgroup v-if="available.some(s => s.kind === 'file')" label="已导入参考图">
            <option v-for="s in available.filter(s => s.kind === 'file')" :key="s.picture" :value="s.picture">{{ s.name }}</option>
          </optgroup>
        </select>
      </label>
    </div>
    <div v-for="(row, i) in rows" :key="row.picture" class="scalpel-reference-row">
      <LayerThumbnail :image="row.source.image" />
      <div class="layer-field">
        <div class="layer-section-title">
          <span :title="row.source.name">图 {{ firstImage + i }} · {{ row.source.name }}</span>
          <button type="button" class="layer-link" :disabled="busy" :aria-label="'移除参考 ' + row.source.name"
            @click="emit('remove', row.source)">移除</button>
        </div>
        <input :aria-label="'参考用途 ' + row.source.name" :value="row.usage" maxlength="500" :disabled="busy"
          placeholder="参考用途，如只参考发梢颜色" @input="setUsage(row.picture, $event)" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.scalpel-references { display: grid; gap: 7px; }
.layer-action-row > .layer-field { flex: 1; }
.scalpel-reference-row { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 8px; align-items: center; }
.scalpel-reference-row .layer-thumb { width: 38px; height: 38px; }
.scalpel-reference-row .layer-section-title span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
