import { finite, object } from "./value.ts";
import { standardProfile } from "../gateway/profile.ts";
import type { GatewayProfile } from "../gateway/profile.ts";

export function normalizeQuota(media: unknown, stats: unknown, temporaryChecked: boolean, quotaGroup?: string) {
  const raw = object(media), pool = object(object(raw.images)[quotaGroup ?? ""]);
  const temp = object(object(stats).temp_limits);
  return { media: raw, quotaGroup, temporaryChecked,
    image: Object.keys(pool).length ? { date: raw.date, period: raw.period,
      used: finite(pool.used), remaining: finite(pool.remaining), limit: finite(pool.limit) } : null,
    temporary: Object.keys(temp).length ? { isTemp: temp.is_temp === true, limited: temp.limited === true,
      used: finite(temp.rpd_used), remaining: finite(temp.rpd_remaining), limit: finite(temp.rpd),
      unitsUsed: finite(temp.rpd_used_units), unitsRemaining: finite(temp.rpd_remaining_units),
      unitsLimit: finite(temp.rpd_units), resetSeconds: finite(temp.reset_seconds) } : null,
  };
}
export type QuotaStatus = ReturnType<typeof normalizeQuota>;
export function quotaPolicy(status: QuotaStatus | null, usesDailyQuota = true, profile: GatewayProfile = standardProfile) {
  const imageUsed = finite(status?.image?.used), tempRemaining = finite(status?.temporary?.remaining);
  const limited = status?.temporary?.isTemp === true && status.temporary.limited !== false;
  const below = usesDailyQuota && limited && tempRemaining !== null && tempRemaining < profile.quotaPolicy.temporaryRemainingThreshold;
  const unavailable = usesDailyQuota && (status?.temporaryChecked !== true || limited && tempRemaining === null);
  return { imageUsed, imageRemaining: finite(status?.image?.remaining), imageLimit: finite(status?.image?.limit),
    tempRemaining, unitsRemaining: finite(status?.temporary?.unitsRemaining), unitsLimit: finite(status?.temporary?.unitsLimit),
    resetSeconds: finite(status?.temporary?.resetSeconds), serialUnavailable: unavailable, serialDisabled: unavailable || below,
    warning: below && imageUsed !== null && imageUsed > profile.quotaPolicy.imageUsedWarningThreshold };
}
export function meterNumber(value: unknown): string {
  const n = finite(value);
  if (n === null) return "—";
  if (n < 10000) return String(Math.round(n));
  const k = n / 1000;
  return `${(k < 100 ? k.toFixed(1) : String(Math.round(k))).replace(/\.0$/, "")}k`;
}
export function quotaGauge(left: unknown, total: unknown, profile: GatewayProfile = standardProfile) {
  const l = finite(left), t = finite(total);
  const ratio = l !== null && t !== null && t > 0 ? Math.max(0, Math.min(1, l / t)) : null;
  return { remaining: l, limit: t, ratio, level: ratio === null ? "unknown" : ratio <= profile.quotaPresentation.criticalRatio ? "crit"
    : ratio <= profile.quotaPresentation.lowRatio ? "low" : "ok" };
}
export function creditBalance(value: unknown) {
  const remaining = finite(value);
  return { remaining, text: remaining === null ? "—" : remaining.toLocaleString("zh-CN", { maximumFractionDigits: 2 }),
    level: remaining === null ? "unknown" : remaining <= 0 ? "crit" : "ok" };
}
