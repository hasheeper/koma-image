<script setup lang="ts">
import AnnotationCard from "../../shared/annotations/AnnotationCard.vue";
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
import { useAnnotations } from "../../app/annotations.ts";
import { canMaskAnnotations } from "../../domain/region-annotation.ts";
import { useChat } from "../../app/chat";
import { useDrawing } from "../../app/drawing";
import { chatImageId, chatImageOrigin } from "../../domain/image-origin.ts";
import { useUi, message } from "../../app/ui";
import { useEditor } from "../../app/editor";
import { selectSource } from "../../domain/conversation.ts";
import { chatOptions } from "../../services/chat";
import { copyText } from "../../shared/files";
import AppIcon from "../../shared/AppIcon.vue";
import ModelIcon from "../../shared/ModelIcon.vue";
import ChatPrint from "./ChatPrint.vue";
import ChatVersions from "./ChatVersions.vue";
import ChatResultTools from "./ChatResultTools.vue";
import WaveHost from "../image/WaveHost.vue";
const annotations=useAnnotations(), showRaw=shallowRef<ReadonlySet<string>>(new Set());
function displayed(id:string){ return showRaw.value.has(id) ? id : version.value.composites?.[id] ?? id; }
function toggleRaw(id:string){const next=new Set(showRaw.value);if(next.has(id))next.delete(id);else next.add(id);showRaw.value=next;}
function review(id:string){try{annotations.chatReview(view.value.current.id,props.turn.id,version.value.id,id);}catch(e){ui.toast(message(e),"err");}}
const props = defineProps<{
    turn: ConversationTurn;
    number: number;
    older: boolean;
  }>(),
  emit = defineEmits<{ view: [id: string] }>();
const { chat, view } = useChat(),
  ui = useUi(),
  { editor } = useEditor();
