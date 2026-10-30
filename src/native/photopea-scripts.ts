// Only these fixed scripts run in Photopea. User filenames, prompts and returned text are never code.
const literal = (value: string) => JSON.stringify(value);
export const PHOTOPEA_ORIGIN = "https://www.photopea.com";
export type PhotopeaReturnMode = "auto" | "image" | "mask";
export interface PhotopeaRoles { baseId: number; scratchId: number; maskId: number; carrierId: number }
const menus = [[0, 0, 1, 0, 0, 1, 1, 0, 1], 1, 1, 1, 1, 1, 1, 0, 0];
const tools = [0, 1, 2, 5, 6, 7, 8, 9, 10, 14, 18, 19, 20, 23, 27, 31, 34, 35, 36, 37, 38, 39, 40, 59, 60, 61];
export function photopeaUrl(id: string, theme: "light" | "dark" = "dark") {
  return `${PHOTOPEA_ORIGIN}/#${encodeURIComponent(JSON.stringify({
    // Omit autosave: Photopea treats 0 as a repeating timer, not as disabled.
    environment: { theme: theme === "light" ? 6 : 3, lang: "zh-CN", intro: false, vmode: 1, panels: [2, 0], menus, showtools: tools,
      customIO: { save: `app.echoToOE(JSON.stringify({koma:${literal(id)},event:"save",source:app.documents.length?app.activeDocument.source:null}));` } },
  }))}`;
}
// Photopea can swallow throw/finally. Known guards reply explicitly and return.
export function photopeaScript(id: string, command: number, body: string) {
  return `(function(){function reply(event,detail){app.echoToOE(JSON.stringify({koma:${literal(id)},command:${command},event:event,detail:detail}));}
    reply("start");try{${body};reply("complete");}catch(e){reply("error",String(e.message||e).slice(0,240));}})();`;
}
const findDocument = (id: string) => `var d=null;for(var i=0;i<app.documents.length;i++){if(app.documents[i].source===${literal(`koma:${id}`)})d=app.documents[i];}
  if(!d)return reply("error","分层文档已关闭，请重新载入");`;
const owned = (id: string) => `if(app.documents.length<1)return reply("error","请切回本次打开的 Koma 图像");
  var d=app.activeDocument;reply("document",d.source);if(d.source!==${literal(`koma:${id}`)})return reply("error","请切回本次打开的 Koma 图像");`;
const helpers = `function root(doc,id){for(var j=0;j<doc.layers.length;j++){if(doc.layers[j].id===id)return doc.layers[j];}return null;}
  function alphaSelection(){var desc=new ActionDescriptor(),ref=new ActionReference();
    ref.putProperty(charIDToTypeID("Chnl"),charIDToTypeID("fsel"));desc.putReference(charIDToTypeID("null"),ref);
    var alpha=new ActionReference();alpha.putEnumerated(charIDToTypeID("Chnl"),charIDToTypeID("Chnl"),charIDToTypeID("Trsp"));
    desc.putReference(charIDToTypeID("T   "),alpha);executeAction(charIDToTypeID("setd"),desc,DialogModes.NO);}
  function bounds(doc){var result=null;try{var b=doc.selection.bounds;if(b&&b.length===4&&b[2].value>b[0].value&&b[3].value>b[1].value)result=[b[0].value,b[1].value,b[2].value,b[3].value];}catch(e){}return result;}
  function white(){var c=new SolidColor();c.rgb.hexValue="ffffff";return c;}`;
const roles = (value: PhotopeaRoles) => `var roles=${JSON.stringify(value)};`;
const validate = `var mi=-1,ci=-1;for(var ri=0;ri<d.layers.length;ri++){if(d.layers[ri].id===roles.maskId)mi=ri;if(d.layers[ri].id===roles.carrierId)ci=ri;}
  if(mi<0||ci<0)return reply("error","Koma 蒙版或选区辅助层结构已变化，请撤销相关操作");
  var mask=d.layers[mi],carrier=d.layers[ci];
  if(mask.typename!=="ArtLayer"||carrier.typename!=="ArtLayer"||String(mask.kind)!=="0"||String(carrier.kind)!=="0"||mask.grouped||carrier.grouped)
    return reply("error","Koma 蒙版或选区辅助层结构已变化，请撤销相关操作");
  for(var j=0;j<d.layers.length;j++){var l=d.layers[j];if(l.id!==mask.id&&(l.name==="Koma 蒙版"||l.name.indexOf("Koma 蒙版 copy")===0||l.name.indexOf("Koma 蒙版 副本")===0))return reply("error","存在重复的 Koma 蒙版层，请撤销复制操作");}`;
