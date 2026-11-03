<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from "vue";
import { useServices } from "../../app/services";
import { message } from "../../app/ui";
import AppIcon from "../../shared/AppIcon.vue";
import type { Routing } from "../../config/connections";
import { normalizeBaseUrl, validateRouting } from "../../config/connections";
import { STANDARD_PROFILE_ID, connectionProfiles, profileFor, NOVELAI_IMAGE_URL, isOpenAIConnection, OPENAI_SHARED_PROFILE_ID, isGeminiConnection, GEMINI_CHAT_PROFILE_ID, GEMINI_SHARED_PROFILE_ID } from "../../gateway/profile";
const props = defineProps<{ routing: Routing }>();
const { connections, vault } = useServices();
const local = connections.local, routing = computed(() => props.routing);
const sprite = `${import.meta.env.BASE_URL}assets/icons.svg`;
const form = useTemplateRef<HTMLDialogElement>("connectionForm"), formKey = useTemplateRef<HTMLInputElement>("connectionKey");
const version = ref(0);
const unvault = vault.subscribe(() => { version.value++; });
// The connection form adds a connection, or edits one when it has a target.
const formTarget = ref<string | null>(null),
  formName = ref(""),
  formProfile = ref(STANDARD_PROFILE_ID),
  formUrl = ref(""),
  formError = ref(""),
  formBusy = ref(false),
  formKeyVisible = ref(false),
  formRemember = ref(true);
const formChat = ref(false), formImages = ref(true);
const openAI = computed(() => isOpenAIConnection(formProfile.value));
const gemini = computed(() => isGeminiConnection(formProfile.value));
const dual = computed(() => openAI.value || gemini.value);
// One visible entry per protocol family; profiles describe enabled uses.
const protocols = connectionProfiles.flatMap(p => isOpenAIConnection(p.id)
  ? p.id === "openai-images-v1" ? [{ id: "openai", label: "OpenAI 兼容" }] : []
  : isGeminiConnection(p.id) ? p.id === "gemini-native-v1" ? [{ id: "gemini", label: "Gemini 原生" }] : []
    : [{ id: p.id, label: p.label }]);
