<script setup lang="ts">
import { computed } from "vue";
import { useDrawing } from "../../app/drawing";
import { themeChoices, useTheme } from "../../app/theme";
import type { ThemeChoice } from "../../app/theme";
import { message, useUi } from "../../app/ui";
import AppIcon from "../../shared/AppIcon.vue";
import RepoLink from "../../shared/RepoLink.vue";
const { drawing, view } = useDrawing();
const theme = useTheme(), ui = useUi();
const form = computed(() => view.value.form);
function setTheme(choice: ThemeChoice) {
  theme.set(choice).catch((error: unknown) => ui.toast(message(error), "err"));
}
function change(
  key: "tagSuggest" | "historyLimit" | "editorHistoryLimit",
  event: Event,
) {
  const input = event.target as HTMLInputElement;
  if (key === "historyLimit" || key === "editorHistoryLimit") {
    if (!input.value || !input.validity.valid || !Number.isSafeInteger(input.valueAsNumber)) {
      input.value = String(form.value[key]);
      return;
    }
  }
  void drawing.patch({
    [key]: input.type === "checkbox" ? input.checked : Number(input.value),
  });
}
</script>
<template>
  <section class="sp-sec" aria-label="通用">
    <div class="sp-sec-head"><h3>通用</h3></div>
    <div class="sp-group s-appearance-group">
      <div class="s-row s-appearance">
        <div>
          <b id="themeLabel">外观</b>
        </div>
        <div class="seg s-theme" role="radiogroup" aria-labelledby="themeLabel">
          <label v-for="(item, key) in themeChoices" :key="key"
            ><input
              type="radio"
              name="theme"
              :value="key"
              :checked="theme.choice.value === key"
              @change="setTheme(key)"
            /><span>{{ item.label }}</span></label
          >
        </div>
      </div>
    </div>
    <div class="sp-group">
      <div class="s-row">
        <div>
          <b><label for="tagSuggest">Tag 自动补全</label></b>
        </div>
        <label class="s-toggle" title="Tag 自动补全">
          <input
            id="tagSuggest"
            type="checkbox"
            role="switch"
            :checked="form.tagSuggest"
            @change="change('tagSuggest', $event)"
          />
          <span class="switch" aria-hidden="true"></span>
        </label>
      </div>
      <div class="s-row">
        <div>
          <b><label for="historyLimit">绘图历史</label></b>
          <p>刷新后清空</p>
        </div>
        <div class="s-ctl">
          <div class="fld-inline history-limit" title="填 0 不限数量">
            <input
              id="historyLimit"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              :value="form.historyLimit"
              aria-label="历史保留张数，0 为不限"
              @change="change('historyLimit', $event)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
            <span>张</span>
          </div>
        </div>
      </div>
      <div class="s-row">
        <div>
          <b><label for="editorHistoryLimit">编辑版本</label></b>
          <p>每个画板 · 刷新后清空</p>
        </div>
        <div class="s-ctl">
          <div class="fld-inline history-limit" title="填 0 不限数量；原图、底图与查看组始终保留">
            <input
              id="editorHistoryLimit"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              :value="form.editorHistoryLimit"
              aria-label="每个编辑画板保留张数，0 为不限"
              @change="change('editorHistoryLimit', $event)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
            <span>张</span>
          </div>
        </div>
      </div>
    </div>
    <div class="sp-group">
      <div class="s-row">
        <div>
          <b>关于</b>
          <p>Koma Image 源码仓库</p>
        </div>
        <RepoLink class="btn btn-quiet btn-sm"
          ><AppIcon name="i-github" />GitHub<AppIcon name="i-external"
        /></RepoLink>
      </div>
    </div>
  </section>
</template>
