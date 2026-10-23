<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { useShell } from "../../app/shell";
import { useServices } from "../../app/services";
import { useUi, message } from "../../app/ui";
import AppIcon from "../../shared/AppIcon.vue";
import type { Connection, Routing } from "../../config/connections.ts";
import { reasoningConnections } from "../../config/connections.ts";
import { profileFor } from "../../gateway/profile.ts";
import { names } from "../../storage/names.ts";
import { checkReplacement, checkWord, replacementLimits, wordLimits } from "../../ask/codec.ts";
import type { Replacement } from "../../ask/codec.ts";
import {
  PREFERENCE_LIMIT,
  DEFAULT_TEXT_ATTACHMENT_LIMITS,
  readAskSettings,
  withConnection,
} from "../../ask/settings.ts";
import type { AskSettings, TextAttachmentLimits } from "../../ask/settings.ts";

const props = defineProps<{ routing: Routing }>();
const emit = defineEmits<{ models: [connectionId: string, purpose?: "ask" | "naming"] }>();
const { router } = useShell(),
  { preferences, connections } = useServices(),
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
  ),
  picked = computed(() => settings.value.models[selected.value?.id ?? ""] ?? []);
// The page already says ASK, so the protocol tag drops the card label's "· ASK".
const protocol = (c: Connection) =>
  profileFor(c.profileId).protocol === "anthropic-messages"
    ? "Anthropic Messages"
    : "OpenAI Chat 兼容";
const word = ref(""),
  wordError = ref("");
const replacementFrom = ref(""), replacementTo = ref(""),
  replacementError = ref(""), editingFrom = ref<string | null>(null);
