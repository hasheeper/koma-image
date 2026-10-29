<script setup lang="ts">
import { computed } from "vue";
import { useDrawing } from "../../app/drawing";
import AppIcon from "../../shared/AppIcon.vue";
import RepoLink from "../../shared/RepoLink.vue";
const { drawing, view } = useDrawing();
const form = computed(() => view.value.form);
function change(
  key: "tagSuggest" | "localCache" | "historyLimit",
  event: Event,
) {
  const input = event.target as HTMLInputElement;
  void drawing.patch({
    [key]: input.type === "checkbox" ? input.checked : Number(input.value),
  });
}
</script>
<template>
  <section class="sp-sec" aria-label="通用">
    <div class="sp-sec-head"><h3>通用</h3></div>
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
          <b><label for="localCache">保留历史</label></b>
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
              :value="form.localCache ? form.historyLimit : 1"
              :disabled="!form.localCache"
              aria-label="历史保留张数，0 为不限"
              @input="change('historyLimit', $event)"
              @keydown.enter.prevent
            />
            <span>张</span>
          </div>
          <label class="s-toggle" title="保留历史">
            <input
              id="localCache"
              type="checkbox"
              role="switch"
              :checked="form.localCache"
              @change="change('localCache', $event)"
            />
            <span class="switch" aria-hidden="true"></span>
          </label>
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
