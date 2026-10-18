<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { quotaGauge, meterNumber, creditBalance } from "../domain/quota";
import type { QuotaStatus } from "../domain/quota";
import type { CatalogModel } from "../domain/catalog";
import { object } from "../domain/value";
const props = defineProps<{
  quota?: QuotaStatus | null;
  loading?: boolean;
  model?: CatalogModel;
}>();
const gauge = computed(() =>
    quotaGauge(props.quota?.image?.remaining, props.quota?.image?.limit),
  ),
  credit = computed(() =>
    creditBalance(object(props.quota?.media?.credits).remaining),
  );
</script>
<template>
  <div
    class="wallet"
    id="meters"
    aria-live="polite"
    :data-loading="loading ? '1' : '0'"
  >
    <div
      class="w-seg w-free"
      :data-level="gauge.level"
      :data-brand="model?.provider"
      :data-tip="`${model?.name || '当前模型'} · 免费图片额度：${meterNumber(gauge.remaining)}；重置 ${quota?.media.resets_at || '未知'}。临时 Key 日请求剩余 ${meterNumber(quota?.temporary?.remaining)}`"
    >
      <AppIcon class="w-ico" name="i-points" /><span
        class="w-gauge"
        :style="{ '--gauge': gauge.ratio ?? 0 }"
        ><span class="w-v"
          ><b>{{ meterNumber(gauge.remaining) }}</b
          ><i>{{
            gauge.limit === null ? "" : `/${meterNumber(gauge.limit)}`
          }}</i></span
        ></span
      ><span class="w-k sr-only">免费图片</span>
    </div>
    <span class="w-sep" aria-hidden="true"></span>
    <div
      class="w-seg w-credit"
      :data-level="credit.level"
      :data-tip="`媒体积分余额：${credit.text}，用于付费生图和图片放大`"
    >
      <AppIcon class="w-ico" name="i-credit" /><span class="w-v"
        ><b>{{ credit.text }}</b></span
      ><span class="w-k sr-only">媒体积分</span>
    </div>
  </div>
</template>
