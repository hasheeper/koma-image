<script setup lang="ts">
import { computed, ref } from 'vue';
import { channelTemplates, imageFormats, modelOperations, newImageChannel, optionalImagePath, type ImageChannelConfig, type ImageFormat, type ImagePath, type ModelOperation } from '../../config/image-channel';
import { findModel } from '../../domain/models';

const config = defineModel<ImageChannelConfig>({ required: true });
const props = defineProps<{ disabled: boolean; baseUrl: string }>();
const paths = computed(() => Object.keys(newImageChannel(config.value.format).paths) as ImagePath[]);
const templates = computed(() => channelTemplates(config.value.format));
const selectedTemplate = ref('');
const binding = computed(() => templates.value?.find(item => item.templateId === selectedTemplate.value) ?? templates.value?.[0]);
const generateUrl = computed(() => {
  if (!props.baseUrl || !config.value.paths.generate) return '';
  let path = config.value.paths.generate;
  if (config.value.format === 'fal-queue' && binding.value) {
    const model = config.value.modelIds?.[binding.value.templateId]?.generate || binding.value.generate;
    path = path.replace('{model}', model);
  }
  return props.baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
});
const labels: Record<ImagePath, string> = { catalog: '目录后缀', generate: '生图后缀', toolRun: '改图后缀', layerDecompose: '拆层后缀', uploadImage: '上传后缀', imageTask: '任务查询后缀', imageResult: '任务结果后缀' };
const operations: Record<ModelOperation, string> = { generate: '生图', edit: '改图', decompose: '拆层' };
function pathHint(key: ImagePath) {
  if (key === 'catalog') return '可选，留空使用本地模型配置';
  if (key === 'layerDecompose') return '留空沿用改图后缀';
  if (config.value.format === 'fal-queue' && (key === 'imageTask' || key === 'imageResult')) return '留空使用队列返回的地址';
}
function changeFormat(event: Event) {
  config.value = newImageChannel((event.target as HTMLSelectElement).value as ImageFormat);
}
function updateId(template: string, op: ModelOperation, event: Event) {
  const ids = config.value.modelIds ??= {};
  (ids[template] ??= {})[op] = (event.target as HTMLInputElement).value;
}
</script>
<template>
  <div class="fld">
    <label for="imageChannelFormat">请求格式</label>
    <select id="imageChannelFormat" :value="config.format" :disabled="disabled" @change="changeFormat">
      <option v-for="(name, format) in imageFormats" :key="format" :value="format">{{ name }}</option>
    </select>
    <small v-if="config.format === 'fal-queue'" class="hint">fal 官方队列基础地址为 https://queue.fal.run。{model} 替换为本次操作的模型路径。</small>
    <small v-else class="hint">接口后缀接在基础地址之后，保留地址中已有的路径。{{ config.format === 'gemini-native' ? '后缀中的 {model} 会替换为上游模型 ID，也可填写固定模型路径。' : '' }}</small>
  </div>
  <div v-for="key in paths" :key="key" class="fld">
    <label :for="`channel-path-${key}`">{{ key === 'catalog' && config.format === 'kie-images' ? '账户检查后缀' : labels[key] }}{{ optionalImagePath(config.format, key) ? '（可选）' : '' }}</label>
    <input :id="`channel-path-${key}`" v-model="config.paths[key]" type="text" :disabled="disabled" autocomplete="off" spellcheck="false"
      :required="!optionalImagePath(config.format, key)" maxlength="2048"
      :placeholder="pathHint(key)" />
    <small v-if="key === 'generate' && generateUrl" class="hint endpoint-preview">{{ generateUrl }}</small>
    <small v-if="key === 'imageTask'" class="hint">{{ config.format === 'fal-queue' ? '自定义查询和结果后缀时，用 {taskId} 指定任务 ID 的位置。' : '可用 {taskId} 指定任务 ID 的位置，省略时自动添加 taskId 查询参数。' }}</small>
  </div>
  <div v-if="config.format === 'kie-images'" class="fld">
    <label for="imageUploadBase">上传基础地址</label>
    <input id="imageUploadBase" v-model="config.uploadBaseUrl" :disabled="disabled" type="text" placeholder="留空使用上方地址" autocomplete="off" spellcheck="false" />
    <small class="hint">上传也使用此连接的 API Key。</small>
  </div>
  <details v-if="templates" class="channel-model-ids">
    <summary>上游模型 ID</summary>
    <fieldset v-if="binding" :disabled="disabled">
      <div class="fld">
        <label for="imageChannelTemplate">模型</label>
        <select id="imageChannelTemplate" :value="binding.templateId" @change="selectedTemplate = ($event.target as HTMLSelectElement).value">
          <option v-for="item in templates" :key="item.templateId" :value="item.templateId">{{ findModel(item.templateId)?.name }}</option>
        </select>
        <small v-if="config.format === 'openrouter-images'" class="hint">填写目录后缀时，只启用目录中匹配的模型。目录留空时，可填写上游 ID 启用更多模板。</small>
      </div>
      <div v-for="op in modelOperations(config.format, binding)" :key="op" class="fld">
        <label :for="`channel-model-${binding.templateId}-${op}`">{{ config.format === 'openrouter-images' ? (binding.decompose ? '生图、改图与拆层' : '生图与改图') : operations[op] }}</label>
        <input :id="`channel-model-${binding.templateId}-${op}`" type="text" maxlength="512" spellcheck="false" autocomplete="off"
          :value="config.modelIds?.[binding.templateId]?.[op]" :placeholder="op === 'edit' && binding.edit === binding.generate ? config.modelIds?.[binding.templateId]?.generate || binding.edit : binding[op]"
          @input="updateId(binding.templateId, op, $event)" />
      </div>
    </fieldset>
  </details>
  <small v-else class="hint">可在「设置 → 模型」绑定此来源的上游模型 ID。</small>
</template>
<style scoped>
.endpoint-preview { overflow-wrap: anywhere; }
.channel-model-ids summary { cursor: pointer; }
.channel-model-ids fieldset { display: grid; gap: var(--sp-2); margin-top: var(--sp-2); min-width: 0; }
</style>
