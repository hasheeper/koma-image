<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useServices } from "../../app/services";
import { message } from "../../app/ui";
import { POST_JSON_MAX_BYTES } from "../../domain/danbooru-post.ts";
import { postUrl } from "../../domain/tag-samples.ts";
import AppIcon from "../../shared/AppIcon.vue";

const props = defineProps<{ expectedId: number | null; file?: File }>();
const emit = defineEmits<{ close: []; imported: [id: number] }>();
const { tags } = useServices();
const dialog = shallowRef<HTMLDialogElement | null>(null),
  picker = shallowRef<HTMLInputElement | null>(null);
const text = ref(""), filename = ref(""), error = ref(""), reading = ref(false);
let read = 0;
async function load(file?: File) {
  if (!file) return;
  const current = ++read;
  reading.value = true;
  error.value = "";
  try {
    if (file.size > POST_JSON_MAX_BYTES) throw new Error("帖子 JSON 不能超过 4 MB");
    const content = await file.text();
    if (current !== read) return;
    text.value = content;
    filename.value = file.name;
  } catch (e) {
    if (current === read) error.value = message(e);
  } finally {
    if (current === read) reading.value = false;
  }
}
function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  void load(input.files?.[0]);
  input.value = "";
}
function drop(event: DragEvent) {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  void load(event.dataTransfer.files[0]);
}
function apply() {
  if (reading.value || !text.value.trim()) return;
  error.value = "";
  try { emit("imported", tags.importPost(text.value, props.expectedId).id); }
  catch (e) { error.value = message(e); }
}
onMounted(() => {
  dialog.value?.showModal();
  void load(props.file);
});
onBeforeUnmount(() => { read++; dialog.value?.close(); });
</script>

<template>
  <dialog ref="dialog" class="modal post-import" aria-labelledby="postImportTitle" @cancel.prevent="emit('close')" @dragover.prevent @drop="drop">
    <header class="modal-head">
      <h2 id="postImportTitle">导入帖子 JSON</h2>
      <button class="ibtn" type="button" aria-label="关闭帖子导入" @click="emit('close')"><AppIcon name="i-close" /></button>
    </header>
    <div class="modal-body">
      <p v-if="expectedId" class="post-import-help">
        <a :href="`${postUrl(expectedId)}.json`" target="_blank" rel="noopener noreferrer">打开 #{{ expectedId }} 的 JSON</a>，在原站按需完成验证，再复制内容或保存为文件。
      </p>
      <p v-else class="post-import-help">在 Danbooru 原帖地址末尾加上 .json，打开后复制内容或保存为文件。</p>
      <div class="post-import-file">
        <input ref="picker" type="file" accept=".json,application/json" aria-label="选择帖子 JSON 文件" hidden @change="choose" />
        <button class="btn btn-quiet" type="button" :disabled="reading" @click="picker?.click()">{{ reading ? "读取中…" : "选择 JSON 文件" }}</button>
        <span>{{ filename || "也可以把文件拖到这里" }}</span>
      </div>
      <label for="postImportJson">或粘贴 JSON 内容</label>
      <textarea id="postImportJson" v-model="text" :disabled="reading" spellcheck="false" autocomplete="off" placeholder='{"id": …, "tag_string_artist": …}' />
      <p v-if="error" class="post-import-error" role="alert">{{ error }}</p>
      <p class="post-import-help">帖子资料只保留在当前页面。图片与中文释义仍需联网；导入不会发送 ASK 消息或修改画板。</p>
    </div>
    <footer class="modal-foot">
      <div class="modal-actions">
        <button class="btn btn-quiet" type="button" @click="emit('close')">取消</button>
        <button class="btn btn-primary" type="button" :disabled="reading || !text.trim()" @click="apply">导入并查看</button>
      </div>
    </footer>
  </dialog>
</template>

<style scoped>
.post-import { --modal-w: 560px; }
.post-import .modal-body { display: grid; gap: var(--sp-3); }
.post-import-help { margin: 0; color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.65; }
.post-import-help a { color: var(--a); text-decoration: underline; text-underline-offset: 3px; }
.post-import-file { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.post-import-file span { color: var(--fg-3); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.post-import textarea { min-height: 160px; max-height: 40dvh; resize: vertical; font-family: var(--mono); font-size: var(--fz-xs); }
.post-import-error { margin: 0; color: var(--err); font-size: var(--fz-xs); }
</style>
