<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue";
import { appVersion, releaseNotes } from "../../config/releases";
import AppIcon from "../../shared/AppIcon.vue";

const emit = defineEmits<{ read: [] }>();
const heading = useTemplateRef<HTMLElement>("heading");
onMounted(() => {
  heading.value?.focus();
  if (releaseNotes.some(release => release.version === appVersion)) emit("read");
});
</script>
<template>
  <section class="sp-sec" aria-label="更新日志">
    <div class="sp-sec-head"><h3 ref="heading" tabindex="-1">更新日志</h3></div>
    <div class="release-list">
      <details
        v-for="release in releaseNotes"
        :key="release.version"
        class="release-entry"
        name="release-history"
        :open="release.version === appVersion"
      >
        <summary>
          <b>{{ release.date ? `v${release.version}` : release.version }}</b>
          <span v-if="release.version === appVersion" class="type">当前</span>
          <time v-if="release.date" :datetime="release.date">{{ release.date }}</time>
          <AppIcon name="i-chevron" />
        </summary>
        <div class="release-body">
          <p v-if="release.note" class="release-note">{{ release.note }}</p>
          <div v-for="(group, index) in release.groups" :key="index" class="release-group">
            <h4 v-if="group.title"><span class="type">{{ group.title }}</span></h4>
            <ul v-if="group.items.length"><li v-for="(item, i) in group.items" :key="i">{{ item }}</li></ul>
            <p v-for="(note, i) in group.notes" :key="i" class="release-note">{{ note }}</p>
          </div>
        </div>
      </details>
    </div>
  </section>
</template>
<style scoped>
.release-entry { border-bottom: 1px solid var(--line); }
.release-entry summary { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 12px 0; list-style: none; cursor: pointer; }
.release-entry summary::-webkit-details-marker { display: none; }
.release-entry summary b { color: var(--fg); font-size: var(--fz-sm); font-weight: var(--fw-semibold); }
.release-entry time { margin-left: auto; color: var(--fg-3); font: var(--fz-2xs)/1.4 var(--mono); }
.release-entry summary > .ico { --ico: var(--ico-sm); flex: none; color: var(--fg-3); }
.release-entry summary > .ico:last-child { margin-left: auto; }
.release-entry time + .ico:last-child { margin-left: 0; }
.release-entry[open] summary > .ico { transform: rotate(90deg); }
.release-body { padding: 0 0 20px; color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.75; overflow-wrap: anywhere; }
.release-group + .release-group { margin-top: 16px; }
.release-group h4 { margin: 0 0 8px; font: inherit; }
.release-group ul { margin: 0; padding-left: 20px; }
.release-group li + li { margin-top: 6px; }
.release-note { margin: 8px 0 0; color: var(--fg-3); font-size: var(--fz-xs); }
.release-body > .release-note { margin: 0 0 12px; }
</style>
