import test from 'node:test';
import {photopeaProject} from './helpers/photopea-project.mjs';
import {validatePhotopeaProject} from '../src/native/photopea-project.ts';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {createPhotopeaClient} from '../src/native/photopea-client.ts';
import {PHOTOPEA_ORIGIN,photopeaUrl} from '../src/native/photopea-scripts.ts';
const png=()=>Uint8Array.from([137,80,78,71,13,10,26,10,0]).buffer;
const state={baseId:1,scratchId:2,maskId:3,carrierId:4,layers:[3,2,1,4],visible:[2,1],width:1,height:1,selection:null,maskIndex:0,carrierIndex:3};
for(const key of ['window','OffscreenCanvas','Image','ImageData','createImageBitmap'])if(!(key in globalThis))Object.defineProperty(globalThis,key,{value:undefined,configurable:true,writable:true});
function harness(t,timeout=1000){
 const listeners=new Set(),sent=[],fatal=[];let saves=0;
 t.mock.property(globalThis,'window',{addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)});
 // Transport tests use a one-pixel decoder. Real PNG/alpha behavior lives in browser suites.
 t.mock.property(globalThis,'Image',class{naturalWidth=1;naturalHeight=1;async decode(){}});
 t.mock.property(globalThis,'ImageData',class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}});
 t.mock.property(globalThis,'createImageBitmap',async()=>({width:1,height:1,close(){}}));
 t.mock.property(globalThis,'OffscreenCanvas',class{getContext(){return {drawImage(){},putImageData(){},getImageData(){return {width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])};}};}async convertToBlob(){return new Blob([png()],{type:'image/png'});}});
 const frame={contentWindow:{postMessage:(v,o)=>{assert.equal(o,PHOTOPEA_ORIGIN);sent.push(v);}}};
 const client=createPhotopeaClient(frame,'session',{onSave:()=>saves++,onFatal:m=>fatal.push(m),timeout});t.after(()=>client.dispose());
 const event=(data,overrides={})=>{for(const fn of listeners)fn({origin:PHOTOPEA_ORIGIN,source:frame.contentWindow,data,...overrides});};
 const reply=(event,overrides={})=>eventData({koma:'session',command:sent.length,event,...overrides});
 function eventData(data){event(JSON.stringify(data));}
 return {client,event,reply,sent,fatal,listeners,saves:()=>saves};
}
async function open(h){h.event('done');const task=h.client.open(new Blob([png()]));await tick();h.event('done');await tick();h.reply('start');h.reply('state',{detail:state});h.reply('complete');h.event('done');await task;}
async function exporting(h,mode='auto'){
 const task=h.client.export(mode);void task.catch(()=>{});await tick();
 h.reply('start');h.reply('document',{detail:'koma:session'});h.reply('state',{detail:state});h.reply('project');h.event(photopeaProject());h.reply('complete');h.event('done');
 await tick();assert.ok(h.sent.at(-1) instanceof ArrayBuffer);h.event('done');await tick();return {task};
}
function output(h,source='koma:session'){
 h.reply('start');h.reply('document',{detail:source});for(const event of ['image','selection','mask','carrier']){h.reply(event);h.event(png());}h.reply('complete');h.event('done');
}
test('Photopea fixed environment contains no autosave/global import script or user image URL',()=>{
 const url=new URL(photopeaUrl('session')),config=JSON.parse(decodeURIComponent(url.hash.slice(1)));assert.equal(url.origin,PHOTOPEA_ORIGIN);assert.equal(config.environment.autosave,undefined);assert.equal(config.script,undefined);assert.equal(config.files,undefined);
});
test('Photopea serial staged export, correlated PNGs, explicit Save and cleanup',async t=>{
 const h=harness(t);await open(h);h.event(png());h.event('done');h.reply('save',{koma:'other',source:'koma:session'});assert.equal(h.saves(),0);h.reply('save',{source:'koma:session'});assert.equal(h.saves(),1);
 const {task}=await exporting(h);h.reply('start',{koma:'old'});h.event(JSON.stringify({koma:'session',command:h.sent.length,event:'start'}),{origin:'https://wrong.test'});h.event(JSON.stringify({koma:'session',command:h.sent.length,event:'start'}),{source:{}});output(h);
 const value=await task;assert.equal(value.mode,'auto');assert.equal(value.image.size,9);assert.equal(value.mask.size,9);h.client.dispose();assert.equal(h.listeners.size,0);assert.deepEqual(h.fatal,[]);
});
test('Photopea rebinds the same document without importing its flattened return and keeps monotonic command IDs',async t=>{
 const h=harness(t);await open(h);const prior=h.sent.length;
 const task=h.client.open(new Blob([png()]),undefined,'next',{documentId:'session',roles:state,sameImage:true,refreshMask:false,baked:[]});await tick();assert.equal(typeof h.sent.at(-1),'string');assert.match(h.sent.at(-1),/koma:next/);assert.doesNotMatch(h.sent.at(-1),/DONOTSAVECHANGES/);
 h.reply('start');h.reply('state',{detail:state});h.reply('complete');h.event('done');await task;assert.equal(h.sent.length,prior+1);
 h.reply('save',{source:'koma:session'});assert.equal(h.saves(),0);h.reply('save',{source:'koma:next'});assert.equal(h.saves(),1);
});
test('Photopea script errors keep the channel available for correction; concurrent commands are refused',async t=>{
 const h=harness(t);await open(h);const first=h.client.export('mask'),rejected=assert.rejects(first,/结构/);await tick();await assert.rejects(h.client.export('image'),/等待/);h.reply('start');h.reply('error',{detail:'蒙版结构已变化'});h.event('done');await rejected;assert.equal(h.client.failed,false);
 const {task}=await exporting(h,'image');output(h);assert.equal((await task).mode,'image');assert.deepEqual(h.fatal,[]);
});
for(const kind of ['unlabelled','incomplete','missing','duplicate','invalid-png'])test(`Photopea rejects ${kind} output and quarantines late messages`,async t=>{
 const h=harness(t);await open(h);const {task}=await exporting(h),rejected=assert.rejects(task,/异常|不完整/);h.reply('start');
 if(kind==='unlabelled')h.event(png());if(kind==='incomplete')h.event('done');if(kind==='missing'){h.reply('complete');h.event('done');}if(kind==='duplicate')h.reply('start');if(kind==='invalid-png'){h.reply('document',{detail:'koma:session'});h.reply('image');h.event(new ArrayBuffer(12));}
 await rejected;assert.equal(h.client.failed,true);assert.equal(h.listeners.size,0);output(h);await assert.rejects(h.client.export('image'),/已关闭/);assert.equal(h.fatal.length,1);
});
test('Photopea validates the document source in the host independently of the export script',async t=>{
 const h=harness(t);await open(h);const {task}=await exporting(h),rejected=assert.rejects(task,/请切回/);output(h,'file');await rejected;assert.equal(h.client.failed,false);
});
test('Photopea validates role metadata before trusting a retained document',async t=>{
 const h=harness(t);h.event('done');const task=h.client.open(new Blob([png()])),rejected=assert.rejects(task,/信息无效/);await tick();h.event('done');await tick();h.reply('start');h.reply('state',{detail:{...state,maskId:0}});await rejected;assert.equal(h.client.failed,true);
});
test('Photopea timeout and disposal reject pending work and suppress late results',async t=>{
 const h=harness(t,20);await open(h);await assert.rejects(h.client.export('auto'),/超时/);assert.equal(h.client.failed,true);h.event(png());assert.equal(h.listeners.size,0);
});
test('Photopea loading timeout releases listeners and rejects readiness',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness(t),rejected=assert.rejects(h.client.ready,/载入超时/);t.mock.timers.tick(60000);await rejected;assert.equal(h.listeners.size,0);assert.equal(h.sent.length,0);
});
test('Photopea disposal rejects a pending export without notifying a fatal UI error',async t=>{
 const h=harness(t);await open(h);const task=h.client.export('auto'),rejected=assert.rejects(task,/已关闭/);await tick();h.client.dispose();await rejected;assert.equal(h.listeners.size,0);assert.deepEqual(h.fatal,[]);
});
test('Photopea oversized labelled output rejects without destroying the layered session',async t=>{
 const h=harness(t);await open(h);const {task}=await exporting(h),rejected=assert.rejects(task,/8MB/);h.reply('start');h.reply('document',{detail:'koma:session'});
 const big=new Uint8Array(8*1024*1024+1);big.set(new Uint8Array(png()));for(const event of ['image','selection','mask','carrier']){h.reply(event);h.event(event==='image'?big.buffer:png());}h.reply('complete');h.event('done');await rejected;assert.equal(h.client.failed,false);
});

test('Photopea rejects incomplete PSD metadata, dedicated raster/vector masks and effects; ordinary image masks remain legal',()=>{
 validatePhotopeaProject(photopeaProject(),state);
 validatePhotopeaProject(photopeaProject({masked:[1],vector:[2],effects:[1]}),state);
 for(const options of [{masked:[3]},{vector:[4]},{effects:[3]}])assert.throws(()=>validatePhotopeaProject(photopeaProject(options),state),/独立像素层/);
 for(const n of [0,5,26,32,50,100])assert.throws(()=>validatePhotopeaProject(photopeaProject().slice(0,n),state),/快照无效/);
 assert.throws(()=>validatePhotopeaProject(photopeaProject(),{...state,maskId:99}),/快照无效/);
});