const state = `var ids=[],visible=[],maskIndex=-1,carrierIndex=-1;for(var j=0;j<d.layers.length;j++){var l=d.layers[j];ids.push(l.id);if(l.id===roles.maskId)maskIndex=j;if(l.id===roles.carrierId)carrierIndex=j;if(l.visible&&l.id!==roles.maskId&&l.id!==roles.carrierId)visible.push(l.id);}
  reply("state",{baseId:roles.baseId,scratchId:roles.scratchId,maskId:roles.maskId,carrierId:roles.carrierId,layers:ids,visible:visible,width:Number(d.width),height:Number(d.height),selection:bounds(d),maskIndex:maskIndex,carrierIndex:carrierIndex});`;

export function initializePhotopea(id: string, maskMode = false) {
  return `if(!app.documents.length)return reply("error","图片未打开");var d=app.activeDocument;d.source=${literal(`koma:${id}`)};d.name="Koma";${helpers}
    var base=d.activeLayer;base.name="原图";
    var carrier=d.artLayers.add();carrier.name="Koma 选区辅助";d.selection.selectAll();d.selection.fill(white());d.selection.deselect();carrier.visible=false;carrier.move(base,ElementPlacement.PLACEAFTER);carrier.allLocked=true;
    var scratch=d.artLayers.add();scratch.name="涂鸦与修补";scratch.move(base,ElementPlacement.PLACEBEFORE);
    var mask=d.artLayers.add();mask.name="Koma 蒙版";mask.opacity=55;mask.move(scratch,ElementPlacement.PLACEBEFORE);
    var roles={baseId:base.id,scratchId:scratch.id,maskId:mask.id,carrierId:carrier.id};
    d.activeLayer=${maskMode ? "mask" : "scratch"};${state}d.clearHistory();app.UI.fitTheArea();`;
}
export const resetPhotopea = `while(app.documents.length){var count=app.documents.length;app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);if(app.documents.length>=count)return reply("error","未能关闭上次文档，请重新载入");}`;
export function closePhotopeaDocument(id: string) {
  return "for(var j=app.documents.length-1;j>=0;j--){var d=app.documents[j];if(d.source===" + literal("koma:" + id) + "){app.activeDocument=d;d.close(SaveOptions.DONOTSAVECHANGES);}}";
}
export function resumePhotopea(previous: string, id: string, value: PhotopeaRoles) {
  return `${helpers}${findDocument(previous)}${roles(value)}${validate}app.activeDocument=d;d.source=${literal(`koma:${id}`)};${state}`;
}
/** Reserve a unique target-layer ID in the temporary input document before
 * duplicating: Photopea allocates the imported ID from the source document. */
