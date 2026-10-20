<script setup lang="ts">
import {
  computed,
  shallowRef,
  watch,
  onActivated,
  onMounted,
  onDeactivated,
  onBeforeUnmount,
  nextTick,
} from "vue";
import type { ConversationTurn } from "../../storage/records";
import { useChat } from "../../app/chat";
import { useUi, message } from "../../app/ui";
import { useEditor } from "../../app/editor";
import { selectSource, retainImage } from "../../domain/conversation.ts";
import { chatOptions } from "../../services/chat";
import { copyText } from "../../shared/files";
import AppIcon from "../../shared/AppIcon.vue";
import ChatPrint from "./ChatPrint.vue";
import WaveHost from "../image/WaveHost.vue";
const props = defineProps<{ turn: ConversationTurn }>(),
  emit = defineEmits<{ view: [id: string] }>();
const { chat, view } = useChat(),
  ui = useUi(),
  { editor } = useEditor();
const version = computed(() => {
    view.value;
    return props.turn.versions[props.turn.selectedVersion]!;
  }),
  model = computed(() =>
    view.value.models.find((m) => m.id === props.turn.settings.model),
  );
const phase = shallowRef<HTMLElement | null>(null);
let tick: ReturnType<typeof setInterval> | undefined,
  active = false;
const url = (id: string) => chat.assets.assets.get(id)?.url;
const asset = (id: string) => chat.assets.assets.get(id);
const ratio = computed(() => {
  const options = chatOptions({
    ...view.value.current,
    settings: props.turn.settings,
  });
  const s = (
    options.size?.includes("x")
      ? options.size.replace("x", ":")
      : options.aspect_ratio
  )
    ?.split(":")
    .map(Number);
  if (s?.length === 2 && s.every((n) => n > 0)) return s[0] / s[1];
  const a = asset(props.turn.snapshot.imageIds[0]);
  return a ? a.width / a.height : 1;
});
function clock() {
  clearInterval(tick);
  if (!active || version.value.status !== "pending") return;
  const paint = () => {
    if (phase.value)
      phase.value.textContent =
        view.value.busy?.versionId === version.value.id
          ? `${Math.floor((Date.now() - view.value.busy.startedAt) / 1000)}s`
          : "";
  };
  paint();
  tick = setInterval(paint, 1000);
}
watch(
  () => version.value.status,
  () => void nextTick(clock),
);
onMounted(() => {
  active = true;
  clock();
});
onActivated(() => {
  active = true;
  clock();
});
onDeactivated(() => {
  active = false;
  clearInterval(tick);
});
onBeforeUnmount(() => clearInterval(tick));
async function copy() {
  try {
    await copyText(props.turn.prompt);
    ui.toast("描述已复制", "ok");
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
async function reuse() {
  if (
    view.value.current.prompt.trim() &&
    view.value.current.prompt.trim() !== props.turn.prompt.trim() &&
    !(await ui.confirm({
      title: "替换输入框内容？",
      message: "输入框里还有未发送的描述，会被这条替换。",
      confirmLabel: "替换",
    }))
  )
    return;
  chat.setPrompt(props.turn.prompt);
  document.getElementById("chatPrompt")?.focus();
}
function more(id: string) {
  if (view.value.model?.maxImages === 1) {
    ui.toast("该模型每轮仅支持 1 张图，请使用「继续编辑这张图」");
    return;
  }
  chat.mutate((c) => retainImage(c, id), true);
}
function upscale(id: string) {
  const a = asset(id);
  if (a)
    void editor.open("chat", a.blob, a.name, {
      mode: "upscale",
      conversationId: view.value.current.id,
    });
}
const isBase = (id: string) =>
  view.value.current.mainId === id &&
  view.value.current.headId === props.turn.id;
const filename = (id: string) =>
  `Koma-${view.value.current.turns.indexOf(props.turn) + 1}-v${props.turn.selectedVersion + 1}.${asset(id)?.blob.type.split("/")[1] || "png"}`;
</script>
<template>
  <article class="chat-turn" :data-turn="turn.id">
    <div class="msg msg-user">
      <div v-if="turn.snapshot.imageIds.length" class="turn-references">
        <button
          v-for="(id, i) in turn.snapshot.imageIds"
          :key="id"
          type="button"
          :data-slot="i === 0 ? 'base' : undefined"
          :aria-label="`查看${i === 0 ? '底图' : `参考 ${i}`}：${asset(id)?.name || '图片'}`"
          @click="emit('view', id)"
        >
          <img :src="url(id)" :alt="asset(id)?.name" width="64" height="64" />
        </button>
      </div>
      <div class="msg-bubble turn-prompt" tabindex="-1">{{ turn.prompt }}</div>
      <div class="msg-tools">
        <button class="ibtn" type="button" aria-label="复制描述" @click="copy">
          <AppIcon name="i-copy" /></button
        ><button
          class="ibtn"
          type="button"
          aria-label="填入输入框"
          @click="reuse"
        >
          <AppIcon name="i-reuse" />
        </button>
      </div>
    </div>
    <div
      class="msg msg-model turn-output"
      :data-status="version.status"
      :aria-busy="version.status === 'pending'"
    >
      <header class="msg-head">
        <span class="msg-avatar"
          ><AppIcon
            :class="{ solid: model?.provider !== 'gemini' }"
            :name="
              model?.provider === 'openai'
                ? 'i-openai'
                : model?.provider === 'gemini'
                  ? 'i-gemini'
                  : 'i-points'
            " /></span
        ><span
          class="msg-name"
          :title="model?.name || String(turn.settings.model)"
          >{{ model?.name || turn.settings.model }}</span
        ><span v-if="version.status === 'pending'" class="msg-phase"
          ><span role="status" :data-phase="version.id">{{
            view.busy?.versionId === version.id ? view.busy.phase : "生成中"
          }}</span
          ><span ref="phase" class="msg-elapsed mono" aria-hidden="true"></span
        ></span>
        <div
          v-if="turn.versions.length > 1"
          class="version-pager"
          role="group"
          aria-label="生成版本"
        >
          <button
            class="ibtn version-prev"
            type="button"
            aria-label="上一个版本"
            :disabled="turn.selectedVersion === 0"
            @click="chat.mutate(() => turn.selectedVersion--, true)"
          >
            <AppIcon name="i-chevron" /></button
          ><span class="version-count mono"
            >{{ turn.selectedVersion + 1 }}/{{ turn.versions.length }}</span
          ><button
            class="ibtn"
            type="button"
            aria-label="下一个版本"
            :disabled="turn.selectedVersion === turn.versions.length - 1"
            @click="chat.mutate(() => turn.selectedVersion++, true)"
          >
            <AppIcon name="i-chevron" />
          </button>
        </div>
      </header>
      <div
        class="msg-body"
        :data-images="
          version.blocks.filter((b) => b.type === 'image').length > 1
            ? version.blocks.filter((b) => b.type === 'image').length
            : undefined
        "
      >
        <WaveHost
          v-if="version.status === 'pending'"
          class="print skeleton chat-pending"
          aria-hidden="true"
          :style="{ '--image-ratio': ratio }"
        />
        <div v-else-if="version.status !== 'done'" class="turn-error">
          <p>
            <AppIcon
              :name="version.status === 'cancelled' ? 'i-stop' : 'i-alert'"
            /><span>{{
              version.error || "已取消；上游可能仍在处理，请勿立即重复提交。"
            }}</span>
          </p>
          <button
            class="btn btn-quiet btn-sm"
            type="button"
            @click="chat.execute(turn)"
          >
            <AppIcon name="i-retry" />重新生成
          </button>
        </div>
        <template v-else v-for="(b, i) in version.blocks" :key="i"
          ><p v-if="b.type === 'text'" class="msg-text">{{ b.text }}</p>
          <div
            v-else-if="asset(b.assetId)"
            class="chat-result"
            :style="{
              '--image-width': `${asset(b.assetId)!.width}px`,
              '--image-ratio':
                asset(b.assetId)!.width / asset(b.assetId)!.height,
            }"
          >
            <ChatPrint
              :key="`${version.id}:${b.assetId}`"
              :url="url(b.assetId)!"
              :alt="turn.prompt.slice(0, 160)"
              :width="asset(b.assetId)!.width"
              :height="asset(b.assetId)!.height"
              :asset-id="b.assetId"
              :base="isBase(b.assetId)"
              :fresh="chat.isFresh(version.id)"
              @view="emit('view', b.assetId)"
            />
            <footer class="chat-meta">
              <div class="result-actions">
                <a
                  class="ibtn"
                  :href="url(b.assetId)"
                  :download="filename(b.assetId)"
                  aria-label="下载图片"
                  ><AppIcon name="i-download" /></a
                ><button
                  class="ibtn"
                  type="button"
                  aria-label="放大图片"
                  @click="upscale(b.assetId)"
                >
                  <AppIcon name="i-upscale" /></button
                ><button
                  class="ibtn continue-edit"
                  :class="{ 'ibtn-accent': isBase(b.assetId) }"
                  type="button"
                  aria-label="继续编辑这张图"
                  @click="chat.mutate((c) => selectSource(c, turn, b.assetId))"
                >
                  <AppIcon name="i-edit" /></button
                ><button
                  class="ibtn"
                  type="button"
                  aria-label="添加为参考图"
                  @click="more(b.assetId)"
                >
                  <AppIcon name="i-image-plus" /></button
                ><button
                  class="ibtn"
                  type="button"
                  aria-label="重新生成此版本"
                  @click="chat.execute(turn)"
                >
                  <AppIcon name="i-retry" />
                </button>
              </div>
              <span class="chat-meta-info mono"
                ><span v-if="Number(version.quote?.cost) > 0" class="chat-cost"
                  >{{ version.quote?.cost }} 积分</span
                ><span class="chat-dimensions"
                  >{{ asset(b.assetId)!.width }}×{{
                    asset(b.assetId)!.height
                  }}</span
                ></span
              >
            </footer>
          </div></template
        >
      </div>
    </div>
  </article>
</template>
