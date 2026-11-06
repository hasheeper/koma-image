import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationAlignment, annotationPrompt, annotationCrop, annotationSummary, canMaskAnnotations, pointsBox, moveRegion, resizeRegion, regionUnion, serializeAnnotations, validateRegions } from '../src/domain/region-annotation.ts';
import { newConversation, contextSnapshot, beginTurn, completeVersion, assetRefs, clearPendingAnnotation, retainImage } from '../src/domain/conversation.ts';
import { validateConversation } from '../src/storage/backup-schema.ts';
const region={key:'one',shape:'ellipse',bbox:{x:.2,y:.3,w:.2,h:.2},comment:'<眼睛>&"眉毛"'};
const snapshot={image:{tag:'#h1',entity_key:`sha256:${'a'.repeat(64)}`,record_id:'source',scope:{kind:'page',id:'test'}},width:1200,height:1200,regions:[region],edges:{dilate:.006,feather:.003}};
const annotation={snapshot,sourceAssetId:'source',inputAssetId:'input',guideAssetId:'guide',text:annotationPrompt([region])};

test('area moves and resizes stay bounded',()=>{
 const moved=moveRegion(region,2,-2);assert.equal(moved.bbox.x+moved.bbox.w,1);assert.equal(moved.bbox.y,0);
 const points=[{x:.1,y:.1},{x:.3,y:.1},{x:.2,y:.3}];const polygon={...region,shape:'polygon',points,bbox:pointsBox(points)};
 const resized=resizeRegion(polygon,{x:.3,y:.3,w:.4,h:.4});validateRegions([resized]);assert.deepEqual(resized.bbox,pointsBox(resized.points));
});
test('point annotations have only a location, serialize separately, and never invent a mask area',()=>{
 const point={key:'point',shape:'point',bbox:{x:.4,y:.6,w:0,h:0},comment:'检查<这里>'};
 assert.doesNotThrow(()=>validateRegions([point]));
 assert.deepEqual(moveRegion(point,2,-2).bbox,{x:1,y:0,w:0,h:0});
 assert.throws(()=>resizeRegion(point,{x:0,y:0,w:.2,h:.2}),/点批注/);
 assert.throws(()=>validateRegions([{...point,bbox:{...point.bbox,w:.1,h:.1}}]),/点批注/);
 assert.throws(()=>validateRegions([{...point,points:[{x:.4,y:.6}]}]),/点批注/);
 assert.throws(()=>regionUnion([region,point]),/点批注/);
 assert.equal(canMaskAnnotations([point]),false);assert.equal(canMaskAnnotations([region,point]),false);assert.equal(canMaskAnnotations([region]),true);
 const xml=serializeAnnotations({...snapshot,regions:[point,region]});
 assert.match(xml,/<point n="1" x="0.400" y="0.600">检查&lt;这里&gt;<\/point>/);assert.match(xml,/<region n="2" shape="ellipse"/);
 assert.match(annotationPrompt([point]),/1\. 位置点（横向 40%，纵向 60%）/);
 assert.doesNotMatch(annotationPrompt([point]),/矩形区域|椭圆区域|多边形区域/);
 const c=newConversation();c.pendingAnnotation={...structuredClone(annotation),snapshot:{...structuredClone(snapshot),regions:[point]},text:annotationPrompt([point])};
 c.mainId='input';c.attachments=['guide'];assert.doesNotThrow(()=>validateConversation(JSON.parse(JSON.stringify(c))));
});
test('polygons reject self-intersection; comments serialize as escaped data with sequential numbers',()=>{
 const points=[{x:.1,y:.1},{x:.8,y:.7},{x:.8,y:.1},{x:.1,y:.8}];
 assert.throws(()=>validateRegions([{...region,shape:'polygon',points,bbox:pointsBox(points)}]),/相交/);
 assert.match(serializeAnnotations(snapshot,'#a1'),/image="#a1"/);assert.match(serializeAnnotations(snapshot),/&lt;眼睛&gt;&amp;&quot;/);
 assert.match(annotationPrompt([region,{...region,key:'two'}]),/2\. 椭圆/);
 assert.throws(()=>validateRegions([{...region,bbox:{x:NaN,y:0,w:1,h:1}}]),/坐标/);
 assert.throws(()=>annotationPrompt(Array.from({length:13},(_,i)=>({...region,key:String(i),comment:'字'.repeat(2000)}))),/24000/);
});
test('alignment accepts different resolutions and <=1.5% rounding, blocks changed orientation/aspect',()=>{
 const b={width:2048,height:2048};assert.deepEqual(annotationAlignment(b,{width:1024,height:1024}),{scale:2,x:0,y:0,width:2048,height:2048});
 assert.ok(annotationAlignment({width:1200,height:1200},{width:1015,height:1000}));assert.equal(annotationAlignment(b,{width:1016,height:1000}),null);
 assert.ok(annotationAlignment({width:1014,height:1000},{width:1020,height:1000}));
 assert.ok(annotationAlignment({width:832,height:1216},{width:700,height:1024}));assert.equal(annotationAlignment(b,{width:1536,height:1024}),null);
 assert.equal(annotationAlignment({width:832,height:1216},{width:1216,height:832}),null);
});
test('annotation guide is second, turn-only, frozen and cannot enter keepIds; raw return leaves base intact',()=>{
 const c=newConversation();c.mainId='input';c.pendingAnnotation=structuredClone(annotation);c.attachments=['guide'];c.prompt=annotation.text;c.keepIds=['other'];
 retainImage(c,'guide');assert.deepEqual(c.keepIds,['other']);
 const s=contextSnapshot(c,c.prompt,3);assert.deepEqual(s.imageIds,['input','guide','other']);
 const {turn,version}=beginTurn(c,s,c.prompt,{});assert.equal(c.pendingAnnotation,undefined);assert.deepEqual(c.attachments,[]);
 completeVersion(c,turn,version,[{type:'image',assetId:'raw'}],null,0);assert.equal(c.mainId,'input');assert.equal(c.headId,turn.id);
 retainImage(c,'guide');assert.deepEqual(c.keepIds,['other']);assert.ok(!contextSnapshot(c).imageIds.includes('guide'));
 version.composites={raw:'merged'};assert.ok(assetRefs([c]).has('source'));assert.ok(assetRefs([c]).has('guide'));assert.ok(assetRefs([c]).has('merged'));
 assert.doesNotThrow(()=>validateConversation(c));
 const invalid=structuredClone(c);invalid.turns[0].snapshot.annotation.snapshot.edges.feather=-1;assert.throws(()=>validateConversation(invalid));
});
test('explicit cancellation removes only prepared annotation text and ephemeral guide',()=>{
 const c=newConversation();c.pendingAnnotation=structuredClone(annotation);c.attachments=['guide','extra'];c.prompt=`my note\n\n${annotation.text}`;
 clearPendingAnnotation(c);assert.equal(c.prompt,'my note');assert.deepEqual(c.attachments,['extra']);assert.equal(c.pendingAnnotation,undefined);
});