const replacementInput = ref<HTMLInputElement | null>(null);
// Other tabs and restores change the same keys; the adult flag stays per device.
const unsubscribe = preferences.subscribe((key) => {
  if (!key || key === names.ask) {
    settings.value = read();
    preference.value = settings.value.preference;
  }
  if (!key || key === names.askAdult) adult.value = readAdult();
});
onBeforeUnmount(unsubscribe);
async function save(patch: Partial<AskSettings>) {
  try {
    await preferences.set(names.ask, { ...settings.value, ...patch });
    return true;
  } catch (error) {
    ui.toast(message(error), "err");
    return false;
  }
}
function checked(event: Event) {
  return (event.target as HTMLInputElement).checked;
}
async function setTextLimit(key: keyof TextAttachmentLimits, event: Event) {
  const input = event.target as HTMLInputElement, value = input.valueAsNumber;
  const limits = { ...settings.value.textAttachments };
  const invalid = !Number.isSafeInteger(value) || value <= 0;
  if (invalid || key === "totalChars" && value < limits.chars) {
    input.value = String(limits[key]);
    ui.toast(invalid ? "字符上限须为正整数" : "每轮合计不能小于单个上限", "warn");
    return;
  }
  limits[key] = value;
  limits.totalChars = Math.max(limits.chars, limits.totalChars);
  await save({ textAttachments: limits });
  input.value = String(settings.value.textAttachments[key]);
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
  if (await save({ words: [...settings.value.words, result.word] })) word.value = "";
}
function clearReplacement() {
  replacementFrom.value = replacementTo.value = replacementError.value = "";
  editingFrom.value = null;
}
function editReplacement(rule: Replacement) {
  replacementFrom.value = rule.from;
  replacementTo.value = rule.to;
  replacementError.value = "";
  editingFrom.value = rule.from;
  replacementInput.value?.focus();
}
async function saveReplacement() {
  const rules = settings.value.replacements,
    result = checkReplacement(replacementFrom.value, replacementTo.value, rules.filter((r) => r.from !== editingFrom.value));
  if ("error" in result) { replacementError.value = result.error; return; }
  const index = rules.findIndex((r) => r.from === editingFrom.value);
  const next = [...rules];
  if (index < 0) next.push(result.replacement);
  else next[index] = result.replacement;
  if (await save({ replacements: next })) {
    clearReplacement();
    replacementInput.value?.focus();
  }
}
async function removeReplacement(rule: Replacement) {
  if (await save({ replacements: settings.value.replacements.filter((r) => r.from !== rule.from) }))
    if (editingFrom.value === rule.from) clearReplacement();
}
</script>
<template>
  <div class="ask-sections">
    <section v-if="local && !sources.length" class="sp-sec" aria-label="ASK">
      <div class="sp-sec-head"><h3>ASK</h3></div>
      <div class="sp-group">
        <div class="sp-empty">请在服务端配置 ASK 推理连接后重启</div>
      </div>
    </section>
    <template v-else>
      <section class="sp-sec" aria-label="推理模型">
        <div class="sp-sec-head"><h3>推理模型</h3></div>
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
              <p v-if="selected" class="s-meta">
                <span class="type">{{ protocol(selected) }}</span
                ><span :title="local ? undefined : selected.baseUrl">{{
                  local ? "本机同源代理" : selected.baseUrl.replace(/^https:\/\//, "")
                }}</span>
              </p>
            </div>
            <div class="s-ctl s-field">
              <select
                id="askConnection"
                :value="selected?.id ?? ''"
                @change="
                  save(
                    withConnection(
                      settings,
                      ($event.target as HTMLSelectElement).value,
                    ),
                  )
                "
              >
                <option v-if="!selected" value="" disabled>选择连接</option>
                <option v-for="c in sources" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select>
            </div>
          </div>
          <div class="s-row">
            <div>
              <b>模型</b>
              <!-- The list picks several; the composer's chip switches among them. -->
              <p v-if="settings.model" class="s-meta">
                <span class="type">{{ picked.length > 1 ? `当前 · 共 ${picked.length} 个` : "当前" }}</span
                ><span :title="settings.model">{{ settings.model }}</span>
              </p>
              <p v-else>
                需要流式输出、工具调用与图片输入；原生多模态、工具调用稳定的模型效果更好。
              </p>
            </div>
            <button
              class="btn btn-quiet btn-sm"
              type="button"
              :disabled="!selected"
              @click="selected && emit('models', selected.id)"
            >
              选择模型
            </button>
          </div>
          <div class="s-row">
            <div>
              <b><label for="askImages">发送图片给模型</label></b>
              <p>关闭后只发送参数与元数据</p>
            </div>
            <label class="s-toggle" title="发送图片给模型">
              <input
                id="askImages"
                type="checkbox"
                role="switch"
                :checked="settings.images"
                @change="save({ images: checked($event) })"
              />
              <span class="switch" aria-hidden="true"></span>
            </label>
          </div>
        </div>
      </section>
      <section class="sp-sec" aria-label="命名模型">
        <div class="sp-sec-head"><h3>命名模型</h3></div>
        <div class="sp-group">
          <div class="s-row">
            <b><label for="askNamingConnection">连接</label></b>
            <div class="s-ctl s-field">
              <select id="askNamingConnection" :value="settings.naming?.connectionId ?? ''" @change="save({ naming: ($event.target as HTMLSelectElement).value ? { connectionId: ($event.target as HTMLSelectElement).value, model: '' } : undefined })">
                <option value="">沿用 ASK</option>
                <option v-if="settings.naming && !sources.some(c => c.id === settings.naming?.connectionId)" :value="settings.naming.connectionId" disabled>连接不可用</option>
                <option v-for="c in sources" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>
          <div class="s-row">
            <div><b>模型</b><p class="s-meta"><span :title="settings.naming?.model ?? settings.model">{{ (settings.naming ? settings.naming.model : settings.model) || '尚未选择' }}</span></p></div>
            <button v-if="settings.naming" class="btn btn-quiet btn-sm" type="button" :disabled="!sources.some(c => c.id === settings.naming?.connectionId)" @click="emit('models', settings.naming.connectionId, 'naming')">选择模型</button>
            <span v-else class="s-meta">沿用 ASK</span>
          </div>
        </div>
      </section>
      <section class="sp-sec" aria-label="文本附件">
        <div class="sp-sec-head ask-text-head">
          <h3>文本附件</h3>
          <button class="btn btn-quiet btn-xs" type="button" :disabled="settings.textAttachments.chars === DEFAULT_TEXT_ATTACHMENT_LIMITS.chars && settings.textAttachments.totalChars === DEFAULT_TEXT_ATTACHMENT_LIMITS.totalChars" @click="save({ textAttachments: { ...DEFAULT_TEXT_ATTACHMENT_LIMITS } })">恢复默认</button>
        </div>
        <div class="sp-group">
          <div class="s-row">
            <b><label for="askTextChars">单个上限</label></b>
            <div class="s-ctl">
              <div class="fld-inline ask-text-limit">
                <input id="askTextChars" type="number" min="1" step="1" inputmode="numeric" :value="settings.textAttachments.chars" @change="setTextLimit('chars', $event)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
                <span>字符</span>
              </div>
            </div>
          </div>
          <div class="s-row">
            <b><label for="askTextTotalChars">每轮合计上限</label></b>
            <div class="s-ctl">
              <div class="fld-inline ask-text-limit">
                <input id="askTextTotalChars" type="number" :min="settings.textAttachments.chars" step="1" inputmode="numeric" :value="settings.textAttachments.totalChars" @change="setTextLimit('totalChars', $event)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
                <span>字符</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section class="sp-sec" aria-label="个人偏好">
        <div class="sp-sec-head"><h3>个人偏好</h3></div>
        <div class="sp-group">
          <div class="s-row s-block">
            <textarea
              id="askPreference"
              v-model="preference"
              rows="3"
              :maxlength="PREFERENCE_LIMIT"
              aria-label="个人偏好"
              placeholder="例如：回答简短，先说结论"
              @change="save({ preference })"
            ></textarea>
            <div class="s-head">
              <small>{{ preference.length }}/{{ PREFERENCE_LIMIT }}</small>
            </div>
          </div>
        </div>
      </section>
      <section class="sp-sec" aria-label="创作">
        <div class="sp-sec-head"><h3>创作</h3></div>
        <div class="sp-group">
          <div class="s-row">
            <div>
              <b><label for="askAdult">自由创作</label></b>
            </div>
            <label class="s-toggle" title="自由创作">
              <input
                id="askAdult"
                type="checkbox"
                role="switch"
                :checked="adult"
                @change="setAdult"
              />
              <span class="switch" aria-hidden="true"></span>
            </label>
          </div>
          <template v-if="adult">
            <div class="s-row">
              <div>
                <b><label for="askAlwaysCodec">始终启用词表混淆</label></b>
                <p>关闭时仅在被拦截后按需启用</p>
              </div>
              <label class="s-toggle" title="始终启用词表混淆">
                <input
                  id="askAlwaysCodec"
                  type="checkbox"
                  role="switch"
                  :checked="settings.alwaysCodec"
                  @change="save({ alwaysCodec: checked($event) })"
                />
                <span class="switch" aria-hidden="true"></span>
              </label>
            </div>
            <div class="s-row s-block">
              <div class="s-head">
                <b>自定义词条</b
                ><small>{{ settings.words.length }}/{{ wordLimits.count }}</small>
              </div>
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
              <form class="s-ctl s-field" @submit.prevent="addWord">
                <input
                  v-model="word"
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
            <div class="s-row s-block">
              <div class="s-head">
                <b>文本替换</b><small>{{ settings.replacements.length }}/{{ replacementLimits.count }}</small>
              </div>
              <ul v-if="settings.replacements.length" class="ask-rules" aria-label="文本替换">
                <li v-for="rule in settings.replacements" :key="rule.from">
                  <div class="ask-rule-text"><span>{{ rule.from }}</span><span aria-hidden="true">→</span><span>{{ rule.to }}</span></div>
                  <div class="ask-rule-actions">
                    <button type="button" class="btn btn-quiet btn-xs" :aria-label="`编辑替换 ${rule.from}`" @click="editReplacement(rule)">编辑</button>
                    <button type="button" class="btn btn-quiet btn-xs" :aria-label="`删除替换 ${rule.from}`" @click="removeReplacement(rule)">删除</button>
                  </div>
                </li>
              </ul>
              <form class="ask-replace-form" @submit.prevent="saveReplacement">
                <div class="ask-replace-fields">
                  <input ref="replacementInput" v-model="replacementFrom" aria-label="原文 A" placeholder="原文 A" type="text" :maxlength="replacementLimits.chars" autocomplete="off" spellcheck="false" @input="replacementError = ''" />
                  <span aria-hidden="true">→</span>
                  <input v-model="replacementTo" aria-label="替换为 B" placeholder="替换为 B" type="text" :maxlength="replacementLimits.chars" autocomplete="off" spellcheck="false" @input="replacementError = ''" />
                </div>
                <div class="ask-rule-actions">
                  <button v-if="editingFrom !== null" class="btn btn-quiet btn-xs" type="button" @click="clearReplacement">取消</button>
                  <button class="btn btn-quiet btn-xs" type="submit" :disabled="!replacementFrom.trim() || !replacementTo.trim()">{{ editingFrom === null ? "添加替换" : "保存替换" }}</button>
                </div>
              </form>
              <p v-if="replacementError" class="ask-error" role="alert">{{ replacementError }}</p>
            </div>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>
<style scoped>
/* Shared settings rows; vocabulary and replacement editors belong to ASK. */
.ask-sections { display: grid; gap: var(--sp-6); }
.ask-sections textarea { min-height: 76px; font-size: var(--fz-sm); }
.ask-text-head { display: flex; align-items: baseline; justify-content: space-between; }
.ask-text-limit { width: 140px; }
.ask-text-limit input { height: 32px; padding-right: 44px; text-align: right; }
.ask-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.ask-chips li {
  display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 9px;
  font: var(--fz-xs)/1 var(--mono); color: var(--fg-2);
  background: var(--raised); border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line-2);
}
.ask-chips li:has(button) { padding-right: 3px; }
.ask-chips button { display: grid; place-items: center; width: 18px; height: 18px; --ico: 11px; color: var(--fg-4); border-radius: 50%; }
.ask-chips button:hover { color: var(--fg); background: var(--hover); }
.s-row .ask-error { margin-top: -4px; font-size: var(--fz-xs); color: var(--err); }
.ask-rules { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.ask-rules li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--r1); background: var(--raised); }
.ask-rule-text { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: baseline; gap: 8px; flex: 1; min-width: 0; font: var(--fz-xs)/1.5 var(--mono); }
.ask-rule-text span { overflow-wrap: anywhere; }
.ask-rule-text span:nth-child(2), .ask-replace-fields > span { color: var(--fg-4); }
.ask-rule-actions { display: flex; flex-shrink: 0; justify-content: flex-end; gap: 4px; }
.ask-replace-form { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ask-replace-fields { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; flex: 1; gap: 8px; min-width: 0; }
.ask-replace-fields input { width: 100%; min-width: 0; height: 32px; }
@media (width <= 640px) {
  .ask-replace-form, .ask-rules li { align-items: stretch; flex-direction: column; }
}

</style>
