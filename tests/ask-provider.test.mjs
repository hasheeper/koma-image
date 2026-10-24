import test from "node:test";
import assert from "node:assert/strict";
import { createConnections } from "../src/services/connections.ts";
import { createGateway } from "../src/gateway/client.ts";
import { endpoint } from "../src/gateway/transport.ts";
import { testConnection } from "../src/gateway/connection-test.ts";
import { anthropicMessagesProfile as anthropic, openaiChatProfile as chat, standardProfile, connectionProfiles, profileFor, ANTHROPIC_VERSION } from "../src/gateway/profile.ts";
import { imageConnections, reasoningConnections } from "../src/config/connections.ts";
import { createProvider, wireBody, ProviderError } from "../src/ask/provider.ts";
import { createCodec } from "../src/ask/codec.ts";
import { MODEL_LIMIT, modelId, readAskSettings, withConnection, withModel, withModels } from "../src/ask/settings.ts";
import { createTools } from "../src/ask/tools.ts";
import { familyOf } from "../src/ask/model-family.ts";

const encoder = new TextEncoder();
const stream = (chunks, { status = 200, type = "text/event-stream", hold = false, onCancel } = {}) =>
  new Response(new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
      if (!hold) c.close();
    },
    cancel: () => onCancel?.(),
  }), { status, headers: { "content-type": type } });
