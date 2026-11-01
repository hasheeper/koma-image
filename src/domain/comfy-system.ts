import { object } from "./value.ts";

export type MemoryStatus = { total: number; free: number; used: number; ratio: number };
export type ComfySystemStatus = {
  version?: string;
  memory?: MemoryStatus;
  devices: { name: string; type: string; index: number; memory?: MemoryStatus }[];
};
function memory(total: unknown, free: unknown): MemoryStatus | undefined {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0 || typeof free !== "number" || !Number.isFinite(free) || free < 0 || free > total) return;
  return { total, free, used: total - free, ratio: (total - free) / total };
}
/** Native system_stats reports memory availability, not CPU/GPU utilization. */
export function parseComfySystem(value: unknown): ComfySystemStatus {
  const raw = object(value), system = object(raw.system);
  if (!raw.system || typeof raw.system !== "object" || Array.isArray(raw.system) || !Array.isArray(raw.devices)) throw new Error("未返回有效的 ComfyUI 系统信息");
  return {
    ...(typeof system.comfyui_version === "string" ? { version: system.comfyui_version.slice(0, 80) } : {}),
    memory: memory(system.ram_total, system.ram_free),
    devices: raw.devices.flatMap((value, i) => {
      const d = object(value);
      if (typeof d.name !== "string" || typeof d.type !== "string") return [];
      return [{ name: d.name.slice(0, 200), type: d.type.slice(0, 40), index: Number.isSafeInteger(d.index) && Number(d.index) >= 0 ? Number(d.index) : i, memory: memory(d.vram_total, d.vram_free) }];
    }),
  };
}
export const memoryPercent = (value?: MemoryStatus) => value ? `${Math.round(value.ratio * 100)}%` : "—";
export const memoryGiB = (bytes: number) => (bytes / 1024 ** 3).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export const memoryLabel = (value?: MemoryStatus) => value ? `${memoryGiB(value.used)} / ${memoryGiB(value.total)} GiB` : "未提供";
