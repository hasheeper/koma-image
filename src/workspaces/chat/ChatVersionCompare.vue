<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue';
import { useChat } from '../../app/chat.ts';
import { chatOptionLabel, chatOptionNames, chatVersionModelName, chatVersionSettings } from '../../domain/chat-options.ts';
import { object } from '../../domain/value.ts';
import type { ConversationTurn } from '../../storage/records.ts';
import AppIcon from '../../shared/AppIcon.vue';
import ChatImage from './ChatImage.vue';

const props = defineProps<{ turn: ConversationTurn }>();
const emit = defineEmits<{ close: [] }>();
const { chat, view } = useChat();
const dialog = shallowRef<HTMLDialogElement>();
const versions = computed(() => {
  const models = view.value.models;
  return props.turn.versions.flatMap((version, index) => {
    const images = version.blocks.flatMap(block => block.type === 'image' ? chat.assets.assets.get(block.assetId) ?? [] : []);
    if (version.status !== 'done' || !images.length) return [];
    const settings = chatVersionSettings(props.turn, version);
    const fields = models.find(model => model.id === settings.model)?.fields;
    const params = Object.entries(object(settings.options)).flatMap(([key, value]) => {
      if (typeof value !== 'string' || !value) return [];
      const label = fields?.[key]?.label || chatOptionNames[key] || key;
      const formatted = fields?.[key]?.type === 'boolean' ? value === 'true' ? '开启' : '关闭' : chatOptionLabel(value, key);
      return [`${label}：${formatted}`];
    });
    return [{ index, version, images, params, name: chatVersionModelName(props.turn, version, models) }];
  });
});
const current = versions.value.find(item => item.index === props.turn.selectedVersion), latest = versions.value.at(-1);
const compared = latest?.version.compareTo === current?.index || current?.version.compareTo === undefined ? latest : current;
const baseline = versions.value.find(item => item.index === compared?.version.compareTo);
const right = baseline ? compared : current ?? latest;
const left = baseline ?? versions.value.filter(item => item !== right).at(-1);
const sides = ['A', 'B'] as const;
const selection = reactive({ A: left?.index ?? -1, B: right?.index ?? -1 });
const photo = reactive({ A: 0, B: 0 });
const mobileSide = shallowRef<(typeof sides)[number]>('A');
const pair = computed(() => sides.map(side => {
  const item = versions.value.find(item => item.index === selection[side]);
  return { side, item, image: item?.images[photo[side]] ?? item?.images[0] };
}));
onMounted(() => dialog.value?.showModal());
</script>

<template>
  <dialog ref="dialog" class="chat-version-compare" aria-label="对比版本" @close="emit('close')">
    <header class="chat-compare-head">
      <div class="chat-compare-heading"><h2>对比版本</h2><p>模型直出，不含回贴。</p></div>
      <button class="ibtn" type="button" aria-label="关闭对比" @click="dialog?.close()"><AppIcon name="i-close" /></button>
    </header>
    <div class="chat-compare-switch" role="group" aria-label="切换对照图">
      <button v-for="entry in pair" :key="entry.side" class="btn btn-sm" type="button" :aria-pressed="mobileSide === entry.side" @click="mobileSide = entry.side">{{ entry.side }} · V{{ (entry.item?.index ?? 0) + 1 }}</button>
    </div>
    <div class="chat-compare-pair">
      <figure v-for="entry in pair" :key="entry.side" class="chat-compare-side" :data-visible="entry.side === mobileSide" :aria-label="`${entry.side} 图`">
        <figcaption>
          <div class="chat-compare-version">
            <label>
              <span class="mono chat-compare-key">{{ entry.side }}</span>
              <select v-model.number="selection[entry.side]" :aria-label="`${entry.side} 版本`" @change="photo[entry.side] = 0">
                <option v-for="item in versions" :key="item.version.id" :value="item.index" :disabled="item.index === selection[entry.side === 'A' ? 'B' : 'A']">V{{ item.index + 1 }} · {{ item.name }}</option>
              </select>
            </label>
            <select v-if="entry.item && entry.item.images.length > 1" v-model.number="photo[entry.side]" class="chat-compare-photo" :aria-label="`${entry.side} 图片`">
              <option v-for="(image, index) in entry.item.images" :key="`${image.id}:${index}`" :value="index">第 {{ index + 1 }} 张</option>
            </select>
          </div>
          <p class="chat-compare-params"><span v-if="entry.image" class="mono">{{ entry.image.width }}×{{ entry.image.height }} · </span>{{ entry.item?.params.join(' · ') || '未记录参数' }}</p>
        </figcaption>
        <div v-if="entry.image" class="chat-compare-print" :style="{ '--compare-native-width': `${entry.image.width}px`, '--compare-ratio': String(entry.image.width / entry.image.height) }">
          <ChatImage class="chat-compare-image" :asset-id="entry.image.id" :max-edge="1280" :alt="`${entry.side} 结果图`" />
        </div>
      </figure>
    </div>
  </dialog>
