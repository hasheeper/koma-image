export const workspaces = ["image", "chat", "tags"] as const;
export type WorkspaceId = (typeof workspaces)[number];
export const settingsSections = [
  "connections",
  "models",
  "security",
  "backup",
] as const;
export type SettingsSection = (typeof settingsSections)[number];
export type OverlayId = "settings" | "editor";
export interface AppRoute {
  workspace: WorkspaceId;
  overlay: OverlayId | null;
  section: SettingsSection;
}
export const workspaceInfo = {
  image: { name: "绘图", subtitle: "IMAGE", description: "NovelAI 文生图" },
  chat: { name: "对话", subtitle: "CHAT", description: "多模型对话改图" },
  tags: {
    name: "词典",
    subtitle: "TAGS",
    description: "Danbooru Tag 中英对照",
  },
} as const;
export function parseRoute(hash: string): AppRoute {
  const [workspace, overlay, section] = hash
    .replace(/^#\/?/, "")
    .split("?", 1)[0]!
    .split("/");
  return {
    workspace: workspaces.includes(workspace as WorkspaceId)
      ? (workspace as WorkspaceId)
      : "image",
    overlay: overlay === "settings" || overlay === "editor" ? overlay : null,
    section: settingsSections.includes(section as SettingsSection)
      ? (section as SettingsSection)
      : "connections",
  };
}
export function routeHash(route: AppRoute): string {
  const panel =
    route.overlay === "settings"
      ? `/settings/${route.section}`
      : route.overlay === "editor"
        ? "/editor"
        : "";
  return `#/${route.workspace}${panel}`;
}
