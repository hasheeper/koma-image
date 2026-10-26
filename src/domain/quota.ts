import { finite, object } from "./value.ts";
import type { GatewayProfile } from "../gateway/profile.ts";

/** A status keeps the profile of the connection it came from, so thresholds never mix protocols. */
export function normalizeQuota(profile: GatewayProfile, media: unknown, stats: unknown, quotaGroup?: string) {
  const raw = object(media), pool = object(object(raw.images)[quotaGroup ?? ""]);
  const temp = object(object(stats).temp_limits);
  return { profile, media: raw, quotaGroup,
    image: Object.keys(pool).length ? { date: raw.date, period: raw.period,
      used: finite(pool.used), remaining: finite(pool.remaining), limit: finite(pool.limit) } : null,
    temporary: Object.keys(temp).length ? { isTemp: temp.is_temp === true, limited: temp.limited === true,
      used: finite(temp.rpd_used), remaining: finite(temp.rpd_remaining), limit: finite(temp.rpd),
      unitsUsed: finite(temp.rpd_used_units), unitsRemaining: finite(temp.rpd_remaining_units),
      unitsLimit: finite(temp.rpd_units), resetSeconds: finite(temp.reset_seconds) } : null,
  };
}
export type QuotaStatus = ReturnType<typeof normalizeQuota>;
export function meterNumber(value: unknown): string {
  const n = finite(value);
  if (n === null) return "—";
  if (n < 10000) return String(Math.round(n));
  const k = n / 1000;
  return `${(k < 100 ? k.toFixed(1) : String(Math.round(k))).replace(/\.0$/, "")}k`;
}
export function quotaGauge(left: unknown, total: unknown, profile?: GatewayProfile) {
  const l = finite(left), t = finite(total), levels = profile?.quotaPresentation;
  const ratio = l !== null && t !== null && t > 0 ? Math.max(0, Math.min(1, l / t)) : null;
  return { remaining: l, limit: t, ratio, level: ratio === null || !levels ? "unknown" : ratio <= levels.criticalRatio ? "crit"
    : ratio <= levels.lowRatio ? "low" : "ok" };
}
export function creditBalance(value: unknown) {
  const remaining = finite(value);
  return { remaining, text: remaining === null ? "—" : remaining.toLocaleString("zh-CN", { maximumFractionDigits: 2 }),
    level: remaining === null ? "unknown" : remaining <= 0 ? "crit" : "ok" };
}

/** The account's subscription tier by its official name; account.tier 0–3 are Paper, Tablet, Scroll and Opus. */
export function novelaiTier(subscription: unknown) {
  const account = object(subscription);
  if (account.active === false) return "未订阅";
  return account.active === true && typeof account.tier === "number" ? ["Paper", "Tablet", "Scroll", "Opus"][account.tier] ?? null : null;
}

/** Official V5 usage is a separate account meter, never a standard gateway quota guard. */
export function novelaiUsage(subscription: unknown) {
  const account = object(subscription), usage = object(account.usage);
  const entitlement = account.active === false ? "inactive"
    : account.active === true && account.tier === 3 ? "opus"
    : account.active === true && typeof account.tier === "number" && [0, 1, 2].includes(account.tier) ? "other" : "unknown";
  if (!Object.keys(usage).length && entitlement !== "opus") return null;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const percent = number(usage.percent);
  const unavailable = typeof usage.isNegative === "boolean" ? usage.isNegative : null;
  // Official FAQ baseline: 100% ≈ 1,730 images at 23 steps / 1 MP, not a quote for the current draft.
  const estimate = entitlement === "opus" && unavailable === false && percent !== null ? Math.round(percent * 1730 / 100) : null;
  return {
    entitlement, percent, unavailable,
    estimatedImages: estimate !== null && Number.isSafeInteger(estimate) ? estimate : null,
    // Keep the provider's two percentages separate; do not invent a combined allowance.
    purchasedPercent: number(usage.purchasedPercent),
    ratio: percent === null ? undefined : unavailable === true ? 0 : Math.min(1, percent / 100),
  };
}
