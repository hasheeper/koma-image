<script setup lang="ts">
import { ref } from "vue";
const prompt = ref("");
const negative = ref("");
const tab = ref("prompt");
function select(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  tab.value =
    event.key === "Home"
      ? "prompt"
      : event.key === "End"
        ? "negative"
        : tab.value === "prompt"
          ? "negative"
          : "prompt";
  document.getElementById(`tab-${tab.value}`)?.focus();
}
</script>
<template>
  <div class="fld fld-hero promptbox" :data-tab="tab">
    <div class="promptbox-head">
      <div class="tabs" role="tablist" aria-label="Prompt" @keydown="select">
        <button
          id="tab-prompt"
          class="tab"
          type="button"
          role="tab"
          aria-controls="panePrompt"
          :aria-selected="tab === 'prompt'"
          :tabindex="tab === 'prompt' ? 0 : -1"
          @click="tab = 'prompt'"
        >
          <span>Prompt</span><span class="tab-count">{{ prompt.length }}</span>
        </button>
        <button
          id="tab-negative"
          class="tab"
          type="button"
          role="tab"
          aria-controls="paneNegative"
          :aria-selected="tab === 'negative'"
          :tabindex="tab === 'negative' ? 0 : -1"
          @click="tab = 'negative'"
        >
          <span>Negative</span
          ><span class="tab-count">{{ negative.length }}</span>
        </button>
      </div>
    </div>
    <div class="promptbox-body">
      <!-- Hosts are declared here. The highlighter may paint a mirror, never wrap or move Vue nodes. -->
      <div
        id="panePrompt"
        class="pane"
        role="tabpanel"
        aria-labelledby="tab-prompt"
        :hidden="tab !== 'prompt'"
        tabindex="-1"
      >
        <div class="hl-wrap">
          <div class="hl-mirror" aria-hidden="true"></div>
          <textarea
            id="prompt"
            v-model="prompt"
            aria-label="Prompt"
            placeholder="输入中文或英文 Tag，可自动补全"
            autocomplete="off"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
      <div
        id="paneNegative"
        class="pane"
        role="tabpanel"
        aria-labelledby="tab-negative"
        :hidden="tab !== 'negative'"
        tabindex="-1"
      >
        <div class="hl-wrap">
          <div class="hl-mirror" aria-hidden="true"></div>
          <textarea
            id="negative"
            v-model="negative"
            aria-label="Negative"
            placeholder="lowres, blurry, watermark…"
            autocomplete="off"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>
