import { test } from "node:test";
import assert from "node:assert/strict";
import { config, routing, workflow, complete } from "./helpers/comfy-fixture.mjs";
import { scanWorkflow, parseWorkflow, validateComfyWorkflow, injectWorkflow, comfyModelId } from "../src/domain/comfy-workflow.ts";
import { createConnections } from "../src/services/connections.ts";
import { createGateway } from "../src/gateway/client.ts";
import { executeComfy, comfyCatalog } from "../src/gateway/comfyui.ts";
import { comfyModelFiles, comfyModelFileLabel } from "../src/domain/comfy-models.ts";
import { testConnection } from "../src/gateway/connection-test.ts";
import { collect, drawingPayload, batchParams, DEFAULTS } from "../src/domain/drawing.ts";
import { imageParameters } from "../src/domain/image-parameters.ts";
import { parseDraft, validateDraft, stateHash } from "../src/ask/draft/validate.ts";
import { naiAwareness } from "../src/services/nai-awareness.ts";

async function setup(fetcher, auth = "none") {
  const storage = new Map();
  const connections = createConnections({ getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, work => work());
  await connections.save({ ...routing, connections: { gpu: { ...routing.connections.gpu, authMode: auth } } });
  if (auth === "bearer") connections.supplyKey("gpu-key", "synthetic-key");
  const context = connections.context("gpu"), gateway = createGateway(context, fetcher);
  return { connections, context, gateway, model: (await gateway.catalog()).models[0] };
}
const payload = { model: comfyModelId("gpu"), prompt: "  exact prompt  ", negative_prompt: "unused", seed: 0 };
const timing = { pollMs: 1, readMs: 20, cancelMs: 20 };
const picture = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
const consume = r => r.blob();

test("Comfy model labels: selected output dependencies exclude disconnected weights, LoRA, VAE and CLIP-only checkpoints", () => {
  const c = structuredClone(config), w = c.workflow;
  w['3'].inputs.model = ['4', 0];
  w['4'].inputs.model = ['20', 0];
  w['6'].inputs.clip = ['21', 1];
  w['20'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl/sd_xl_base_1.0.safetensors' } };
  w['21'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'clip-only.ckpt' } };
  w['22'] = { class_type: 'UNETLoader', inputs: { unet_name: 'disconnected.safetensors' } };
  w['23'] = { class_type: 'VAELoader', inputs: { vae_name: 'vae.safetensors' } };
  w['3'].inputs.vae = ['23', 0];
  const before = structuredClone(c);
  assert.deepEqual(comfyModelFiles(c), ['sdxl/sd_xl_base_1.0.safetensors']);
  assert.deepEqual(c, before);
  const model = comfyCatalog({ ...routing.connections.gpu, comfyWorkflow: c }).models[0];
  assert.equal(model.name, 'Example workflow');
  assert.deepEqual(model.comfyModelFiles, ['sdxl/sd_xl_base_1.0.safetensors']);
  assert.equal(comfyModelFileLabel(model.comfyModelFiles[0]), 'sd_xl_base_1.0');
  assert.equal(comfyModelFileLabel('weights\\flux-Q4_K_M.gguf'), 'flux-Q4_K_M');
});

test("Comfy model labels: multiple model paths, duplicate uses, linked filenames and unknown loaders stay literal", () => {
  const c = structuredClone(config), w = c.workflow;
  w['3'].inputs.model = ['20', 0];
  w['20'] = { class_type: 'MergeModels', inputs: { first: ['21', 0], second: ['22', 0], duplicate: ['21', 0], cycle: ['3', 0] } };
  w['21'] = { class_type: 'UNETLoader', inputs: { unet_name: 'first.safetensors' } };
  w['22'] = { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'second-Q8.gguf' } };
  assert.deepEqual(comfyModelFiles(c), ['first.safetensors', 'second-Q8.gguf']);
  w['21'].inputs.unet_name = ['24', 0];
  w['24'] = { class_type: 'ArbitraryString', inputs: { value: 'cannot-evaluate.safetensors' } };
  w['22'].class_type = 'UnknownLoader';
  assert.deepEqual(comfyModelFiles(c), []);
  c.bindings.output = '10';w['10'].inputs.images = ['25', 0];
  w['25'] = { class_type: 'LoadImage', inputs: { image: 'reference.png' } };
  assert.deepEqual(comfyModelFiles(c), []);
});

