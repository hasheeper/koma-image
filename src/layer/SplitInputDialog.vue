<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue';
import type { CatalogModel } from '../domain/catalog.ts';
import type { SmallSplitInput, SplitInputUpscale } from './decompose.ts';

const props = defineProps<{
  input: SmallSplitInput;
  models: readonly { model: CatalogModel; label: string }[];
}>();
const emit = defineEmits<{ choose: [method?: SplitInputUpscale] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const selected = ref(-1);

onMounted(() => dialog.value?.showModal());

function submit() {
  emit('choose', props.models[selected.value]?.model ?? 'local');
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="modal"
      aria-labelledby="splitInputTitle"
      aria-describedby="splitInputSize"
      @cancel.prevent="emit('choose')"
      @keydown.stop
      @keyup.stop
    >
      <form class="modal-form" @submit.prevent="submit">
        <header class="modal-head">
          <h2 id="splitInputTitle">拆层送图尺寸不足</h2>
        </header>
        <div class="modal-body split-input-body">
          <p id="splitInputSize">
            {{ input.name }}的送图为 {{ input.source.width }}×{{ input.source.height }}。
            Seedream 5.5 至少需要 {{ input.minPixels.toLocaleString('zh-CN') }} 像素，本次送图将等比放大到
            {{ input.target.width }}×{{ input.target.height }}。
          </p>
          <div v-if="models.length" class="fld">
            <label for="splitInputMethod">放大方式</label>
            <select id="splitInputMethod" v-model="selected">
              <option :value="-1">本地等比放大</option>
              <option v-for="({ model, label }, index) in models" :key="model.connection + ':' + model.id" :value="index">
                {{ label }}
              </option>
            </select>
          </div>
          <p v-if="selected >= 0">会先请求放大模型，再提交拆层，两步按各自连接计费。</p>
        </div>
        <footer class="modal-foot">
          <div class="modal-actions">
            <button type="button" class="btn btn-quiet" @click="emit('choose')">取消</button>
            <button type="submit" class="btn btn-primary">{{ models.length ? '放大并继续' : '本地放大并继续' }}</button>
          </div>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.split-input-body { display: grid; gap: var(--sp-3); }
.split-input-body p { margin: 0; font-size: var(--fz-sm); line-height: 1.6; color: var(--fg-2); }
</style>
