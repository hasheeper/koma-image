import { onScopeDispose, watchEffect } from "vue";
import type { AppShell } from "./shell";
import { workspaceInfo } from "./routes";
import type { Ui } from "./ui";

/** Sole owner of document presentation; cached workspaces never write body state. */
export function usePresentation(shell: AppShell, ui: Ui) {
  const body = document.body;
  const imageStyle = document.querySelector<HTMLLinkElement>("#style-image")!;
  const chatStyle = document.querySelector<HTMLLinkElement>("#style-chat")!;
  const tagsStyle = document.querySelector<HTMLLinkElement>("#style-tags")!;
  const icon = document.querySelector<HTMLLinkElement>("#workspaceIcon")!;
  watchEffect(
    () => {
      const { workspace, overlay } = shell.router.route.value;
      imageStyle.media =
        workspace === "image" || workspace === "tags" ? "all" : "not all";
      chatStyle.media = workspace === "chat" ? "all" : "not all";
      tagsStyle.media = workspace === "tags" ? "all" : "not all";
      body.classList.toggle("chat-page", workspace === "chat");
      body.classList.toggle("tags-body", workspace === "tags");
      body.dataset.workspace = workspace;
      body.dataset.picker = ui.pickerOpen.value ? "open" : "closed";
      const attrs: Record<string, string | undefined> = {
        state: workspace === "image" ? shell.image.state : undefined,
        zoom: workspace === "image" && shell.image.zoom ? "on" : undefined,
        import:
          workspace === "image" && shell.image.importing ? "open" : undefined,
        drop: workspace === "image" && shell.image.drop ? "on" : undefined,
        swap: workspace === "image" && shell.image.swap ? "instant" : undefined,
        hist:
          workspace === "image"
            ? shell.image.historyOpen
              ? "on"
              : "off"
            : undefined,
        topbarMenu:
          workspace === "image" && shell.image.menuOpen ? "open" : undefined,
        sidebar:
          workspace === "chat"
            ? shell.chat.sidebarOpen
              ? "open"
              : "closed"
            : undefined,
        rail:
          workspace === "chat" && shell.chat.railCollapsed
            ? "collapsed"
            : undefined,
        context:
          workspace === "chat" && shell.chat.contextOpen ? "open" : undefined,
        tagCart:
          workspace === "tags"
            ? shell.tags.cartOpen
              ? "open"
              : "closed"
            : undefined,
      };
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined) delete body.dataset[key];
        else body.dataset[key] = value;
      }
      document.title = `${overlay === "settings" ? "设置" : workspaceInfo[workspace].name} · Koma Image`;
      icon.href = `${import.meta.env.BASE_URL}assets/favicon-${workspace}.svg`;
    },
    { flush: "sync" },
  );
  onScopeDispose(() => {
    body.classList.remove("chat-page", "tags-body");
    for (const key of [
      "workspace",
      "state",
      "zoom",
      "import",
      "drop",
      "swap",
      "hist",
      "topbarMenu",
      "sidebar",
      "rail",
      "tagCart",
      "context",
      "picker",
    ])
      delete body.dataset[key];
  });
}
