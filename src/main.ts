// Vite eliminates this development branch and its component graph in production.
if (import.meta.env.DEV && location.pathname === "/__ui") {
  await import("./dev/main");
} else {
  await import("./app/bootstrap");
}
export {};
