// Compatibility documents only redirect; they never mount another application.
const routes = { "chat.html": "chat", "tags.html": "tags", "transfer.html": "image/settings/backup" };
const page = location.pathname.split("/").pop();
const target = new URL("./index.html", location.href);
target.search = location.search;
target.hash = `#/${routes[page] || "image"}`;
location.replace(target.href);
