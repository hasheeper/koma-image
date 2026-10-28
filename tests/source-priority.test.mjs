import test from "node:test";
import assert from "node:assert/strict";
import { createConnections } from "../src/services/connections.ts";
import { createGateway } from "../src/gateway/client.ts";
import { createSourcePriority } from "../src/services/source-priority.ts";
import { insufficientFunds } from "../src/domain/source-funding.ts";
import { normalizeQuota } from "../src/domain/quota.ts";
import { standardProfile, novelaiProfile } from "../src/gateway/profile.ts";

const id = "nai-diffusion-5-full";
const payload = { model: id, prompt: "synthetic", width: 832, height: 1216, steps: 23, scale: 5, sampler: "k_euler_ancestral", seed: 0 };
const json = (body, status = 200) => Response.json(body, { status });
const model = { id };
function status(profile, remaining, subscription) { return normalizeQuota(profile, { credits: { remaining }, subscription }, {}); }

test("priority funding: only proven insufficiency advances; unknown, free quotes and rounded usage do not", () => {
  assert.match(insufficientFunds(model, status(standardProfile, 5), { cost: 6 }), /积分不足/);
  for (const [balance, quote] of [[5, { cost: 5 }], [0, { cost: 0 }], [null, { cost: 6 }], [0, null]])
    assert.equal(insufficientFunds(model, status(standardProfile, balance), quote), null);
  const subscription = { active: true, tier: 3, usage: { percent: 0, purchasedPercent: 0, isNegative: true } };
  assert.match(insufficientFunds(model, status(novelaiProfile, 0, subscription), null), /V5.*Anlas/);
  for (const account of [
    { ...subscription, usage: { ...subscription.usage, isNegative: false } },
    { ...subscription, usage: { ...subscription.usage, purchasedPercent: 20 } },
    { ...subscription, usage: { isNegative: true } },
    { active: true, tier: 3 },
  ]) assert.equal(insufficientFunds(model, status(novelaiProfile, 0, account), null), null);
  assert.equal(insufficientFunds(model, status(novelaiProfile, 1, subscription), null), null);
  assert.equal(insufficientFunds({ id: "nai-diffusion-4-5-full" }, status(novelaiProfile, 0, subscription), null), null, "V4.5 benefits are not inferred from V5");
});

async function fixture({ official = false, openai = false } = {}) {
  const memory = new Map(), connections = createConnections({ getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }, async fn => fn());
  const c = (key, profileId = standardProfile.id, baseUrl = `https://${key}.example.test`) => ({ id: key, name: `模拟 ${key}`, profileId, baseUrl, credentialRef: `key-${key}`, revision: "r1" });
  const routing = { version: 1, connections: { low: c("low"), high: c("high", official ? novelaiProfile.id : openai ? "openai-images-v1" : standardProfile.id, official ? "https://image.novelai.net" : "https://high.example.test") }, links: {}, order: ["high", "low"] };
  await connections.save(routing);
  for (const key of ["low", "high"]) connections.supplyKey(`key-${key}`, `synthetic-${key}`);
  const state = { high: { cost: 6, credit: 5 }, low: { cost: 2, credit: 10 }, account: { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 }, usage: { percent: 0, purchasedPercent: 0, isNegative: true } }, generationStatus: 200, quoteStatus: 200, quotaStatus: 200 };
  const calls = [], clients = new Map();
  const fetcher = async (url, init) => {
    const key = url.hostname === "low.example.test" ? "low" : "high", path = url.pathname;
    const record = { key, path, method: init.method || "GET", body: init.body && JSON.parse(init.body) };
    calls.push(record);
    if (path === "/user/subscription") return json(state.account, state.quotaStatus);
    if (path.endsWith("/models")) return openai && key === "high" ? json({ data: [{ id: "gpt-image-1.5" }] }) : json({ studio_features: { version: 2, max_cost: true }, models: {
      [id]: { operations: ["generate", "edit"], tools: ["img2img", "inpaint", "upscale"] },
      "gpt-image-1.5": { operations: ["generate", "edit"], editor_family: "gpt", tools: ["image-edit"] },
    } });
    if (path.endsWith("/media/quota")) { await state.onQuota?.(key); return json({ credits: { remaining: state[key].credit } }, state.quotaStatus); }
    if (path.endsWith("/token_stats_data")) return json({});
    if (path.endsWith("/estimate")) return json({ cost: state[key].cost }, key === "high" ? state.quoteStatus : 200);
    return json({ result: key }, state.generationStatus);
  };
  const gateway = key => {
    const context = connections.context(key);
    if (!clients.has(context.cacheKey)) clients.set(context.cacheKey, createGateway(context, fetcher));
    return clients.get(context.cacheKey);
  };
  const priority = createSourcePriority(connections, gateway);
  const wanted = (await gateway("low").catalog()).models.find(m => m.id === (openai ? "gpt-image-1.5" : id));
  const input = openai ? { model: "gpt-image-1.5", prompt: "synthetic" } : payload;
  return { connections, state, calls, priority, wanted, input, gateway };
}
const generations = calls => calls.filter(c => c.method === "POST" && !c.path.endsWith("/estimate"));

