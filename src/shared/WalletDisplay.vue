<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { quotaGauge, meterNumber, creditBalance } from "../domain/quota";
import type { QuotaStatus } from "../domain/quota";
import type { CatalogModel } from "../domain/catalog";
import { object } from "../domain/value";
import { profileFor, STANDARD_PROFILE_ID } from "../gateway/profile";
const props = defineProps<{
  quota?: QuotaStatus | null;
  loading?: boolean;
  model?: CatalogModel;
}>();
const gauge = computed(() =>
    quotaGauge(
      props.quota?.image?.remaining,
      props.quota?.image?.limit,
      props.quota?.profile,
    ),
  ),
  credit = computed(() =>
    creditBalance(object(props.quota?.media?.credits).remaining),
  );
const profile = computed(() => profileFor(props.model?.profileId || STANDARD_PROFILE_ID));
const standard = computed(() => !profile.value.protocol || profile.value.protocol === "standard");
const balanceLabel = computed(() => profile.value.protocol === "novelai" ? "Anlas" : "费用未知");
</script>
<template>
  <div
    class="wallet"
    id="meters"
    aria-live="polite"
    :data-loading="loading ? '1' : '0'"
  >
    <div
      v-if="standard"
      class="w-seg w-free"
      :data-level="gauge.level"
      :data-brand="model?.provider"
      :data-tip="`${model?.name || '当前模型'} · 免费图片额度：${meterNumber(gauge.remaining)}；重置 ${quota?.media.resets_at || '未知'}。临时 Key 日请求剩余 ${meterNumber(quota?.temporary?.remaining)}`"
      :style="{ '--gauge': gauge.ratio ?? 0 }"
    >
      <AppIcon class="w-ico" name="i-points" /><span class="w-v"
        ><b>{{ meterNumber(gauge.remaining) }}</b
        ><i>{{
          gauge.limit === null ? "" : `/${meterNumber(gauge.limit)}`
        }}</i></span
      ><span class="w-k sr-only">免费图片</span>
    </div>
    <span v-if="standard" class="w-sep" aria-hidden="true"></span>
    <div
      class="w-seg w-credit"
      :data-level="credit.level"
      :data-tip="standard ? `媒体积分余额：${credit.text}，用于付费生图和图片放大` : profile.protocol === 'novelai' ? `Anlas 余额：${credit.text}；具体费用以服务端计费为准` : '接口不提供预报价与余额查询，费用以供应商计费为准'"
    >
      <AppIcon class="w-ico" name="i-credit" /><span class="w-v"
        ><b>{{ standard || profile.protocol === 'novelai' ? credit.text : '—' }}</b></span
      ><span class="w-k" :class="{ 'sr-only': standard }">{{ standard ? '媒体积分' : balanceLabel }}</span>
    </div>
  </div>
</template>
