<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from "vue";
import AppIcon from "./AppIcon.vue";
import ModelIcon from "./ModelIcon.vue";
import { useServices } from "../app/services";
import { quotaGauge, meterNumber, creditBalance, novelaiUsage } from "../domain/quota";
import type { QuotaStatus } from "../domain/quota";
import type { CatalogModel } from "../domain/catalog";
import { object } from "../domain/value";
import { profileFor, STANDARD_PROFILE_ID } from "../gateway/profile";
const props = defineProps<{
  quota?: QuotaStatus | null;
  loading?: boolean;
  model?: CatalogModel;
}>();
const { connections } = useServices();
const configurationVersion = ref(0);
onBeforeUnmount(connections.subscribe(() => configurationVersion.value++));
const source = computed(() => {
  configurationVersion.value;
  return connections.configuration.connections[props.model?.connection ?? ""]?.name || "当前来源";
});
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
const v5 = computed(() => profile.value.protocol === "novelai" && props.model?.id.startsWith("nai-diffusion-5"));
const usage = computed(() => novelaiUsage(props.quota?.media.subscription));
const usageValue = computed(() => {
  const value = usage.value;
  if (value?.entitlement === "inactive") return "未订阅";
  if (value?.entitlement === "other") return "非 Opus";
  if (value?.unavailable) return "暂不可用";
  return value?.percent === null || !value ? "—" : `${value.percent.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
});
const usageTip = computed(() => `${source.value} · V5 额度：${usageValue.value}。` +
  (usage.value?.purchasedPercent ? `加购额度 ${usage.value.purchasedPercent}%，单独计算。` : "") +
  "张数按官方 23 步、约 1MP 基准估算，100% 约 1,730 张；实际随尺寸、步数和 Effort 变化。");
</script>
<template>
  <div
    class="wallet"
    id="meters"
    aria-live="polite"
    :data-loading="loading ? '1' : '0'"
    :data-connection="model?.connection"
    :aria-label="`${source} · 额度`"
  >
    <div
      v-if="standard"
      class="w-seg w-free"
      :data-level="gauge.level"
      :data-brand="model?.provider"
      :data-tip="`${source} · ${model?.name || '当前模型'} · 免费图片额度：${meterNumber(gauge.remaining)}；重置 ${quota?.media.resets_at || '未知'}。临时 Key 日请求剩余 ${meterNumber(quota?.temporary?.remaining)}`"
      :style="{ '--gauge': gauge.ratio ?? 0 }"
    >
      <ModelIcon class="w-ico" :family="model?.family || model?.provider" /><span class="w-v"
        ><b>{{ meterNumber(gauge.remaining) }}</b
        ><i>{{
          gauge.limit === null ? "" : `/${meterNumber(gauge.limit)}`
        }}</i></span
      ><span class="w-k sr-only">免费图片</span>
    </div>
    <div
      v-else-if="v5"
      class="w-seg w-free w-nai"
      :data-level="usage?.entitlement === 'opus' && usage?.unavailable === false && usage?.percent !== null ? 'ok' : 'unknown'"
      :data-tip="usageTip"
      :style="{ '--gauge': usage?.entitlement === 'opus' ? usage.ratio ?? 0 : 0 }"
    >
      <ModelIcon class="w-ico" family="novelai" />
      <span class="w-v"><b>{{ usageValue }}</b><small v-if="usage?.estimatedImages != null" class="w-estimate">约 {{ meterNumber(usage.estimatedImages) }} 张</small></span>
      <span class="w-k sr-only">V5 额度</span>
    </div>
    <span v-if="standard || v5" class="w-sep" aria-hidden="true"></span>
    <div
      class="w-seg w-credit"
      :data-level="credit.level"
      :data-tip="`${source} · ` + (standard ? `媒体积分余额：${credit.text}，用于付费生图和图片放大` : profile.protocol === 'novelai' ? `Anlas 余额：${credit.text}；具体费用以服务端计费为准` : '接口不提供预报价与余额查询，费用以供应商计费为准')"
    >
      <AppIcon v-if="standard || v5" class="w-ico" name="i-credit" /><ModelIcon v-else class="w-ico" :family="model?.family || model?.provider" /><span class="w-v"
        ><b>{{ standard || profile.protocol === 'novelai' ? credit.text : '—' }}</b></span
      ><span class="w-k" :class="{ 'sr-only': standard || v5 }">{{ standard ? '媒体积分' : balanceLabel }}</span>
    </div>
  </div>
</template>
