import { createApp } from "vue";
import App from "./App.vue";
import { createApplicationServices } from "../services/application.ts";
import { servicesKey } from "./services.ts";
import { names } from "../storage/names.ts";
import { readRuntime, readTagRuntime } from "../config/runtime.ts";

const services = createApplicationServices({
  local: readRuntime(document),
  tagProxy: readTagRuntime(document),
  storage: localStorage,
  indexedDB,
  locks: navigator.locks,
  events: window,
  channel:
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(names.sync)
      : undefined,
});
// A single shared lease precedes all database initialization, outside KeepAlive.
try {
  await services.start();
} catch {
  console.error("本地数据初始化失败，业务写入已暂停");
}
const app = createApp(App);
app.provide(servicesKey, services);
app.onUnmount(() => {
  void services.dispose();
});
app.mount(document.body);
const leaving = (event: PageTransitionEvent) => {
  if (!event.persisted)
    void services.data
      .export(async () => {})
      .catch(() => {})
      .finally(() => services.dispose());
};
window.addEventListener("pagehide", leaving);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", leaving);
    app.unmount();
  });