test("Comfy connection diagnostic: unavailable loopback points to the service/tunnel without claiming DNS failure", async () => {
  const { connections } = await setup();
  for (const [baseUrl, problem] of [["http://127.0.0.1:18781", /服务或转发通道已启动/], ["https://comfy.example.test", /API 地址、服务状态/]]) {
    const next = structuredClone(connections.configuration); next.connections.gpu.baseUrl = baseUrl;
    await connections.save(next);
    const calls = [];
    const result = await testConnection(connections.context("gpu"), async (url, init) => {
      calls.push({ url, init }); throw new TypeError("Failed to fetch");
    });
    assert.equal(result.s, "err"); assert.match(result.text, problem); assert.doesNotMatch(result.text, /域名错误/);
    assert.equal(calls.length, 2); assert.ok(calls.every(c => c.url.pathname === "/system_stats"));
    assert.equal(calls[1].init.mode, "no-cors"); assert.equal(calls[1].init.headers, undefined);
  }
});

test("Comfy connection diagnostic: reachable CORS failure, wrong API and timeout have actionable messages", async () => {
  const { context } = await setup(undefined, "bearer");
  const calls = [];
  const cors = await testConnection(context, async (url, init) => {
    calls.push(init);
    if (init.mode === "no-cors") return new Response("");
    throw new TypeError("Failed to fetch");
  });
  assert.match(cors.text, /当前 Koma 页面的来源（CORS）/);
  assert.equal(calls[0].headers.Authorization, "Bearer synthetic-key"); assert.equal(calls[1].headers, undefined);
  const page = await testConnection(context, async () => new Response("<html>terminal</html>"));
  assert.match(page.text, /API 根地址，而非终端登录页面/);
  const timeout = await testConnection(context, async () => { throw new DOMException("timeout", "TimeoutError"); });
  assert.equal(timeout.s, "warn"); assert.match(timeout.text, /服务或转发通道/);
});

test("Comfy workflow: custom literal scan, strict bindings, graph and LoRA preservation", () => {
  const scanned = scanWorkflow(parseWorkflow(JSON.stringify(workflow)));
  assert.ok(scanned.strings.some(b => b.nodeId === "6" && b.field === "prompt_text"));
  assert.ok(!scanned.strings.some(b => b.field === "positive"));
  assert.ok(!scanned.integers.some(b => b.field === "enabled" || b.field === "cfg"));
  const injected = injectWorkflow(config, payload.prompt, "unused", 0), expected = structuredClone(workflow);
  expected["6"].inputs.prompt_text = payload.prompt; expected["3"].inputs.seed = 0; expected["3"].inputs.noise_seed = 0;
  assert.deepEqual(injected, expected);
  assert.equal(workflow["3"].inputs.seed, 4);
  assert.throws(() => parseWorkflow({ nodes: [] }), /API/);
  assert.throws(() => parseWorkflow(JSON.parse('{"__proto__":{"class_type":"X","inputs":{}}}')), /结构/);
  for (const patch of [{ prompt: [] }, { seed: [{ nodeId: "3", field: "positive" }] }, { negative: config.bindings.prompt[0] }, { output: "6" }])
    assert.throws(() => validateComfyWorkflow({ ...config, bindings: { ...config.bindings, ...patch } }));
  assert.throws(() => injectWorkflow(config, "", "", Number.MAX_SAFE_INTEGER + 1), /Seed/);
});

test("Comfy connection: anonymous synthetic catalog, explicit credentials, frozen batch and changing configuration", async () => {
  const { gateway, connections, context, model } = await setup(() => { throw new Error("catalog must be local"); });
  assert.equal(model.id, comfyModelId("gpu"));
  assert.equal(model.name, "Example workflow");
  assert.equal(connections.hasCredential("gpu-key"), true);
  assert.equal((await gateway.quota()).temporary, null);
  const next = structuredClone(connections.configuration);
  next.connections.gpu.name = "Renamed"; next.connections.gpu.comfyWorkflow.workflow["4"].inputs.strength_model = 0.9;
  await connections.save(next);
  context.assertCurrent();
  assert.equal(context.connection.comfyWorkflow.workflow["4"].inputs.strength_model, 0.75);
  assert.notEqual(context.connection.revision, connections.configuration.connections.gpu.revision);
  next.connections.gpu.baseUrl = "https://different.example.test";
  await connections.save(next);
  assert.throws(context.assertCurrent, /改变/);
});

