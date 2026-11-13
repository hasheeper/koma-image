import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { createRetrospects } from '../src/ask/retrospect/store.ts';
import { readRetrospect } from '../src/ask/retrospect/model.ts';
import { recipeClusters } from '../src/ask/retrospect/recipe.ts';
import { createDraftWriter } from '../src/ask/draft/apply.ts';
import { createDraftStack } from '../src/ask/draft/stack.ts';
import { createRecipeReader } from '../src/ask/retrospect/tools.ts';
import { pendingWorkshopResult, workshopPending } from '../src/ask/retrospect/workshops.ts';
const owner={conversationId:'ask',turnId:1,boardId:'image',boardName:'主干'};
const image=n=>({id:`h${n}`,label:`#h${n}`,aliases:[`#h${n}`],createdAt:n,size:{width:832,height:1216},origins:[{source:'history',order:n}],params:{...DEFAULTS,boardId:'image',basePrompt:`picture ${n}`,baseNegative:'',localCharacters:[]}});
const workshop=(n,workspace='edit',target='one')=>({id:`${workspace}${n}`,label:`#${workspace==='edit'?'e':'c'}1.${n}`,aliases:[`#${workspace==='edit'?'e':'c'}1.${n}`],createdAt:n,size:{width:832,height:1216},origins:[{source:workspace,boardId:target,order:n}],...(workspace==='chat'?{scope:{kind:'chat',id:target}}:{}),params:{editBoardId:target,evolutionInput:{workspace,operation:workspace==='edit'?'inpaint':'chat',prompt:`result ${n}`,negative:'',characters:[],params:{strength:.1*n},base:{id:'h1',label:'#h1'},mask:null}}});
const refs=ps=>Object.fromEntries(ps.map(p=>[p.label,{tag:p.label,record_id:p.id,scope:{kind:'page',id:'page'}}]));
function fixture(count=3,oneStage=true){
 const s=createRetrospects(),ps=Array.from({length:count},(_,i)=>image(i+1));
 const nodes=oneStage?[{id:'v1',label:'原始构图',image_ids:ps.map(p=>p.label)}]:ps.map((p,i)=>({id:`v${i+1}`,label:'阶段',image_ids:[p.label]}));
 const value=readRetrospect({retrospect_title:'主题',nodes,edges:[]},recipeClusters(ps,new Set(),'image'));
 const r=s.register(value,refs(ps),owner,'active',ps),current=()=>s.get(r.id);
 const dispatch=(target='edit:one',source='h1',pictures=ps)=>{const change=s.prepareDispatch(target,source,target,pictures,refs(pictures));if(change)s.commitTree(change);return current().workshops.at(-1);};
 const result=(ticket,p,parent=ticket.inputs[0])=>{s.collectWorkshop(ticket.target,parent)?.(p.id);return p;};
 const deliver=(ticket,p,mode='append',kind='stage')=>{const c=s.prepareDelivery(r.id,ticket.id,p,refs([p]),mode,kind);s.commitTree(c);return c;};
 return {s,ps,r,current,dispatch,result,deliver};
}
test('IMAGE manual changes stay in stage; promotion moves exactly one selected sample and subsequent rolls follow it',()=>{
 const f=fixture(),{s,r}=f;const before=s.begin('image');const c=s.preparePromote(r.id,'h2');s.commitTree(c);
 assert.deepEqual(f.current().value.nodes.map(n=>n.image_ids),[['#h1','#h3'],['#h2']]);assert.equal(f.current().cursor.nodeId,'v2');
 s.land(before,image(4),refs([image(4)]));s.finish(before);assert.equal(f.current().cursor.nodeId,'v2');assert.ok(f.current().value.nodes[0].image_ids.includes('#h4'));
 const next=s.begin('image');s.land(next,image(5),refs([image(5)]));s.finish(next);assert.ok(f.current().value.nodes[1].image_ids.includes('#h5'));
 assert.throws(()=>fixture(1).s.preparePromote('r1','h1'),/只有一张/);
});
test('workshop dispatch and many native results never move IMAGE or auto-create stages; first delivery consumes its ticket position',()=>{
 const f=fixture(),cursor=f.current().cursor,t=f.dispatch();assert.equal(f.current().value.nodes.length,1);assert.equal(f.s.activeForBoard('edit:one'),null);
 assert.equal(f.s.begin('edit:one','h1'),null);assert.equal(f.s.prepareDispatch('edit:one','h1','same',f.ps,refs(f.ps)),null);
 f.s.arrange(f.r.id,{[t.id]:{x:900,cy:300,z:7}});
 const a=f.result(t,workshop(1)),b=f.result(t,workshop(2));assert.equal(f.current().value.nodes.length,1);
 f.deliver(t,b);assert.equal(f.current().value.nodes.length,2);assert.deepEqual(f.current().value.nodes[1].image_ids,[b.label]);assert.deepEqual(f.current().nodeLayout.v2,{x:900,cy:300,z:7});assert.deepEqual(f.current().cursor,cursor);
 assert.deepEqual(f.current().workshops[0].results,[a.id,b.id]);assert.equal(f.current().workshops[0].anchorRecordId,b.id);
});
test('repeated deliveries append, keep rejection per sample, then advance to a child without changing native inputs or IMAGE',()=>{
 const f=fixture(),t=f.dispatch(),cursor=f.current().cursor;
 const a=f.result(t,workshop(1));f.deliver(t,a,'append','rejected');
 const b=f.result(t,workshop(2));f.deliver(t,b);
 let n=f.current().value.nodes[1];assert.deepEqual(n.image_ids,[a.label,b.label]);assert.equal(n.cover,b.label);assert.equal(n.delivery.samples[a.label].kind,'rejected');
 const c=f.result(t,workshop(3));f.deliver(t,c,'next');assert.deepEqual(f.current().value.edges.map(e=>[e.from,e.to]),[['v1','v2'],['v2','v3']]);assert.equal(f.current().workshops[0].anchorRecordId,c.id);
 const read=createRecipeReader(()=>recipeClusters(f.ps,new Set(),'image'),'image',[f.current()]).read({});
 const delivered=read.retrospects[0].nodes.find(n=>n.id==='v2');
 assert.equal(delivered.source_image_id,'#h1');assert.deepEqual(delivered.deliveries[a.label],{kind:'rejected',workspace:'edit'});
 assert.equal(delivered.delivery,undefined,'ASK receives semantic sample evidence, not native ticket IDs');
 const current=f.current();const repeated=f.s.prepareDelivery(f.r.id,t.id,a,refs([a]));assert.equal(repeated.before,repeated.after);assert.equal(f.current(),current);
 assert.deepEqual(f.current().cursor,cursor);assert.equal(f.current().value.nodes[2].recipe.input.base.id,'h1');
});
test('one workshop exposes only its current pending result, settles old trials, and reuses its association for the next revision',()=>{
 const f=fixture(),t=f.dispatch(),ticket=()=>f.current().workshops[0];
 assert.equal(workshopPending(ticket()),true);assert.equal(pendingWorkshopResult(ticket()),null);
 f.s.arrange(f.r.id,{[t.id]:{x:700,cy:300,z:2}});
 const a=f.result(t,workshop(1)),b=f.result(t,workshop(2));assert.equal(pendingWorkshopResult(ticket()),b.id);
 f.deliver(t,a);assert.equal(workshopPending(ticket()),false);assert.equal(pendingWorkshopResult(ticket()),null,'unchosen trials do not remain pending');
 assert.deepEqual(f.current().value.nodes[1].image_ids,[a.label]);assert.deepEqual(ticket().results,[a.id,b.id]);
 const next=f.result(t,workshop(3),a.id);assert.equal(f.current().workshops.length,1);assert.equal(pendingWorkshopResult(ticket()),next.id);
 assert.equal(f.current().nodeLayout[t.id],undefined,'the next pending result must not occupy its historical stage');
 assert.deepEqual(f.current().nodeLayout.v2,{x:700,cy:300,z:2});
 f.s.arrange(f.r.id,{...f.current().nodeLayout,[t.id]:{x:1100,cy:450,z:3}});
 f.deliver(t,next,'next');assert.equal(pendingWorkshopResult(ticket()),null);assert.equal(workshopPending(ticket()),false);
 assert.deepEqual(f.current().nodeLayout.v3,{x:1100,cy:450,z:3});assert.deepEqual(f.current().nodeLayout.v2,{x:700,cy:300,z:2});
 const read=createRecipeReader(()=>recipeClusters(f.ps,new Set(),'image'),'image',[f.current()]).read({});assert.equal(read.retrospects[0].workshops[0].status,'delivered');
});
test('a result completed after delivery preparation stays pending across commit, undo and redo',()=>{
 const f=fixture(),t=f.dispatch(),a=f.result(t,workshop(1)),ticket=()=>f.current().workshops[0];
 const change=f.s.prepareDelivery(f.r.id,t.id,a,refs([a]));const late=f.result(t,workshop(2));
 f.s.commitTree(change);assert.equal(pendingWorkshopResult(ticket()),late.id);assert.equal(workshopPending(ticket()),true);
 f.s.commitTree(change,true);assert.equal(ticket().nodeId,null);assert.equal(pendingWorkshopResult(ticket()),late.id);
 f.s.commitTree(change);assert.equal(ticket().nodeId,'v2');assert.equal(pendingWorkshopResult(ticket()),late.id);
 const read=createRecipeReader(()=>recipeClusters(f.ps,new Set(),'image'),'image',[f.current()]).read({});assert.equal(read.retrospects[0].workshops[0].status,'pending');
});
test('cross-workshop relay delivers exact selected result and creates new ticket atomically; ambiguous ancestry asks for explicit delivery',()=>{
 const f=fixture(),t=f.dispatch();const p=f.result(t,workshop(1));const change=f.s.prepareDispatch('chat:two',p.id,'合成',[...f.ps,p],refs([...f.ps,p]));
 assert.equal(f.current().value.nodes.length,1);f.s.commitTree(change);assert.equal(f.current().value.nodes.length,2);assert.equal(f.current().workshops.length,2);assert.equal(f.current().workshops[1].sourceRecordId,p.id);
 const q=f.result(f.current().workshops[1],workshop(2,'chat','two'),p.id);f.s.commitTree(f.s.prepareDispatch('edit:three',q.id,'重绘',[...f.ps,p,q],refs([...f.ps,p,q])));
 assert.equal(f.current().value.nodes.length,3);assert.deepEqual(f.current().value.edges.map(e=>[e.from,e.to]),[['v1','v2'],['v2','v3']]);
 const g=fixture(),a=g.dispatch('chat:same','h1'),b=g.dispatch('chat:same','h2');g.s.collectWorkshop('chat:same','h1',['h2'])('multi');
 assert.equal(g.s.workshopsFor('chat:same','multi').length,2);assert.throws(()=>g.s.prepareDispatch('edit:next','multi','次步',[{...workshop(8,'chat'),id:'multi'}],{}),/来源不明确/);
});
test('regroup and promotion remap exact workshop sources, preserve delivered nodes and notes, reject missing dependencies',()=>{
 const f=fixture(),t=f.dispatch('edit:one','h2'),p=f.result(t,workshop(1),'h2');f.deliver(t,p);f.s.annotate(f.r.id,['edge:v1:v2'],'保留');
 f.s.commitTree(f.s.preparePromote(f.r.id,'h2'));assert.equal(f.current().value.edges.find(e=>e.to==='v2').from,'v3');assert.equal(f.current().notes['edge:v3:v2'],'保留');
 const before=f.current(),value=readRetrospect({retrospect_id:before.id,expected_revision:before.revision,retrospect_title:'重整',nodes:[{id:'v1',label:'根',image_ids:['#h1','#h3']},{id:'v3',label:'重点',image_ids:['#h2']}],edges:[{from:'v1',to:'v3',summary:'提拔'}]},recipeClusters(f.ps,new Set(),'image'),before);
 f.s.update(before.id,before.revision,value,refs(f.ps),owner);assert.deepEqual(f.current().value.nodes.find(n=>n.id==='v2'),before.value.nodes.find(n=>n.id==='v2'));
 assert.throws(()=>readRetrospect({retrospect_title:'漏来源',nodes:[{id:'v1',label:'根',image_ids:['#h1']}],edges:[]},recipeClusters(f.ps,new Set(),'image'),f.current()),/来源样本/);
});
test('capacity counts pending work; reusing a reservation and delivering it at 80 are allowed',()=>{
 const f=fixture(79,false),t=f.dispatch();assert.equal(f.s.capacity(f.current()),80);assert.throws(()=>f.dispatch('chat:two'),/80/);assert.throws(()=>f.s.prepareNext('image','ask'),/80/);
 const p=f.result(t,workshop(1));f.deliver(t,p);assert.equal(f.current().value.nodes.length,80);const q=f.result(t,workshop(2));f.deliver(t,q);assert.equal(f.current().value.nodes.length,80);assert.throws(()=>f.deliver(t,f.result(t,workshop(3)),'next'),/80/);
 const g=fixture(79,false);g.s.commitMove(g.s.prepareNext('image','ask'));assert.equal(g.s.capacity(g.current()),80);assert.doesNotThrow(()=>g.s.commitMove(g.s.prepareNext('image','ask')));
 const flight=g.s.begin('image');const landed=image(90);g.s.land(flight,landed,refs([landed]));g.s.finish(flight);assert.equal(g.current().value.nodes.length,80);
});
test('pending ordinary IMAGE destinations and in-flight source survive promotion/regroup without stealing new cursor',()=>{
 const f=fixture();f.s.commitMove(f.s.prepareNext('image','ask'));const flight=f.s.begin('image');f.s.commitTree(f.s.preparePromote(f.r.id,'h2'));assert.equal(f.s.capacity(f.current()),3);
 const p=image(8);f.s.land(flight,p,refs([p]));f.s.finish(flight);assert.equal(f.current().value.nodes.length,3);assert.equal(f.current().cursor.nodeId,'v2');
 const late=f.s.begin('image');const before=f.current();assert.throws(()=>f.s.update(before.id,before.revision,{...before.value,nodes:before.value.nodes.filter(n=>n.id!=='v2'),edges:before.value.edges.filter(e=>e.to!=='v2'&&e.from!=='v2')},before.pictureRefs,owner),/基底|来源/);f.s.finish(late);
});
test('tree undo preserves view and newly collected workshop trials; conflicting later delivery prevents unsafe rollback',()=>{
 const f=fixture(),t=f.dispatch(),p=f.result(t,workshop(1));const c=f.deliver(t,p);f.s.arrange(f.r.id,{v2:{x:600,cy:400,z:4}});f.result(t,workshop(2));
 f.s.commitTree(c,true);assert.equal(f.current().value.nodes.length,1);assert.deepEqual(f.current().workshops[0].results,[p.id,'edit2']);f.s.commitTree(c);assert.deepEqual(f.current().nodeLayout.v2,{x:600,cy:400,z:4});
 f.deliver(t,workshop(2));assert.match(f.s.treeIssue(c,true),/后续修改/);
});
test('shared stack preflights mixed tree/cursor writes and restores each atomically',async()=>{
 const f=fixture(),drawing={retainHistory(){},snapshot:()=>({form:{},boards:[{id:'image',form:{}}]})},chat={snapshot:()=>({current:{id:'chat'},conversations:[]}),retainHandoffDrafts(){}};
 const writer=createDraftWriter(drawing,chat,{route:{value:{}},switchWorkspace(){}},undefined,undefined,undefined,{...f.s,treeSnapshot:f.s.get,available:()=>true});const stack=createDraftStack(writer);
 const first=stack.create({title:'提拔',steps:[]},'',0);await stack.apply(first,{title:'提拔',workspace:'image',boardId:'image',changes:[],steps:[],treeChange:f.s.preparePromote(f.r.id,'h2')});
 const second=stack.create({title:'恢复',steps:[]},'',0);await stack.apply(second,{title:'恢复',workspace:'image',boardId:'image',changes:[],steps:[],treeChange:f.s.prepareRestore(f.r.id,'h1')});
 assert.deepEqual(stack.preflight([first.id,second.id]),[second.id,first.id]);await stack.undo(second.id);await stack.undo(first.id);assert.equal(f.current().value.nodes.length,1);await stack.restore(first.id);assert.equal(f.current().cursor.nodeId,'v2');
});
test('native EDIT/CHAT candidates cannot create an IMAGE main tree or move its cursor; relabel preserves rejection identity',()=>{
 const f=fixture(),t=f.dispatch('chat:one'),p=f.result(t,workshop(1,'chat'));f.deliver(t,p,'append','rejected');
 assert.throws(()=>f.s.prepareMove('image',p.id),/回退图片/);
 f.s.relabel([{...p,label:'#c9.2'}]);const n=f.current().value.nodes[1];assert.equal(n.cover,'#c9.2');assert.equal(n.delivery.samples['#c9.2'].kind,'rejected');
 assert.throws(()=>readRetrospect({retrospect_title:'错误主干',nodes:[{id:'v1',label:'工坊',image_ids:[p.label]}],edges:[]},recipeClusters([p],new Set())),/只整理 IMAGE/);
 const capture=f.s.collectWorkshop(t.target,p.id);f.s.setStatus(f.r.id,'ended');capture('late');assert.ok(!f.current().workshops[0].results.includes('late'));assert.equal(f.s.begin('image'),null);
});
