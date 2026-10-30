<script setup lang="ts">
defineProps<{ dropping: boolean }>();
</script>
<template>
  <section class="home-welcome" :class="{ 'is-over': dropping }" aria-label="开始创作">
    <svg class="home-welcome-art" viewBox="0 0 64 64" width="80" height="80" aria-hidden="true">
      <g fill="var(--empty-mark-back)">
        <rect x="8" y="8" width="22" height="22" rx="6" />
        <rect x="34" y="8" width="22" height="22" rx="6" />
        <rect x="8" y="34" width="22" height="22" rx="6" />
        <rect x="34" y="34" width="22" height="22" rx="6" />
      </g>
      <rect x="18.75" y="18.75" width="26.5" height="26.5" rx="7.25" fill="var(--empty-mark-front)" stroke="var(--a)" stroke-opacity=".75" stroke-width="1.5" />
    </svg>
    <h2>{{ dropping ? '松手，在 EDIT 中打开' : '这里还空着呢' }}</h2>
    <p>有个想法？快去试试吧<span class="welcome-stop">。</span></p>
  </section>
</template>
<style scoped>
.home-welcome { grid-row: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; width: min(100%, 720px); height: 176px; margin: 0 auto; overflow: hidden; padding: 16px 18px; color: var(--fg-2); text-align: center; background: var(--chrome); border: 1px solid color-mix(in srgb, var(--line-2) 70%, transparent); border-radius: var(--r4); transition: border-color var(--t1) var(--e), background var(--t1) var(--e); }
.home-welcome-art { display: block; flex: none; width: 80px; height: 80px; margin: 0 auto 4px; }
.home-welcome h2 { align-self: stretch; margin: 0; color: var(--fg-2); font-size: 15px; font-weight: var(--fw-medium); line-height: 20px; }
.home-welcome p { align-self: stretch; margin: 0; color: var(--fg-3); font-size: 12px; line-height: 18px; }
.welcome-stop { display: inline-block; inline-size: .5em; text-align: start; }
.home-welcome.is-over { background-color: var(--a-dim); border-color: color-mix(in srgb, var(--a) 60%, transparent); }
.home-welcome.is-over h2 { color: var(--a); }
@media (max-width: 860px) { .home-welcome { height: 160px; padding: 10px 14px; } }
@media (prefers-reduced-motion: reduce) { .home-welcome { transition: none; } }
</style>
