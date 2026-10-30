import { inject, onScopeDispose, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import { names } from "../storage/names";
import type { ApplicationServices } from "../services/application";

export type ThemeChoice = "system" | "light" | "dark";
export const themeChoices = {
  dark: { label: "暗色", icon: "i-moon" },
  system: { label: "系统", icon: "i-monitor" },
  light: { label: "亮色", icon: "i-sun" },
} satisfies Record<ThemeChoice, { label: string; icon: string }>;
export const readTheme = (value: unknown): ThemeChoice =>
  value === "light" || value === "system" ? value : "dark";

/** index.html applies the saved choice before first paint; this keeps <html data-theme> in step afterwards. */
export function createTheme(preferences: ApplicationServices["preferences"]) {
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: light)");
  const choice = shallowRef(readTheme(preferences.get(names.theme, null)));
  function apply() {
    const theme = choice.value === "system" ? (media.matches ? "light" : "dark") : choice.value;
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
  }
  // Another tab or a data reload changed the stored choice.
  function sync() {
    choice.value = readTheme(preferences.get(names.theme, null));
    apply();
  }
  apply();
  media.addEventListener("change", apply);
  const unsubscribe = preferences.subscribe((key) => {
    if (!key || key === names.theme) sync();
  });
  onScopeDispose(() => {
    media.removeEventListener("change", apply);
    unsubscribe();
  });
  return {
    choice,
    async set(next: ThemeChoice) {
      choice.value = next;
      apply();
      try {
        await preferences.set(names.theme, next);
      } catch (error) {
        sync();
        throw error;
      }
    },
  };
}
export type Theme = ReturnType<typeof createTheme>;
export const themeKey: InjectionKey<Theme> = Symbol("theme");
export function useTheme(): Theme {
  const theme = inject(themeKey);
  if (!theme) throw new Error("Theme unavailable");
  return theme;
}
