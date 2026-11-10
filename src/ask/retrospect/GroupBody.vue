<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import TextChanges from './TextChanges.vue';
import type { RecipeGroup } from './groups.ts';
import ParameterChanges from './ParameterChanges.vue';
import UnchangedFields from './UnchangedFields.vue';
import PositionChanges from './PositionChanges.vue';
const props = defineProps<{ group: RecipeGroup; full: boolean; baseline: boolean }>();
const visibleTexts = computed(() => props.group.texts.filter(f => props.full || !props.baseline || f.changed));
const sameTexts = computed(() => props.group.texts.filter(f => props.baseline && !props.full && !f.changed));
const visibleParams = computed(() => props.group.parameters.filter(p => props.full || !props.baseline || p.changed));
const sameParams = computed(() => props.group.parameters.filter(p => props.baseline && !props.full && !p.changed));
const showPosition = computed(() => props.group.position && (props.full || !props.baseline || props.group.position.changed));
const samePosition = computed(() => props.group.position && props.baseline && !props.full && !props.group.position.changed);
const labels = computed(() => [...sameTexts.value.map(f => f.label.split(' · ').at(-1)!), ...(samePosition.value ? ['位置'] : []), ...(sameParams.value.length ? ['参数'] : [])]);
</script>
<template>
  <div class="group-body" >
    <div v-for="field in visibleTexts" :key="field.key" class="field" :data-field="field.key"><h4>{{ field.label.split(' · ').at(-1) }}</h4><div class="paired-text"><TextChanges :field="field" :full="full && field.changed" :has-baseline="baseline && field.changed" /></div></div>
    <div v-if="visibleParams.length" class="params"><ParameterChanges :values="visibleParams" :compare="baseline" /></div>
    <div v-if="showPosition && group.position" class="field"><h4>位置</h4><PositionChanges :value="group.position" :compare="baseline" /></div>
    <details v-if="group.id === 'params' && sameParams.length" class="parameter-fold"><summary>{{ visibleParams.length ? '全部' : '未改动' }}<AppIcon name="i-chevron" /></summary><ParameterChanges :values="sameParams" :compare="baseline" /></details>
    <div v-else-if="labels.length" class="unchanged"><UnchangedFields :labels="labels"><div v-for="field in sameTexts" :key="field.key" class="field" :data-field="field.key"><h4>{{ field.label.split(' · ').at(-1) }}</h4><TextChanges :field="field" full :has-baseline="false" /></div><div v-if="samePosition && group.position" class="field"><h4>位置</h4><PositionChanges :value="group.position" :compare="false" /></div><ParameterChanges v-if="sameParams.length" :values="sameParams" :compare="baseline" /></UnchangedFields></div>
  </div>
</template>
<style scoped>
.group-body { display: grid; gap: var(--sp-3); min-width: 0; }
.paired-text { display: grid; gap: var(--sp-1); min-width: 0; }
.field { display: grid; gap: var(--sp-1); min-width: 0; }
h4 { margin: 0; color: var(--fg-2); font-size: var(--fz-sm); font-weight: var(--fw-regular); }
.parameter-fold summary { display: flex; justify-content: flex-end; align-items: center; gap: var(--sp-1); min-height: 24px; color: var(--fg-3); font-size: var(--fz-xs); list-style: none; cursor: pointer; }
.parameter-fold summary::-webkit-details-marker { display: none; }
.parameter-fold summary .ico { --ico: var(--ico-xs); }
.parameter-fold[open] summary .ico { transform: rotate(90deg); }
.parameter-fold summary:hover { color: var(--fg-2); }
</style>
