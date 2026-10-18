<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
} from "vue";
import { useDrawing } from "../../app/drawing";
import { useShell } from "../../app/shell";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import { useUi, message } from "../../app/ui";
import { resolveModel } from "../../domain/catalog";
import { reuseFields, samplerName } from "../../domain/drawing";
import { names } from "../../storage/names";
import { readImageParams } from "../../native/image-meta.js";
import type { ImageMetadata } from "../../native/image-meta.js";
import { render as renderHighlight } from "../../domain/highlight";
import AppIcon from "../../shared/AppIcon.vue";
const { drawing, view } = useDrawing(),
  { image } = useShell(),
  ui = useUi();
const file = shallowRef<HTMLInputElement | null>(null),
  card = shallowRef<HTMLElement | null>(null),
  candidate = shallowRef<ImageMetadata | null>(null),
  url = ref(""),
  selected = ref<string[]>([]);
let focus: HTMLElement | null = null,
  depth = 0,
  sequence = 0;
const labels: Record<string, string> = {
  model: "模型",
  size: "尺寸",
  steps: "步数",
  sampler: "采样器",
  scale: "Scale",
  cfg: "CFG",
  seed: "Seed",
};
const rows = computed(() => {
  const fields = candidate.value?.fields ?? {},
    form = view.value.form;
  return Object.entries(labels).flatMap(([key, label]) => {
    const keys = (key === "size" ? ["width", "height"] : [key]).filter(
      (k) => fields[k] !== undefined,
    );
    if (!keys.length) return [];
    let shown = String(fields[key] ?? ""),
      now = String(form[key as keyof typeof form] ?? ""),
      blocked = "";
    if (key === "model") {
      const model = resolveModel(view.value.models, shown);
      if (!model) blocked = "本站没有此模型";
      else shown = model.name;
      now = view.value.model?.name || form.model;
    }
    if (key === "sampler" && !view.value.samplers.includes(shown))
      blocked = "本站不支持";
    if (key === "sampler" && !blocked) {
      shown = samplerName(shown);
      now = samplerName(now);
    }
    if (key === "size") {
      shown = `${fields.width ?? "—"}×${fields.height ?? "—"}`;
      now = `${form.width}×${form.height}`;
    }
    if (key === "seed") {
      shown ||= "随机";
      now ||= "随机";
    }
    const same =
      key === "size"
        ? keys.every(
            (k) => Number(fields[k]) === Number(form[k as keyof typeof form]),
          )
        : shown === now;
    return [{ key, label, keys, shown, now, blocked, same }];
  });
});
const texts = computed(() =>
  ["prompt", "negative_prompt"]
    .filter((key) => candidate.value?.fields[key] !== undefined)
    .map((key) => ({
      key,
      label: key === "prompt" ? "Prompt" : "Negative",
      value: String(candidate.value!.fields[key] ?? ""),
      same:
        String(candidate.value!.fields[key] ?? "").trim() ===
        (key === "prompt"
          ? view.value.form.prompt
          : view.value.form.negative
        ).trim(),
    })),
);
function close() {
  sequence++;
  image.importing = false;
  candidate.value = null;
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = "";
  focus?.focus();
  focus = null;
}
async function open(result: ImageMetadata, blob: Blob) {
  if (url.value) URL.revokeObjectURL(url.value);
  focus = document.activeElement as HTMLElement;
  candidate.value = result;
  url.value = URL.createObjectURL(blob);
  selected.value = [
    ...texts.value.filter((r) => !r.same).map((r) => r.key),
    ...rows.value.filter((r) => !r.same && !r.blocked).map((r) => r.key),
  ];
  image.importing = true;
  await nextTick();
  card.value?.querySelector<HTMLButtonElement>("button")?.focus();
}
async function read(blob: File) {
  const token = ++sequence;
  try {
    const result = await readImageParams(blob);
    if (token !== sequence) return;
    if (!Object.keys(result.fields).length) {
      ui.toast("图片中未找到可导入的生成参数");
      return;
    }
    await open(result, blob);
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
function apply() {
  if (!candidate.value) return;
  const fields: Record<string, unknown> = {};
  for (const key of selected.value)
    for (const k of key === "size" ? ["width", "height"] : [key])
      if (candidate.value.fields[k] !== undefined)
        fields[k] = candidate.value.fields[k];
  const n = drawing.apply(fields).length;
  close();
  ui.toast(`已导入 ${n} 项参数`, "ok");
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ui.toast("已复制", "ok");
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
const lifecycle = useWorkspaceLifecycle("image", []);
lifecycle.whileActive((signal) => {
  const allowed = (e: DragEvent) =>
    !document.querySelector("dialog[open], :popover-open") &&
    !ui.pickerOpen.value &&
    !!e.dataTransfer &&
    ([...e.dataTransfer.types].includes("Files") ||
      e.dataTransfer.types.includes(names.historyDragType));
  window.addEventListener(
    "dragenter",
    (e) => {
      if (allowed(e)) {
        e.preventDefault();
        depth++;
        image.drop = true;
      }
    },
    { signal },
  );
  window.addEventListener(
    "dragover",
    (e) => {
      if (allowed(e)) e.preventDefault();
    },
    { signal },
  );
  window.addEventListener(
    "dragleave",
    (e) => {
      if (allowed(e)) {
        depth = Math.max(0, depth - 1);
        if (!depth) image.drop = false;
      }
    },
    { signal },
  );
  window.addEventListener(
    "drop",
    (e) => {
      if (!allowed(e)) return;
      e.preventDefault();
      depth = 0;
      image.drop = false;
      const id = e.dataTransfer!.getData(names.historyDragType);
      if (id) {
        const item = [...view.value.history, ...view.value.favorites].find(
          (r) => r.id === id,
        );
        if (item && item.params.tool !== "upscale")
          void open(
            {
              name: "历史记录",
              dialect: "本次会话",
              source: `本次会话 · ${item.params.modelName || ""}`,
              fields: reuseFields(item) as ImageMetadata["fields"],
              extras: [],
            },
            item.blob,
          );
      } else {
        const blob = [...e.dataTransfer!.files].find((f) =>
          /^image\/(png|jpeg)$/.test(f.type),
        );
        if (blob) void read(blob);
        else ui.toast("仅支持 PNG 或 JPEG 图片");
      }
    },
    { signal },
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (!image.importing || e.key !== "Tab") return;
      const nodes = [
        ...(card.value?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),summary",
        ) ?? []),
      ];
      const first = nodes[0],
        last = nodes.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    },
    { signal },
  );
});
onDeactivated(() => {
  close();
  image.drop = false;
  depth = 0;
});
onBeforeUnmount(close);
defineExpose({ pick: () => file.value?.click(), close });
</script>
<template>
  <input
    ref="file"
    id="importFile"
    type="file"
    accept="image/png,image/jpeg"
    hidden
    @change="
      async (e) => {
        const input = e.target as HTMLInputElement;
        if (input.files?.[0]) await read(input.files[0]);
        input.value = '';
      }
    "
  />
  <Teleport to="body"
    ><div
      class="sheet"
      id="importSheet"
      :hidden="!image.importing"
      @click.self="close"
    >
      <div
        ref="card"
        class="import-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="importTitle"
      >
        <header class="import-head">
          <AppIcon name="i-import" />
          <h1 id="importTitle">导入参数</h1>
          <span class="import-source">{{
            [
              candidate?.source || candidate?.dialect,
              candidate?.fields.width && candidate?.fields.height
                ? `${candidate.fields.width}×${candidate.fields.height}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }}</span
          ><button
            class="ibtn import-x"
            type="button"
            aria-label="关闭"
            @click="close"
          >
            <AppIcon name="i-close" />
          </button>
        </header>
        <div class="import-body">
          <figure class="import-figure">
            <img v-if="url" :src="url" alt="导入的图片" draggable="false" />
            <figcaption class="mono">{{ candidate?.name }}</figcaption>
          </figure>
          <div class="import-main">
            <div class="import-texts">
              <section
                v-for="row in texts"
                :key="row.key"
                class="import-text"
                :data-key="row.key"
              >
                <div class="import-text-head">
                  <label class="import-toggle"
                    ><input
                      v-model="selected"
                      type="checkbox"
                      :value="row.key"
                    /><span class="import-check"></span><b>{{ row.label }}</b
                    ><span class="mono">{{ row.value.length }}</span></label
                  ><span v-if="row.same" class="import-note">与当前相同</span
                  ><button
                    v-if="row.value"
                    class="ibtn ibtn-xs import-copy"
                    type="button"
                    :aria-label="`复制 ${row.label}`"
                    @click="copy(row.value)"
                  >
                    <AppIcon name="i-copy" />
                  </button>
                </div>
                <div
                  v-if="row.value"
                  class="import-prose"
                  v-html="renderHighlight(row.value)"
                ></div>
                <div v-else class="import-prose" data-empty="true">
                  （空）导入会清空当前内容
                </div>
              </section>
            </div>
            <section v-if="rows.length" class="import-section">
              <h2 class="import-label">参数</h2>
              <div class="import-params">
                <label
                  v-for="row in rows"
                  :key="row.key"
                  class="import-chip"
                  :data-state="
                    row.blocked ? 'off' : row.same ? 'same' : 'change'
                  "
                  ><input
                    v-model="selected"
                    type="checkbox"
                    :value="row.key"
                    :disabled="!!row.blocked"
                  /><span class="import-chip-k">{{ row.label }}</span
                  ><span class="import-chip-v" :title="row.shown">{{
                    row.shown
                  }}</span
                  ><span class="import-chip-note">{{
                    row.blocked || (row.same ? "与当前相同" : `当前 ${row.now}`)
                  }}</span></label
                >
              </div>
            </section>
            <details
              v-if="candidate?.extras.length"
              class="import-extra"
              :open="candidate.extras.some((r) => r.label.startsWith('角色'))"
            >
              <summary>
                <span>其他 {{ candidate.extras.length }} 项</span
                ><i>仅查看，不会导入</i
                ><span class="caret" aria-hidden="true"></span>
              </summary>
              <dl>
                <template v-for="(item, index) in candidate.extras" :key="index"
                  ><dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd></template
                >
              </dl>
            </details>
          </div>
        </div>
        <footer class="import-foot">
          <span class="import-tally" aria-live="polite">{{
            selected.length
              ? "勾选的项会覆盖当前设置，其余不变"
              : "没有勾选任何参数"
          }}</span
          ><button class="btn btn-quiet" type="button" @click="close">
            取消</button
          ><button
            class="btn btn-primary"
            id="importApply"
            type="button"
            :disabled="!selected.length"
            @click="apply"
          >
            {{ selected.length ? `导入 ${selected.length} 项` : "导入" }}
          </button>
        </footer>
      </div>
    </div>
    <div class="dropzone" aria-hidden="true">
      <div class="dropzone-card">
        <AppIcon class="ico-xl" name="i-import" /><strong>松手读取参数</strong
        ><span>PNG 或 JPEG · 支持历史缩略图</span>
      </div>
    </div></Teleport
  >
</template>
