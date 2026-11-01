import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComfySystem, memoryLabel, memoryPercent } from '../src/domain/comfy-system.ts';
import { readComfySystem } from '../src/gateway/comfy-system.ts';
import { createComfyMonitor } from '../src/services/comfy-monitor.ts';
import { createConnections } from '../src/services/connections.ts';
import { routing } from './helpers/comfy-fixture.mjs';
const GiB=1024**3;
const stats={system:{ram_total:64*GiB,ram_free:48*GiB,comfyui_version:'0.31.0',argv:['not for display']},devices:[{name:'GPU 0',type:'cuda',index:0,vram_total:24*GiB,vram_free:6*GiB,torch_vram_total:GiB},{name:'GPU 1',type:'cuda',index:1,vram_total:16*GiB,vram_free:0}]};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function connections(auth='none') {
  const storage=new Map();const c=createConnections({getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},work=>work());
  const config=structuredClone(routing);config.connections.gpu.authMode=auth;
  await c.save(config);if(auth==='bearer')c.supplyKey('gpu-key','synthetic-key');return c;
}
test('Comfy system: real byte totals, zero free, multiple GPUs and absent metrics remain distinct',()=>{
  const parsed=parseComfySystem(stats);
  assert.equal(memoryLabel(parsed.memory),'16 / 64 GiB');
  assert.equal(memoryPercent(parsed.devices[0].memory),'75%');
  assert.equal(memoryPercent(parsed.devices[1].memory),'100%');
  assert.equal(parsed.devices[0].memory.used,18*GiB,'driver total/free, not PyTorch allocator usage');
  assert.equal(parsed.cpuUtilization,undefined);assert.equal(parsed.devices[0].utilization,undefined);
  assert.ok(!JSON.stringify(parsed).includes('argv'));
  for(const free of [-1,25*GiB,NaN,Infinity,null,'0']){
    const value=structuredClone(stats);value.devices[0].vram_free=free;
    assert.equal(memoryPercent(parseComfySystem(value).devices[0].memory),'—');
  }
  assert.equal(memoryLabel(parseComfySystem({system:{},devices:[]}).memory),'未提供');
  assert.throws(()=>parseComfySystem({devices:[]}),/有效/);
});
test('Comfy system transport: one read, exact source auth, no redirects or sensitive system metadata',async()=>{
  const c=await connections('bearer'),calls=[];
  const parsed=await readComfySystem(c.context('gpu'),new AbortController().signal,async(url,init)=>{calls.push({url,init});return Response.json(stats);});
  assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/system_stats'));
  assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-key');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.credentials,'omit');
  assert.equal(parsed.version,'0.31.0');
  await assert.rejects(readComfySystem(c.context('gpu'),new AbortController().signal,async()=>Response.json({error:'denied'},{status:403})),/denied/);
});
test('Comfy monitor: sequential polling, failure retains a marked old sample and hidden views stop reads',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const c=await connections();let reads=0,fail=false,release;
  const monitor=createComfyMonitor(c,()=>{},async()=>{reads++;if(release===null)await new Promise(resolve=>release=resolve);if(fail)throw new TypeError('offline');return Response.json(stats);});
  monitor.setSource('gpu');assert.equal(reads,0);monitor.setActive(true);await settle();
  assert.equal(reads,1);assert.equal(monitor.snapshot().data.memory.used,16*GiB);
  fail=true;t.mock.timers.tick(5000);await settle();
  assert.equal(reads,2);assert.match(monitor.snapshot().error,/连接中断/);assert.ok(monitor.snapshot().updatedAt);
  fail=false;release=null;const pending=monitor.refresh();await settle();
  t.mock.timers.tick(20_000);await monitor.refresh();assert.equal(reads,3,'no overlapping polls');
  monitor.setActive(false);release();await pending;
  t.mock.timers.tick(20_000);await settle();assert.equal(reads,3);assert.equal(monitor.snapshot().loading,false);
  monitor.setActive(true);await settle();assert.equal(reads,4);assert.equal(monitor.snapshot().error,'');
  monitor.dispose();t.mock.timers.tick(20_000);await settle();assert.equal(reads,4);
});
test('Comfy monitor: credential/source changes discard late reads and clear stale source values',async()=>{
  const c=await connections('bearer'),calls=[];let release;
  const gate=new Promise(resolve=>release=resolve);
  const monitor=createComfyMonitor(c,()=>{},async(url,init)=>{calls.push(init);if(calls.length===1){await gate;return Response.json(stats);}return Response.json({...stats,system:{ram_total:32*GiB,ram_free:16*GiB}});});
  monitor.setSource('gpu');monitor.setActive(true);await settle();
  c.supplyKey('gpu-key','new-synthetic-key');await settle();release();await settle();
  assert.equal(calls[0].signal.aborted,true);assert.equal(calls[1].headers.Authorization,'Bearer new-synthetic-key');
  assert.equal(monitor.snapshot().data.memory.total,32*GiB);
  monitor.setSource('missing');await settle();assert.equal(monitor.snapshot().data,undefined);assert.equal(monitor.snapshot().error,'连接未就绪');
  monitor.dispose();
});