const sse = (...events) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`);
const named = (...events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
async function setup(profile, fetcher, baseUrl = "https://gateway.example.test/v1") {
  const store = new Map(), connections = createConnections({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, (work) => work());
  await connections.save({ version: 1, connections: { ask: { id: "ask", name: "推理", baseUrl, profileId: profile.id, credentialRef: "key-ask", revision: "r1" } }, links: {} });
  connections.supplyKey("key-ask", "synthetic-reasoning-key");
  const context = connections.context("ask");
  return { context, provider: createProvider(context, fetcher, { idleMs: 200 }) };
}
async function collect(iterable) {
  const out = [];
  for await (const event of iterable) out.push(event);
  return out;
}
const tools = [
  { name: "get_state", description: "读取当前工作台", schema: { type: "object", properties: { scope: { type: "string" }, depth: { type: "number" } } } },
  { name: "propose_draft", description: "提出草稿", schema: { properties: { steps: { type: "array" } }, type: "object" } },
];
const system = ["L0 宪章 · L1 工作区 · L2 全模型知识包", "<user_preferences>先说结论</user_preferences>"];
const user = (state, text) => ({ role: "user", content: [{ type: "text", text: `<workspace_state>${state}</workspace_state>\n${text}` }] });
const turn1 = { model: "reasoning-model", tools, system, maxTokens: 2048, messages: [user('{"seed":1}', "为什么脸糊了？")] };
const step = [
  { role: "assistant", content: [{ type: "text", text: "先读一下。" }, { type: "call", id: "call_1", name: "get_state", input: { scope: "form", depth: 1 } }] },
  { role: "user", content: [{ type: "result", id: "call_1", content: [{ type: "text", text: '{"steps":28}' }, { type: "image", mime: "image/png", data: "AAAA" }] }] },
];
const turn2 = (state) => ({ ...turn1, messages: [...turn1.messages, ...step, { role: "assistant", content: [{ type: "text", text: "步数偏低。" }] }, user(state, "改成 32 呢？")] });

test("ASK prose completion: both protocols disable new tools while retaining declarations and answered calls", () => {
  const request = { ...turn1, messages: [...turn1.messages, ...step], toolChoice: "none" };
  const oai = wireBody(chat, request), claude = wireBody(anthropic, request);
  assert.equal(oai.tool_choice, "none");
  assert.deepEqual(claude.tool_choice, { type: "none" });
  assert.equal(oai.tools.length, tools.length);
  assert.equal(claude.tools.length, tools.length);
  assert.ok(oai.messages.some(m => m.role === "tool" && m.tool_call_id === "call_1"));
  assert.ok(claude.messages.some(m => m.content.some(b => b.type === "tool_result" && b.tool_use_id === "call_1")));
});

test("ASK model IDs: preserve internal spaces, case and relay suffixes through settings and both wire formats", () => {
  for (const id of ["Claude Sonnet 4.5 (Thinking)", "claude-opus-4-6 [1M]", "vendor/Claude  Opus:thinking-预算", "gemini-4"]) {
    const settings = readAskSettings({ model: `  ${id}  ` });
    assert.equal(settings.model, id);
    assert.equal(readAskSettings(JSON.parse(JSON.stringify(settings))).model, id);
    for (const profile of [chat, anthropic])
      assert.equal(wireBody(profile, { ...turn1, model: settings.model }).model, id);
  }
  for (const id of ["bad\nmodel", "bad\tmodel", "bad\u0000model", "bad\u007fmodel", "bad\u2028model", "bad\u2029model", "m".repeat(201)])
    assert.equal(modelId(id), "");
  assert.equal(modelId("   "), "");
  assert.equal(modelId("m".repeat(200)), "m".repeat(200));
});

test("ASK model picks: kept per connection, a single older ID joins its list, the active ID stays among the picks", () => {
  assert.deepEqual(readAskSettings({ connectionId: "chat", model: "a" }).models, { chat: ["a"] });
  const s = readAskSettings({ connectionId: "chat", model: "", models: { chat: [" b ", "b", "bad\nid", 5, "c"], claude: ["x"], "": ["y"], other: "z" } });
  assert.deepEqual(s.models, { chat: ["b", "c"], claude: ["x"] });
  assert.equal(s.model, "b");
  assert.deepEqual(readAskSettings(JSON.parse(JSON.stringify(s))), s);
  assert.equal(readAskSettings({ models: { chat: Array.from({ length: 30 }, (_, i) => `m${i}`) } }).models.chat.length, MODEL_LIMIT);
  // Dropping the active ID moves to the first remaining; other connections keep theirs.
  assert.equal(withModels({ ...s, model: "c" }, "chat", ["b"]).model, "b");
  assert.deepEqual(withModels(s, "chat", []).models, { claude: ["x"] });
  assert.equal(withModels(s, "chat", []).model, "");
  assert.equal(withModels(s, "claude", ["x", "w"]).model, "b");
  // Switching connection resumes its first pick; another connection's pick switches both.
  assert.deepEqual([withConnection(s, "claude").connectionId, withConnection(s, "claude").model], ["claude", "x"]);
  assert.equal(withConnection(s, "none").model, "");
  const used = withModel(s, "claude", "x");
  assert.deepEqual([used.connectionId, used.model], ["claude", "x"]);
  assert.equal(withModel(s, "claude", "nope"), s);
});

test("ASK model list headings: the model names its family, a trailing [provider] does not", () => {
  const cases = {
    "chat-latest": "gpt", "gpt-5-chat-latest": "gpt", "openrouter/openai/o3": "gpt", "deepseek-chat-latest": "deepseek",
    "GLM-5.1 [zai]": "glm", "GLM-5.2 [togetherai]": "glm", "GLM-5.3-flash [zai]": "glm",
    "kimi-k2.6 [moonshot]": "kimi", "Kimi-K2.7-Code [togetherai]": "kimi", "kimi-k3 [fireworks]": "kimi",
    "MiniMax-M3 [minimax]": "minimax", "Claude Sonnet 4.5 (Thinking)": "claude", "grok-4 [xai]": "xai",
    "llama-4 [openai]": "other", "reasoning-a": "other",
  };
  for (const [id, family] of Object.entries(cases)) assert.equal(familyOf(id), family, id);
});

test("ASK tool schemas: full registry avoids uniqueItems rejected by Gemini relays, including nested draft variants", () => {
  const request = { ...turn1, tools: [...createTools().values()].map((entry) => entry.tool) };
  for (const profile of [chat, anthropic]) {
    const payload = wireBody(profile, request);
    const definitions = payload.tools.map((t) => t.function ?? { ...t, parameters: t.input_schema });
    assert.equal(definitions.length, 11);
    assert.doesNotMatch(JSON.stringify(definitions), /"uniqueItems"\s*:/);
    const sheet = definitions.find((t) => t.name === "view_sheet").parameters;
    assert.equal(sheet.properties.ids.minItems, 2);
    assert.equal(sheet.properties.ids.maxItems, 6);
    const draft = definitions.find((t) => t.name === "propose_draft").parameters;
    assert.equal(draft.properties.steps.items.anyOf.length, 4);
    assert.equal(draft.properties.steps.items.anyOf[1].properties.fields.minItems, 1);
    assert.deepEqual(draft.required, ["base_hash", "draft_title", "steps"]);
    assert.equal(JSON.stringify(wireBody(profile, request)), JSON.stringify(payload));
  }
});

test("ASK tool schemas: required properties survive a relay recursively stripping title metadata", () => {
  // Reproduce the reported required[1] mismatch when a relay treats every
  // `title` key as schema metadata, even inside the properties dictionary.
  const stripTitles = (value) => Array.isArray(value) ? value.map(stripTitles)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "title").map(([key, item]) => [key, stripTitles(item)]))
      : value;
  function validate(schema, path) {
    for (const [index, name] of (schema.required ?? []).entries())
      assert.ok(Object.hasOwn(schema.properties ?? {}, name), `${path}.required[${index}]: property is not defined (${name})`);
    if (schema.enum) assert.equal(schema.type, "string", `${path}: enum needs a string type`);
    assert.equal("const" in schema, false, `${path}: use a typed singleton enum`);
    for (const [name, value] of Object.entries(schema.properties ?? {})) validate(value, `${path}.${name}`);
    if (schema.items) validate(schema.items, `${path}.items`);
    for (const [index, value] of (schema.anyOf ?? []).entries()) validate(value, `${path}.anyOf[${index}]`);
  }
  const payload = wireBody(chat, { ...turn1, tools: [...createTools().values()].map((entry) => entry.tool) });
  for (const tool of payload.tools) validate(stripTitles(tool.function.parameters), tool.function.name);
});

test("reasoning profiles: registry, address rules, auth headers and capability filters", async () => {
  assert.deepEqual(connectionProfiles.filter((p) => p.reasoning).map((p) => p.id), ["openai-chat-v1", "anthropic-messages-v1"]);
  for (const p of [chat, anthropic]) {
    assert.equal(profileFor(p.id), p);
    assert.equal(p.image, false);
    assert.equal(p.quotaPolicy.supported, false);
    assert.equal(p.quote.supported, false);
    assert.equal(p.costCeiling, undefined);
    assert.deepEqual(Object.keys(p.transport.paths).sort(), ["catalog", "reasoning"]);
  }
  assert.ok(connectionProfiles.filter((p) => !p.reasoning).every((p) => p.image));
  // OpenAI-compatible: the version path is part of the address; a bare root gets /v1.
  assert.equal(endpoint("https://api.example.test", "/chat/completions", chat).href, "https://api.example.test/v1/chat/completions");
  assert.equal(endpoint("https://api.example.test/v1", "/chat/completions", chat).href, "https://api.example.test/v1/chat/completions");
  assert.equal(endpoint("https://gl.example.test/v1beta/openai", "/chat/completions", chat).href, "https://gl.example.test/v1beta/openai/chat/completions");
  assert.equal(endpoint("https://relay.example.test/api/v1", "/models", chat).href, "https://relay.example.test/api/v1/models");
  // Anthropic: /v1 is added once, whether or not the address already ends with it.
  assert.equal(endpoint("https://api.example.test", "/messages", anthropic).href, "https://api.example.test/v1/messages");
  assert.equal(endpoint("https://api.example.test/v1", "/messages", anthropic).href, "https://api.example.test/v1/messages");
  assert.equal(endpoint("https://relay.example.test/anthropic", "/messages", anthropic).href, "https://relay.example.test/anthropic/v1/messages");
  assert.equal(endpoint("https://api.example.test", "/models", anthropic).href, "https://api.example.test/v1/models?limit=1000");
  const routing = { version: 1, links: {}, connections: Object.fromEntries(connectionProfiles.map((p) => [p.id, { id: p.id, name: p.label, baseUrl: "https://x.example.test", profileId: p.id, credentialRef: p.id, revision: "r" }])) };
  assert.deepEqual(reasoningConnections(routing).map((c) => c.id), [chat.id, anthropic.id]);
  assert.equal(imageConnections(routing).some((c) => c.id === chat.id || c.id === anthropic.id), false);
  const requests = [],
    models = async (url, init) => {
      requests.push({ url: String(url), headers: init.headers });
      return Response.json({ data: [{ id: "model-b", display_name: "Model B", type: "model" }, { id: "model-a" }], has_more: false });
    };
  const { context } = await setup(anthropic, models, "https://relay.example.test/anthropic");
  const result = await testConnection(context, models);
  assert.equal(result.s, "ok");
  assert.match(result.text, /2 个模型 ID · 推理尚未实测/);
  assert.equal(requests[0].url, "https://relay.example.test/anthropic/v1/models?limit=1000");
  assert.equal(requests[0].headers["x-api-key"], "synthetic-reasoning-key");
  assert.equal(requests[0].headers["anthropic-version"], ANTHROPIC_VERSION);
  assert.equal(requests[0].headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(requests[0].headers.Authorization, undefined);
  const raw = await createGateway(context, models).rawCatalog();
  assert.deepEqual(Object.keys(raw.models).sort(), ["model-a", "model-b"]);
  assert.equal(raw.models["model-b"].editor_family, undefined);
});

test("openai-chat payload: fixed key order, stable static prefix and state only at the tail", () => {
  const first = JSON.stringify(wireBody(chat, turn1)), second = JSON.stringify(wireBody(chat, turn2('{"seed":2}')));
  // Consecutive turns share every byte up to the new messages.
  assert.ok(second.startsWith(`${first.slice(0, -2)},`));
  assert.deepEqual(Object.keys(JSON.parse(first)), ["model", "stream", "stream_options", "tools", "messages"]);
  // Schemas serialize with sorted keys whatever order they were written in.
  assert.ok(first.includes('"parameters":{"properties":{"depth":{"type":"number"},"scope":{"type":"string"}},"type":"object"}'));
  assert.ok(first.includes('"parameters":{"properties":{"steps":{"type":"array"}},"type":"object"}'));
  // A form change between turns only touches the current message.
  const a = JSON.stringify(wireBody(chat, turn2('{"seed":2}'))), b = JSON.stringify(wireBody(chat, turn2('{"seed":3}')));
  let same = 0;
  while (a[same] === b[same]) same++;
  assert.ok(same > a.lastIndexOf("<workspace_state>"));
  const body = JSON.parse(a);
  assert.deepEqual(body.messages.map((m) => m.role), ["system", "user", "assistant", "tool", "user", "assistant", "user"]);
  assert.equal(body.messages[0].content, system.join("\n\n"));
  assert.equal(body.messages[2].tool_calls[0].function.arguments, '{"depth":1,"scope":"form"}');
  assert.equal(body.messages[3].tool_call_id, "call_1");
  assert.equal(body.messages[4].content[1].image_url.url, "data:image/png;base64,AAAA");
  assert.equal("max_tokens" in body || "max_completion_tokens" in body, false);
  for (const text of [a, first]) assert.equal(/\d{10,}|Date|random/i.test(text), false);
});

test("anthropic payload: breakpoints on the last tool, the last system block and the newest block only", () => {
  const first = wireBody(anthropic, turn1), second = wireBody(anthropic, turn2('{"seed":2}'));
  assert.deepEqual(Object.keys(first), ["model", "max_tokens", "stream", "tools", "system", "messages"]);
  assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools));
  assert.equal(JSON.stringify(first.system), JSON.stringify(second.system));
  assert.deepEqual(first.tools.map((t) => !!t.cache_control), [false, true]);
  assert.deepEqual(first.system.map((s) => !!s.cache_control), [false, true]);
  const marks = JSON.stringify(second).match(/cache_control/g).length;
  assert.equal(marks, 3);
  assert.deepEqual(second.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" });
  assert.equal(JSON.stringify(second.messages.slice(0, -1)).includes("cache_control"), false);
  // History blocks keep their bytes from one turn to the next once unmarked.
  const unmarked = (m) => JSON.stringify({ ...m, content: m.content.map(({ cache_control, ...rest }) => rest) });
  assert.equal(unmarked(first.messages[0]), unmarked(second.messages[0]));
  const result = second.messages[2].content[0];
  assert.deepEqual(Object.keys(result), ["type", "tool_use_id", "content"]);
  assert.deepEqual(result.content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  assert.deepEqual(second.messages[1].content[1], { type: "tool_use", id: "call_1", name: "get_state", input: { depth: 1, scope: "form" } });
  // Results lead the user message and empty text blocks are dropped.
  const mixed = wireBody(anthropic, { ...turn1, messages: [{ role: "user", content: [{ type: "text", text: "" }, { type: "text", text: "看图" }, { type: "result", id: "c", content: [] }] }] });
  assert.deepEqual(mixed.messages[0].content.map((b) => b.type), ["tool_result", "text"]);
  // Without preferences or a codebook only one system block is sent, still marked.
  assert.equal(wireBody(anthropic, { ...turn1, system: [system[0], ""] }).system.length, 1);
});

test("codec at the edge: outbound strings encoded with the codebook last; inbound text and calls decoded", async () => {
  const codec = createCodec(["nsfw", "large breasts"]);
  const request = { ...turn1, messages: [user('{"prompt":"1girl, nsfw, large breasts"}', "NSFW 标签会不会冲突？")] };
  const encoded = wireBody(chat, request, codec), text = JSON.stringify(encoded.messages.slice(1));
  assert.equal(/nsfw|large breasts/i.test(text), false);
  assert.ok(encoded.messages[0].content.endsWith("</codebook>"));
  assert.ok(encoded.messages[0].content.indexOf("<user_preferences>") < encoded.messages[0].content.indexOf("<codebook>"));
  assert.equal(JSON.stringify(wireBody(chat, request, codec)), JSON.stringify(encoded));
  assert.equal(JSON.stringify(wireBody(chat, request)).includes("codebook"), false);
  const nsfw = codec.encode("nsfw"), split = Math.ceil(nsfw.length / 2);
  const { provider } = await setup(chat, async () => stream([
    ...sse({ choices: [{ delta: { content: `去掉 ${nsfw.slice(0, split)}` } }] }),
    ...sse({ choices: [{ delta: { content: `${nsfw.slice(split)} 即可` } }] }),
    ...sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "propose_draft", arguments: JSON.stringify({ remove: codec.encode("large breasts") }) } }] }, finish_reason: "tool_calls" }] }),
    ...sse("[DONE]"),
  ]));
  const events = await collect(provider.stream(request, { codec }));
  assert.equal(events.filter((e) => e.type === "text").map((e) => e.text).join(""), "去掉 nsfw 即可");
  assert.deepEqual(events.find((e) => e.type === "call").call.input, { remove: "large breasts" });
});

for (const profile of [chat, anthropic]) test(`text replacements at the edge: ${profile.id} sends B and restores streamed prose and draft fields to A`, async () => {
  const codec = createCodec([], [{ from: "red coat", to: "azure dress" }]),
    request = { ...turn1, model: "red coat", messages: [user('{"prompt":"red coat"}', "保留 red coat")] };
  const input = { target: "image.prompt", anchor: "azure dress", text: "azure dress, soft light" };
  let sent;
  const { provider } = await setup(profile, async (_url, init) => {
    sent = init.body;
    return stream(profile === chat ? [
      ...sse({ choices: [{ delta: { content: "保留 azure dr" } }] }),
      ...sse({ choices: [{ delta: { content: "ess。" } }] }),
      ...sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "draft", function: { name: "propose_draft", arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] }),
      ...sse("[DONE]"),
    ] : named(
      { type: "message_start", message: { usage: { input_tokens: 100 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "保留 azure dr" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ess。" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "draft", name: "propose_draft", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ));
  });
  const events = await collect(provider.stream(request, { codec })), body = JSON.parse(sent);
  assert.equal(body.model, "red coat", "model IDs are not replaced");
  const userMessage = body.messages.find((m) => m.role === "user");
  assert.match(JSON.stringify(userMessage), /保留 azure dress/);
  assert.equal(JSON.stringify(userMessage).includes("red coat"), false);
  assert.deepEqual(body, wireBody(profile, request, codec));
  assert.equal(events.filter((e) => e.type === "text").map((e) => e.text).join(""), "保留 red coat。");
  assert.deepEqual(events.find((e) => e.type === "call").call.input, { target: "image.prompt", anchor: "red coat", text: "red coat, soft light" });
});

test("openai-chat stream: text, tool-call deltas and the common relay variants", async () => {
  const requests = [];
  const variants = {
    standard: [
      ...sse({ choices: [{ delta: { role: "assistant", content: "" } }] }),
      ...sse({ choices: [{ delta: { content: "先" } }] }),
      ...sse({ choices: [{ delta: { content: "看状态" } }] }),
      ...sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "get_state", arguments: "" } }] } }] }),
      ...sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"sco' } }] } }] }),
      ...sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'pe":"form"}' } }] } }] }),
      ...sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ...sse({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1024 } } }),
      ...sse("[DONE]"),
    ],
    // No index, the id and full name repeated, parsed arguments, CRLF lines split mid-event, no [DONE].
    relay: [
      'data: {"choices":[{"delta":{"content":"先看状态"}}]}\r\n\r',
      '\ndata: {"choices":[{"delta":{"tool_calls":[{"id":"call_a","function":{"name":"get_state","arguments":{"scope":"form"}}}]}}]}\r\n',
      '\r\n: keep-alive\r\n\r\ndata: {"choices":[{"delta":{"tool_calls":[{"id":"call_a","function":{"name":"get_state"}}]},"finish_reason":"stop"}],"usage":{"prompt_tokens":1200,"completion_tokens":30,"prompt_cache_hit_tokens":1024}}',
    ],
    // Fragments without index or id continue the latest call.
    fragments: [
      ...sse({ choices: [{ delta: { content: "先看状态" } }] }),
      ...sse({ choices: [{ delta: { tool_calls: [{ id: "call_a", function: { name: "get_", arguments: '{"scope":' } }] } }] }),
      ...sse({ choices: [{ delta: { tool_calls: [{ function: { name: "state", arguments: '"form"}' } }] } }] }),
      ...sse({ choices: [{ finish_reason: "tool_calls" }], usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1024 } } }),
    ],
  };
  for (const [name, chunks] of Object.entries(variants)) {
    const { provider } = await setup(chat, async (url, init) => {
      requests.push({ url: String(url), init });
      return stream(chunks);
    }, "https://gateway.example.test");
    const events = await collect(provider.stream(turn1));
    assert.deepEqual(events, [
      ...(name === "standard" ? [{ type: "text", text: "先" }, { type: "text", text: "看状态" }] : [{ type: "text", text: "先看状态" }]),
      { type: "call", call: { type: "call", id: "call_a", name: "get_state", input: { scope: "form" } } },
      { type: "done", stop: "tool", usage: { input: 1200, output: 30, cacheRead: 1024, cacheWrite: 0 } },
    ], name);
  }
  assert.ok(requests.every((r) => r.url === "https://gateway.example.test/v1/chat/completions"));
  const init = requests[0].init;
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer synthetic-reasoning-key");
  assert.match(init.headers.Accept, /text\/event-stream/);
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.body, JSON.stringify(wireBody(chat, turn1)));
});

test("anthropic stream: text, input_json deltas, usage with cache counts and a missing message_stop", async () => {
  const requests = [];
  const events = [
    { type: "message_start", message: { id: "msg", usage: { input_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "ping" },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "步数偏低" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "get_state", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"scope": "fo' } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'rm"}' } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 57 } },
  ];
  for (const ending of [[{ type: "message_stop" }], []]) {
    const { provider } = await setup(anthropic, async (url, init) => {
      requests.push({ url: String(url), init });
      return stream(named(...events, ...ending));
    });
    assert.deepEqual(await collect(provider.stream(turn1)), [
      { type: "text", text: "步数偏低" },
      { type: "call", call: { type: "call", id: "toolu_1", name: "get_state", input: { scope: "form" } } },
      { type: "done", stop: "tool", usage: { input: 2340, output: 57, cacheRead: 2000, cacheWrite: 300 } },
    ]);
  }
  assert.equal(requests[0].url, "https://gateway.example.test/v1/messages");
  assert.equal(requests[0].init.headers["x-api-key"], "synthetic-reasoning-key");
  assert.equal(requests[0].init.headers["anthropic-version"], ANTHROPIC_VERSION);
  assert.equal(JSON.parse(requests[0].init.body).max_tokens, 2048);
});

test("abort and idle timeout end the stream and cancel the body; nothing is retried", async () => {
  let cancelled = 0, calls = 0;
  const { provider } = await setup(chat, async () => {
    calls++;
    return stream(sse({ choices: [{ delta: { content: "部分" } }] }), { hold: true, onCancel: () => cancelled++ });
  });
  const controller = new AbortController(), seen = [];
  await assert.rejects(async () => {
    for await (const event of provider.stream(turn1, { signal: controller.signal })) {
      seen.push(event);
      controller.abort(new DOMException("用户停止", "AbortError"));
    }
  }, (error) => error.name === "AbortError");
  assert.deepEqual(seen, [{ type: "text", text: "部分" }]);
  await assert.rejects(collect(provider.stream(turn1)), (error) => error instanceof ProviderError && error.kind === "timeout");
  assert.equal(cancelled, 2);
  const early = new AbortController();
  early.abort(new DOMException("用户停止", "AbortError"));
  await assert.rejects(collect(provider.stream(turn1, { signal: early.signal })), (error) => error.name === "AbortError");
  assert.equal(calls, 2);
});

test("failures are classified for the retry UI and carry the upstream text", async () => {
  const cases = [
    [() => Response.json({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 }), "auth", /Incorrect API key/],
    [() => Response.json({ type: "error", error: { type: "invalid_request_error", message: "Output blocked by content filtering policy" } }, { status: 400 }), "rejected", /content filtering/],
    [() => new Response("<html>Forbidden</html>", { status: 403, headers: { "content-type": "text/html" } }), "rejected", /\(403\)/],
    [() => Response.json({ error: { message: "检测到敏感内容" } }, { status: 400 }), "rejected", /敏感/],
    [() => Response.json({ error: { message: "model `x` does not exist" } }, { status: 404 }), "config", /does not exist/],
    [() => Response.json({ error: { message: "Rate limit reached", type: "rate_limit_error" } }, { status: 429 }), "rate", /Rate limit/],
    [() => Response.json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { status: 529 }), "server", /Overloaded/],
    [() => Response.json({ id: "x", choices: [{ message: { content: "非流式" } }] }), "protocol", /流式/],
    [() => stream(sse({ choices: [{ delta: { content: "一半" } }] }, { choices: [{ delta: {}, finish_reason: "content_filter" }] }, "[DONE]")), "rejected", /拒绝/],
    [() => stream(sse({ error: { message: "upstream exploded", type: "server_error" } })), "server", /exploded/],
    [() => stream(named({ type: "message_start", message: { usage: {} } }, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } })), "server", /Overloaded/],
    [() => stream(sse({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] }, "[DONE]")), "empty", /没有返回内容/],
    [() => stream([]), "empty", /没有返回内容/],
    [() => stream(sse({ choices: [{ delta: { content: "说到一半" } }] })), "network", /连接中断/],
    [() => stream(["data: {not json}\n\n"]), "protocol", /格式/],
    [() => stream(sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "x", arguments: "{bad" } }] }, finish_reason: "tool_calls" }] }, "[DONE]")), "protocol", /工具参数/],
    [() => { throw new TypeError("Failed to fetch"); }, "network", /无法连接/],
  ];
  for (const [respond, kind, text] of cases) {
    let calls = 0;
    const { provider } = await setup(chat, async () => (calls++, respond()));
    await assert.rejects(collect(provider.stream(turn1)), (error) => {
      assert.ok(error instanceof ProviderError, `${kind}: ${error}`);
      assert.equal(error.kind, kind, error.message);
      assert.match(error.message, text);
      return true;
    });
    assert.equal(calls, 1, kind);
  }
  await assert.rejects(setup(standardProfile, fetch), (error) => error instanceof ProviderError && error.kind === "config");
});

test("dispatch observer sees the identical encoded request body and actual cache reports for both protocols", async () => {
  for (const profile of [chat, anthropic]) {
    const codec = createCodec(["blue coat"]), observed = [], sent = [];
    const request = { ...turn1, messages: [user('{"prompt":"blue coat"}', "查看 blue coat")] };
    const payload = profile === chat ? sse(
      { choices: [{ delta: { content: "完成" }, finish_reason: "stop" }], usage: { prompt_tokens: 1600, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 0 } } }, "[DONE]")
      : named(
        { type: "message_start", message: { usage: { input_tokens: 80, cache_read_input_tokens: 1200, cache_creation_input_tokens: 320 } } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "完成" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } }, { type: "message_stop" });
    const { provider } = await setup(profile, async (_url, init) => { sent.push(init.body); return stream(payload); });
    await collect(provider.stream(request, { codec, observe: e => observed.push(e) }));
    assert.equal(observed[0].body, sent[0]);
    assert.equal(observed[0].body, JSON.stringify(wireBody(profile, request, codec)));
    assert.ok(!JSON.stringify(JSON.parse(observed[0].body).messages.filter(m => m.role !== "system")).includes("blue coat"));
    assert.ok(!JSON.stringify(observed).includes("synthetic-reasoning-key"));
    assert.deepEqual(observed[1].cache, profile === chat ? { read: 0, write: null } : { read: 1200, write: 320 });
    assert.equal(observed[1].usage.input, 1600);
  }
});

test("cache reports distinguish missing, invalid and zero counters; pre-dispatch abort records no request", async () => {
  for (const counter of [undefined, null, -1, "0", 0]) {
    const observed = [];
    const { provider } = await setup(chat, async () => stream(sse({ choices: [{ delta: { content: "完成" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 2, prompt_tokens_details: { cached_tokens: counter } } }, "[DONE]")));
    await collect(provider.stream(turn1, { observe: e => observed.push(e) }));
    assert.equal(observed.at(-1).cache.read, counter === 0 ? 0 : null);
    assert.equal(observed.at(-1).cache.write, null);
    observed.length = 0;
    const abort = new AbortController(); abort.abort(new DOMException("stop", "AbortError"));
    await assert.rejects(collect(provider.stream(turn1, { signal: abort.signal, observe: e => observed.push(e) })));
    assert.deepEqual(observed, []);
  }
});

test('ASK empty completion: explicit post-tool option preserves usage; incomplete streams still fail', async () => {
  const empty = () => stream(sse({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:55,completion_tokens:0}},'[DONE]'));
  const {provider} = await setup(chat, empty);
  await assert.rejects(collect(provider.stream(turn1)), e=>e.kind==='empty');
  const events=await collect(provider.stream(turn1,{allowEmpty:true}));
  assert.equal(events.length,1);assert.equal(events[0].type,'done');assert.equal(events[0].usage.input,55);
  const {provider:broken}=await setup(chat,()=>stream([]));
  await assert.rejects(collect(broken.stream(turn1,{allowEmpty:true})),e=>e.kind==='empty');
});