test("Comfy inputs and recipe: no hidden NAI additions, seed zero and rollover, safe metadata handoff", async () => {
  const { model, context } = await setup();
  const p = collect({ ...DEFAULTS, prompt: "  unchanged  ", negative: "local", seed: "0", qualityPreset: "best", naiMode: "furry", complexity: "complex" }, model, 2);
  assert.deepEqual(drawingPayload(p), { model: model.id, prompt: "  unchanged  ", negative_prompt: "", seed: 0 });
  assert.equal(batchParams({ ...p, seed: 4294967295 }, 1).seed, 0);
  assert.equal(collect({ ...DEFAULTS, prompt: "   " }, model, 1).prompt, "best quality");
  const recipe = { ...config, connectionId: "gpu", name: "snapshot", revision: context.connection.revision };
  const saved = imageParameters({ prompt: p.prompt, seed: 0, comfyWorkflow: { ...recipe, key: "must not persist" } });
  assert.deepEqual(saved.comfyWorkflow, recipe);
  assert.equal(saved.comfyWorkflow.key, undefined);
});

test("Comfy execution: one POST, retried history and view, first selected image, exact auth and URL encoding", async () => {
  const calls = []; let history = 0, view = 0;
  const fetcher = async (url, init) => {
    const u = new URL(url); calls.push({ u, init });
    if (u.pathname.endsWith("/prompt")) return Response.json({ prompt_id: "job" });
    if (u.pathname.includes("/history/")) { history++; if (history === 1) throw new TypeError("network"); if (history === 2) return Response.json({}); return Response.json(complete()); }
    if (u.pathname.endsWith("/view")) { if (++view < 3) return new Response("temporary", { status: 503 }); return picture(); }
    throw new Error("unexpected endpoint");
  };
  const { context } = await setup(fetcher, "bearer");
  const result = await executeComfy(context, payload, consume, new AbortController().signal, fetcher, timing);
  assert.equal(result.promptId, "job"); assert.equal(result.value.size, 3);
  assert.equal(calls.filter(c => c.init.method === "POST").length, 1);
  assert.equal(calls.at(-1).u.searchParams.get("filename"), "chosen image.png");
  assert.equal(calls.at(-1).u.searchParams.get("subfolder"), "a/b");
  for (const call of calls) { assert.equal(call.init.headers.Authorization, "Bearer synthetic-key"); assert.equal(call.init.redirect, "error"); }
  assert.equal(JSON.parse(calls[0].init.body).prompt["6"].inputs.prompt_text, payload.prompt);
});

test("Comfy execution: third consecutive read failure stops; no resubmission", async () => {
  let submits = 0, reads = 0;
  const fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    if (url.endsWith("/prompt")) { submits++; return Response.json({ prompt_id: "job" }); }
    reads++; throw new TypeError("offline");
  };
  const { context } = await setup(fetcher);
  await assert.rejects(executeComfy(context, payload, consume, new AbortController().signal, fetcher, timing), /连接中断/);
  assert.equal(submits, 1); assert.equal(reads, 3);
});

test("Comfy execution: unknown submission never retried", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new TypeError("lost acknowledgement"); };
  const { context } = await setup(fetcher);
  await assert.rejects(executeComfy(context, payload, consume, new AbortController().signal, fetcher, timing), /提交结果未知/);
  assert.equal(calls, 1);
});

test("Comfy reads: successful history resets failures, read timeout stays bounded, endpoint/key changes stop reads", async () => {
  let reads = 0;
  const fetcher = async url => {
    if (url.endsWith("/prompt")) return Response.json({ prompt_id: "job" });
    if (url.includes("/history/")) {
      reads++;
      if ([1, 2, 4, 5].includes(reads)) throw new TypeError("temporary");
      return Response.json(reads === 3 ? {} : complete());
    }
    return picture();
  };
  const { context, connections } = await setup(fetcher);
  await executeComfy(context, payload, consume, new AbortController().signal, fetcher, timing);
  assert.equal(reads, 6);
  let count = 0;
  const timed = async (url, init) => {
    if (url.endsWith("/prompt")) return Response.json({ prompt_id: "job" });
    count++;
    return new Promise((_, reject) => {
      // A network request keeps the event loop alive; AbortSignal.timeout alone does not.
      const keep = setTimeout(() => reject(new Error("timeout did not fire")), 1000);
      init.signal.addEventListener("abort", () => { clearTimeout(keep); reject(init.signal.reason); }, { once: true });
    });
  };
  await assert.rejects(executeComfy(context, payload, consume, new AbortController().signal, timed, timing), /超时/);
  assert.equal(count, 3);
  const changed = async url => {
    if (url.endsWith("/prompt")) {
      const next = structuredClone(connections.configuration); next.connections.gpu.baseUrl = "https://changed.example.test";
      await connections.save(next); return Response.json({ prompt_id: "job" });
    }
    throw new Error("must not request old endpoint after configuration changed");
  };
  await assert.rejects(executeComfy(context, payload, consume, new AbortController().signal, changed, timing), /改变/);
});

