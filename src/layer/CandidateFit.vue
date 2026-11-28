<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PoolLayer, Rect } from './project.ts';

const props = defineProps<{ item: PoolLayer; masks: { id: string; name: string }[]; busy: boolean }>();
const emit = defineEmits<{ fit: [Rect]; clip: [string] }>();
const box = ref({ ...props.item.box });
const mask = ref('');
watch(
  () => props.item,
  (item) => {
    box.value = { ...item.box };
  },
  { immediate: true },
);
const axes = { x: 'X', y: 'Y', width: '宽', height: '高' } as const;
</script>

<template>
  <div class="layer-fit" role="group" :aria-label="item.name + ' 校准'">
    <div class="layer-fit-coordinates">
      <label v-for="(label, key) in axes" :key="key">
        <span>{{ label }}</span>
        <input v-model.number="box[key]" type="number" :aria-label="'原画布 ' + label" step="1" />
      </label>
    </div>
    <div class="layer-fit-row">
      <button type="button" class="btn btn-accent btn-sm" :disabled="busy" @click="emit('fit', { ...box })">
        应用位置与尺寸
      </button>
    </div>
    <small class="layer-fit-meta mono">
      图像尺寸 {{ item.width }}×{{ item.height
      }}<template v-if="item.providerPlacement?.absolute">
        · 接口像素边界 {{ item.providerPlacement.absolute.join(', ') }}</template
      ><template v-if="item.providerPlacement?.normalized">
        · 接口归一化边界 {{ item.providerPlacement.normalized.join(', ') }}</template
      >
    </small>
    <template v-if="masks.length && !item.needsPosition">
      <div class="layer-fit-clip">
        <label class="fld">
          <span>裁片轮廓</span>
          <select v-model="mask" aria-label="裁片轮廓">
            <option value="">选择图层（如同侧眼白）</option>
            <option v-for="m in masks" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </label>
        <button type="button" class="btn btn-quiet btn-sm" :disabled="busy || !mask" @click="emit('clip', mask)">
          另存可见裁片
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.layer-fit {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin: 0 6px 6px;
  padding: 10px;
  border-radius: var(--r2);
  background: var(--group-bg);
  border: 1px solid var(--line);
}

.layer-fit-coordinates {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.layer-fit-coordinates label {
  display: grid;
  gap: 3px;
  font-size: var(--fz-2xs);
  color: var(--fg-3);
}

.layer-fit-coordinates input {
  padding: 5px 6px;
  font-size: var(--fz-xs);
  font-variant-numeric: tabular-nums;
}

.layer-fit-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.layer-fit-meta {
  font-size: var(--fz-2xs);
  line-height: 1.45;
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.layer-fit-clip {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.layer-fit-clip > button {
  justify-self: start;
}
</style>
