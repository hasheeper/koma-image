<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useShell } from "../../app/shell";
import { useServices } from "../../app/services";
import { useUi, message } from "../../app/ui";
import AppIcon from "../../shared/AppIcon.vue";
import type { Routing } from "../../config/connections.ts";
import { reasoningConnections } from "../../config/connections.ts";
import { catalogEntries } from "../../domain/catalog.ts";
import { names } from "../../storage/names.ts";
import { builtinWords, checkWord, wordLimits } from "../../ask/codec.ts";
import {
  PREFERENCE_LIMIT,
  modelId,
  readAskSettings,
} from "../../ask/settings.ts";
import type { AskSettings } from "../../ask/settings.ts";

const props = defineProps<{ routing: Routing }>();
const { router } = useShell(),
  { preferences, connections, gateway } = useServices(),
  ui = useUi();
const local = connections.local;
const read = () => readAskSettings(preferences.get(names.ask, null)),
  readAdult = () => preferences.get<unknown>(names.askAdult, false) === true;
const settings = shallowRef<AskSettings>(read()),
  adult = ref(readAdult()),
  preference = ref(settings.value.preference);
const sources = computed(() => reasoningConnections(props.routing)),
  selected = computed(() =>
    sources.value.find((c) => c.id === settings.value.connectionId),
  );
const ids = shallowRef<string[]>([]),
  fetching = ref(false),
  word = ref(""),
  wordError = ref("");
// Other tabs and restores change the same keys; the adult flag stays per device.
const unsubscribe = preferences.subscribe((key) => {
  if (!key || key === names.ask) {
    settings.value = read();
    preference.value = settings.value.preference;
  }
  if (!key || key === names.askAdult) adult.value = readAdult();
});
onBeforeUnmount(unsubscribe);
watch(
  () => selected.value?.id,
  () => (ids.value = []),
);
async function save(patch: Partial<AskSettings>) {
  try {
    await preferences.set(names.ask, { ...settings.value, ...patch });
  } catch (error) {
    ui.toast(message(error), "err");
  }
}
function changeModel(event: Event) {
  const input = event.target as HTMLInputElement,
    id = modelId(input.value);
  if (input.value.trim() && !id) {
    ui.toast("模型 ID 无效", "err");
    input.value = settings.value.model;
    return;
  }
  if (id !== settings.value.model) void save({ model: id });
}
async function fetchModels() {
  const c = selected.value;
  if (!c || fetching.value) return;
  fetching.value = true;
  try {
    const raw = await gateway(c.id).rawCatalog(true);
    ids.value = catalogEntries(raw)
      .map((e) => e.id)
      .sort();
    ui.toast(`已获取 ${ids.value.length} 个模型 ID`, "ok");
  } catch (error) {
    ui.toast(message(error), "err");
  } finally {
    fetching.value = false;
  }
}
function checked(event: Event) {
  return (event.target as HTMLInputElement).checked;
}
async function setAdult(event: Event) {
  try {
    await preferences.set(names.askAdult, checked(event));
  } catch (error) {
    adult.value = readAdult();
    ui.toast(message(error), "err");
  }
}
async function addWord() {
  const result = checkWord(word.value, settings.value.words);
  if ("error" in result) {
    wordError.value = result.error;
    return;
  }
  wordError.value = "";
  word.value = "";
  await save({ words: [...settings.value.words, result.word] });
}
</script>
<template>
  <div class="ask-sections">
    <section v-if="local" class="sp-sec" aria-label="ASK">
      <div class="sp-sec-head"><h3>ASK</h3></div>
      <div class="sp-group">
        <div class="sp-empty">本地模式暂不支持 ASK</div>
      </div>
    </section>
    <template v-else>
      <section class="sp-sec" aria-label="ASK 模型">
        <div class="sp-sec-head"><h3>模型</h3></div>
        <div class="sp-group">
          <div v-if="!sources.length" class="sp-empty">
            <span>尚未添加 OpenAI Chat 或 Anthropic Messages 连接</span
            ><button
              class="btn btn-quiet btn-sm"
              type="button"
              @click="router.selectSection('connections')"
            >
              去添加
            </button>
          </div>
          <div v-else class="s-row">
            <div>
              <b><label for="askConnection">连接</label></b>
            </div>
            <select
              id="askConnection"
              class="ask-field"
              :value="selected?.id ?? ''"
              @change="
                save({
                  connectionId: ($event.target as HTMLSelectElement).value,
                })
              "
            >
              <option v-if="!selected" value="" disabled>选择连接</option>
              <option v-for="c in sources" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select>
          </div>
          <div class="s-row">
            <div>
              <b><label for="askModel">模型 ID</label></b>
              <p>
                需要流式输出、工具调用与图片输入；原生多模态、工具调用稳定的模型效果更好。
              </p>
            </div>
            <div class="ask-model">
              <input
                id="askModel"
                class="ask-field"
                type="text"
                list="askModelIds"
                maxlength="200"
                placeholder="手动填写或获取"
                autocomplete="off"
                spellcheck="false"
                :value="settings.model"
                @change="changeModel"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              />
              <datalist id="askModelIds">
                <option v-for="id in ids" :key="id" :value="id" />
              </datalist>
              <button
                class="btn btn-quiet btn-xs"
                type="button"
                :disabled="!selected || fetching"
                @click="fetchModels"
              >
                {{ fetching ? "获取中…" : "获取" }}
              </button>
            </div>
          </div>
          <div class="s-row">
            <div>
              <b><label for="askImages">发送图片给模型</label></b>
              <p>关闭后只发送参数与元数据</p>
            </div>
            <label class="check settings-toggle" title="发送图片给模型">
              <input
                id="askImages"
                type="checkbox"
                :checked="settings.images"
                @change="save({ images: checked($event) })"
              />
              <span aria-hidden="true"></span>
            </label>
          </div>
        </div>
      </section>
      <section class="sp-sec" aria-label="个人偏好">
        <div class="sp-sec-head"><h3>个人偏好</h3></div>
        <div class="sp-group">
          <div class="s-row ask-preference">
            <textarea
              id="askPreference"
              v-model="preference"
              rows="3"
              :maxlength="PREFERENCE_LIMIT"
              aria-label="个人偏好"
              placeholder="例如：回答简短，先说结论"
              @change="save({ preference })"
            ></textarea>
            <small>{{ preference.length }}/{{ PREFERENCE_LIMIT }}</small>
          </div>
        </div>
      </section>
      <section class="sp-sec" aria-label="成年内容">
        <div class="sp-sec-head"><h3>成年内容</h3></div>
        <div class="sp-group">
          <div class="s-row">
            <div>
              <b
                ><label for="askAdult"
                  >我已成年，自行承担渠道风控与封号风险</label
                ></b
              >
              <p>仅保存在本机，不进备份</p>
            </div>
            <label class="check settings-toggle" title="成年内容">
              <input
                id="askAdult"
                type="checkbox"
                :checked="adult"
                @change="setAdult"
              />
              <span aria-hidden="true"></span>
            </label>
          </div>
        </div>
      </section>
      <section v-if="adult" class="sp-sec" aria-label="词表">
        <div class="sp-sec-head"><h3>词表</h3></div>
        <div class="sp-group">
          <div class="s-row">
            <div>
              <b><label for="askAlwaysCodec">始终启用词表混淆</label></b>
              <p>关闭时仅在被拦截后按需启用</p>
            </div>
            <label class="check settings-toggle" title="始终启用词表混淆">
              <input
                id="askAlwaysCodec"
                type="checkbox"
                :checked="settings.alwaysCodec"
                @change="save({ alwaysCodec: checked($event) })"
              />
              <span aria-hidden="true"></span>
            </label>
          </div>
          <div class="s-row ask-words">
            <div>
              <b>内置</b>
              <ul class="ask-chips" aria-label="内置词条">
                <li v-for="w in builtinWords" :key="w">{{ w }}</li>
              </ul>
            </div>
          </div>
          <div class="s-row ask-words">
            <div>
              <b
                >自定义<small
                  >{{ settings.words.length }}/{{ wordLimits.count }}</small
                ></b
              >
              <ul
                v-if="settings.words.length"
                class="ask-chips"
                aria-label="自定义词条"
              >
                <li v-for="w in settings.words" :key="w">
                  {{ w
                  }}<button
                    type="button"
                    :aria-label="`删除 ${w}`"
                    @click="
                      save({ words: settings.words.filter((x) => x !== w) })
                    "
                  >
                    <AppIcon name="i-close" />
                  </button>
                </li>
              </ul>
              <form class="ask-add" @submit.prevent="addWord">
                <input
                  v-model="word"
                  class="ask-field"
                  type="text"
                  :maxlength="wordLimits.chars"
                  placeholder="添加词条"
                  aria-label="添加词条"
                  autocomplete="off"
                  spellcheck="false"
                  @input="wordError = ''"
                />
                <button class="btn btn-quiet btn-xs" type="submit">添加</button>
              </form>
              <p v-if="wordError" class="ask-error" role="alert">
                {{ wordError }}
              </p>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
