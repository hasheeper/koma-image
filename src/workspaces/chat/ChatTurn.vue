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
import ModelIcon from "../../shared/ModelIcon.vue";
import ChatPrint from "./ChatPrint.vue";
import ChatVersions from "./ChatVersions.vue";
import ChatResultTools from "./ChatResultTools.vue";
import WaveHost from "../image/WaveHost.vue";
const props = defineProps<{
    turn: ConversationTurn;
    number: number;
    older: boolean;
  }>(),
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
const images = computed(() => {
    view.value;
    return version.value.blocks.filter((block) => block.type === "image");
  }),
  // A single image reads as a print with its caption. Interleaved multi-image
  // replies keep their exact block order; the stored response is never changed.
  blocks = computed(() =>
    images.value.length === 1 ? images.value : version.value.blocks,
  ),
  captions = computed(() =>
    images.value.length === 1
      ? version.value.blocks.filter((block) => block.type === "text")
      : [],
  ),
  currentBase = computed(() =>
    images.value.some((block) => isBase(block.assetId)),
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
  () => {
    view.value;
    return `${version.value.id}:${version.value.status}`;
  },
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
  <article
    class="chat-turn"
    :data-turn="turn.id"
    :data-older="older && version.status === 'done' ? '' : undefined"
    :data-pending="version.status === 'pending' ? '' : undefined"
    :data-base="currentBase ? '' : undefined"
    :aria-label="`第 ${number} 轮`"
  >
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
          <img :src="url(id)" :alt="asset(id)?.name" width="40" height="40" />
        </button>
      </div>
      <div class="msg-bubble turn-prompt" tabindex="0">{{ turn.prompt }}</div>
      <div class="msg-tools">
        <button class="ibtn" type="button" aria-label="复制描述" @click="copy">
          <AppIcon name="i-copy" />
        </button>
        <button
          class="ibtn"
          type="button"
          aria-label="填入输入框"
          @click="reuse"
        >
          <AppIcon name="i-reuse" />
        </button>
      </div>
    </div>
    <div class="turn-rail" aria-hidden="true">
      <span class="turn-number mono">{{ number }}</span>
    </div>
    <div
      class="msg msg-model turn-output"
      :data-status="version.status"
      :aria-busy="version.status === 'pending'"
    >
      <div class="msg-body" :data-images="images.length">
        <div v-if="version.status === 'pending'" class="turn-visual-row">
          <div class="chat-wait" :style="{ '--image-ratio': ratio }">
            <WaveHost class="print skeleton chat-pending" aria-hidden="true" />
            <span class="msg-phase"
              ><span role="status" :data-phase="version.id">{{
                view.busy?.versionId === version.id ? view.busy.phase : "生成中"
              }}</span
              ><span
                ref="phase"
                class="msg-elapsed mono"
                aria-hidden="true"
              ></span
            ></span>
          </div>
          <ChatVersions :turn="turn" />
        </div>
        <div v-else-if="version.status !== 'done'" class="turn-visual-row">
          <div class="turn-error">
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
          <ChatVersions :turn="turn" />
        </div>
        <template v-else v-for="(b, i) in blocks" :key="i">
          <p v-if="b.type === 'text'" class="msg-text">{{ b.text }}</p>
          <div v-else-if="asset(b.assetId)" class="chat-result">
            <div class="turn-visual-row">
              <div
                class="chat-art"
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
                >
                  <span
                    v-if="isBase(b.assetId)"
                    class="chat-base-badge"
                    role="img"
                    aria-label="当前底图"
                    title="当前底图"
                  >
                    <AppIcon name="i-image-base" />
                  </span>
                  <ChatResultTools
                    :url="url(b.assetId)!"
                    :filename="filename(b.assetId)"
                    :base="isBase(b.assetId)"
                    @upscale="upscale(b.assetId)"
                    @continue="
                      chat.mutate((c) => selectSource(c, turn, b.assetId))
                    "
                    @retain="more(b.assetId)"
                    @retry="chat.execute(turn)"
                  />
                </ChatPrint>
              </div>
              <ChatVersions
                v-if="b.assetId === images[0]?.assetId"
                :turn="turn"
              />
            </div>
            <span v-if="images.length > 1" class="chat-dimensions mono"
              >{{ asset(b.assetId)!.width }}×{{
                asset(b.assetId)!.height
              }}</span
            >
          </div>
        </template>
        <ChatVersions
          v-if="version.status === 'done' && !images.length"
          :turn="turn"
        />
      </div>
      <footer class="chat-meta">
        <span class="msg-model-name">
          <ModelIcon :family="model?.provider" />
          <span
            class="msg-name"
            :title="model?.name || String(turn.settings.model)"
            >{{ model?.name || turn.settings.model }}</span
          >
        </span>
        <template v-if="version.status === 'done'">
          <span
            v-if="images.length === 1 && asset(images[0].assetId)"
            class="chat-dimensions mono"
            >{{ asset(images[0].assetId)!.width }}×{{
              asset(images[0].assetId)!.height
            }}</span
          >
          <span v-if="Number(version.quote?.cost) > 0" class="chat-cost mono"
            >{{ version.quote?.cost }} 积分</span
          >
        </template>
      </footer>
      <template v-if="version.status === 'done'"
        ><p v-for="(caption, i) in captions" :key="i" class="msg-text">
          {{ caption.text }}
        </p></template
      >
    </div>
  </article>
</template>
