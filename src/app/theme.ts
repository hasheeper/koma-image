import { inject, onScopeDispose, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import { names } from "../storage/names";
import type { ApplicationServices } from "../services/application";

export type ThemeChoice = "light" | "dark";
export const themeChoices = {
  dark: { label: "暗色", icon: "i-moon" },
  light: { label: "亮色", icon: "i-sun" },
} satisfies Record<ThemeChoice, { label: string; icon: string }>;
export const readTheme = (value: unknown): ThemeChoice =>
  value === "light" ? "light" : "dark";

/** index.html applies the saved choice before first paint; this keeps <html data-theme> in step afterwards. */
export function createTheme(preferences: ApplicationServices["preferences"]) {
  const root = document.documentElement;
  const choice = shallowRef(readTheme(preferences.get(names.theme, null)));
  function apply() {
    if (root.dataset.theme !== choice.value) root.dataset.theme = choice.value;
  }
  // Another tab or a data reload changed the stored choice.
  function sync() {
    choice.value = readTheme(preferences.get(names.theme, null));
    apply();
  }
  apply();
  const unsubscribe = preferences.subscribe((key) => {
    if (!key || key === names.theme) sync();
  });
  onScopeDispose(unsubscribe);
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