<style scoped>
/* ASK settings: four groups, rows share the settings row frame. */
.ask-sections { display: grid; gap: var(--sp-6); }
.ask-field { flex: none; width: 240px; height: 32px; }
.ask-model { display: flex; align-items: center; gap: var(--sp-2); flex: none; }
.ask-preference { display: grid; gap: 6px; }
.ask-preference textarea { min-height: 76px; font-size: var(--fz-sm); }
.ask-preference small { justify-self: end; font: var(--fz-2xs)/1 var(--mono); color: var(--fg-4); }
.ask-words { align-items: start; }
.ask-words b small { margin-left: var(--sp-2); font: var(--fz-2xs)/1 var(--mono); color: var(--fg-4); }
.ask-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
.ask-chips li {
  display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 9px;
  font: var(--fz-xs)/1 var(--mono); color: var(--fg-2);
  background: var(--raised); border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line-2);
}
.ask-chips li:has(button) { padding-right: 3px; }
.ask-chips button { display: grid; place-items: center; width: 18px; height: 18px; --ico: 11px; color: var(--fg-4); border-radius: 50%; }
.ask-chips button:hover { color: var(--fg); background: var(--hover); }
.ask-add { display: flex; gap: var(--sp-2); margin-top: var(--sp-3); }
.ask-add .ask-field { flex: 0 1 240px; min-width: 0; }
.ask-error { margin-top: 6px; font-size: var(--fz-xs); color: var(--err); }

@media (max-width: 640px) {
  .ask-model { width: 100%; }
  .ask-model .ask-field, select.ask-field { flex: 1; width: auto; min-width: 0; }
}
</style>
