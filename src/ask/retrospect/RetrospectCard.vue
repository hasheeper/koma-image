<script setup lang="ts">
import { versionCount, stagedCount } from './model.ts';
import { computed } from 'vue';
import { useAsk } from '../../app/ask.ts';
import AppIcon from '../../shared/AppIcon.vue';
import type { Retrospect } from './model.ts';
import type { PictureRefs } from '../edit-context.ts';
const props = defineProps<{ value: Retrospect; pictureRefs?: PictureRefs; ready: boolean; turnId: number }>();
const ask = useAsk();
const record = computed(() => ask.retrospects.source(ask.conversationId.value, props.turnId));
const ended = computed(() => record.value?.status === 'ended');
const status = computed(() => ended.value ? record.value?.final ? '已定稿' : '已解除' : '进行中');
const count = computed(() => props.value.nodes.reduce((n, node) => n + node.image_ids.length, 0));
function picture(id: string) { void ask.libraryRevision.value; return ask.pictureInfo(id, props.pictureRefs)?.url; }
function open(version?: string) {
  if (!props.ready) return;
  const r = record.value ?? ask.retrospects.register(props.value, props.pictureRefs ?? {}, { conversationId: ask.conversationId.value, turnId: props.turnId, boardId: null, boardName: '历史画板' }, 'ended');
  ask.retrospects.open(r.id, version);
}
</script>
<template>
  <section class="recap picture-strip" :aria-label="`演进 ${value.title}，${status}`">
    <button class="strip-head" type="button" :disabled="!ready" :aria-label="`打开演进 ${value.title}，${versionCount(value)} 版，${count} 张，${status}`" @click="open()">
      <AppIcon name="i-branch" />
      <span class="strip-identity"><b class="title" :title="value.title">{{ value.title }}</b><small>{{ versionCount(value) }} 版<span v-if="stagedCount(value)"> · {{ stagedCount(value) }} 待生成</span> · {{ count }} 张</small></span>
      <small v-if="ended">{{ status }}</small><i v-else class="state-dot" title="进行中" aria-hidden="true"></i>
      <AppIcon name="i-chevron" class="arrow" />
    </button>
    <div class="versions">
      <button v-for="node in value.nodes.slice(0, 6)" :key="node.id" class="version" type="button" :disabled="!ready" :aria-label="`查看 ${node.id} ${node.label}`" @click="open(node.id)"><AppIcon v-if="!node.image_ids.length" name="i-plus" /><img v-else :src="picture(node.cover)" alt="" /><span>{{ node.id }}</span></button>
      <button v-if="value.nodes.length > 6" class="more-versions" type="button" :disabled="!ready" aria-label="查看其余版本" @click="open()">+{{ value.nodes.length - 6 }}</button>
    </div>
  </section>

</template>
<style scoped>
.recap { width: 100%; min-width: 0; margin-block: var(--sp-3); color: var(--fg-2); text-align: left; font-size: var(--fz-sm); }
.recap :is(button, img), button.recap { transition: background var(--t1) var(--e), outline-color var(--t1) var(--e); }
.recap:disabled, .recap button:disabled { opacity: .55; }
.recap .title { min-width: 0; color: var(--fg); font-weight: var(--fw-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recap small { flex: none; color: var(--fg-3); font-size: var(--fz-xs); white-space: nowrap; }
.recap .ico { flex: none; --ico: var(--ico-sm); }
.recap .arrow { --ico: var(--ico-xs); color: var(--fg-3); }
.state-dot { display: inline-block; flex: none; width: 5px; height: 5px; background: var(--a); border-radius: 50%; }
.state-dot.ended { background: var(--fg-4); }
.strip-head { display: flex; align-items: center; gap: var(--sp-2); width: 100%; min-height: 28px; text-align: left; border-radius: var(--r2); }
.strip-head:hover { background: var(--ask-hover, var(--hover)); }
.strip-head > .ico:first-child { color: var(--a); }
.strip-identity { display: flex; align-items: baseline; gap: var(--sp-2); flex: 1; min-width: 0; }
.strip-identity .title { flex: 0 1 auto; }
.versions { display: flex; align-items: flex-start; gap: var(--sp-2); overflow: auto; padding-block: var(--sp-1); }
.version { display: grid; justify-items: center; gap: var(--sp-1); flex: none; padding: 2px; border-radius: var(--r2); color: var(--a); font: var(--fz-2xs)/1.4 var(--mono); }
.version img { width: 36px; height: 50px; object-fit: contain; background: var(--sunken); border-radius: var(--r1); outline: 1px solid transparent; }
.version:hover img, .version:focus-visible img { outline-color: var(--a); }
.more-versions { display: grid; place-items: center; flex: none; min-width: 36px; height: 50px; margin-top: 2px; color: var(--fg-3); font: var(--fz-xs)/1 var(--mono); background: var(--ask-layer, var(--raised)); border-radius: var(--r1); }
</style>
