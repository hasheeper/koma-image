<script setup lang="ts">
import { onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { useServices } from "../../app/services";
import { message } from "../../app/ui";
import { download } from "../../shared/files";
import type { CheckedBackup } from "../../services/backup.ts";
const props = defineProps<{ active: boolean }>(),
  emit = defineEmits<{ busy: [value: boolean] }>();
const { backup } = useServices();
const fileInput = useTemplateRef<HTMLInputElement>("file"),
  busy = ref(false),
  status = ref(""),
  tone = ref(""),
  stored = ref("正在读取…");
const selectedName = ref(""),
  selectedCounts = ref("");
let selected: CheckedBackup | null = null;
const count = (f: number, c: number) => `${f} 张收藏 · ${c} 个对话`;
async function counts() {
  try {
    const result = await backup.counts();
    stored.value = count(result.favorites, result.conversations);
  } catch {
    stored.value = "本机数据暂时无法读取";
  }
}
watch(
  () => props.active,
  (value) => {
    if (value) void counts();
  },
  { immediate: true },
);
const unload = (event: BeforeUnloadEvent) => {
  if (busy.value) {
    event.preventDefault();
    event.returnValue = "";
  }
};
window.addEventListener("beforeunload", unload);
onBeforeUnmount(() => {
  selected = null;
  window.removeEventListener("beforeunload", unload);
});
async function run(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  emit("busy", true);
  tone.value = "";
  try {
    await work();
  } catch (error) {
    status.value =
      error instanceof DOMException && error.name === "QuotaExceededError"
        ? "空间不足，部分数据可能已导入。释放浏览器存储空间后可用同一备份继续导入。"
        : message(error);
    tone.value = "error";
  } finally {
    busy.value = false;
    emit("busy", false);
  }
}
function exportFile() {
  return run(async () => {
    status.value = "正在准备备份…";
    const result = await backup.export((n, total) => {
      status.value = `正在整理文件 ${n} / ${total}…`;
    });
    download(
      result.blob,
      `koma-image-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    );
    status.value = `备份已导出：${count(result.counts.favorites, result.counts.conversations)}。`;
    tone.value = "success";
  });
}
function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void run(async () => {
    selected = null;
    selectedName.value = "";
    status.value = "正在检查备份…";
    selected = await backup.read(file, (n, total) => {
      status.value = `正在校验图片 ${n} / ${total}…`;
    });
    selectedName.value = file.name;
    selectedCounts.value = `${count(selected.favorites.length, selected.conversations.length)} · ${selected.assets.length} 张对话图片`;
    status.value =
      "备份已校验，导入后保留当前收藏和对话，使用备份中的偏好设置。";
  }).finally(() => {
    if (fileInput.value) fileInput.value.value = "";
  });
}
function importFile() {
  return run(async () => {
    if (!selected) return;
    status.value = "正在导入，请保持本页打开…";
    const result = await backup.import(selected);
    selected = null;
    selectedName.value = "";
    status.value = `导入完成，新增 ${count(result.favorites, result.conversations)}。`;
    tone.value = "success";
    await counts();
  });
}
</script>
<template>
  <section class="sp-sec" aria-label="备份与恢复">
    <div class="sp-sec-head">
      <h3>备份与恢复</h3>
      <p>带走收藏原图、完整对话和使用偏好。</p>
    </div>
    <section class="transfer-section">
      <div class="transfer-section-head">
        <h2>导出备份</h2>
        <span class="transfer-count">{{ stored }}</span>
      </div>
      <div class="transfer-row">
        <div>
          <h3>保存本机数据</h3>
          <p>
            ZIP
            内含图片原文件、对话、连接与偏好。普通绘图历史未收藏的图片不会包含在内。
          </p>
        </div>
        <button
          class="btn btn-quiet"
          type="button"
          :disabled="busy"
          @click="exportFile"
        >
          导出备份
        </button>
      </div>
    </section>
    <section class="transfer-section">
      <div class="transfer-section-head"><h2>导入备份</h2></div>
      <div class="transfer-row">
        <div>
          <h3>恢复到当前站点</h3>
          <p>
            收藏和对话合并保留，偏好采用备份中的设置。导入前，请关闭当前站点的其他应用标签页。
          </p>
        </div>
        <button
          class="btn btn-quiet"
          type="button"
          :disabled="busy"
          @click="fileInput?.click()"
        >
          选择备份…</button
        ><input
          ref="file"
          type="file"
          accept=".zip,application/zip"
          hidden
          @change="choose"
        />
      </div>
      <div v-if="selectedName" class="transfer-preview">
        <div>
          <strong>{{ selectedName }}</strong>
          <p>{{ selectedCounts }}</p>
        </div>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="busy"
          @click="importFile"
        >
          导入到此站点
        </button>
      </div>
    </section>
    <p class="transfer-key-note">
      备份不含 API Key、解锁密钥、普通历史或编辑会话。
    </p>
    <p
      class="transfer-status"
      :data-tone="tone"
      role="status"
      aria-live="polite"
    >
      {{ status }}
    </p>
  </section>
</template>
