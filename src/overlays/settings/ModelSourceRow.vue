<script setup lang="ts">
import { nextTick, ref, useTemplateRef } from "vue";
import type { Connection, ModelLink } from "../../config/connections";
import type { CatalogEntry } from "../../domain/catalog";
import type { ModelIdentity } from "../../domain/models";
import { message } from "../../app/ui";
import AppIcon from "../../shared/AppIcon.vue";
const props = defineProps<{
  model: ModelIdentity; connection: Connection; link: ModelLink; state: string;
  entries: CatalogEntry[]; current: boolean; saving: boolean;
  save: (value: ModelLink | null | boolean) => Promise<void>;
}>();
const emit = defineEmits<{ parameters: [] }>();
const editing = ref(false), value = ref(""), error = ref(""), busy = ref(false);
const input = useTemplateRef<HTMLInputElement>("input");
const trigger = useTemplateRef<HTMLButtonElement>("trigger");
async function begin() {
  value.value = props.link?.id ?? "";
  error.value = "";
  editing.value = true;
  await nextTick();
  input.value?.focus(); input.value?.select();
}
async function finish(focus = false) {
  editing.value = false; error.value = "";
  if (focus) { await nextTick(); trigger.value?.focus(); }
}
async function persist(link: ModelLink | null, focus = false) {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try { await props.save(link); await finish(focus); }
  catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
async function submit(focus = false) {
  if (!editing.value || busy.value) return;
  const id = value.value.trim();
  if (!id) { error.value = "请输入上游 ID"; return; }
  if (id === props.link?.id) { await finish(focus); return; }
  await persist({ ...props.link, id, manual: true, on: props.link?.on ?? true }, focus);
}
function blur(event: FocusEvent) {
  // Moving to reset keeps the editor open; every other focus move saves the ID.
  if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return;
  void submit();
}
async function toggle(event: Event) {
  const checkbox = event.target as HTMLInputElement, on = checkbox.checked;
  checkbox.checked = props.link?.on ?? false;
  error.value = "";
  try { await props.save(on); }
  catch (e) { error.value = message(e); }
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void submit(true); }
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy.value) void finish(true); }
}
</script>
<template>
  <div class="sm-line" :data-s="state">
    <span class="sm-conn" :title="connection.name">{{ connection.name }}<span v-if="current" class="sm-current" title="当前工作区使用此来源" role="img" aria-label="当前使用" /></span>
    <div class="sm-where">
      <div v-if="editing" class="sm-inline" @focusout="blur">
        <input :id="`model-source-${model.id}-${connection.id}`" ref="input" v-model="value" class="sm-id-input" type="text" :aria-label="`${model.name} · ${connection.name} 上游 ID`" :aria-invalid="!!error" :aria-describedby="error ? `model-error-${model.id}-${connection.id}` : undefined" :disabled="busy" :list="`model-suggestions-${model.id}-${connection.id}`" maxlength="512" autocomplete="off" spellcheck="false" @keydown="keydown" />
        <button v-if="link?.manual" class="md-act" type="button" :disabled="busy" :aria-label="`恢复 ${connection.name} 自动匹配`" title="恢复自动匹配" @click="persist(null, true)"><AppIcon name="i-reset" /></button>
        <datalist :id="`model-suggestions-${model.id}-${connection.id}`"><option v-for="entry in entries" :key="entry.id" :value="entry.id" /></datalist>
      </div>
      <button v-else-if="model.family !== 'novelai'" ref="trigger" class="sm-id" type="button" :disabled="saving" :aria-label="`为 ${model.name} 指定 ${connection.name} 上的 ID`" title="点击编辑上游 ID" @click="begin"><code>{{ link.id }}</code></button>
      <template v-else>
        <code>{{ link.id }}</code>
        <button v-if="link?.manual" class="md-act sm-reset" type="button" :disabled="saving" :aria-label="`恢复 ${connection.name} 自动匹配`" title="恢复自动匹配" @click="persist(null)"><AppIcon name="i-reset" /></button>
      </template>
      <button v-if="model.family !== 'novelai'" class="md-act sm-parameters" type="button" :disabled="saving" :aria-label="`${model.name} · ${connection.name} 参数`" title="配置此来源的参数" @click="emit('parameters')"><AppIcon name="i-parameters" /></button>
      <p v-if="error" :id="`model-error-${model.id}-${connection.id}`" class="sm-error" role="alert">{{ error }}</p>
    </div>
    <label class="sm-toggle" :title="link ? state === 'gone' ? '目录暂不可用' : link.on ? '停用来源' : '启用来源' : '请先填写上游 ID'">
      <input type="checkbox" role="switch" :aria-label="`${model.name} · ${connection.name} 来源`" :checked="link?.on ?? false" :disabled="!link || state === 'gone'" @change="toggle" /><span class="switch" aria-hidden="true" />
    </label>
  </div>
</template>