const { drawing, view: drawings } = useDrawing();
const saving = shallowRef<ReadonlySet<string>>(new Set());
const favoriteId = (id: string) => chatImageId(view.value.current.id, props.turn.id, version.value.id, id);
const favorite = (id: string) => drawings.value.favorites.some(f => f.id === favoriteId(id));
const favoriteBusy = (id: string) => drawings.value.favoritesLoading || saving.value.has(favoriteId(id)) || drawings.value.favoritePending.includes(favoriteId(id));
async function toggleFavorite(assetId: string) {
  const id = favoriteId(assetId);
  if (favoriteBusy(assetId)) return;
  saving.value = new Set([...saving.value, id]);
  try {
    const existing = drawings.value.favorites.find(f => f.id === id);
    await drawing.toggleFavorite(existing ?? await chat.favoriteRecord(view.value.current.id, props.turn.id, version.value.id, assetId));
  } catch (error) { ui.toast(message(error), "err"); }
  finally { saving.value = new Set([...saving.value].filter(v => v !== id)); }
}
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
    images.value.some((block) => isBase(displayed(block.assetId))),
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
/** One EDIT entry: upscale, inpaint and annotation live on the board, not on the print. */
function openEdit(id: string) {
  const a = asset(id);
  if (a)
    void editor.open("chat", a.blob, a.name, {
      conversationId: view.value.current.id,
      sourceId: favoriteId(a.id),
      settings: { ...chatImageOrigin(view.value.current, props.turn, version.value, a.id), tool: "chat", prompt: props.turn.prompt, model: String(props.turn.settings.model ?? "") },
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
      <AnnotationCard v-if="turn.snapshot.annotation" :regions="turn.snapshot.annotation.snapshot.regions" :preview="url(turn.snapshot.annotation.guideAssetId)" sent />
      <div v-if="turn.prompt" class="msg-bubble turn-prompt" tabindex="0">{{ turn.snapshot.annotation?.text ? turn.prompt.replace(turn.snapshot.annotation.text, '').trim() : turn.prompt }}</div>
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
          <div
            v-else-if="asset(displayed(b.assetId))"
            class="chat-result"
            :style="{
              '--image-width': `${asset(displayed(b.assetId))!.width}px`,
              '--image-ratio': asset(displayed(b.assetId))!.width / asset(displayed(b.assetId))!.height,
            }"
          >
            <div class="chat-art">
              <ChatPrint
                :key="`${version.id}:${b.assetId}`"
                :url="url(displayed(b.assetId))!"
                :alt="turn.prompt.slice(0, 160)"
                :width="asset(displayed(b.assetId))!.width"
                :height="asset(displayed(b.assetId))!.height"
                :asset-id="displayed(b.assetId)"
                :base="isBase(displayed(b.assetId))"
                :fresh="chat.isFresh(version.id)"
                @view="emit('view', displayed(b.assetId))"
              >
                <span
                  v-if="isBase(displayed(b.assetId))"
                  class="chat-base-badge"
                  role="img"
                  aria-label="当前底图"
                  title="当前底图"
                >
                  <AppIcon name="i-pin" />
                </span>
                <button
                  v-else
                  class="chat-base-pin"
                  type="button"
                  aria-label="设为底图"
                  data-tip="设为底图"
                  @click="chat.mutate((c) => selectSource(c, turn, displayed(b.assetId)))"
                ><AppIcon name="i-pin" /></button>
              </ChatPrint>
            </div>
            <ChatVersions
              v-if="b.assetId === images[0]?.assetId"
              :turn="turn"
            />
            <footer class="chat-meta chat-result-meta">
              <span class="msg-model-name">
                <ModelIcon :family="model?.provider" />
                <span class="msg-name" :title="model?.name || String(turn.settings.model)">{{ model?.name || turn.settings.model }}</span>
              </span>
              <span class="chat-dimensions mono">{{ asset(displayed(b.assetId))!.width }}×{{ asset(displayed(b.assetId))!.height }}</span>
              <span v-if="b.assetId === images[0]?.assetId && Number(version.quote?.cost) > 0" class="chat-cost mono">{{ version.quote?.cost }} 积分</span>
            </footer>
            <ChatResultTools
              :url="url(displayed(b.assetId))!"
              :filename="filename(displayed(b.assetId))"
              :favorite="favorite(displayed(b.assetId))"
              :favorite-busy="favoriteBusy(displayed(b.assetId))"
              @favorite="toggleFavorite(displayed(b.assetId))"
              @edit="openEdit(displayed(b.assetId))"
              @retry="chat.execute(turn)"
            />
            <div v-if="turn.snapshot.annotation && canMaskAnnotations(turn.snapshot.annotation.snapshot.regions)" class="chat-annotation-review">
              <button class="btn btn-sm btn-quiet" @click="review(b.assetId)"><AppIcon name="i-mask" />{{ version.composites?.[b.assetId] ? '重新审核' : '审核并应用蒙版' }}</button>
              <button v-if="version.composites?.[b.assetId]" class="btn btn-sm btn-quiet" :aria-pressed="showRaw.has(b.assetId)" @click="toggleRaw(b.assetId)">{{ showRaw.has(b.assetId) ? '查看回贴图' : '查看模型直出' }}</button>
            </div>
          </div>
        </template>
        <ChatVersions
          v-if="version.status === 'done' && !images.length"
          :turn="turn"
        />
      </div>
      <footer v-if="version.status !== 'done' || !images.length" class="chat-meta">
        <span class="msg-model-name">
          <ModelIcon :family="model?.provider" />
          <span
            class="msg-name"
            :title="model?.name || String(turn.settings.model)"
            >{{ model?.name || turn.settings.model }}</span
          >
        </span>
        <template v-if="version.status === 'done'">
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

<style scoped>
.chat-annotation-review { grid-column: 1 / -1; display: flex; gap: var(--sp-2); flex-wrap: wrap; padding-top: var(--sp-2); }
</style>
