import type { Connection } from "../config/connections.ts";
import { profileFor } from "../gateway/profile.ts";

type ConnectionIcon = { family: "novelai" | "gemini" | "openai"; label: string }
  | { icon: "i-chat" | "i-image" | "i-swap"; label: string };

/** Presentation only: hostname matching never selects a protocol or changes request routing. */
function officialIcon(baseUrl: string): ConnectionIcon | undefined {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return;
  const host = url.hostname.replace(/\.$/, "");
  if (host === "generativelanguage.googleapis.com") return { family: "gemini", label: "Google AI Studio" };
  if (host === "aiplatform.googleapis.com" || /^[a-z0-9-]+-aiplatform\.googleapis\.com$/.test(host)
    || host.endsWith(".prediction.vertexai.goog")) return { family: "gemini", label: "Google Cloud Vertex AI" };
  if (host === "api.openai.com") return { family: "openai", label: "OpenAI 官方" };
  if (/^[a-z0-9-]+\.openai\.azure\.com$/.test(host)
    || /^[a-z0-9-]+\.services\.ai\.azure\.com$/.test(host) && /^\/openai(?:\/|$)/.test(url.pathname))
    return { family: "openai", label: "Azure OpenAI" };
}

export function connectionIcon(connection?: Pick<Connection, "profileId" | "baseUrl">): ConnectionIcon {
  if (!connection) return { icon: "i-swap", label: "连接" };
  const profile = profileFor(connection.profileId);
  if (profile.protocol === "novelai") return { family: "novelai", label: "NovelAI 官方" };
  return officialIcon(connection.baseUrl) ?? (profile.reasoning
    ? { icon: "i-chat", label: "文本连接" } : { icon: "i-image", label: "生图连接" });
}
