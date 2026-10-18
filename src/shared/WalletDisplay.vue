<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
</script>
<template>
  <!-- Unknown balances stay unknown until a gateway capability supplies them. -->
  <div class="wallet" aria-live="polite">
    <div class="w-seg w-free" data-tip="当前模型免费图片额度">
      <AppIcon class="w-ico" name="i-points" /><span class="w-gauge"
        ><span class="w-v"><b>—</b><i></i></span></span
      ><span class="w-k sr-only">本周免费</span>
    </div>
    <span class="w-sep" aria-hidden="true"></span>
    <div class="w-seg w-credit" data-tip="生图与放大共用的媒体积分余额">
      <AppIcon class="w-ico" name="i-credit" /><span class="w-v"><b>—</b></span
      ><span class="w-k sr-only">媒体积分</span>
    </div>
  </div>
</template>
