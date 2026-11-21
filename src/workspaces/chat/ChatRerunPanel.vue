<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { useChat } from '../../app/chat.ts';
import { chatRerunPlan, chatVersionSettings } from '../../domain/chat-options.ts';
import { resolveModel } from '../../domain/catalog.ts';
import type { ConversationTurn, ConversationVersion } from '../../storage/records.ts';
import AppIcon from '../../shared/AppIcon.vue';
import { usePopover } from '../../shared/ui/use-popover.ts';
import ChatParameterRows from './ChatParameterRows.vue';

const props = defineProps<{ turn: ConversationTurn; source: ConversationVersion; anchor: HTMLElement; id: string }>();
const emit = defineEmits<{ close: [] }>();
const { chat, view } = useChat();
const panel = shallowRef<HTMLElement>();
const form = shallowRef<HTMLFormElement>();
const sourceModel = resolveModel(view.value.models, String(chatVersionSettings(props.turn, props.source).model ?? ''));
const modelId = shallowRef(sourceModel?.id ?? '');
const options = shallowRef(sourceModel ? chatRerunPlan(props.turn, props.source, sourceModel).settings.options : {});
const model = computed(() => view.value.models.find(item => item.id === modelId.value));
const groups = computed(() => [...new Set(view.value.models.map(item => item.provider))].map(provider => ({
  label: { openai: 'OpenAI', gemini: 'Gemini', seedream: 'Seedream' }[provider] ?? provider,
  models: view.value.models.filter(item => item.provider === provider),
})));
const plan = computed(() => model.value ? chatRerunPlan(props.turn, props.source, model.value, options.value) : undefined);
const blocked = computed(() => !view.value.ready || !!view.value.busy || !!view.value.uploading);
const imageCount = computed(() => props.turn.snapshot.imageIds.length);

function selectModel(event: Event) {
  modelId.value = (event.target as HTMLSelectElement).value;
  if (plan.value) options.value = plan.value.settings.options;
}
function setOption(key: string, value: string) {
  options.value = { ...options.value, [key]: value };
}

const popover = usePopover(panel, {
  resize: 'place', closeOnScroll: 'outside', visualViewport: true, observe: () => [form.value],
  position() {
    const element = panel.value;
    if (!element) return;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0, height = viewport?.height ?? innerHeight, bottom = top + height;
    if (matchMedia('(width <= 640px)').matches) {
      element.style.inset = `auto 0 ${Math.max(0, innerHeight - bottom)}px`;
      element.style.maxHeight = `${height * .8}px`;
      return;
    }
    const rect = props.anchor.getBoundingClientRect(), width = document.documentElement.clientWidth;
    const result = props.anchor.closest('.chat-result')?.getBoundingClientRect();
    const side = (result?.right ?? rect.right) + 12;
    if (side + element.offsetWidth <= width - 8) {
      element.style.maxHeight = `${height - 16}px`;
      const y = Math.min(rect.bottom, bottom - 8) - element.offsetHeight;
      element.style.inset = `${Math.max(top + 8, y)}px auto auto ${side}px`;
      return;
    }
    const above = rect.top - top - 12, below = bottom - rect.bottom - 12;
    const up = element.scrollHeight <= above || above >= below;
    element.style.maxHeight = `${Math.max(1, up ? above : below)}px`;
    const left = Math.min(Math.max(8, rect.right - element.offsetWidth), width - element.offsetWidth - 8);
    const y = up ? rect.top - 4 - element.offsetHeight : rect.bottom + 4;
    element.style.inset = `${Math.max(top + 8, y)}px auto auto ${left}px`;
  },
  onClose: () => emit('close'),
});

function submit() {
  if (blocked.value || !plan.value || plan.value.issue) return;
  const attempt = { versionId: props.source.id, modelId: modelId.value, options: plan.value.settings.options };
  popover.close();
  void chat.execute(props.turn, attempt);
}
onMounted(() => panel.value?.showPopover({ source: props.anchor }));
</script>

<template>
  <section :id="id" ref="panel" class="chat-rerun-panel" popover role="dialog" aria-label="重新生成" @beforetoggle="popover.beforeToggle" @toggle="popover.toggled">
    <form ref="form" @submit.prevent="submit">
      <header class="chat-rerun-head">
        <h2>重新生成</h2>
        <button class="ibtn" type="button" aria-label="关闭重新生成" @click="popover.close()"><AppIcon name="i-close" /></button>
      </header>
      <p>沿用本轮原文 · 输入图 {{ imageCount }} 张</p>
      <label class="chat-rerun-model">
        <span>模型</span>
        <select :value="modelId" :disabled="blocked" aria-label="重跑模型" @change="selectModel">
          <option v-if="!model" value="" disabled>请选择可用模型</option>
          <optgroup v-for="group in groups" :key="group.label" :label="group.label">
            <option v-for="item in group.models" :key="item.id" :value="item.id">{{ item.name }}</option>
          </optgroup>
        </select>
      </label>
      <ChatParameterRows v-if="model && Object.keys(model.fields).length" :key="model.id" :fields="model.fields" :options="plan?.settings.options ?? options" :disabled="blocked" @change="setOption" />
      <p v-if="plan?.issue" class="chat-rerun-issue" role="status">{{ plan.issue }}</p>
      <footer>
        <span>只作用于新版本</span>
        <button class="btn btn-primary" type="submit" :disabled="blocked || !plan || !!plan.issue">生成新版本</button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.chat-rerun-panel { position: fixed; width: min(368px, 100vw - 16px); margin: 0; padding: 0; overflow: auto; overscroll-behavior: contain; color: var(--fg); background: var(--glass-pop-bg); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--glass-pop-shadow); }
.chat-rerun-panel form { display: grid; gap: var(--sp-3); padding: var(--sp-3); }
.chat-rerun-panel :deep(.param-rows) { padding: 0; }
.chat-rerun-panel :deep(.param-name) { color: var(--fg-3); }
.chat-rerun-head, .chat-rerun-panel footer { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.chat-rerun-head h2 { margin: 0; font-size: var(--fz-md); font-weight: var(--fw-semibold); }
.chat-rerun-panel p, .chat-rerun-panel footer span { margin: 0; color: var(--fg-3); font-size: var(--fz-xs); }
.chat-rerun-model { display: grid; grid-template-columns: minmax(64px, 24%) minmax(0, 1fr); align-items: center; gap: 8px; font-size: var(--fz-xs); color: var(--fg-3); }
.chat-rerun-model select { min-width: 0; padding: var(--sp-2) var(--sp-5) var(--sp-2) var(--sp-2); color: var(--fg); background-color: var(--well); border: 1px solid var(--line-2); border-radius: var(--r2); }
.chat-rerun-panel .chat-rerun-issue { color: var(--err); }
.chat-rerun-panel footer { padding-top: var(--sp-3); border-top: 1px solid var(--line-2); }
@media (width <= 640px) {
  .chat-rerun-panel { width: 100%; border-radius: var(--r4) var(--r4) 0 0; }
  .chat-rerun-panel form { padding-bottom: calc(var(--sp-3) + env(safe-area-inset-bottom)); }
  .chat-rerun-panel :deep(.param-chip) { min-height: 40px; }
}
</style>
