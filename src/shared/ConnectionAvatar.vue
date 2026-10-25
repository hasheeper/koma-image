<script setup lang="ts">
import { computed } from "vue";
import type { Connection } from "../config/connections.ts";
import { connectionIcon } from "../domain/connection-icon.ts";
import AppIcon from "./AppIcon.vue";
import ModelIcon from "./ModelIcon.vue";

const props = defineProps<{ connection?: Pick<Connection, "profileId" | "baseUrl">; compact?: boolean }>();
const mark = computed(() => connectionIcon(props.connection));
</script>
<template>
  <span :class="compact ? 'cm' : 'vtile connection-avatar'" role="img" :aria-label="mark.label">
    <ModelIcon v-if="'family' in mark" :family="mark.family" />
    <AppIcon v-else :name="mark.icon" />
  </span>
</template>
