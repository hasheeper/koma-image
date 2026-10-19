<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useServices } from "../app/services";
import { useUi, message } from "../app/ui";
import { useShell } from "../app/shell";
const { vault, connections } = useServices(),
  ui = useUi(),
  { router } = useShell();
const icon = `${import.meta.env.BASE_URL}assets/favicon-image.svg`;
const dialog = useTemplateRef<HTMLDialogElement>("dialog"),
  keyInput = useTemplateRef<HTMLInputElement>("key"),
  pass = useTemplateRef<HTMLInputElement>("pass"),
  pass2 = useTemplateRef<HTMLInputElement>("pass2");
const version = ref(0),
  note = ref(""),
  busy = ref(false),
  saveMode = ref("encrypted");
const mode = computed(() => {
  version.value;
  return vault.mode();
});
const unlocked = computed(() => {
  version.value;
  return vault.isUnlocked();
});
const view = computed(() =>
  ui.credential.value?.action === "passphrase"
    ? "passphrase"
    : mode.value === "encrypted" && !unlocked.value
      ? "unlock"
      : "setup",
);
const needsPass = computed(
  () =>
    view.value === "passphrase" ||
    (view.value === "setup" &&
      !unlocked.value &&
      saveMode.value === "encrypted"),
);
function wipe() {
  for (const input of [keyInput.value, pass.value, pass2.value])
    if (input) input.value = "";
}
function close() {
  if (busy.value) return;
  ui.credential.value = null;
  wipe();
}
const unsub = vault.subscribe((type) => {
  if (connections.local) return;
  version.value++;
  if (type === "unlock") {
    ui.credential.value = null;
    wipe();
  }
  if (type === "lock" || type === "forget") {
    const id = Object.values(connections.configuration.connections)[0]
      ?.credentialRef;
    if (
      id &&
      !(
        router.route.value.overlay === "settings" &&
        router.route.value.section === "backup"
      )
    )
      ui.requestKey(id);
  }
});
watch(ui.credential, async (value) => {
  if (connections.local && value) {
    ui.credential.value = null;
    router.openOverlay("settings", "security");
    return;
  }
  note.value = "";
  wipe();
  await nextTick();
  if (value) {
    if (!dialog.value?.open) dialog.value?.showModal();
    (view.value === "unlock"
      ? pass.value
      : (keyInput.value ?? pass.value)
    )?.focus();
  } else dialog.value?.close();
});
onMounted(() => {
  if (connections.local) return;
  if (
    mode.value === "encrypted" &&
    !unlocked.value &&
    !(
      router.route.value.overlay === "settings" &&
      router.route.value.section === "backup"
    )
  ) {
    ui.requestKey(
      Object.values(connections.configuration.connections)[0]?.credentialRef ??
        "",
    );
  }
});
onBeforeUnmount(() => {
  unsub();
  wipe();
  dialog.value?.close();
});
async function submit() {
  if (busy.value) return;
  note.value = "";
  busy.value = true;
  try {
    if (view.value === "unlock") await vault.unlock(pass.value?.value ?? "");
    else {
      const id = ui.credential.value?.id ?? "",
        value = keyInput.value?.value ?? "";
      if (needsPass.value) {
        const password = pass.value?.value ?? "";
        if (password !== pass2.value?.value) throw new Error("两次口令不一致");
        if (view.value === "passphrase") await vault.changePassphrase(password);
        else await vault.saveEncrypted(id, value, password);
      } else if (unlocked.value) await vault.setKey(id, value);
      else await vault.saveSession(id, value);
    }
    ui.credential.value = null;
    wipe();
  } catch (error) {
    note.value = message(error);
  } finally {
    busy.value = false;
  }
}
async function forget() {
  if (
    !(await ui.confirm({
      title: "清除全部 Key？",
      message: "需要重新填写 Key，图片、对话和连接不受影响。",
      confirmLabel: "清除",
      tone: "danger",
    }))
  )
    return;
  busy.value = true;
  try {
    await vault.forget();
  } catch (error) {
    note.value = message(error);
  } finally {
    busy.value = false;
  }
}
function backup() {
  close();
  router.openOverlay("settings", "backup");
}
</script>
<template>
  <dialog
    ref="dialog"
    id="gate"
    class="gate"
    aria-labelledby="gateTitle"
    closedby="none"
    @cancel.prevent
  >
    <form class="gate-card" @submit.prevent="submit">
      <div class="gate-brand app-gate-brand">
        <img
          class="gate-brand-mark"
          :src="icon"
          width="128"
          height="128"
          alt=""
        />
        <h1 id="gateTitle" class="brand-title">Koma Image</h1>
      </div>
      <section class="gate-view">
        <p class="lede">
          {{
            view === "unlock"
              ? "输入口令解锁本机保存的 Key。"
              : view === "passphrase"
                ? "所有连接的 Key 使用同一个口令加密。"
                : "填写连接的 API Key。Key 只保存在这台设备。"
          }}
        </p>
        <div v-if="view === 'setup'" class="fld">
          <label for="setupKey">API Key</label
          ><input
            id="setupKey"
            ref="key"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="sk-…"
          />
        </div>
        <div v-if="view === 'setup' && !unlocked" class="fld">
          <label>保存方式</label>
          <div class="seg" role="radiogroup">
            <label
              ><input v-model="saveMode" type="radio" value="encrypted" /><span
                >口令加密</span
              ></label
            ><label
              ><input v-model="saveMode" type="radio" value="session" /><span
                >不保存</span
              ></label
            >
          </div>
        </div>
        <div v-if="view === 'unlock'" class="fld">
          <label for="unlockPass">口令</label
          ><input
            id="unlockPass"
            ref="pass"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <div v-else-if="needsPass" class="pair">
          <div class="fld">
            <label for="setupPass">口令</label
            ><input
              id="setupPass"
              ref="pass"
              type="password"
              autocomplete="new-password"
              placeholder="≥ 4 位"
            />
          </div>
          <div class="fld">
            <label for="setupPass2">确认</label
            ><input
              id="setupPass2"
              ref="pass2"
              type="password"
              autocomplete="new-password"
            />
          </div>
        </div>
        <p class="note" role="alert">{{ note }}</p>
        <button
          class="btn btn-primary btn-block"
          type="submit"
          :disabled="busy"
        >
          {{ view === "unlock" ? "解锁" : "保存" }}
        </button>
        <button
          v-if="view === 'unlock'"
          class="btn-link centered"
          type="button"
          :disabled="busy"
          @click="forget"
        >
          清除并重填
        </button>
        <button
          v-else
          class="btn-link centered"
          type="button"
          :disabled="busy"
          @click="close"
        >
          返回设置
        </button>
      </section>
      <button
        class="btn-link centered gate-transfer"
        type="button"
        :disabled="busy"
        @click="backup"
      >
        备份与恢复
      </button>
    </form>
  </dialog>
</template>