test('annotation crop keeps original geometry and point inspection respects non-square dimensions',()=>{
 assert.deepEqual(annotationCrop(snapshot,1),[20,30,20,20]);
 const points={...snapshot,width:1000,height:2000,regions:[{key:'p',shape:'point',bbox:{x:.99,y:0,w:0,h:0},comment:''}]};
 assert.deepEqual(annotationCrop(points,1),[80,0,20,10]);
 for(const n of [0,2,1.1,NaN])assert.throws(()=>annotationCrop(points,n));
 const projected=annotationSummary([{...region,bbox:{x:.123456,y:.3,w:.2,h:.2},points:[{x:.1,y:.2}]}]);
 assert.equal(projected[0].x,.123);assert.equal(projected[0].n,1);assert.equal(projected[0].points,undefined);
 const xml=serializeAnnotations(snapshot,'#a3','#a4');assert.match(xml,/version="2" image="#a3" guide="#a4" units="0-1"/);assert.doesNotMatch(xml,/bbox=|points=/);
});
test('new annotation cards assemble instructions at send without changing user input',()=>{
 const c=newConversation();c.pendingAnnotation={...structuredClone(annotation),text:''};c.mainId='input';c.prompt='  我的补充\n第二行';
 const s=contextSnapshot(c);assert.equal(c.prompt,'  我的补充\n第二行');assert.match(s.text,/紫色线框/);assert.ok(s.text.includes(c.prompt));
 assert.equal(s.text.split('图 2 仅用于定位').length,2);
 c.pendingAnnotation.singleImage=true;const one=contextSnapshot(c);assert.doesNotMatch(one.text,/图 1|图 2|定位图/);assert.match(one.text,/画面左侧|画面中央/);
 clearPendingAnnotation(c);assert.equal(c.prompt,'  我的补充\n第二行');
 assert.equal(annotationPrompt([],true,'unchanged'),'unchanged');
 const mask=annotationPrompt([],true,'paint',{x:.1,y:.1,w:.2,h:.2});assert.equal(mask.split('图 2 仅用于定位').length,2);assert.match(mask,/半透明紫色标出修改范围/);
});
