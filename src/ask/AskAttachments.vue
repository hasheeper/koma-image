<script setup lang="ts">
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import AskReference from "./AskReference.vue";
import type { AttachmentView } from "./attachments.ts";
const props = defineProps<{ items: readonly AttachmentView[]; sent?: boolean; dim?: boolean }>(), ask = useAsk();
</script>
<template>
  <div v-if="items.length" :class="sent ? 'ask-sent-att' : 'ask-tray'" :aria-label="sent ? '本轮附件' : '本条附件'">
    <div v-for="a in items" :key="a.id" class="ask-att" :class="{ 'ask-att-img': a.kind === 'image', 'ask-att-file': a.kind === 'text', 'ask-sent-img': sent && a.kind === 'image', 'ask-sent-file': sent && a.kind === 'text', 'ask-att-dim': dim && a.kind === 'image' }" :title="`${a.name} · ${a.meta}`">
      <AskReference v-if="a.kind === 'image'" :label="a.id"><img :src="a.url" alt="" /><span class="ask-att-id">{{ a.id }}</span></AskReference>
      <button v-else class="ask-att-open" type="button" :aria-label="`查看 ${a.name}`" @click="ask.openAttachment(a.id)">
        <AppIcon v-if="sent" :name="a.pasted ? 'i-text' : 'i-file'" />
        <span v-else class="ask-att-glyph"><AppIcon :name="a.pasted ? 'i-text' : 'i-file'" /></span>
        <span class="ask-att-words"><span class="ask-att-name">{{ a.name }}</span><span v-if="!sent" class="ask-att-meta">{{ a.meta }}</span></span>
      </button>
      <button v-if="!props.sent" class="ask-att-x" type="button" :aria-label="`移除 ${a.name}`" title="移除" @click="ask.removeAttachment(a.id)"><AppIcon name="i-close" /></button>
    </div>
  </div>
</template>
<style scoped>
/* B v5 attachment tray, copied from the approved prototype's geometry. */
.ask-tray { display: flex; gap: 8px; margin: -5px -2px 0 -4px; padding: 9px 9px 10px 0; overflow-x: auto; overscroll-behavior: contain; scrollbar-width: none; }
.ask-att { position: relative; flex: none; height: 52px; background: var(--ask-field); border: 1px solid var(--line-2); border-radius: 12px; }
.ask-att-img { width: 52px; }
.ask-att-img img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.ask-att-img.ask-att-dim { border-style: dashed; }
.ask-att-dim img { opacity: .4; filter: grayscale(1); }
.ask-att-id { position: absolute; left: 4px; bottom: 4px; padding: 0 4px; color: #fff; font: var(--fw-medium) 11px/16px var(--mono); background: rgba(0, 0, 0, .58); border-radius: 4px; }
.ask-att-open { display: flex; align-items: center; gap: 10px; height: 100%; max-width: 196px; padding: 0 14px 0 9px; text-align: left; border-radius: inherit; }
.ask-att-open:hover { background: var(--ask-hover); }
.ask-att-glyph { display: grid; flex: none; place-items: center; width: 32px; height: 32px; color: var(--fg-2); background: var(--ask-hover); border-radius: 8px; }
.ask-att-glyph .ico { --ico: var(--ico-md); }
.ask-att-words { display: grid; min-width: 0; line-height: 1.35; }
.ask-att-name { overflow: hidden; color: var(--fg); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.ask-att-meta { color: var(--fg-3); font-size: 12px; white-space: nowrap; }
.ask-att-x { position: absolute; top: -7px; right: -7px; display: grid; place-items: center; width: 20px; height: 20px; color: var(--raised); background: var(--fg); border-radius: 50%; box-shadow: 0 1px 4px rgba(0, 0, 0, .3); opacity: 0; transition: opacity var(--t1) var(--e); }
.ask-att-x .ico { --ico: var(--ico-xs); }
.ask-att:is(:hover, :focus-within) .ask-att-x { opacity: 1; }
.ask-sent-att { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: flex-end; gap: 6px; margin-bottom: 6px; }
.ask-sent-img { width: 64px; height: 64px; }
.ask-sent-file { max-width: 100%; height: 32px; color: var(--fg-2); background: var(--ask-hover); border: 0; border-radius: 10px; }
.ask-sent-file .ask-att-open { display: inline-flex; gap: 6px; max-width: 100%; padding: 0 12px 0 10px; }
.ask-sent-file .ico { flex: none; --ico: var(--ico-sm); color: var(--fg-3); }
.ask-sent-file .ask-att-name { color: var(--fg-2); }
@media (max-width: 860px), (hover: none) { .ask-att-x { width: 24px; height: 24px; opacity: 1; } }
</style>
