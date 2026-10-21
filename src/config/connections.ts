import { object } from "../domain/value.ts";
import { profileFor, NOVELAI_IMAGE_URL } from "../gateway/profile.ts";

export interface Connection {
  id: string;
  name: string;
  baseUrl: string;
  profileId: string;
  credentialRef: string;
  revision: string;
}
export interface ModelLink {
  id: string;
  manual: boolean;
  on: boolean;
}
export interface Routing {
  version: 1;
  connections: Record<string, Connection>;
  links: Record<string, Record<string, ModelLink>>;
}
export const emptyRouting = (): Routing => ({
  version: 1,
  connections: {},
  links: {},
});
export const LOCAL_CONNECTION_ID = "local-gateway";
export function validateModelLinks(value: unknown): Record<string, ModelLink> {
  const links: Record<string, ModelLink> = {};
  for (const [model, raw] of Object.entries(object(value))) {
    const link = object(raw);
    if (
      !validId(model) ||
      typeof link.id !== "string" ||
      !link.id.trim() ||
      link.id.length > 512
    )
      throw new Error("模型来源配置无效");
    links[model] = {
      id: link.id,
      manual: link.manual === true,
      on: link.on !== false,
    };
  }
  return links;
}

export function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value) &&
    !["constructor", "prototype", "__proto__"].includes(value)
  );
}
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
/** Only non-secret configuration is accepted; unknown fields never persist. */
export function validateRouting(value: unknown): Routing {
  const input = object(value);
  if (
    input.version !== 1 ||
    !input.connections ||
    typeof input.connections !== "object" ||
    Array.isArray(input.connections)
  )
    throw new Error("连接配置格式无效");
  const out = emptyRouting();
  for (const [id, raw] of Object.entries(object(input.connections))) {
    const c = object(raw);
    if (
      !validId(id) ||
      c.id !== id ||
      !validId(c.credentialRef) ||
      !validId(c.revision) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 128 ||
      typeof c.profileId !== "string"
    )
      throw new Error("连接配置格式无效");
    const profile = profileFor(c.profileId);
    const baseUrl = normalizeBaseUrl(c.baseUrl);
    if (profile.protocol === "novelai" && baseUrl !== NOVELAI_IMAGE_URL)
      throw new Error("NovelAI 官方连接使用固定的图片与账户地址");
    out.connections[id] = {
      id,
      name: c.name.trim(),
      baseUrl,
      credentialRef: c.credentialRef,
      profileId: c.profileId,
      revision: c.revision,
    };
  }
  for (const [id, raw] of Object.entries(object(input.links))) {
    if (!Object.hasOwn(out.connections, id)) continue;
    out.links[id] = validateModelLinks(raw);
  }
  return out;
}
/** Image catalogs, quotes and generation only use connections whose protocol declares image work. */
export const imageConnections = (routing: Readonly<Routing>): Connection[] =>
  Object.values(routing.connections).filter(c => profileFor(c.profileId).image);
/** ASK only lists connections whose protocol declares reasoning. */
export const reasoningConnections = (routing: Readonly<Routing>): Connection[] =>
  Object.values(routing.connections).filter(c => !!profileFor(c.profileId).reasoning);
