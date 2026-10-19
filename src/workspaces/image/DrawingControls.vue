<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useDrawing } from "../../app/drawing";
import { useUi } from "../../app/ui";
import {
  DEFAULTS,
  samplerName,
  randomSeed,
  RATIOS,
  sizes,
  presetMatch,
  closestShape,
  mirror,
  snap,
  sizeProblem,
} from "../../domain/drawing";
import type { Tier, Orientation, DrawingForm } from "../../domain/drawing";
import AppIcon from "../../shared/AppIcon.vue";
const { drawing, view } = useDrawing(),
  ui = useUi();
const f = computed(() => view.value.form),
  tier = ref<Tier>("m"),
  lastDirection = ref<Orientation>("portrait"),
  lastShape = ref("2:3");
const match = computed(() =>
  presetMatch(Number(f.value.width), Number(f.value.height)),
);
const orientation = computed<Orientation>(() =>
  f.value.width === f.value.height
    ? "square"
    : f.value.width < f.value.height
      ? "portrait"
      : "landscape",
);
watch(
  [match, orientation, () => f.value.width, () => f.value.height],
  () => {
    if (match.value) tier.value = match.value.tier;
    if (orientation.value !== "square") {
      lastDirection.value = orientation.value;
      const shape =
        match.value?.shape ||
        closestShape(f.value.width, f.value.height, tier.value);
      if (shape !== "1:1")
        lastShape.value =
          orientation.value === "portrait" ? shape : mirror(shape);
    }
  },
  { immediate: true },
);
const ratios = computed(() =>
  lastDirection.value === "landscape" ? RATIOS.map(mirror) : RATIOS,
);
const problem = computed(() =>
  sizeProblem(
    Number(f.value.width),
    Number(f.value.height),
    view.value.model?.maxPixels,
  ),
);
const badge = computed(
  () =>
    [
      "sampler",
      "steps",
      "scale",
      "cfg",
      "seed",
      "batchCount",
      "optimize",
      "serverCache",
      "transparentBg",
    ].filter(
      (key) =>
        (key === "batchCount"
          ? view.value.batchCount
          : f.value[key as keyof DrawingForm]) !==
        DEFAULTS[key as keyof DrawingForm],
    ).length,
);
const dimensions = computed(() => {
  const w = Number(f.value.width) || 1,
    h = Number(f.value.height) || 1;
  return {
    width: `${(w * 20) / Math.max(w, h)}px`,
    height: `${(h * 20) / Math.max(w, h)}px`,
  };
});
function change(key: keyof DrawingForm, event: Event) {
  const input = event.target as HTMLInputElement;
  if (key === "transparentBg" && input.checked)
    ui.toast("生成时会自动添加 transparent background");
  void drawing.patch({
    [key]:
      input.type === "checkbox"
        ? input.checked
        : input.type === "range" || (input.type === "number" && key !== "seed")
          ? Number(input.value)
          : input.value,
  });
}
function apply(shape: string, next = tier.value) {
  const [width, height] = sizes(next)[shape];
  void drawing.patch({ width, height });
}
function setTier(next: Tier) {
  apply(
    match.value?.shape ||
      closestShape(f.value.width, f.value.height, tier.value),
    next,
  );
}
function direct(next: Orientation) {
  if (next === orientation.value) return;
  if (next === "square") apply("1:1");
  else if (orientation.value === "square")
    apply(next === "portrait" ? lastShape.value : mirror(lastShape.value));
  else void drawing.patch({ width: f.value.height, height: f.value.width });
}
function commit(key: "width" | "height") {
  const n = snap(f.value[key]);
  if (n !== null) {
    if (n !== f.value[key]) ui.toast(`尺寸需为 64 的倍数，已调整为 ${n}`);
    void drawing.patch({ [key]: n });
  }
}
function radioKey(e: KeyboardEvent) {
  const buttons = [
      ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
        "button",
      ),
    ],
    at = buttons.indexOf(e.target as HTMLButtonElement);
  const next = (
    {
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      Home: 0,
      End: buttons.length - 1,
    } as Record<string, number>
  )[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const b = buttons[(next + buttons.length) % buttons.length];
  b?.focus();
  b?.click();
}
function reset() {
  void drawing.patch({
    sampler: view.value.samplers.includes(DEFAULTS.sampler)
      ? DEFAULTS.sampler
      : view.value.samplers[0],
    steps: 25,
    scale: 5,
    cfg: 10,
    seed: "",
    batchCount: 1,
    optimize: false,
    serverCache: false,
    transparentBg: false,
  });
}
const batchHint = computed(() =>
  view.value.policy.serialUnavailable
    ? view.value.quotaLoading
      ? "正在读取临时 Key 全局日额度，串行暂不可用。"
      : "临时 Key 全局日额度暂不可用，为避免超额，串行已关闭。"
    : view.value.policy.serialDisabled
      ? `临时 Key 全局日额度剩余 ${view.value.policy.tempRemaining}，低于 300，仅允许单张生成。`
      : "严格逐张请求；失败或取消时停止剩余队列。",
);
</script>
<template>
  <div class="fld">
    <div class="fld-top">
      <label class="composer-heading" for="model"
        ><AppIcon class="section-ico" name="i-model" />模型</label
      >
    </div>
    <select
      id="model"
      :title="
        view.model
          ? [
              view.model.description,
              `上限 ${(view.model.maxPixels / 1e6).toFixed(2)}M 像素`,
            ]
              .filter(Boolean)
              .join(' · ')
          : ''
      "
      :value="f.model"
      :disabled="!view.models.length"
      @change="change('model', $event)"
    >
      <option v-if="!view.models.length" value="">
        {{
          view.catalogLoading
            ? "加载中…"
            : view.catalogError
              ? "连接未就绪"
              : "未配置连接"
        }}
      </option>
      <option v-for="m in view.models" :key="m.id" :value="m.id">
        {{ m.name }}
      </option>
    </select>
  </div>
  <div
    class="fld resolution-control"
    id="resolutionControl"
    :data-custom="!match"
  >
    <div class="size-head">
      <span class="composer-heading"
        ><AppIcon class="section-ico" name="i-frame" />画幅</span
      >
      <div class="size-meta">
        <span class="size-custom-label" id="customSize" :hidden="!!match"
          >自定义</span
        ><span class="mono" id="pixelMeta">{{
          f.width * f.height
            ? `${((f.width * f.height) / 1e6).toFixed(2)} MP`
            : ""
        }}</span>
      </div>
    </div>
    <div class="seg tiers" id="tiers" role="radiogroup" aria-label="尺寸档位">
      <label
        v-for="(label, key) in { s: '小幅', m: '中幅', l: '大幅' }"
        :key="key"
        :title="sizes(key)[closestShape(f.width, f.height, tier)]?.join(' × ')"
        ><input
          type="radio"
          name="tier"
          :value="key"
          :checked="match?.tier === key"
          @change="setTier(key)"
        /><span>{{ label }}</span></label
      >
    </div>
    <div class="size-orientations" role="radiogroup" aria-label="方向">
      <label
        v-for="(label, key) in {
          portrait: '竖向',
          square: '方形',
          landscape: '横向',
        }"
        :key="key"
        class="size-direction"
        ><input
          type="radio"
          name="orientation"
          :value="key"
          :checked="orientation === key"
          @change="direct(key)"
        /><span class="size-direction-card"
          ><span class="size-direction-glyph" aria-hidden="true"><i></i></span
          ><span class="size-direction-label">{{ label }}</span></span
        ></label
      >
    </div>
    <div class="size-panel">
      <div
        class="size-ratios"
        id="ratios"
        role="radiogroup"
        aria-label="比例"
        :data-muted="orientation === 'square'"
        @keydown="radioKey"
      >
        <button
          v-for="(ratio, index) in ratios"
          :key="ratio"
          class="size-ratio-chip"
          type="button"
          role="radio"
          :aria-checked="match?.shape === ratio"
          :tabindex="
            match?.shape === ratio ||
            (!ratios.includes(match?.shape || '') && index === 0)
              ? 0
              : -1
          "
          :title="sizes(tier)[ratio]?.join(' × ')"
          @click="apply(ratio)"
        >
          {{ ratio }}
        </button>
      </div>
      <div class="size-fields">
        <span class="size-preview" :data-custom="!match" aria-hidden="true"
          ><i id="dimensionShape" :style="dimensions"></i
        ></span>
        <div class="fld-inline">
          <input
            id="width"
            type="number"
            min="64"
            max="2048"
            step="64"
            :value="f.width"
            aria-label="宽"
            @input="change('width', $event)"
            @blur="commit('width')"
            @keydown.enter.prevent="commit('width')"
          /><span>W</span>
        </div>
        <button
          class="ibtn"
          type="button"
          id="swapSize"
          data-tip="互换宽高"
          aria-label="互换宽高"
          :disabled="!f.width || !f.height || f.width === f.height"
          @click="drawing.patch({ width: f.height, height: f.width })"
        >
          <AppIcon name="i-swap" />
        </button>
        <div class="fld-inline">
          <input
            id="height"
            type="number"
            min="64"
            max="2048"
            step="64"
            :value="f.height"
            aria-label="高"
            @input="change('height', $event)"
            @blur="commit('height')"
            @keydown.enter.prevent="commit('height')"
          /><span>H</span>
        </div>
      </div>
    </div>
    <p
      class="hint"
      :class="{ warn: problem.fatal }"
      id="pixelWarn"
      :hidden="!problem.message"
    >
      {{ problem.message }}
    </p>
  </div>
  <details class="drawer" id="advanced">
    <summary>
      <AppIcon class="section-ico" name="i-parameters" /><span>参数</span
      ><span class="badge" :hidden="!badge">{{ badge }}</span
      ><i class="caret" aria-hidden="true"></i>
    </summary>
    <div class="drawer-body">
      <div class="fld">
        <div class="fld-top"><label for="sampler">采样器</label></div>
        <select
          id="sampler"
          :value="f.sampler"
          @change="change('sampler', $event)"
        >
          <option
            v-for="sampler in view.samplers"
            :key="sampler"
            :value="sampler"
          >
            {{ samplerName(sampler) }}
          </option>
        </select>
      </div>
      <div class="scrubs">
        <label
          v-for="control in [
            { key: 'steps' as const, label: '步数', min: 1, max: 50, step: 1 },
            {
              key: 'scale' as const,
              label: 'Scale',
              min: 0,
              max: 20,
              step: 0.5,
            },
            { key: 'cfg' as const, label: 'CFG', min: 0, max: 30, step: 0.5 },
          ]"
          :key="control.key"
          class="scrub scrub-sm"
          :style="{
            '--p':
              ((Number(f[control.key]) - control.min) /
                (control.max - control.min)) *
                100 +
              '%',
          }"
          ><span>{{ control.label }}</span
          ><output :id="`${control.key}Val`">{{ f[control.key] }}</output
          ><input
            :id="control.key"
            type="range"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :value="f[control.key]"
            @input="change(control.key, $event)"
        /></label>
      </div>
      <div class="fld">
        <div class="fld-top"><label for="seed">Seed</label></div>
        <div class="seed">
          <input
            id="seed"
            type="number"
            min="0"
            max="4294967295"
            placeholder="随机"
            :value="f.seed"
            @input="change('seed', $event)"
          /><button
            class="ibtn"
            id="diceBtn"
            type="button"
            data-tip="随机 Seed"
            aria-label="随机 Seed"
            @click="drawing.patch({ seed: String(randomSeed()) })"
          >
            <AppIcon name="i-dice" />
          </button>
        </div>
      </div>
      <div class="fld">
        <div class="fld-top">
          <label for="batchCount">串行批量</label
          ><span class="mono dim">{{
            view.policy.serialUnavailable
              ? view.quotaLoading
                ? "校验中"
                : "额度未知"
              : view.policy.serialDisabled
                ? "仅单张"
                : "1 张起"
          }}</span>
        </div>
        <div class="fld-inline">
          <input
            id="batchCount"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            :value="view.batchCount"
            :disabled="view.policy.serialDisabled"
            aria-describedby="batchHint"
            @input="change('batchCount', $event)"
            @keydown.enter.prevent
          /><span>张</span>
        </div>
        <p
          class="hint"
          id="batchHint"
          :class="{ warn: view.policy.serialDisabled }"
        >
          {{ batchHint }}
        </p>
      </div>
      <div class="switches">
        <label class="check"
          ><input
            id="serverCache"
            type="checkbox"
            :checked="f.serverCache"
            @change="change('serverCache', $event)"
          /><span></span>服务端缓存<i class="sub">占日点数</i></label
        ><label class="check"
          ><input
            id="optimize"
            type="checkbox"
            :checked="f.optimize"
            @change="change('optimize', $event)"
          /><span></span>压缩体积<i class="sub">转 JPEG</i></label
        ><label
          class="check"
          id="transparentBgWrap"
          :data-off="!view.model?.transparentBackground ? '1' : ''"
          :title="
            !view.model?.transparentBackground
              ? '当前模型不支持透明底（仅 V5）'
              : ''
          "
          :aria-disabled="!view.model?.transparentBackground"
          ><input
            id="transparentBg"
            type="checkbox"
            :checked="f.transparentBg"
            :disabled="!view.model?.transparentBackground"
            @change="change('transparentBg', $event)"
          /><span></span>透明底<i class="sub">仅 V5 模型</i></label
        >
      </div>
      <button
        class="btn btn-quiet btn-block btn-sm"
        id="resetAdv"
        type="button"
        @click="reset"
      >
        <AppIcon name="i-reset" />恢复默认
      </button>
    </div>
  </details>
</template>
