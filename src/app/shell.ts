import { computed, inject, onScopeDispose, reactive, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import type { AppRouter } from "./router";

export function createShell(router: AppRouter) {
  const media = window.matchMedia("(max-width: 860px)");
  const narrow = shallowRef(media.matches);
  const documentVisible = shallowRef(!document.hidden);
  const workspaceVisible = computed(() => documentVisible.value && !router.route.value.overlay);
  const visibility = () => { documentVisible.value = !document.hidden; };
  document.addEventListener('visibilitychange', visibility);
  onScopeDispose(() => document.removeEventListener('visibilitychange', visibility));
  // Only presentation values. Jobs and image resources belong in services.
  const image = reactive({
    historyOpen: true,
    state: "empty",
    zoom: false,
    importing: false,
    drop: false,
    swap: false,
    library: "history" as "history" | "favorites",
  });
  const chat = reactive({
    sidebarOpen: false,
    railCollapsed: false,
    contextOpen: false,
  });
  const tags = reactive({ cartOpen: false });
  function resize() {
    narrow.value = media.matches;
    if (!media.matches) {
      chat.sidebarOpen = false;
      tags.cartOpen = false;
    }
  }
  media.addEventListener("change", resize);
  onScopeDispose(() => media.removeEventListener("change", resize));
  return { router, narrow, workspaceVisible, image, chat, tags };
}
export type AppShell = ReturnType<typeof createShell>;
export const shellKey: InjectionKey<AppShell> = Symbol("app-shell");
export function useShell(): AppShell {
  const shell = inject(shellKey);
  if (!shell) throw new Error("App Shell is not available");
  return shell;
}
