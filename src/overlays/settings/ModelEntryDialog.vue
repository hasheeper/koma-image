<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from "vue";
import { useServices } from "../../app/services";
import { message } from "../../app/ui";
import { validateRouting } from "../../config/connections";
import type { Routing } from "../../config/connections";
import { configuredModels, editablePresets, initialModelEntries } from "../../domain/models";
import type { ModelIdentity } from "../../domain/models";
import AppIcon from "../../shared/AppIcon.vue";
import ModelIcon from "../../shared/ModelIcon.vue";

const props = defineProps<{ routing: Routing }>();
const emit = defineEmits<{ remove: [model: ModelIdentity] }>();
const { connections } = useServices();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const target = ref<string | null>(null), family = ref("gpt"), name = ref(""), template = ref("gpt-image-2");
const defaults = ref<Record<string, string>>({});
const busy = ref(false), error = ref("");
const existing = computed(() => configuredModels(props.routing).find(m => m.id === target.value));
function open(value: ModelIdentity | "gpt" | "gemini") {
  if (busy.value) return;
  const model = typeof value === "string" ? null : value;
  if (model?.family === "novelai") return;
  target.value = model?.id ?? null;
  family.value = model?.family ?? String(value);
  template.value = model?.templateId ?? model?.id ?? editablePresets.find(m => m.family === family.value)!.id;
  name.value = model?.name ?? "";
  defaults.value = { ...model?.defaults };
  error.value = "";
  dialog.value?.showModal();
}
function close() { if (!busy.value) dialog.value?.close(); }
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const next: Routing = structuredClone(connections.configuration), id = target.value ?? `model-${crypto.randomUUID()}`;
    next.models ??= initialModelEntries();
    if (target.value && !next.models.some(m => m.id === target.value)) throw new Error("模型条目已被删除");
    const entry = { id, name: name.value, templateId: template.value,
      defaults: Object.fromEntries(Object.entries(defaults.value).filter(([, value]) => value.trim())) };
    const index = next.models.findIndex(m => m.id === id);
    if (index < 0) next.models.push(entry);
    else next.models[index] = entry;
    await connections.save(validateRouting(next));
    dialog.value?.close();
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
onBeforeUnmount(() => dialog.value?.close());
defineExpose({ open, close });
</script>
<template>
  <dialog ref="dialog" class="modal set-ui model-entry-dialog" aria-labelledby="modelEntryTitle" @cancel.prevent="close">
    <form class="modal-form" @submit.prevent="save">
      <header class="modal-head">
        <h2 id="modelEntryTitle" class="model-entry-title"><ModelIcon :family="family" />{{ target ? '编辑模型' : `新增 ${family === 'gpt' ? 'GPT' : 'Gemini'} 模型` }}</h2>
        <button class="ibtn" type="button" aria-label="关闭模型编辑" :disabled="busy" @click="close"><AppIcon name="i-close" /></button>
      </header>
      <div class="modal-body">
        <div class="fld"><label for="modelEntryName">名称</label><input id="modelEntryName" v-model="name" type="text" required maxlength="128" :disabled="busy" autofocus /></div>
        <div class="fld"><label for="modelEntryTemplate">参数参考</label>
          <select id="modelEntryTemplate" v-model="template" :disabled="busy">
            <option v-for="preset in editablePresets.filter(m => m.family === family)" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
          </select>
        </div>
        <p v-if="error" role="alert" class="modal-error">{{ error }}</p>
      </div>
      <footer class="modal-foot">
        <div class="modal-actions">
          <button v-if="existing" class="ibtn model-delete" type="button" :disabled="busy" :aria-label="`删除 ${existing.name}`" title="删除模型" @click="emit('remove', existing)"><AppIcon name="i-trash" /></button>
          <button class="btn btn-quiet" type="button" :disabled="busy" @click="close">取消</button>
          <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存模型' }}</button>
        </div>
      </footer>
    </form>
  </dialog>
</template>
<style scoped>
.model-entry-dialog { --modal-w: 480px; }
.model-entry-title { display: flex; align-items: center; gap: var(--sp-2); }
.model-entry-dialog .modal-body { display: grid; gap: var(--sp-4); }
.model-entry-dialog :is(input[type="text"], select) { height: 32px; padding-block: 5px; font: var(--fz-sm)/1.4 var(--sans); }
.model-entry-dialog .modal-actions { width: 100%; }
.model-entry-dialog .model-delete { margin-right: auto; }
.model-entry-dialog .model-delete:is(:hover, :focus-visible) { color: var(--err); }
</style>