const formProtocol = computed({
  get: () => openAI.value ? "openai" : gemini.value ? "gemini" : formProfile.value,
  set: (value: string) => { formProfile.value = value === "openai" ? OPENAI_SHARED_PROFILE_ID : value === "gemini" ? GEMINI_SHARED_PROFILE_ID : value; },
});
function syncInterfaces() {
  const profile = profileFor(formProfile.value);
  formChat.value = !!profile.reasoning;
  formImages.value = profile.image;
}
function setInterfaces() {
  if (!formChat.value && !formImages.value) {
    formError.value = "请至少开启文字或图像";
    return;
  }
  formError.value = "";
  formProfile.value = gemini.value
    ? formChat.value && formImages.value ? GEMINI_SHARED_PROFILE_ID : formChat.value ? GEMINI_CHAT_PROFILE_ID : "gemini-native-v1"
    : formChat.value && formImages.value ? OPENAI_SHARED_PROFILE_ID : formChat.value ? "openai-chat-v1" : "openai-images-v1";
}
let formKeyTouched = false, formKeyFromSaved = false;
const formHasKey = computed(() => {
  version.value;
  const c = formTarget.value ? routing.value.connections[formTarget.value] : undefined;
  return Boolean(c && vault.key(c.credentialRef));
});
function wipeKey() {
  if (formKey.value) formKey.value.value = "";
  formKeyVisible.value = false;
  formKeyTouched = false;
  formKeyFromSaved = false;
}
function keyEdited() {
  formKeyTouched = true;
  formKeyFromSaved = false;
}
function toggleKey() {
  if (formBusy.value || !formKey.value) return;
  if (!formKeyVisible.value && !formKey.value.value && !formKeyTouched) {
    const c = formTarget.value ? routing.value.connections[formTarget.value] : undefined;
    const saved = c ? vault.key(c.credentialRef) : null;
    if (saved) {
      formKey.value.value = saved;
      formKeyFromSaved = true;
    }
  }
  formKeyVisible.value = !formKeyVisible.value;
}
function closeForm() {
  if (!formBusy.value) {
    wipeKey();
    form.value?.close();
  }
}
function add() {
  if (local || formBusy.value) return;
  formTarget.value = null;
  formName.value = "";
  formUrl.value = "";
  formProfile.value = STANDARD_PROFILE_ID;
  syncInterfaces();
  formRemember.value = true;
  formError.value = "";
  wipeKey();
  form.value?.showModal();
}
function edit(id: string) {
  const c = routing.value.connections[id];
  if (local || !c || formBusy.value) return;
  formTarget.value = id;
  formName.value = c.name;
  formUrl.value = c.baseUrl;
  formProfile.value = c.profileId;
  syncInterfaces();
  formRemember.value = vault.key(c.credentialRef) ? vault.remembered(c.credentialRef) : true;
  formError.value = "";
  wipeKey();
  form.value?.showModal();
}
function selectProtocol() {
  syncInterfaces();
  formError.value = "";
  const target = formTarget.value ? routing.value.connections[formTarget.value] : undefined;
  if (target && profileFor(formProfile.value).protocol === "novelai" && target.baseUrl !== NOVELAI_IMAGE_URL) {
    formProfile.value = target.profileId;
    syncInterfaces();
    formError.value = "请单独配置 NovelAI 官方供应商，并填写对应 Key";
    return;
  }
  if (profileFor(formProfile.value).protocol === "novelai") formUrl.value = NOVELAI_IMAGE_URL;
  else if (formUrl.value === NOVELAI_IMAGE_URL) formUrl.value = "";
}
async function saveForm() {
  if (local || formBusy.value) return;
  formError.value = "";
  formBusy.value = true;
  let stagedRef: string | undefined;
  try {
    const name = formName.value.trim();
    if (dual.value && !formChat.value && !formImages.value) throw new Error("请至少开启文字或图像");
    if (!name) throw new Error("请填写供应商名称");
    const baseUrl = normalizeBaseUrl(formUrl.value), next = structuredClone(routing.value);
    const previous = formTarget.value ? next.connections[formTarget.value] : undefined;
    if (formTarget.value && !previous) throw new Error("供应商已被删除，请重新配置");
    const input = formKeyFromSaved ? "" : formKey.value?.value.trim() ?? "", oldKey = previous ? vault.key(previous.credentialRef) : null;
    const sameFamily = previous && ((isOpenAIConnection(previous.profileId) && openAI.value) || (isGeminiConnection(previous.profileId) && gemini.value));
    const endpointChanged = previous && (previous.baseUrl !== baseUrl || (previous.profileId !== formProfile.value && !sameFamily));
    if (endpointChanged && !input) throw new Error("地址或协议已更改，请重新填写对应的 API Key");
    if (!input && !oldKey) throw new Error("请填写 API Key");
    const id = previous?.id ?? `connection-${crypto.randomUUID()}`;
    // Stage a fresh reference so a new Key can never be paired with the previous destination.
    const replaceKey = !previous || Boolean(input && input !== oldKey) || endpointChanged;
    const credentialRef = replaceKey ? `key-${crypto.randomUUID()}` : previous.credentialRef;
    next.connections[id] = { id, name, baseUrl, profileId: formProfile.value, credentialRef, revision: previous?.revision ?? crypto.randomUUID() };
    if (previous && previous.profileId !== formProfile.value && !sameFamily) next.links[id] = {};
    const validated = validateRouting(next);
    if (replaceKey) {
      await vault.setKey(credentialRef, input || oldKey!, formRemember.value);
      stagedRef = credentialRef;
    }
    await connections.save(validated);
    stagedRef = undefined;
    if (previous && previous.credentialRef !== credentialRef && !Object.values(connections.configuration.connections).some(c => c.credentialRef === previous.credentialRef)) {
      await vault.removeKey(previous.credentialRef);
    } else if (previous && !replaceKey && formRemember.value !== vault.remembered(credentialRef)) {
      await vault.setKey(credentialRef, oldKey!, formRemember.value);
    }
    wipeKey();
    form.value?.close();
  } catch (error) {
    if (stagedRef) {
      try { await vault.removeKey(stagedRef); } catch { /* An unreferenced Key cannot be used by any supplier. */ }
    }
    formError.value = message(error);
  } finally {
    formBusy.value = false;
  }
}
function dismiss() { wipeKey(); form.value?.close(); }
onBeforeUnmount(() => { dismiss(); unvault(); });
defineExpose({ add, edit, close: dismiss, busy: formBusy });
</script>
<template>
  <dialog
    ref="connectionForm"
    class="modal set-ui supplier-form"
    aria-label="供应商设置"
    @cancel.prevent="closeForm"
    @close="wipeKey"
  >
    <form class="modal-form" @submit.prevent="saveForm">
      <header class="modal-head supplier-head">
        <div class="supplier-brand">
          <span class="brand-mark" aria-hidden="true"><svg><use :href="`${sprite}#mk-image`" /></svg></span>
          <span id="connectionTitle" class="brand-title">Koma Image</span>
        </div>
      </header>
      <div class="modal-body">
        <div class="fld">
          <label for="connectionProtocol">接口协议</label>
          <select id="connectionProtocol" v-model="formProtocol" :disabled="formBusy" @change="selectProtocol">
            <option v-for="p in protocols" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <fieldset v-if="dual" class="supplier-interfaces" :disabled="formBusy">
          <legend>开启接口</legend>
          <div class="supplier-interface-options">
            <label class="check supplier-interface">
              <input v-model="formChat" type="checkbox" aria-label="文字 · ASK" @change="setInterfaces" />
              <span aria-hidden="true" />
              <span class="supplier-interface-copy">文字</span>
            </label>
            <label class="check supplier-interface">
              <input v-model="formImages" type="checkbox" aria-label="图像 · 生图与编辑" @change="setInterfaces" />
              <span aria-hidden="true" />
              <span class="supplier-interface-copy">图像</span>
            </label>
          </div>
        </fieldset>
        <div class="fld">
          <label for="connectionName">名称</label
          ><input
            id="connectionName"
            v-model="formName"
            :disabled="formBusy"
            placeholder="供应商名称"
            type="text"
            maxlength="128"
          />
        </div>
        <div class="fld">
          <label for="connectionUrl">地址</label
          ><input
            id="connectionUrl"
            v-model="formUrl"
            :disabled="formBusy"
            :readonly="profileFor(formProfile).protocol === 'novelai'"
            type="text"
            placeholder="https://"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="fld">
          <label for="connectionKey">API Key</label>
          <div class="connection-secret">
            <input id="connectionKey" ref="connectionKey" :type="formKeyVisible ? 'text' : 'password'" autocomplete="off" spellcheck="false"
              :disabled="formBusy" :placeholder="formHasKey ? '留空保留原 Key' : '填写 API Key'" @input="keyEdited" />
            <button class="ibtn connection-key-toggle" type="button" :disabled="formBusy"
              :aria-label="formKeyVisible ? '隐藏 API Key' : '显示 API Key'" :aria-pressed="formKeyVisible"
              :title="formKeyVisible ? '隐藏 API Key' : '显示 API Key'" aria-controls="connectionKey" @click="toggleKey">
              <AppIcon :name="formKeyVisible ? 'i-eye-off' : 'i-eye'" />
            </button>
          </div>
        </div>
        <label class="check connection-remember">
          <input v-model="formRemember" type="checkbox" :disabled="formBusy" />
          <span aria-hidden="true" />
          <span>在此浏览器保存 Key</span>
        </label>
      </div>
      <footer class="modal-foot">
        <p class="modal-error" role="alert">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn btn-quiet" type="button" @click="closeForm" :disabled="formBusy">
            取消</button
          ><button class="btn btn-primary" type="submit" :disabled="formBusy">
            {{ formBusy ? "保存中…" : "保存" }}
          </button>
        </div>
      </footer>
    </form>
  </dialog>
