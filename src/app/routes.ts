export const workspaces = ["home", "image", "chat", "edit", "tags"] as const;
export type WorkspaceId = (typeof workspaces)[number];
export const settingsSections = [
  "connections",
  "models",
  "general",
  "security",
  "backup",
  "ask",
] as const;
export type SettingsSection = (typeof settingsSections)[number];
export type OverlayId = "settings";
export interface AppRoute {
  workspace: WorkspaceId;
  overlay: OverlayId | null;
  section: SettingsSection;
}
export const workspaceInfo = {
  home: { name: "首页", subtitle: "HOME", description: "继续创作与定稿" },
  image: { name: "绘图", subtitle: "IMAGE", description: "NovelAI 文生图" },
  chat: { name: "对话", subtitle: "CHAT", description: "多模型对话改图" },
  edit: { name: "编辑", subtitle: "EDIT", description: "图生图、重绘与放大" },
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
    workspace: overlay === "editor" ? "edit" : workspaces.includes(workspace as WorkspaceId)
      ? (workspace as WorkspaceId)
      : "home",
    overlay: overlay === "settings" ? overlay : null,
    section: settingsSections.includes(section as SettingsSection)
      ? (section as SettingsSection)
      : "connections",
  };
}
export function routeHash(route: AppRoute): string {
  const panel =
    route.overlay === "settings"
      ? `/settings/${route.section}`
      : "";
  return `#/${route.workspace}${panel}`;
}