export function copyPhotopeaInput(id: string) {
  return `${helpers}var md=app.activeDocument;${findDocument(id)}
    if(md.source===d.source||Number(md.width)!==Number(d.width)||Number(md.height)!==Number(d.height))return reply("error","输入图像或尺寸不一致");
    var source=md.activeLayer;app.activeDocument=d;var original=d.activeLayer,highest=1;
    var parents=[d],seen={};for(var qi=0;qi<parents.length;qi++){if(qi>10000)return reply("error","图层结构无法遍历");var container=parents[qi];for(var q=0;q<container.layers.length;q++){var l=container.layers[q];if(l.id>highest)highest=l.id;if(l.typename==="LayerSet"&&!seen[l.id]){seen[l.id]=true;parents.push(l);}}}
    if(highest>10000)return reply("error","图层标识过多，请另存分层文件后重新载入");
    // A nested active target can stall Photopea cross-document duplication.
    for(var q=0;q<d.layers.length;q++){if(d.layers[q].typename==="ArtLayer"){d.activeLayer=d.layers[q];break;}}
    var reserve1=d.artLayers.add(),reserve2=d.artLayers.add();reserve1.remove();
    app.activeDocument=md;var last=source.id;
    for(var q=0;last<highest&&q<10000;q++){last=md.artLayers.add().id;}
    if(last!==highest)return reply("error","输入图层标识无法对齐，请重新载入");
    md.activeLayer=source;source.duplicate(d,ElementPlacement.PLACEATBEGINNING);app.activeDocument=d;
    var incoming=root(d,highest+1);if(!incoming)return reply("error","未能定位输入图层，请保留分层文档后重试");
    reserve2.remove();incoming.name=${literal(`koma-input:${id}`)};md.source=${literal(`koma-input:${id}`)};d.activeLayer=original;`;
}
export function applyPhotopeaInput(id: string, value: PhotopeaRoles, kind: "base" | "mask", hasPixels: boolean, baked: readonly number[] = [], maskMode = false) {
  return `${helpers}${findDocument(id)}${roles(value)}${validate}app.activeDocument=d;var original=d.activeLayer,incoming=null;for(var j=0;j<d.layers.length;j++)if(d.layers[j].name===${literal(`koma-input:${id}`)})incoming=d.layers[j];
    ${hasPixels ? `if(!incoming)return reply("error","输入图层缺失，请重新载入");` : ""}
    ${kind === "base" ? `var base=root(d,roles.baseId);if(!base)return reply("error","原图层已合并或删除，请先保存分层文件后重新载入");
      var next=incoming;next.name="原图";next.move(base,ElementPlacement.PLACEBEFORE);base.visible=false;roles.baseId=next.id;
      var baked=${JSON.stringify(baked)};for(var j=0;j<d.layers.length;j++){var l=d.layers[j];for(var k=0;k<baked.length;k++){
        if(l.id===baked[k]&&l.id!==roles.maskId&&l.id!==roles.carrierId&&l.id!==next.id)l.visible=false;}}
      if(baked.length){var scratch=d.artLayers.add();scratch.name="涂鸦与修补";scratch.move(mask,ElementPlacement.PLACEAFTER);roles.scratchId=scratch.id;}
      d.activeLayer=${maskMode ? "mask" : "root(d,roles.scratchId)||next"};` : `
      var name=mask.name,opacity=mask.opacity,visible=mask.visible,locked=mask.allLocked;mask.allLocked=false;
      d.activeLayer=mask;d.selection.selectAll();d.selection.clear();d.selection.deselect();
      ${hasPixels ? `d.activeLayer=incoming;alphaSelection();d.activeLayer=mask;if(bounds(d))d.selection.fill(white());incoming.remove();` : ""}
      mask.name=name;mask.opacity=opacity;mask.visible=visible;mask.allLocked=locked;d.selection.deselect();d.activeLayer=original;`}
    ${state}`;
}
export function closePhotopeaInput(id: string, initial = false) {
  return `${findDocument(id)}for(var j=app.documents.length-1;j>=0;j--){var md=app.documents[j];if(md.source===${literal(`koma-input:${id}`)}){app.activeDocument=md;md.close(SaveOptions.DONOTSAVECHANGES);}}
    app.activeDocument=d;${initial ? "d.clearHistory();" : ""}`;
}
/** The project is only an in-memory transport snapshot. It is never persisted. */
export function preparePhotopeaExport(id: string, value: PhotopeaRoles) {
  return `${helpers}${owned(id)}${roles(value)}${validate}
    if(Number(d.width)*Number(d.height)>32000000)return reply("error","图片最多 3200 万像素");
    var original=d.activeLayer,failure=null;try{if(bounds(d)){d.activeLayer=carrier;d.selection.copy();}}catch(e){failure=e;}
    d.activeLayer=original;if(failure)return reply("error",String(failure));${state}reply("project");d.saveToOE("psd:true");`;
}
/** Export from the decoded project snapshot, preserving the actual work document,
 * including its pre-existing redo branch. Root positions map roles in this exact snapshot. */
export function exportPhotopea(id: string, maskIndex: number, carrierIndex: number, selection: number[] | null) {
  return `${helpers}var temp=app.activeDocument;${findDocument(id)}
    if(temp.source===d.source)return reply("error","临时导出文档无效");
    function finish(){app.activeDocument=temp;temp.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=d;}
    if(Number(temp.width)!==Number(d.width)||Number(temp.height)!==Number(d.height)){finish();return reply("error","临时导出文档无效");}
    reply("document",d.source);var failure=null;
    try{
      var mask=temp.layers[${maskIndex}],carrier=temp.layers[${carrierIndex}];
      if(!mask||!carrier){finish();return reply("error","临时工作栈结构不一致");}
      if(mask.typename!=="ArtLayer"||carrier.typename!=="ArtLayer"){finish();return reply("error","临时工作栈结构不一致");}
      app.activeDocument=temp;mask.visible=false;carrier.visible=false;reply("image");temp.saveToOE("png");
      for(var j=0;j<temp.layers.length;j++)temp.layers[j].visible=false;
      temp.selection.deselect();var selected=temp.artLayers.add();
      ${selection ? `var pasted=temp.paste();selected=pasted;pasted.visible=true;pasted.opacity=100;pasted.fillOpacity=100;var pb=pasted.bounds;pasted.translate(${selection[0]}-pb[0].value,${selection[1]}-pb[1].value);` : ""}
      reply("selection");temp.saveToOE("png");selected.visible=false;
      function coverage(layer,label){temp.selection.deselect();layer.allLocked=false;layer.visible=true;layer.opacity=100;layer.fillOpacity=100;temp.activeLayer=layer;alphaSelection();
        var pixels=temp.artLayers.add();pixels.visible=true;if(bounds(temp))temp.selection.fill(white());temp.selection.deselect();layer.visible=false;
        reply(label);temp.saveToOE("png");pixels.visible=false;}
      coverage(mask,"mask");coverage(carrier,"carrier");
    }catch(e){failure=e;}
    finish();if(failure)return reply("error",String(failure));`;
}