</template>
<style scoped>
.supplier-head {
  display: grid;
  justify-content: stretch;
  gap: 12px;
  padding-bottom: 12px;
}
.supplier-brand {
  display: flex;
  align-items: center;
  gap: 11px;
}
/* The favicon's drawing at dialog size on the themed brand plate: no faint
   corner tiles, and the glyph fills the plate the way the favicon does. */
.supplier-brand .brand-mark { --m: 40px; --mark-faint: 0; }
.supplier-brand .brand-mark svg { width: 82.5%; height: 82.5%; }
.supplier-brand .brand-title {
  font-size: 26px;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.3;
  padding-block: 2px;
}
.supplier-form .modal-body {
  display: grid;
  gap: 10px;
  padding-bottom: 16px;
}
.supplier-form .fld {
  gap: 5px;
}
.connection-secret {
  position: relative;
  min-width: 0;
}
.connection-secret input {
  padding-right: 38px;
}
.supplier-form .connection-key-toggle {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 30px;
  height: calc(100% - 4px);
  border-radius: var(--r2);
}
.supplier-form .check {
  position: relative;
}
.supplier-form .check > input {
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: inherit;
}
.connection-remember {
  font-size: var(--fz-xs);
}
.supplier-interfaces {
  min-inline-size: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
.supplier-interfaces legend {
  padding: 0;
  margin-bottom: 5px;
  color: var(--fg-3);
  font-size: var(--fz-xs);
  font-weight: var(--fw-medium);
  letter-spacing: 0.01em;
}
.supplier-interface-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--sp-5);
}
.supplier-interface {
  min-width: 0;
  min-height: 28px;
}
.supplier-interface-copy {
  color: var(--fg);
  line-height: 1.4;
}
@media (max-width: 480px) {
  .supplier-interface {
    min-height: 44px;
  }
}
</style>
