import { createApp } from "vue";
import App from "./app/App.vue";
import "./app/shell.css";
import { createApplicationServices } from "./services/application.ts";
import { servicesKey } from "./app/services.ts";
import { names } from "./storage/names.ts";

const services = createApplicationServices({
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
