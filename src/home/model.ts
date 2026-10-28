import type { LineId } from "../domain/image-origin.ts";

export const finalLayouts = ["rows", "cols", "mosaic"] as const;
export type FinalLayout = typeof finalLayouts[number];
export interface HomeLocation { workspace: "image" | "chat" | "edit" | "tags"; at: number }
export interface HomePreferences {
  covers: Partial<Record<LineId, string>>;
  layout: FinalLayout | null;
  lastLocation: HomeLocation | null;
}
/** A display cache, deliberately not an ImageRecord or an ASK picture. */
export interface HomePreview {
  boardId: string;
  sourceId: string;
  createdAt: number;
  width: number;
  height: number;
  prompt: string;
  blob: Blob;
}
export function readHomePreferences(value: unknown): HomePreferences {
  const p = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const location = p.lastLocation && typeof p.lastLocation === "object" ? p.lastLocation as Record<string, unknown> : {};
  const covers = p.covers && typeof p.covers === "object" && !Array.isArray(p.covers) ? p.covers : {};
  return { covers: Object.fromEntries(Object.entries(covers).filter(([key, id]) => /^(image|chat):.+/.test(key) && typeof id === "string" && id.length > 0 && id.length < 512)),
    layout: finalLayouts.includes(p.layout as FinalLayout) ? p.layout as FinalLayout : null,
    lastLocation: ["image", "chat", "edit", "tags"].includes(String(location.workspace)) && Number.isFinite(location.at)
      ? { workspace: location.workspace as HomeLocation["workspace"], at: Number(location.at) } : null };
}
export const resolvedLayout = (layout: FinalLayout | null, width: number): FinalLayout => layout ?? (width <= 860 ? "cols" : "rows");
