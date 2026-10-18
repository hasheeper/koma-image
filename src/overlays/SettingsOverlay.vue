<script setup lang="ts">
import { useTemplateRef } from "vue";
import { useShell } from "../app/shell";
import { useDialog } from "./use-dialog";
import BrandMark from "../shared/BrandMark.vue";
import AppIcon from "../shared/AppIcon.vue";
import type { SettingsSection } from "../app/routes";

const { router } = useShell();
const { requestClose, cancel, closed } = useDialog(
  "settings",
  useTemplateRef<HTMLDialogElement>("dialog"),
);
const sections: { id: SettingsSection; label: string; icon: string }[] = [
  { id: "connections", label: "连接", icon: "swap" },
  { id: "models", label: "模型", icon: "model" },
  { id: "security", label: "安全", icon: "lock" },
  { id: "backup", label: "备份与迁移", icon: "import" },
];
const avatar = `${import.meta.env.BASE_URL}assets/default-avatar.svg`;
</script>
<template>
  <dialog
    ref="dialog"
    id="settingsPanel"
    class="settings set-ui"
    aria-labelledby="settingsTitle"
    @cancel="cancel"
    @close="closed"
  >
    <header class="topbar set-bar">
      <button
        class="ibtn set-back"
        type="button"
        aria-label="返回"
        data-tip="返回 · Esc"
        autofocus
        @click="requestClose"
      >
        <AppIcon name="i-back" />
      </button>
      <h2 class="brand set-title" id="settingsTitle" aria-label="设置">
        <BrandMark surface="settings" subtitle="SETTINGS" />
      </h2>
    </header>
    <div class="set-lay">
      <nav class="set-nav" aria-label="设置">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          :aria-current="
            router.route.value.section === section.id ? 'true' : undefined
          "
          @click="router.selectSection(section.id)"
        >
          <AppIcon :name="`i-${section.icon}`" /><span>{{
            section.label
          }}</span>
        </button>
      </nav>
      <div class="set-scroll">
        <div class="set-col">
          <!-- Content services enter in M2/M3. No credentials are accepted or saved in this shell. -->
          <section
            v-show="router.route.value.section === 'connections'"
            class="sp-sec"
            aria-label="连接"
          >
            <div class="sp-sec-head"><h3>连接</h3></div>
            <div class="sp-empty">
              <span class="vtile connection-avatar"
                ><img
                  :src="avatar"
                  alt="默认头像"
                  width="26"
                  height="26" /></span
              ><span>尚未配置连接</span
              ><button class="btn btn-quiet btn-sm" type="button" disabled>
                添加连接
              </button>
            </div>
          </section>
          <section
            v-show="router.route.value.section === 'models'"
            class="sp-sec"
            aria-label="模型"
          >
            <div class="sp-sec-head"><h3>模型</h3></div>
            <p class="sp-note">尚未配置模型来源</p>
          </section>
          <section
            v-show="router.route.value.section === 'security'"
            class="sp-sec"
            aria-label="安全"
          >
            <div class="sp-sec-head"><h3>API Key</h3></div>
            <p class="sp-note">未配置 Key</p>
          </section>
          <section
            v-show="router.route.value.section === 'backup'"
            class="sp-sec"
            aria-label="备份与迁移"
          >
            <div class="sp-sec-head">
              <h3>备份与迁移</h3>
              <p>收藏、对话与偏好</p>
            </div>
            <div class="transfer-row">
              <div>
                <h3>导出备份</h3>
                <p>收藏原图、对话和偏好设置。</p>
              </div>
              <button class="btn btn-quiet btn-sm" type="button" disabled>
                导出备份
              </button>
            </div>
            <div class="transfer-row">
              <div>
                <h3>导入备份</h3>
                <p>从本地备份恢复数据。</p>
              </div>
              <button class="btn btn-quiet btn-sm" type="button" disabled>
                选择文件
              </button>
            </div>
            <p class="transfer-key-note">
              备份不包含 API Key、普通历史或编辑会话。
            </p>
          </section>
        </div>
      </div>
    </div>
  </dialog>
</template>