test("priority execution: fresh quote skips insufficient credit before POST, recovered first source wins next time", async () => {
  const t = await fixture(), selections = [], notices = [];
  const first = await t.priority.execute(t.wanted, t.input, r => r.json(), { onSource: s => selections.push(s), onNotice: n => notices.push(n) });
  assert.equal(first.via.connection, "low");
  assert.deepEqual(generations(t.calls).map(c => c.key), ["low"]);
  assert.equal(generations(t.calls)[0].body.max_cost, 2);
  assert.deepEqual(selections[0].skipped, ["high"]);
  assert.equal(notices.length, 1);
  assert.doesNotMatch(notices[0], /6 积分/);
  t.state.high.credit = 10;
  const second = await t.priority.execute(t.wanted, t.input, r => r.json());
  assert.equal(second.via.connection, "high");
  assert.equal(generations(t.calls).at(-1).body.max_cost, 6);
});

test("priority execution: exhausted official V5 uses the next source; restored official supports infill", async () => {
  const t = await fixture({ official: true });
  assert.equal((await t.priority.select(t.wanted)).model.connection, "low");
  await t.priority.execute(t.wanted, t.input, r => r.json());
  assert.deepEqual(generations(t.calls).map(c => c.key), ["low"]);
  t.state.account.trainingStepsLeft.purchasedTrainingSteps = 100;
  assert.equal((await t.priority.select(t.wanted)).model.connection, "high");
  const result = await t.priority.select(t.wanted, undefined, undefined, "inpaint");
  assert.equal(result.model.connection, "high");
  assert.ok(generations(t.calls).every(c => c.key === "low"));
});

test("priority execution: unqueryable official balance stays first; submitted failure never reaches a lower source", async () => {
  const t = await fixture({ openai: true });
  assert.equal((await t.priority.execute(t.wanted, t.input, r => r.json())).via.connection, "high");
  assert.equal(t.calls.some(c => c.key === "high" && /quota|estimate/.test(c.path)), false);
  t.state.generationStatus = 503;
  await assert.rejects(t.priority.execute(t.wanted, t.input, r => r.json()), /503/);
  assert.deepEqual(generations(t.calls).map(c => c.key), ["high", "high"]);
});

test("priority execution: quote error, all insufficient, cancellation and config edits stop before generation", async () => {
  const t = await fixture();
  t.state.quoteStatus = 503;
  await assert.rejects(t.priority.execute(t.wanted, t.input, r => r.json()), /503/);
  assert.equal(generations(t.calls).length, 0);
  t.state.quoteStatus = 200; t.state.low.credit = 0;
  await assert.rejects(t.priority.execute(t.wanted, t.input, r => r.json()), /所有.*不足/);
  assert.equal(generations(t.calls).length, 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(t.priority.execute(t.wanted, t.input, r => r.json(), { signal: abort.signal }), { name: "AbortError" });
  t.state.onQuota = async key => {
    if (key !== "high") return;
    t.state.onQuota = undefined;
    await t.connections.save({ ...t.connections.configuration, order: ["low", "high"] });
  };
  await assert.rejects(t.priority.execute(t.wanted, t.input, r => r.json()), /改变/);
  assert.equal(generations(t.calls).length, 0);
});

test("priority execution: a failed balance read remains unknown and the original payload stays untouched", async () => {
  const t = await fixture();
  t.state.quotaStatus = 503;
  const before = structuredClone(t.input);
  assert.equal((await t.priority.execute(t.wanted, t.input, r => r.json())).via.connection, "high");
  assert.deepEqual(t.input, before);
  assert.equal(generations(t.calls).length, 1);
});

test("priority Medium: exact model availability and exhausted funds never silently downgrade to High", async () => {
  const t = await fixture({ official: true });
  const wanted = (await t.gateway("high").catalog()).models.find(m => m.id === "nai-diffusion-5-full-medium");
  const input = { ...t.input, model: wanted.id, steps: 14 };
  await assert.rejects(t.priority.execute(wanted, input, r => r.json()), /所有.*不足/);
  assert.equal(generations(t.calls).length, 0);
  t.state.account.trainingStepsLeft.purchasedTrainingSteps = 100;
  const result = await t.priority.execute(wanted, input, r => r.json());
  assert.equal(result.via.connection, "high");
  assert.equal(generations(t.calls)[0].body.model, "nai-diffusion-5-full-medium");
  assert.equal(generations(t.calls).some(c => c.key === "low"), false);
});

test('priority local estimate: known encoding minimum still blocks with unknown Opus entitlement', async()=>{
  const t=await fixture({official:true});
  const wanted=(await t.gateway('high').catalog()).models.find(m=>m.id==='nai-diffusion-4-5-full');
  t.state.account={trainingStepsLeft:{fixedTrainingStepsLeft:1,purchasedTrainingSteps:0}};
  const priority=createSourcePriority(t.connections,t.gateway,async()=>2);
  const input={...payload,model:wanted.id,referencePlan:{kind:'vibe',normalize:false,items:[{id:'r1',assetId:'a'.repeat(64),on:true,information:.7,strength:.6,fidelity:1,type:'character&style'}]}};
  const before=structuredClone(input),blocked=await priority.select(wanted,undefined,input);
  assert.match(blocked.insufficient,/参考费用/);assert.equal(blocked.quote,null);
  t.state.account.trainingStepsLeft.fixedTrainingStepsLeft=3;
  const allowed=await priority.select(wanted,undefined,input);
  assert.equal(allowed.insufficient,null);assert.equal(allowed.quote,null);
  assert.deepEqual(input,before);assert.equal(generations(t.calls).length,0);
});
