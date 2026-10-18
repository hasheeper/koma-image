import { onScopeDispose, readonly, shallowRef } from "vue";
import { parseRoute, routeHash } from "./routes";
import type {
  AppRoute,
  OverlayId,
  SettingsSection,
  WorkspaceId,
} from "./routes";

export function createRouter() {
  const route = shallowRef(parseRoute(location.hash));
  const previousScrollRestoration = history.scrollRestoration;
  history.scrollRestoration = "manual";
  const beforeChange = new Set<(previous: AppRoute, next: AppRoute) => void>();
  const guards = new Set<(previous: AppRoute, next: AppRoute) => boolean>();
  const allowed = (next: AppRoute) =>
    [...guards].every((guard) => guard(route.value, next));
  function readLocation() {
    const next = parseRoute(location.hash);
    if (routeHash(next) === routeHash(route.value)) return;
    if (!allowed(next)) {
      const url = new URL(location.href);
      url.hash = routeHash(route.value);
      history.replaceState(null, "", url);
      return;
    }
    for (const capture of beforeChange) capture(route.value, next);
    route.value = next;
  }
  // Query tickets are preserved for explicit workspace consumption, never redeemed here.
  function navigate(next: AppRoute, replace = false, overlayEntry = false) {
    if (!allowed(next)) return;
    const url = new URL(location.href);
    url.hash = routeHash(next);
    if (url.href === location.href) return;
    const state = overlayEntry ? { komaOverlay: true } : null;
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
    readLocation();
  }
  const switchWorkspace = (workspace: WorkspaceId) =>
    navigate({ ...route.value, workspace, overlay: null });
  const openOverlay = (
    overlay: OverlayId,
    section: SettingsSection = "connections",
  ) =>
    navigate(
      { ...route.value, overlay, section },
      Boolean(route.value.overlay),
      !route.value.overlay || history.state?.komaOverlay === true,
    );
  const selectSection = (section: SettingsSection) =>
    navigate(
      { ...route.value, overlay: "settings", section },
      true,
      history.state?.komaOverlay === true,
    );
  const closeOverlay = () => {
    // Return to the entry that opened the dialog; do not leave a duplicate workspace step.
    // A directly loaded overlay has no in-app predecessor, so replace only that URL.
    if (history.state?.komaOverlay === true) history.back();
    else navigate({ ...route.value, overlay: null }, true);
  };
  window.addEventListener("popstate", readLocation);
  window.addEventListener("hashchange", readLocation);
  if (!location.hash) navigate(route.value, true);
  onScopeDispose(() => {
    window.removeEventListener("popstate", readLocation);
    window.removeEventListener("hashchange", readLocation);
    history.scrollRestoration = previousScrollRestoration;
  });
  return {
    route: readonly(route),
    switchWorkspace,
    openOverlay,
    selectSection,
    closeOverlay,
    guard(callback: (previous: AppRoute, next: AppRoute) => boolean) {
      guards.add(callback);
      return () => guards.delete(callback);
    },
    beforeChange(callback: (previous: AppRoute, next: AppRoute) => void) {
      beforeChange.add(callback);
      return () => beforeChange.delete(callback);
    },
  };
}
export type AppRouter = ReturnType<typeof createRouter>;
