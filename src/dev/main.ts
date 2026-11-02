import { createApp } from "vue";
import UiPreview from "./UiPreview.vue";
// This entry never creates application services, storage, connections or a task runner.
const app = createApp(UiPreview);
app.mount(document.body);
if (import.meta.hot) import.meta.hot.dispose(() => app.unmount());
