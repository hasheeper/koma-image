export function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("请配置连接 URL");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("连接 URL 无效");
  }
  if (
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "请使用不含凭据、查询参数和片段的 HTTPS 地址或本机 HTTP 地址",
    );
  return url.href.replace(/\/+$/, "");
}
