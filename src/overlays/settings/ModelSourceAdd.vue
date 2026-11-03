<script setup lang="ts">
import { computed, onMounted, ref, useId, useTemplateRef } from "vue";
import type { Connection } from "../../config/connections";
import type { CatalogEntry } from "../../domain/catalog";
import type { ModelIdentity } from "../../domain/models";
import { message } from "../../app/ui";
import AppIcon from "../../shared/AppIcon.vue";
const props = defineProps<{
  model: ModelIdentity;
  sources: { connection: Connection; entries: CatalogEntry[] }[];
  save: (connection: string, id: string) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const connection = ref(props.sources[0]?.connection.id ?? ""), value = ref(""), error = ref(""), busy = ref(false);
const field = useTemplateRef<HTMLInputElement | HTMLSelectElement>("field");
const suggestions = `source-add-${useId()}`;
const source = computed(() => props.sources.find(s => s.connection.id === connection.value));
const fixed = computed(() => props.model.family === "novelai");
function selectSource() { value.value = fixed.value ? source.value?.entries[0]?.id ?? "" : ""; error.value = ""; }
selectSource();
onMounted(() => field.value?.focus());
function close() { if (!busy.value) emit("close"); }
async function save() {
  if (busy.value) return;
  const id = value.value.trim();
  if (!source.value) { error.value = "请选择可添加的供应商"; return; }
  if (!id) { error.value = "请输入上游 ID"; return; }
  if (fixed.value && !source.value.entries.some(entry => entry.id === id)) { error.value = "请从目录选择 ID"; return; }
  busy.value = true; error.value = "";
  try { await props.save(connection.value, id); emit("close"); }
  catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="sm-source-add">
    <form class="sm-new-source" :aria-label="`为 ${model.name} 添加来源`" @submit.prevent="save" @keydown.esc.prevent.stop="close">
      <select v-model="connection" class="sm-new-connection" :aria-label="`${model.name} 的供应商`" :disabled="busy" @change="selectSource"><option v-for="item in sources" :key="item.connection.id" :value="item.connection.id">{{ item.connection.name }}</option></select>
      <div class="sm-new-id">
        <select v-if="fixed" ref="field" v-model="value" :aria-label="`${model.name} 的上游 ID`" :disabled="busy"><option v-for="entry in source?.entries ?? []" :key="entry.id" :value="entry.id">{{ entry.id }}</option></select>
        <input v-else ref="field" v-model="value" type="text" :aria-label="`${model.name} 的上游 ID`" :list="suggestions" :disabled="busy" maxlength="512" autocomplete="off" spellcheck="false" />
        <datalist :id="suggestions"><option v-for="entry in source?.entries ?? []" :key="entry.id" :value="entry.id" /></datalist>
        <button class="md-act" type="button" :disabled="busy" aria-label="取消添加来源" title="取消" @click="close"><AppIcon name="i-close" /></button>
      </div>
      <button class="md-act sm-new-save" type="submit" :disabled="busy" aria-label="保存来源" title="保存来源"><AppIcon name="i-check" /></button>
      <p v-if="error" class="sm-error" role="alert">{{ error }}</p>
    </form>
  </div>
</template>
