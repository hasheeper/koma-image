<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PoolLayer, Rect } from './project.ts';

const props = defineProps<{ item: PoolLayer; masks: { id: string; name: string }[]; busy: boolean }>();
const emit = defineEmits<{ fit: [Rect]; clip: [string] }>();
const box = ref({ ...props.item.box });
const mask = ref('');
watch(() => props.item, item => { box.value = { ...item.box }; }, { immediate: true });
const axes = { x: 'X', y: 'Y', width: '宽', height: '高' } as const;
</script>
<template>
  <div class="layer-fit" role="group" :aria-label="item.name + ' 校准'">
    <div class="layer-fit-coordinates">
      <label v-for="(label, key) in axes" :key="key">
        {{ label }} <input type="number" v-model.number="box[key]" :aria-label="'原画布 ' + label" step="1" />
      </label>
    </div>
    <button type="button" class="layer-mini" :disabled="busy" @click="emit('fit', { ...box })">
      应用位置与尺寸
    </button>
    <small>
      图像尺寸 {{ item.width }}×{{ item.height }}<template v-if="item.providerPlacement?.absolute"> · 接口像素边界 {{ item.providerPlacement.absolute.join(', ') }}</template><template v-if="item.providerPlacement?.normalized"> · 接口归一化边界 {{ item.providerPlacement.normalized.join(', ') }}</template>
    </small>
    <template v-if="masks.length && !item.needsPosition">
      <label>裁片轮廓
        <select v-model="mask" aria-label="裁片轮廓">
          <option value="">选择图层（如同侧眼白）</option>
          <option v-for="m in masks" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
      <button type="button" class="layer-mini" :disabled="busy || !mask" @click="emit('clip', mask)">另存可见裁片</button>
    </template>
  </div>
</template>
<style scoped>
.layer-fit { display: grid; flex: 1 0 100%; gap: 6px; min-width: 0; padding: 6px 0; }
.layer-fit-coordinates { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.layer-fit label { display: grid; gap: 2px; font-size: 12px; }
.layer-fit input, .layer-fit select { width: 100%; min-width: 0; }
.layer-fit button { justify-self: start; }
</style>