test("Comfy execution: abort during download cleans up exactly once; unsafe IDs never become paths", async () => {
  const controller = new AbortController(), calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/prompt")) return Response.json({ prompt_id: "job" });
    if (url.includes("/history/")) return Response.json(complete());
    if (url.includes("/view?")) { controller.abort(new DOMException("deadline", "TimeoutError")); throw controller.signal.reason; }
    assert.equal(init.signal.aborted, false); return Response.json({});
  };
  const { context } = await setup(fetcher);
  await assert.rejects(executeComfy(context, payload, consume, controller.signal, fetcher, timing), { name: "TimeoutError" });
  assert.equal(calls.filter(url => url.endsWith("/queue")).length, 1);
  let submitted = 0;
  await assert.rejects(executeComfy(context, payload, consume, new AbortController().signal, async () => { submitted++; return Response.json({ prompt_id: ".." }); }, timing), /提交结果未知/);
  assert.equal(submitted, 1);
});

test("Comfy execution: terminal errors, auth, malformed history, missing output and non-image never succeed", async () => {
  for (const response of [
    () => new Response("denied", { status: 401 }),
    () => Response.json([]),
    () => Response.json({ job: {} }),
    () => Response.json({ job: { status: { status_str: "error", messages: [["execution_error", { node_id: "3", exception_message: "missing model" }]] }, outputs: {} } }),
    () => Response.json({ job: { status: { status_str: "success", completed: true }, outputs: { "10": complete().job.outputs["10"] } } }),
  ]) {
    let reads = 0;
    const fetcher = async url => url.endsWith("/prompt") ? Response.json({ prompt_id: "job" }) : (reads++, response());
    const { context } = await setup(fetcher);
    await assert.rejects(executeComfy(context, payload, consume, new AbortController().signal, fetcher, timing));
    assert.equal(reads, 1);
  }
  const fetcher = async url => url.endsWith("/prompt") ? Response.json({ prompt_id: "job" }) : url.includes("/history/") ? Response.json(complete()) : new Response("not an image", { headers: { "Content-Type": "text/html" } });
  const { context } = await setup(fetcher);
  await assert.rejects(executeComfy(context, payload, consume, new AbortController().signal, fetcher, timing), /原图/);
});

test("Comfy cancellation: one independent queue deletion, no global interrupt", async () => {
  const controller = new AbortController(), calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/prompt")) return Response.json({ prompt_id: "job" });
    if (url.includes("/history/")) { controller.abort(); throw controller.signal.reason; }
    assert.ok(url.endsWith("/queue")); assert.equal(init.signal.aborted, false); return Response.json({});
  };
  const { context } = await setup(fetcher);
  await assert.rejects(executeComfy(context, payload, consume, controller.signal, fetcher, timing));
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].init.body), { delete: ["job"] });
});

test("Comfy ASK: capability projection and draft/restore validation follow final model and workflow version", async () => {
  const { model } = await setup();
  const base = { boardId: "b", boardPresent: true, form: { ...DEFAULTS, model: model.id, seed: "0" }, models: [model], samplers: [], composer: "", conversationId: "c" };
  const awareness = await naiAwareness({ ...base, models: [model] }).counted();
  assert.deepEqual(awareness.capabilities.writable_fields, ["model", "prompt", "seed", "batchCount"]);
  assert.equal(awareness.effective.steps, undefined);
  function plan(steps, now = base, library = []) {
    const draft = parseDraft({ title: "test", base_hash: stateHash(base), steps }, base, library, "");
    return validateDraft(draft, now, { off: new Set() });
  }
  const good = [{ kind: "prompt_patch", target: "image.prompt", mode: "rewrite", text: "new prompt" }, { kind: "params_patch", params: { seed: "0" } }];
  assert.ok(plan(good).changes.some(c => c.field === "prompt"));
  for (const step of [
    { kind: "prompt_patch", target: "image.negative", mode: "rewrite", text: "negative" },
    { kind: "params_patch", params: { width: 1024 } },
    { kind: "character_edit", op: "add", prompt: "role" },
  ]) assert.ok(plan([step]).steps.some(s => s.issue));
  assert.ok(plan(good, { ...base, models: [{ ...model, sourceRevision: "new-version" }] }).steps.every(s => s.issue));
  const restored = plan([{ kind: "restore_partial", source: "#h1", fields: ["steps"] }], base, [{ aliases: ["#h1"], params: { steps: 30 }, id: "old" }]);
  assert.ok(restored.steps[0].issue);
});
