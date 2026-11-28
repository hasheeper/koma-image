<script setup lang="ts">
import { useId } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
import type { ReferenceKind } from '../../domain/nai-references.ts';
import { useProjectActions } from './use-project-actions.ts';
defineProps<{path:string; image?:boolean; shortcuts?:boolean}>();
defineSlots<{extra?(props:{close:()=>void}):unknown}>();
const id=useId(), actions=useProjectActions();
const canReference = (kind: ReferenceKind) => actions.view.value.referenceKinds.includes(kind);
</script>
<template>
  <button v-if="image && shortcuts" class="ibtn" type="button" aria-label="在 EDIT 打开" title="在 EDIT 打开" :disabled="actions.busy.value" @click="actions.edit(path)"><AppIcon name="i-edit"/></button>
  <button v-if="image && shortcuts" class="ibtn" type="button" aria-label="下载原图" title="下载原图" :disabled="actions.busy.value" @click="actions.download(path)"><AppIcon name="i-download"/></button>
  <PopoverMenu :id="id" label="资料操作" side="right">
    <template #trigger="{open,toggle}"><button class="ibtn" type="button" aria-label="资料操作" :aria-expanded="open" aria-haspopup="menu" :disabled="actions.busy.value" @click="toggle"><AppIcon name="i-more"/></button></template>
    <template #default="{close}">
      <button class="menu-item" role="menuitem" @click="close(); actions.attach(path)"><AppIcon name="i-upload"/><span class="menu-label">作为 ASK 附件</span></button>
      <template v-if="image">
        <button class="menu-item" role="menuitem" @click="close(); actions.chat(path)"><AppIcon name="i-chat"/><span class="menu-label">在 CHAT 准备</span></button>
        <button v-if="!shortcuts" class="menu-item" role="menuitem" @click="close(); actions.edit(path)"><AppIcon name="i-edit"/><span class="menu-label">在 EDIT 打开</span></button>
        <button class="menu-item" role="menuitem" :disabled="!canReference('vibe')" :title="canReference('vibe') ? '' : '当前 IMAGE 模型不支持参考图'" @click="close(); actions.reference(path,'vibe')"><AppIcon name="i-image"/><span class="menu-label">用作 Vibe 参考</span></button>
        <button class="menu-item" role="menuitem" :disabled="!canReference('precise')" :title="canReference('precise') ? '' : '当前 IMAGE 模型不支持参考图'" @click="close(); actions.reference(path,'precise')"><AppIcon name="i-image"/><span class="menu-label">用作 Precise 参考</span></button>
      </template>
      <button v-if="!image || !shortcuts" class="menu-item" role="menuitem" @click="close(); actions.download(path)"><AppIcon name="i-download"/><span class="menu-label">下载原文件</span></button>
      <slot name="extra" :close="close"/>
    </template>
  </PopoverMenu>
</template>