</template>

<style scoped>
.chat-version-compare { --compare-line: color-mix(in srgb, var(--fg) 12%, transparent); --compare-max-height: 58dvh; width: min(1120px, 100% - 32px); max-height: calc(100dvh - 32px); padding: var(--sp-2); color: var(--fg); background: transparent; border: 0; overflow: auto; overscroll-behavior: contain; }
.chat-version-compare::backdrop { background: color-mix(in srgb, var(--canvas) 94%, transparent); backdrop-filter: blur(4px); }
.chat-compare-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-3); padding-bottom: var(--sp-2); border-bottom: 1px solid var(--compare-line); }
.chat-compare-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--sp-2); }
.chat-compare-head h2 { margin: 0; font-size: var(--fz-lg); font-weight: var(--fw-semibold); }
.chat-compare-head p { color: var(--fg-3); font-size: var(--fz-xs); }
.chat-compare-switch { display: none; }
.chat-compare-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--sp-5); }
.chat-compare-side { display: grid; grid-row: span 2; grid-template-rows: subgrid; row-gap: var(--sp-3); min-width: 0; margin: 0; }
.chat-compare-side figcaption { display: grid; align-content: start; gap: var(--sp-1); }
.chat-compare-params { margin: 0; color: var(--fg-3); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.chat-compare-version, .chat-compare-version label { display: flex; align-items: center; gap: var(--sp-2); }
.chat-compare-version { justify-content: space-between; }
.chat-compare-key { color: var(--a); }
.chat-compare-side select { width: auto; max-width: 100%; padding: 4px 26px 4px 6px; color: var(--fg-2); background-color: transparent; border: 0; border-radius: var(--r1); text-overflow: ellipsis; }
.chat-compare-side select:not(:focus) { box-shadow: none; }
.chat-compare-side select:hover { background-color: var(--ghost-hover); }
.chat-compare-photo { flex: none; }
.chat-compare-print { position: relative; align-self: start; justify-self: start; width: min(100%, var(--compare-native-width), calc(var(--compare-max-height) * var(--compare-ratio))); aspect-ratio: var(--compare-ratio); border-radius: var(--r2); }
.chat-compare-print::after { position: absolute; inset: 0; border: 1px solid var(--compare-line); border-radius: inherit; pointer-events: none; content: ''; }
.chat-compare-image { position: absolute; inset: 0; display: block; width: 100%; height: 100%; border-radius: inherit; object-fit: contain; }
@media (width <= 640px) {
  .chat-version-compare { --compare-max-height: 70dvh; width: calc(100% - 16px); }
  .chat-compare-switch { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-2); }
  .chat-compare-switch button { min-height: 40px; color: var(--fg-3); }
  .chat-compare-switch button[aria-pressed='true'] { color: var(--a); background: var(--a-dim); }
  .chat-compare-pair { grid-template-columns: minmax(0, 1fr); }
  .chat-compare-side[data-visible='false'] { display: none; }
}
</style>
